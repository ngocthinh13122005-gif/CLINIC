from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import CashierShift, DebtFollowUp, Invoice, Medicine, Patient, Payment, Refund, Visit

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class PharmacyBillingTests(APITestCase):
    def setUp(self):
        mk = lambda n, r: User.objects.create_user(username=n, password='pass12345', role=r, first_name=n)
        self.manager, self.doctor, self.cskh, self.nurse = mk('m1', 'manager'), mk('d1', 'doctor'), mk('c1', 'consultant'), mk('n1', 'staff')
        self.patient = Patient.objects.create(full_name='Trần B', phone='0912345678', allergies='Doxycycline',
                                              address='12 Lê Lợi, Q.1, TP.HCM', date_of_birth='1990-05-01')
        self.visit = Visit.objects.create(patient=self.patient, status=Visit.IN_CONSULT, doctor=self.doctor)
        self.med = Medicine.objects.create(name='Acyclovir 5% kem', active_ingredient='Acyclovir', unit='tuýp', price=40000, cost=25000, stock=5)
        self.dox = Medicine.objects.create(name='Doxycycline 100mg', active_ingredient='Doxycycline', unit='viên', price=3000, stock=100)

    def auth(self, u):
        t, _ = Token.objects.get_or_create(user=u)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')

    def test_medicine_permissions_and_cost_hidden(self):
        self.auth(self.cskh)
        rows = self.client.get('/api/clinic/medicines/').json()
        self.assertTrue(rows and 'cost' not in rows[0])
        self.assertEqual(self.client.post('/api/clinic/medicines/', {'name': 'X', 'price': 1}).status_code, 403)
        self.auth(self.manager)
        self.assertIn('cost', self.client.get('/api/clinic/medicines/').json()[0])
        r = self.client.post('/api/clinic/medicines/', {'name': 'Mới', 'price': 1000, 'stock': 999}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['stock'], 0)                    # tồn không set trực tiếp
        mid = r.json()['id']
        self.assertEqual(self.client.post(f'/api/clinic/medicines/{mid}/receive/', {'quantity': 20}, format='json').json()['stock'], 20)
        self.assertEqual(self.client.post(f'/api/clinic/medicines/{mid}/adjust/', {'actual': 18}, format='json').json()['stock'], 18)
        self.assertEqual(self.client.post(f'/api/clinic/medicines/{mid}/receive/', {'quantity': -3}, format='json').status_code, 400)

    def test_prescription_doctor_only_and_allergy_warning(self):
        body = {'visit': self.visit.pk, 'issue': True, 'items': [{'medicine': self.dox.pk, 'quantity': 10, 'dosage': '1 viên x 2', 'days': 5}]}
        self.auth(self.cskh)
        self.assertEqual(self.client.post('/api/clinic/prescriptions/save/', body, format='json').status_code, 403)
        self.assertEqual(self.client.get('/api/clinic/prescriptions/').status_code, 403)
        self.auth(self.doctor)
        r = self.client.post('/api/clinic/prescriptions/save/', body, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['status'], 'issued')
        self.assertEqual(len(r.json()['allergy_warnings']), 1)
        # dup + empty issue
        body['items'].append(dict(body['items'][0]))
        self.assertEqual(self.client.post('/api/clinic/prescriptions/save/', body, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/clinic/prescriptions/save/', {'visit': self.visit.pk, 'issue': True, 'items': []}, format='json').status_code, 400)

    def test_invoice_flow_stock_payment_void(self):
        self.auth(self.cskh)
        r = self.client.post('/api/clinic/invoices/', {'patient': self.patient.pk, 'visit': self.visit.pk, 'discount': 5000,
                             'items': [{'kind': 'medicine', 'medicine': self.med.pk, 'quantity': 2, 'unit_price': 40000},
                                       {'kind': 'other', 'name': 'Phí khám', 'quantity': 1, 'unit_price': 100000}]}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        inv = r.json()
        self.assertEqual((inv['subtotal'], inv['total'], inv['status']), (180000, 175000, 'unpaid'))
        self.med.refresh_from_db(); self.assertEqual(self.med.stock, 3)
        # trùng hóa đơn cho cùng lượt khám
        self.assertEqual(self.client.post('/api/clinic/invoices/', {'patient': self.patient.pk, 'visit': self.visit.pk,
                         'items': [{'kind': 'other', 'name': 'x', 'quantity': 1, 'unit_price': 1}]}, format='json').status_code, 400)
        # thu 1 phần rồi hết
        p = self.client.post(f"/api/clinic/invoices/{inv['id']}/pay/", {'amount': 75000, 'method': 'transfer'}, format='json').json()
        self.assertEqual((p['status'], p['balance']), ('partial', 100000))
        self.assertEqual(self.client.post(f"/api/clinic/invoices/{inv['id']}/pay/", {'amount': 999999}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f"/api/clinic/invoices/{inv['id']}/", {'items': [{'kind': 'other', 'name': 'a', 'quantity': 1, 'unit_price': 5}]}, format='json').status_code, 400)
        p = self.client.post(f"/api/clinic/invoices/{inv['id']}/pay/", {'amount': 100000, 'method': 'transfer'}, format='json').json()
        self.assertEqual((p['status'], p['paid']), ('paid', 175000))
        # CSKH không hủy; đã thu tiền thì manager cũng không hủy
        self.assertEqual(self.client.post(f"/api/clinic/invoices/{inv['id']}/void/", {'reason': 'nhầm hóa đơn'}, format='json').status_code, 403)
        self.auth(self.manager)
        self.assertEqual(self.client.post(f"/api/clinic/invoices/{inv['id']}/void/", {'reason': 'nhầm hóa đơn'}, format='json').status_code, 400)

    def test_stock_insufficient_edit_and_void_restore(self):
        self.auth(self.cskh)
        bad = {'patient': self.patient.pk, 'items': [{'kind': 'medicine', 'medicine': self.med.pk, 'quantity': 9, 'unit_price': 1}]}
        self.assertEqual(self.client.post('/api/clinic/invoices/', bad, format='json').status_code, 400)
        self.assertFalse(Invoice.objects.exists())                # rollback hoàn toàn
        ok = {'patient': self.patient.pk, 'items': [{'kind': 'medicine', 'medicine': self.med.pk, 'quantity': 4, 'unit_price': 40000}]}
        inv = self.client.post('/api/clinic/invoices/', ok, format='json').json()
        self.med.refresh_from_db(); self.assertEqual(self.med.stock, 1)
        ok['items'][0]['quantity'] = 2
        self.client.patch(f"/api/clinic/invoices/{inv['id']}/", {'items': ok['items']}, format='json')
        self.med.refresh_from_db(); self.assertEqual(self.med.stock, 3)
        self.auth(self.manager)
        self.assertEqual(self.client.post(f"/api/clinic/invoices/{inv['id']}/void/", {'reason': 'khách đổi ý'}, format='json').status_code, 200)
        self.med.refresh_from_db(); self.assertEqual(self.med.stock, 5)

    def test_draft_from_visit_and_summary_roles(self):
        self.auth(self.doctor)
        self.client.post('/api/clinic/prescriptions/save/', {'visit': self.visit.pk, 'issue': True,
                         'items': [{'medicine': self.med.pk, 'quantity': 1, 'days': 7}]}, format='json')
        self.auth(self.cskh)
        d = self.client.get(f'/api/clinic/invoices/draft-from-visit/?visit={self.visit.pk}').json()
        self.assertTrue(d['has_prescription'])
        self.assertEqual(d['items'][0]['unit_price'], 40000)
        self.assertNotIn('month_revenue', self.client.get('/api/clinic/invoices/summary/').json())
        self.auth(self.manager)
        self.assertIn('month_revenue', self.client.get('/api/clinic/invoices/summary/').json())
        self.auth(self.nurse)
        self.assertEqual(self.client.get('/api/clinic/invoices/').status_code, 403)

    def test_invoice_terms_and_debt_follow_up(self):
        self.auth(self.cskh)
        r = self.client.post('/api/clinic/invoices/', {'patient': self.patient.pk, 'payment_term': '7d',
                             'items': [{'kind': 'other', 'name': 'Phí khám', 'quantity': 1, 'unit_price': 100000}]}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        inv = r.json()
        self.assertEqual(inv['payment_term'], '7d')
        self.assertTrue(inv['due_date'])
        follow = self.client.post('/api/clinic/debt-followups/', {'invoice': inv['id'], 'action': 'call',
                                  'note': 'Khách hẹn thanh toán vào tuần tới', 'next_follow_up': inv['due_date']}, format='json')
        self.assertEqual(follow.status_code, 201, follow.content)
        self.assertEqual(DebtFollowUp.objects.filter(invoice_id=inv['id']).count(), 1)
        detail = self.client.get(f"/api/clinic/invoices/{inv['id']}/").json()
        self.assertEqual(detail['followups'][0]['action'], 'call')

    def test_cashier_shift_reconciliation_and_refund_approval(self):
        self.auth(self.cskh)
        inv = self.client.post('/api/clinic/invoices/', {'patient': self.patient.pk,
                               'items': [{'kind': 'other', 'name': 'Dịch vụ', 'quantity': 1, 'unit_price': 200000}]}, format='json').json()
        cash = self.client.post(f"/api/clinic/invoices/{inv['id']}/pay/", {'amount': 200000, 'method': 'cash'}, format='json')
        self.assertEqual(cash.status_code, 400)
        shift = self.client.post('/api/clinic/cashier-shifts/open/', {'opening_cash': 500000}, format='json')
        self.assertEqual(shift.status_code, 201, shift.content)
        paid = self.client.post(f"/api/clinic/invoices/{inv['id']}/pay/", {'amount': 200000, 'method': 'cash'}, format='json')
        self.assertEqual(paid.status_code, 200, paid.content)
        payment = Payment.objects.get(invoice_id=inv['id'])
        self.assertEqual(payment.reconciliation_status, Payment.PENDING)
        closed = self.client.post(f"/api/clinic/cashier-shifts/{shift.json()['id']}/close/", {'counted_cash': 700000}, format='json')
        self.assertEqual(closed.status_code, 200, closed.content)
        self.assertEqual((closed.json()['expected_cash'], closed.json()['difference']), (700000, 0))
        payment.refresh_from_db()
        self.assertEqual(payment.reconciliation_status, Payment.RECONCILED)

        refund = self.client.post('/api/clinic/refunds/', {'invoice': inv['id'], 'amount': 50000, 'method': 'cash',
                                  'reason': 'Khách đổi dịch vụ'}, format='json')
        self.assertEqual(refund.status_code, 201, refund.content)
        self.assertEqual(self.client.post(f"/api/clinic/refunds/{refund.json()['id']}/approve/").status_code, 403)
        self.auth(self.manager)
        self.assertEqual(self.client.post(f"/api/clinic/refunds/{refund.json()['id']}/approve/").status_code, 200)
        self.auth(self.cskh)
        self.assertEqual(self.client.post(f"/api/clinic/refunds/{refund.json()['id']}/complete/").status_code, 400)
        second = self.client.post('/api/clinic/cashier-shifts/open/', {'opening_cash': 100000}, format='json')
        self.assertEqual(second.status_code, 201)
        completed = self.client.post(f"/api/clinic/refunds/{refund.json()['id']}/complete/", {}, format='json')
        self.assertEqual(completed.status_code, 200, completed.content)
        self.assertEqual(completed.json()['status'], Refund.COMPLETED)
        refreshed = self.client.get(f"/api/clinic/invoices/{inv['id']}/").json()
        self.assertEqual((refreshed['paid'], refreshed['balance']), (150000, 50000))
