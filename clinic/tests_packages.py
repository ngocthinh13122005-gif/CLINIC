from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import PackageTemplate, Patient, TreatmentPlan

User = get_user_model()


def login(client, user):
    t, _ = Token.objects.get_or_create(user=user)
    client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class PackageFlowTests(APITestCase):
    def setUp(self):
        self.mgr = User.objects.create_user(username='m1', password='pass12345', role='manager', first_name='m1')
        self.cskh = User.objects.create_user(username='c1', password='pass12345', role='consultant', first_name='c1')
        self.patient = Patient.objects.create(full_name='Lê C', phone='0911111111')
        self.other = Patient.objects.create(full_name='Phạm D', phone='0922222222')
        self.tpl = PackageTemplate.objects.create(name='Trị mụn 5 buổi', total_sessions=5, interval_days=7, validity_months=6, price=2500000)

    def sell(self, **extra):
        body = {'patient': self.patient.id, 'items': [{'kind': 'package', 'package_template': self.tpl.id, 'name': self.tpl.name, 'quantity': 1, 'unit_price': 2500000}], **extra}
        return self.client.post('/api/clinic/invoices/', body, format='json')

    def test_sale_creates_active_plan(self):
        login(self.client, self.cskh)
        r = self.sell(payments=[{'amount': 2500000, 'method': 'transfer'}])
        self.assertEqual(r.status_code, 201, r.content)
        plan = TreatmentPlan.objects.get(patient=self.patient)
        self.assertEqual((plan.status, plan.total_sessions, plan.sessions.count(), plan.price), ('active', 5, 5, 2500000))
        self.assertTrue(plan.code.startswith('PK'))
        self.assertIsNotNone(plan.expires_at)

    def test_walk_in_cannot_buy_package(self):
        login(self.client, self.cskh)
        r = self.client.post('/api/clinic/invoices/', {'walk_in': True, 'items': [{'kind': 'package', 'package_template': self.tpl.id, 'quantity': 1, 'unit_price': 1}]}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertFalse(TreatmentPlan.objects.exists())

    def test_custom_package(self):
        login(self.client, self.cskh)
        r = self.client.post('/api/clinic/invoices/', {'patient': self.patient.id, 'items': [{'kind': 'package', 'name': 'Gói riêng', 'quantity': 1, 'unit_price': 900000,
                             'package': {'total_sessions': 3, 'interval_days': 10, 'validity_months': 0}}]}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        plan = TreatmentPlan.objects.get()
        self.assertEqual((plan.total_sessions, plan.expires_at), (3, None))

    def test_extend_expire_transfer_void_session(self):
        login(self.client, self.cskh)
        self.sell()
        plan = TreatmentPlan.objects.get()
        old = plan.expires_at
        r = self.client.post(f'/api/clinic/plans/{plan.id}/extend/', {'months': 3}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        plan.refresh_from_db()
        self.assertGreater(plan.expires_at, old)
        # CSKH không được cho hết hạn / chuyển gói
        self.assertEqual(self.client.post(f'/api/clinic/plans/{plan.id}/expire/').status_code, 403)
        login(self.client, self.mgr)
        r = self.client.post(f'/api/clinic/plans/{plan.id}/transfer/', {'patient': self.other.id}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        plan.refresh_from_db()
        self.assertEqual(plan.patient_id, self.other.id)
        r = self.client.post(f'/api/clinic/plans/{plan.id}/expire/')
        self.assertEqual(r.json()['display_status'], 'expired')

    def test_overdue_plan_shows_expired_and_filters(self):
        login(self.client, self.cskh)
        self.sell()
        plan = TreatmentPlan.objects.get()
        plan.expires_at = timezone.localdate() - timedelta(days=1)
        plan.save()
        self.assertEqual(self.client.get(f'/api/clinic/plans/{plan.id}/').json()['display_status'], 'expired')
        rows = self.client.get('/api/clinic/plans/', {'status': 'active,draft'}).json()
        self.assertEqual(len(rows if isinstance(rows, list) else rows['results']), 0)
        rows = self.client.get('/api/clinic/plans/', {'status': 'expired'}).json()
        self.assertEqual(len(rows if isinstance(rows, list) else rows['results']), 1)

    def test_notes(self):
        login(self.client, self.cskh)
        r = self.client.post(f'/api/clinic/patients/{self.patient.id}/notes/', {'text': 'Khách dị ứng cồn'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(r.json()['client']), 1)
