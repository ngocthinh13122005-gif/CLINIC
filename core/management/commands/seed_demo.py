"""Dữ liệu demo đầy đủ cho phòng khám: kho theo lô, nhà cung cấp, đơn nhập, kiểm kho, phòng, 90 ngày khám bệnh,
hóa đơn / công nợ, liệu trình, chăm sóc, cam kết ký điện tử, ảnh trước-sau. Chạy lại nhiều lần vẫn an toàn."""
import base64
import io
import random
from datetime import datetime, time, timedelta

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import User
from clinic import inventory
from clinic.models import (CareTask, ConsentForm, Invoice, InvoiceItem, LesionMark, MedicalRecord, Medicine, Patient, PatientImage, Payment,
                           PurchaseOrder, Room, StockCount, StockLot, StockMovement, Supplier, TreatmentPlan, TreatmentSession, Visit)
from clinic.views_v2 import _sync_stock
from clinic.views_v3 import CONSENT_TEXT, ensure_auto_tasks
from core.models import Service

R = random.Random(20261014)
SURNAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Phan', 'Võ']
FEMALE = ['Thị Mai', 'Thu Hà', 'Ngọc Anh', 'Phương Linh', 'Thanh Thảo', 'Bảo Ngọc', 'Khánh Huyền', 'Minh Châu', 'Hải Yến', 'Diễm My', 'Quỳnh Như', 'Tuyết Nhung', 'Kim Ngân', 'Thùy Trang']
MALE = ['Văn Hùng', 'Quốc Bảo', 'Minh Tuấn', 'Đức Anh', 'Hoàng Long', 'Anh Khoa', 'Gia Huy', 'Thành Đạt', 'Tuấn Kiệt', 'Hữu Phước']
SOURCES = ['Facebook', 'Google', 'Người quen giới thiệu', 'Website', 'TikTok', 'Khách vãng lai', 'Người quen giới thiệu', 'Facebook']
DX = [  # code, tên, khám lâm sàng, hướng điều trị, vùng, loại tổn thương, dịch vụ gợi ý
    ('L70.0', 'Mụn trứng cá thông thường', 'Sẩn viêm, mụn mủ, nhân mụn vùng má và cằm; da dầu.', 'Retinoid bôi tối, kháng sinh bôi sáng, peel da y khoa.', ['left_cheek', 'right_cheek', 'chin'], 'papule', 'Peel da y khoa'),
    ('L81.1', 'Nám (chloasma)', 'Mảng tăng sắc tố nâu đối xứng hai gò má.', 'Kem ức chế melanin, chống nắng, laser Pico.', ['left_cheek', 'right_cheek'], 'pigment', 'Laser Pico xóa sắc tố'),
    ('L23.9', 'Viêm da tiếp xúc dị ứng', 'Ban đỏ, vảy mịn, trầy xước do gãi.', 'Corticoid bôi ngắn ngày, kháng histamin.', ['neck', 'left_arm'], 'plaque', None),
    ('B00.9', 'Nhiễm Herpes simplex', 'Chùm mụn nước trên nền đỏ quanh môi.', 'Thuốc kháng virus bôi/uống.', ['perioral'], 'vesicle', None),
    ('L21.9', 'Viêm da tiết bã', 'Ban đỏ, vảy vàng nhờn vùng rãnh mũi má, da đầu.', 'Ketoconazole bôi, dầu gội trị nấm.', ['nose', 'scalp'], 'scale', None),
    ('L50.9', 'Mề đay', 'Sẩn phù nổi rải rác, ngứa nhiều.', 'Kháng histamin, tránh yếu tố khởi phát.', ['chest', 'abdomen'], 'plaque', None),
    ('B35.4', 'Nấm thân', 'Mảng đỏ hình vòng, bờ viền rõ, có vảy.', 'Thuốc kháng nấm bôi 2–4 tuần.', ['abdomen'], 'scale', None),
    ('L90.5', 'Sẹo lõm do mụn', 'Sẹo lõm kiểu rolling vùng má hai bên.', 'Lăn kim / laser fractional nhiều buổi.', ['left_cheek', 'right_cheek'], 'scar', 'Lăn kim vi điểm'),
    ('L72.0', 'Nang thượng bì', 'Nang nhỏ chắc dưới da, không đau.', 'Cắt bỏ nang thủ thuật nhỏ.', ['upper_back'], 'nodule', None),
]
METHODS = ['cash', 'cash', 'transfer', 'transfer', 'card', 'ewallet']


