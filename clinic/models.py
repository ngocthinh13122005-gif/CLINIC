import hashlib
import json
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from .constants import FITZPATRICK, LESION_CHOICES, REGION_CHOICES


class Patient(models.Model):
    MALE, FEMALE, OTHER = 'male', 'female', 'other'
    GENDERS = [(MALE, 'Nam'), (FEMALE, 'Nữ'), (OTHER, 'Khác')]

    code = models.CharField('Mã bệnh nhân', max_length=20, unique=True, blank=True)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                related_name='patient_profile', verbose_name='Tài khoản cổng bệnh nhân')
    full_name = models.CharField('Họ tên', max_length=120)
    gender = models.CharField('Giới tính', max_length=8, choices=GENDERS, default=FEMALE)
    date_of_birth = models.DateField('Ngày sinh', null=True, blank=True)
    phone = models.CharField('Số điện thoại', max_length=15, db_index=True)
    email = models.EmailField('Email', blank=True)
    national_id = models.CharField('CCCD/CMND', max_length=20, blank=True)
    address = models.CharField('Địa chỉ', max_length=255, blank=True)
    occupation = models.CharField('Nghề nghiệp', max_length=100, blank=True)
    referral_source = models.CharField('Nguồn biết đến phòng khám', max_length=100, blank=True)
    emergency_contact = models.CharField('Người liên hệ khi cần', max_length=150, blank=True)

    # Thông tin an toàn: mọi nhân sự đều thấy (để không bỏ sót dị ứng)
    allergies = models.TextField('Dị ứng (thuốc, mỹ phẩm, thực phẩm)', blank=True)
    # Thông tin lâm sàng: chỉ bác sĩ / quản lý
    skin_type = models.CharField('Phân loại da Fitzpatrick', max_length=3, blank=True,
                                 choices=[(k, v) for k, v in FITZPATRICK])
    chronic_conditions = models.TextField('Bệnh nền / bệnh mạn tính', blank=True)
    current_medications = models.TextField('Thuốc đang dùng', blank=True)
    family_history = models.TextField('Tiền sử gia đình', blank=True)
    skin_history = models.TextField('Tiền sử bệnh da', blank=True)
    pregnancy_status = models.CharField('Thai kỳ / cho con bú', max_length=60, blank=True)
    clinical_notes = models.TextField('Ghi chú chuyên môn', blank=True)

    is_active = models.BooleanField('Đang quản lý', default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='+', verbose_name='Người tạo')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    CLINICAL_FIELDS = ('skin_type', 'chronic_conditions', 'current_medications', 'family_history',
                       'skin_history', 'pregnancy_status', 'clinical_notes')

    class Meta:
        verbose_name = 'Bệnh nhân'
        verbose_name_plural = 'Bệnh nhân'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.code} · {self.full_name}'

    def save(self, *args, **kwargs):
        creating = self.pk is None
        if creating and not self.code:
            self.code = 'TMP' + uuid.uuid4().hex[:14].upper()
        super().save(*args, **kwargs)
        if creating and self.code.startswith('TMP'):
            self.code = f'BN{self.pk:06d}'
            super().save(update_fields=['code'])

    @property
    def age(self):
        if not self.date_of_birth:
            return None
        today = timezone.localdate()
        return today.year - self.date_of_birth.year - ((today.month, today.day) < (self.date_of_birth.month, self.date_of_birth.day))


class Visit(models.Model):
    """Một lượt khám. Luồng thực tế: khách đến sảnh → nhân viên đón → mời vào tư vấn/khám → hoàn tất."""
    WAITING, IN_CONSULT, COMPLETED, CANCELLED = 'waiting', 'in_consult', 'completed', 'cancelled'
    STATUS = [(WAITING, 'Đang chờ ở sảnh'), (IN_CONSULT, 'Đang tư vấn / khám'),
              (COMPLETED, 'Hoàn tất'), (CANCELLED, 'Đã hủy / bỏ về')]
    NEW, FOLLOW_UP, PROCEDURE, SESSION = 'new', 'follow_up', 'procedure', 'session'
    TYPES = [(NEW, 'Khám mới / tư vấn'), (FOLLOW_UP, 'Tái khám'), (PROCEDURE, 'Thủ thuật'),
             (SESSION, 'Buổi liệu trình')]
    WALK_IN, APPOINTMENT = 'walk_in', 'appointment'
    SOURCES = [(WALK_IN, 'Khách đến trực tiếp'), (APPOINTMENT, 'Có lịch hẹn')]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name='visits', verbose_name='Bệnh nhân')
    booking = models.OneToOneField('core.Booking', on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name='visit', verbose_name='Lịch hẹn')
    source = models.CharField('Nguồn', max_length=12, choices=SOURCES, default=WALK_IN)
    visit_type = models.CharField('Loại lượt khám', max_length=10, choices=TYPES, default=NEW)
    reason = models.CharField('Lý do đến khám', max_length=255, blank=True)
    status = models.CharField('Trạng thái', max_length=12, choices=STATUS, default=WAITING, db_index=True)
    doctor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                               related_name='visits_as_doctor', verbose_name='Bác sĩ phụ trách')
    attended_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='visits_attended', verbose_name='Nhân viên tiếp đón')
    ticket_no = models.PositiveIntegerField('Số thứ tự trong ngày', default=0)
    check_in_at = models.DateTimeField('Giờ đến', default=timezone.now)
    called_at = models.DateTimeField('Giờ vào tư vấn', null=True, blank=True)
    finished_at = models.DateTimeField('Giờ kết thúc', null=True, blank=True)
    note = models.CharField('Ghi chú tiếp đón', max_length=255, blank=True)
    room = models.ForeignKey('Room', on_delete=models.SET_NULL, null=True, blank=True, related_name='visits', verbose_name='Phòng / ghế')

    class Meta:
        verbose_name = 'Lượt khám'
        verbose_name_plural = 'Lượt khám'
        ordering = ['-check_in_at']

    def __str__(self):
        return f'Lượt khám #{self.pk} · {self.patient.full_name}'

    def save(self, *args, **kwargs):
        if not self.pk and not self.ticket_no:
            day = timezone.localtime(self.check_in_at).date()
            self.ticket_no = Visit.objects.filter(check_in_at__date=day).count() + 1
        super().save(*args, **kwargs)


