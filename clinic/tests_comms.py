from django.core import mail
from django.utils import timezone
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
        self.assertEqual(d['counts'], {'all': 2, 'email': 1, 'sms': 1, 'chat': 0})
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


@override_settings(FIREBASE_ENABLED=False, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', SMS_BACKEND='')
class PatientChatAndBookingLogTests(APITestCase):
    def setUp(self):
        self.cskh = User.objects.create_user(username='cskh2', password='pass12345', role='consultant')
        self.cust = User.objects.create_user(username='khach9', password='pass12345', role='customer', first_name='Khách Chín', email='k9@example.com')
        self.p = Patient.objects.create(full_name='Khách Chín', phone='0912345678', email='k9@example.com', user=self.cust)
        t, _ = Token.objects.get_or_create(user=self.cskh)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')

    def test_chat_appears_in_timeline_and_counts(self):
        from core.models import Conversation, Message
        c = Conversation.objects.create(customer=self.cust, subject='Hỏi về peel da')
        Message.objects.create(conversation=c, sender=self.cust, text='Peel da có đau không?')
        Message.objects.create(conversation=c, sender=self.cskh, text='Dạ không đau ạ.')
        comms.send_sms(self.p, 'Nhắc lịch', self.cskh)
        d = self.client.get(f'/api/clinic/messages/?patient={self.p.id}').data
        self.assertEqual(d['counts'], {'email': 0, 'sms': 1, 'chat': 1, 'all': 2})
        self.assertTrue(d['has_account'])
        chat = next(r for r in d['results'] if r['channel'] == 'chat')
        self.assertEqual(chat['conversation_id'], c.id)
        self.assertEqual([m['own'] for m in chat['messages']], [True, False])
        only = self.client.get(f'/api/clinic/messages/?patient={self.p.id}&channel=chat').data['results']
        self.assertEqual(len(only), 1)

    def test_patient_without_account_has_no_chat(self):
        self.p.user = None
        self.p.save()
        d = self.client.get(f'/api/clinic/messages/?patient={self.p.id}').data
        self.assertEqual(d['counts']['chat'], 0)
        self.assertFalse(d['has_account'])

    def test_booking_email_is_logged_and_styled(self):
        from core.booking_notifications import send_booking_email
        from core.models import Booking, Category, Service
        from django.utils import timezone
        cat = Category.objects.create(name='Da')
        sv = Service.objects.create(category=cat, name='Peel da', price=500000, duration=30)
        b = Booking.objects.create(user=self.cust, appointment=timezone.now() + timezone.timedelta(days=2), status='confirmed')
        b.items.create(service=sv, price=500000)
        self.assertTrue(send_booking_email(b.id))
        m = PatientMessage.objects.get(patient=self.p, channel='email')
        self.assertIn('đặt lịch', m.subject)
        d = self.client.get(f'/api/clinic/messages/?patient={self.p.id}&channel=email').data['results'][0]
        self.assertIn('<!doctype html>', d['html_full'].lower())
        self.assertNotIn('cid:', d['html_full'])

    def test_composed_email_uses_branded_wrapper(self):
        r = self.client.post('/api/clinic/messages/send-email/', {'patient': self.p.id, 'subject': 'Xin chào', 'body_html': '<p>Nội dung</p>'}, format='json').data
        self.assertIn('#0a5964', r['html_full'])
        self.assertIn('Xin chào', r['html_full'])


@override_settings(FIREBASE_ENABLED=False, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', SMS_BACKEND='')
class ComposerFeatureTests(APITestCase):
    def setUp(self):
        self.cskh = User.objects.create_user(username='cskh3', password='pass12345', role='consultant', first_name='Lan', last_name='Nguyễn')
        self.p = Patient.objects.create(full_name='Khách Mười', phone='0911111111', email='k10@example.com')
        t, _ = Token.objects.get_or_create(user=self.cskh)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')

    def test_templates_seeded_filtered_and_custom(self):
        r = self.client.get('/api/clinic/message-templates/?channel=email').data
        self.assertGreaterEqual(len(r), 10)
        self.assertTrue(all(x['channel'] == 'email' for x in r))
        self.assertIn('confirmation', {x['category'] for x in r})
        self.assertEqual(r[0]['created_by_name'], 'Hệ thống')
        c = self.client.post('/api/clinic/message-templates/', {'channel': 'sms', 'name': 'Mẫu của tôi', 'body': 'Chào {{ten_khach}}'}, format='json')
        self.assertEqual(c.status_code, 201)
        self.assertEqual(c.data['created_by_name'], 'Lan Nguyễn')
        self.assertEqual(self.client.delete(f"/api/clinic/message-templates/{c.data['id']}/").status_code, 204)

    def test_send_with_cc_bcc_from_ics_and_followup(self):
        from core.models import Booking, Category, Service
        from clinic.models import CareTask
        sv = Service.objects.create(category=Category.objects.create(name='Da'), name='Peel', price=1, duration=30)
        b = Booking.objects.create(patient=self.p, appointment=timezone.now() + timezone.timedelta(days=1), status='confirmed')
        b.items.create(service=sv, price=1)
        att = self.client.get(f'/api/clinic/messages/attachables/?patient={self.p.id}').data
        self.assertEqual(att['bookings'][0]['id'], b.id)
        opts = self.client.get(f'/api/clinic/messages/?patient={self.p.id}').data['from_options']
        r = self.client.post('/api/clinic/messages/send-email/', {
            'patient': self.p.id, 'subject': 'Hẹn', 'body_html': '<p>Hi</p>', 'cc': ['a@example.com'], 'bcc': ['b@example.com'],
            'from_name': opts[-1]['name'], 'booking_ids': [b.id], 'follow_up': True}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        m = mail.outbox[-1]
        self.assertEqual((m.cc, m.bcc), (['a@example.com'], ['b@example.com']))
        self.assertTrue(m.from_email.startswith('Lan Nguyễn'))
        self.assertEqual(m.attachments[0][0], f'lich-hen-{b.id}.ics')
        self.assertIn('BEGIN:VEVENT', m.attachments[0][1])
        self.assertTrue(CareTask.objects.filter(patient=self.p, title__startswith='Theo dõi').exists())

    def test_bad_cc_rejected(self):
        r = self.client.post('/api/clinic/messages/send-email/', {'patient': self.p.id, 'subject': 'x', 'body_html': '<p>y</p>', 'cc': ['khong-phai-email']}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_template_tags_and_blocks_render(self):
        from clinic import comms_templates, emailkit
        from clinic.models import MessageTemplate
        comms_templates.ensure_defaults()
        t = MessageTemplate.objects.get(key='confirm')
        out = comms.wrap_email(comms.render_tags(t.body, comms.merge_values(self.p, self.cskh)), self.p, t.subject)
        self.assertIn('Khách Mười', out)
        self.assertNotIn('{{', out)
        self.assertNotIn('<dl', out)  # dl được đổi thành bảng
        self.assertIn('<table', out)


class PatientSummaryStatsTests(APITestCase):
    """Dải thống kê cuối hồ sơ khách: summary phải trả stats / finance / loyalty."""

    def setUp(self):
        from clinic.models import Invoice, InvoiceItem, Payment
        self.mgr = User.objects.create_user('mgr_sum', password='x', role='manager', email='m@example.com')
        self.p = Patient.objects.create(full_name='Khách Thống Kê', phone='0900000001')
        inv = Invoice.objects.create(patient=self.p, created_by=self.mgr)
        InvoiceItem.objects.create(invoice=inv, name='Peel', quantity=1, unit_price=1000000)
        inv.recalc()
        Payment.objects.create(invoice=inv, amount=400000, method='cash')
        inv.recalc()

    def test_manager_gets_stats_and_finance(self):
        self.client.force_authenticate(self.mgr)
        d = self.client.get(f'/api/clinic/patients/{self.p.id}/summary/').json()
        self.assertEqual(d['stats']['bookings'], 0)
        self.assertEqual(d['stats']['upcoming'], 0)
        self.assertIsNone(d['stats']['days_since_last_visit'])
        self.assertEqual(d['finance']['billed'], 1000000)
        self.assertEqual(d['finance']['paid'], 400000)
        self.assertEqual(d['finance']['outstanding'], 600000)
        self.assertEqual(d['loyalty']['tier'], 'Bronze')


class DayBoardTests(APITestCase):
    """/api/clinic/day-board/: lịch hẹn của một ngày kèm giai đoạn và thanh toán."""

    def test_stages_and_payment(self):
        from datetime import datetime, time
        from core.models import Booking
        from clinic.models import Invoice, InvoiceItem, Payment, Visit
        mgr = User.objects.create_user('mgr_db', password='x', role='manager', email='db@example.com')
        p = Patient.objects.create(full_name='Khách Bảng Ngày', phone='0900000009')
        day = timezone.localdate()
        tz = timezone.get_current_timezone()

        def mk(hour, status, visit_status=None, code='X'):
            b = Booking.objects.create(patient=p, guest_name=p.full_name, appointment=timezone.make_aware(datetime.combine(day, time(hour, 0)), tz),
                                       status=status, confirm_code=code)
            v = Visit.objects.create(patient=p, booking=b, source='appointment', status=visit_status) if visit_status else None
            return b, v
        mk(8, 'confirmed', code='D1')
        mk(9, 'checked_in', 'waiting', code='D2')
        mk(10, 'in_progress', 'in_consult', code='D3')
        b4, v4 = mk(11, 'completed', 'completed', code='D4')
        mk(12, 'cancelled', code='D5')
        inv = Invoice.objects.create(patient=p, visit=v4, created_by=mgr)
        InvoiceItem.objects.create(invoice=inv, name='Peel', quantity=1, unit_price=500000)
        inv.recalc()
        Payment.objects.create(invoice=inv, amount=500000, method='cash')
        inv.recalc()
        self.client.force_authenticate(mgr)
        d = self.client.get('/api/clinic/day-board/').json()
        self.assertEqual(d['counts'], {'scheduled': 1, 'waiting': 1, 'progress': 1, 'done': 1, 'cancelled': 1, 'no_show': 0})
        done = next(r for r in d['results'] if r['stage'] == 'done')
        self.assertEqual(done['pay'], 'paid')
        self.assertEqual(next(r for r in d['results'] if r['stage'] == 'scheduled')['pay'], 'none')
        # ngày khác: rỗng
        d2 = self.client.get('/api/clinic/day-board/?date=2001-01-01').json()
        self.assertEqual(d2['results'], [])