def png_bytes(size, draw_fn):
    from PIL import Image, ImageDraw
    img = Image.new('RGB', size, 'white')
    d = ImageDraw.Draw(img)
    draw_fn(img, d)
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    return buf.getvalue()


def signature_png():
    import math

    def draw(img, d):
        pts = [(20 + i * 5, 60 + int(28 * math.sin(i / 4.0 + R.random()) * math.exp(-i / 60))) for i in range(50)]
        d.line(pts, fill=(20, 30, 90), width=3)
        d.line([(30, 95), (180, 80)], fill=(20, 30, 90), width=2)
    return 'data:image/png;base64,' + base64.b64encode(png_bytes((300, 120), draw)).decode()


def skin_photo(kind, tone, label):
    def draw(img, d):
        w, h = img.size
        for y in range(h):
            k = y / h
            d.line([(0, y), (w, y)], fill=tuple(int(c * (0.92 + 0.12 * k)) for c in tone))
        n = {'before': 46, 'after': 12}[kind]
        for _ in range(n):
            x, y, r = R.randint(30, w - 30), R.randint(30, h - 30), R.randint(3, 8)
            col = (tone[0] - 20, tone[1] - 55, tone[2] - 50) if kind == 'before' else (tone[0] - 6, tone[1] - 14, tone[2] - 12)
            d.ellipse([x - r, y - r, x + r, y + r], fill=col)
        d.rectangle([0, h - 30, w, h], fill=(16, 37, 58))
        d.text((10, h - 22), label, fill='white')
    return png_bytes((480, 360), draw)