class MedicalRecord(models.Model):
    """Bệnh án của một lượt khám. Sau khi bác sĩ ký sẽ khóa; chỉ bổ sung qua phụ lục."""
    DRAFT, SIGNED = 'draft', 'signed'
    STATUS = [(DRAFT, 'Đang soạn'), (SIGNED, 'Đã ký')]

    code = models.CharField('Số hồ sơ', max_length=24, unique=True, blank=True)
    visit = models.OneToOneField(Visit, on_delete=models.PROTECT, related_name='record')
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name='records')
    doctor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                               related_name='records', verbose_name='Bác sĩ')
    chief_complaint = models.TextField('Lý do khám', blank=True)
    history_present = models.TextField('Bệnh sử (khởi phát, diễn tiến, yếu tố làm nặng)', blank=True)
    previous_treatment = models.TextField('Đã điều trị gì trước đó', blank=True)
    examination = models.TextField('Khám lâm sàng', blank=True)
    # Chẩn đoán chính + phụ (ICD-10)
    diagnosis_code = models.CharField('Mã ICD-10 chính', max_length=12, blank=True)
    diagnosis_name = models.CharField('Chẩn đoán chính', max_length=255, blank=True)
    secondary_diagnoses = models.JSONField('Chẩn đoán kèm theo', default=list, blank=True)
    differential = models.TextField('Chẩn đoán phân biệt', blank=True)
    treatment_direction = models.TextField('Hướng điều trị', blank=True)
    advice = models.TextField('Dặn dò', blank=True)
    follow_up_date = models.DateField('Hẹn tái khám', null=True, blank=True)
    status = models.CharField('Trạng thái', max_length=8, choices=STATUS, default=DRAFT)
    signed_at = models.DateTimeField('Thời điểm ký', null=True, blank=True)
    signed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='+', verbose_name='Người ký')
    signature_hash = models.CharField('Mã toàn vẹn (SHA-256)', max_length=64, blank=True)
    NORMAL, ADVERSE = 'normal', 'adverse'
    outcome = models.CharField('Kết cục', max_length=8, default=NORMAL, choices=[(NORMAL, 'Bình thường'), (ADVERSE, 'Tử vong / tai biến')],
                               help_text='Hồ sơ tử vong hoặc tai biến phải lưu lâu hơn.')
    legal_hold = models.BooleanField('Giữ lại (tranh chấp / thanh tra)', default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    SIGN_FIELDS = ('chief_complaint', 'history_present', 'previous_treatment', 'examination', 'diagnosis_code',
                   'diagnosis_name', 'secondary_diagnoses', 'differential', 'treatment_direction', 'advice')

    class Meta:
        verbose_name = 'Bệnh án'
        verbose_name_plural = 'Bệnh án'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.code} · {self.patient.full_name}'

    def retain_until(self):
        """Mốc tối thiểu phải lưu (theo tổng hợp quy định hiện hành — cần đối chiếu văn bản gốc).
        Thường: 10 năm; tử vong/tai biến: 20 năm; bệnh nhân dưới 15 tuổi: đến khi đủ 18 tuổi + 10 năm."""
        base = (self.signed_at or self.created_at).date()
        years = 20 if self.outcome == self.ADVERSE else 10
        end = base.replace(year=base.year + years) if not (base.month == 2 and base.day == 29) else base.replace(year=base.year + years, day=28)
        dob = self.patient.date_of_birth
        if dob and (base.year - dob.year - ((base.month, base.day) < (dob.month, dob.day))) < 15:
            adult = dob.replace(year=dob.year + 18) if not (dob.month == 2 and dob.day == 29) else dob.replace(year=dob.year + 18, day=28)
            end = max(end, adult.replace(year=adult.year + 10) if not (adult.month == 2 and adult.day == 29) else adult.replace(year=adult.year + 10, day=28))
        return end

    @property
    def locked(self):
        return self.status == self.SIGNED

    def save(self, *args, **kwargs):
        creating = self.pk is None
        if creating and not self.code:
            self.code = 'TMP' + uuid.uuid4().hex[:14].upper()
        super().save(*args, **kwargs)
        if creating and self.code.startswith('TMP'):
            self.code = f'BA{timezone.localdate():%y%m%d}-{self.pk:04d}'
            super().save(update_fields=['code'])

    def compute_hash(self, signer_id, when):
        payload = {f: getattr(self, f) for f in self.SIGN_FIELDS}
        payload['marks'] = list(self.marks.order_by('id').values_list('region', 'lesion_type', 'severity', 'note'))
        payload.update(record=self.code, patient=self.patient_id, signer=signer_id, at=when.isoformat())
        return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()


class LesionMark(models.Model):
    """Một tổn thương được đánh dấu trên sơ đồ vùng da."""
    record = models.ForeignKey(MedicalRecord, on_delete=models.CASCADE, related_name='marks')
    region = models.CharField('Vùng da', max_length=20, choices=REGION_CHOICES)
    lesion_type = models.CharField('Loại tổn thương', max_length=16, choices=LESION_CHOICES, default='papule')
    severity = models.PositiveSmallIntegerField('Mức độ (1 nhẹ – 3 nặng)', default=1)
    note = models.CharField('Mô tả', max_length=255, blank=True)

    class Meta:
        verbose_name = 'Tổn thương'
        verbose_name_plural = 'Tổn thương'
        ordering = ['id']


class RecordAddendum(models.Model):
    record = models.ForeignKey(MedicalRecord, on_delete=models.CASCADE, related_name='addenda')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    content = models.TextField('Nội dung bổ sung')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        verbose_name = 'Phụ lục bệnh án'
        verbose_name_plural = 'Phụ lục bệnh án'


class Icd10Code(models.Model):
    code = models.CharField('Mã ICD-10', max_length=12, unique=True)
    name = models.CharField('Tên bệnh', max_length=255)
    group = models.CharField('Nhóm', max_length=80, blank=True)

    class Meta:
        verbose_name = 'Mã ICD-10'
        verbose_name_plural = 'Danh mục ICD-10'
        ordering = ['code']

    def __str__(self):
        return f'{self.code} – {self.name}'


