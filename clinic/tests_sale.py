from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import CashierShift, Invoice, Medicine, Patient

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class SaleFlowTests(APITestCase):
    """Màn Bán hàng kiểu Pabau: bán cho khách vãng lai và thanh toán ngay khi tạo hóa đơn."""

    def setUp(self):
        self.cskh = User.objects.create_user(username='c1', password='pass12345', role='consultant', first_name='c1')
        t, _ = Token.objects.get_or_create(user=self.cskh)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')
        # Cash payments must be tied to an open cashier shift in the real workflow.
        CashierShift.objects.create(cashier=self.cskh, opening_cash=0)
        self.patient = Patient.objects.create(full_name='Trần B', phone='0912345678')
        self.med = Medicine.objects.create(name='Kem dưỡng', unit='tuýp', price=40000, cost=25000, stock=5)

    def test_walk_in_paid_at_once(self):
        body = {'walk_in': True, 'items': [{'kind': 'medicine', 'medicine': self.med.id, 'name': 'Kem dưỡng', 'quantity': 2, 'unit_price': 40000},
                                          {'kind': 'other', 'name': 'Phí khác', 'quantity': 1, 'unit_price': 20000}],
                'payments': [{'amount': 60000, 'method': 'cash'}, {'amount': 40000, 'method': 'transfer', 'reference': 'FT1'}]}
        r = self.client.post('/api/clinic/invoices/', body, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        d = r.json()
        self.assertEqual((d['status'], d['total'], d['paid'], d['balance']), ('paid', 100000, 100000, 0))
        self.assertEqual(d['patient_code'], 'KHACHLE')
        self.assertEqual(len(d['payments']), 2)
        self.med.refresh_from_db()
        self.assertEqual(self.med.stock, 3)                                     # tồn kho trừ đúng
        # khách vãng lai không lọt vào danh sách bệnh nhân
        rows = self.client.get('/api/clinic/patients/', {'q': 'vãng'}).json()
        self.assertFalse([p for p in (rows if isinstance(rows, list) else rows.get('results', [])) if p['code'] == 'KHACHLE'])

    def test_overpay_rejected_and_nothing_created(self):
        body = {'patient': self.patient.id, 'items': [{'kind': 'other', 'name': 'X', 'quantity': 1, 'unit_price': 50000}],
                'payments': [{'amount': 60000, 'method': 'cash'}]}
        r = self.client.post('/api/clinic/invoices/', body, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertFalse(Invoice.objects.exists())                              # giao dịch hủy toàn bộ

    def test_unpaid_then_quick_pay(self):
        r = self.client.post('/api/clinic/invoices/', {'patient': self.patient.id, 'items': [{'kind': 'other', 'name': 'X', 'quantity': 1, 'unit_price': 50000}]}, format='json')
        self.assertEqual((r.status_code, r.json()['status']), (201, 'unpaid'))
        pk = r.json()['id']
        r = self.client.post(f'/api/clinic/invoices/{pk}/pay/', {'amount': 20000, 'method': 'cash'}, format='json')
        self.assertEqual(r.json()['status'], 'partial')
