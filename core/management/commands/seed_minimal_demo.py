import os
from datetime import datetime, time, timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from accounts.models import User
from clinic import inventory
from clinic.models import (
    CareContactLog, CareTask, CashierShift, ConsentForm, CRMLead, DataConsent, DataRequest,
    DebtFollowUp, EmailCampaign, Invoice, InvoiceItem, LesionMark, MailingList, MedicalRecord,
    Medicine, MarketingContact, Patient, PatientImage, Payment, Prescription, PrescriptionItem,
    PurchaseOrder, PurchaseOrderLine, RecordAddendum, Refund, Room, StockCount, StockCountLine,
    StockLot, StockMovement, Supplier, TreatmentPlan, TreatmentSession, Visit,
)
from core.models import (
    AppointmentWaitlistEntry, Booking, Category, Contact, Conversation, ConversationRead,
    ConversationSession, ConversationEvent, InternalNote, Message, Notification, Service, Staff, WorkingHours,
)


PATIENTS = (
    ('minh-chau', 'Nguyễn Minh Châu', 'female', 1995, '0901000001'),
    ('quoc-bao', 'Trần Quốc Bảo', 'male', 1991, '0901000002'),
    ('thu-ha', 'Lê Thu Hà', 'female', 1988, '0901000003'),
    ('ngoc-mai', 'Phạm Ngọc Mai', 'female', 1997, '0901000004'),
    ('thanh-tam', 'Võ Thanh Tâm', 'female', 1983, '0901000005'),
)

MEDICINES = (
    ('adapalene', 'Adapalene 0,1% gel', 'Adapalene', '0,1%', 'Gel', 'tuýp', 145000, 85000, 25, 5, 180),
    ('azelaic', 'Azelaic acid 15% gel', 'Azelaic acid', '15%', 'Gel', 'tuýp', 185000, 120000, 4, 8, 120),
    ('clindamycin', 'Clindamycin 1% gel', 'Clindamycin', '1%', 'Gel', 'tuýp', 72000, 46000, 0, 5, 180),
    ('niacinamide', 'Serum Niacinamide 10%', 'Niacinamide', '10%', 'Serum', 'chai', 360000, 230000, 7, 5, 14),
    ('ketoconazole', 'Ketoconazole 2% kem', 'Ketoconazole', '2%', 'Kem', 'tuýp', 68000, 42000, 0, 5, -5),
)


