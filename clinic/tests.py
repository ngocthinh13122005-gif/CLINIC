from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from core.models import Booking, Category, Service, Staff
from .models import MedicalRecord, Patient, PatientImage, TreatmentPlan, TreatmentSession, Visit
from .serializers import PatientImageSerializer

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class ClinicFlowTests(APITestCase):
    def setUp(self):
        mk = lambda n, r: User.objects.create_user(username=n, password='pass12345', role=r, first_name=n)
        self.manager, self.doctor, self.doctor2, self.cskh, self.nurse, self.customer = (
            mk('manager1', 'manager'), mk('doc1', 'doctor'), mk('doc2', 'doctor'), mk('cskh1', 'consultant'),
            mk('nurse1', 'staff'), mk('cust1', 'customer'))

    def auth(self, user):
        t, _ = Token.objects.get_or_create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')

    def new_patient(self, **kw):
        self.auth(self.cskh)
        data = dict(full_name='Nguyễn Văn A', phone='0901 234 567', gender='male', allergies='Penicillin',
                    chronic_conditions='Tiểu đường')
        data.update(kw)
        return self.client.post('/api/clinic/patients/', data, format='json')

    def test_customer_cannot_access(self):
        self.auth(self.customer)
        self.assertEqual(self.client.get('/api/clinic/patients/').status_code, 403)
        self.assertEqual(self.client.get('/api/clinic/visits/board/').status_code, 403)

    def test_patient_image_url_uses_current_origin(self):
        patient = Patient.objects.create(full_name='Ảnh Test', phone='0909999999')
        image = PatientImage(patient=patient, image='clinic/patients/test.png')
        self.assertEqual(PatientImageSerializer(image).data['url'], '/media/clinic/patients/test.png')

    def test_patient_create_code_phone_and_duplicate(self):
        r = self.new_patient()
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(r.data['code'].startswith('BN'))
        self.assertNotIn('chronic_conditions', r.data)            # CSKH không thấy dữ liệu lâm sàng
        self.assertEqual(r.data['allergies'], 'Penicillin')        # nhưng thấy cảnh báo dị ứng
        self.assertEqual(Patient.objects.get().phone, '0901234567')
        self.assertEqual(Patient.objects.get().chronic_conditions, '')  # CSKH ghi trường lâm sàng bị bỏ qua
        dup = self.new_patient()
        self.assertEqual(dup.status_code, 400)
        self.auth(self.doctor)
        d = self.client.get(f'/api/clinic/patients/{r.data["id"]}/')
        self.assertEqual(d.status_code, 200)

    def test_walk_in_flow_to_signed_record(self):
        pid = self.new_patient().data['id']
        v = self.client.post('/api/clinic/visits/', {'patient': pid, 'reason': 'Nổi mụn'}, format='json')
        self.assertEqual(v.status_code, 201, v.data)
        vid = v.data['id']
        self.assertEqual(v.data['status'], 'waiting')
        # trùng lượt khám đang mở
        self.assertEqual(self.client.post('/api/clinic/visits/', {'patient': pid}, format='json').status_code, 400)
        board = self.client.get('/api/clinic/visits/board/').data
        self.assertEqual(board['counts']['waiting'], 1)
        # CSKH mời vào tư vấn, gán bác sĩ
        c = self.client.post(f'/api/clinic/visits/{vid}/call/', {'doctor': self.doctor.id}, format='json')
        self.assertEqual(c.data['status'], 'in_consult')
        # CSKH không đọc/ghi được bệnh án
        self.assertEqual(self.client.post(f'/api/clinic/visits/{vid}/record/').status_code, 403)
        # bác sĩ khác chỉ thấy ca của mình/chưa gán
        self.auth(self.doctor2)
        self.assertEqual(self.client.get(f'/api/clinic/visits/{vid}/').status_code, 404)
        # bác sĩ phụ trách mở bệnh án
        self.auth(self.doctor)
        rec = self.client.post(f'/api/clinic/visits/{vid}/record/')
        self.assertEqual(rec.status_code, 200, rec.data)
        rid = rec.data['id']
        self.assertEqual(rec.data['chief_complaint'], 'Nổi mụn')
        # chưa đủ thông tin → không ký được
        self.assertEqual(self.client.post(f'/api/clinic/records/{rid}/sign/').status_code, 400)
        p = self.client.patch(f'/api/clinic/records/{rid}/', {
            'examination': 'Sẩn viêm má', 'diagnosis_code': 'L70.0', 'diagnosis_name': 'Mụn trứng cá',
            'marks': [{'region': 'left_cheek', 'lesion_type': 'papule', 'severity': 2, 'note': ''}]}, format='json')
        self.assertEqual(p.status_code, 200, p.data)
        self.assertEqual(len(p.data['marks']), 1)
        # chưa ký → không kết thúc được lượt khám
        self.assertEqual(self.client.post(f'/api/clinic/visits/{vid}/complete/').status_code, 400)
        s = self.client.post(f'/api/clinic/records/{rid}/sign/')
        self.assertEqual(s.status_code, 200)
        self.assertEqual(len(s.data['signature_hash']), 64)
        # sau ký: khóa, chỉ phụ lục
        self.assertEqual(self.client.patch(f'/api/clinic/records/{rid}/', {'examination': 'đổi'}, format='json').status_code, 403)
        a = self.client.post(f'/api/clinic/records/{rid}/addendum/', {'content': 'Bổ sung dặn dò'}, format='json')
        self.assertEqual(len(a.data['addenda']), 1)
        self.assertEqual(self.client.post(f'/api/clinic/visits/{vid}/complete/').data['status'], 'completed')
        # chỉ quản lý được mở khóa, cần lý do
        self.assertEqual(self.client.post(f'/api/clinic/records/{rid}/unlock/', {'reason': 'sai sót'}, format='json').status_code, 403)
        self.auth(self.manager)
        self.assertEqual(self.client.post(f'/api/clinic/records/{rid}/unlock/', {'reason': 'x'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'/api/clinic/records/{rid}/unlock/', {'reason': 'Sửa sai chính tả'}, format='json').status_code, 200)
        self.assertEqual(MedicalRecord.objects.get().status, 'draft')

    def test_from_booking_creates_patient_and_visit(self):
        cat = Category.objects.create(name='Khám')
        svc = Service.objects.create(category=cat, name='Khám da liễu', price=200000, duration=30)
        prof = Staff.objects.create(name='BS Doc', position='BS', user=self.doctor)
        prof.services.add(svc)
        b = Booking.objects.create(guest_name='Khách Online', guest_phone='0988 111 222', staff=prof,
                                   appointment=timezone.now() + timedelta(hours=2), status=Booking.PENDING)
        self.auth(self.cskh)
        r = self.client.post('/api/clinic/visits/from-booking/', {'booking_id': b.id}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data['source'], 'appointment')
        self.assertEqual(r.data['doctor'], self.doctor.id)
        b.refresh_from_db()
        self.assertEqual(b.status, 'checked_in')
        self.assertIsNotNone(b.patient)
        self.assertEqual(self.client.post('/api/clinic/visits/from-booking/', {'booking_id': b.id}, format='json').status_code, 400)
        # hoàn tất lượt khám → lịch hẹn hoàn thành
        self.client.post(f'/api/clinic/visits/{r.data["id"]}/call/')
        self.assertEqual(
            self.client.post(f'/api/clinic/visits/{r.data["id"]}/complete/').status_code,
            403,
        )
        self.auth(self.doctor)
        self.client.post(f'/api/clinic/visits/{r.data["id"]}/complete/')
        b.refresh_from_db()
        self.assertEqual(b.status, 'completed')

    def test_from_booking_does_not_match_patient_by_shared_phone(self):
        Patient.objects.create(full_name='Người thân A', phone='0988111222')
        Patient.objects.create(full_name='Người thân B', phone='0988111222')
        booking = Booking.objects.create(
            guest_name='Khách đặt lịch',
            guest_phone='0988 111 222',
            appointment=timezone.now() + timedelta(hours=2),
            status=Booking.PENDING,
        )
        self.auth(self.cskh)

        response = self.client.post(
            '/api/clinic/visits/from-booking/',
            {'booking_id': booking.pk},
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        booking.refresh_from_db()
        self.assertNotIn(booking.patient.full_name, {'Người thân A', 'Người thân B'})
        self.assertEqual(booking.patient.full_name, booking.guest_name)
        self.assertEqual(booking.patient.phone, '0988111222')

    def test_treatment_plan_sessions(self):
        pid = self.new_patient().data['id']
        self.auth(self.cskh)
        self.assertEqual(self.client.post('/api/clinic/plans/', {'patient': pid, 'title': 'X', 'total_sessions': 3}, format='json').status_code, 403)
        self.auth(self.doctor)
        p = self.client.post('/api/clinic/plans/', {'patient': pid, 'title': 'Peel', 'total_sessions': 3, 'interval_days': 10,
                                                    'diagnosis': 'L70.0', 'price': 900000}, format='json')
        self.assertEqual(p.status_code, 201, p.data)
        self.assertEqual(len(p.data['sessions']), 3)
        plan_id, sid = p.data['id'], p.data['sessions'][0]['id']
        # chưa xác nhận → chưa ghi buổi
        self.assertEqual(self.client.post(f'/api/clinic/plans/{plan_id}/complete-session/', {'session_id': sid}, format='json').status_code, 400)
        a = self.client.post(f'/api/clinic/plans/{plan_id}/activate/')
        self.assertEqual(a.data['status'], 'active')
        self.assertIsNotNone(a.data['sessions'][1]['planned_date'])
        self.auth(self.manager)
        denied_delegation = self.client.post(
            f'/api/clinic/plans/{plan_id}/configure-session/',
            {'session_id': sid, 'allow_staff_delegation': True},
            format='json',
        )
        self.assertEqual(denied_delegation.status_code, 403)
        denied_edit = self.client.patch(
            f'/api/clinic/plans/{plan_id}/',
            {'diagnosis': 'Quản lý không được tự đổi chỉ định'},
            format='json',
        )
        self.assertEqual(denied_edit.status_code, 403)
        self.auth(self.cskh)
        scheduled = self.client.post(
            f'/api/clinic/plans/{plan_id}/schedule-session/',
            {'session_id': sid, 'planned_date': (timezone.localdate() + timedelta(days=4)).isoformat()},
            format='json',
        )
        self.assertEqual(scheduled.status_code, 200, scheduled.data)
        self.auth(self.doctor)
        delegated = self.client.post(
            f'/api/clinic/plans/{plan_id}/configure-session/',
            {'session_id': sid, 'allow_staff_delegation': True},
            format='json',
        )
        self.assertEqual(delegated.status_code, 200, delegated.data)
        self.assertTrue(next(item for item in delegated.data['sessions'] if item['id'] == sid)['allow_staff_delegation'])
        self.auth(self.nurse)
        denied = self.client.post(f'/api/clinic/plans/{plan_id}/complete-session/', {'session_id': sid, 'content': 'ok'}, format='json')
        self.assertEqual(denied.status_code, 404, denied.data)
        self.auth(self.doctor)
        d = self.client.post(f'/api/clinic/plans/{plan_id}/complete-session/', {'session_id': sid, 'content': 'ok'}, format='json')
        self.assertEqual(d.data['done_sessions'], 1)
        self.assertEqual(self.client.post(f'/api/clinic/plans/{plan_id}/complete-session/', {'session_id': sid}, format='json').status_code, 400)
        for s in d.data['sessions'][1:]:
            res = self.client.post(f'/api/clinic/plans/{plan_id}/complete-session/', {'session_id': s['id']}, format='json')
        self.assertEqual(res.data['status'], 'completed')
        # CSKH không thấy nội dung chuyên môn
        self.auth(self.cskh)
        row = self.client.get(f'/api/clinic/plans/{plan_id}/').data
        self.assertEqual(row['diagnosis'], '')

    def test_walk_in_links_active_session_without_booking(self):
        patient = Patient.objects.create(full_name='Khách liệu trình', phone='0908888777')
        supporting_visit = Visit.objects.create(patient=patient, status=Visit.COMPLETED)
        supporting_record = MedicalRecord.objects.create(
            visit=supporting_visit, patient=patient, doctor=self.doctor,
            status=MedicalRecord.SIGNED, signed_at=timezone.now(),
        )
        self.auth(self.doctor)
        plan = self.client.post('/api/clinic/plans/', {
            'patient': patient.id, 'record': supporting_record.id, 'title': 'Peel da',
            'total_sessions': 1,
        }, format='json')
        self.assertEqual(plan.status_code, 201, plan.data)
        activated = self.client.post(f'/api/clinic/plans/{plan.data["id"]}/activate/')
        self.assertEqual(activated.status_code, 200, activated.data)
        session_id = activated.data['sessions'][0]['id']

        self.auth(self.cskh)
        visit = self.client.post('/api/clinic/visits/', {
            'patient': patient.id, 'visit_type': 'session', 'treatment_session': session_id,
        }, format='json')
        self.assertEqual(visit.status_code, 201, visit.data)
        self.assertEqual(visit.data['treatment_session'], session_id)
        self.assertIsNone(TreatmentSession.objects.get(pk=session_id).record_id)
        self.assertEqual(self.client.post('/api/clinic/visits/', {
            'patient': patient.id, 'treatment_session': session_id,
        }, format='json').status_code, 400)

        self.auth(self.doctor)
        vid = visit.data['id']
        self.client.post(f'/api/clinic/visits/{vid}/call/', format='json')
        record = self.client.post(f'/api/clinic/visits/{vid}/record/', format='json')
        self.assertEqual(record.status_code, 200, record.data)
        session = TreatmentSession.objects.get(pk=session_id)
        self.assertEqual(session.record_id, record.data['id'])
        completed = self.client.post(f'/api/clinic/plans/{plan.data["id"]}/complete-session/', {
            'session_id': session_id, 'procedures': 'Peel', 'parameters': 'Mức 1',
            'patient_response': 'Ổn', 'outcome': 'Đáp ứng tốt', 'content': 'Theo dõi sau buổi',
        }, format='json')
        self.assertEqual(completed.status_code, 200, completed.data)
        self.assertEqual(completed.data['done_sessions'], 1)

    def test_treatment_plans_are_scoped_to_doctor_and_delegated_staff(self):
        service = Service.objects.create(
            category=Category.objects.create(name='Điều trị'),
            name='Laser test',
            price=500000,
            duration=30,
        )
        patient = Patient.objects.create(full_name='Bệnh nhân A', phone='0901111111')
        other_patient = Patient.objects.create(full_name='Bệnh nhân B', phone='0902222222')
        own_plan = TreatmentPlan.objects.create(
            patient=patient,
            doctor=self.doctor,
            service=service,
            title='Liệu trình của bác sĩ A',
            diagnosis='Chẩn đoán riêng',
            content='Phác đồ riêng',
            note='Ghi chú riêng',
            status=TreatmentPlan.ACTIVE,
            total_sessions=2,
        )
        own_session = TreatmentSession.objects.create(
            plan=own_plan,
            number=1,
            allow_staff_delegation=True,
        )
        TreatmentSession.objects.create(
            plan=own_plan,
            number=2,
            content='Nội dung buổi không được giao',
        )
        other_plan = TreatmentPlan.objects.create(
            patient=other_patient,
            doctor=self.doctor2,
            title='Liệu trình của bác sĩ B',
            status=TreatmentPlan.ACTIVE,
        )

        self.auth(self.doctor)
        doctor_response = self.client.get('/api/clinic/plans/')
        self.assertEqual(doctor_response.status_code, 200, doctor_response.data)
        doctor_rows = (
            doctor_response.data.get('results', doctor_response.data)
            if isinstance(doctor_response.data, dict)
            else doctor_response.data
        )
        self.assertEqual([row['id'] for row in doctor_rows], [own_plan.pk])
        self.assertEqual(
            self.client.get(f'/api/clinic/plans/{other_plan.pk}/').status_code,
            404,
        )

        staff_profile = Staff.objects.create(
            user=self.nurse,
            name='Điều dưỡng được giao',
            position='Điều dưỡng',
        )
        Booking.objects.create(
            patient=patient,
            staff=staff_profile,
            treatment_session=own_session,
            appointment=timezone.now() + timedelta(days=1),
            appointment_type=Booking.APPOINTMENT_TYPE_SESSION,
            status=Booking.CONFIRMED,
        )
        self.auth(self.nurse)
        staff_response = self.client.get('/api/clinic/plans/')
        self.assertEqual(staff_response.status_code, 200, staff_response.data)
        staff_rows = (
            staff_response.data.get('results', staff_response.data)
            if isinstance(staff_response.data, dict)
            else staff_response.data
        )
        self.assertEqual([row['id'] for row in staff_rows], [own_plan.pk])
        staff_plan = staff_rows[0]
        self.assertEqual(staff_plan['diagnosis'], '')
        self.assertEqual(staff_plan['content'], '')
        self.assertEqual(staff_plan['note'], '')
        self.assertEqual([session['id'] for session in staff_plan['sessions']], [own_session.pk])
        self.assertEqual(
            self.client.get(f'/api/clinic/plans/{other_plan.pk}/').status_code,
            404,
        )

    def test_dashboard_and_icd(self):
        self.auth(self.doctor)
        self.assertEqual(self.client.get('/api/clinic/dashboard/').status_code, 200)
        self.assertTrue(len(self.client.get('/api/clinic/icd10/?q=mụn').data) >= 1)
        self.auth(self.cskh)
        self.assertEqual(self.client.get('/api/clinic/icd10/').status_code, 403)
        self.assertEqual(self.client.get('/api/clinic/dashboard/').data['top_diagnoses'], [])

    def test_dashboard_scopes_treatment_details_by_role_and_doctor(self):
        today = timezone.localdate()
        own_patient = Patient.objects.create(full_name='Bệnh nhân của bác sĩ 1', phone='0901111111')
        other_patient = Patient.objects.create(full_name='Bệnh nhân của bác sĩ 2', phone='0901222222')
        own_plan = TreatmentPlan.objects.create(patient=own_patient, doctor=self.doctor, title='Liệu trình riêng',
                                                status=TreatmentPlan.ACTIVE)
        other_plan = TreatmentPlan.objects.create(patient=other_patient, doctor=self.doctor2, title='Liệu trình khác',
                                                  status=TreatmentPlan.ACTIVE)
        TreatmentSession.objects.create(plan=own_plan, number=1, planned_date=today)
        TreatmentSession.objects.create(plan=other_plan, number=1, planned_date=today)

        self.auth(self.doctor)
        doctor_data = self.client.get('/api/clinic/dashboard/').data
        self.assertEqual(doctor_data['active_plans'], 1)
        self.assertEqual([row['patient'] for row in doctor_data['sessions_due']], ['Bệnh nhân của bác sĩ 1'])

        self.auth(self.cskh)
        consultant_data = self.client.get('/api/clinic/dashboard/').data
        self.assertEqual(consultant_data['active_plans'], 0)
        self.assertEqual(consultant_data['sessions_due'], [])
        self.assertEqual(consultant_data['top_diagnoses'], [])

        self.auth(self.nurse)
        staff_data = self.client.get('/api/clinic/dashboard/').data
        self.assertEqual(staff_data['active_plans'], 0)
        self.assertEqual(staff_data['sessions_due'], [])

    def test_public_staff_hides_salary(self):
        Staff.objects.create(name='BS', position='BS', base_salary=9999999)
        self.client.credentials()
        rows = self.client.get('/api/staff/').data
        rows = list(rows)
        rows = rows if isinstance(rows, list) else rows['results']
        self.assertNotIn('base_salary', rows[0])
