"""Dữ liệu mẫu cho phòng khám da liễu: bác sĩ, bệnh nhân, lượt khám, bệnh án, liệu trình, lịch hẹn."""
from datetime import datetime, time, timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from accounts.models import User
from clinic.models import (LesionMark, MedicalRecord, Patient, TreatmentPlan, TreatmentSession, Visit)
from core.models import Booking, BookingItem, Service, Staff, WorkingHours


class Command(BaseCommand):
    help = 'Tạo dữ liệu mẫu cho các module phòng khám (bệnh nhân, lượt khám, bệnh án, liệu trình)'

    def handle(self, *a, **k):
        if Patient.objects.exists():
            self.stdout.write('Đã có dữ liệu bệnh nhân — bỏ qua seed_clinic.')
            return
        today = timezone.localdate()
        now = timezone.now()

        # ---- thêm 2 bác sĩ để lịch có nhiều cột ----
        docs = [User.objects.filter(username='bacsi1').first()]
        for username, name, exp in [('bacsi2', 'BS. Lê Thu Hiền', 9), ('bacsi3', 'BS. Phạm Quốc Dũng', 12)]:
            u = User.objects.filter(username=username).first()
            if not u:
                u = User.objects.create_user(username=username, email=f'{username}@clinic.vn', password=f'{username}12345',
                                             first_name=name, role=User.Role.DOCTOR)
            prof, _ = Staff.objects.get_or_create(user=u, defaults=dict(name=name, position='Bác sĩ da liễu'))
            prof.experience_years, prof.rating = exp, 4.9
            prof.save()
            prof.services.set(Service.objects.all())
            for wd in range(6):
                WorkingHours.objects.get_or_create(staff=prof, weekday=wd, defaults=dict(start_time='08:00', end_time='17:00'))
            docs.append(u)
        docs = [d for d in docs if d]
        cskh = User.objects.filter(username='cskh1').first()
        svc = {s.name: s for s in Service.objects.all()}

        def mk_patient(name, gender, year, phone, **kw):
            return Patient.objects.create(full_name=name, gender=gender, date_of_birth=datetime(year, 5, 12).date(),
                                          phone=phone, created_by=cskh, **kw)

        p1 = mk_patient('Nguyễn Thị Lan Anh', 'female', 1998, '0905123456', occupation='Nhân viên văn phòng', skin_type='III',
                        allergies='Dị ứng Penicillin', skin_history='Mụn từ năm 16 tuổi', referral_source='Facebook')
        p2 = mk_patient('Trần Hoàng Nam', 'male', 1990, '0912345678', occupation='Kỹ sư', skin_type='IV',
                        chronic_conditions='Viêm xoang dị ứng', referral_source='Người quen giới thiệu')
        p3 = mk_patient('Lê Thu Trang', 'female', 1985, '0987654321', skin_type='III', occupation='Giáo viên',
                        current_medications='Vitamin D 1000IU', pregnancy_status='Không', referral_source='Website')
        p4 = mk_patient('Phạm Minh Khôi', 'male', 2001, '0933445566', skin_type='V', referral_source='Google')
        p5 = mk_patient('Đặng Thị Hồng Nhung', 'female', 1979, '0977112233', skin_type='II', allergies='Dị ứng mỹ phẩm chứa hương liệu',
                        chronic_conditions='Tăng huyết áp', referral_source='Facebook')
        p6 = mk_patient('Vũ Ngọc Bích', 'female', 1995, '0908777666', skin_type='III')
        mk_patient('Hoàng Văn Tùng', 'male', 1972, '0966001122', skin_type='IV', chronic_conditions='Đái tháo đường type 2')
        mk_patient('Bùi Khánh Linh', 'female', 2003, '0944556677', skin_type='III')

        def make_visit(patient, doctor, days_ago, hour, vtype, reason, status=Visit.COMPLETED):
            when = timezone.make_aware(datetime.combine(today - timedelta(days=days_ago), time(hour, 15)))
            v = Visit.objects.create(patient=patient, doctor=doctor, visit_type=vtype, reason=reason, status=status,
                                     attended_by=cskh, check_in_at=when, source=Visit.WALK_IN)
            Visit.objects.filter(pk=v.pk).update(check_in_at=when)
            if status == Visit.COMPLETED:
                Visit.objects.filter(pk=v.pk).update(called_at=when + timedelta(minutes=12), finished_at=when + timedelta(minutes=40))
            return v

        def sign(rec, doctor, when):
            rec.status, rec.signed_at, rec.signed_by = MedicalRecord.SIGNED, when, doctor
            rec.signature_hash = rec.compute_hash(doctor.pk, when)
            rec.save()

        d1, d2, d3 = (docs + docs + docs)[:3]
        # ---- lịch sử khám đã hoàn tất, có bệnh án đã ký ----
        v = make_visit(p1, d1, 21, 9, Visit.NEW, 'Nổi mụn viêm vùng má, đau')
        r = MedicalRecord.objects.create(visit=v, patient=p1, doctor=d1, chief_complaint=v.reason,
            history_present='Mụn tăng nặng 3 tháng nay, nhiều mụn viêm đỏ, đau, xuất hiện trước kỳ kinh.',
            previous_treatment='Tự mua kem bôi chứa benzoyl peroxide, đáp ứng kém.',
            examination='Nhiều sẩn viêm, mụn mủ vùng má hai bên và cằm; vài nhân mụn đầu đen vùng mũi. Da dầu.',
            diagnosis_code='L70.0', diagnosis_name='Mụn trứng cá thông thường (mức độ trung bình)',
            treatment_direction='Thuốc bôi retinoid buổi tối, kháng sinh bôi buổi sáng; liệu trình peel da y khoa 4 buổi.',
            advice='Chống nắng SPF50 hằng ngày, không tự nặn mụn, tái khám sau 4 tuần.', follow_up_date=today + timedelta(days=7))
        for reg, lt, sev, note in [('left_cheek', 'papule', 2, 'Sẩn viêm đỏ, nhiều'), ('right_cheek', 'pustule', 2, 'Mụn mủ rải rác'),
                                   ('chin', 'papule', 1, ''), ('nose', 'comedone', 1, 'Nhân mụn đầu đen')]:
            LesionMark.objects.create(record=r, region=reg, lesion_type=lt, severity=sev, note=note)
        sign(r, d1, v.check_in_at + timedelta(minutes=35))
        plan = TreatmentPlan.objects.create(patient=p1, record=r, doctor=d1, service=svc.get('Peel da y khoa'),
            title='Liệu trình peel da y khoa trị mụn', diagnosis='L70.0 – Mụn trứng cá thông thường',
            content='Peel Salicylic 20–30% mỗi 2 tuần, kết hợp thuốc bôi theo toa.', total_sessions=4, interval_days=14,
            price=3000000, status=TreatmentPlan.ACTIVE, start_date=today - timedelta(days=20))
        for n in range(1, 5):
            TreatmentSession.objects.create(plan=plan, number=n, planned_date=plan.start_date + timedelta(days=14 * (n - 1)))
        for sess in plan.sessions.filter(number__lte=2):
            sess.status, sess.performed_by = TreatmentSession.DONE, d1
            sess.performed_at = timezone.make_aware(datetime.combine(sess.planned_date, time(10, 0)))
            sess.content = 'Peel nhẹ, da đáp ứng tốt, không kích ứng.' if sess.number == 1 else 'Giảm số lượng mụn viêm rõ rệt.'
            sess.save()

        v = make_visit(p3, d2, 35, 14, Visit.NEW, 'Xuất hiện mảng da sạm hai bên gò má')
        r = MedicalRecord.objects.create(visit=v, patient=p3, doctor=d2, chief_complaint=v.reason,
            history_present='Sạm da tăng dần sau 2 lần đi biển, không ngứa, không đau.',
            examination='Mảng tăng sắc tố nâu, ranh giới không rõ, đối xứng hai gò má và trán.',
            diagnosis_code='L81.1', diagnosis_name='Nám (chloasma)',
            treatment_direction='Kem bôi ức chế melanin, chống nắng nghiêm ngặt, laser Pico 3–5 buổi.',
            advice='Che chắn khi ra nắng, tránh bôi mỹ phẩm lạ.')
        for reg in ['left_cheek', 'right_cheek', 'forehead']:
            LesionMark.objects.create(record=r, region=reg, lesion_type='pigment', severity=2)
        sign(r, d2, v.check_in_at + timedelta(minutes=30))

        v = make_visit(p5, d3, 9, 10, Visit.NEW, 'Ngứa, nổi mẩn đỏ vùng cổ và cánh tay')
        r = MedicalRecord.objects.create(visit=v, patient=p5, doctor=d3, chief_complaint=v.reason,
            history_present='Nổi mẩn ngứa sau khi đổi sữa tắm 1 tuần.',
            examination='Ban đỏ, vài vảy mịn, trầy xước do gãi ở cổ và mặt trong cẳng tay.',
            diagnosis_code='L23.9', diagnosis_name='Viêm da tiếp xúc dị ứng',
            treatment_direction='Corticoid bôi tại chỗ ngắn ngày, kháng histamin uống, ngưng sản phẩm nghi ngờ.',
            advice='Dùng sản phẩm dịu nhẹ không hương liệu; tái khám nếu không đỡ sau 7 ngày.')
        for reg in ['neck', 'left_arm', 'right_arm']:
            LesionMark.objects.create(record=r, region=reg, lesion_type='plaque', severity=1)
        sign(r, d3, v.check_in_at + timedelta(minutes=28))

        v = make_visit(p2, d1, 3, 15, Visit.NEW, 'Nổi nốt mụn nước quanh miệng')
        r = MedicalRecord.objects.create(visit=v, patient=p2, doctor=d1, chief_complaint=v.reason,
            history_present='Rát, nổi mụn nước nhỏ thành chùm quanh môi 2 ngày.',
            examination='Chùm mụn nước trên nền đỏ ở môi trên, một số đã đóng vảy.',
            diagnosis_code='B00.9', diagnosis_name='Nhiễm Herpes simplex',
            treatment_direction='Thuốc kháng virus bôi/uống.', advice='Tránh chạm, rửa tay, không dùng chung đồ cá nhân.')
        LesionMark.objects.create(record=r, region='perioral', lesion_type='vesicle', severity=2)
        sign(r, d1, v.check_in_at + timedelta(minutes=25))

        # ---- hôm nay: 2 người chờ ở sảnh, 1 đang tư vấn ----
        def today_visit(patient, minutes_ago, status, vtype, reason, doctor=None):
            v = Visit.objects.create(patient=patient, status=status, visit_type=vtype, reason=reason, doctor=doctor, attended_by=cskh)
            Visit.objects.filter(pk=v.pk).update(check_in_at=now - timedelta(minutes=minutes_ago),
                                                 called_at=(now - timedelta(minutes=minutes_ago - 8)) if status == Visit.IN_CONSULT else None)
            return v
        today_visit(p4, 18, Visit.WAITING, Visit.NEW, 'Nổi mụn ở lưng, ngứa')
        today_visit(p6, 6, Visit.WAITING, Visit.FOLLOW_UP, 'Tái khám nám sau 1 tháng', doctor=d2)
        today_visit(p1, 25, Visit.IN_CONSULT, Visit.SESSION, 'Buổi peel số 3', doctor=d1)
        for n, tv in enumerate(Visit.objects.filter(check_in_at__date=timezone.localdate()).order_by('check_in_at'), 1):
            Visit.objects.filter(pk=tv.pk).update(ticket_no=n)

        # ---- lịch hẹn mẫu để lịch tuần có dữ liệu ----
        staff_of = {u.pk: Staff.objects.filter(user=u).first() for u in docs}
        plans = [(0, 10, 0, p6, 'consult', 'Khám da liễu tổng quát'), (0, 14, 0, p2, 'follow_up', 'Tái khám da liễu'),
                 (1, 9, 1, p3, 'procedure', 'Laser Pico xóa sắc tố'), (1, 15, 2, p5, 'follow_up', 'Tái khám da liễu'),
                 (2, 10, 0, p1, 'session', 'Peel da y khoa'), (2, 11, 1, p4, 'consult', 'Khám da liễu tổng quát'),
                 (3, 9, 2, p2, 'procedure', 'Đốt laser mụn cóc / mụn thịt'), (4, 14, 1, p6, 'consult', 'Soi da chuyên sâu')]
        for day, hour, di, pat, atype, sname in plans:
            doc = docs[di % len(docs)]
            start = timezone.make_aware(datetime.combine(today + timedelta(days=day), time(hour, 0)))
            if start <= now:
                start = now + timedelta(hours=1 + di)
            b = Booking.objects.create(patient=pat, guest_name=pat.full_name, guest_phone=pat.phone, user=pat.user, staff=staff_of[doc.pk],
                                       appointment=start, appointment_type=atype, status=Booking.CONFIRMED)
            s = svc[sname]
            BookingItem.objects.create(booking=b, service=s, price=s.price)
            Booking.objects.filter(pk=b.pk).update(total=s.price)
        from django.db import transaction
        with transaction.atomic():
            self._seed_pharmacy_billing(cskh, d1)
        self.stdout.write('Đã tạo dữ liệu mẫu phòng khám: bệnh nhân, lượt khám, bệnh án, liệu trình, lịch hẹn.')

    def _seed_pharmacy_billing(self, cskh, doctor):
        from clinic.models import (Invoice, InvoiceItem, Medicine, Payment, Prescription, PrescriptionItem,
                                   StockMovement, Visit)
        from clinic.views_v2 import _sync_stock
        meds = [  # tên, hoạt chất, hàm lượng, dạng, đơn vị, giá bán, giá nhập, tồn, tối thiểu, kê đơn, cách dùng
            ('Acyclovir 5% kem', 'Acyclovir', '5%', 'Kem bôi', 'tuýp', 38000, 24000, 30, 8, True, 'Bôi 5 lần/ngày, 5–7 ngày'),
            ('Valacyclovir 500mg', 'Valacyclovir', '500mg', 'Viên nén', 'viên', 9000, 5500, 120, 30, True, 'Uống 1 viên x 2 lần/ngày'),
            ('Adapalene 0,1% gel', 'Adapalene', '0,1%', 'Gel bôi', 'tuýp', 135000, 90000, 24, 6, True, 'Bôi mỏng buổi tối'),
            ('Benzoyl peroxide 2,5% gel', 'Benzoyl peroxide', '2,5%', 'Gel bôi', 'tuýp', 95000, 62000, 18, 6, True, 'Chấm lên nốt mụn buổi sáng'),
            ('Doxycycline 100mg', 'Doxycycline', '100mg', 'Viên nang', 'viên', 3500, 1800, 200, 50, True, 'Uống sau ăn no, không nằm ngay'),
            ('Isotretinoin 10mg', 'Isotretinoin', '10mg', 'Viên nang', 'viên', 15000, 9500, 90, 30, True, 'Theo chỉ định bác sĩ'),
            ('Clobetasol 0,05% kem', 'Clobetasol propionate', '0,05%', 'Kem bôi', 'tuýp', 52000, 33000, 14, 5, True, 'Bôi 1–2 lần/ngày, không quá 2 tuần'),
            ('Mometasone 0,1% kem', 'Mometasone furoate', '0,1%', 'Kem bôi', 'tuýp', 68000, 43000, 20, 6, True, 'Bôi 1 lần/ngày'),
            ('Ketoconazole 2% kem', 'Ketoconazole', '2%', 'Kem bôi', 'tuýp', 45000, 28000, 22, 6, True, 'Bôi 1–2 lần/ngày'),
            ('Cetirizine 10mg', 'Cetirizine', '10mg', 'Viên nén', 'viên', 2500, 1200, 300, 60, False, 'Uống 1 viên buổi tối'),
            ('Tranexamic acid 250mg', 'Tranexamic acid', '250mg', 'Viên nén', 'viên', 6000, 3500, 150, 40, True, 'Uống 2 viên x 2 lần/ngày'),
            ('Kem chống nắng SPF50+ 50ml', '', 'SPF50+', 'Kem', 'tuýp', 320000, 210000, 8, 10, False, 'Thoa 15 phút trước khi ra nắng'),
            ('Sữa rửa mặt dịu nhẹ 150ml', '', '', 'Gel', 'chai', 210000, 135000, 25, 8, False, 'Rửa sáng và tối'),
            ('Kem dưỡng phục hồi B5 40ml', 'Panthenol', '5%', 'Kem', 'tuýp', 280000, 180000, 4, 6, False, 'Thoa sau thủ thuật'),
        ]
        by = {}
        for n, ai, st, form, unit, price, cost, stock, mn, rx, use in meds:
            m = Medicine.objects.create(name=n, active_ingredient=ai, strength=st, form=form, unit=unit, price=price, cost=cost,
                                        stock=stock, min_stock=mn, is_prescription=rx, default_usage=use)
            StockMovement.objects.create(medicine=m, kind='in', quantity=stock, balance_after=stock, reference='Tồn đầu kỳ', by=cskh)
            by[n] = m

        def invoice(visit, rows, paid=0, method='cash', discount=0):
            inv = Invoice.objects.create(patient=visit.patient, visit=visit, created_by=cskh, discount=discount)
            for kind, name, med, svc, qty, price in rows:
                InvoiceItem.objects.create(invoice=inv, kind=kind, name=name, medicine=med, service=svc, quantity=qty, unit_price=price)
            inv.recalc()
            _sync_stock(inv, cskh)
            if paid:
                Payment.objects.create(invoice=inv, amount=paid, method=method, received_by=cskh)
                inv.recalc()
            Invoice.objects.filter(pk=inv.pk).update(created_at=visit.finished_at or visit.check_in_at)
            Payment.objects.filter(invoice=inv).update(paid_at=visit.finished_at or visit.check_in_at)
            return inv

        done = list(Visit.objects.filter(status=Visit.COMPLETED).select_related('patient').order_by('check_in_at'))
        consult = Service.objects.filter(name__icontains='Khám').first()
        if done:
            v = done[0]
            rx = Prescription.objects.create(visit=v, patient=v.patient, doctor=doctor, status='issued', issued_at=v.finished_at,
                                             diagnosis='Herpes simplex', advice='Giữ vùng da sạch khô, tránh chạm tay.')
            a, b = by['Acyclovir 5% kem'], by['Valacyclovir 500mg']
            PrescriptionItem.objects.create(prescription=rx, medicine=a, quantity=1, dosage='Bôi 5 lần/ngày', usage='5–7 ngày', days=7, unit_price=a.price)
            PrescriptionItem.objects.create(prescription=rx, medicine=b, quantity=14, dosage='1 viên x 2 lần/ngày', usage='Sau ăn', days=7, unit_price=b.price)
            rows = [('service', consult.name, None, consult, 1, consult.price)] if consult else []
            rows += [('medicine', a.name, a, None, 1, a.price), ('medicine', b.name, b, None, 14, b.price)]
            invoice(v, rows, paid=sum(r[4] * r[5] for r in rows))
        if len(done) > 1:
            v = done[1]
            rows = [('service', consult.name, None, consult, 1, consult.price)] if consult else []
            rows += [('medicine', by['Kem chống nắng SPF50+ 50ml'].name, by['Kem chống nắng SPF50+ 50ml'], None, 1, 320000)]
            total = sum(r[4] * r[5] for r in rows)
            invoice(v, rows, paid=total // 2, method='transfer')      # còn nợ
