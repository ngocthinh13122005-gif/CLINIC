"""Regression coverage for the product defects recorded in the final QA report."""
import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient, APITestCase

from clinic.models import Patient, TreatmentPlan, TreatmentSession
from core.models import Booking, Category, Conversation, ConversationEvent, InternalNote, Service, Staff

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True,
                   EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
class FinalRegressionTests(APITestCase):
    def setUp(self):
        self.manager = User.objects.create_user(username='qa-manager', role='manager')
        self.doctor = User.objects.create_user(username='qa-doctor', role='doctor', password='Original@123')
        self.customer = User.objects.create_user(username='qa-customer', role='customer')
        self.consultant = User.objects.create_user(username='qa-consultant', role='consultant')
        self.staff = Staff.objects.create(user=self.doctor, name='QA Doctor')
        self.patient = Patient.objects.create(user=self.customer, full_name='QA Patient', phone='0900000001')
        category = Category.objects.create(name='QA')
        self.service = Service.objects.create(category=category, name='QA service', price=200000, duration=30)
        self.plan = TreatmentPlan.objects.create(patient=self.patient, doctor=self.doctor,
            service=self.service, title='QA plan', total_sessions=1, status=TreatmentPlan.ACTIVE)
        self.session = TreatmentSession.objects.create(plan=self.plan, number=1)

    def test_tc041_deactivate_staff_blocks_login_and_old_token_then_unlocks(self):
        token = Token.objects.create(user=self.doctor)
        self.client.force_authenticate(self.manager)
        res = self.client.patch(f'/api/staff/{self.staff.pk}/', {'is_active': False}, format='json')
        self.assertEqual(res.status_code, 200, res.data)
        self.doctor.refresh_from_db()
        self.assertFalse(self.doctor.is_active)
        self.assertFalse(Token.objects.filter(pk=token.pk).exists())
        anon = APIClient()
        self.assertEqual(anon.post('/api/auth/login/',
            {'username': self.doctor.username, 'password': 'Original@123'}, format='json').status_code, 400)
        anon.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')
        self.assertEqual(anon.get('/api/auth/me/').status_code, 401)
        self.assertEqual(self.client.patch(f'/api/staff/{self.staff.pk}/',
            {'is_active': True}, format='json').status_code, 200)
        anon.credentials()
        self.assertEqual(anon.post('/api/auth/login/',
            {'username': self.doctor.username, 'password': 'Original@123'}, format='json').status_code, 200)

    def test_tc043_invalid_email_rejected_without_creating_account_or_token(self):
        res = self.client.post('/api/auth/register/', {'username': 'invalid-email-user',
            'password': 'Password@123', 'email': 'not-an-email', 'role': 'sysadmin'}, format='json')
        self.assertEqual(res.status_code, 400, res.data)
        self.assertFalse(User.objects.filter(username='invalid-email-user').exists())

    def test_tc041_creating_inactive_staff_also_creates_inactive_login(self):
        self.client.force_authenticate(self.manager)
        res = self.client.post('/api/staff/', {'username': 'locked-from-start', 'name': 'Locked',
            'position': 'Bác sĩ', 'role': 'doctor', 'password': 'Original@123', 'is_active': False}, format='json')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertFalse(User.objects.get(username='locked-from-start').is_active)

    def test_editing_staff_details_does_not_unlock_a_separately_locked_account(self):
        User.objects.filter(pk=self.doctor.pk).update(is_active=False)
        self.client.force_authenticate(self.manager)
        res = self.client.patch(f'/api/staff/{self.staff.pk}/', {'name': 'Updated name'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.doctor.refresh_from_db()
        self.assertFalse(self.doctor.is_active)

    def test_valid_registration_keeps_customer_role_and_optional_email(self):
        for index, email in enumerate(['valid@example.com', '']):
            res = self.client.post('/api/auth/register/', {'username': f'new-patient-{index}',
                'password': 'Password@123', 'email': email, 'role': 'sysadmin'}, format='json')
            self.assertEqual(res.status_code, 201, res.data)
            self.assertEqual(res.data['user']['role'], 'customer')

    def test_tc061_empty_result_is_rejected_without_changing_progress_or_booking(self):
        booking = Booking.objects.create(patient=self.patient, staff=self.staff,
            appointment=timezone.now() + timedelta(days=2), status=Booking.CHECKED_IN)
        self.client.force_authenticate(self.doctor)
        res = self.client.post(f'/api/clinic/plans/{self.plan.pk}/complete-session/',
            {'session_id': self.session.pk, 'booking': booking.pk, 'content': ' ', 'outcome': ' '}, format='json')
        self.assertEqual(res.status_code, 400, res.data)
        self.session.refresh_from_db()
        self.plan.refresh_from_db()
        booking.refresh_from_db()
        self.assertEqual(self.session.status, TreatmentSession.PENDING)
        self.assertEqual(self.plan.status, TreatmentPlan.ACTIVE)
        self.assertIsNone(self.session.booking_id)
        self.assertIsNone(booking.treatment_session_id)
        self.assertEqual(self.plan.done_sessions, 0)

    def test_tc061_requires_both_content_and_outcome_then_completes_once(self):
        self.client.force_authenticate(self.doctor)
        path = f'/api/clinic/plans/{self.plan.pk}/complete-session/'
        for fields in ({}, {'content': 'Thực hiện'}, {'outcome': 'Ổn định'},
                       {'content': 'Thực hiện', 'outcome': '   '},
                       {'content': 'Thực hiện', 'outcome': 'Ổn định', 'status': 'invalid'}):
            res = self.client.post(path, {'session_id': self.session.pk, **fields}, format='json')
            self.assertEqual(res.status_code, 400, res.data)
            self.session.refresh_from_db()
            self.assertEqual(self.session.status, TreatmentSession.PENDING)
        complete = self.client.post(path, {'session_id': self.session.pk,
            'content': '  Đã thực hiện  ', 'outcome': '  Ổn định  '}, format='json')
        self.assertEqual(complete.status_code, 200, complete.data)
        self.assertEqual(complete.data['done_sessions'], 1)
        self.session.refresh_from_db()
        self.assertEqual(self.session.outcome, 'Ổn định')
        self.assertEqual(self.session.performed_by_id, self.doctor.pk)
        self.assertEqual(self.client.post(path, {'session_id': self.session.pk,
            'content': 'Đã thực hiện', 'outcome': 'Ổn định'}, format='json').status_code, 400)

    def test_skipping_session_requires_a_reason_but_not_a_treatment_outcome(self):
        self.client.force_authenticate(self.doctor)
        path = f'/api/clinic/plans/{self.plan.pk}/complete-session/'
        missing = self.client.post(path, {'session_id': self.session.pk, 'status': 'skipped'}, format='json')
        self.assertEqual(missing.status_code, 400)
        valid = self.client.post(path, {'session_id': self.session.pk, 'status': 'skipped',
            'content': 'Khách đề nghị bỏ qua buổi này.'}, format='json')
        self.assertEqual(valid.status_code, 200, valid.data)
        self.assertEqual(valid.data['done_sessions'], 0)

    def test_tc064_customer_cannot_read_note_or_event_metadata(self):
        conversation = Conversation.objects.create(customer=self.customer, assigned_to=self.consultant)
        InternalNote.objects.create(conversation=conversation, author=self.consultant, text='QA_INTERNAL_ONLY')
        ConversationEvent.objects.create(conversation=conversation, actor=self.consultant,
            event_type=ConversationEvent.NOTE_ADDED, meta='QA_INTERNAL_ONLY')
        self.client.force_authenticate(self.customer)
        res = self.client.get(f'/api/conversations/{conversation.pk}/')
        self.assertEqual(res.status_code, 200, res.data)
        self.assertNotIn('QA_INTERNAL_ONLY', json.dumps(res.data, default=str))
        self.assertFalse(res.data.get('notes'))
        self.assertFalse(res.data.get('events'))
        self.client.force_authenticate(self.consultant)
        staff_view = self.client.get(f'/api/conversations/{conversation.pk}/')
        self.assertEqual(staff_view.status_code, 200)
        self.assertEqual(staff_view.data['notes'][0]['text'], 'QA_INTERNAL_ONLY')

    def test_private_chat_stays_hidden_from_other_customers_and_unassigned_consultants(self):
        conversation = Conversation.objects.create(customer=self.customer, assigned_to=self.consultant)
        for role in ('customer', 'consultant', 'doctor', 'staff'):
            user = User.objects.create_user(username=f'outsider-{role}', role=role)
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(f'/api/conversations/{conversation.pk}/').status_code, 404)

    def test_customer_search_does_not_expose_other_customers_or_their_appointments(self):
        other = User.objects.create_user(username='shared-other', first_name='Shared', role='customer')
        Booking.objects.create(user=other, appointment=timezone.now() + timedelta(days=1), guest_name='Shared private')
        self.client.force_authenticate(self.customer)
        res = self.client.get('/api/conversations/search/', {'q': 'Shared'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['customers'], [])
        self.assertEqual(res.data['bookings'], [])

    def test_public_roster_query_count_does_not_grow_with_staff_count(self):
        self.staff.services.add(self.service)
        for index in range(8):
            staff = Staff.objects.create(name=f'QA additional staff {index}')
            staff.services.add(self.service)
        with self.assertNumQueries(2):
            res = self.client.get('/api/staff/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 9)

    def test_prefetched_booking_duration_does_not_query_for_each_display_field(self):
        from core.models import BookingItem
        booking = Booking.objects.create(appointment=timezone.now() + timedelta(days=2))
        BookingItem.objects.create(booking=booking, service=self.service, price=self.service.price)
        booking = Booking.objects.prefetch_related('items__service').get(pk=booking.pk)
        with self.assertNumQueries(0):
            self.assertEqual(booking.duration_minutes, 30)
            self.assertEqual(booking.end_time, booking.appointment + timedelta(minutes=30))