class TreatmentPlan(models.Model):
    DRAFT, ACTIVE, COMPLETED, CANCELLED = 'draft', 'active', 'completed', 'cancelled'
    STATUS = [(DRAFT, 'Chưa xác nhận'), (ACTIVE, 'Đang thực hiện'), (COMPLETED, 'Hoàn thành'), (CANCELLED, 'Đã hủy')]

    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name='plans')
    record = models.ForeignKey(MedicalRecord, on_delete=models.SET_NULL, null=True, blank=True, related_name='plans',
                               verbose_name='Bệnh án gốc')
    doctor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                               related_name='plans', verbose_name='Bác sĩ chỉ định')
    service = models.ForeignKey('core.Service', on_delete=models.SET_NULL, null=True, blank=True,
                                related_name='plans', verbose_name='Dịch vụ')
    title = models.CharField('Tên liệu trình', max_length=160)
    diagnosis = models.CharField('Chẩn đoán', max_length=255, blank=True)
    content = models.TextField('Nội dung điều trị', blank=True)
    total_sessions = models.PositiveSmallIntegerField('Số buổi', default=1)
    interval_days = models.PositiveSmallIntegerField('Khoảng cách giữa các buổi (ngày)', default=14)
    price = models.PositiveIntegerField('Giá trọn liệu trình (VNĐ)', default=0)
    status = models.CharField('Trạng thái', max_length=10, choices=STATUS, default=DRAFT)
    start_date = models.DateField('Ngày bắt đầu', null=True, blank=True)
    note = models.TextField('Ghi chú', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Liệu trình'
        verbose_name_plural = 'Liệu trình'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.title} · {self.patient.full_name}'

    @property
    def done_sessions(self):
        return self.sessions.filter(status=TreatmentSession.DONE).count()


class TreatmentSession(models.Model):
    PENDING, DONE, SKIPPED = 'pending', 'done', 'skipped'
    STATUS = [(PENDING, 'Chưa thực hiện'), (DONE, 'Đã thực hiện'), (SKIPPED, 'Bỏ qua')]

    plan = models.ForeignKey(TreatmentPlan, on_delete=models.CASCADE, related_name='sessions')
    number = models.PositiveSmallIntegerField('Buổi số')
    allow_staff_delegation = models.BooleanField(
        'Cho phép giao nhân sự đủ điều kiện thực hiện',
        default=False,
        help_text='Bác sĩ phụ trách quyết định cho từng buổi; mặc định bác sĩ phải trực tiếp thực hiện.',
    )
    planned_date = models.DateField('Ngày dự kiến', null=True, blank=True)
    performed_at = models.DateTimeField('Thực hiện lúc', null=True, blank=True)
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='+', verbose_name='Người thực hiện')
    status = models.CharField('Trạng thái', max_length=8, choices=STATUS, default=PENDING)
    content = models.TextField('Nội dung đã làm / theo dõi', blank=True)

    class Meta:
        verbose_name = 'Buổi liệu trình'
        verbose_name_plural = 'Buổi liệu trình'
        ordering = ['plan', 'number']
        unique_together = ('plan', 'number')


class PatientImage(models.Model):
    LESION, BEFORE, AFTER, OTHER = 'lesion', 'before', 'after', 'other'
    KINDS = [(LESION, 'Tổn thương'), (BEFORE, 'Trước điều trị'), (AFTER, 'Sau điều trị'), (OTHER, 'Khác')]

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='images')
    visit = models.ForeignKey(Visit, on_delete=models.SET_NULL, null=True, blank=True, related_name='images')
    image = models.ImageField('Ảnh', upload_to='clinic/patients/%Y/%m/')
    kind = models.CharField('Loại ảnh', max_length=8, choices=KINDS, default=LESION)
    region = models.CharField('Vùng da', max_length=20, choices=REGION_CHOICES, blank=True)
    caption = models.CharField('Chú thích', max_length=200, blank=True)
    taken_at = models.DateField('Ngày chụp', default=timezone.localdate)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Hình ảnh bệnh nhân'
        verbose_name_plural = 'Hình ảnh bệnh nhân'
        ordering = ['-taken_at', '-id']


# =========================================================================== v2: thuốc, đơn thuốc, hóa đơn
def _next_code(model, prefix):
    stamp = timezone.localtime().strftime('%y%m%d')
    n = model.objects.filter(code__startswith=f'{prefix}{stamp}').count() + 1
    code = f'{prefix}{stamp}-{n:04d}'
    while model.objects.filter(code=code).exists():
        n += 1
        code = f'{prefix}{stamp}-{n:04d}'
    return code


