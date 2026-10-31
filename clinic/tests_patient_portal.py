from datetime import date

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .models import (
    MedicalRecord,
    Medicine,
    Patient,
    Prescription,
    PrescriptionItem,
    TreatmentPlan,
    TreatmentSession,
    Visit,
)

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class PatientPortalTests(APITestCase):
    def setUp(self):
        self.customer = User.objects.create_user(username='portal-customer', password='pass12345', role='customer')
        self.other_customer = User.objects.create_user(username='other-customer', password='pass12345', role='customer')
        self.doctor = User.objects.create_user(username='portal-doctor', password='pass12345', role='doctor')
        self.patient = Patient.objects.create(
            full_name='Bệnh nhân A', phone='0900000001', user=self.customer,
        )
        self.other_patient = Patient.objects.create(
            full_name='Bệnh nhân B', phone='0900000002', user=self.other_customer,
        )

    def auth(self, user):
        token, _ = Token.objects.get_or_create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')

    def test_customer_sees_only_released_records_for_own_profile(self):
        completed_visit = Visit.objects.create(
            patient=self.patient, status=Visit.COMPLETED, doctor=self.doctor,
            reason='Khám da', check_in_at=timezone.now(),
        )
        MedicalRecord.objects.create(
            visit=completed_visit, patient=self.patient, doctor=self.doctor,
            status=MedicalRecord.SIGNED, signed_at=timezone.now(),
            diagnosis_name='Chẩn đoán đã ký', treatment_direction='Theo phác đồ',
            advice='Chăm sóc theo hướng dẫn', follow_up_date=date(2026, 11, 15),
        )
        draft_visit = Visit.objects.create(
            patient=self.patient, status=Visit.IN_CONSULT, doctor=self.doctor,
        )
        MedicalRecord.objects.create(
            visit=draft_visit, patient=self.patient, doctor=self.doctor,
            status=MedicalRecord.DRAFT, diagnosis_name='Không được hiển thị',
        )
        other_visit = Visit.objects.create(
            patient=self.other_patient, status=Visit.COMPLETED, doctor=self.doctor,
        )
        MedicalRecord.objects.create(
            visit=other_visit, patient=self.other_patient, doctor=self.doctor,
            status=MedicalRecord.SIGNED, signed_at=timezone.now(),
            diagnosis_name='Hồ sơ người khác',
        )

        plan = TreatmentPlan.objects.create(
            patient=self.patient, doctor=self.doctor, title='Liệu trình đang thực hiện',
            status=TreatmentPlan.ACTIVE, total_sessions=2,
        )
        TreatmentSession.objects.create(plan=plan, number=1, status=TreatmentSession.DONE)
        pending_session = TreatmentSession.objects.create(plan=plan, number=2)
        TreatmentPlan.objects.create(
            patient=self.patient, title='Liệu trình nháp', status=TreatmentPlan.DRAFT,
        )

        medicine = Medicine.objects.create(name='Thuốc theo đơn', strength='10 mg', unit='viên', cost=5000)
        rx_visit = Visit.objects.create(patient=self.patient, status=Visit.COMPLETED, doctor=self.doctor)
        issued = Prescription.objects.create(
            visit=rx_visit, patient=self.patient, doctor=self.doctor,
            status=Prescription.ISSUED, issued_at=timezone.now(), diagnosis='Đơn đã duyệt',
        )
        PrescriptionItem.objects.create(
            prescription=issued, medicine=medicine, quantity=10, dosage='1 viên mỗi ngày',
            usage='Sau ăn', days=10, unit_price=12000,
        )
        draft_rx_visit = Visit.objects.create(patient=self.patient, status=Visit.IN_CONSULT, doctor=self.doctor)
        Prescription.objects.create(
            visit=draft_rx_visit, patient=self.patient, doctor=self.doctor, status=Prescription.DRAFT,
        )

        self.auth(self.customer)
        response = self.client.get('/api/clinic/my-portal/')

        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data['patient_linked'])
        self.assertEqual(len(data['visits']), 2)
        self.assertIn('Chẩn đoán đã ký', [row['diagnosis'] for row in data['visits']])
        self.assertEqual(data['care_instructions'][0]['advice'], 'Chăm sóc theo hướng dẫn')
        self.assertEqual([row['title'] for row in data['plans']], ['Liệu trình đang thực hiện'])
        self.assertEqual(data['plans'][0]['done_sessions'], 1)
        self.assertEqual(data['plans'][0]['sessions'][1]['id'], pending_session.pk)
        self.assertTrue(data['plans'][0]['sessions'][1]['bookable'])
        self.assertIsNone(data['plans'][0]['sessions'][1]['booking'])
        self.assertEqual([row['code'] for row in data['prescriptions']], [issued.code])
        self.assertEqual(data['prescriptions'][0]['items'][0]['medicine_name'], 'Thuốc theo đơn')
        self.assertNotIn('cost', data['prescriptions'][0]['items'][0])
        self.assertNotIn('Không được hiển thị', str(data))
        self.assertNotIn('Hồ sơ người khác', str(data))
        self.assertEqual(response['Cache-Control'], 'no-store')

    def test_patient_portal_requires_customer_role(self):
        self.auth(self.doctor)
        self.assertEqual(self.client.get('/api/clinic/my-portal/').status_code, 403)

    def test_unlinked_customer_gets_empty_portal(self):
        unlinked = User.objects.create_user(username='unlinked', password='pass12345', role='customer')
        self.auth(unlinked)
        response = self.client.get('/api/clinic/my-portal/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['patient_linked'])
        self.assertEqual(response.json()['visits'], [])

    def test_portal_requires_authentication(self):
        response = self.client.get('/api/clinic/my-portal/')
        self.assertEqual(response.status_code, 401)
