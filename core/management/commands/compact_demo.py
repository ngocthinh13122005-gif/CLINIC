"""Replace the identified presentation fixtures with a small, linked demo."""
from datetime import date, datetime, time, timedelta, timezone as utc_timezone

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from clinic import models as cm
from core import models as m
from core.availability import slot_error
from core.management.commands.seed_minimal_demo import PATIENTS
from core.management.commands.seed_presentation_demo import EXTRA_PATIENTS


PREFIX = 'akina-compact-v1'
NOTE = '[DEMO_COMPACT]'
SUBJECT = '[Demo] Hồ sơ, liệu trình và lịch tái khám'


def at(day, hour=9):
    return timezone.make_aware(datetime.combine(day, time(hour)))


class Command(BaseCommand):
    help = 'Thu gọn đúng bộ demo đã định danh; mặc định chạy thử rồi rollback, --apply để lưu.'

    def add_arguments(self, parser):
        parser.add_argument('--start', type=date.fromisoformat)
        parser.add_argument('--apply', action='store_true')

    @transaction.atomic
    def handle(self, *args, **options):
        today = timezone.localdate()
        start = options.get('start') or today + timedelta(days=7 - today.weekday())
        if start.weekday() or start <= today:
            raise CommandError('--start phải là thứ Hai trong tương lai.')
        # Never change identities, passwords, permissions, email or existing profiles.
        users_before = list(User.objects.order_by('pk').values())
        self.customer = User.objects.get(username__iexact='demoKhachHang', role='customer')
        self.actors = {}
        for role, preferred in [('consultant', 'demoCSKH'), ('staff', 'demoNhanVien'),
                                ('manager', 'demoQuanLy'), ('sysadmin', 'demoAdmin')]:
            self.actors[role] = (User.objects.filter(username__iexact=preferred, role=role, is_active=True).first()
                                 or User.objects.filter(role=role, is_active=True).order_by('pk').first())
            if not self.actors[role]:
                raise CommandError(f'Thiếu tài khoản vai trò {role}.')
        self.doctors = []
        for username in ('demoBacSi', 'demoBacSi2', 'demoBacSi3'):
            staff = m.Staff.objects.filter(user__username__iexact=username, user__role='doctor', is_active=True).first()
            if not staff:
                raise CommandError(f'Thiếu hồ sơ bác sĩ {username}.')
            self.doctors.append(staff)

        patients = self._identified_patients()
        patient_ids = [p.pk for p in patients]
        customer_patient = next((p for p in patients if p.user_id == self.customer.pk), None)
        if customer_patient is None:
            raise CommandError('Chưa có hồ sơ liên kết demoKhachHang; không tự ghép theo tên.')
        keep = [customer_patient]
        for row in PATIENTS[:2]:
            patient = next((p for p in patients if p.phone == row[4] and p.full_name == row[1]), None)
            if patient is None:
                raise CommandError(f'Thiếu bệnh nhân demo đã định danh: {row[1]}.')
            keep.append(patient)

        bookings = m.Booking.objects.filter(
            Q(patient_id__in=patient_ids) | Q(user=self.customer)
            | Q(idempotency_key__startswith='akina-presentation-v1-')
            | Q(idempotency_key__startswith='akina-minimal-')
            | Q(idempotency_key__startswith=PREFIX) | Q(note__startswith='[QA VPS]')
        )
        if bookings.exclude(patient_id__in=patient_ids).exclude(patient__isnull=True).exists():
            raise CommandError('Lịch có dấu demo liên kết bệnh nhân ngoài bộ demo; dừng để tránh xóa nhầm.')
        booking_ids = list(bookings.values_list('pk', flat=True))
        visit_ids = list(cm.Visit.objects.filter(patient_id__in=patient_ids).values_list('pk', flat=True))
        record_ids = list(cm.MedicalRecord.objects.filter(patient_id__in=patient_ids).values_list('pk', flat=True))
        plan_ids = list(cm.TreatmentPlan.objects.filter(patient_id__in=patient_ids).values_list('pk', flat=True))
        invoice_ids = list(cm.Invoice.objects.filter(patient_id__in=patient_ids).values_list('pk', flat=True))
        # Do not silently detach an unrelated patient's clinical/billing references.
        for model, field, ids in [(cm.Visit, 'booking_id', booking_ids),
                                  (cm.MedicalRecord, 'visit_id', visit_ids),
                                  (cm.TreatmentPlan, 'record_id', record_ids),
                                  (cm.Invoice, 'visit_id', visit_ids),
                                  (cm.Invoice, 'treatment_plan_id', plan_ids),
                                  (cm.TreatmentPlan, 'invoice_id', invoice_ids),
                                  (cm.CareTask, 'visit_id', visit_ids),
                                  (cm.CareTask, 'plan_id', plan_ids),
                                  (cm.ConsentForm, 'visit_id', visit_ids)]:
            if model.objects.filter(**{field + '__in': ids}).exclude(patient_id__in=patient_ids).exists():
                raise CommandError(f'{model.__name__} có tham chiếu ngoài bộ demo; chưa thay đổi dữ liệu.')
        counts_before = {'bookings': len(booking_ids), 'patients': len(patient_ids),
                         'visits': len(visit_ids), 'plans': len(plan_ids)}
        self._remove(patient_ids, booking_ids, visit_ids, record_ids, plan_ids, invoice_ids)
        cm.Patient.objects.filter(pk__in=patient_ids).exclude(pk__in=[p.pk for p in keep]).delete()
        self._small_dataset(keep, start)
        if users_before != list(User.objects.order_by('pk').values()):
            raise CommandError('Tài khoản bị thay đổi ngoài dự kiến; rollback.')
        future = m.Booking.objects.filter(idempotency_key__startswith=PREFIX, appointment__gte=at(start, 0))
        if future.count() != 5 or future.filter(appointment__gte=at(start + timedelta(days=7), 0)).exists():
            raise CommandError('Bộ demo phải có đúng 5 lịch trong tuần đã chọn.')
        self.stdout.write(f"Before: {counts_before}; after: 3 patients, 3 historical visits, 5 upcoming bookings, "
                          f"1 plan/3 sessions, 3 prescriptions, 3 invoices; week {start}..{start + timedelta(days=6)}.")
        if not options.get('apply'):
            transaction.set_rollback(True)
            self.stdout.write('DRY RUN: toàn bộ thay đổi đã rollback; tài khoản và dữ liệu ngoài bộ demo giữ nguyên.')
        else:
            self.stdout.write(self.style.SUCCESS('APPLIED: demo compact; all user accounts unchanged.'))

    def _identified_patients(self):
        rows = list(cm.Patient.objects.select_related('user').all())
        result = []
        original = {(row[4], row[1]) for row in PATIENTS}
        extras = {(f'09010000{i:02d}', f'{name} (Demo)') for i, name in enumerate(EXTRA_PATIENTS, 6)}
        for patient in rows:
            pair = (patient.phone, patient.full_name)
            if (patient.user_id == self.customer.pk
                or (pair in original and patient.user_id is None)
                or (pair in extras and patient.user_id is None and patient.referral_source == 'Demo báo cáo')):
                result.append(patient)
        return result

    def _remove(self, patients, bookings, visits, records, plans, invoices):
        # Explicit dependency order; never disable FK checks, truncate tables or touch auth/catalogue.
        for model in (cm.CareTask, cm.PatientMessage, cm.ConsentForm, cm.DataRequest, cm.PatientNote, cm.PatientImage):
            model.objects.filter(patient_id__in=patients).delete()
        cm.Refund.objects.filter(invoice_id__in=invoices).delete()
        cm.Invoice.objects.filter(pk__in=invoices).delete()
        cm.Prescription.objects.filter(patient_id__in=patients).delete()
        cm.Visit.objects.filter(pk__in=visits, treatment_session__isnull=False).update(treatment_session=None)
        cm.TreatmentSession.objects.filter(plan_id__in=plans).delete()
        cm.TreatmentPlan.objects.filter(pk__in=plans).delete()
        cm.MedicalRecord.objects.filter(pk__in=records).delete()
        cm.Visit.objects.filter(pk__in=visits).delete()
        m.Booking.objects.filter(pk__in=bookings).delete()
        # Consents for the retained portal profile remain intact.
        cm.DataConsent.objects.filter(patient_id__in=patients).exclude(patient__user=self.customer).delete()
        cm.CRMLead.objects.filter(Q(converted_patient_id__in=patients) | Q(phone__in=['0912000001', '0912000002'])).delete()
        m.RosterShift.objects.filter(Q(note='Ca trực demo báo cáo.') | Q(note__startswith=NOTE)).delete()
        m.Attendance.objects.filter(note__startswith=NOTE).delete()
        m.ChatbotSession.objects.filter(user=self.customer).delete()
        m.Conversation.objects.filter(channel=m.Conversation.WEB).filter(
            Q(customer=self.customer) | (Q(customer__username__in=['khach1', 'khach2', 'fb_999999999999999'])
                & Q(subject__in=['Tư vấn chăm sóc da', 'Đặt lịch khám mụn', 'Hỏi thăm sau điều trị']))
        ).delete()
        notification_ids = []
        for notification in m.Notification.objects.all().only('pk', 'data'):
            data = notification.data if isinstance(notification.data, dict) else {}
            if str(data.get('booking_id')) in {str(pk) for pk in bookings}:
                notification_ids.append(notification.pk)
        m.Notification.objects.filter(pk__in=notification_ids).delete()

    def _small_dataset(self, patients, start):
        services = list(m.Service.objects.filter(is_active=True).order_by('pk'))
        medicines = list(cm.Medicine.objects.filter(is_active=True).order_by('pk')[:3])
        room = cm.Room.objects.filter(is_active=True).order_by('pk').first()
        if not services or not medicines or not room:
            raise CommandError('Cần dịch vụ, thuốc và phòng đang hoạt động; không sửa danh mục hiện có.')
        service = services[0]
        for staff in self.doctors:
            if not staff.services.filter(pk=service.pk).exists():
                raise CommandError('Dịch vụ demo chưa được phân công cho bác sĩ.')
        records, visits = [], []
        for index, (patient, doctor) in enumerate(zip(patients, self.doctors)):
            when = at(start - timedelta(days=3 + index))
            booking = self._booking(patient, doctor, service, when, f'history-{index}', m.Booking.COMPLETED)
            visit = cm.Visit.objects.create(
                patient=patient, booking=booking, doctor=doctor.user, attended_by=self.actors['staff'],
                source=cm.Visit.APPOINTMENT, status=cm.Visit.COMPLETED, room=room,
                check_in_at=when, called_at=when + timedelta(minutes=5), finished_at=when + timedelta(minutes=30),
                reason='Khám da và theo dõi (dữ liệu demo)', note=NOTE)
            record = cm.MedicalRecord.objects.create(
                patient=patient, visit=visit, doctor=doctor.user,
                chief_complaint='Tình huống mô phỏng: tư vấn chăm sóc da.',
                examination='Dữ liệu minh họa, không phải hồ sơ điều trị thật.',
                diagnosis_code='L70.0', diagnosis_name='Mụn trứng cá (demo)',
                treatment_direction='Theo dõi và chăm sóc da theo tình huống mô phỏng.',
                advice='Nội dung demo, không dùng làm chỉ định điều trị.', follow_up_date=start + timedelta(days=index))
            record.status = cm.MedicalRecord.SIGNED
            record.signed_at = visit.finished_at.astimezone(utc_timezone.utc)
            record.signed_by = doctor.user
            record.signature_hash = record.compute_hash(doctor.user_id, record.signed_at)
            record.save()
            rx = cm.Prescription.objects.create(
                patient=patient, visit=visit, doctor=doctor.user, diagnosis=record.diagnosis_name,
                status=cm.Prescription.ISSUED, issued_at=record.signed_at,
                advice='ĐƠN MẪU: không dùng thuốc theo dữ liệu demo.')
            medicine = medicines[index % len(medicines)]
            cm.PrescriptionItem.objects.create(
                prescription=rx, medicine=medicine, quantity=1, unit_price=medicine.price,
                dosage='Thông tin minh họa', usage='Dữ liệu thử giao diện, không phải hướng dẫn dùng thuốc.', days=0)
            visits.append(visit)
            records.append(record)
        plan = cm.TreatmentPlan.objects.create(
            patient=patients[0], record=records[0], doctor=self.doctors[0].user, service=service,
            title='[Demo] Chăm sóc da - 3 buổi', content='Bộ liệu trình minh họa nhỏ gọn.',
            total_sessions=3, interval_days=4, price=1200000, status=cm.TreatmentPlan.ACTIVE,
            start_date=timezone.localtime(visits[0].check_in_at).date(),
            expires_at=start + timedelta(days=60), note=NOTE)
        sessions = []
        for number, day in enumerate((plan.start_date, start, start + timedelta(days=4)), 1):
            done = number == 1
            sessions.append(cm.TreatmentSession.objects.create(
                plan=plan, record=records[0] if done else None, number=number, planned_date=day,
                status=cm.TreatmentSession.DONE if done else cm.TreatmentSession.PENDING,
                performed_by=self.doctors[0].user if done else None,
                performed_at=visits[0].finished_at if done else None,
                allow_staff_delegation=True, content='Buổi chăm sóc mô phỏng.' if done else ''))
        visits[0].treatment_session = sessions[0]
        visits[0].visit_type = cm.Visit.SESSION
        visits[0].save(update_fields=['treatment_session', 'visit_type'])
        for index, patient in enumerate(patients):
            invoice = cm.Invoice.objects.create(
                patient=patient, visit=visits[index], treatment_plan=plan if index == 0 else None,
                created_by=self.actors['staff'], created_at=visits[index].finished_at,
                due_date=start, payment_term=cm.Invoice.TERM_7, note=NOTE + ' Hóa đơn mô phỏng')
            cm.InvoiceItem.objects.create(
                invoice=invoice, kind=cm.InvoiceItem.PACKAGE if index == 0 else cm.InvoiceItem.SERVICE,
                name=plan.title if index == 0 else service.name, service=service,
                quantity=1, unit_price=plan.price if index == 0 else service.price)
            paid = 400000 if index == 0 else service.price if index == 1 else 0
            if paid:
                cm.Payment.objects.create(
                    invoice=invoice, amount=paid, method=cm.Payment.CASH, note=NOTE,
                    received_by=self.actors['staff'], reconciled_by=self.actors['manager'],
                    reconciled_at=visits[index].finished_at, paid_at=visits[index].finished_at,
                    reconciliation_status=cm.Payment.RECONCILED)
            invoice.recalc()
            if index == 0:
                plan.invoice = invoice
                plan.save(update_fields=['invoice'])
        for offset, patient_index, doctor_index, hour, status in (
            (0, 0, 0, 9, m.Booking.CONFIRMED), (1, 1, 1, 10, m.Booking.PENDING),
            (2, 2, 2, 14, m.Booking.CONFIRMED), (3, 1, 0, 9, m.Booking.PENDING),
            (4, 0, 0, 10, m.Booking.CONFIRMED),
        ):
            when = at(start + timedelta(days=offset), hour)
            doctor = self.doctors[doctor_index]
            error = slot_error(doctor, when, service.duration)
            if error:
                raise CommandError(f'Lịch thứ {offset + 1}: {error}; rollback, không đè lịch thật.')
            session = sessions[1 if offset == 0 else 2] if patient_index == 0 else None
            booking = self._booking(patients[patient_index], doctor, service, when, f'upcoming-{offset}', status,
                                    treatment_session=session,
                                    appointment_type=m.Booking.APPOINTMENT_TYPE_SESSION if session else m.Booking.APPOINTMENT_TYPE_FOLLOW_UP,
                                    follow_up_visit=visits[patient_index])
            if session:
                session.booking = booking
                session.save(update_fields=['booking'])
            m.RosterShift.objects.get_or_create(staff=doctor, date=when.date(), defaults={'note': NOTE})
        for staff in [d.user for d in self.doctors] + [self.actors['staff']]:
            m.Attendance.objects.get_or_create(staff=staff, date=start - timedelta(days=3),
                defaults={'check_in': time(8), 'check_out': time(17), 'note': NOTE})
        for purpose in ('care', 'contact'):
            if not cm.DataConsent.objects.filter(patient=patients[0], purpose=purpose).exists():
                cm.DataConsent.objects.create(patient=patients[0], purpose=purpose, method='demo',
                    signer_name=patients[0].full_name, recorded_by=self.actors['consultant'], note=NOTE)
        conversation = m.Conversation.objects.create(customer=self.customer, channel=m.Conversation.WEB,
            subject=SUBJECT, assigned_to=self.actors['consultant'], session_started_at=timezone.now())
        m.ConversationSession.objects.create(conversation=conversation)
        for sender, text in [(self.customer, 'Tôi muốn xem lại liệu trình và số tiền còn nợ.'),
                             (self.actors['consultant'], 'Hồ sơ demo có liệu trình 3 buổi, đã thanh toán 400.000đ và còn 800.000đ. Anh/chị có lịch tuần tới trong hồ sơ.'),
                             (self.customer, 'Vâng, nhờ phòng khám nhắc tôi trước buổi chăm sóc nhé.')]:
            m.Message.objects.create(conversation=conversation, sender=sender, text=text)
        for kind, title, actor, offset in [
            (cm.CareTask.POST_CARE, '[Demo] Hỏi thăm sau khám', self.actors['consultant'], 1),
            (cm.CareTask.SESSION, '[Demo] Chuẩn bị buổi chăm sóc', self.actors['staff'], 0)]:
            cm.CareTask.objects.create(patient=patients[0], visit=visits[0], plan=plan,
                conversation=conversation, kind=kind, title=title, note=NOTE,
                assigned_to=actor, created_by=self.actors['manager'], due_date=start + timedelta(days=offset))
        chatbot = m.ChatbotSession.objects.create(visitor_key=PREFIX, user=self.customer, is_closed=True)
        m.ChatbotMessage.objects.create(session=chatbot, role='user', content='Phòng khám có hỗ trợ đặt lịch không?')
        m.ChatbotMessage.objects.create(session=chatbot, role='assistant', source='faq',
            content='Bạn có thể xem dịch vụ và đặt lịch trên website AkinaClinic.')

    def _booking(self, patient, doctor, service, when, key, status, **extra):
        customer = self.customer if patient.user_id == self.customer.pk else None
        booking = m.Booking.objects.create(
            patient=patient, user=customer, guest_name='' if customer else patient.full_name,
            guest_phone='' if customer else patient.phone, staff=doctor,
            appointment=when, status=status, total=service.price,
            confirm_state='unconfirmed' if status == m.Booking.PENDING else 'confirmed',
            note=NOTE, idempotency_key=f'{PREFIX}-{key}', **extra)
        m.BookingItem.objects.create(booking=booking, service=service, price=service.price)
        return booking