class Medicine(models.Model):
    """Danh mục thuốc / vật tư bán tại phòng khám, kèm tồn kho."""
    code = models.CharField('Mã thuốc', max_length=20, unique=True, blank=True)
    name = models.CharField('Tên thuốc / sản phẩm', max_length=160)
    active_ingredient = models.CharField('Hoạt chất', max_length=160, blank=True)
    strength = models.CharField('Hàm lượng', max_length=60, blank=True)
    form = models.CharField('Dạng bào chế', max_length=40, blank=True)       # viên, tuýp, kem, chai…
    unit = models.CharField('Đơn vị', max_length=20, default='viên')
    default_usage = models.CharField('Cách dùng mặc định', max_length=255, blank=True)
    price = models.PositiveIntegerField('Giá bán (VNĐ)', default=0)
    cost = models.PositiveIntegerField('Giá nhập (VNĐ)', default=0)
    stock = models.IntegerField('Tồn kho', default=0)
    min_stock = models.PositiveIntegerField('Mức tồn tối thiểu', default=10)
    is_prescription = models.BooleanField('Thuốc kê đơn', default=True)
    is_controlled = models.BooleanField('Thuốc kiểm soát đặc biệt (gây nghiện / hướng thần / tiền chất)', default=False,
                                        help_text='Hệ thống không cho kê nhóm này; phải kê đơn giấy 3 liên theo quy định.')
    is_active = models.BooleanField('Đang kinh doanh', default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Thuốc'
        verbose_name_plural = 'Thuốc'
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.code:
            self.code = f'T{self.pk:05d}'
            super().save(update_fields=['code'])

    @property
    def low_stock(self):
        return self.stock <= self.min_stock


class StockMovement(models.Model):
    IN, OUT, ADJUST, SCRAP = 'in', 'out', 'adjust', 'scrap'
    KINDS = [(IN, 'Nhập kho'), (OUT, 'Xuất bán'), (ADJUST, 'Kiểm kê / điều chỉnh'), (SCRAP, 'Hủy / hết hạn')]
    medicine = models.ForeignKey(Medicine, on_delete=models.CASCADE, related_name='movements')
    kind = models.CharField(max_length=8, choices=KINDS)
    quantity = models.IntegerField('Số lượng thay đổi (±)')
    balance_after = models.IntegerField('Tồn sau')
    reference = models.CharField('Chứng từ', max_length=60, blank=True)
    note = models.CharField('Ghi chú', max_length=255, blank=True)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    lot = models.ForeignKey('StockLot', on_delete=models.SET_NULL, null=True, blank=True, related_name='movements', verbose_name='Lô')
    unit_cost = models.PositiveIntegerField('Giá vốn / đơn vị', default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']


class Prescription(models.Model):
    DRAFT, ISSUED, CANCELLED = 'draft', 'issued', 'cancelled'
    STATUS = [(DRAFT, 'Nháp'), (ISSUED, 'Đã kê'), (CANCELLED, 'Đã hủy')]
    code = models.CharField('Mã đơn', max_length=20, unique=True, blank=True)
    visit = models.OneToOneField(Visit, on_delete=models.CASCADE, related_name='prescription')
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name='prescriptions')
    doctor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='prescriptions')
    diagnosis = models.CharField('Chẩn đoán', max_length=255, blank=True)
    advice = models.TextField('Lời dặn', blank=True)
    # Thông tin bắt buộc theo quy định kê đơn (chốt tại thời điểm kê)
    patient_national_id = models.CharField('CCCD/định danh', max_length=20, blank=True)
    patient_address = models.CharField('Nơi cư trú', max_length=255, blank=True)
    age_months = models.PositiveIntegerField('Tuổi (tháng) — trẻ dưới 72 tháng', null=True, blank=True)
    weight_kg = models.DecimalField('Cân nặng (kg)', max_digits=5, decimal_places=2, null=True, blank=True)
    guardian_name = models.CharField('Người đi cùng / giám hộ', max_length=120, blank=True)
    NAT_NONE, NAT_PENDING, NAT_SENT, NAT_ERROR = 'none', 'pending', 'sent', 'error'
    national_status = models.CharField('Liên thông đơn thuốc quốc gia', max_length=8, default=NAT_NONE,
                                       choices=[(NAT_NONE, 'Chưa gửi'), (NAT_PENDING, 'Chờ gửi'), (NAT_SENT, 'Đã gửi'), (NAT_ERROR, 'Lỗi')])
    national_code = models.CharField('Mã đơn quốc gia', max_length=40, blank=True)
    national_sent_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS, default=DRAFT)
    issued_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Đơn thuốc'
        verbose_name_plural = 'Đơn thuốc'
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = _next_code(Prescription, 'DT')
        super().save(*args, **kwargs)


class PrescriptionItem(models.Model):
    prescription = models.ForeignKey(Prescription, on_delete=models.CASCADE, related_name='items')
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name='rx_items')
    quantity = models.PositiveIntegerField('Số lượng', default=1)
    dosage = models.CharField('Liều dùng', max_length=120, blank=True)       # "1 viên x 2 lần/ngày"
    usage = models.CharField('Cách dùng', max_length=255, blank=True)        # "sau ăn", "bôi buổi tối"
    days = models.PositiveIntegerField('Số ngày', default=0)
    unit_price = models.PositiveIntegerField('Đơn giá', default=0)

    class Meta:
        ordering = ['id']


