from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from clinic.models import ConsentForm, Invoice, Patient, Visit
from core.models import Booking, ClinicSettingValue, Staff

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True,
                   CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class CalendarConfirmationTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.customer = User.objects.create_user(username='cus', password='x12345678', role='customer')
        self.consultant = User.objects.create_user(username='con', password='x12345678', role='consultant')
        self.booking = Booking.objects.create(
            user=self.customer, guest_name='Khách A', guest_phone='0900000001',
            appointment=timezone.now() + timedelta(days=2),
            appointment_type=Booking.APPOINTMENT_TYPE_CONSULT,
        )

    def test_pending_booking_listed_for_staff_and_filterable(self):
        self.client.force_authenticate(self.consultant)
        rows = self.client.get('/api/bookings/?status=pending').json()
        ids = [r['id'] for r in rows] if isinstance(rows, list) else [r['id'] for r in rows['results']]
        self.assertIn(self.booking.pk, ids)

    def test_customer_cannot_confirm_or_read_requests(self):
        self.client.force_authenticate(self.customer)
        self.assertEqual(self.client.post(f'/api/bookings/{self.booking.pk}/confirm/').status_code, 403)
        self.assertEqual(self.client.get(f'/api/bookings/{self.booking.pk}/requests/').status_code, 403)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.PENDING)

    def test_staff_confirm_updates_both_fields_and_requests_payload_is_real(self):
        self.client.force_authenticate(self.consultant)
        r = self.client.get(f'/api/bookings/{self.booking.pk}/requests/').json()
        self.assertEqual(r['forms'], [])
        self.assertEqual(r['invoices'], [])
        self.assertFalse(r['has_visit'])
        self.assertEqual(r['confirmation']['status'], 'pending')
        resp = self.client.post(f'/api/bookings/{self.booking.pk}/confirm/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, Booking.CONFIRMED)
        self.assertEqual(self.booking.confirm_state, Booking.CONFIRM_STATE_CONFIRMED)
        r = self.client.get(f'/api/bookings/{self.booking.pk}/requests/').json()
        self.assertEqual(r['confirmation']['confirm_state'], 'confirmed')
        self.assertTrue(any(e['event'] == 'confirmed' for e in r['confirmation']['events']))

    def linked_documents(self):
        patient = Patient.objects.create(full_name='Khách A', phone='0900000001', user=self.customer)
        self.booking.patient = patient
        self.booking.save(update_fields=['patient'])
        visit = Visit.objects.create(patient=patient, booking=self.booking)
        form = ConsentForm.objects.create(patient=patient, visit=visit, title='Cam kết thật', body='Nội dung cam kết')
        invoice = Invoice.objects.create(patient=patient, visit=visit, total=350000, paid=100000, status=Invoice.PARTIAL)
        return patient, visit, form, invoice

    def test_requests_only_include_documents_from_this_visit(self):
        patient, visit, form, invoice = self.linked_documents()
        another = Visit.objects.create(patient=patient)
        ConsentForm.objects.create(patient=patient, visit=another, title='Cam kết khác', body='Không thuộc lịch này')
        Invoice.objects.create(patient=patient, visit=another)
        self.client.force_authenticate(self.consultant)
        response = self.client.get(f'/api/bookings/{self.booking.pk}/requests/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row['id'] for row in response.data['forms']], [form.pk])
        self.assertEqual([row['id'] for row in response.data['invoices']], [invoice.pk])
        self.assertEqual(response.data['invoices'][0]['balance'], invoice.balance)
        self.assertTrue(response.data['has_visit'])

    def test_requests_preserve_all_six_role_permissions(self):
        self.linked_documents()
        users = {'customer': self.customer, 'consultant': self.consultant}
        for role in ('manager', 'doctor', 'staff', 'sysadmin'):
            users[role] = User.objects.create(username=f'test-{role}', role=role)
        for role, user in users.items():
            with self.subTest(role=role):
                if role in {'doctor', 'staff'}:
                    self.booking.staff = Staff.objects.create(user=user, name=role, position=role)
                    self.booking.save(update_fields=['staff'])
                self.client.force_authenticate(user)
                response = self.client.get(f'/api/bookings/{self.booking.pk}/requests/')
                if role == 'customer':
                    self.assertEqual(response.status_code, 403)
                    continue
                self.assertEqual(response.status_code, 200, response.data)
                allowed = role in {'manager', 'doctor', 'consultant'}
                self.assertEqual(response.data['can_view_forms'], allowed)
                self.assertEqual(response.data['can_view_invoices'], allowed)
                self.assertEqual(len(response.data['forms']), int(allowed))
                self.assertEqual(len(response.data['invoices']), int(allowed))

    def test_doctor_cannot_read_another_doctors_requests(self):
        doctor = User.objects.create(username='other-doctor', role='doctor')
        Staff.objects.create(user=doctor, name='Bác sĩ khác', position='Bác sĩ')
        self.client.force_authenticate(doctor)
        self.assertEqual(self.client.get(f'/api/bookings/{self.booking.pk}/requests/').status_code, 404)

    def test_clinic_billing_restriction_also_applies_to_requests(self):
        self.linked_documents()
        ClinicSettingValue.objects.create(scope='clinic', scope_key='default', key='access.restricted_actions',
                                          value=['consultant:billing:view'])
        self.client.force_authenticate(self.consultant)
        response = self.client.get(f'/api/bookings/{self.booking.pk}/requests/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['can_view_forms'])
        self.assertFalse(response.data['can_view_invoices'])
        self.assertEqual(response.data['invoices'], [])

    def test_clinic_booking_restriction_blocks_requests(self):
        ClinicSettingValue.objects.create(scope='clinic', scope_key='default', key='access.restricted_actions',
                                          value=['consultant:booking:view'])
        self.client.force_authenticate(self.consultant)
        self.assertEqual(self.client.get(f'/api/bookings/{self.booking.pk}/requests/').status_code, 403)

    def test_legacy_confirmation_representation_and_read_only_requests(self):
        self.booking.status = Booking.CONFIRMED
        self.booking.save(update_fields=['status'])
        self.client.force_authenticate(self.consultant)
        before = (Booking.objects.count(), self.booking.history.count())
        response = self.client.get(f'/api/bookings/{self.booking.pk}/requests/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['confirmation']['confirm_state'], Booking.CONFIRM_STATE_CONFIRMED)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.confirm_state, Booking.CONFIRM_STATE_UNCONFIRMED)
        self.assertEqual(before, (Booking.objects.count(), self.booking.history.count()))
        self.assertEqual(self.client.post(f'/api/bookings/{self.booking.pk}/requests/').status_code, 405)

    def test_unauthenticated_requests_are_rejected(self):
        self.assertEqual(self.client.get(f'/api/bookings/{self.booking.pk}/requests/').status_code, 401)
