from datetime import timedelta
import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient, APITestCase

from clinic.models import Patient, TreatmentPlan, TreatmentSession, Visit
from core.models import Booking, Category, Conversation, ConversationSession, LeaveRequest, Service, Staff, Voucher, VoucherRedemption, WorkingHours, Message, AgentPresence, ChatSetting

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class AkinaClinicApiIntegrationTests(APITestCase):
    def setUp(self):
        self.manager = User.objects.create_user(
            username='manager1', password='pass12345', role='manager', email='manager@example.com'
        )
        self.customer = User.objects.create_user(
            username='customer1', password='pass12345', role='customer', email='customer@example.com'
        )
        self.category = Category.objects.create(name='Chăm sóc da')
        self.service = Service.objects.create(
            category=self.category, name='Facial test', price=350000, duration=60
        )

    def make_staff(self):
        from datetime import time as _t
        doctor = User.objects.create_user(
            username='booking-doctor', password='pass12345', role='doctor',
        )
        staff = Staff.objects.create(user=doctor, name='Bác sĩ Test', position='Bác sĩ')
        staff.services.add(self.service)
        for wd in range(7):
            WorkingHours.objects.create(staff=staff, weekday=wd, start_time=_t(8, 0), end_time=_t(20, 0))
        return staff

    def slot(self, days=2, hour=10):
        """Giờ hẹn cố định trong giờ làm việc, tránh test phụ thuộc giờ chạy."""
        d = timezone.localtime() + timedelta(days=days)
        return d.replace(hour=hour, minute=0, second=0, microsecond=0)

    def auth(self, user):
        token, _ = Token.objects.get_or_create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')

    @patch('api.views._queue_email')
    def test_manager_restores_cancelled_booking_with_reason_and_audit(self, queue_email):
        staff = self.make_staff()
        booking = Booking.objects.create(
            user=self.customer, staff=staff, appointment=self.slot(days=3),
            status=Booking.CANCELLED, appointment_type=Booking.APPOINTMENT_TYPE_CONSULT,
        )
        self.auth(self.customer)
        denied = self.client.post(
            f'/api/bookings/{booking.pk}/restore/',
            {'reason': 'Hủy nhầm lịch'}, format='json',
        )
        self.assertEqual(denied.status_code, 403)
        self.auth(self.manager)
        missing_reason = self.client.post(
            f'/api/bookings/{booking.pk}/restore/', {}, format='json',
        )
        self.assertEqual(missing_reason.status_code, 400)
        restored = self.client.post(
            f'/api/bookings/{booking.pk}/restore/',
            {'reason': 'Hủy nhầm do thao tác của lễ tân'}, format='json',
        )
        self.assertEqual(restored.status_code, 200, restored.data)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.PENDING)
        self.assertTrue(booking.history.filter(event='restored', actor=self.manager).exists())

    def test_login_and_me(self):
        response = self.client.post(
            '/api/auth/login/', {'username': 'customer1', 'password': 'pass12345'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('token', response.data)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.data['token']}")
        me = self.client.get('/api/auth/me/')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data['role'], 'customer')

    def test_login_ignores_stale_session_cookie_without_csrf(self):
        """A previous Django session must not block token-based login."""
        csrf_client = APIClient(enforce_csrf_checks=True)
        csrf_client.force_login(self.manager)

        response = csrf_client.post(
            '/api/auth/login/',
            {'username': 'customer1', 'password': 'pass12345'},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn('token', response.data)
        self.assertEqual(response.data['user']['username'], 'customer1')

    @patch('api.views._queue_email')
    def test_guest_consultation_keeps_selected_service_without_charging_it(self, queue_email):
        self.make_staff()
        appointment = self.slot().isoformat()
        response = self.client.post('/api/bookings/', {
            'guest_name': 'Khách Test',
            'guest_phone': '0900000000',
            'guest_email': 'guest@example.com',
            'appointment': appointment,
            'service_ids': [self.service.id],
            'note': 'Test API',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertEqual(booking.total, 0)
        self.assertEqual(booking.items.count(), 1)
        self.assertEqual(booking.items.get().price, 0)
        self.assertEqual(booking.appointment_type, Booking.APPOINTMENT_TYPE_CONSULT)
        queue_email.assert_called_once()

    @patch('api.views._queue_email')
    def test_booking_preserves_selected_appointment_type(self, queue_email):
        self.make_staff()
        self.service.booking_policy = Service.BOOKING_DIRECT
        self.service.save(update_fields=['booking_policy'])
        appointment_types = (
            Booking.APPOINTMENT_TYPE_CONSULT,
            Booking.APPOINTMENT_TYPE_PROCEDURE,
        )
        for index, appointment_type in enumerate(appointment_types):
            with self.subTest(appointment_type=appointment_type):
                response = self.client.post('/api/bookings/', {
                    'guest_name': 'Khách Test',
                    'guest_phone': '0900000000',
                    'appointment': self.slot(days=index + 2).isoformat(),
                    'service_ids': [self.service.id],
                    'appointment_type': appointment_type,
                }, format='json')
                self.assertEqual(response.status_code, 201, response.data)
                booking = Booking.objects.get(pk=response.data['id'])
                self.assertEqual(booking.appointment_type, appointment_type)
                self.assertEqual(response.data['appointment_type'], appointment_type)
                self.assertTrue(response.data['appointment_type_label'])
        self.assertEqual(queue_email.call_count, len(appointment_types))

    @patch('api.views._queue_email')
    def test_treatment_session_booking_is_linked_and_included_in_plan(self, queue_email):
        doctor_staff = self.make_staff()
        patient = Patient.objects.create(
            full_name='Bệnh nhân Test', phone='0900000001', user=self.customer,
        )
        plan = TreatmentPlan.objects.create(
            patient=patient,
            doctor=doctor_staff.user,
            title='Liệu trình trị mụn',
            service=self.service,
            total_sessions=2,
            status=TreatmentPlan.ACTIVE,
        )
        session = TreatmentSession.objects.create(plan=plan, number=1)
        self.auth(self.customer)

        response = self.client.post('/api/bookings/', {
            'appointment': self.slot().isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_SESSION,
            'treatment_session_id': session.pk,
        }, format='json')

        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertEqual(booking.treatment_session, session)
        self.assertEqual(booking.patient, patient)
        self.assertEqual(booking.total, 0)
        self.assertEqual(booking.items.get().service, self.service)
        self.assertEqual(booking.items.get().price, 0)
        self.assertEqual(response.data['treatment_session_label'], 'Liệu trình trị mụn · Buổi 1')
        self.assertEqual(response.data['treatment_session_policy'], {
            'allow_staff_delegation': False,
            'doctor_user_id': doctor_staff.user_id,
            'service_id': self.service.pk,
        })

        duplicate = self.client.post('/api/bookings/', {
            'appointment': self.slot(days=3).isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_SESSION,
            'treatment_session_id': session.pk,
        }, format='json')
        self.assertEqual(duplicate.status_code, 400, duplicate.data)
        queue_email.assert_called_once()

        self.auth(self.manager)
        booking.status = Booking.CHECKED_IN
        booking.save(update_fields=['status'])
        visit = Visit.objects.create(
            patient=patient,
            booking=booking,
            doctor=doctor_staff.user,
            status=Visit.IN_CONSULT,
        )
        premature_completion = self.client.post(f'/api/bookings/{booking.pk}/complete/')
        self.assertEqual(premature_completion.status_code, 400, premature_completion.data)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.CHECKED_IN)
        session.refresh_from_db()
        self.assertEqual(session.status, TreatmentSession.PENDING)
        self.assertIsNone(session.performed_at)
        visit.status = Visit.COMPLETED
        visit.save(update_fields=['status'])
        premature_session_completion = self.client.post(f'/api/bookings/{booking.pk}/complete/')
        self.assertEqual(premature_session_completion.status_code, 400, premature_session_completion.data)
        visit.status = Visit.IN_CONSULT
        visit.save(update_fields=['status'])
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.loyalty_points, 0)

        self.auth(doctor_staff.user)
        unfinished_visit = self.client.post(f'/api/clinic/visits/{visit.pk}/complete/')
        self.assertEqual(unfinished_visit.status_code, 400, unfinished_visit.data)
        recorded = self.client.post(
            f'/api/clinic/plans/{plan.pk}/complete-session/',
            {'session_id': session.pk, 'status': 'done', 'content': 'Đã đánh giá và thực hiện buổi điều trị.'},
            format='json',
        )
        self.assertEqual(recorded.status_code, 200, recorded.data)
        session.refresh_from_db()
        self.assertEqual(session.status, TreatmentSession.DONE)
        self.assertIsNotNone(session.performed_at)
        completed_visit = self.client.post(f'/api/clinic/visits/{visit.pk}/complete/')
        self.assertEqual(completed_visit.status_code, 200, completed_visit.data)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.COMPLETED)

    @patch('api.views._queue_email')
    def test_treatment_session_staff_assignment_requires_doctor_delegation(self, queue_email):
        doctor_staff = self.make_staff()
        nurse_user = User.objects.create_user(
            username='session-nurse', password='pass12345', role='staff',
        )
        nurse = Staff.objects.create(user=nurse_user, name='Điều dưỡng đủ dịch vụ', position='Điều dưỡng')
        nurse.services.add(self.service)
        for weekday in range(7):
            WorkingHours.objects.create(
                staff=nurse, weekday=weekday, start_time='08:00', end_time='20:00',
            )
        patient = Patient.objects.create(
            full_name='Bệnh nhân liệu trình phân quyền', phone='0900000198', user=self.customer,
        )
        plan = TreatmentPlan.objects.create(
            patient=patient, doctor=doctor_staff.user, service=self.service,
            title='Liệu trình phân quyền', total_sessions=1, status=TreatmentPlan.ACTIVE,
        )
        session = TreatmentSession.objects.create(plan=plan, number=1)
        self.auth(self.customer)
        target_day = timezone.localdate() + timedelta(days=2)
        availability_url = '/api/availability/'
        params = {
            'date': target_day.isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_SESSION,
            'treatment_session_id': session.pk,
        }

        available = self.client.get(availability_url, params)
        self.assertEqual(available.status_code, 200, available.data)
        self.assertEqual([row['staff_id'] for row in available.data['staff']], [doctor_staff.pk])

        denied = self.client.post('/api/bookings/', {
            'appointment': self.slot().isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_SESSION,
            'treatment_session_id': session.pk,
            'staff': nurse.pk,
        }, format='json')
        self.assertEqual(denied.status_code, 400, denied.data)
        self.assertFalse(Booking.objects.filter(treatment_session=session).exists())

        session.allow_staff_delegation = True
        session.save(update_fields=['allow_staff_delegation'])
        available = self.client.get(availability_url, params)
        self.assertEqual(available.status_code, 200, available.data)
        self.assertEqual(
            {row['staff_id'] for row in available.data['staff']},
            {doctor_staff.pk, nurse.pk},
        )
        response = self.client.post('/api/bookings/', {
            'appointment': self.slot().isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_SESSION,
            'treatment_session_id': session.pk,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertEqual(booking.staff, doctor_staff)

        self.auth(self.customer)
        reassignment_denied = self.client.post(
            f'/api/bookings/{booking.pk}/reschedule/',
            {'appointment': booking.appointment.isoformat(), 'staff': nurse.pk},
            format='json',
        )
        self.assertEqual(reassignment_denied.status_code, 403, reassignment_denied.data)

        session.allow_staff_delegation = False
        session.save(update_fields=['allow_staff_delegation'])
        self.auth(self.manager)
        unapproved_assignment = self.client.post(
            f'/api/bookings/{booking.pk}/reschedule/',
            {'appointment': booking.appointment.isoformat(), 'staff': nurse.pk},
            format='json',
        )
        self.assertEqual(unapproved_assignment.status_code, 409, unapproved_assignment.data)

        session.allow_staff_delegation = True
        session.save(update_fields=['allow_staff_delegation'])
        assigned = self.client.post(
            f'/api/bookings/{booking.pk}/reschedule/',
            {'appointment': booking.appointment.isoformat(), 'staff': nurse.pk},
            format='json',
        )
        self.assertEqual(assigned.status_code, 200, assigned.data)
        booking.refresh_from_db()
        self.assertEqual(booking.staff, nurse)

        self.auth(nurse_user)
        staff_confirm = self.client.post(f'/api/bookings/{booking.pk}/confirm/')
        self.assertEqual(staff_confirm.status_code, 403, staff_confirm.data)
        self.auth(self.manager)
        confirmed = self.client.post(f'/api/bookings/{booking.pk}/confirm/')
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        booking.status = Booking.IN_PROGRESS
        booking.save(update_fields=['status'])
        self.auth(nurse_user)
        completed = self.client.post(
            f'/api/clinic/plans/{plan.pk}/complete-session/',
            {'session_id': session.pk, 'content': 'Đã thực hiện theo phân công của bác sĩ.'},
            format='json',
        )
        self.assertEqual(completed.status_code, 200, completed.data)
        session.refresh_from_db()
        self.assertEqual(session.performed_by, nurse_user)
        self.assertEqual(queue_email.call_count, 3)

    @patch('api.views._queue_email')
    def test_consultation_can_be_booked_without_selecting_a_service(self, queue_email):
        doctor = User.objects.create_user(username='booking-doctor', password='pass12345', role='doctor')
        staff = Staff.objects.create(user=doctor, name='Bác sĩ tư vấn', position='Bác sĩ')
        for weekday in range(7):
            WorkingHours.objects.create(
                staff=staff, weekday=weekday, start_time='08:00', end_time='20:00',
            )
        target_day = timezone.localdate() + timedelta(days=2)
        availability = self.client.get('/api/availability/', {
            'date': target_day.isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_CONSULT,
        })
        self.assertEqual(availability.status_code, 200, availability.data)
        self.assertTrue(availability.data['staff'][0]['slots'])

        response = self.client.post('/api/bookings/', {
            'guest_name': 'Khách tư vấn',
            'guest_phone': '0900000010',
            'appointment': self.slot().isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_CONSULT,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertEqual(booking.items.count(), 0)
        self.assertEqual(booking.total, 0)
        self.assertEqual(booking.staff, staff)
        queue_email.assert_called_once()

    def test_service_requiring_assessment_cannot_be_booked_as_direct_procedure(self):
        self.make_staff()
        response = self.client.post('/api/bookings/', {
            'guest_name': 'Khách đặt thủ thuật',
            'guest_phone': '0900000014',
            'appointment': self.slot().isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_PROCEDURE,
            'service_ids': [self.service.pk],
        }, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Booking.objects.exists())

    @patch('api.views._queue_email')
    def test_follow_up_booking_requires_ownership_and_links_previous_visit(self, queue_email):
        self.make_staff()
        patient = Patient.objects.create(
            full_name='Bệnh nhân tái khám', phone='0900000011', user=self.customer,
        )
        previous_visit = Visit.objects.create(
            patient=patient, status=Visit.COMPLETED, check_in_at=timezone.now() - timedelta(days=10),
        )
        payload = {
            'appointment': self.slot().isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_FOLLOW_UP,
            'service_ids': [self.service.pk],
            'follow_up_visit_id': previous_visit.pk,
        }
        anonymous = self.client.post('/api/bookings/', {
            **payload,
            'guest_name': 'Bệnh nhân tái khám',
            'guest_phone': patient.phone,
        }, format='json')
        self.assertEqual(anonymous.status_code, 400, anonymous.data)

        self.auth(self.customer)
        response = self.client.post('/api/bookings/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertEqual(booking.patient, patient)
        self.assertEqual(booking.follow_up_visit, previous_visit)
        queue_email.assert_called_once()

    @patch('api.views._queue_email')
    def test_booking_idempotency_replays_success_without_duplicate(self, queue_email):
        self.make_staff()
        payload = {
            'guest_name': 'Khách idempotent',
            'guest_phone': '0900000012',
            'appointment': self.slot().isoformat(),
            'service_ids': [self.service.pk],
        }
        response = self.client.post(
            '/api/bookings/', payload, format='json',
            HTTP_IDEMPOTENCY_KEY='booking-request-unique-001',
        )
        replay = self.client.post(
            '/api/bookings/', payload, format='json',
            HTTP_IDEMPOTENCY_KEY='booking-request-unique-001',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(replay.data['id'], response.data['id'])
        self.assertEqual(Booking.objects.count(), 1)
        queue_email.assert_called_once()

        changed_payload = {**payload, 'note': 'Nội dung khác'}
        conflict = self.client.post(
            '/api/bookings/', changed_payload, format='json',
            HTTP_IDEMPOTENCY_KEY='booking-request-unique-001',
        )
        self.assertEqual(conflict.status_code, 409, conflict.data)

    @patch('api.views._queue_email')
    def test_rescheduling_keeps_booking_history_and_session_uncompleted(self, queue_email):
        self.make_staff()
        response = self.client.post('/api/bookings/', {
            'guest_name': 'Khách đổi lịch',
            'guest_phone': '0900000013',
            'appointment': self.slot().isoformat(),
            'service_ids': [self.service.pk],
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        booking.status = Booking.CONFIRMED
        booking.save(update_fields=['status'])

        self.auth(self.manager)
        updated = self.client.post(
            f'/api/bookings/{booking.pk}/reschedule/',
            {'appointment': self.slot(days=4).isoformat(), 'reason': 'Khách đề nghị đổi lịch'},
            format='json',
        )
        self.assertEqual(updated.status_code, 200, updated.data)
        booking.refresh_from_db()
        self.assertEqual(booking.appointment, self.slot(days=4))
        self.assertEqual(booking.status, Booking.PENDING)
        self.assertEqual(booking.history.filter(event='rescheduled').count(), 1)

    @patch('api.views._queue_email')
    def test_customer_cancel_and_reschedule_require_24_hour_notice_and_ownership(self, queue_email):
        doctor = self.make_staff()
        near_booking = Booking.objects.create(
            user=self.customer,
            staff=doctor,
            appointment=timezone.now() + timedelta(hours=23),
            status=Booking.CONFIRMED,
        )
        far_booking = Booking.objects.create(
            user=self.customer,
            staff=doctor,
            appointment=self.slot(days=3),
            status=Booking.CONFIRMED,
        )
        other = User.objects.create_user(username='other-owner', password='pass12345', role='customer')
        private_booking = Booking.objects.create(
            user=other,
            staff=doctor,
            appointment=self.slot(days=4),
            status=Booking.CONFIRMED,
        )
        self.auth(self.customer)

        blocked_cancel = self.client.post(f'/api/bookings/{near_booking.pk}/cancel/')
        self.assertEqual(blocked_cancel.status_code, 400, blocked_cancel.data)
        near_booking.refresh_from_db()
        self.assertEqual(near_booking.status, Booking.CONFIRMED)

        blocked_reschedule = self.client.post(
            f'/api/bookings/{near_booking.pk}/reschedule/',
            {'appointment': self.slot(days=3).isoformat()},
            format='json',
        )
        self.assertEqual(blocked_reschedule.status_code, 400, blocked_reschedule.data)

        too_soon = timezone.now() + timedelta(hours=12)
        blocked_new_time = self.client.post(
            f'/api/bookings/{far_booking.pk}/reschedule/',
            {'appointment': too_soon.isoformat()},
            format='json',
        )
        self.assertEqual(blocked_new_time.status_code, 400, blocked_new_time.data)

        new_appointment = self.slot(days=5)
        allowed_reschedule = self.client.post(
            f'/api/bookings/{far_booking.pk}/reschedule/',
            {'appointment': new_appointment.isoformat()},
            format='json',
        )
        self.assertEqual(allowed_reschedule.status_code, 200, allowed_reschedule.data)
        far_booking.refresh_from_db()
        self.assertEqual(far_booking.appointment, new_appointment)
        self.assertEqual(far_booking.status, Booking.PENDING)

        cancelable_booking = Booking.objects.create(
            user=self.customer,
            staff=doctor,
            appointment=self.slot(days=6),
            status=Booking.CONFIRMED,
        )
        allowed_cancel = self.client.post(f'/api/bookings/{cancelable_booking.pk}/cancel/')
        self.assertEqual(allowed_cancel.status_code, 200, allowed_cancel.data)
        cancelable_booking.refresh_from_db()
        self.assertEqual(cancelable_booking.status, Booking.CANCELLED)

        private_cancel = self.client.post(f'/api/bookings/{private_booking.pk}/cancel/')
        private_reschedule = self.client.post(
            f'/api/bookings/{private_booking.pk}/reschedule/',
            {'appointment': self.slot(days=5).isoformat()},
            format='json',
        )
        self.assertEqual(private_cancel.status_code, 404)
        self.assertEqual(private_reschedule.status_code, 404)
        self.assertEqual(queue_email.call_count, 2)

    def test_customer_reschedule_rejects_staff_schedule_conflict(self):
        doctor = self.make_staff()
        appointment = self.slot(days=3)
        own_booking = Booking.objects.create(
            user=self.customer,
            staff=doctor,
            appointment=self.slot(days=2),
            status=Booking.CONFIRMED,
        )
        Booking.objects.create(
            user=self.manager,
            staff=doctor,
            appointment=appointment,
            status=Booking.CONFIRMED,
        )
        self.auth(self.customer)

        response = self.client.post(
            f'/api/bookings/{own_booking.pk}/reschedule/',
            {'appointment': appointment.isoformat()},
            format='json',
        )

        self.assertEqual(response.status_code, 409, response.data)

    def test_no_show_and_cancel_do_not_consume_treatment_session(self):
        patient = Patient.objects.create(full_name='Bệnh nhân liệu trình', phone='0900000015', user=self.customer)
        plan = TreatmentPlan.objects.create(
            patient=patient, title='Liệu trình test', status=TreatmentPlan.ACTIVE,
        )
        session = TreatmentSession.objects.create(plan=plan, number=1)
        booking = Booking.objects.create(
            patient=patient,
            user=self.customer,
            treatment_session=session,
            appointment=timezone.now() - timedelta(hours=1),
            status=Booking.CONFIRMED,
        )

        self.auth(self.manager)
        response = self.client.post(f'/api/bookings/{booking.pk}/no_show/', format='json')
        self.assertEqual(response.status_code, 200, response.data)
        booking.refresh_from_db()
        session.refresh_from_db()
        self.assertEqual(booking.status, Booking.NO_SHOW)
        self.assertEqual(session.status, TreatmentSession.PENDING)
        self.assertIsNone(session.performed_at)

    def test_booking_status_cannot_be_changed_with_generic_patch(self):
        booking = Booking.objects.create(
            user=self.customer,
            appointment=timezone.now() + timedelta(days=1),
            status=Booking.CONFIRMED,
        )
        self.auth(self.manager)
        response = self.client.patch(
            f'/api/bookings/{booking.pk}/',
            {'status': Booking.COMPLETED},
            format='json',
        )
        self.assertEqual(response.status_code, 405, response.data)
        booking.refresh_from_db()
        self.assertEqual(booking.status, Booking.CONFIRMED)

    def test_customer_cannot_book_another_patients_treatment_session(self):
        other = User.objects.create_user(username='other-patient', password='pass12345', role='customer')
        patient = Patient.objects.create(full_name='Bệnh nhân khác', phone='0900000002', user=other)
        plan = TreatmentPlan.objects.create(
            patient=patient, title='Liệu trình riêng', status=TreatmentPlan.ACTIVE,
        )
        session = TreatmentSession.objects.create(plan=plan, number=1)
        self.auth(self.customer)

        response = self.client.post('/api/bookings/', {
            'appointment': self.slot().isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_SESSION,
            'treatment_session_id': session.pk,
            'service_ids': [self.service.pk],
        }, format='json')

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Booking.objects.filter(treatment_session=session).exists())

    def test_customer_only_sees_own_bookings(self):
        Booking.objects.create(user=self.customer, appointment=timezone.now() + timedelta(days=1))
        other = User.objects.create_user(username='other', password='pass12345', role='customer')
        Booking.objects.create(user=other, appointment=timezone.now() + timedelta(days=1))
        self.auth(self.customer)
        response = self.client.get('/api/bookings/')
        self.assertEqual(response.status_code, 200)
        rows = response.data.get('results', response.data) if isinstance(response.data, dict) else response.data
        self.assertEqual(len(rows), 1)

    def test_booking_list_filters_and_paginates_without_widening_customer_scope(self):
        staff = self.make_staff()
        appointment = self.slot(days=3)
        matching = Booking.objects.create(
            user=self.customer,
            guest_name='Nguyen Thi Lan',
            guest_phone='0901234567',
            staff=staff,
            appointment=appointment,
            status=Booking.PENDING,
        )
        next_pending = Booking.objects.create(
            user=self.customer,
            guest_name='Nguyen Thi Lan',
            staff=staff,
            appointment=appointment + timedelta(hours=1),
            status=Booking.PENDING,
        )
        Booking.objects.create(
            user=self.customer,
            guest_name='Khach khac',
            appointment=appointment + timedelta(hours=1),
            status=Booking.CONFIRMED,
        )
        other = User.objects.create_user(username='other-list-customer', password='pass12345', role='customer')
        other_booking = Booking.objects.create(
            user=other,
            appointment=appointment,
            status=Booking.PENDING,
        )

        self.auth(self.manager)
        response = self.client.get('/api/bookings/', {
            'view': 'list',
            'status': 'pending',
            'from': appointment.date().isoformat(),
            'to': appointment.date().isoformat(),
            'staff': staff.pk,
            'q': '0901234567',
            'page_size': 1,
        })

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual([row['id'] for row in response.data['results']], [matching.pk])

        page_one = self.client.get('/api/bookings/', {
            'view': 'list',
            'status': 'pending',
            'from': appointment.date().isoformat(),
            'to': appointment.date().isoformat(),
            'staff': staff.pk,
            'page_size': 1,
        })
        page_two = self.client.get('/api/bookings/', {
            'view': 'list',
            'status': 'pending',
            'from': appointment.date().isoformat(),
            'to': appointment.date().isoformat(),
            'staff': staff.pk,
            'page_size': 1,
            'page': 2,
        })
        self.assertEqual(page_one.data['count'], 2)
        self.assertIsNotNone(page_one.data['next'])
        self.assertEqual([row['id'] for row in page_one.data['results']], [matching.pk])
        self.assertEqual([row['id'] for row in page_two.data['results']], [next_pending.pk])

        self.auth(self.customer)
        scoped = self.client.get('/api/bookings/', {'view': 'list', 'status': 'pending'})
        self.assertEqual(scoped.status_code, 200, scoped.data)
        self.assertEqual({row['id'] for row in scoped.data['results']}, {matching.pk, next_pending.pk})
        self.assertNotIn(other_booking.pk, [row['id'] for row in scoped.data['results']])

    def test_booking_list_rejects_invalid_status_and_dates(self):
        self.auth(self.manager)
        invalid_status = self.client.get('/api/bookings/', {'status': 'unknown'})
        invalid_date = self.client.get('/api/bookings/', {'from': 'not-a-date'})

        self.assertEqual(invalid_status.status_code, 400)
        self.assertEqual(invalid_date.status_code, 400)

    def test_customer_booking_includes_treatment_plan_session_details(self):
        patient = Patient.objects.create(
            full_name='Bệnh nhân liệu trình',
            phone='0900000017',
            user=self.customer,
        )
        plan = TreatmentPlan.objects.create(
            patient=patient,
            title='Liệu trình chăm sóc da',
            status=TreatmentPlan.ACTIVE,
            total_sessions=4,
        )
        session = TreatmentSession.objects.create(plan=plan, number=2)
        booking = Booking.objects.create(
            patient=patient,
            user=self.customer,
            appointment_type=Booking.APPOINTMENT_TYPE_SESSION,
            treatment_session=session,
            appointment=self.slot(days=3),
        )
        self.auth(self.customer)

        response = self.client.get('/api/bookings/')

        self.assertEqual(response.status_code, 200)
        rows = response.data.get('results', response.data) if isinstance(response.data, dict) else response.data
        booking_data = next(row for row in rows if row['id'] == booking.pk)
        self.assertEqual(booking_data['treatment_session_details'], {
            'plan_title': plan.title,
            'session_number': 2,
            'total_sessions': 4,
            'session_status': session.status,
            'session_status_label': session.get_status_display(),
            'plan_status': plan.status,
            'plan_status_label': plan.get_status_display(),
        })

    @patch('api.tasks.mirror_chat_message_task.delay', return_value=None)
    def test_chat_message_persists_before_realtime_mirror(self, _delay):
        self.auth(self.customer)
        conversation = Conversation.objects.create(customer=self.customer, subject='Tư vấn test')
        response = self.client.post(
            f'/api/conversations/{conversation.id}/messages/', {'text': 'Xin chào AkinaClinic'}, format='json'
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(conversation.messages.count(), 1)
        self.assertEqual(conversation.messages.first().text, 'Xin chào AkinaClinic')

    @patch('api.ai_support.generate_copilot')
    def test_ai_copilot_returns_draft_without_sending_message(self, generate_copilot):
        consultant = User.objects.create_user(username='copilot_agent', password='pass12345', role='consultant')
        conversation = Conversation.objects.create(
            customer=self.customer, subject='Tư vấn da', assigned_to=consultant
        )
        Message.objects.create(conversation=conversation, sender=self.customer, text='Da em bị đỏ sau điều trị.')
        generate_copilot.return_value = {
            'summary': 'Khách báo da đỏ sau điều trị.',
            'suggestions': [
                {'label': 'Thân thiện', 'text': 'Tôi đã ghi nhận và sẽ chuyển bác sĩ xem xét.'},
                {'label': 'Chuyên nghiệp', 'text': 'Bác sĩ sẽ xem xét thông tin của bạn.'},
            ],
            'needs_doctor': True,
            'escalation_reason': 'Khách nêu phản ứng sau điều trị.',
        }
        before = conversation.messages.count()
        self.auth(consultant)

        response = self.client.post(f'/api/conversations/{conversation.id}/ai-copilot/')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['needs_doctor'])
        self.assertEqual(conversation.messages.count(), before)
        generate_copilot.assert_called_once()

    def test_customer_cannot_use_ai_copilot(self):
        conversation = Conversation.objects.create(customer=self.customer, subject='Tư vấn test')
        self.auth(self.customer)

        response = self.client.post(f'/api/conversations/{conversation.id}/ai-copilot/')

        self.assertEqual(response.status_code, 403)

    @patch.dict('os.environ', {'GEMINI_API_KEY': ''})
    def test_ai_copilot_reports_missing_server_key(self):
        consultant = User.objects.create_user(username='copilot_no_key', password='pass12345', role='consultant')
        conversation = Conversation.objects.create(
            customer=self.customer, subject='Tư vấn test', assigned_to=consultant
        )
        self.auth(consultant)

        response = self.client.post(f'/api/conversations/{conversation.id}/ai-copilot/')

        self.assertEqual(response.status_code, 503)
        self.assertIn('GEMINI_API_KEY', response.data['detail'])

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'test-secret-key', 'GEMINI_MODEL': 'gemini-3.8-flash'})
    @patch('api.ai.urllib.request.urlopen')
    def test_gemini_key_is_sent_in_header_not_url(self, urlopen):
        from api import ai

        response = urlopen.return_value.__enter__.return_value
        response.read.return_value = b'{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}'

        result = ai._generate([{'text': 'test'}], system_instruction='test')

        request = urlopen.call_args.args[0]
        self.assertEqual(result, 'ok')
        self.assertNotIn('test-secret-key', request.full_url)
        self.assertEqual(request.get_header('X-goog-api-key'), 'test-secret-key')

    @patch.dict('os.environ', {
        'GEMINI_MODEL': 'gemini-3.8-flash',
        'GEMINI_THINKING_LEVEL': 'low',
    })
    def test_gemini_38_uses_supported_low_thinking_config(self):
        from api import ai

        config = ai._generation_config(json_schema={'type': 'OBJECT'}, temperature=0.2)

        self.assertEqual(config['thinkingConfig'], {'thinkingLevel': 'low'})
        self.assertNotIn('temperature', config)
        self.assertEqual(config['responseMimeType'], 'application/json')

    @patch.dict('os.environ', {'GEMINI_MODEL': 'gemini-2.5-flash'})
    def test_gemini_25_keeps_legacy_zero_thinking_budget(self):
        from api import ai

        config = ai._generation_config()

        self.assertEqual(config['thinkingConfig'], {'thinkingBudget': 0})
        self.assertEqual(config['temperature'], 0.2)

    @patch.dict('os.environ', {
        'GEMINI_MODEL': 'gemini-3.6-flash',
        'GEMINI_FALLBACK_MODELS': 'gemini-3.5-flash-lite',
    })
    @patch('api.ai._generate_once')
    def test_gemini_falls_back_to_flash_lite_when_primary_is_busy(self, generate_once):
        from api import ai

        generate_once.side_effect = [
            ai.GeminiAPIError('busy', status_code=503, code='http_error'),
            '{"ok":true}',
        ]

        result = ai._generate([{'text': 'test'}], system_instruction='test')

        self.assertEqual(result, '{"ok":true}')
        self.assertEqual(
            [call.kwargs['model'] for call in generate_once.call_args_list],
            ['gemini-3.6-flash', 'gemini-3.5-flash-lite'],
        )

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'test-key'})
    @patch('api.ai_support.ai._generate')
    def test_ai_copilot_returns_timeout_code_without_hanging(self, generate):
        from api.ai import GeminiAPIError

        consultant = User.objects.create_user(username='copilot_timeout', password='pass12345', role='consultant')
        conversation = Conversation.objects.create(
            customer=self.customer, subject='Tư vấn test', assigned_to=consultant
        )
        Message.objects.create(conversation=conversation, sender=self.customer, text='Xin tư vấn giúp tôi.')
        generate.side_effect = GeminiAPIError('timeout', code='timeout')
        self.auth(consultant)

        response = self.client.post(f'/api/conversations/{conversation.id}/ai-copilot/')

        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.data['code'], 'ai_timeout')

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'test-key'})
    @patch('api.ai_support.ai._generate')
    def test_ai_copilot_forces_approved_reply_for_medical_content(self, generate):
        from django.core.cache import cache
        from api.ai_support import generate_copilot

        cache.clear()
        conversation = Conversation.objects.create(customer=self.customer, subject='Tư vấn da')
        Message.objects.create(conversation=conversation, sender=self.customer, text='Da em bị đỏ sau điều trị.')
        generate.return_value = (
            '{"summary":"Khách báo đỏ da sau điều trị.","category":"medical","needs_doctor":false,'
            '"escalation_reason":"Phản ứng sau điều trị.",'
            '"suggestions":[{"text":"Bạn bôi kem X là được."},{"text":"Bạn uống thuốc Y nhé."}]}'
        )

        result = generate_copilot(conversation, refresh=True)

        # Mô hình phân loại là chuyên môn => hệ thống bắt buộc chuyển bác sĩ và dùng câu trả lời đã duyệt,
        # dù mô hình có lỡ viết lời khuyên y tế.
        self.assertTrue(result['needs_doctor'])
        self.assertEqual(result['category'], 'medical')
        self.assertEqual([x['label'] for x in result['suggestions']], ['Thân thiện', 'Chuyên nghiệp'])
        self.assertIn('chưa thể đưa ra hướng dẫn y khoa', result['suggestions'][0]['text'])
        self.assertNotIn('kem X', ' '.join(x['text'] for x in result['suggestions']))
        prompt = generate.call_args.args[0][0]['text']
        self.assertIn('Da em bị đỏ sau điều trị.', prompt)
        self.assertIn('clinic_policy', prompt)
        self.assertIsNotNone(generate.call_args.kwargs.get('json_schema'))

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'test-key'})
    @patch('api.ai_support.ai._generate')
    def test_ai_copilot_keeps_ai_draft_for_booking_and_caches_by_last_message(self, generate):
        from django.core.cache import cache
        from api.ai_support import generate_copilot

        cache.clear()
        conversation = Conversation.objects.create(customer=self.customer, subject='Đặt lịch')
        Message.objects.create(conversation=conversation, sender=self.customer, text='Mai chiều em đặt lịch khám được không?')
        generate.return_value = (
            '{"summary":"Khách muốn đặt lịch khám chiều mai.","category":"booking","needs_doctor":false,'
            '"escalation_reason":"",'
            '"suggestions":[{"text":"Dạ phòng khám sẽ kiểm tra lịch trống chiều mai và báo lại bạn ngay ạ."},'
            '{"text":"Phòng khám đã nhận yêu cầu đặt lịch của bạn và sẽ phản hồi sớm."}]}'
        )

        first = generate_copilot(conversation)
        second = generate_copilot(conversation)

        self.assertFalse(first['needs_doctor'])
        self.assertIn('kiểm tra lịch trống', first['suggestions'][0]['text'])
        self.assertEqual(first, second)
        self.assertEqual(generate.call_count, 1)  # lần hai lấy từ bộ nhớ đệm, không gọi lại AI

    def test_manager_dashboard_summary(self):
        self.auth(self.manager)
        response = self.client.get('/api/dashboard/summary/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('bookings_total', response.data)
        self.assertIn('revenue', response.data)

    def test_public_ticket_lookup(self):
        booking = Booking.objects.create(
            user=self.customer, appointment=timezone.now() + timedelta(days=1), total=350000
        )
        response = self.client.get(f'/api/tickets/{booking.confirm_code}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['confirm_code'], booking.confirm_code)

    def test_availability_returns_qualified_staff_slots(self):
        staff = Staff.objects.create(name='Chuyên viên test', position='Chuyên viên')
        staff.services.add(self.service)
        self.service.booking_policy = Service.BOOKING_DIRECT
        self.service.save(update_fields=['booking_policy'])
        target_day = timezone.localdate() + timedelta(days=2)
        WorkingHours.objects.create(
            staff=staff, weekday=target_day.weekday(), start_time='08:00', end_time='17:00'
        )
        response = self.client.get(
            '/api/availability/', {'service_ids': str(self.service.id), 'date': target_day.isoformat(),
                                   'appointment_type': Booking.APPOINTMENT_TYPE_PROCEDURE}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['staff'][0]['staff_id'], staff.id)
        self.assertTrue(response.data['staff'][0]['slots'])
    @patch('api.views.sync_conversation', return_value=True)
    def test_realtime_bootstrap_endpoint(self, sync):
        self.auth(self.customer)
        conversation = Conversation.objects.create(customer=self.customer, subject='Realtime test')
        response = self.client.post(f'/api/conversations/{conversation.id}/realtime/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['enabled'])
        sync.assert_called_once()



    def test_approved_leave_hides_staff_from_availability(self):
        staff_user = User.objects.create_user(username='staffleave', password='pass12345', role='staff')
        staff = Staff.objects.create(user=staff_user, name='Staff leave', position='KTV')
        staff.services.add(self.service)
        self.service.booking_policy = Service.BOOKING_DIRECT
        self.service.save(update_fields=['booking_policy'])
        target_day = timezone.localdate() + timedelta(days=3)
        WorkingHours.objects.create(staff=staff, weekday=target_day.weekday(), start_time='08:00', end_time='17:00')
        LeaveRequest.objects.create(staff=staff_user, start_date=target_day, end_date=target_day, status=LeaveRequest.APPROVED)
        response = self.client.get('/api/availability/', {
            'service_ids': str(self.service.id),
            'date': target_day.isoformat(),
            'appointment_type': Booking.APPOINTMENT_TYPE_PROCEDURE,
        })
        self.assertEqual(response.status_code, 200)
        # Nhân viên nghỉ phép không có slot nào khả dụng trong ngày đó.
        self.assertFalse(any(row['slots'] for row in response.data['staff'] if row['staff_id'] == staff.id))

    @patch('api.views._queue_email')
    def test_voucher_redeem_and_apply_to_booking(self, _email):
        self.customer.loyalty_points = 500
        self.customer.save(update_fields=['loyalty_points'])
        voucher = Voucher.objects.create(code='SAVE50', title='Giảm 50K', points_cost=100, discount_value=50000, min_spend=100000)
        self.auth(self.customer)
        redeemed = self.client.post(f'/api/vouchers/{voucher.id}/redeem/')
        self.assertEqual(redeemed.status_code, 200, redeemed.data)
        self.service.booking_policy = Service.BOOKING_DIRECT
        self.service.save(update_fields=['booking_policy'])
        self.make_staff()
        appointment = self.slot().isoformat()
        response = self.client.post('/api/bookings/', {
            'appointment': appointment,
            'appointment_type': Booking.APPOINTMENT_TYPE_PROCEDURE,
            'service_ids': [self.service.id],
            'voucher_id': voucher.id,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertEqual(booking.discount_total, 50000)
        self.assertEqual(booking.total, 300000)
        self.assertEqual(VoucherRedemption.objects.get(user=self.customer, voucher=voucher).status, VoucherRedemption.USED)

    @patch('api.views._queue_email')
    def test_completed_booking_awards_loyalty_only_once(self, _email):
        manager_token, _ = Token.objects.get_or_create(user=self.manager)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {manager_token.key}')
        patient = Patient.objects.create(
            full_name='Khách tích điểm',
            phone='0900000018',
            user=self.customer,
        )
        booking = Booking.objects.create(
            user=self.customer,
            patient=patient,
            appointment=timezone.now() - timedelta(hours=1),
            total=200000,
            status=Booking.CHECKED_IN,
        )
        Visit.objects.create(
            patient=patient,
            booking=booking,
            status=Visit.COMPLETED,
        )
        first = self.client.post(f'/api/bookings/{booking.id}/complete/')
        self.assertEqual(first.status_code, 200, first.data)
        self.customer.refresh_from_db(); points = self.customer.loyalty_points
        second = self.client.post(f'/api/bookings/{booking.id}/complete/')
        self.assertEqual(second.status_code, 200, second.data)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.loyalty_points, points)

    def test_consultant_claim_is_exclusive(self):
        agent1 = User.objects.create_user(username='agent1', password='pass12345', role='consultant')
        agent2 = User.objects.create_user(username='agent2', password='pass12345', role='consultant')
        AgentPresence.objects.create(user=agent1, status=AgentPresence.ONLINE)
        AgentPresence.objects.create(user=agent2, status=AgentPresence.ONLINE)
        conv = Conversation.objects.create(customer=self.customer, subject='Ca chưa gán')
        self.auth(agent1)
        first = self.client.post(f'/api/conversations/{conv.id}/claim/')
        self.assertEqual(first.status_code, 200, first.data)
        self.auth(agent2)
        second = self.client.post(f'/api/conversations/{conv.id}/claim/')
        self.assertEqual(second.status_code, 409, second.data)
        conv.refresh_from_db()
        self.assertEqual(conv.assigned_to_id, agent1.id)

    @patch('api.tasks.mirror_chat_message_task.delay', return_value=None)
    def test_chat_accepts_image_attachment(self, _delay):
        self.auth(self.customer)
        conv = Conversation.objects.create(customer=self.customer, subject='Gửi ảnh')
        upload = SimpleUploadedFile('da-mat.jpg', b'fake-image-content', content_type='image/jpeg')
        response = self.client.post(f'/api/conversations/{conv.id}/messages/', {'text':'Ảnh da của tôi', 'attachment':upload}, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        msg = Message.objects.get(pk=response.data['id'])
        self.assertEqual(msg.message_type, Message.IMAGE)
        self.assertEqual(msg.attachment_name, 'da-mat.jpg')

    def test_support_meta_has_role_specific_tabs(self):
        agent = User.objects.create_user(username='agentmeta', password='pass12345', role='consultant')
        self.auth(agent)
        response = self.client.get('/api/conversations/meta/')
        self.assertEqual(response.status_code, 200)
        keys = [row['key'] for row in response.data['tabs']]
        self.assertEqual(keys, ['unassigned', 'mine', 'waiting', 'closed'])

        self.auth(self.manager)
        response = self.client.get('/api/conversations/meta/')
        self.assertEqual(response.status_code, 200)
        keys = [row['key'] for row in response.data['tabs']]
        self.assertEqual(keys, ['all', 'unassigned', 'active', 'waiting', 'doctor', 'closed'])

    def test_chat_list_is_lean_and_incremental_polling(self):
        consultant = User.objects.create_user(username='cskh1', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Mụn viêm', assigned_to=consultant)
        self.auth(self.customer)
        first = self.client.post(f'/api/conversations/{conv.id}/messages/', {'text': 'xin chào'}, format='multipart')
        self.assertEqual(first.status_code, 201)
        self.auth(consultant)
        listing = self.client.get('/api/conversations/', {'tab': 'mine'})
        self.assertEqual(listing.status_code, 200)
        row = listing.data[0]
        self.assertNotIn('messages', row)
        self.assertEqual(row['last_message'], 'xin chào')
        self.assertEqual(row['unread_count'], 1)
        self.assertEqual(row['sla_state'], 'normal')
        reply = self.client.post(f'/api/conversations/{conv.id}/messages/', {'text': 'chào bạn'}, format='multipart')
        self.assertEqual(reply.status_code, 201)
        after = self.client.get(f'/api/conversations/{conv.id}/messages/', {'after': first.data['id'], 'mark_read': 1})
        self.assertEqual([m['text'] for m in after.data], ['chào bạn'])
        detail = self.client.get(f'/api/conversations/{conv.id}/')
        self.assertEqual(len(detail.data['messages']), 2)
        self.assertEqual(self.client.get('/api/conversations/', {'tab': 'waiting'}).data[0]['unread_count'], 0)

    # ---------------- Trợ lý AkinaClinic ----------------
    KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_guest_buttons_use_real_data_and_persist_history(self):
        self.make_staff()
        from core.models import Voucher
        Voucher.objects.create(code='HELLO50', title='Giảm 50K', points_cost=10, discount_value=50000, min_spend=200000)
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'services'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn(self.service.name, r.data['reply']['content'])
        self.assertIn('phút', r.data['reply']['content'])
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'promotions'}, format='json')
        self.assertIn('HELLO50', r.data['reply']['content'])
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'booking'}, format='json')
        self.assertIn('bk:svc:', r.data['reply']['content'])  # bắt đầu quy trình đặt lịch trong chat
        self.assertEqual(r.data['navigate'], '')
        # Câu hỏi tự do khi chưa có Gemini key => fallback, không lỗi
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'text': 'da mình bị khô thì sao'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['reply']['source'], 'fallback')
        # Mở lại: lịch sử còn
        r = self.client.get('/api/chatbot/session/', {'visitor_key': self.KEY})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data['messages']), 8)
        self.assertEqual([a['label'] for a in r.data['actions'][:4]], ['Dịch vụ', 'Đặt lịch', 'Khuyến mãi', 'Gặp tư vấn viên'])

    def test_chatbot_human_requires_login_then_opens_conversation(self):
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'human'}, format='json')
        self.assertIn('/login', r.data['reply']['content'])
        self.assertEqual(Conversation.objects.count(), 0)
        self.auth(self.customer)
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'human'}, format='json')
        conv = Conversation.objects.get(customer=self.customer)
        self.assertIn(f'[[link:/chat?c={conv.pk}|', r.data['reply']['content'])
        self.assertIsNone(conv.assigned_to)
        self.assertEqual(conv.messages.count(), 1)
        # bấm lần nữa không tạo ca thứ hai
        self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'human'}, format='json')
        self.assertEqual(Conversation.objects.filter(customer=self.customer).count(), 1)

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_session_of_another_user_is_not_exposed(self):
        self.auth(self.customer)
        self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'text': 'xin chào'}, format='json')
        self.client.credentials()
        r = self.client.get('/api/chatbot/session/', {'visitor_key': self.KEY})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['messages'], [])
        self.assertNotEqual(r.data['visitor_key'], self.KEY)

    def test_chatbot_faq_match_and_bad_key(self):
        from core.models import ChatbotFAQ
        ChatbotFAQ.objects.create(question='Giờ mở cửa?', answer='AkinaClinic mở cửa 8h-21h.', keywords='giờ mở cửa, mấy giờ')
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'text': 'Mấy giờ mở cửa vậy'}, format='json')
        self.assertEqual(r.data['reply']['source'], 'faq')
        self.assertIn('8h-21h', r.data['reply']['content'])
        bad = self.client.post('/api/chatbot/message/', {'visitor_key': 'x', 'text': 'hi'}, format='json')
        self.assertEqual(bad.status_code, 400)

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_contact_uses_verified_clinic_data_without_ai(self):
        response = self.client.post(
            '/api/chatbot/message/',
            {'visitor_key': self.KEY, 'text': 'Số điện thoại và địa chỉ chi nhánh Đà Nẵng?'},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['reply']['source'], 'action')
        self.assertIn('0919 005 523', response.data['reply']['content'])
        self.assertIn('0978 888 612', response.data['reply']['content'])
        self.assertIn('175 Nguyễn Văn Linh', response.data['reply']['content'])

        fallback = self.client.post(
            '/api/chatbot/message/',
            {'visitor_key': self.KEY, 'text': 'xin chào lần nữa'},
            format='json',
        )
        self.assertEqual(fallback.data['reply']['source'], 'fallback')

        followup = self.client.post(
            '/api/chatbot/message/',
            {'visitor_key': self.KEY, 'text': 'có Huế không?'},
            format='json',
        )
        self.assertEqual(followup.status_code, 200, followup.data)
        self.assertEqual(followup.data['reply']['source'], 'action')
        self.assertIn('chưa có chi nhánh tại Huế', followup.data['reply']['content'])

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'test-key'})
    @patch('api.chatbot.ai._generate')
    def test_chatbot_agent_uses_configured_model_for_free_text(self, generate):
        from core.models import ChatbotSetting

        ChatbotSetting.load()
        generate.return_value = json.dumps({
            'intent': 'answer',
            'reply': 'AkinaClinic đã ghi nhận câu hỏi của bạn.',
            'reason': 'Câu hỏi thông thường.',
        })

        response = self.client.post(
            '/api/chatbot/message/',
            {'visitor_key': self.KEY, 'text': 'Bạn có thể hỗ trợ gì cho tôi?'},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['reply']['source'], 'ai')
        self.assertEqual(generate.call_args.kwargs['model'], 'gemini-3.5-flash-lite')
        self.assertIsNotNone(generate.call_args.kwargs['json_schema'])
        self.assertIn('Hotline chung: 0919 005 523', generate.call_args.kwargs['system_instruction'])

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'test-key'})
    @patch('api.chatbot.ai._generate')
    def test_chatbot_agent_routes_medical_content_to_doctor_queue(self, generate):
        from core.models import ChatbotToolCall

        generate.return_value = json.dumps({
            'intent': 'medical',
            'reply': 'Nội dung này cần bác sĩ xem xét.',
            'reason': 'Khách hỏi phản ứng sau điều trị.',
        })
        self.auth(self.customer)

        response = self.client.post(
            '/api/chatbot/message/',
            {'visitor_key': self.KEY, 'text': 'Sau liệu trình tôi thấy một phản ứng lạ, nhờ kiểm tra giúp.'},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['reply']['source'], 'action')
        conversation = Conversation.objects.get(customer=self.customer)
        self.assertIn('bác sĩ', conversation.subject.lower())
        self.assertEqual(conversation.messages.get().text, 'Sau liệu trình tôi thấy một phản ứng lạ, nhờ kiểm tra giúp.')
        self.assertTrue(ChatbotToolCall.objects.filter(session__visitor_key=self.KEY, tool_name='route_intent').exists())

    # ---------------- Đánh giá phiên ----------------
    def test_csat_invite_and_rating_flow(self):
        consultant = User.objects.create_user(username='cskh2', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Đánh giá', assigned_to=consultant)
        self.auth(self.customer)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/csat/', {'score': 5}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/csat-invite/').status_code, 403)
        self.auth(consultant)
        invite = self.client.post(f'/api/conversations/{conv.id}/csat-invite/')
        self.assertEqual(invite.status_code, 201)
        self.assertEqual(invite.data['message_type'], 'csat')
        conv.refresh_from_db()
        self.assertEqual(conv.status, Conversation.CLOSED)
        self.assertEqual(conv.session_end_reason, 'csat_invite')
        self.assertIsNotNone(conv.csat_invited_at)
        self.auth(self.customer)
        ok = self.client.post(f'/api/conversations/{conv.id}/csat/', {'score': 4, 'comment': 'Tốt'}, format='json')
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/csat/', {'score': 1}, format='json').status_code, 400)
        self.assertTrue(conv.messages.filter(message_type='system', text__contains='4/5').exists())
        self.auth(consultant)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/csat-invite/').status_code, 400)

    def test_only_one_csat_invite_per_customer_each_day(self):
        consultant = User.objects.create_user(username='cskh_daily', password='pass12345', role='consultant')
        first = Conversation.objects.create(customer=self.customer, subject='Buổi sáng', assigned_to=consultant)
        second = Conversation.objects.create(customer=self.customer, subject='Buổi chiều', assigned_to=consultant)
        self.auth(consultant)
        self.assertEqual(self.client.post(f'/api/conversations/{first.id}/csat-invite/').status_code, 201)
        blocked = self.client.post(f'/api/conversations/{second.id}/csat-invite/')
        self.assertEqual(blocked.status_code, 400)
        self.assertIn('hôm nay', blocked.data['detail'])

    def test_previous_day_session_is_closed_on_next_chat_request(self):
        consultant = User.objects.create_user(username='cskh_expiry', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Phiên hôm qua', assigned_to=consultant)
        Conversation.objects.filter(pk=conv.pk).update(session_started_at=timezone.now() - timedelta(days=1))
        ChatSetting.load()
        self.auth(consultant)
        self.assertEqual(self.client.get('/api/conversations/').status_code, 200)
        conv.refresh_from_db()
        self.assertEqual(conv.status, Conversation.CLOSED)
        self.assertEqual(conv.session_end_reason, 'day_end')

    def test_close_adds_rating_card_once(self):
        consultant = User.objects.create_user(username='cskh3', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Đóng ca', assigned_to=consultant)
        self.auth(consultant)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/close/').status_code, 200)
        self.assertEqual(conv.messages.filter(message_type='csat').count(), 1)

    def test_consultant_can_review_own_closed_conversations(self):
        consultant = User.objects.create_user(username='cskh_archive', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Ca đã hoàn tất', assigned_to=consultant, status=Conversation.CLOSED)
        self.auth(consultant)
        rows = self.client.get('/api/conversations/', {'tab': 'closed'})
        self.assertEqual(rows.status_code, 200)
        self.assertIn(conv.id, [row['id'] for row in rows.data])

    def test_customer_message_reopens_same_thread_as_new_session(self):
        consultant = User.objects.create_user(username='cskh_reopen', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Theo dõi da', assigned_to=consultant)
        self.auth(consultant)
        invite = self.client.post(f'/api/conversations/{conv.id}/csat-invite/')
        self.assertEqual(invite.status_code, 201)
        self.auth(self.customer)
        rated = self.client.post(f'/api/conversations/{conv.id}/csat/', {'score': 5, 'comment': 'Tốt', 'message_id': invite.data['id']}, format='json')
        self.assertEqual(rated.status_code, 200, rated.data)
        reopened = self.client.post(f'/api/conversations/{conv.id}/messages/', {'text': 'Tôi cần hỗ trợ thêm'}, format='json')
        self.assertEqual(reopened.status_code, 201, reopened.data)
        self.assertTrue(reopened.data['session_reopened'])
        conv.refresh_from_db()
        self.assertEqual(conv.status, Conversation.OPEN)
        self.assertIsNone(conv.assigned_to)
        sessions = list(ConversationSession.objects.filter(conversation=conv).order_by('sequence'))
        self.assertEqual(len(sessions), 2)
        self.assertEqual(sessions[0].csat_score, 5)
        self.assertIsNone(sessions[1].ended_at)

    # ---------------- Thẻ phân loại ----------------
    def test_tag_management_and_conversation_filters(self):
        consultant = User.objects.create_user(username='cskh4', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Thẻ', assigned_to=consultant)
        conv2 = Conversation.objects.create(customer=self.customer, subject='Không thẻ', assigned_to=consultant)
        self.auth(self.customer)
        self.assertEqual(self.client.get('/api/tags/').status_code, 403)
        self.auth(consultant)
        made = self.client.post('/api/tags/', {'name': 'Khách VIP', 'color': '#ef4444'}, format='json')
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual(self.client.post('/api/tags/', {'name': 'khách vip'}, format='json').status_code, 400)
        tid = made.data['id']
        self.assertEqual(self.client.patch(f'/api/tags/{tid}/', {'color': '#22c55e'}, format='json').data['color'], '#22c55e')
        self.client.post(f'/api/conversations/{conv.id}/toggle-tag/', {'tag_id': tid}, format='json')
        rows = self.client.get('/api/conversations/', {'tab': 'mine', 'tag': str(tid)}).data
        self.assertEqual([r['id'] for r in rows], [conv.id])
        self.assertEqual(rows[0]['tags'][0]['name'], 'Khách VIP')
        Message.objects.create(conversation=conv2, sender=self.customer, text='chưa đọc')
        unread = self.client.get('/api/conversations/', {'tab': 'mine', 'unread': '1'}).data
        self.assertEqual([r['id'] for r in unread], [conv2.id])
        self.assertEqual(self.client.delete(f'/api/tags/{tid}/').status_code, 204)

    # ---------------- Trợ lý AkinaClinic: quy trình đặt lịch ----------------
    def _bot(self, **kw):
        kw.setdefault('visitor_key', self.KEY)
        r = self.client.post('/api/chatbot/message/', kw, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        return r.data['reply']['content']

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    @patch('api.views._queue_email')
    def test_chatbot_booking_flow_creates_real_booking_only_on_confirm(self, _email):
        staff = self.make_staff()
        self.auth(self.customer)
        day = (timezone.localdate() + timedelta(days=2)).isoformat()
        self.assertIn(f'bk:svc:{self.service.id}', self._bot(action='booking'))
        self.assertIn('bk:date:', self._bot(action=f'bk:svc:{self.service.id}', text='Facial'))
        self.assertIn(f'bk:staff:{staff.id}', self._bot(action=f'bk:date:{day}', text='ngày'))
        self.assertIn('bk:time:1000', self._bot(action='bk:staff:0', text='Bất kỳ'))
        confirm = self._bot(action='bk:time:1000', text='10:00')
        self.assertIn('XÁC NHẬN LỊCH HẸN', confirm)
        self.assertIn('bk:confirm', confirm)
        self.assertEqual(Booking.objects.count(), 0)  # chưa xác nhận => chưa có lịch
        done = self._bot(action='bk:confirm', text='Xác nhận')
        self.assertIn('Đặt lịch thành công', done)
        b = Booking.objects.get()
        self.assertEqual((b.user, b.staff, b.total), (self.customer, staff, 0))
        # Bấm lại nút Xác nhận cũ không tạo thêm lịch
        self._bot(action='bk:confirm', text='Xác nhận')
        self.assertEqual(Booking.objects.count(), 1)

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_booking_requires_login_to_confirm_and_keeps_state(self):
        self.make_staff()
        day = (timezone.localdate() + timedelta(days=2)).isoformat()
        for action in (f'bk:svc:{self.service.id}', f'bk:date:{day}', 'bk:staff:0', 'bk:time:1000'):
            self._bot(action=action, text='x')
        reply = self._bot(action='bk:confirm', text='Xác nhận')
        self.assertIn('đăng nhập', reply)
        self.assertEqual(Booking.objects.count(), 0)
        # Đăng nhập xong, cùng visitor_key => xác nhận tiếp được
        self.auth(self.customer)
        self.assertIn('Đặt lịch thành công', self._bot(action='bk:confirm', text='Xác nhận'))
        self.assertEqual(Booking.objects.count(), 1)

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_booking_free_text_prefills_and_rejects_taken_slot(self):
        staff = self.make_staff()
        tomorrow = timezone.localdate() + timedelta(days=1)
        taken = timezone.make_aware(timezone.datetime.combine(tomorrow, timezone.datetime.min.time().replace(hour=15)))
        Booking.objects.create(staff=staff, appointment=taken, guest_name='A', guest_phone='1', total=1)  # trùng 15:00
        # (Booking không có items => thời lượng mặc định 60 phút)
        reply = self._bot(text='Facial mai 15h đặt được không')
        self.assertNotIn('XÁC NHẬN LỊCH HẸN', reply)      # giờ đã kín: không được xác nhận
        self.assertIn('bk:time:', reply)                   # gợi ý giờ khác thật từ backend
        self.assertNotIn('bk:time:1500', reply)
        reply = self._bot(text='Facial mai 10h đặt được không')
        self.assertIn('XÁC NHẬN LỊCH HẸN', reply)
        self.assertIn('10:00', reply)

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_account_intents_and_medical_agent_handoff(self):
        self.assertIn('đăng nhập', self._bot(text='lịch của tôi'))
        self.customer.loyalty_points = 1234
        self.customer.save(update_fields=['loyalty_points'])
        self.auth(self.customer)
        self.assertIn('1.234', self._bot(text='điểm thành viên của tôi'))
        self.assertIn('bk:svc:', self._bot(text='giá facial test bao nhiêu'))
        self.assertIn('350.000', self._bot(text='giá facial test bao nhiêu'))
        reply = self._bot(text='tôi bị dị ứng thuốc thì dùng được không')
        self.assertIn('Mở cuộc trò chuyện với CSKH', reply)
        self.assertEqual(Conversation.objects.count(), 1)
        self.assertIn('Mở cuộc trò chuyện với CSKH', self._bot(text='tôi muốn gặp bác sĩ'))
        self.assertEqual(Conversation.objects.count(), 1)

    def test_payroll_uses_staff_commission_rate_and_exposes_basis(self):
        staff_user = User.objects.create_user(username='doctor-commission', password='pass12345', role='doctor')
        staff = Staff.objects.create(
            user=staff_user, name='Bác sĩ Hoa hồng', position='Bác sĩ', commission_rate='12.50'
        )
        Booking.objects.create(
            user=self.customer, staff=staff, appointment=self.slot(), status=Booking.COMPLETED, total=800000
        )
        self.auth(self.manager)
        response = self.client.get('/api/dashboard/payroll/')
        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.data['rows'] if item['id'] == staff.id)
        self.assertEqual(row['commission_base'], 800000)
        self.assertEqual(float(row['commission_rate']), 12.5)
        self.assertEqual(row['commission'], 100000)