class Invoice(models.Model):
    UNPAID, PARTIAL, PAID, VOID = 'unpaid', 'partial', 'paid', 'void'
    STATUS = [(UNPAID, 'Chưa thanh toán'), (PARTIAL, 'Thanh toán một phần'), (PAID, 'Đã thanh toán'), (VOID, 'Đã hủy')]
    code = models.CharField('Số hóa đơn', max_length=20, unique=True, blank=True)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name='invoices')
    visit = models.ForeignKey(Visit, on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    status = models.CharField(max_length=8, choices=STATUS, default=UNPAID, db_index=True)
    subtotal = models.PositiveIntegerField(default=0)
    discount = models.PositiveIntegerField('Giảm giá', default=0)
    total = models.PositiveIntegerField(default=0)
    paid = models.PositiveIntegerField('Đã thu', default=0)
    TERM_IMMEDIATE, TERM_7, TERM_15, TERM_30, TERM_CUSTOM = 'immediate', '7d', '15d', '30d', 'custom'
    PAYMENT_TERMS = [(TERM_IMMEDIATE, 'Thanh toán ngay'), (TERM_7, 'Trong 7 ngày'),
                     (TERM_15, 'Trong 15 ngày'), (TERM_30, 'Trong 30 ngày'), (TERM_CUSTOM, 'Tùy chỉnh')]
    payment_term = models.CharField('Điều khoản thanh toán', max_length=12, choices=PAYMENT_TERMS, default=TERM_IMMEDIATE)
    due_date = models.DateField('Ngày đến hạn', null=True, blank=True, db_index=True)
    note = models.CharField(max_length=255, blank=True)
    void_reason = models.CharField(max_length=255, blank=True)
    # Thông tin người mua (khi khách yêu cầu xuất hóa đơn điện tử có MST)
    buyer_name = models.CharField('Tên đơn vị / người mua', max_length=200, blank=True)
    buyer_tax_code = models.CharField('Mã số thuế', max_length=20, blank=True)
    buyer_address = models.CharField('Địa chỉ người mua', max_length=255, blank=True)
    buyer_email = models.EmailField('Email nhận hóa đơn', blank=True)
    EI_NONE, EI_REQUESTED, EI_ISSUED = 'none', 'requested', 'issued'
    einvoice_status = models.CharField('Hóa đơn điện tử', max_length=10, default=EI_NONE,
                                       choices=[(EI_NONE, 'Không xuất'), (EI_REQUESTED, 'Cần xuất'), (EI_ISSUED, 'Đã xuất')])
    einvoice_symbol = models.CharField('Ký hiệu', max_length=20, blank=True)
    einvoice_no = models.CharField('Số hóa đơn điện tử', max_length=20, blank=True)
    einvoice_lookup = models.CharField('Mã tra cứu', max_length=60, blank=True)
    einvoice_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        verbose_name = 'Hóa đơn'
        verbose_name_plural = 'Hóa đơn'
        ordering = ['-created_at', '-id']

    @property
    def balance(self):
        return max(self.total - self.paid, 0)

    @property
    def overdue_days(self):
        if not self.due_date or not self.balance or self.status == self.VOID:
            return 0
        return max((timezone.localdate() - self.due_date).days, 0)

    @property
    def due_status(self):
        if self.status in {self.PAID, self.VOID} or not self.balance:
            return 'settled'
        return 'overdue' if self.overdue_days else 'due'

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = _next_code(Invoice, 'HD')
        super().save(*args, **kwargs)

    def recalc(self):
        self.subtotal = sum(i.quantity * i.unit_price for i in self.items.all())
        self.discount = min(self.discount, self.subtotal)
        self.total = self.subtotal - self.discount
        collected = sum(p.amount for p in self.payments.all())
        refunded = sum(r.amount for r in self.refunds.filter(status='completed'))
        self.paid = max(collected - refunded, 0)
        if self.status != self.VOID:
            self.status = self.PAID if self.paid >= self.total and self.total > 0 else (
                self.PARTIAL if self.paid > 0 else self.UNPAID)
        self.save()


class InvoiceItem(models.Model):
    SERVICE, MEDICINE, OTHER = 'service', 'medicine', 'other'
    KINDS = [(SERVICE, 'Dịch vụ'), (MEDICINE, 'Thuốc'), (OTHER, 'Khác')]
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='items')
    kind = models.CharField(max_length=8, choices=KINDS, default=SERVICE)
    name = models.CharField(max_length=200)
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    service = models.ForeignKey('core.Service', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['id']

    @property
    def amount(self):
        return self.quantity * self.unit_price


class Payment(models.Model):
    CASH, TRANSFER, CARD, EWALLET = 'cash', 'transfer', 'card', 'ewallet'
    METHODS = [(CASH, 'Tiền mặt'), (TRANSFER, 'Chuyển khoản'), (CARD, 'Quẹt thẻ'), (EWALLET, 'Ví điện tử')]
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    amount = models.PositiveIntegerField()
    method = models.CharField(max_length=10, choices=METHODS, default=CASH)
    reference = models.CharField('Mã giao dịch', max_length=60, blank=True)
    note = models.CharField(max_length=255, blank=True)
    PENDING, RECONCILED = 'pending', 'reconciled'
    RECONCILIATION = [(PENDING, 'Chờ đối soát'), (RECONCILED, 'Đã đối soát')]
    reconciliation_status = models.CharField('Đối soát', max_length=12, choices=RECONCILIATION, default=PENDING, db_index=True)
    reconciled_at = models.DateTimeField(null=True, blank=True)
    reconciled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    shift = models.ForeignKey('CashierShift', on_delete=models.SET_NULL, null=True, blank=True, related_name='payments')
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    paid_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['paid_at', 'id']


class CashierShift(models.Model):
    OPEN, CLOSED = 'open', 'closed'
    STATUS = [(OPEN, 'Đang mở'), (CLOSED, 'Đã đóng')]
    cashier = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='cashier_shifts')
    status = models.CharField(max_length=8, choices=STATUS, default=OPEN, db_index=True)
    opening_cash = models.PositiveIntegerField('Tiền đầu ca', default=0)
    expected_cash = models.PositiveIntegerField('Tiền theo hệ thống', default=0)
    counted_cash = models.PositiveIntegerField('Tiền kiểm đếm', default=0)
    difference = models.IntegerField('Chênh lệch', default=0)
    note = models.CharField(max_length=255, blank=True)
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        ordering = ['-opened_at', '-id']

    def cash_total(self):
        received = self.payments.filter(method=Payment.CASH).aggregate(v=models.Sum('amount'))['v'] or 0
        refunded = self.refunds.filter(method=Payment.CASH, status=Refund.COMPLETED).aggregate(v=models.Sum('amount'))['v'] or 0
        return received - refunded


class Refund(models.Model):
    PENDING, APPROVED, REJECTED, COMPLETED = 'pending', 'approved', 'rejected', 'completed'
    STATUS = [(PENDING, 'Chờ duyệt'), (APPROVED, 'Đã duyệt'), (REJECTED, 'Từ chối'), (COMPLETED, 'Đã hoàn tiền')]
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name='refunds')
    amount = models.PositiveIntegerField('Số tiền hoàn')
    method = models.CharField(max_length=10, choices=Payment.METHODS, default=Payment.CASH)
    reason = models.CharField(max_length=255)
    status = models.CharField(max_length=12, choices=STATUS, default=PENDING, db_index=True)
    reference = models.CharField('Mã giao dịch', max_length=60, blank=True)
    shift = models.ForeignKey(CashierShift, on_delete=models.SET_NULL, null=True, blank=True, related_name='refunds')
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)
    approved_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']


class DebtFollowUp(models.Model):
    NOTE, CALL, SMS, ZALO, EMAIL, PROMISE = 'note', 'call', 'sms', 'zalo', 'email', 'promise'
    ACTIONS = [(NOTE, 'Ghi chú'), (CALL, 'Gọi điện'), (SMS, 'SMS'), (ZALO, 'Zalo'),
               (EMAIL, 'Email'), (PROMISE, 'Khách hẹn thanh toán')]
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='followups')
    action = models.CharField(max_length=10, choices=ACTIONS, default=NOTE)
    note = models.CharField(max_length=500)
    promised_date = models.DateField(null=True, blank=True)
    next_follow_up = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['-created_at', '-id']


