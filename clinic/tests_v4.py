import os
import tempfile
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from . import backup
from .models import BackupLog, DataConsent, DataRequest, Invoice, MedicalRecord, Medicine, Patient, Visit

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class ComplianceTests(APITestCase):
    def setUp(self):
        mk = lambda n, r: User.objects.create_user(username=n, password='pass12345', role=r, first_name=n)
        self.manager, self.doctor, self.cskh, self.nurse = mk('m1', 'manager'), mk('d1', 'doctor'), mk('c1', 'consultant'), mk('n1', 'staff')
        self.adult = Patient.objects.create(full_name='Người lớn', phone='0911111111', address='1 Nguyễn Huệ', date_of_birth=date(1985, 1, 1))
        self.kid = Patient.objects.create(full_name='Bé An', phone='0922222222', address='2 Hai Bà Trưng', date_of_birth=timezone.localdate() - timedelta(days=365 * 3))
        self.med = Medicine.objects.create(name='Thuốc A', unit='tuýp', price=10000, stock=50)
        self.ctrl = Medicine.objects.create(name='Thuốc hướng thần', unit='viên', price=1000, stock=50, is_controlled=True)

    def auth(self, u):
        t, _ = Token.objects.get_or_create(user=u)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {t.key}')

    def rx(self, patient, items, **extra):
        v = Visit.objects.create(patient=patient, status=Visit.IN_CONSULT, doctor=self.doctor)
        self.auth(self.doctor)
        return self.client.post('/api/clinic/prescriptions/save/', {'visit': v.pk, 'issue': True, 'items': items, **extra}, format='json')

    def test_rx_required_fields(self):
        ok = [{'medicine': self.med.pk, 'quantity': 1, 'days': 7}]
        r = self.rx(self.adult, ok)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()['patient_address'], '1 Nguyễn Huệ')
        self.assertEqual(r.json()['national_status'], 'pending')
        self.assertEqual(self.rx(self.adult, [{'medicine': self.med.pk, 'quantity': 1, 'days': 31}]).status_code, 400)   # tối đa 30 ngày
        self.assertEqual(self.rx(self.adult, [{'medicine': self.med.pk, 'quantity': 1}]).status_code, 400)               # thiếu số ngày
        self.assertEqual(self.rx(self.adult, [{'medicine': self.ctrl.pk, 'quantity': 1, 'days': 3}]).status_code, 400)   # thuốc kiểm soát
        self.adult.address = ''
        self.adult.save()
        self.assertEqual(self.rx(self.adult, ok).status_code, 400)                                                         # thiếu nơi cư trú

    def test_rx_child_needs_weight_and_guardian(self):
        ok = [{'medicine': self.med.pk, 'quantity': 1, 'days': 5}]
        self.assertEqual(self.rx(self.kid, ok).status_code, 400)
        self.assertEqual(self.rx(self.kid, ok, weight_kg=14).status_code, 400)
        r = self.rx(self.kid, ok, weight_kg=14, guardian_name='Mẹ Bé An')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(30 <= r.json()['age_months'] <= 40)

    def test_national_queue_manager_only(self):
        r = self.rx(self.adult, [{'medicine': self.med.pk, 'quantity': 1, 'days': 7}]).json()
        self.assertEqual(self.client.get('/api/clinic/prescriptions/national/').status_code, 403)
        self.auth(self.manager)
        self.assertEqual(len(self.client.get('/api/clinic/prescriptions/national/').json()), 1)
        self.assertEqual(self.client.post(f"/api/clinic/prescriptions/{r['id']}/mark_sent/", {}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f"/api/clinic/prescriptions/{r['id']}/mark_sent/", {'national_code': 'QG123'}, format='json').json()['national_status'], 'sent')

    def test_data_consent_never_preticked_and_withdrawable(self):
        self.auth(self.cskh)
        body = {'patient': self.adult.pk, 'purposes': ['care', 'marketing'], 'signer_name': 'Người lớn'}
        self.assertEqual(self.client.post('/api/clinic/data-consents/', body, format='json').status_code, 400)             # chưa confirmed
        self.assertEqual(self.client.post('/api/clinic/data-consents/', {**body, 'purposes': ['marketing'], 'confirmed': True}, format='json').status_code, 400)
        r = self.client.post('/api/clinic/data-consents/', {**body, 'confirmed': True}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        cid = [c for c in r.json() if c['purpose'] == 'marketing'][0]['id']
        self.assertEqual(self.client.post(f'/api/clinic/data-consents/{cid}/withdraw/', {}, format='json').json()['status'], 'withdrawn')
        self.auth(self.nurse)
        self.assertEqual(self.client.get('/api/clinic/data-consents/').status_code, 403)

    def test_data_request_sla_and_resolution(self):
        self.auth(self.cskh)
        r = self.client.post('/api/clinic/data-requests/', {'patient': self.adult.pk, 'kind': 'access', 'detail': 'Xin bản sao'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        rid = r.json()['id']
        self.assertTrue(r.json()['due_at'])
        self.assertEqual(self.client.post(f'/api/clinic/data-requests/{rid}/resolve/', {'response': 'đã gửi'}, format='json').status_code, 403)
        self.auth(self.manager)
        self.assertEqual(self.client.post(f'/api/clinic/data-requests/{rid}/resolve/', {'response': 'ok'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'/api/clinic/data-requests/{rid}/resolve/', {'response': 'Đã cung cấp bản sao hồ sơ'}, format='json').json()['status'], 'done')
        ex = self.client.get(f'/api/clinic/compliance/patient-export/{self.adult.pk}/')
        self.assertEqual(ex.status_code, 200)
        self.assertIn('benh_nhan', ex.json())

    def test_retention_rules(self):
        v = Visit.objects.create(patient=self.adult, status=Visit.COMPLETED, doctor=self.doctor)
        rec = MedicalRecord.objects.create(visit=v, patient=self.adult, doctor=self.doctor, status='signed', signed_at=timezone.now())
        self.assertEqual(rec.retain_until().year, timezone.localdate().year + 10)
        rec.outcome = 'adverse'
        self.assertEqual(rec.retain_until().year, timezone.localdate().year + 20)
        v2 = Visit.objects.create(patient=self.kid, status=Visit.COMPLETED, doctor=self.doctor)
        rec2 = MedicalRecord.objects.create(visit=v2, patient=self.kid, doctor=self.doctor, status='signed', signed_at=timezone.now())
        self.assertGreater(rec2.retain_until().year, timezone.localdate().year + 10)      # trẻ em: đến 18 tuổi + 10 năm
        self.auth(self.manager)
        d = self.client.get('/api/clinic/compliance/retention/').json()
        self.assertEqual(d['signed'], 2)
        self.assertEqual(self.client.post(f'/api/clinic/compliance/records/{rec.pk}/flags/', {'legal_hold': True}, format='json').json()['legal_hold'], True)
        self.auth(self.cskh)
        self.assertEqual(self.client.get('/api/clinic/compliance/retention/').status_code, 403)

    def test_incident_deadline(self):
        self.auth(self.manager)
        r = self.client.post('/api/clinic/incidents/', {'kind': 'leak', 'title': 'Mất laptop', 'affected_count': 20,
                             'detected_at': (timezone.now() - timedelta(hours=80)).isoformat()}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(r.json()['overdue'])
        iid = r.json()['id']
        r2 = self.client.patch(f'/api/clinic/incidents/{iid}/', {'authority_notified_at': timezone.now().isoformat()}, format='json')
        self.assertFalse(r2.json()['overdue'])

    def test_backup_encrypted_and_verifiable(self):
        with tempfile.TemporaryDirectory() as d, override_settings():
            os.environ['BACKUP_DIR'] = d
            try:
                self.auth(self.manager)
                r = self.client.post('/api/clinic/compliance/backups/')
                self.assertEqual(r.status_code, 201, r.content)
                self.assertTrue(r.json()['verify']['ok'], r.json())
                name = r.json()['backup']['filename']
                raw = open(os.path.join(d, name), 'rb').read()
                self.assertNotIn('Bé An'.encode(), raw)                                    # không đọc được nếu chưa giải mã
                with open(os.path.join(d, name), 'ab') as f:
                    f.write(b'x')                                                    # giả lập file bị sửa
                log = BackupLog.objects.filter(kind='backup').first()
                self.assertFalse(backup.verify_backup(log).ok)
                self.auth(self.cskh)
                self.assertEqual(self.client.post('/api/clinic/compliance/backups/').status_code, 403)
            finally:
                os.environ.pop('BACKUP_DIR', None)

    def test_einvoice_buyer_and_export(self):
        inv = Invoice.objects.create(patient=self.adult, total=100000)
        inv.items.create(kind='other', name='Phí khám', quantity=1, unit_price=100000)
        self.auth(self.cskh)
        url = f'/api/clinic/invoices/{inv.pk}/'
        self.assertEqual(self.client.post(url + 'buyer/', {'buyer_name': 'Cty A', 'buyer_tax_code': '123'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url + 'buyer/', {'buyer_tax_code': '0312345678'}, format='json').status_code, 400)
        r = self.client.post(url + 'buyer/', {'buyer_name': 'Cty A', 'buyer_tax_code': '0312345678', 'request': True}, format='json')
        self.assertEqual(r.json()['einvoice_status'], 'requested')
        self.assertEqual(self.client.get('/api/clinic/einvoice-export/').status_code, 200)
        self.assertEqual(self.client.post(url + 'einvoice/', {'einvoice_no': '12'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url + 'einvoice/', {'einvoice_no': '12', 'einvoice_symbol': 'C26TAA'}, format='json').json()['einvoice_status'], 'issued')
        self.assertEqual(self.client.post(url + 'buyer/', {'buyer_name': 'Khác'}, format='json').status_code, 400)       # đã xuất, không sửa

    def test_overview_flags_demo_credentials(self):
        User.objects.create_user(username='admin', password='admin123', role='manager')
        self.auth(self.manager)
        d = self.client.get('/api/clinic/compliance/overview/').json()
        first = d['items'][0]
        self.assertEqual(first['level'], 'bad')
        self.assertIn('admin', first['detail'])