class Command(BaseCommand):
    help = 'Tạo dữ liệu demo đầy đủ cho phòng khám (idempotent)'

    def handle(self, *a, **k):
        owner = User.objects.filter(role='manager').first() or User.objects.filter(role='sysadmin').first()
        cskh = User.objects.filter(role='consultant').first() or owner
        docs = list(User.objects.filter(role='doctor', is_active=True))
        if not (owner and docs):
            self.stdout.write('Chưa có tài khoản quản lý / bác sĩ — bỏ qua seed_demo.')
            return
        with transaction.atomic():
            self._rooms()
            if not Supplier.objects.exists():
                self._inventory(owner)
            if Visit.objects.count() < 60:
                self._history(cskh, docs, owner)
            if not ConsentForm.objects.exists():
                self._consents(cskh)
            if not PatientImage.objects.exists():
                self._images(docs[0])
            self._care(cskh)
            self._compliance(cskh, owner)
        self.stdout.write('Đã tạo dữ liệu demo phòng khám (kho, đơn nhập, kiểm kho, 90 ngày khám, hóa đơn, chăm sóc, cam kết).')

    # ------------------------------------------------------------------ phòng
    def _rooms(self):
        if Room.objects.exists():
            return
        for i, (n, kind) in enumerate([('Phòng khám 1', 'consult'), ('Phòng khám 2', 'consult'), ('Phòng khám 3', 'consult'),
                                       ('Phòng laser', 'treatment'), ('Phòng điều trị 1', 'treatment'), ('Phòng thủ thuật', 'procedure')]):
            Room.objects.create(name=n, kind=kind, order=i)
        busy = Visit.objects.filter(status=Visit.IN_CONSULT, room__isnull=True).first()
        if busy:
            busy.room = Room.objects.first()
            busy.save(update_fields=['room'])

    # ------------------------------------------------------------------ kho
    def _inventory(self, owner):
        today = timezone.localdate()
        now = timezone.now()
        extra = [('Tretinoin 0,025% kem', 'Tretinoin', '0,025%', 'Kem bôi', 'tuýp', 165000, 108000, 12, True, 'Bôi mỏng buổi tối, tránh vùng mắt'),
                 ('Azelaic acid 15% gel', 'Azelaic acid', '15%', 'Gel bôi', 'tuýp', 185000, 120000, 10, True, 'Bôi 2 lần/ngày'),
                 ('Clindamycin 1% gel', 'Clindamycin', '1%', 'Gel bôi', 'tuýp', 72000, 46000, 10, True, 'Chấm lên mụn viêm 2 lần/ngày'),
                 ('Fluconazole 150mg', 'Fluconazole', '150mg', 'Viên nang', 'viên', 22000, 13000, 20, True, 'Theo chỉ định bác sĩ'),
                 ('Terbinafine 250mg', 'Terbinafine', '250mg', 'Viên nén', 'viên', 12000, 7000, 40, True, 'Uống 1 viên/ngày sau ăn'),
                 ('Serum Niacinamide 10% 30ml', 'Niacinamide', '10%', 'Serum', 'chai', 360000, 230000, 6, False, 'Thoa buổi sáng và tối'),
                 ('Serum Hyaluronic acid 30ml', 'Hyaluronic acid', '', 'Serum', 'chai', 340000, 215000, 6, False, 'Thoa sau khi rửa mặt'),
                 ('Calamine lotion 100ml', 'Calamine', '', 'Lotion', 'chai', 55000, 32000, 8, False, 'Thoa vùng ngứa 2–3 lần/ngày')]
        for n, ai, st, form, unit, price, cost, mn, rx, use in extra:
            Medicine.objects.get_or_create(name=n, defaults=dict(active_ingredient=ai, strength=st, form=form, unit=unit, price=price, cost=cost, min_stock=mn,
                                                                is_prescription=rx, default_usage=use, stock=0))
        sups = [Supplier.objects.create(name=n, contact=c, phone=p, email=e, address=ad, tax_code=t) for n, c, p, e, ad, t in [
            ('Công ty TNHH Dược phẩm Hòa Bình', 'Nguyễn Văn Thịnh', '0236 3888 111', 'sales@hoabinhpharma.example', '25 Nguyễn Văn Linh, Đà Nẵng', '0401234567'),
            ('Công ty CP Dược mỹ phẩm An Khang', 'Trần Thị Mai', '0236 3999 222', 'order@ankhang.example', '102 Điện Biên Phủ, Đà Nẵng', '0402345678'),
            ('Nhà thuốc Trung tâm Miền Trung', 'Lê Quang Vinh', '0511 3777 333', 'trungtam@mientrung.example', '18 Lê Duẩn, Đà Nẵng', '0403456789'),
            ('Công ty TNHH Vật tư Y tế Sài Gòn Xanh', 'Phạm Hữu Nghĩa', '028 3666 444', 'kinhdoanh@saigonxanh.example', '55 Cộng Hòa, TP.HCM', '0305678123')]]
        # 1) Chuyển tồn đầu kỳ (chưa có lô) thành lô có số lô / hạn dùng
        for m in Medicine.objects.filter(stock__gt=0):
            if m.lots.exists():
                continue
            a = max(m.stock * 6 // 10, 1)
            for qty, lot_no, days in [(a, f'L{R.randint(2301, 2409)}', R.choice([240, 300, 400, 520])), (m.stock - a, f'L{R.randint(2410, 2509)}', R.choice([420, 560, 700]))]:
                if qty > 0:
                    StockLot.objects.create(medicine=m, lot_no=lot_no, expiry_date=today + timedelta(days=days), quantity=qty, initial_qty=qty,
                                            unit_cost=m.cost, supplier=R.choice(sups), received_at=now - timedelta(days=R.randint(60, 120)), reference='Tồn đầu kỳ')
        # lô sắp hết hạn + lô đã hết hạn để demo cảnh báo
        for name, days, qty in [('Ketoconazole 2% kem', 28, 6), ('Benzoyl peroxide 2,5% gel', 55, 5), ('Clobetasol 0,05% kem', -9, 3)]:
            m = Medicine.objects.filter(name=name).first()
            lot = m.lots.order_by('-quantity').first() if m else None
            if lot and lot.quantity > qty:
                lot.quantity -= qty
                lot.save(update_fields=['quantity'])
                StockLot.objects.create(medicine=m, lot_no=f'EXP{abs(days)}', expiry_date=today + timedelta(days=days), quantity=qty, initial_qty=qty,
                                        unit_cost=m.cost, supplier=lot.supplier, received_at=now - timedelta(days=200), reference='Tồn đầu kỳ')
        # 2) Đơn nhập hàng: đã nhận / nhận một phần / đang đặt / nháp
        by = {m.name: m for m in Medicine.objects.all()}

        def po(supplier, items, days_ago, status):
            o = PurchaseOrder.objects.create(supplier=supplier, created_by=owner, note='Đặt hàng định kỳ', expected_date=today - timedelta(days=days_ago - 4))
            for n, qty, cost in items:
                from clinic.models import PurchaseOrderLine
                PurchaseOrderLine.objects.create(order=o, medicine=by[n], quantity=qty, unit_cost=cost or by[n].cost)
            when = now - timedelta(days=days_ago)
            PurchaseOrder.objects.filter(pk=o.pk).update(created_at=when)
            if status == 'draft':
                return o
            PurchaseOrder.objects.filter(pk=o.pk).update(status='ordered', ordered_at=when + timedelta(hours=2))
            o.refresh_from_db()
            if status in {'received', 'partial'}:
                rows = []
                for l in o.lines.all():
                    q = l.quantity if status == 'received' else l.quantity // 2
                    rows.append({'line_id': l.id, 'quantity': q, 'lot_no': f'N{o.pk}{l.pk}', 'expiry': str(today + timedelta(days=R.choice([300, 420, 540])))})
                inventory.receive_order(o, owner, rows)
                recv = when + timedelta(days=3)
                PurchaseOrder.objects.filter(pk=o.pk).update(received_at=recv if status == 'received' else None)
                StockLot.objects.filter(reference=o.code).update(received_at=recv)
                StockMovement.objects.filter(reference=o.code).update(created_at=recv)
            return o
        po(sups[0], [('Doxycycline 100mg', 300, 1800), ('Valacyclovir 500mg', 200, 5500), ('Cetirizine 10mg', 400, 1200)], 74, 'received')
        po(sups[1], [('Adapalene 0,1% gel', 30, 90000), ('Benzoyl peroxide 2,5% gel', 24, 62000), ('Tretinoin 0,025% kem', 24, 108000), ('Azelaic acid 15% gel', 20, 120000)], 52, 'received')
        po(sups[2], [('Acyclovir 5% kem', 40, 24000), ('Mometasone 0,1% kem', 30, 43000), ('Clindamycin 1% gel', 24, 46000), ('Ketoconazole 2% kem', 20, 28000)], 31, 'received')
        po(sups[3], [('Kem chống nắng SPF50+ 50ml', 30, 210000), ('Serum Niacinamide 10% 30ml', 20, 230000), ('Serum Hyaluronic acid 30ml', 20, 215000), ('Calamine lotion 100ml', 24, 32000)], 14, 'partial')
        po(sups[0], [('Isotretinoin 10mg', 150, 9500), ('Tranexamic acid 250mg', 200, 3500), ('Fluconazole 150mg', 40, 13000), ('Terbinafine 250mg', 60, 7000)], 3, 'ordered')
        po(sups[1], [('Kem dưỡng phục hồi B5 40ml', 24, 180000), ('Sữa rửa mặt dịu nhẹ 150ml', 30, 135000)], 0, 'draft')
        # thuốc còn 0 tồn (mới thêm) mà chưa có đơn nhận: nhập thẳng một lô để không bị trống
        for m in Medicine.objects.filter(stock=0, is_active=True):
            inventory.receive_lot(m, max(m.min_stock * 2, 10), owner, lot_no=f'D{m.pk}01', expiry=today + timedelta(days=R.choice([360, 480])),
                                  cost=m.cost, supplier=R.choice(sups), reference='Nhập ban đầu')
        # 3) Kiểm kho: một phiếu đã chốt tháng trước (có chênh lệch) + một phiếu đang kiểm
        c = inventory.start_count(owner, 'Kiểm kê định kỳ cuối tháng')
        lines = list(c.lines.all())
        for i, l in enumerate(lines):
            l.counted_qty = l.expected_qty - (1 if i % 7 == 3 else 0) + (2 if i % 11 == 5 else 0)
            l.save(update_fields=['counted_qty'])
        inventory.validate_count(c, owner)
        when = now - timedelta(days=26)
        StockCount.objects.filter(pk=c.pk).update(created_at=when, validated_at=when + timedelta(hours=3))
        StockMovement.objects.filter(reference=c.code).update(created_at=when + timedelta(hours=3))
        inventory.start_count(owner, 'Kiểm kê nhóm thuốc bôi (đang thực hiện)', [m.pk for m in Medicine.objects.filter(form__icontains='bôi')][:6])

    # ------------------------------------------------------------------ 90 ngày hoạt động
    def _history(self, cskh, docs, owner):
        today = timezone.localdate()
        now = timezone.now()
        svc = list(Service.objects.filter(is_active=True))
        svc_by = {s.name: s for s in svc}
        consult = Service.objects.filter(name__icontains='Khám').first() or svc[0]
        meds = list(Medicine.objects.filter(is_active=True))
        patients = list(Patient.objects.all())
        used = {p.phone for p in patients}
        for _ in range(46):
            female = R.random() < .68
            while True:
                phone = '09' + ''.join(str(R.randint(0, 9)) for _ in range(8))
                if phone not in used:
                    used.add(phone)
                    break
            first = R.choice(FEMALE if female else MALE)
            created = now - timedelta(days=R.randint(1, 88))
            p = Patient.objects.create(full_name=f'{R.choice(SURNAMES)} {first}', gender='female' if female else 'male', phone=phone,
                                       date_of_birth=datetime(R.randint(1965, 2007), R.randint(1, 12), R.randint(1, 28)).date(),
                                       skin_type=R.choice(['II', 'III', 'III', 'IV', 'IV', 'V']), referral_source=R.choice(SOURCES), created_by=cskh,
                                       allergies=R.choice(['', '', '', '', 'Dị ứng Penicillin', 'Dị ứng mỹ phẩm có hương liệu', 'Dị ứng Sulfa']))
            Patient.objects.filter(pk=p.pk).update(created_at=created)
            patients.append(p)
        seen = []
        n_visit = 0
        for back in range(90, 0, -1):
            day = today - timedelta(days=back)
            if day.weekday() == 6 and R.random() < .7:
                continue
            for _ in range(R.randint(1, 3) if day.weekday() >= 5 else R.randint(2, 5)):
                p = R.choice(seen) if seen and R.random() < .35 else R.choice(patients)
                if p not in seen:
                    seen.append(p)
                doc = R.choice(docs)
                when = timezone.make_aware(datetime.combine(day, time(R.randint(8, 16), R.choice([0, 15, 30, 45]))))
                vtype = R.choices(['new', 'follow_up', 'procedure', 'session'], [4, 3, 2, 2])[0] if p in seen[:-1] else 'new'
                cancelled = R.random() < .05
                dx = R.choice(DX)
                v = Visit.objects.create(patient=p, doctor=doc, visit_type=vtype, reason=dx[1], status=Visit.CANCELLED if cancelled else Visit.COMPLETED,
                                         attended_by=cskh, source=Visit.WALK_IN)
                Visit.objects.filter(pk=v.pk).update(check_in_at=when, called_at=None if cancelled else when + timedelta(minutes=R.randint(5, 25)),
                                                     finished_at=when + timedelta(minutes=R.randint(30, 75)))
                v.refresh_from_db()
                n_visit += 1
                if cancelled:
                    continue
                rec = MedicalRecord.objects.create(visit=v, patient=p, doctor=doc, chief_complaint=dx[1], examination=dx[2], diagnosis_code=dx[0], diagnosis_name=dx[1],
                                                   history_present='Triệu chứng khởi phát vài tuần trước, tăng dần.', treatment_direction=dx[3], advice='Chống nắng, tái khám đúng hẹn.',
                                                   follow_up_date=day + timedelta(days=R.choice([7, 14, 28])) if R.random() < .6 else None)
                for reg in dx[4]:
                    LesionMark.objects.create(record=rec, region=reg, lesion_type=dx[5], severity=R.randint(1, 3))
                signed = v.finished_at - timedelta(minutes=5)
                rec.status, rec.signed_at, rec.signed_by = MedicalRecord.SIGNED, signed, doc
                rec.signature_hash = rec.compute_hash(doc.pk, signed)
                rec.save()
                # hóa đơn
                inv = Invoice.objects.create(patient=p, visit=v, created_by=cskh)
                InvoiceItem.objects.create(invoice=inv, kind='service', name=consult.name, service=consult, quantity=1, unit_price=consult.price)
                if dx[6] and dx[6] in svc_by:
                    s = svc_by[dx[6]]
                    InvoiceItem.objects.create(invoice=inv, kind='service', name=s.name, service=s, quantity=1, unit_price=s.price)
                elif vtype in {'procedure', 'session'}:
                    s = R.choice(svc)
                    InvoiceItem.objects.create(invoice=inv, kind='service', name=s.name, service=s, quantity=1, unit_price=s.price)
                for m in R.sample(meds, R.randint(0, 3)):
                    qty = R.randint(1, 2) if m.unit in {'tuýp', 'chai'} else R.choice([7, 10, 14])
                    m.refresh_from_db()
                    if m.stock >= qty:
                        InvoiceItem.objects.create(invoice=inv, kind='medicine', name=m.name, medicine=m, quantity=qty, unit_price=m.price)
                inv.discount = R.choice([0, 0, 0, 0, 50000, 100000]) if inv.items.count() > 1 else 0
                inv.recalc()
                _sync_stock(inv, cskh)
                roll = R.random()
                paid = inv.total if roll < .84 else inv.total // 2 if roll < .95 else 0
                if paid:
                    Payment.objects.create(invoice=inv, amount=paid, method=R.choice(METHODS), received_by=cskh,
                                           reconciliation_status=Payment.RECONCILED, reconciled_by=cskh)
                    inv.recalc()
                Invoice.objects.filter(pk=inv.pk).update(created_at=v.finished_at)
                paid_at = v.finished_at + timedelta(minutes=R.randint(0, 30))
                Payment.objects.filter(invoice=inv).update(paid_at=paid_at, reconciled_at=paid_at)
                StockMovement.objects.filter(reference=inv.code).update(created_at=v.finished_at)
                # việc chăm sóc quá khứ (đã làm) để báo cáo có số liệu
                if back > 8 and R.random() < .8:
                    t = CareTask.objects.create(patient=p, visit=v, kind='post_care', auto=True, title=f'Gọi hỏi thăm sau lượt khám #{v.pk}',
                                                due_date=day + timedelta(days=1), assigned_to=cskh)
                    done = R.random() < .85
                    CareTask.objects.filter(pk=t.pk).update(status='done' if done else 'skipped', completed_by=cskh,
                                                            completed_at=when + timedelta(days=1, hours=2), outcome=R.choice(['Da ổn định, không phản ứng phụ', 'Đã hẹn lịch tái khám', 'Khách hài lòng', 'Cần theo dõi thêm, nhắc dùng chống nắng']))
        # vài liệu trình đang chạy + vài lịch hẹn tuần tới
        for p in R.sample(seen, 6):
            s = R.choice([x for x in svc if x.price >= 300000] or svc)
            doc = R.choice(docs)
            start = today - timedelta(days=R.randint(10, 30))
            plan = TreatmentPlan.objects.create(patient=p, doctor=doc, service=s, title=f'Liệu trình {s.name.lower()}', diagnosis='Theo bệnh án gần nhất', total_sessions=R.choice([4, 6]),
                                                interval_days=14, price=s.price * 4, status=TreatmentPlan.ACTIVE, start_date=start, content='Theo phác đồ của bác sĩ phụ trách.')
            done_n = R.randint(1, 3)
            for n in range(1, plan.total_sessions + 1):
                pd = start + timedelta(days=14 * (n - 1))
                sess = TreatmentSession.objects.create(plan=plan, number=n, planned_date=pd)
                if n <= done_n:
                    TreatmentSession.objects.filter(pk=sess.pk).update(status='done', performed_by=doc, content='Thực hiện đúng phác đồ, da đáp ứng tốt.',
                                                                       performed_at=timezone.make_aware(datetime.combine(pd, time(10, 0))))
        # công nợ cũ lâu ngày để báo cáo công nợ có đủ các nhóm tuổi nợ
        for inv in Invoice.objects.filter(status__in=['unpaid', 'partial']).order_by('created_at')[:3]:
            pass
        self.stdout.write(f'  + {n_visit} lượt khám lịch sử, {len(patients)} bệnh nhân')

    # ------------------------------------------------------------------ cam kết + ảnh
    def _consents(self, cskh):
        pts = list(Patient.objects.order_by('id')[:14])
        for i, p in enumerate(pts):
            kind = ['treatment', 'laser', 'peel', 'photo', 'warranty'][i % 5]
            title, body = CONSENT_TEXT[kind]
            c = ConsentForm.objects.create(patient=p, kind=kind, title=title, body=body, created_by=cskh,
                                           valid_until=timezone.localdate() + timedelta(days=180) if kind == 'warranty' else None)
            if i % 4 != 3:
                import hashlib
                when = timezone.now() - timedelta(days=R.randint(1, 60))
                sig = signature_png()
                c.status, c.signer_name, c.signer_relation, c.signature, c.signed_at, c.witness = 'signed', p.full_name, 'Bản thân', sig, when, cskh
                c.content_hash = hashlib.sha256(f'{c.code}|{title}|{body}|{p.full_name}|{when.isoformat()}'.encode()).hexdigest()
                c.save()
                ConsentForm.objects.filter(pk=c.pk).update(created_at=when - timedelta(minutes=10))

    def _compliance(self, cskh, owner):
        from clinic.models import BackupLog, DataConsent, DataIncident, DataRequest
        from clinic.views_v4 import NOTICE_HASH, NOTICE_VERSION
        streets = ['Lê Lợi', 'Nguyễn Huệ', 'Trần Hưng Đạo', 'Hai Bà Trưng', 'Cách Mạng Tháng Tám', 'Điện Biên Phủ', 'Võ Văn Tần']
        for p in Patient.objects.all():                                  # đơn thuốc bắt buộc có nơi cư trú + ngày sinh
            ch = []
            if not p.address:
                p.address = f'{R.randint(1, 250)} {R.choice(streets)}, TP.HCM'; ch.append('address')
            if not p.date_of_birth:
                p.date_of_birth = timezone.localdate().replace(year=timezone.localdate().year - R.randint(18, 60)); ch.append('date_of_birth')
            if ch:
                p.save(update_fields=ch)
        if DataConsent.objects.exists():
            return
        pts = list(Patient.objects.all())
        for i, p in enumerate(pts):
            if i % 12 == 11:
                continue                                                    # một số hồ sơ cũ chưa có đồng ý — để màn hình tuân thủ nhắc việc
            when = timezone.now() - timedelta(days=R.randint(5, 80))
            for purpose in (['care', 'contact'] + (['photo'] if i % 3 == 0 else []) + (['marketing'] if i % 5 == 0 else [])):
                DataConsent.objects.create(patient=p, purpose=purpose, notice_version=NOTICE_VERSION, notice_hash=NOTICE_HASH, given_at=when,
                                           signer_name=p.full_name, signer_relation='Bản thân', recorded_by=cskh)
        p1, p2 = pts[2], pts[5]
        r = DataRequest.objects.create(patient=p1, kind='access', detail='Xin bản sao hồ sơ khám để đi bệnh viện khác', created_by=cskh,
                                       received_at=timezone.now() - timedelta(days=9), due_at=timezone.now() - timedelta(days=6), status='done',
                                       handled_at=timezone.now() - timedelta(days=7), handled_by=owner, response='Đã cung cấp bản sao hồ sơ trực tiếp cho người bệnh.')
        DataRequest.objects.create(patient=p2, kind='withdraw', detail='Không muốn nhận tin ưu đãi', created_by=cskh, received_at=timezone.now() - timedelta(hours=5),
                                   due_at=timezone.now() + timedelta(hours=67))
        DataIncident.objects.create(kind='loss', title='Mất điện thoại nhân viên lễ tân (đã khóa từ xa)', description='Thiết bị có ứng dụng quản lý, đã đổi mật khẩu và thu hồi phiên đăng nhập.',
                                    detected_at=timezone.now() - timedelta(days=40), affected_count=0, measures='Đổi mật khẩu toàn bộ tài khoản lễ tân; bật khóa màn hình bắt buộc.',
                                    authority_notified_at=None, status='closed', reported_by=owner)

    def _images(self, doctor):
        for p in Patient.objects.filter(plans__isnull=False).distinct()[:4]:
            tone = (R.randint(205, 235), R.randint(160, 185), R.randint(140, 165))
            for kind, days, label in [('before', 42, 'DEMO - truoc dieu tri'), ('after', 7, 'DEMO - sau dieu tri')]:
                img = PatientImage(patient=p, kind=kind, region='left_cheek', caption='Ảnh minh họa dữ liệu demo', uploaded_by=doctor,
                                   taken_at=timezone.localdate() - timedelta(days=days))
                img.image.save(f'demo_{p.pk}_{kind}.png', ContentFile(skin_photo(kind, tone, label)), save=True)

    def _care(self, cskh):
        ensure_auto_tasks()