# =========================================================================== v3: kho theo lô, nhập hàng, kiểm kho
class Supplier(models.Model):
    code = models.CharField('Mã NCC', max_length=20, unique=True, blank=True)
    name = models.CharField('Tên nhà cung cấp', max_length=160)
    contact = models.CharField('Người liên hệ', max_length=100, blank=True)
    phone = models.CharField('Điện thoại', max_length=20, blank=True)
    email = models.EmailField('Email', blank=True)
    address = models.CharField('Địa chỉ', max_length=255, blank=True)
    tax_code = models.CharField('Mã số thuế', max_length=20, blank=True)
    note = models.CharField('Ghi chú', max_length=255, blank=True)
    is_active = models.BooleanField('Đang hợp tác', default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Nhà cung cấp'
        verbose_name_plural = 'Nhà cung cấp'
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.code:
            self.code = f'NCC{self.pk:04d}'
            super().save(update_fields=['code'])


class StockLot(models.Model):
    """Một lô hàng nhập: theo dõi số lô, hạn dùng, giá vốn. Xuất kho theo FEFO (hết hạn trước, xuất trước)."""
    medicine = models.ForeignKey(Medicine, on_delete=models.CASCADE, related_name='lots')
    lot_no = models.CharField('Số lô', max_length=40, blank=True)
    expiry_date = models.DateField('Hạn dùng', null=True, blank=True)
    quantity = models.IntegerField('Còn lại', default=0)
    initial_qty = models.IntegerField('Số lượng nhập', default=0)
    unit_cost = models.PositiveIntegerField('Giá vốn', default=0)
    supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, null=True, blank=True, related_name='lots')
    received_at = models.DateTimeField('Ngày nhập', default=timezone.now)
    reference = models.CharField('Chứng từ', max_length=40, blank=True)

    class Meta:
        verbose_name = 'Lô thuốc'
        verbose_name_plural = 'Lô thuốc'
        ordering = ['expiry_date', 'id']

    def __str__(self):
        return f'{self.medicine.name} · lô {self.lot_no or self.pk}'


class PurchaseOrder(models.Model):
    DRAFT, ORDERED, PARTIAL, RECEIVED, CANCELLED = 'draft', 'ordered', 'partial', 'received', 'cancelled'
    STATUS = [(DRAFT, 'Nháp'), (ORDERED, 'Đã đặt hàng'), (PARTIAL, 'Nhận một phần'), (RECEIVED, 'Đã nhận đủ'), (CANCELLED, 'Đã hủy')]
    code = models.CharField('Số đơn nhập', max_length=20, unique=True, blank=True)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name='orders')
    status = models.CharField(max_length=10, choices=STATUS, default=DRAFT, db_index=True)
    expected_date = models.DateField('Ngày dự kiến nhận', null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)
    ordered_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Đơn nhập hàng'
        verbose_name_plural = 'Đơn nhập hàng'
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = _next_code(PurchaseOrder, 'PO')
        super().save(*args, **kwargs)

    @property
    def total(self):
        return sum(l.quantity * l.unit_cost for l in self.lines.all())


class PurchaseOrderLine(models.Model):
    order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name='lines')
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name='+')
    quantity = models.PositiveIntegerField('Số lượng đặt')
    unit_cost = models.PositiveIntegerField('Giá nhập', default=0)
    received_qty = models.PositiveIntegerField('Đã nhận', default=0)

    class Meta:
        ordering = ['id']


class StockCount(models.Model):
    """Phiếu kiểm kho: chụp tồn hệ thống, nhập số đếm thực tế, xác nhận để tự tạo bút toán điều chỉnh."""
    DRAFT, VALIDATED, CANCELLED = 'draft', 'validated', 'cancelled'
    STATUS = [(DRAFT, 'Đang kiểm'), (VALIDATED, 'Đã chốt'), (CANCELLED, 'Đã hủy')]
    code = models.CharField('Số phiếu kiểm', max_length=20, unique=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS, default=DRAFT, db_index=True)
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)
    validated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    validated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Phiếu kiểm kho'
        verbose_name_plural = 'Phiếu kiểm kho'
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = _next_code(StockCount, 'KK')
        super().save(*args, **kwargs)


