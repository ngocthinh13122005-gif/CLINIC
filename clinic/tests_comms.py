from django.core import mail
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from accounts.models import User
from clinic import comms
from clinic.models import Patient, PatientMessage


@override_settings(FIREBASE_ENABLED=False, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', SMS_BACKEND='')
class PatientCommsTests(APITestCase):
    def setUp(self):
        mk = lambda n, r: User.objects.create_user(username=n, password='pass12345', role=r, first_name=n)
        self.cskh, self.manager, self.nurse = mk('cskh', 'consultant'), mk('mgr', 'manager'), mk('nurse', 'staff')
        self.p = Patient.objects.create(full_name='Khách Thử', phone='0901 234 567', email='khach@example.com')

    def auth(self, u):
        t, _ = Token.objects.get_or_create(user=u)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')

    def test_send_email_records_and_sanitizes(self):
        self.auth(self.cskh)
        r = self.client.post('/api/clinic/messages/send-email/', {
            'patient': self.p.id, 'subject': 'Chào {{ten_khach}}',
            'body_html': '<p>Xin chào <b>{{ten_khach}}</b></p><script>alert(1)</script><a href="javascript:x">bad</a>'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['status'], 'sent')
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['khach@example.com'])
        self.assertEqual(mail.outbox[0].subject, 'Chào Khách Thử')
        self.assertNotIn('script', r.data['body_html'])
        self.assertNotIn('javascript', r.data['body_html'])

    def test_send_email_requires_address(self):
        self.auth(self.cskh)
        self.p.email = ''
        self.p.save()
        r = self.client.post('/api/clinic/messages/send-email/', {'patient': self.p.id, 'subject': 'a', 'body_html': '<p>b</p>'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_sms_simulated_without_provider_and_normalizes_phone(self):
        self.auth(self.cskh)
        r = self.client.post('/api/clinic/messages/send-sms/', {'patient': self.p.id, 'body': 'Chào {{ten_khach}}'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['status'], 'simulated')
        self.assertEqual(r.data['to_address'], '0901234567')
        self.assertEqual(r.data['body'], 'Chào Khách Thử')

    def test_list_counts_filter_and_resend_delete(self):
        self.auth(self.cskh)
        self.client.post('/api/clinic/messages/send-email/', {'patient': self.p.id, 'subject': 's', 'body_html': '<p>x</p>'}, format='json')
        sms = self.client.post('/api/clinic/messages/send-sms/', {'patient': self.p.id, 'body': 'hi'}, format='json').data
        d = self.client.get(f'/api/clinic/messages/?patient={self.p.id}').data
        self.assertEqual(d['counts'], {'all': 2, 'email': 1, 'sms': 1})
        self.assertEqual(len(self.client.get(f'/api/clinic/messages/?patient={self.p.id}&channel=sms').data['results']), 1)
        self.assertEqual(self.client.post(f"/api/clinic/messages/{sms['id']}/resend/").status_code, 201)
        self.assertEqual(self.client.delete(f"/api/clinic/messages/{sms['id']}/").status_code, 403)  # CSKH không được xóa
        self.auth(self.manager)
        self.assertEqual(self.client.delete(f"/api/clinic/messages/{sms['id']}/").status_code, 204)
        self.assertEqual(self.client.get(f'/api/clinic/messages/?patient={self.p.id}').data['counts']['sms'], 1)

    def test_nurse_has_no_access(self):
        self.auth(self.nurse)
        self.assertEqual(self.client.get(f'/api/clinic/messages/?patient={self.p.id}').status_code, 403)
        self.assertEqual(self.client.post('/api/clinic/messages/send-sms/', {'patient': self.p.id, 'body': 'x'}, format='json').status_code, 403)

    def test_helpers(self):
        self.assertEqual(comms.normalize_phone('+84 778 546 239'), '0778546239')
        with self.assertRaises(ValueError):
            comms.normalize_phone('123')
        self.assertEqual(comms.sms_segments('a' * 160), 1)
        self.assertEqual(comms.sms_segments('a' * 161), 2)
        self.assertEqual(comms.sms_segments('Chào bạn'), 1)
        self.assertEqual(comms.sms_segments('ạ' * 71), 2)
        self.assertEqual(PatientMessage.objects.count(), 0)
