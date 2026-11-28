"""Add presentation data without resetting records or sending notifications."""

from datetime import date, datetime, time, timedelta, timezone as datetime_timezone

from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from clinic.models import DataConsent, MedicalRecord, Patient, Room, Visit
from core.availability import slot_error
from core.models import (
    Booking, BookingItem, Category, Conversation, ConversationSession, Message,
    RosterShift, Service, Staff, WorkingHours,
)
from core.management.commands.seed_minimal_demo import PATIENTS


DOCTORS = (
    ('demoBacSi', 'Nguyễn Văn An', 8),
    ('demoBacSi2', 'Lê Thu Hiền', 6),
    ('demoBacSi3', 'Trần Minh Khang', 10),
)
EXTRA_PATIENTS = (
    'Nguyễn Thảo Vy', 'Phan Minh Đức', 'Đặng Ngọc Anh', 'Bùi Hoàng Nam',
    'Huỳnh Mỹ Linh', 'Đỗ Gia Huy', 'Trương Bảo Ngọc',
)
PREFIX = 'akina-presentation-v1'
SUBJECT = '[Demo] Theo dõi khám da và nhắc lịch tái khám'


def at(day, hour, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


class Command(BaseCommand):
    help = 'Bổ sung 3 bác sĩ, lịch đến hết tuần sau, hồ sơ và chat demoKhachHang; không xóa dữ liệu.'

    def add_arguments(self, parser):
        parser.add_argument('--start', type=date.fromisoformat, help='Ngày bắt đầu YYYY-MM-DD; mặc định hôm nay.')
        parser.add_argument('--days', type=int, help='Số ngày (1–31); mặc định đến hết Chủ nhật tuần sau.')
        parser.add_argument('--customer-email', help='Email nhận thư thử nghiệm của demoKhachHang.')

    @transaction.atomic
    def handle(self, *args, **options):
        start = options['start'] or timezone.localdate()
        days = options['days'] if options['days'] is not None else 14 - start.weekday()
        if not 1 <= days <= 31:
            raise CommandError('--days phải nằm trong khoảng 1–31.')
        email = options.get('customer_email')
        if email:
            validate_email(email)
        self.customer = self._account('demoKhachHang', User.Role.CUSTOMER)
        self.consultant = (User.objects.filter(username__iexact='demoCSKH', role=User.Role.CONSULTANT, is_active=True).first()
                           or User.objects.filter(role=User.Role.CONSULTANT, is_active=True).order_by('pk').first())
        if self.consultant is None:
            raise CommandError('Cần ít nhất một tài khoản CSKH đang hoạt động để phụ trách hội thoại demo.')
        self.services = self._services()
        self.doctors = self._doctors()
        self.patient = self._customer_patient(email)
        history = self._history(start)
        self._chat()
        patients = self._calendar_patients()
        created = 0
        for offset in range(days):
            day = start + timedelta(days=offset)
            for doctor_index, staff in enumerate(self.doctors):
                RosterShift.objects.get_or_create(staff=staff, date=day, defaults={'note': 'Ca trực demo báo cáo.'})
                for slot, (hour, minute) in enumerate(((8, 30), (10, 0), (14, 0), (15, 30))):
                    patient = patients[(doctor_index * 4 + slot + offset) % len(patients)]
                    # One follow-up per week for the portal account, rather than daily visits.
                    is_customer = doctor_index == 0 and slot == 1 and day.weekday() == 2
                    if is_customer:
                        patient = self.patient
                    service = self.services[0 if is_customer else (slot + doctor_index) % len(self.services)]
                    key = f'{PREFIX}-{day.isoformat()}-{doctor_index}-{slot}'
                    existing = Booking.objects.filter(idempotency_key=key).first()
                    if existing:
                        # Do not undo a teacher's confirmations, check-ins, cancellations or edits.
                        continue
                    when = self._free_slot(staff, patient, day, hour, minute, service.duration)
                    if when is None:
                        raise CommandError(f'Không còn chỗ cho lịch demo {staff.name}, {day}; không thay đổi lịch hiện có.')
                    status = Booking.PENDING if (slot + doctor_index + offset) % 4 == 0 else Booking.CONFIRMED
                    booking = Booking.objects.create(
                        idempotency_key=key, patient=patient,
                        user=self.customer if is_customer else None,
                        guest_name='' if is_customer else patient.full_name,
                        guest_phone='' if is_customer else patient.phone,
                        staff=staff, appointment=when, status=status, total=service.price,
                        confirm_state=Booking.CONFIRM_STATE_CONFIRMED if status == Booking.CONFIRMED
                        else Booking.CONFIRM_STATE_UNCONFIRMED,
                        appointment_type=Booking.APPOINTMENT_TYPE_FOLLOW_UP if is_customer
                        else Booking.APPOINTMENT_TYPE_CONSULT,
                        follow_up_visit=history if is_customer else None,
                        note='Dữ liệu mô phỏng để trình bày báo cáo; không gửi thông báo tự động.',
                    )
                    BookingItem.objects.create(booking=booking, service=service, price=service.price)
                    created += 1
        self.stdout.write(self.style.SUCCESS(
            f'Demo ready: 3 doctors; {start} – {start + timedelta(days=days - 1)}; '
            f'{created} new appointments; patient={self.patient.code}; email={self.patient.email or "(chưa có)"}.'
        ))
        if not self.patient.email:
            self.stdout.write(self.style.WARNING('Chưa có email: bổ sung --customer-email trước khi thử gửi thư.'))

    @staticmethod
    def _account(username, role):
        user = User.objects.filter(username__iexact=username).first()
        if not user or user.role != role or not user.is_active:
            raise CommandError(f'Cần tài khoản {username} đang hoạt động với vai trò {role}.')
        return user

    @staticmethod
    def _services():
        category, _ = Category.objects.get_or_create(name='Khám')
        service, _ = Service.objects.get_or_create(
            name='Khám da liễu tổng quát',
            defaults={'category': category, 'price': 200000, 'duration': 30},
        )
        if not service.is_active:
            raise CommandError('Dịch vụ khám da liễu tổng quát đang ngừng cung cấp.')
        return [service] + list(Service.objects.filter(is_active=True).exclude(pk=service.pk).order_by('pk')[:2])

    def _doctors(self):
        doctors = []
        for username, name, experience in DOCTORS:
            user = User.objects.filter(username__iexact=username).first()
            if user and (user.role != User.Role.DOCTOR or not user.is_active):
                raise CommandError(f'{username} đã tồn tại với vai trò/trạng thái khác; không tự ghi đè.')
            if user is None:
                user = User.objects.create_user(
                    username=username, password='Demo@123', role=User.Role.DOCTOR,
                    first_name=name, last_name='(Demo)', must_change_password=False,
                )
            staff, created = Staff.objects.get_or_create(
                user=user, defaults={'name': f'BS. {name} (Demo)', 'position': 'Bác sĩ da liễu',
                                     'experience_years': experience},
            )
            if not created and staff.name in ('Bác sĩ Demo', 'Demo Bác sĩ', 'demoBacSi'):
                staff.name = f'BS. {name} (Demo)'
                staff.save(update_fields=['name'])
            if not staff.is_active:
                raise CommandError(f'{staff.name} đã ngừng làm việc.')
            staff.services.add(*self.services)
            for weekday in range(7):
                if not staff.working_hours.filter(weekday=weekday).exists():
                    WorkingHours.objects.create(staff=staff, weekday=weekday, start_time=time(8), end_time=time(17))
            doctors.append(staff)
        return doctors

    def _customer_patient(self, email):
        if email:
            self.customer.email = email
        if not self.customer.phone:
            self.customer.phone = '0901999999'
        self.customer.save(update_fields=['email', 'phone'])
        patient = Patient.objects.filter(user=self.customer).first()
        if patient is None:
            candidates = Patient.objects.filter(user__isnull=True, phone=self.customer.phone)
            if candidates.count() > 1:
                raise CommandError('Có nhiều hồ sơ cùng số điện thoại demoKhachHang; cần chọn hồ sơ liên kết.')
            patient = candidates.first()
            if patient:
                patient.user = self.customer
                patient.save(update_fields=['user', 'updated_at'])
            else:
                patient = Patient.objects.create(
                    user=self.customer, full_name=self.customer.get_full_name() or self.customer.username,
                    phone=self.customer.phone, email=self.customer.email,
                    gender=Patient.OTHER, date_of_birth=date(2000, 1, 15),
                    address='Đà Nẵng (hồ sơ mô phỏng)', referral_source='Website – tài khoản demo',
                    created_by=self.consultant,
                )
        if self.customer.email and (email or not patient.email):
            patient.email = self.customer.email
            patient.save(update_fields=['email', 'updated_at'])
        Booking.objects.filter(user=self.customer, patient__isnull=True).update(patient=patient)
        for purpose in ('care', 'contact'):
            if not patient.data_consents.filter(purpose=purpose).exists():
                DataConsent.objects.create(
                    patient=patient, purpose=purpose, method='demo', signer_name=patient.full_name,
                    recorded_by=self.consultant, note='Dữ liệu đồng ý mô phỏng cho tài khoản demo; không phải hồ sơ khách thật.',
                )
        return patient

    def _history(self, start):
        room, _ = Room.objects.get_or_create(name='Phòng khám Demo', defaults={'kind': Room.CONSULT})
        visit = None
        for index, days_ago in enumerate((14, 7)):
            when = at(start - timedelta(days=days_ago), 9)
            booking, _ = Booking.objects.get_or_create(
                idempotency_key=f'{PREFIX}-customer-history-{index}',
                defaults={'user': self.customer, 'patient': self.patient, 'staff': self.doctors[0],
                          'appointment': when, 'total': self.services[0].price, 'status': Booking.COMPLETED,
                          'confirm_state': Booking.CONFIRM_STATE_CONFIRMED,
                          'note': 'Lượt khám mô phỏng của demoKhachHang.'},
            )
            BookingItem.objects.get_or_create(booking=booking, service=self.services[0], defaults={'price': self.services[0].price})
            visit, _ = Visit.objects.get_or_create(
                booking=booking,
                defaults={'patient': self.patient, 'doctor': self.doctors[0].user, 'source': Visit.APPOINTMENT,
                          'visit_type': Visit.FOLLOW_UP if index else Visit.NEW, 'room': room,
                          'reason': 'Tái khám da sau tư vấn (demo)' if index else 'Tư vấn tình trạng da (demo)',
                          'status': Visit.COMPLETED, 'check_in_at': when, 'called_at': when + timedelta(minutes=5),
                          'finished_at': when + timedelta(minutes=30)},
            )
            record, created = MedicalRecord.objects.get_or_create(
                visit=visit,
                defaults={'patient': self.patient, 'doctor': visit.doctor,
                          'chief_complaint': 'Da dầu và mụn vùng má – tình huống bệnh án mô phỏng.',
                          'history_present': 'Thông tin giả lập cho bài trình bày, không phải dữ liệu sức khỏe thật.',
                          'examination': 'Mô phỏng: da dầu, vài sẩn viêm nhẹ vùng má; tiến triển ổn định khi tái khám.',
                          'diagnosis_code': 'L70.0', 'diagnosis_name': 'Mụn trứng cá (mô phỏng)',
                          'treatment_direction': 'Tư vấn chăm sóc da và theo dõi trong tình huống mô phỏng.',
                          'advice': 'Nội dung demo dùng kiểm tra hồ sơ, không phải chỉ định điều trị.',
                          'follow_up_date': start + timedelta(days=(2 - start.weekday()) % 7)},
            )
            if created:
                record.status = MedicalRecord.SIGNED
                # Persist and hash the same UTC representation used when reading from the DB.
                record.signed_at = visit.finished_at.astimezone(datetime_timezone.utc)
                record.signed_by = visit.doctor
                record.signature_hash = record.compute_hash(visit.doctor_id, record.signed_at)
                record.save(update_fields=['status', 'signed_at', 'signed_by', 'signature_hash', 'updated_at'])
        return visit

    def _chat(self):
        started = timezone.now() - timedelta(hours=2)
        conversation, created = Conversation.objects.get_or_create(
            customer=self.customer, channel=Conversation.WEB, subject=SUBJECT,
            defaults={'assigned_to': self.consultant, 'session_started_at': started,
                      'first_response_at': started + timedelta(minutes=2)},
        )
        if not created:
            return
        ConversationSession.objects.create(conversation=conversation, started_at=started)
        messages = (
            (self.customer, 'Chào phòng khám, tôi muốn xem lại hồ sơ khám và lịch tái khám của mình.'),
            (self.consultant, 'Chào anh/chị, hồ sơ đã được liên kết với tài khoản. Anh/chị có thể xem hai lượt khám trong cổng bệnh nhân.'),
            (self.customer, 'Tôi muốn nhận email nhắc lịch và hỏi thăm sau khám qua địa chỉ trong hồ sơ.'),
            (self.consultant, 'Phòng khám đã ghi nhận thông tin liên hệ demo. Lịch tái khám được hiển thị trong mục Lịch hẹn của tôi.'),
            (self.customer, 'Cảm ơn phòng khám, tôi đã xem được hồ sơ và sẽ kiểm tra email khi được gửi.'),
        )
        for index, (sender, text) in enumerate(messages):
            message = Message.objects.create(conversation=conversation, sender=sender, text=text)
            Message.objects.filter(pk=message.pk).update(created_at=started + timedelta(minutes=index * 2))

    def _calendar_patients(self):
        patients = []
        definitions = [(name, gender, year, phone) for _, name, gender, year, phone in PATIENTS]
        definitions += [(f'{name} (Demo)', Patient.OTHER, 1995, f'09010000{index:02d}')
                        for index, name in enumerate(EXTRA_PATIENTS, 6)]
        for name, gender, year, phone in definitions:
            patient, _ = Patient.objects.get_or_create(
                phone=phone, defaults={'full_name': name, 'gender': gender, 'date_of_birth': date(year, 6, 15),
                                      'created_by': self.consultant, 'referral_source': 'Demo báo cáo'},
            )
            patients.append(patient)
        return patients

    @staticmethod
    def _free_slot(staff, patient, day, hour, minute, duration):
        preferred = at(day, hour, minute)
        # Prefer the visual morning/afternoon lanes, but respect existing bookings and blocks.
        candidates = [preferred] + [at(day, h, m) for h in range(8, 17) for m in (0, 30)]
        for when in candidates:
            end = when + timedelta(minutes=duration)
            if time(12) <= when.time() < time(13) or (when.time() < time(12) and end.time() > time(12)):
                continue
            if slot_error(staff, when, duration):
                continue
            other = Booking.objects.filter(
                Q(patient=patient) | Q(user_id=patient.user_id, user__isnull=False),
                appointment__gte=at(day, 0), appointment__lt=at(day + timedelta(days=1), 0),
                status__in=Booking.ACTIVE_STATUSES,
            ).prefetch_related('items__service')
            if any(when < booking.end_time and booking.appointment < end for booking in other):
                continue
            return when
        return None
