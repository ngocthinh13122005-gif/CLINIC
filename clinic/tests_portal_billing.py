from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import ConsentForm, Invoice, InvoiceItem, Patient, Payment

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class PortalBillingFormsTests(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user(username='pb-me', password='pass12345', role='customer')
        self.other = User.objects.create_user(username='pb-other', password='pass12345', role='customer')
        self.doctor = User.objects.create_user(username='pb-doc', password='pass12345', role='doctor')
        self.p_me = Patient.objects.create(full_name='Tôi', phone='0900000011', user=self.me)
        self.p_other = Patient.objects.create(full_name='Người khác', phone='0900000012', user=self.other)
        self.due = Invoice.objects.create(patient=self.p_me, subtotal=500000, total=500000, paid=200000, status='partial')
        InvoiceItem.objects.create(invoice=self.due, name='Peel da', quantity=1, unit_price=500000)
        Payment.objects.create(invoice=self.due, amount=200000, method='cash')
        self.paid = Invoice.objects.create(patient=self.p_me, subtotal=100000, total=100000, paid=100000, status='paid')
        Invoice.objects.create(patient=self.p_other, subtotal=999000, total=999000, status='unpaid')
        ConsentForm.objects.create(patient=self.p_me, title='Đồng ý điều trị', body='x', status='signed')
        ConsentForm.objects.create(patient=self.p_other, title='Của người khác', body='x')

    def auth(self, user):
        token, _ = Token.objects.get_or_create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')

    def test_billing_only_own_invoices(self):
        self.auth(self.me)
        d = self.client.get('/api/clinic/my-portal/billing/').json()
        self.assertEqual(d['outstanding'], 300000)
        self.assertEqual(d['due_count'], 1)
        self.assertEqual([i['id'] for i in d['paid']], [self.paid.pk])
        self.assertEqual(len(d['transactions']), 1)
        self.assertNotIn('999000', str(d))

    def test_forms_only_own(self):
        self.auth(self.me)
        d = self.client.get('/api/clinic/my-portal/forms/').json()
        self.assertEqual([f['title'] for f in d['forms']], ['Đồng ý điều trị'])

    def test_staff_and_anonymous_blocked_unlinked_empty(self):
        self.auth(self.doctor)
        self.assertEqual(self.client.get('/api/clinic/my-portal/billing/').status_code, 403)
        self.assertEqual(self.client.get('/api/clinic/my-portal/forms/').status_code, 403)
        unlinked = User.objects.create_user(username='pb-un', password='pass12345', role='customer')
        self.auth(unlinked)
        self.assertEqual(self.client.get('/api/clinic/my-portal/billing/').json()['due'], [])
        self.client.credentials()
        self.assertEqual(self.client.get('/api/clinic/my-portal/billing/').status_code, 401)

    def test_anonymous_forms_are_blocked(self):
        self.assertEqual(self.client.get('/api/clinic/my-portal/forms/').status_code, 401)

    def test_every_non_customer_role_is_blocked(self):
        for role in ['doctor', 'staff', 'consultant', 'manager', 'sysadmin']:
            user = User.objects.create_user(username='blocked-'+role, role=role)
            self.auth(user)
            for endpoint in ['billing', 'forms']:
                with self.subTest(role=role, endpoint=endpoint):
                    self.assertEqual(self.client.get(f'/api/clinic/my-portal/{endpoint}/').status_code, 403)

    def test_foreign_identifiers_cannot_switch_billing_owner(self):
        self.auth(self.me)
        d = self.client.get('/api/clinic/my-portal/billing/', {'patient': self.p_other.pk, 'user_id': self.other.pk}).json()
        self.assertEqual(d['outstanding'], 300000)
        self.assertNotIn('999000', str(d))

    def test_foreign_identifiers_cannot_switch_forms_owner(self):
        self.auth(self.me)
        d = self.client.get('/api/clinic/my-portal/forms/', {'patient': self.p_other.pk}).json()
        self.assertEqual([f['title'] for f in d['forms']], ['Đồng ý điều trị'])

    def test_void_invoices_are_not_collectible(self):
        void = Invoice.objects.create(patient=self.p_me, code='VOID-TEST', status='void', total=700000)
        self.auth(self.me)
        d = self.client.get('/api/clinic/my-portal/billing/').json()
        self.assertNotIn(void.pk, [i['id'] for i in d['due'] + d['paid']])
        self.assertEqual(d['outstanding'], 300000)

    def test_revoked_forms_are_hidden(self):
        ConsentForm.objects.create(patient=self.p_me, title='REVOKED-TEST', body='Private withdrawn', status='revoked')
        self.auth(self.me)
        self.assertNotIn('REVOKED-TEST', str(self.client.get('/api/clinic/my-portal/forms/').json()))

    def test_own_form_content_without_private_signature_metadata(self):
        form = ConsentForm.objects.filter(patient=self.p_me).get()
        form.body = 'Nội dung đồng ý riêng của bệnh nhân'
        form.signature = 'PRIVATE_SIGNATURE'
        form.signed_ip = '127.0.0.2'
        form.save()
        self.auth(self.me)
        row = self.client.get('/api/clinic/my-portal/forms/').json()['forms'][0]
        self.assertEqual(row['body'], form.body)
        self.assertNotIn('signature', row)
        self.assertNotIn('signed_ip', row)
        self.assertNotIn('witness', row)

    def test_sensitive_responses_are_not_cached(self):
        self.auth(self.me)
        for endpoint in ['billing', 'forms']:
            res = self.client.get(f'/api/clinic/my-portal/{endpoint}/')
            self.assertIn('no-store', res['Cache-Control'])
            self.assertIn('private', res['Cache-Control'])
            self.assertIn('Authorization', res['Vary'])

    def test_customer_cannot_modify_portal_financial_or_consent_data(self):
        self.auth(self.me)
        for endpoint in ['billing', 'forms']:
            for method in ['post', 'patch', 'delete']:
                with self.subTest(endpoint=endpoint, method=method):
                    self.assertEqual(getattr(self.client, method)(f'/api/clinic/my-portal/{endpoint}/', {'paid': 0}, format='json').status_code, 405)
        self.due.refresh_from_db()
        self.assertEqual(self.due.paid, 200000)

    def test_reading_portal_does_not_change_business_records(self):
        before = [list(model.objects.order_by('pk').values()) for model in [Invoice, InvoiceItem, Payment, ConsentForm]]
        self.auth(self.me)
        for endpoint in ['billing', 'forms']:
            self.assertEqual(self.client.get(f'/api/clinic/my-portal/{endpoint}/').status_code, 200)
        after = [list(model.objects.order_by('pk').values()) for model in [Invoice, InvoiceItem, Payment, ConsentForm]]
        self.assertEqual(before, after)

    def test_unlinked_customer_forms_and_billing_are_empty(self):
        user = User.objects.create_user(username='no-profile', role='customer')
        self.auth(user)
        self.assertEqual(self.client.get('/api/clinic/my-portal/forms/').json(), {'patient_linked': False, 'forms': []})
        d = self.client.get('/api/clinic/my-portal/billing/').json()
        self.assertFalse(d['patient_linked'])
        self.assertEqual(d['outstanding'], 0)
        self.assertEqual(d['transactions'], [])

    def test_customer_profile_update_preserves_role_and_other_accounts(self):
        self.auth(self.me)
        response = self.client.patch('/api/auth/me/', {'full_name': 'Hồ sơ UAT', 'email': 'uat@example.com', 'role': 'sysadmin'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.me.refresh_from_db(); self.other.refresh_from_db()
        self.assertEqual(self.me.role, 'customer')
        self.assertEqual(self.me.email, 'uat@example.com')
        self.assertEqual(self.other.email, '')

    def test_customer_profile_rejects_invalid_email(self):
        self.auth(self.me)
        response = self.client.patch('/api/auth/me/', {'email': 'not-an-email'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.me.refresh_from_db()
        self.assertEqual(self.me.email, '')