def _when(day, hour=9, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


class Command(BaseCommand):
    help = 'Tạo bộ dữ liệu demo AkinaClinic tối giản; --reset chỉ dùng trên DB phát triển cô lập.'

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true', help='Xóa dữ liệu nghiệp vụ hiện có, giữ nguyên mọi tài khoản.')

    def handle(self, *args, **options):
        if options['reset']:
            self._assert_isolated_development_database()
        with transaction.atomic():
            if options['reset']:
                self._reset_business_data()
            else:
                self._refuse_unmanaged_data()
            self._seed()
            self._validate()
        self.stdout.write(self.style.SUCCESS('Minimal demo dataset ready; existing accounts preserved.'))

    @staticmethod
    def _assert_isolated_development_database():
        db = connection.settings_dict
        if (
            not settings.DEBUG
            or os.environ.get('AKINA_DEMO_RESET_ALLOWED') != '1'
            or connection.vendor != 'mysql'
            or db.get('NAME') != 'ohio_spa'
            or db.get('HOST') != 'mysql'
        ):
            raise CommandError(
                'Từ chối reset: chỉ cho phép DB MySQL ohio_spa trên service mysql '
                'khi DEBUG=1 và AKINA_DEMO_RESET_ALLOWED=1.'
            )

    @staticmethod
    def _refuse_unmanaged_data():
        expected_phones = {row[4] for row in PATIENTS}
        expected_medicines = {row[1] for row in MEDICINES}
        patient_count = Patient.objects.count()
        patients = set(Patient.objects.values_list('phone', flat=True))
        medicines = set(Medicine.objects.values_list('name', flat=True))
        if patients and (patient_count != 5 or patients != expected_phones):
            raise CommandError('Đã có bệnh nhân ngoài bộ demo. Dùng --reset trên DB phát triển cô lập để thay thế.')
        if medicines and (len(medicines) != 5 or medicines != expected_medicines):
            raise CommandError('Đã có thuốc ngoài bộ demo. Dùng --reset trên DB phát triển cô lập để thay thế.')

    @staticmethod
    def _reset_business_data():
        EmailCampaign.objects.all().delete()
        MailingList.objects.all().delete()
        MarketingContact.objects.all().delete()
        CRMLead.objects.all().delete()

        Conversation.objects.all().delete()
        Contact.objects.all().delete()
        AppointmentWaitlistEntry.objects.all().delete()
        Booking.objects.all().delete()
        Notification.objects.all().delete()

        CareContactLog.objects.all().delete()
        CareTask.objects.all().delete()
        ConsentForm.objects.all().delete()
        DataConsent.objects.all().delete()
        DataRequest.objects.all().delete()
        PatientImage.objects.all().delete()

        ConversationRead.objects.all().delete()
        ConversationSession.objects.all().delete()
        ConversationEvent.objects.all().delete()
        InternalNote.objects.all().delete()

        Refund.objects.all().delete()
        DebtFollowUp.objects.all().delete()
        Payment.objects.all().delete()
        InvoiceItem.objects.all().delete()
        Invoice.objects.all().delete()
        CashierShift.objects.all().delete()

        PrescriptionItem.objects.all().delete()
        Prescription.objects.all().delete()
        TreatmentSession.objects.all().delete()
        TreatmentPlan.objects.all().delete()
        RecordAddendum.objects.all().delete()
        LesionMark.objects.all().delete()
        MedicalRecord.objects.all().delete()
        Visit.objects.all().delete()
        Patient.objects.all().delete()

        StockCountLine.objects.all().delete()
        StockCount.objects.all().delete()
        StockMovement.objects.all().delete()
        PurchaseOrderLine.objects.all().delete()
        PurchaseOrder.objects.all().delete()
        StockLot.objects.all().delete()
        Supplier.objects.all().delete()
        Medicine.objects.all().delete()

        Room.objects.all().delete()
        Service.objects.all().delete()
        Category.objects.all().delete()
        Staff.objects.filter(user__isnull=True).delete()

    def _seed(self):
        users = {}
        for role in User.Role.values:
            user = User.objects.filter(role=role, is_active=True).order_by('pk').first()
            if not user:
                raise CommandError(f'Cần có sẵn ít nhất một tài khoản đang hoạt động với role "{role}".')
            users[role] = user
        customers = list(User.objects.filter(role=User.Role.CUSTOMER, is_active=True).order_by('pk'))
        if not customers:
            raise CommandError('Cần có sẵn tài khoản Customer; lệnh seed không tự tạo hoặc sửa tài khoản.')
        self.users = users
        self.customers = customers
        today = timezone.localdate()
        now = timezone.now().replace(second=0, microsecond=0)

        self._catalog()
        patients = self._patients()
        visits = self._visits(patients, today)
        self._appointments(patients, visits, today, now)
        plans = self._plans(patients, visits, today)
        self._followup_appointments(patients, visits, plans, today)
        medicines = self._inventory(today, now)
        self._prescriptions(patients, visits, medicines, now)
        self._invoices(patients, visits, today, now)
        self._leads(patients)
        self._inbox(now)
        self._activities(patients, visits, plans, today, now)
        self._marketing(today, now)

    def _catalog(self):
        self.services = []
        definitions = (
            ('Khám da liễu tổng quát', 'Khám', 200000, 30),
            ('Peel da y khoa', 'Điều trị', 800000, 45),
            ('Chăm sóc da sau điều trị', 'Chăm sóc', 350000, 30),
        )
        for name, category_name, price, duration in definitions:
            category, _ = Category.objects.get_or_create(name=category_name)
            service, _ = Service.objects.get_or_create(
                name=name,
                defaults={
                    'category': category,
                    'price': price,
                    'duration': duration,
                    'description': f'{name} theo chỉ định và theo dõi của bác sĩ.',
                    'booking_policy': Service.BOOKING_ASSESSMENT,
                },
            )
            self.services.append(service)

        doctors = list(User.objects.filter(role=User.Role.DOCTOR, is_active=True).order_by('pk')[:3])
        self.doctors = []
        self.doctor_staff = []
        for index, doctor in enumerate(doctors):
            profile, _ = Staff.objects.get_or_create(
                user=doctor,
                defaults={
                    'name': doctor.get_full_name() or doctor.username,
                    'position': 'Bác sĩ da liễu',
                    'experience_years': 5 + index,
                },
            )
            profile.services.set(self.services)
            for weekday in range(6):
                WorkingHours.objects.get_or_create(
                    staff=profile,
                    weekday=weekday,
                    start_time=time(8),
                    defaults={'end_time': time(17)},
                )
            self.doctors.append(doctor)
            self.doctor_staff.append(profile)

        self.staff = Staff.objects.filter(user=self.users[User.Role.STAFF]).first()
        if not self.staff:
            self.staff = Staff.objects.create(
                user=self.users[User.Role.STAFF],
                name=self.users[User.Role.STAFF].get_full_name() or self.users[User.Role.STAFF].username,
                position='Điều dưỡng da liễu',
            )
        self.staff.services.set(self.services)
        for weekday in range(6):
            WorkingHours.objects.get_or_create(
                staff=self.staff,
                weekday=weekday,
                start_time=time(8),
                defaults={'end_time': time(17)},
            )

        self.rooms = []
        for index, (name, kind) in enumerate((
            ('Phòng khám 1', Room.CONSULT),
            ('Phòng điều trị 1', Room.TREATMENT),
            ('Phòng thủ thuật', Room.PROCEDURE),
        )):
            room, _ = Room.objects.get_or_create(name=name, defaults={'kind': kind, 'order': index})
            self.rooms.append(room)

    def _patients(self):
        result = {}
        for key, name, gender, year, phone in PATIENTS:
            patient, _ = Patient.objects.get_or_create(
                phone=phone,
                defaults={
                    'full_name': name,
                    'gender': gender,
                    'date_of_birth': datetime(year, 6, 15).date(),
                    'address': 'Hải Châu, Đà Nẵng',
                    'referral_source': 'Website',
                    'created_by': self.users[User.Role.CONSULTANT],
                },
            )
            patient.full_name = name
            patient.gender = gender
            patient.date_of_birth = datetime(year, 6, 15).date()
            patient.save(update_fields=['full_name', 'gender', 'date_of_birth', 'updated_at'])
            result[key] = patient
        return result

    def _visit(self, patient, doctor, check_in, reason, status, *, booking=None, called=None, finished=None):
        visit, created = Visit.objects.get_or_create(
            booking=booking,
            defaults={
                'patient': patient,
                'doctor': doctor,
                'attended_by': self.users[User.Role.STAFF],
                'source': Visit.APPOINTMENT if booking else Visit.WALK_IN,
                'reason': reason,
                'status': status,
                'check_in_at': check_in,
                'called_at': called,
                'finished_at': finished,
                'room': self.rooms[0],
            },
        ) if booking else (None, True)
        if not booking:
            visit = Visit.objects.filter(patient=patient, reason=reason).first()
            if visit:
                return visit
            visit = Visit.objects.create(
                patient=patient,
                doctor=doctor,
                attended_by=self.users[User.Role.STAFF],
                source=Visit.WALK_IN,
                reason=reason,
                status=status,
                check_in_at=check_in,
                called_at=called,
                finished_at=finished,
                room=self.rooms[0],
                ticket_no=1,
            )
        elif not created and visit.patient_id != patient.pk:
            raise CommandError('Lịch demo đã liên kết với hồ sơ bệnh nhân khác.')
        return visit

    def _record(self, visit, complaint, examination, diagnosis, *, signed=False, follow_up=None):
        record, _ = MedicalRecord.objects.get_or_create(
            visit=visit,
            defaults={
                'patient': visit.patient,
                'doctor': visit.doctor,
                'chief_complaint': complaint,
                'history_present': 'Triệu chứng xuất hiện vài tuần, tăng dần; chưa tự dùng thuốc kê đơn.',
                'examination': examination,
                'diagnosis_code': diagnosis[0],
                'diagnosis_name': diagnosis[1],
                'treatment_direction': 'Điều trị theo đánh giá lâm sàng, theo dõi đáp ứng và tái khám khi cần.',
                'advice': 'Dùng sản phẩm chống nắng phù hợp; liên hệ phòng khám nếu có phản ứng bất thường.',
                'follow_up_date': follow_up,
            },
        )
        if signed and record.status != MedicalRecord.SIGNED:
            signed_at = visit.finished_at or visit.check_in_at
            record.status = MedicalRecord.SIGNED
            record.signed_at = signed_at
            record.signed_by = visit.doctor
            record.signature_hash = record.compute_hash(visit.doctor_id, signed_at)
            record.save(update_fields=['status', 'signed_at', 'signed_by', 'signature_hash', 'updated_at'])
        return record

    def _visits(self, patients, today):
        old_p2 = _when(today - timedelta(days=35), 10)
        p2_history = self._visit(
            patients['quoc-bao'], self.doctors[0], old_p2, 'Tái khám mụn trứng cá', Visit.COMPLETED,
            called=old_p2 + timedelta(minutes=10), finished=old_p2 + timedelta(minutes=40),
        )
        p2_history_record = self._record(
            p2_history, 'Mụn viêm vùng má', 'Sẩn viêm nhẹ, da dầu; chưa ghi nhận dấu hiệu nhiễm trùng.',
            ('L70.0', 'Mụn trứng cá thông thường'), signed=True,
        )

        p4_time = _when(today - timedelta(days=28), 14)
        p4_visit = self._visit(
            patients['ngoc-mai'], self.doctors[0], p4_time, 'Khám mụn viêm trước liệu trình',
            Visit.COMPLETED, called=p4_time + timedelta(minutes=10), finished=p4_time + timedelta(minutes=40),
        )
        p4_record = self._record(
            p4_visit, 'Mụn viêm vùng má và cằm', 'Mụn viêm mức độ vừa, không có dấu hiệu bội nhiễm.',
            ('L70.0', 'Mụn trứng cá thông thường'), signed=True,
        )

        p5_time = _when(today - timedelta(days=45), 11)
        p5_visit = self._visit(
            patients['thanh-tam'], self.doctors[min(1, len(self.doctors) - 1)], p5_time,
            'Khám viêm da tiếp xúc', Visit.COMPLETED,
            called=p5_time + timedelta(minutes=8), finished=p5_time + timedelta(minutes=35),
        )
        p5_record = self._record(
            p5_visit, 'Ngứa và đỏ da vùng cổ', 'Ban đỏ giới hạn rõ, không rỉ dịch; bệnh nhân ngưng mỹ phẩm mới.',
            ('L23.9', 'Viêm da tiếp xúc dị ứng'), signed=True, follow_up=today + timedelta(days=7),
        )
        return {
            'p2_history': p2_history,
            'p2_history_record': p2_history_record,
            'p4': p4_visit,
            'p4_record': p4_record,
            'p5': p5_visit,
            'p5_record': p5_record,
        }

    def _plans(self, patients, visits, today):
        definitions = (
            (patients['thu-ha'], visits['draft'], 'Liệu trình chăm sóc sắc tố - nháp',
             self.services[2], TreatmentPlan.DRAFT, today, 3, 0),
            (patients['ngoc-mai'], visits['p4_record'], 'Peel da y khoa - 5 buổi',
             self.services[1], TreatmentPlan.ACTIVE, today - timedelta(days=28), 5, 2),
            (patients['thanh-tam'], visits['p5_record'], 'Phục hồi da sau viêm',
             self.services[2], TreatmentPlan.COMPLETED, today - timedelta(days=28), 2, 2),
        )
        plans = {}
        for patient, record, title, service, status, start, total, completed in definitions:
            plan, _ = TreatmentPlan.objects.get_or_create(
                patient=patient,
                title=title,
                defaults={
                    'record': record,
                    'doctor': record.doctor,
                    'service': service,
                    'diagnosis': record.diagnosis_name,
                    'content': 'Thực hiện theo chỉ định và theo dõi đáp ứng da tại từng buổi.',
                    'total_sessions': total,
                    'interval_days': 14,
                    'price': service.price * total,
                    'status': status,
                    'start_date': start,
                },
            )
            plans[patient.pk] = plan
            for number in range(1, total + 1):
                planned = start + timedelta(days=14 * (number - 1))
                session, _ = TreatmentSession.objects.get_or_create(
                    plan=plan,
                    number=number,
                    defaults={'planned_date': planned},
                )
                if number <= completed and session.status != TreatmentSession.DONE:
                    session.status = TreatmentSession.DONE
                    session.performed_by = plan.doctor
                    session.performed_at = _when(planned, 10)
                    session.content = 'Đã thực hiện theo phác đồ; không ghi nhận phản ứng bất lợi.'
                    session.save(update_fields=['status', 'performed_by', 'performed_at', 'content'])
        return plans

    def _booking(self, patient, service, doctor_staff, when, status, key, *, appointment_type, session=None,
                 follow_up_visit=None):
        booking, _ = Booking.objects.get_or_create(
            idempotency_key=f'akina-minimal-{key}',
            defaults={
                'patient': patient,
                'guest_name': patient.full_name,
                'guest_phone': patient.phone,
                'staff': doctor_staff,
                'appointment': when,
                'total': service.price,
                'status': status,
                'appointment_type': appointment_type,
                'treatment_session': session,
                'follow_up_visit': follow_up_visit,
                'note': 'Dữ liệu demo nội bộ.',
            },
        )
        if booking.patient_id != patient.pk:
            raise CommandError(f'Lịch demo "{key}" đã liên kết nhầm hồ sơ.')
        if not booking.items.exists():
            from core.models import BookingItem
            BookingItem.objects.create(booking=booking, service=service, price=service.price)
        return booking

    def _appointments(self, patients, visits, today, now):
        doctor2_staff = self.doctor_staff[min(1, len(self.doctor_staff) - 1)]
        self._booking(
            patients['minh-chau'], self.services[0], self.doctor_staff[0], _when(today + timedelta(days=1), 9),
            Booking.CONFIRMED, 'new-patient-confirmed', appointment_type=Booking.APPOINTMENT_TYPE_CONSULT,
        )
        p2_booking = self._booking(
            patients['quoc-bao'], self.services[0], self.doctor_staff[0], _when(today, 8),
            Booking.CHECKED_IN, 'checked-in-waiting', appointment_type=Booking.APPOINTMENT_TYPE_FOLLOW_UP,
            follow_up_visit=visits['p2_history'],
        )
        p2_visit, _ = Visit.objects.get_or_create(
            booking=p2_booking,
            defaults={
                'patient': patients['quoc-bao'], 'doctor': self.doctors[0],
                'attended_by': self.users[User.Role.STAFF], 'source': Visit.APPOINTMENT,
                'reason': 'Tái khám theo lịch', 'status': Visit.WAITING,
                'check_in_at': now - timedelta(minutes=20), 'room': self.rooms[0],
            },
        )
        visits['p2_now'] = p2_visit

        p3_booking = self._booking(
            patients['thu-ha'], self.services[0], doctor2_staff, _when(today, 9),
            Booking.IN_PROGRESS, 'examination-in-progress', appointment_type=Booking.APPOINTMENT_TYPE_CONSULT,
        )
        p3_visit, _ = Visit.objects.get_or_create(
            booking=p3_booking,
            defaults={
                'patient': patients['thu-ha'], 'doctor': doctor2_staff.user,
                'attended_by': self.users[User.Role.STAFF], 'source': Visit.APPOINTMENT,
                'reason': 'Mảng tăng sắc tố hai gò má', 'status': Visit.IN_CONSULT,
                'check_in_at': now - timedelta(minutes=15), 'called_at': now - timedelta(minutes=5),
                'room': self.rooms[0],
            },
        )
        visits['p3_now'] = p3_visit
        visits['draft'] = self._record(
            p3_visit, 'Da sạm hai bên gò má', 'Mảng sắc tố nâu nhạt, đối xứng; không đau, không ngứa.',
            ('L81.1', 'Nám da'),
        )

    def _followup_appointments(self, patients, visits, plans, today):
        doctor2_staff = self.doctor_staff[min(1, len(self.doctor_staff) - 1)]
        active = plans[patients['ngoc-mai'].pk]
        session3 = active.sessions.get(number=3)
        self._booking(
            patients['ngoc-mai'], self.services[1], self.doctor_staff[0], _when(today, 14, 30),
            Booking.CONFIRMED, 'treatment-session-3', appointment_type=Booking.APPOINTMENT_TYPE_SESSION,
            session=session3,
        )
        self._booking(
            patients['thanh-tam'], self.services[2], doctor2_staff, _when(today + timedelta(days=7), 11),
            Booking.PENDING, 'follow-up-pending', appointment_type=Booking.APPOINTMENT_TYPE_FOLLOW_UP,
            follow_up_visit=visits['p5'],
        )

    def _inventory(self, today, now):
        supplier1, _ = Supplier.objects.get_or_create(
            name='Công ty Dược phẩm An Tâm',
            defaults={'contact': 'Nguyễn Minh Đức', 'phone': '0236123456', 'address': 'Hải Châu, Đà Nẵng'},
        )
        supplier2, _ = Supplier.objects.get_or_create(
            name='Dược mỹ phẩm Minh Châu',
            defaults={'contact': 'Lê Thu Phương', 'phone': '0283987654', 'address': 'Quận 3, TP. Hồ Chí Minh'},
        )
        medicines = {}
        for key, name, ingredient, strength, form, unit, price, cost, stock, minimum, expiry_days in MEDICINES:
            med, _ = Medicine.objects.get_or_create(
                name=name,
                defaults={
                    'active_ingredient': ingredient,
                    'strength': strength,
                    'form': form,
                    'unit': unit,
                    'price': price,
                    'cost': cost,
                    'stock': 0,
                    'min_stock': minimum,
                    'is_prescription': True,
                },
            )
            medicines[key] = med

        receipt, _ = PurchaseOrder.objects.get_or_create(
            note='DEMO_MINIMAL: Nhập kho mẫu đã nhận',
            defaults={
                'supplier': supplier1,
                'status': PurchaseOrder.ORDERED,
                'created_by': self.users[User.Role.MANAGER],
                'expected_date': today,
                'ordered_at': now,
            },
        )
        quantities = {
            'adapalene': (25, 180),
            'azelaic': (4, 120),
            'clindamycin': (6, 180),
            'niacinamide': (7, 14),
            'ketoconazole': (5, -5),
        }
        for key, med in medicines.items():
            qty, expiry_days = quantities[key]
            PurchaseOrderLine.objects.get_or_create(
                order=receipt,
                medicine=med,
                defaults={'quantity': qty, 'unit_cost': med.cost},
            )
        if receipt.status in {PurchaseOrder.ORDERED, PurchaseOrder.PARTIAL}:
            inventory.receive_order(
                receipt,
                self.users[User.Role.MANAGER],
                [
                    {
                        'line_id': line.pk,
                        'quantity': line.quantity - line.received_qty,
                        'lot_no': f'DEMO-{line.medicine.code or line.medicine.pk}',
                        'expiry': str(today + timedelta(days=quantities[next(k for k, m in medicines.items() if m.pk == line.medicine_id)][1])),
                    }
                    for line in receipt.lines.select_related('medicine').all()
                    if line.received_qty < line.quantity
                ],
            )

        out_lot = medicines['clindamycin'].lots.filter(reference=receipt.code).first()
        if out_lot and out_lot.quantity:
            inventory.consume(
                medicines['clindamycin'], out_lot.quantity, StockMovement.OUT,
                self.users[User.Role.MANAGER], receipt.code, 'Mẫu đã xuất hết; tồn khả dụng bằng 0.',
            )
        expired_lot = medicines['ketoconazole'].lots.filter(reference=receipt.code).first()
        if expired_lot and expired_lot.quantity:
            inventory.scrap_lot(expired_lot, expired_lot.quantity, self.users[User.Role.MANAGER], 'Lô hết hạn, không cấp phát.')

        ordered, _ = PurchaseOrder.objects.get_or_create(
            note='DEMO_MINIMAL: Đơn nhập đang đặt',
            defaults={
                'supplier': supplier2, 'status': PurchaseOrder.ORDERED,
                'created_by': self.users[User.Role.MANAGER], 'expected_date': today + timedelta(days=5),
                'ordered_at': now,
            },
        )
        draft, _ = PurchaseOrder.objects.get_or_create(
            note='DEMO_MINIMAL: Đơn nhập nháp',
            defaults={'supplier': supplier1, 'status': PurchaseOrder.DRAFT,
                      'created_by': self.users[User.Role.MANAGER], 'expected_date': today + timedelta(days=10)},
        )
        for order, med, qty in (
            (ordered, medicines['adapalene'], 10),
            (draft, medicines['azelaic'], 8),
        ):
            PurchaseOrderLine.objects.get_or_create(
                order=order, medicine=med, defaults={'quantity': qty, 'unit_cost': med.cost},
            )
        return medicines

    def _prescriptions(self, patients, visits, medicines, now):
        rows = (
            (visits['p2_history'], patients['quoc-bao'], 'L70.0 - Mụn trứng cá', medicines['adapalene'], 'Bôi buổi tối', 30),
            (visits['p4'], patients['ngoc-mai'], 'L70.0 - Mụn trứng cá', medicines['azelaic'], 'Bôi vùng tổn thương', 14),
            (visits['p5'], patients['thanh-tam'], 'L23.9 - Viêm da tiếp xúc', medicines['niacinamide'], 'Dùng ngoài da theo hướng dẫn', 14),
        )
        for visit, patient, diagnosis, medicine, usage, days in rows:
            if visit.record.status != MedicalRecord.SIGNED:
                raise CommandError('Không tạo đơn thuốc cho hồ sơ lâm sàng chưa ký.')
            rx, _ = Prescription.objects.get_or_create(
                visit=visit,
                defaults={
                    'patient': patient,
                    'doctor': visit.doctor,
                    'diagnosis': diagnosis,
                    'advice': 'Sử dụng đúng hướng dẫn; ngưng dùng và liên hệ bác sĩ nếu kích ứng.',
                    'status': Prescription.ISSUED,
                    'issued_at': visit.record.signed_at or now,
                },
            )
            PrescriptionItem.objects.get_or_create(
                prescription=rx,
                medicine=medicine,
                defaults={'quantity': 1, 'dosage': '1 lần/ngày', 'usage': usage, 'days': days, 'unit_price': medicine.price},
            )

    def _invoices(self, patients, visits, today, now):
        rows = (
            (patients['minh-chau'], None, self.services[0], Invoice.UNPAID, 0, today + timedelta(days=1), 'DEMO_MINIMAL: Hóa đơn chờ thanh toán'),
            (patients['ngoc-mai'], visits['p4'], self.services[1], Invoice.PARTIAL, 400000, today + timedelta(days=7), 'DEMO_MINIMAL: Hóa đơn liệu trình thanh toán một phần'),
            (patients['thanh-tam'], visits['p5'], self.services[0], Invoice.PAID, 200000, today, 'DEMO_MINIMAL: Hóa đơn đã thanh toán'),
        )
        for patient, visit, service, status, paid_amount, due_date, note in rows:
            invoice, _ = Invoice.objects.get_or_create(
                patient=patient,
                note=note,
                defaults={
                    'visit': visit,
                    'created_by': self.users[User.Role.STAFF],
                    'due_date': due_date,
                    'payment_term': Invoice.TERM_7 if paid_amount < service.price else Invoice.TERM_IMMEDIATE,
                },
            )
            InvoiceItem.objects.get_or_create(
                invoice=invoice,
                name=service.name,
                defaults={'kind': InvoiceItem.SERVICE, 'service': service, 'quantity': 1, 'unit_price': service.price},
            )
            if paid_amount and not invoice.payments.exists():
                Payment.objects.create(
                    invoice=invoice,
                    amount=paid_amount,
                    method=Payment.CASH,
                    note='Thanh toán mô phỏng nội bộ; không phát sinh giao dịch thật.',
                    received_by=self.users[User.Role.STAFF],
                    reconciliation_status=Payment.RECONCILED,
                    reconciled_by=self.users[User.Role.MANAGER],
                    reconciled_at=now,
                    paid_at=now,
                )
            invoice.recalc()

    def _leads(self, patients):
        rows = (
            ('Nguyễn Thảo Vy', '0912000001', 'website', CRMLead.NEW, None, 'Quan tâm khám da liễu.'),
            ('Phan Minh Đức', '0912000002', 'facebook', CRMLead.CONTACTED, None, 'Đã tư vấn lịch khám; đang chờ phản hồi.'),
            (patients['thanh-tam'].full_name, patients['thanh-tam'].phone, 'referral', CRMLead.CONVERTED,
             patients['thanh-tam'], 'Đã chuyển thành hồ sơ bệnh nhân demo.'),
        )
        for name, phone, source, status, patient, note in rows:
            CRMLead.objects.get_or_create(
                phone=phone,
                defaults={
                    'name': name, 'source': source, 'status': status, 'converted_patient': patient,
                    'assigned_to': self.users[User.Role.CONSULTANT], 'note': note,
                },
            )

    def _inbox(self, now):
        rows = (
            ('Tư vấn chăm sóc da', Conversation.OPEN, None, 'Chào phòng khám, tôi muốn được tư vấn chăm sóc da.', now),
            ('Đặt lịch khám mụn', Conversation.OPEN, self.users[User.Role.CONSULTANT], 'Tôi muốn đặt lịch khám mụn trong tuần này.', now - timedelta(hours=2)),
            ('Hỏi thăm sau điều trị', Conversation.CLOSED, self.users[User.Role.CONSULTANT], 'Da đã ổn định, cảm ơn bác sĩ.', now - timedelta(days=1)),
        )
        for index, (subject, status, assigned, text, created) in enumerate(rows):
            customer = self.customers[index % len(self.customers)]
            conversation, _ = Conversation.objects.get_or_create(
                customer=customer, subject=subject, channel=Conversation.WEB,
                defaults={
                    'status': status, 'assigned_to': assigned,
                    'resolved_at': created if status == Conversation.CLOSED else None,
                    'session_started_at': created,
                    'session_ended_at': created if status == Conversation.CLOSED else None,
                    'session_end_reason': 'resolved' if status == Conversation.CLOSED else '',
                },
            )
            if not conversation.messages.exists():
                message = Message.objects.create(conversation=conversation, sender=customer, text=text)
                Message.objects.filter(pk=message.pk).update(created_at=created)

    def _activities(self, patients, visits, plans, today, now):
        rows = (
            (patients['ngoc-mai'], visits['p4'], plans[patients['ngoc-mai'].pk], 'Hỏi thăm sau buổi peel da', today, CareTask.PENDING, ''),
            (patients['quoc-bao'], visits['p2_history'], None, 'Nhắc khách xác nhận lịch tái khám', today - timedelta(days=1), CareTask.PENDING, ''),
            (patients['thanh-tam'], visits['p5'], plans[patients['thanh-tam'].pk], 'Theo dõi sau điều trị', today - timedelta(days=1), CareTask.DONE, 'Khách báo tình trạng da ổn định.'),
        )
        for patient, visit, plan, title, due, status, outcome in rows:
            task, created = CareTask.objects.get_or_create(
                patient=patient,
                title=title,
                defaults={
                    'visit': visit, 'plan': plan, 'kind': CareTask.POST_CARE,
                    'due_date': due, 'status': status, 'assigned_to': self.users[User.Role.CONSULTANT],
                    'outcome': outcome,
                    'completed_at': now - timedelta(hours=2) if status == CareTask.DONE else None,
                    'completed_by': self.users[User.Role.CONSULTANT] if status == CareTask.DONE else None,
                },
            )

    def _marketing(self, today, now):
        mailing_list, _ = MailingList.objects.get_or_create(
            name='Demo - chưa gửi ra ngoài',
            defaults={'description': 'Danh sách thử nghiệm rỗng; không có người nhận thật.',
                      'created_by': self.users[User.Role.MANAGER]},
        )
        rows = (
            ('Nội dung chăm sóc da mùa khô', EmailCampaign.DRAFT, None, None),
            ('Nhắc lịch tái khám mô phỏng', EmailCampaign.SCHEDULED, _when(today + timedelta(days=2), 9), None),
            ('Thông tin chăm sóc sau peel - mô phỏng', EmailCampaign.SENT, None, now - timedelta(days=1)),
        )
        for name, status, scheduled, sent in rows:
            EmailCampaign.objects.get_or_create(
                name=name,
                defaults={
                    'subject': name,
                    'preview_text': 'Dữ liệu mô phỏng nội bộ; không gửi email thật.',
                    'body_html': '<p>Nội dung mẫu AkinaClinic.</p>',
                    'mailing_list': mailing_list,
                    'status': status,
                    'scheduled_at': scheduled,
                    'sent_at': sent,
                    'recipient_count': 0,
                    'sent_count': 0,
                    'failed_count': 0,
                    'created_by': self.users[User.Role.MANAGER],
                },
            )

    @staticmethod
    def _validate():
        expected_patients = {row[4] for row in PATIENTS}
        expected_medicines = {row[1] for row in MEDICINES}
        if Patient.objects.count() != 5 or set(Patient.objects.values_list('phone', flat=True)) != expected_patients:
            raise CommandError('Bộ demo phải có chính xác 5 bệnh nhân đã định danh.')
        if Medicine.objects.count() != 5 or set(Medicine.objects.values_list('name', flat=True)) != expected_medicines:
            raise CommandError('Bộ demo phải có chính xác 5 thuốc.')
        if Booking.objects.count() != 5:
            raise CommandError('Bộ demo phải có đúng 5 lịch liên kết với 5 bệnh nhân.')
        if {Booking.CONFIRMED, Booking.CHECKED_IN, Booking.IN_PROGRESS, Booking.PENDING} - set(
            Booking.objects.values_list('status', flat=True)
        ):
            raise CommandError('Thiếu trạng thái lịch hẹn demo bắt buộc.')
        if Visit.objects.count() != 5 or set(Visit.objects.values_list('status', flat=True)) != {
            Visit.WAITING, Visit.IN_CONSULT, Visit.COMPLETED,
        }:
            raise CommandError('Bộ demo phải có lượt chờ, đang khám và đã hoàn tất.')
        if MedicalRecord.objects.count() != 4 or MedicalRecord.objects.filter(status=MedicalRecord.DRAFT).count() != 1:
            raise CommandError('Bộ demo phải có một bệnh án nháp và các bệnh án đã ký.')
        if TreatmentPlan.objects.count() != 3:
            raise CommandError('Bộ demo phải có ba liệu trình.')
        active = TreatmentPlan.objects.get(status=TreatmentPlan.ACTIVE)
        if active.total_sessions != 5 or active.sessions.filter(status=TreatmentSession.DONE).count() != 2:
            raise CommandError('Tiến độ liệu trình demo phải là 2/5 buổi.')
        if Invoice.objects.count() != 3:
            raise CommandError('Bộ demo phải có ba hóa đơn.')
        for invoice in Invoice.objects.all():
            if invoice.total != invoice.paid + invoice.balance:
                raise CommandError(f'Hóa đơn {invoice.code} không cân đối.')
            if invoice.paid != sum(invoice.payments.values_list('amount', flat=True)):
                raise CommandError(f'Tổng thanh toán hóa đơn {invoice.code} không khớp.')
        if Prescription.objects.count() != 3 or Prescription.objects.exclude(
            visit__record__status=MedicalRecord.SIGNED
        ).exists():
            raise CommandError('Mỗi đơn demo phải liên kết với bệnh án đã ký.')
        if CRMLead.objects.count() != 3 or set(CRMLead.objects.values_list('status', flat=True)) != {
            CRMLead.NEW, CRMLead.CONTACTED, CRMLead.CONVERTED,
        }:
            raise CommandError('Bộ demo phải có ba lead ở đủ trạng thái.')
        if Conversation.objects.count() != 3 or CareTask.objects.count() != 3 or EmailCampaign.objects.count() != 3:
            raise CommandError('Số lượng hội thoại, hoạt động hoặc chiến dịch demo không đúng.')
        if set(EmailCampaign.objects.values_list('status', flat=True)) != {
            EmailCampaign.DRAFT, EmailCampaign.SCHEDULED, EmailCampaign.SENT,
        }:
            raise CommandError('Thiếu trạng thái chiến dịch demo bắt buộc.')
        if not CRMLead.objects.filter(status=CRMLead.CONVERTED, converted_patient__isnull=False).exists():
            raise CommandError('Lead đã chuyển đổi phải liên kết với hồ sơ bệnh nhân.')
        for medicine in Medicine.objects.all():
            if medicine.stock != sum(medicine.lots.values_list('quantity', flat=True)):
                raise CommandError(f'Tồn kho {medicine.name} không khớp tổng lô.')
            if medicine.stock != sum(medicine.movements.values_list('quantity', flat=True)):
                raise CommandError(f'Tồn kho {medicine.name} không khớp biến động kho.')
        expired = Medicine.objects.get(name='Ketoconazole 2% kem')
        if expired.stock or expired.lots.filter(expiry_date__lt=timezone.localdate(), quantity__gt=0).exists():
            raise CommandError('Lô đã hết hạn không được còn hàng để cấp phát.')
