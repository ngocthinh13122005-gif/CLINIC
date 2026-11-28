from datetime import date, timedelta
from io import StringIO

from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from clinic.models import MedicalRecord, Patient, Visit
from core.management.commands.seed_presentation_demo import DOCTORS, PREFIX, SUBJECT, at
from core.models import Booking, BookingItem, Category, Conversation, Message, Service, Staff


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', FIREBASE_ENABLED=False)
class PresentationDemoTests(TestCase):
    def setUp(self):
        self.customer = User.objects.create_user(username='demoKhachHang', role='customer', password='customer-old')
        self.consultant = User.objects.create_user(username='demoCSKH', role='consultant')
        self.doctor = User.objects.create_user(username='demoBacSi', role='doctor', password='doctor-old')
        self.start = date(2026, 11, 20)

    def seed(self, **kwargs):
        call_command('seed_presentation_demo', start=self.start, stdout=StringIO(), **kwargs)

    def test_three_doctors_cover_every_day_and_no_overlaps(self):
        self.seed()
        doctors = Staff.objects.filter(user__username__in=[row[0] for row in DOCTORS])
        self.assertEqual(doctors.count(), 3)
        for offset in range(10):
            day = self.start + timedelta(days=offset)
            for staff in doctors:
                bookings = Booking.objects.filter(
                    staff=staff, appointment__date=day, idempotency_key__startswith=PREFIX,
                ).order_by('appointment').prefetch_related('items__service')
                self.assertEqual(bookings.count(), 4)
                self.assertTrue(staff.roster_shifts.get(date=day).is_on_duty)
                previous = None
                for booking in bookings:
                    self.assertTrue(booking.items.exists())
                    self.assertEqual(booking.total, sum(booking.items.values_list('price', flat=True)))
                    if previous:
                        self.assertLessEqual(previous.end_time, booking.appointment)
                    previous = booking
            for patient in Patient.objects.all():
                bookings = list(Booking.objects.filter(patient=patient, appointment__date=day).order_by('appointment'))
                for previous, current in zip(bookings, bookings[1:]):
                    self.assertLessEqual(previous.end_time, current.appointment)
        self.assertEqual(Booking.objects.filter(idempotency_key__startswith=PREFIX).count(), 122)

    def test_customer_record_chat_and_email_are_connected_without_sending(self):
        self.seed(customer_email='demo@example.com')
        patient = Patient.objects.get(user=self.customer)
        self.customer.refresh_from_db()
        self.assertEqual(patient.email, 'demo@example.com')
        self.assertEqual(self.customer.email, patient.email)
        self.assertEqual(patient.visits.filter(status=Visit.COMPLETED).count(), 2)
        self.assertEqual(patient.records.filter(status=MedicalRecord.SIGNED).count(), 2)
        for record in patient.records.all():
            self.assertEqual(record.signature_hash, record.compute_hash(record.signed_by_id, record.signed_at))
        client = APIClient()
        client.force_authenticate(self.consultant)
        response = client.get('/api/clinic/messages/', {'patient': patient.pk, 'channel': 'chat'})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['has_account'])
        self.assertTrue(response.data['contact_consent'])
        self.assertEqual(response.data['patient']['email'], 'demo@example.com')
        chat = response.data['results'][0]
        self.assertEqual(chat['subject'], SUBJECT)
        self.assertEqual(chat['message_count'], 5)
        self.assertEqual([m['own'] for m in chat['messages']], [True, False, True, False, True])
        self.assertEqual(len(mail.outbox), 0)
        self.assertTrue(patient.bookings.filter(follow_up_visit__patient=patient, user=self.customer).exists())

    def test_rerun_preserves_passwords_existing_bookings_and_teacher_edits(self):
        category = Category.objects.create(name='Khám')
        service = Service.objects.create(category=category, name='Khám da liễu tổng quát', price=200000, duration=30)
        staff = Staff.objects.create(user=self.doctor, name='Bác sĩ Demo', position='Bác sĩ')
        old = Booking.objects.create(staff=staff, appointment=at(self.start, 8, 30), status=Booking.CONFIRMED)
        BookingItem.objects.create(booking=old, service=service, price=service.price)
        self.seed(customer_email='demo@example.com')
        edited = Booking.objects.filter(idempotency_key__startswith=PREFIX, status=Booking.PENDING).first()
        edited.status = Booking.CANCELLED
        edited.note = 'Thầy đã thử hủy lịch'
        edited.save()
        counts = (Booking.objects.count(), Patient.objects.count(), Message.objects.count(), Conversation.objects.count())
        self.seed()
        self.assertEqual(counts, (Booking.objects.count(), Patient.objects.count(), Message.objects.count(), Conversation.objects.count()))
        edited.refresh_from_db()
        old.refresh_from_db()
        self.assertEqual(edited.status, Booking.CANCELLED)
        self.assertEqual(edited.note, 'Thầy đã thử hủy lịch')
        self.assertEqual(old.appointment, at(self.start, 8, 30))
        self.customer.refresh_from_db()
        self.doctor.refresh_from_db()
        self.assertTrue(self.customer.check_password('customer-old'))
        self.assertTrue(self.doctor.check_password('doctor-old'))
        for username in ('demoBacSi2', 'demoBacSi3'):
            self.assertTrue(User.objects.get(username=username).check_password('Demo@123'))

    def test_failure_rolls_back_instead_of_overwriting_an_existing_user(self):
        User.objects.create_user(username='demoBacSi3', role='customer')
        with self.assertRaises(CommandError):
            self.seed()
        self.assertFalse(User.objects.filter(username='demoBacSi2').exists())
        self.assertFalse(Booking.objects.exists())

    def test_staff_api_refreshes_after_adding_demo_doctors(self):
        manager = User.objects.create_user(username='demoQuanLy', role='manager')
        client = APIClient()
        client.force_authenticate(manager)
        response = client.get('/api/staff/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 0)
        self.seed()
        for _ in range(3):
            response = client.get('/api/staff/')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.data), 3)
