from datetime import date, time, timedelta
from io import StringIO

from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from clinic import models as cm
from core import models as m
from core.management.commands.compact_demo import PREFIX, at
from core.management.commands.seed_minimal_demo import PATIENTS


@override_settings(FIREBASE_ENABLED=False, EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class CompactDemoTests(TestCase):
    def setUp(self):
        self.start = date(2030, 1, 7)
        self.customer = User.objects.create_user(username='demoKhachHang', role='customer', email='demo@example.test')
        for username, role in [('demoCSKH', 'consultant'), ('demoNhanVien', 'staff'),
                               ('demoQuanLy', 'manager'), ('demoAdmin', 'sysadmin')]:
            User.objects.create_user(username=username, role=role)
        category = m.Category.objects.create(name='Demo')
        self.service = m.Service.objects.create(category=category, name='Khám mẫu', price=200000, duration=30)
        cm.Medicine.objects.create(name='Thuốc mẫu', price=100000)
        cm.Room.objects.create(name='Phòng mẫu')
        for username in ('demoBacSi', 'demoBacSi2', 'demoBacSi3'):
            user = User.objects.create_user(username=username, role='doctor')
            staff = m.Staff.objects.create(user=user, name=username)
            staff.services.add(self.service)
            for weekday in range(5):
                m.WorkingHours.objects.create(staff=staff, weekday=weekday, start_time=time(8), end_time=time(17))
        self.patient = cm.Patient.objects.create(user=self.customer, full_name='Khách demo', phone='0901999999')
        for _, name, gender, year, phone in PATIENTS:
            cm.Patient.objects.create(full_name=name, phone=phone, gender=gender)
        for index in range(20):
            m.Booking.objects.create(patient=self.patient, appointment=at(self.start - timedelta(days=10), 9),
                idempotency_key=f'akina-presentation-v1-old-{index}')
        self.real_user = User.objects.create_user(username='real-customer', role='customer')
        self.real_patient = cm.Patient.objects.create(user=self.real_user, full_name='Existing customer', phone='0987654321')
        self.real_booking = m.Booking.objects.create(patient=self.real_patient, appointment=at(self.start, 15))
        self.facebook = m.Conversation.objects.create(customer=self.real_user, channel='facebook', subject='Existing chat')
        self.message = m.Message.objects.create(conversation=self.facebook, sender=self.real_user, text='Keep this message')

    def run_command(self, apply=True):
        call_command('compact_demo', start=self.start, apply=apply, stdout=StringIO())

    def test_dry_run_rolls_back_everything(self):
        users = list(User.objects.order_by('pk').values())
        ids = list(m.Booking.objects.order_by('pk').values_list('pk', flat=True))
        self.run_command(apply=False)
        self.assertEqual(ids, list(m.Booking.objects.order_by('pk').values_list('pk', flat=True)))
        self.assertEqual(users, list(User.objects.order_by('pk').values()))
        self.assertEqual(cm.Invoice.objects.count(), 0)
        self.assertEqual(cm.Patient.objects.count(), 7)

    def test_linked_small_dataset_preserves_users_and_unrelated_data(self):
        users = list(User.objects.order_by('pk').values())
        self.run_command()
        self.assertEqual(users, list(User.objects.order_by('pk').values()))
        self.assertTrue(m.Booking.objects.filter(pk=self.real_booking.pk, patient=self.real_patient).exists())
        self.assertTrue(m.Message.objects.filter(pk=self.message.pk, text='Keep this message').exists())
        self.assertEqual(cm.Patient.objects.count(), 4)  # 3 demo + unrelated
        self.assertEqual(m.Booking.objects.filter(idempotency_key__startswith=PREFIX).count(), 8)
        future = m.Booking.objects.filter(idempotency_key__startswith=PREFIX, appointment__gte=at(self.start, 0))
        self.assertEqual(future.count(), 5)
        self.assertEqual(future.values('staff_id').distinct().count(), 3)
        self.assertEqual(cm.Prescription.objects.filter(patient=self.patient).count(), 1)
        plan = cm.TreatmentPlan.objects.get(patient=self.patient)
        self.assertEqual(plan.done_sessions, 1)
        self.assertEqual(plan.sessions.filter(booking__isnull=False).count(), 2)
        invoice = cm.Invoice.objects.get(patient=self.patient)
        self.assertEqual((invoice.total, invoice.paid, invoice.balance, invoice.status), (1200000, 400000, 800000, 'partial'))
        for record in cm.MedicalRecord.objects.all():
            self.assertEqual(record.signature_hash, record.compute_hash(record.signed_by_id, record.signed_at))
        self.assertEqual(len(mail.outbox), 0)

    def test_rerun_keeps_small_counts_and_customer_email(self):
        self.run_command()
        before = (m.Booking.objects.count(), cm.Patient.objects.count(), cm.CareTask.objects.count(),
                  m.Message.objects.count(), cm.Invoice.objects.count(), m.Attendance.objects.count())
        self.run_command()
        self.assertEqual(before, (m.Booking.objects.count(), cm.Patient.objects.count(), cm.CareTask.objects.count(),
                                 m.Message.objects.count(), cm.Invoice.objects.count(), m.Attendance.objects.count()))
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.email, 'demo@example.test')

    def test_customer_portal_contains_records_plan_and_prescription(self):
        self.run_command()
        client = APIClient()
        client.force_authenticate(self.customer)
        response = client.get('/api/clinic/my-portal/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['patient_linked'])
        for key in ('visits', 'care_instructions', 'plans', 'prescriptions'):
            self.assertTrue(response.data[key], key)

    def test_foreign_patient_with_demo_marker_aborts_without_deletion(self):
        m.Booking.objects.filter(pk=self.real_booking.pk).update(idempotency_key='akina-presentation-v1-collision')
        before = m.Booking.objects.count()
        with self.assertRaises(CommandError):
            self.run_command()
        self.assertEqual(m.Booking.objects.count(), before)
        self.assertEqual(cm.Invoice.objects.count(), 0)

    def test_real_conflicting_booking_rolls_back_all_changes(self):
        doctor = m.Staff.objects.get(user__username='demoBacSi')
        m.Booking.objects.filter(pk=self.real_booking.pk).update(staff=doctor, appointment=at(self.start, 9))
        before = m.Booking.objects.count()
        with self.assertRaises(CommandError):
            self.run_command()
        self.assertEqual(m.Booking.objects.count(), before)
        self.assertEqual(cm.Invoice.objects.count(), 0)
