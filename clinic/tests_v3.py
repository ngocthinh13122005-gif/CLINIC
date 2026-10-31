import base64
import io
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import (CareTask, Invoice, InvoiceItem, Medicine, MedicalRecord, Patient, Payment, Room, StockLot, StockMovement, Supplier, Visit)

User = get_user_model()


def png_b64():
    from PIL import Image
    buf = io.BytesIO()
    Image.new('RGB', (300, 120), 'white').save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class V3Tests(APITestCase):
    def setUp(self):
        mk = lambda n, r: User.objects.create_user(username=n, password='pass12345', role=r, first_name=n)
        self.manager, self.doctor, self.cskh, self.nurse = mk('m1', 'manager'), mk('d1', 'doctor'), mk('c1', 'consultant'), mk('n1', 'staff')
        self.patient = Patient.objects.create(full_name='Lê Thị C', phone='0987654321', national_id='079123456789', email='c@x.vn', address='Đà Nẵng')
        self.med = Medicine.objects.create(name='Adapalene 0.1% gel', unit='tuýp', price=120000, cost=70000)
        self.sup = Supplier.objects.create(name='Công ty Dược A')

    def auth(self, u):
        t, _ = Token.objects.get_or_create(user=u)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')

    def po_flow(self, qty=30, cost=70000, exp=None):
        self.auth(self.manager)
        r = self.client.post('/api/clinic/purchase-orders/', {'supplier': self.sup.pk, 'lines': [{'medicine': self.med.pk, 'quantity': qty, 'unit_cost': cost}]}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        po = r.json()
        self.assertEqual(self.client.post(f'/api/clinic/purchase-orders/{po["id"]}/confirm/').status_code, 200)
        line = po['lines'][0]['id']
        return po, line

    def test_purchase_receive_partial_creates_lots_and_fefo(self):
        po, line = self.po_flow(30)
        r = self.client.post(f'/api/clinic/purchase-orders/{po["id"]}/receive/', {'lines': [{'line_id': line, 'quantity': 10, 'lot_no': 'L1', 'expiry': str(timezone.localdate() + timedelta(days=200))}]}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['status'], 'partial')
        r = self.client.post(f'/api/clinic/purchase-orders/{po["id"]}/receive/', {'lines': [{'line_id': line, 'quantity': 20, 'lot_no': 'L2', 'expiry': str(timezone.localdate() + timedelta(days=60))}]}, format='json')
        self.assertEqual(r.json()['status'], 'received')
        self.med.refresh_from_db()
        self.assertEqual(self.med.stock, 30)
        over = self.client.post(f'/api/clinic/purchase-orders/{po["id"]}/receive/', {'lines': [{'line_id': line, 'quantity': 1}]}, format='json')
        self.assertEqual(over.status_code, 400)
        # xuất 25: lấy hết lô L2 (hết hạn sớm, 20) rồi 5 từ L1
        from . import inventory
        inventory.consume(self.med, 25, StockMovement.OUT, self.manager, 'HD-TEST')
        l1, l2 = StockLot.objects.get(lot_no='L1'), StockLot.objects.get(lot_no='L2')
        self.assertEqual((l1.quantity, l2.quantity), (5, 0))
        self.med.refresh_from_db()
        self.assertEqual(self.med.stock, 5)
        with self.assertRaises(Exception):
            inventory.consume(self.med, 6, StockMovement.OUT, self.manager)

    def test_stock_count_validate_adjusts(self):
        po, line = self.po_flow(10)
        self.client.post(f'/api/clinic/purchase-orders/{po["id"]}/receive/', {'lines': [{'line_id': line, 'quantity': 10, 'lot_no': 'K1'}]}, format='json')
        c = self.client.post('/api/clinic/stock-counts/', {'note': 'Kiểm cuối tháng'}, format='json').json()
        row = next(l for l in c['lines'] if l['medicine'] == self.med.pk)
        self.assertEqual(self.client.post(f'/api/clinic/stock-counts/{c["id"]}/validate/').status_code, 400)  # còn dòng chưa đếm
        self.client.post(f'/api/clinic/stock-counts/{c["id"]}/lines/', {'lines': [{'id': l['id'], 'counted_qty': (8 if l['id'] == row['id'] else l['expected_qty'])} for l in c['lines']]}, format='json')
        r = self.client.post(f'/api/clinic/stock-counts/{c["id"]}/validate/')
        self.assertEqual(r.status_code, 200, r.content)
        self.med.refresh_from_db()
        self.assertEqual(self.med.stock, 8)
        mv = StockMovement.objects.filter(kind='adjust', medicine=self.med).first()
        self.assertEqual(mv.quantity, -2)
        self.assertEqual(self.client.post(f'/api/clinic/stock-counts/{c["id"]}/validate/').status_code, 400)

    def test_inventory_permissions(self):
        self.auth(self.cskh)
        self.assertEqual(self.client.post('/api/clinic/purchase-orders/', {'supplier': self.sup.pk, 'lines': []}, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/clinic/stock-counts/').status_code, 403)
        self.assertEqual(self.client.get('/api/clinic/lots/').status_code, 200)
        self.assertEqual(self.client.get('/api/clinic/inventory/overview/').json()['value'], None)  # giá vốn chỉ quản lý
        self.auth(self.nurse)
        self.assertEqual(self.client.get('/api/clinic/lots/').status_code, 200)

    def test_scrap_expired_lot(self):
        po, line = self.po_flow(10)
        self.client.post(f'/api/clinic/purchase-orders/{po["id"]}/receive/', {'lines': [{'line_id': line, 'quantity': 10, 'lot_no': 'X', 'expiry': str(timezone.localdate() - timedelta(days=3))}]}, format='json')
        lot = StockLot.objects.get(lot_no='X')
        self.assertEqual(self.client.post(f'/api/clinic/lots/{lot.pk}/scrap/', {'quantity': 4}, format='json').status_code, 200)
        lot.refresh_from_db()
        self.med.refresh_from_db()
        self.assertEqual((lot.quantity, self.med.stock), (6, 6))
        self.assertEqual(self.client.get('/api/clinic/inventory/overview/').json()['expired'], 1)
        self.assertEqual(self.client.post(f'/api/clinic/lots/{lot.pk}/scrap/', {'quantity': 99}, format='json').status_code, 400)

    def test_phone_masked_for_service_staff_only(self):
        self.auth(self.nurse)
        d = self.client.get('/api/clinic/patients/').json()[0]
        self.assertEqual(d['phone'], '098****321')
        self.assertEqual(d['national_id'], '')
        self.auth(self.cskh)
        d = self.client.get('/api/clinic/patients/').json()[0]
        self.assertEqual(d['phone'], '0987654321')

    def test_room_conflict(self):
        room = Room.objects.create(name='Phòng 1')
        v1 = Visit.objects.create(patient=self.patient)
        p2 = Patient.objects.create(full_name='Khác', phone='0911111111')
        v2 = Visit.objects.create(patient=p2)
        self.auth(self.cskh)
        self.assertEqual(self.client.post(f'/api/clinic/visits/{v1.pk}/call/', {'doctor': self.doctor.pk, 'room': room.pk}, format='json').status_code, 200)
        r = self.client.post(f'/api/clinic/visits/{v2.pk}/call/', {'doctor': self.doctor.pk, 'room': room.pk}, format='json')
        self.assertEqual(r.status_code, 400)
        board = self.client.get('/api/clinic/rooms/board/').json()
        self.assertEqual(board[0]['visit']['patient'], 'Lê Thị C')

    def test_care_tasks_auto_and_done(self):
        v = Visit.objects.create(patient=self.patient, status=Visit.COMPLETED, finished_at=timezone.now() - timedelta(days=2))
        inv = Invoice.objects.create(patient=self.patient, created_at=timezone.now() - timedelta(days=10))
        InvoiceItem.objects.create(invoice=inv, name='Peel', quantity=1, unit_price=500000)
        inv.recalc()
        self.auth(self.cskh)
        rows = self.client.get('/api/clinic/care-tasks/').json()
        kinds = {r['kind'] for r in rows}
        self.assertEqual(kinds, {'post_care', 'payment'})
        self.assertEqual(len(self.client.get('/api/clinic/care-tasks/').json()), 2)   # idempotent
        t = rows[0]
        r = self.client.post(f'/api/clinic/care-tasks/{t["id"]}/done/', {'outcome': 'Đã gọi, da ổn'}, format='json')
        self.assertEqual(r.json()['status'], 'done')
        self.auth(self.nurse)
        self.assertEqual(self.client.get('/api/clinic/care-tasks/').status_code, 403)

    def test_care_contact_history_and_clinical_escalation(self):
        self.auth(self.cskh)
        task = self.client.post('/api/clinic/care-tasks/', {
            'patient': self.patient.pk, 'kind': 'post_care', 'priority': 'high',
            'title': 'Hỏi thăm sau peel', 'due_date': str(timezone.localdate()),
        }, format='json').json()
        r = self.client.post(f'/api/clinic/care-tasks/{task["id"]}/contact/', {
            'channel': 'call', 'result': 'needs_doctor', 'note': 'Đỏ rát tăng và sưng nhiều', 'clinical_alert': True,
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['status'], 'escalated')
        self.assertEqual(r.json()['priority'], 'urgent')
        self.assertEqual(r.json()['contact_count'], 1)
        self.assertEqual(r.json()['last_contact']['result'], 'needs_doctor')
        self.auth(self.doctor)
        done = self.client.post(f'/api/clinic/care-tasks/{task["id"]}/contact/', {
            'channel': 'call', 'result': 'completed', 'note': 'Bác sĩ đã đánh giá và hướng dẫn tái khám.',
        }, format='json')
        self.assertEqual(done.status_code, 200, done.content)
        self.assertEqual(done.json()['status'], 'done')
        self.assertEqual(done.json()['contact_count'], 2)

    def test_consent_sign_flow(self):
        self.auth(self.cskh)
        c = self.client.post('/api/clinic/consents/', {'patient': self.patient.pk, 'kind': 'laser'}, format='json').json()
        self.assertIn('laser', c['title'].lower())
        bad = self.client.post(f'/api/clinic/consents/{c["id"]}/sign/', {'signer_name': 'Lê Thị C', 'signature': 'data:image/png;base64,AAAA'}, format='json')
        self.assertEqual(bad.status_code, 400)
        ok = self.client.post(f'/api/clinic/consents/{c["id"]}/sign/', {'signer_name': 'Lê Thị C', 'signature': png_b64()}, format='json')
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()['status'], 'signed')
        self.assertEqual(len(ok.json()['content_hash']), 64)
        again = self.client.post(f'/api/clinic/consents/{c["id"]}/sign/', {'signer_name': 'X', 'signature': png_b64()}, format='json')
        self.assertEqual(again.status_code, 400)
        self.assertEqual(self.client.post(f'/api/clinic/consents/{c["id"]}/revoke/').status_code, 403)   # CSKH không thu hồi
        self.auth(self.nurse)
        self.assertEqual(self.client.get('/api/clinic/consents/').status_code, 403)

    def test_reports_manager_only_and_xlsx(self):
        v = Visit.objects.create(patient=self.patient, status=Visit.COMPLETED, doctor=self.doctor, finished_at=timezone.now())
        inv = Invoice.objects.create(patient=self.patient, visit=v)
        InvoiceItem.objects.create(invoice=inv, name='Peel da', quantity=2, unit_price=500000)
        inv.recalc()
        Payment.objects.create(invoice=inv, amount=600000)
        inv.recalc()
        self.auth(self.doctor)
        self.assertEqual(self.client.get('/api/clinic/reports/revenue/').status_code, 403)
        self.auth(self.manager)
        for name in ('revenue', 'visits', 'receivables', 'inventory', 'care'):
            r = self.client.get(f'/api/clinic/reports/{name}/')
            self.assertEqual(r.status_code, 200, (name, r.content[:300]))
            self.assertTrue(r.json()['kpis'] and r.json()['tables'])
            x = self.client.get(f'/api/clinic/reports/{name}/?export=xlsx')
            self.assertEqual(x.status_code, 200, name)
            self.assertTrue(x.content[:2] == b'PK')
        rev = self.client.get('/api/clinic/reports/revenue/').json()
        k = {i['label']: i['value'] for i in rev['kpis']}
        self.assertEqual((k['Thực thu'], k['Doanh số (hóa đơn)'], k['Công nợ phát sinh']), (600000, 1000000, 400000))
        self.assertEqual(self.client.get('/api/clinic/reports/nope/').status_code, 404)

    def test_audit_log_manager_only(self):
        self.auth(self.manager)
        self.client.get('/api/clinic/reports/revenue/')
        r = self.client.get('/api/clinic/audit/?prefix=report')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['rows'])
        self.auth(self.doctor)
        self.assertEqual(self.client.get('/api/clinic/audit/').status_code, 403)
