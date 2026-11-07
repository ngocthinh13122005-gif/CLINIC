"""Kiểm thử Hoạt động kiểu Pabau.  Chạy:  python manage.py test clinic.tests_activities"""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import ActivityType, CareTask, Invoice, Patient

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class ActivityTests(APITestCase):
    def setUp(self):
        mk = lambda n, r: User.objects.create_user(username=n, password='pass12345', role=r, first_name=n)
        self.manager, self.doctor, self.cskh, self.nurse = mk('m1', 'manager'), mk('d1', 'doctor'), mk('c1', 'consultant'), mk('n1', 'staff')
        self.patient = Patient.objects.create(full_name='Lê Thị C', phone='0987654321', national_id='079123456789', email='c@x.vn', address='Đà Nẵng')
        self.other = Patient.objects.create(full_name='Trần Văn D', phone='0911222333', national_id='079123456780', email='d@x.vn', address='Đà Nẵng')
        self.call, _ = ActivityType.objects.get_or_create(code='call', defaults={'name': 'Cuộc gọi', 'icon': 'phone'})
        self.email, _ = ActivityType.objects.get_or_create(code='email', defaults={'name': 'Email', 'icon': 'mail'})
        self.inv = Invoice.objects.create(patient=self.patient, total=500000)
        self.inv_other = Invoice.objects.create(patient=self.other, total=100000)
        self.login(self.cskh)

    def login(self, u):
        t, _ = Token.objects.get_or_create(user=u)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')

    def body(self, **kw):
        end = timezone.now() + timedelta(days=1)
        return {'type': self.call.pk, 'title': 'Gọi hỏi thăm', 'patient': self.patient.pk, 'start_at': (end - timedelta(minutes=30)).isoformat(), 'end_at': end.isoformat(), **kw}

    def make(self, **kw):
        r = self.client.post('/api/clinic/activities/', self.body(**kw), format='json')
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def test_create_defaults_and_timeline(self):
        a = self.make(title='')
        self.assertEqual(a['title'], 'Cuộc gọi')                       # tên trống → tên loại
        self.assertEqual(a['assigned_to'], self.cskh.pk)               # mặc định người tạo
        self.assertEqual(a['state'], 'todo')
        self.assertEqual([e['kind'] for e in a['events']][:2], ['created', 'assign'])

    def test_requires_type_target_and_valid_times(self):
        url = '/api/clinic/activities/'
        self.assertEqual(self.client.post(url, self.body(type=None), format='json').status_code, 400)
        self.assertEqual(self.client.post(url, self.body(patient=None), format='json').status_code, 400)          # thiếu bệnh nhân/lead
        now = timezone.now()
        bad = self.body(start_at=(now + timedelta(days=2)).isoformat(), end_at=(now + timedelta(days=1)).isoformat())
        self.assertEqual(self.client.post(url, bad, format='json').status_code, 400)                            # hạn trước giờ bắt đầu
        far = self.body(start_at=now.isoformat(), end_at=(now + timedelta(days=40)).isoformat())
        self.assertEqual(self.client.post(url, far, format='json').status_code, 400)                            # quá 30 ngày
        self.assertEqual(self.client.post(url, self.body(assigned_to=self.nurse.pk), format='json').status_code, 400)  # điều dưỡng không được giao
        self.call.is_active = False; self.call.save()
        self.assertEqual(self.client.post(url, self.body(), format='json').status_code, 400)                    # loại đã tắt

    def test_note_links_must_belong_to_patient(self):
        ok = self.make(note=f'Hóa đơn {{{{invoice:{self.inv.pk}}}}} còn nợ')
        self.assertEqual(ok['links'][0]['url'], f'/thu-ngan?hd={self.inv.pk}')
        r = self.client.post('/api/clinic/activities/', self.body(note=f'{{{{invoice:{self.inv_other.pk}}}}}'), format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('không thuộc bệnh nhân', str(r.json()))

    def test_done_is_readonly_until_reopened_and_logged(self):
        a = self.make()
        url = f'/api/clinic/activities/{a["id"]}/'
        self.assertEqual(self.client.patch(url, {'set_state': 'working'}, format='json').json()['state'], 'working')
        done = self.client.patch(url, {'set_state': 'done'}, format='json').json()
        self.assertEqual((done['state'], done['status']), ('done', 'done'))
        self.assertEqual(self.client.patch(url, {'title': 'Sửa khi đã xong'}, format='json').status_code, 400)
        re = self.client.patch(url, {'set_state': 'stuck'}, format='json').json()
        self.assertEqual((re['state'], re['status']), ('stuck', 'pending'))
        self.assertIsNone(re['completed_at'])
        kinds = [e['kind'] for e in re['events']]
        self.assertIn('done', kinds); self.assertIn('reopen', kinds)

    def test_tabs_counts_and_overdue(self):
        now = timezone.now()
        self.make(start_at=(now - timedelta(days=2, minutes=30)).isoformat(), end_at=(now - timedelta(days=2)).isoformat())   # quá hạn
        self.make()                                                                                                        # ngày mai
        d = self.make(); self.client.post(f'/api/clinic/activities/{d["id"]}/complete/')
        r = self.client.get('/api/clinic/activities/', {'tab': 'overdue'}).json()
        self.assertEqual((r['counts']['todo'], r['counts']['overdue'], r['counts']['completed']), (2, 1, 1))
        self.assertEqual(r['count'], 1)
        self.assertTrue(r['results'][0]['overdue'])
        self.assertEqual(self.client.get('/api/clinic/activities/', {'tab': 'completed'}).json()['count'], 1)

    def test_delete_permissions(self):
        a = self.make()
        self.login(self.doctor)
        self.assertEqual(self.client.delete(f'/api/clinic/activities/{a["id"]}/').status_code, 403)     # không phải người tạo
        self.login(self.cskh)
        self.assertEqual(self.client.delete(f'/api/clinic/activities/{a["id"]}/').status_code, 204)
        auto = CareTask.objects.create(patient=self.patient, kind=CareTask.POST_CARE, auto=True, title='Gọi hỏi thăm', created_by=self.cskh)
        self.assertEqual(self.client.delete(f'/api/clinic/activities/{auto.pk}/').status_code, 403)     # việc tự tạo: chỉ quản lý
        self.login(self.manager)
        self.assertEqual(self.client.delete(f'/api/clinic/activities/{auto.pk}/').status_code, 204)

    def test_duplicate_and_bulk(self):
        a, b = self.make(), self.make()
        d = self.client.post(f'/api/clinic/activities/{a["id"]}/duplicate/').json()
        self.assertNotEqual(d['id'], a['id']); self.assertEqual(d['state'], 'todo')
        r = self.client.post('/api/clinic/activities/bulk/', {'op': 'done', 'ids': [a['id'], b['id']]}, format='json').json()
        self.assertEqual(sorted(r['ok']), sorted([a['id'], b['id']]))
        again = self.client.post('/api/clinic/activities/bulk/', {'op': 'done', 'ids': [a['id']]}, format='json').json()
        self.assertEqual(len(again['skipped']), 1)
        self.assertEqual(self.client.post('/api/clinic/activities/bulk/', {'op': 'assign', 'ids': [d['id']], 'assigned_to': self.nurse.pk}, format='json').status_code, 400)

    def test_paid_invoice_closes_auto_payment_task(self):
        t = CareTask.objects.create(patient=self.patient, kind=CareTask.PAYMENT, auto=True, title=f'Nhắc thanh toán hóa đơn {self.inv.code} — còn nợ 500.000đ')
        self.assertEqual(t.type.code, 'call')                                   # loại mặc định theo kind
        self.inv.paid, self.inv.status = 500000, Invoice.PAID; self.inv.save()
        self.client.get('/api/clinic/activities/')
        t.refresh_from_db()
        self.assertEqual(t.status, CareTask.DONE)
        link = self.client.get(f'/api/clinic/activities/{t.pk}/').json()['links'][0]
        self.assertEqual(link['url'], f'/thu-ngan?hd={self.inv.pk}')

    def test_old_care_task_still_works(self):
        t = CareTask.objects.create(patient=self.patient, kind=CareTask.REVISIT, title='Nhắc tái khám', due_date=timezone.localdate())
        self.assertIsNotNone(t.end_at)
        self.assertEqual(timezone.localtime(t.end_at).date(), t.due_date)       # due_date luôn bám end_at
        self.login(self.manager)
        self.assertEqual(self.client.get('/api/clinic/care-tasks/summary/').status_code, 200)