class StockCountLine(models.Model):
    count = models.ForeignKey(StockCount, on_delete=models.CASCADE, related_name='lines')
    medicine = models.ForeignKey(Medicine, on_delete=models.PROTECT, related_name='+')
    lot = models.ForeignKey(StockLot, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    expected_qty = models.IntegerField('Tồn hệ thống')
    counted_qty = models.IntegerField('Đếm thực tế', null=True, blank=True)

    class Meta:
        ordering = ['medicine__name', 'lot__expiry_date', 'id']

    @property
    def diff(self):
        return None if self.counted_qty is None else self.counted_qty - self.expected_qty


# =========================================================================== v3: điều phối, chăm sóc, cam kết
class Room(models.Model):
    CONSULT, TREATMENT, PROCEDURE = 'consult', 'treatment', 'procedure'
    KINDS = [(CONSULT, 'Phòng khám / tư vấn'), (TREATMENT, 'Phòng điều trị'), (PROCEDURE, 'Phòng thủ thuật')]
    name = models.CharField('Tên phòng / ghế', max_length=60, unique=True)
    kind = models.CharField(max_length=10, choices=KINDS, default=CONSULT)
    order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = 'Phòng'
        verbose_name_plural = 'Phòng'
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class CareTask(models.Model):
    """Việc chăm sóc bệnh nhân: gọi hỏi thăm sau điều trị, nhắc tái khám, nhắc buổi liệu trình, nhắc công nợ."""
    POST_CARE, REVISIT, SESSION, PAYMENT, OTHER = 'post_care', 'revisit', 'session', 'payment', 'other'
    KINDS = [(POST_CARE, 'Hỏi thăm sau điều trị'), (REVISIT, 'Nhắc tái khám'), (SESSION, 'Nhắc buổi liệu trình'),
             (PAYMENT, 'Nhắc công nợ'), (OTHER, 'Khác')]
    PENDING, ESCALATED, DONE, SKIPPED = 'pending', 'escalated', 'done', 'skipped'
    STATUS = [(PENDING, 'Cần làm'), (ESCALATED, 'Chờ bác sĩ'), (DONE, 'Đã xong'), (SKIPPED, 'Bỏ qua')]
    NORMAL, HIGH, URGENT = 'normal', 'high', 'urgent'
    PRIORITIES = [(NORMAL, 'Bình thường'), (HIGH, 'Ưu tiên cao'), (URGENT, 'Khẩn cấp')]
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name='care_tasks')
    visit = models.ForeignKey(Visit, on_delete=models.SET_NULL, null=True, blank=True, related_name='care_tasks')
    plan = models.ForeignKey(TreatmentPlan, on_delete=models.SET_NULL, null=True, blank=True, related_name='care_tasks')
    kind = models.CharField(max_length=10, choices=KINDS, default=POST_CARE)
    title = models.CharField(max_length=200)
    due_date = models.DateField('Hạn', default=timezone.localdate)
    status = models.CharField(max_length=10, choices=STATUS, default=PENDING, db_index=True)
    priority = models.CharField(max_length=8, choices=PRIORITIES, default=NORMAL, db_index=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='care_tasks')
    outcome = models.CharField('Kết quả liên hệ', max_length=255, blank=True)
    auto = models.BooleanField('Tự tạo', default=False)
    source_key = models.CharField('Khóa nguồn tự động', max_length=120, null=True, blank=True, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    escalation_reason = models.CharField('Lý do chuyển bác sĩ', max_length=500, blank=True)
    escalated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Việc chăm sóc'
        verbose_name_plural = 'Việc chăm sóc'
        ordering = ['status', 'due_date', 'id']


class CareContactLog(models.Model):
    """Nhật ký từng lần liên hệ, tương tự chatter/activity của CRM."""
    CALL, ZALO, MESSENGER, SMS, EMAIL, IN_PERSON = 'call', 'zalo', 'messenger', 'sms', 'email', 'in_person'
    CHANNELS = [(CALL, 'Điện thoại'), (ZALO, 'Zalo'), (MESSENGER, 'Messenger'), (SMS, 'SMS'),
                (EMAIL, 'Email'), (IN_PERSON, 'Tại phòng khám')]
    CONTACTED, NO_ANSWER, RESCHEDULED, NEEDS_DOCTOR, COMPLETED = 'contacted', 'no_answer', 'rescheduled', 'needs_doctor', 'completed'
    RESULTS = [(CONTACTED, 'Đã liên hệ'), (NO_ANSWER, 'Không nghe máy / chưa phản hồi'),
               (RESCHEDULED, 'Hẹn liên hệ lại'), (NEEDS_DOCTOR, 'Cần bác sĩ đánh giá'), (COMPLETED, 'Hoàn tất chăm sóc')]
    task = models.ForeignKey(CareTask, on_delete=models.CASCADE, related_name='contact_logs')
    channel = models.CharField(max_length=12, choices=CHANNELS, default=CALL)
    result = models.CharField(max_length=16, choices=RESULTS, default=CONTACTED)
    note = models.TextField('Nội dung trao đổi', max_length=2000)
    next_contact_at = models.DateTimeField(null=True, blank=True)
    clinical_alert = models.BooleanField('Có dấu hiệu cần chuyên môn', default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ['-created_at', '-id']


class ConsentForm(models.Model):
    """Phiếu cam kết / đồng ý điều trị, ký điện tử ngay trên màn hình. Ký xong thì khóa nội dung."""
    TREATMENT, LASER, PEEL, PHOTO, WARRANTY = 'treatment', 'laser', 'peel', 'photo', 'warranty'
    KINDS = [(TREATMENT, 'Đồng ý điều trị'), (LASER, 'Cam kết điều trị laser / ánh sáng'), (PEEL, 'Cam kết peel da'),
             (PHOTO, 'Đồng ý chụp & lưu hình ảnh'), (WARRANTY, 'Phiếu bảo hành dịch vụ')]
    PENDING, SIGNED, REVOKED = 'pending', 'signed', 'revoked'
    STATUS = [(PENDING, 'Chờ ký'), (SIGNED, 'Đã ký'), (REVOKED, 'Đã thu hồi')]
    code = models.CharField('Số phiếu', max_length=20, unique=True, blank=True)
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name='consents')
    visit = models.ForeignKey(Visit, on_delete=models.SET_NULL, null=True, blank=True, related_name='consents')
    plan = models.ForeignKey(TreatmentPlan, on_delete=models.SET_NULL, null=True, blank=True, related_name='consents')
    kind = models.CharField(max_length=10, choices=KINDS, default=TREATMENT)
    title = models.CharField(max_length=200)
    body = models.TextField('Nội dung')
    status = models.CharField(max_length=8, choices=STATUS, default=PENDING, db_index=True)
    signer_name = models.CharField('Người ký', max_length=120, blank=True)
    signer_relation = models.CharField('Quan hệ với bệnh nhân', max_length=60, blank=True)
    signature = models.TextField('Chữ ký (PNG base64)', blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    signed_ip = models.GenericIPAddressField(null=True, blank=True)
    content_hash = models.CharField(max_length=64, blank=True)
    witness = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(default=timezone.now)
    valid_until = models.DateField('Bảo hành đến', null=True, blank=True)

    class Meta:
        verbose_name = 'Phiếu cam kết'
        verbose_name_plural = 'Phiếu cam kết'
        ordering = ['-created_at', '-id']

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = _next_code(ConsentForm, 'CK')
        super().save(*args, **kwargs)


# =========================================================================== tuân thủ: dữ liệu cá nhân, sự cố, sao lưu
class DataConsent(models.Model):
    """Sự đồng ý xử lý dữ liệu cá nhân (có dữ liệu sức khỏe nhạy cảm). Không bao giờ tích sẵn; có thể rút lại."""
    GRANTED, WITHDRAWN = 'granted', 'withdrawn'
    PURPOSES = [('care', 'Khám, chữa bệnh và lưu hồ sơ bệnh án'), ('contact', 'Liên hệ nhắc lịch, chăm sóc sau điều trị'),
                ('photo', 'Chụp và lưu hình ảnh vùng da'), ('marketing', 'Thông tin ưu đãi, quảng bá (không bắt buộc)')]
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name='data_consents')
    purpose = models.CharField('Mục đích', max_length=12, choices=PURPOSES)
    status = models.CharField(max_length=10, default=GRANTED, choices=[(GRANTED, 'Đồng ý'), (WITHDRAWN, 'Đã rút lại')])
    notice_version = models.CharField('Phiên bản thông báo', max_length=12, default='1.0')
    notice_hash = models.CharField('Mã băm nội dung thông báo', max_length=64, blank=True)
    method = models.CharField('Cách ghi nhận', max_length=20, default='in_person')
    given_at = models.DateTimeField(default=timezone.now)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    signer_name = models.CharField('Người đồng ý', max_length=120, blank=True)
    signer_relation = models.CharField('Quan hệ', max_length=60, blank=True)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['-given_at', '-id']
        verbose_name = 'Đồng ý xử lý dữ liệu'
        verbose_name_plural = 'Đồng ý xử lý dữ liệu'


class DataRequest(models.Model):
    """Yêu cầu của chủ thể dữ liệu: xem / chỉnh sửa / xóa / hạn chế / rút lại đồng ý."""
    KINDS = [('access', 'Xem / sao chép dữ liệu'), ('correct', 'Chỉnh sửa dữ liệu'), ('delete', 'Xóa dữ liệu'),
             ('restrict', 'Hạn chế xử lý'), ('withdraw', 'Rút lại đồng ý')]
    OPEN, DONE, REJECTED = 'open', 'done', 'rejected'
    patient = models.ForeignKey(Patient, on_delete=models.PROTECT, related_name='data_requests')
    kind = models.CharField(max_length=10, choices=KINDS)
    status = models.CharField(max_length=10, default=OPEN, choices=[(OPEN, 'Đang xử lý'), (DONE, 'Đã xử lý'), (REJECTED, 'Từ chối / không thể thực hiện')])
    detail = models.TextField('Nội dung yêu cầu', blank=True)
    received_at = models.DateTimeField(default=timezone.now)
    due_at = models.DateTimeField('Hạn xử lý', null=True, blank=True)
    handled_at = models.DateTimeField(null=True, blank=True)
    handled_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    response = models.TextField('Phản hồi / căn cứ', blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        ordering = ['-received_at', '-id']


class DataIncident(models.Model):
    """Sổ ghi nhận sự cố lộ / mất / truy cập trái phép dữ liệu."""
    KINDS = [('leak', 'Lộ lọt dữ liệu'), ('loss', 'Mất dữ liệu / thiết bị'), ('unauth', 'Truy cập trái phép'), ('misuse', 'Sử dụng sai mục đích'), ('other', 'Khác')]
    kind = models.CharField(max_length=8, choices=KINDS, default='other')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    detected_at = models.DateTimeField(default=timezone.now)
    affected_count = models.PositiveIntegerField('Số người bị ảnh hưởng (ước tính)', default=0)
    measures = models.TextField('Biện pháp khắc phục', blank=True)
    authority_notified_at = models.DateTimeField('Đã báo cơ quan có thẩm quyền', null=True, blank=True)
    subjects_notified_at = models.DateTimeField('Đã báo người bị ảnh hưởng', null=True, blank=True)
    CLOSED_FIELD = 'closed'
    status = models.CharField(max_length=8, default='open', choices=[('open', 'Đang xử lý'), ('closed', 'Đã đóng')])
    reported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        ordering = ['-detected_at', '-id']


class BackupLog(models.Model):
    created_at = models.DateTimeField(default=timezone.now)
    kind = models.CharField(max_length=10, default='backup', choices=[('backup', 'Sao lưu'), ('verify', 'Kiểm tra khôi phục')])
    filename = models.CharField(max_length=255, blank=True)
    size = models.BigIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True)
    encrypted = models.BooleanField(default=False)
    ok = models.BooleanField(default=True)
    note = models.CharField(max_length=255, blank=True)
    by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        ordering = ['-created_at', '-id']


# =========================================================================== email marketing
class MarketingContact(models.Model):
    """Địa chỉ nhận tin quảng bá. Tách khỏi hồ sơ y tế và chỉ kích hoạt khi có đồng ý rõ ràng."""
    ACTIVE, UNSUBSCRIBED, BLACKLISTED = 'active', 'unsubscribed', 'blacklisted'
    STATUSES = [(ACTIVE, 'Đang nhận tin'), (UNSUBSCRIBED, 'Đã hủy đăng ký'), (BLACKLISTED, 'Danh sách chặn')]
    SOURCES = [('patient', 'Hồ sơ bệnh nhân có đồng ý'), ('website', 'Đăng ký trên website'),
               ('manual', 'Nhập thủ công có xác nhận'), ('import', 'Nhập từ tệp có xác nhận')]

    email = models.EmailField(unique=True, db_index=True)
    full_name = models.CharField(max_length=120, blank=True)
    patient = models.ForeignKey(Patient, on_delete=models.SET_NULL, null=True, blank=True, related_name='marketing_contacts')
    source = models.CharField(max_length=12, choices=SOURCES, default='manual')
    status = models.CharField(max_length=14, choices=STATUSES, default=ACTIVE, db_index=True)
    consent_at = models.DateTimeField(default=timezone.now)
    consent_note = models.CharField(max_length=255, blank=True)
    unsubscribed_at = models.DateTimeField(null=True, blank=True)
    unsubscribe_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class MailingList(models.Model):
    name = models.CharField(max_length=120, unique=True)
    description = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    contacts = models.ManyToManyField(MarketingContact, related_name='mailing_lists', blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']


class EmailCampaign(models.Model):
    DRAFT, SCHEDULED, SENT, CANCELLED = 'draft', 'scheduled', 'sent', 'cancelled'
    STATUSES = [(DRAFT, 'Bản nháp'), (SCHEDULED, 'Đã lên lịch'), (SENT, 'Đã gửi'), (CANCELLED, 'Đã hủy')]
    name = models.CharField(max_length=160)
    subject = models.CharField(max_length=180)
    preview_text = models.CharField(max_length=180, blank=True)
    body_html = models.TextField(blank=True)
    mailing_list = models.ForeignKey(MailingList, on_delete=models.PROTECT, related_name='campaigns')
    status = models.CharField(max_length=12, choices=STATUSES, default=DRAFT, db_index=True)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    recipient_count = models.PositiveIntegerField(default=0)
    sent_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
