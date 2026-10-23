import datetime

from django.conf import settings
from django.db import models

class Category(models.Model):
    name = models.CharField('Tên danh mục', max_length=100)
    class Meta:
        verbose_name = 'Danh mục'; verbose_name_plural = 'Danh mục'
    def __str__(self): return self.name

class Service(models.Model):
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name='services', verbose_name='Danh mục')
    name = models.CharField('Tên dịch vụ', max_length=150)
    description = models.TextField('Mô tả', blank=True)
    price = models.PositiveIntegerField('Giá (VNĐ)')
    duration = models.PositiveIntegerField('Thời lượng (phút)', default=60)
    image = models.ImageField('Ảnh', upload_to='services/', blank=True, null=True)
    is_active = models.BooleanField('Đang hoạt động', default=True)
    class Meta:
        verbose_name = 'Dịch vụ'; verbose_name_plural = 'Dịch vụ'
    def __str__(self): return self.name

class Staff(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name='staff_profile', verbose_name='Tài khoản đăng nhập')
    name = models.CharField('Họ tên', max_length=100)
    position = models.CharField('Chức vụ', max_length=100)
    phone = models.CharField('SĐT', max_length=15, blank=True)
    photo = models.ImageField('Ảnh', upload_to='staff/', blank=True, null=True)
    services = models.ManyToManyField(Service, blank=True, related_name='qualified_staff',
                                       verbose_name='Dịch vụ có thể thực hiện')
    is_active = models.BooleanField('Đang làm việc', default=True)
    rating = models.DecimalField('Điểm đánh giá', max_digits=2, decimal_places=1, default=5.0)
    experience_years = models.PositiveSmallIntegerField('Số năm kinh nghiệm', default=0)
    base_salary = models.PositiveIntegerField('Lương cơ bản', default=6000000)
    bonus = models.PositiveIntegerField('Thưởng', default=0)
    manual_deduction = models.PositiveIntegerField('Khấu trừ thủ công', default=0)
    payroll_status = models.CharField('Trạng thái lương', max_length=12, choices=[('draft','Nháp'),('approved','Đã duyệt'),('paid','Đã thanh toán')], default='draft')
    class Meta:
        verbose_name = 'Nhân sự'; verbose_name_plural = 'Nhân sự'
    def __str__(self): return f'{self.name} - {self.position}'

class WorkingHours(models.Model):
    """Lịch làm việc theo tuần của một nhân sự — dùng để tính slot khả dụng khi đặt lịch."""
    WEEKDAYS = [(0, 'Thứ Hai'), (1, 'Thứ Ba'), (2, 'Thứ Tư'), (3, 'Thứ Năm'),
                (4, 'Thứ Sáu'), (5, 'Thứ Bảy'), (6, 'Chủ Nhật')]
    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name='working_hours', verbose_name='Nhân sự')
    weekday = models.PositiveSmallIntegerField('Thứ trong tuần', choices=WEEKDAYS)
    start_time = models.TimeField('Bắt đầu')
    end_time = models.TimeField('Kết thúc')

    class Meta:
        verbose_name = 'Lịch làm việc'; verbose_name_plural = 'Lịch làm việc'
        ordering = ['staff', 'weekday', 'start_time']
        unique_together = ('staff', 'weekday', 'start_time')

    def __str__(self):
        return f'{self.staff} · {self.get_weekday_display()} {self.start_time:%H:%M}-{self.end_time:%H:%M}'


class RosterShift(models.Model):
    """Trạng thái trực theo từng ngày để quản lý bật/tắt nhân sự mà không khóa tài khoản."""
    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name='roster_shifts', verbose_name='Nhân sự')
    date = models.DateField('Ngày')
    is_on_duty = models.BooleanField('Đang trực', default=True)
    note = models.CharField('Ghi chú', max_length=160, blank=True)

    class Meta:
        unique_together = ('staff', 'date')
        ordering = ['date', 'staff__name']
        verbose_name = 'Trạng thái trực'
        verbose_name_plural = 'Trạng thái trực'

    def __str__(self):
        return f'{self.staff} · {self.date} · {"On duty" if self.is_on_duty else "Off duty"}'


class Booking(models.Model):
    PENDING, CONFIRMED, COMPLETED, CANCELLED = 'pending', 'confirmed', 'completed', 'cancelled'
    STATUS = [(PENDING, 'Chờ xác nhận'), (CONFIRMED, 'Đã xác nhận'),
              (COMPLETED, 'Hoàn thành'), (CANCELLED, 'Đã hủy')]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='bookings', verbose_name='Khách hàng')
    # Đặt lịch không cần đăng nhập (guest checkout): dùng khi user=None.
    guest_name = models.CharField('Họ tên (khách vãng lai)', max_length=100, blank=True)
    guest_phone = models.CharField('SĐT (khách vãng lai)', max_length=15, blank=True)
    guest_email = models.EmailField('Email (khách vãng lai)', blank=True)
    patient = models.ForeignKey('clinic.Patient', on_delete=models.SET_NULL, null=True, blank=True,
                                related_name='bookings', verbose_name='Hồ sơ bệnh nhân')
    appointment_type = models.CharField('Loại lịch hẹn', max_length=10, default='consult', choices=[
        ('consult', 'Khám / tư vấn'), ('follow_up', 'Tái khám'), ('procedure', 'Thủ thuật'), ('session', 'Buổi liệu trình')])
    confirm_code = models.CharField('Mã xác nhận', max_length=16, unique=True, blank=True)
    staff = models.ForeignKey(Staff, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='Nhân viên')
    services = models.ManyToManyField(Service, through='BookingItem', verbose_name='Dịch vụ')
    appointment = models.DateTimeField('Thời gian hẹn')
    total = models.PositiveIntegerField('Tổng tiền', default=0)
    discount_total = models.PositiveIntegerField('Giảm giá', default=0)
    applied_voucher = models.ForeignKey('Voucher', on_delete=models.SET_NULL, null=True, blank=True, related_name='bookings', verbose_name='Voucher đã áp dụng')
    loyalty_awarded = models.BooleanField('Đã cộng điểm thưởng', default=False)
    loyalty_points_earned = models.PositiveIntegerField('Điểm thưởng nhận được', default=0)
    note = models.TextField('Ghi chú', blank=True)
    status = models.CharField('Trạng thái', max_length=12, choices=STATUS, default=PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        verbose_name = 'Lịch hẹn'; verbose_name_plural = 'Lịch hẹn'; ordering = ['-created_at']
    def __str__(self): return f'#{self.pk} - {self.customer_name}'

    def save(self, *args, **kwargs):
        if not self.confirm_code:
            from django.utils.crypto import get_random_string
            self.confirm_code = get_random_string(10, allowed_chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789')
        super().save(*args, **kwargs)

    @property
    def badge(self):
        return {'pending': 'warning text-dark', 'confirmed': 'primary', 'completed': 'success', 'cancelled': 'secondary'}[self.status]

    @property
    def duration_minutes(self):
        total = getattr(self, '_prefetched_duration', None)
        if total is not None:
            return total
        return sum(self.items.values_list('service__duration', flat=True)) or 0

    @property
    def end_time(self):
        from datetime import timedelta
        return self.appointment + timedelta(minutes=self.duration_minutes or 60)

    @property
    def customer_name(self):
        if self.guest_name:
            return self.guest_name
        return (self.user.get_full_name() or self.user.username) if self.user else 'Khách vãng lai'

    @property
    def customer_phone(self):
        return self.guest_phone or ((self.user.phone if self.user else '') or '')

    @property
    def customer_email(self):
        return self.guest_email or ((self.user.email if self.user else '') or '')

class BookingItem(models.Model):
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name='items')
    service = models.ForeignKey(Service, on_delete=models.PROTECT)
    price = models.PositiveIntegerField('Giá lúc đặt')

class Review(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    service = models.ForeignKey(Service, on_delete=models.CASCADE, related_name='reviews')
    booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name='reviews')
    rating = models.PositiveSmallIntegerField('Số sao', choices=[(i, i) for i in range(1, 6)])
    comment = models.TextField('Nhận xét', blank=True)
    is_visible = models.BooleanField('Hiển thị', default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        verbose_name = 'Đánh giá'; verbose_name_plural = 'Đánh giá'
        unique_together = ('booking', 'service')

class Attendance(models.Model):
    """Chấm công theo ngày của Nhân viên/Bác sĩ — tự tạo khi nhân sự bấm Check-in."""
    FULL_DAY, LATE, LEAVE, ABSENT = 'full_day', 'late', 'leave', 'absent'
    STATUS = [(FULL_DAY, 'Đủ công'), (LATE, 'Đi trễ'), (LEAVE, 'Nghỉ phép'), (ABSENT, 'Vắng')]

    staff = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='attendances',
                               verbose_name='Nhân sự', limit_choices_to={'role__in': ['staff', 'doctor']})
    date = models.DateField('Ngày')
    check_in = models.TimeField('Giờ vào', null=True, blank=True)
    check_out = models.TimeField('Giờ ra', null=True, blank=True)
    status = models.CharField('Trạng thái', max_length=10, choices=STATUS, default=FULL_DAY)
    note = models.CharField('Ghi chú', max_length=200, blank=True)

    class Meta:
        verbose_name = 'Chấm công'; verbose_name_plural = 'Chấm công'
        unique_together = ('staff', 'date'); ordering = ['-date', '-check_in']

    def __str__(self):
        return f'{self.staff} · {self.date}'

    @property
    def hours(self):
        if self.check_in and self.check_out:
            from datetime import datetime
            d1 = datetime.combine(self.date, self.check_in)
            d2 = datetime.combine(self.date, self.check_out)
            return round(max(0, (d2 - d1).total_seconds()) / 3600, 1)
        return 0


class LeaveRequest(models.Model):
    """Đơn xin nghỉ phép của Nhân viên/Bác sĩ, chờ Quản lý duyệt."""
    PAID, UNPAID = 'paid', 'unpaid'
    TYPE_CHOICES = [(PAID, 'Nghỉ phép có lương'), (UNPAID, 'Nghỉ không lương')]
    PENDING, APPROVED, REJECTED = 'pending', 'approved', 'rejected'
    STATUS_CHOICES = [(PENDING, 'Chờ duyệt'), (APPROVED, 'Đã duyệt'), (REJECTED, 'Từ chối')]
    ANNUAL_PAID_DAYS = 12  # số ngày phép năm mặc định mỗi nhân sự

    staff = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='leave_requests',
                               verbose_name='Nhân sự', limit_choices_to={'role__in': ['staff', 'doctor']})
    start_date = models.DateField('Từ ngày')
    end_date = models.DateField('Đến ngày')
    leave_type = models.CharField('Loại nghỉ', max_length=10, choices=TYPE_CHOICES, default=PAID)
    reason = models.TextField('Lý do', blank=True)
    status = models.CharField('Trạng thái', max_length=10, choices=STATUS_CHOICES, default=PENDING)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='decided_leaves', verbose_name='Người duyệt')
    decided_at = models.DateTimeField('Ngày duyệt', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Đơn nghỉ phép'; verbose_name_plural = 'Đơn nghỉ phép'; ordering = ['-created_at']

    def __str__(self):
        return f'{self.staff} · {self.start_date} → {self.end_date}'

    @property
    def days(self):
        return (self.end_date - self.start_date).days + 1


class Tag(models.Model):
    """Nhãn gắn cho ca tư vấn — danh sách do Manager quản lý."""
    name = models.CharField('Tên nhãn', max_length=50, unique=True)
    color = models.CharField('Màu', max_length=20, default='secondary')

    class Meta:
        verbose_name = 'Nhãn'; verbose_name_plural = 'Nhãn'; ordering = ['name']

    def __str__(self):
        return self.name


class QuickReply(models.Model):
    """Mẫu trả lời nhanh cho CSKH/Bác sĩ, do Manager quản lý."""
    title = models.CharField('Tiêu đề', max_length=100)
    body = models.TextField('Nội dung')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    is_active = models.BooleanField('Đang dùng', default=True)

    class Meta:
        verbose_name = 'Mẫu trả lời'; verbose_name_plural = 'Mẫu trả lời'; ordering = ['title']

    def __str__(self):
        return self.title


class AgentPresence(models.Model):
    ONLINE, BUSY, OFFLINE = 'online', 'busy', 'offline'
    STATUS_CHOICES = [(ONLINE, 'Online'), (BUSY, 'Bận'), (OFFLINE, 'Offline')]
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='presence')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OFFLINE)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Trạng thái nhân viên'; verbose_name_plural = 'Trạng thái nhân viên'

    def __str__(self):
        return f'{self.user} · {self.get_status_display()}'


class ChatSetting(models.Model):
    """Cấu hình chat — chỉ 1 dòng (singleton), do Manager chỉnh."""
    business_start = models.TimeField('Giờ mở cửa hỗ trợ', default=datetime.time(8, 0))
    business_end = models.TimeField('Giờ đóng cửa hỗ trợ', default=datetime.time(21, 0))
    sla_minutes = models.PositiveIntegerField('Ngưỡng SLA (phút)', default=15)
    greeting_message = models.CharField('Lời chào', max_length=255,
                                         default='Xin chào! Đội ngũ OHIO có thể giúp gì cho bạn?')
    offline_message = models.CharField('Thông báo ngoài giờ', max_length=255,
                                        default='Ngoài giờ hỗ trợ trực tiếp. Tin nhắn của bạn vẫn được lưu, CSKH sẽ phản hồi sớm nhất.')

    class Meta:
        verbose_name = 'Cấu hình chat'; verbose_name_plural = 'Cấu hình chat'

    def __str__(self):
        return 'Cấu hình chat'

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Conversation(models.Model):
    """Một ca tư vấn CSKH — có thể chuyển cho bác sĩ, có thể gắn kèm hồ sơ soi da."""
    OPEN, ESCALATED, CLOSED = 'open', 'escalated', 'closed'
    STATUS_CHOICES = [(OPEN, 'Đang mở'), (ESCALATED, 'Đã chuyển bác sĩ'), (CLOSED, 'Đã đóng')]
    NORMAL, URGENT = 'normal', 'urgent'
    PRIORITY_CHOICES = [(NORMAL, 'Bình thường'), (URGENT, 'Khẩn cấp')]

    customer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                  related_name='conversations', verbose_name='Khách hàng')
    subject = models.CharField('Câu hỏi ban đầu', max_length=255)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='assigned_conversations', verbose_name='CSKH phụ trách',
                                     limit_choices_to={'role': 'consultant'})
    escalated_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name='escalated_conversations', verbose_name='Bác sĩ tiếp nhận',
                                      limit_choices_to={'role': 'doctor'})
    taken_over_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='taken_over_conversations', verbose_name='Manager tiếp quản',
                                       limit_choices_to={'role': 'manager'})
    status = models.CharField('Trạng thái', max_length=10, choices=STATUS_CHOICES, default=OPEN)
    priority = models.CharField('Độ ưu tiên', max_length=10, choices=PRIORITY_CHOICES, default=NORMAL)
    tags = models.ManyToManyField(Tag, blank=True, related_name='conversations', verbose_name='Nhãn')
    first_response_at = models.DateTimeField('Phản hồi đầu tiên lúc', null=True, blank=True)
    resolved_at = models.DateTimeField('Đóng ca lúc', null=True, blank=True)
    csat_score = models.PositiveSmallIntegerField('Đánh giá (sao)', null=True, blank=True)
    csat_comment = models.TextField('Góp ý của khách', blank=True)
    customer_last_read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Ca tư vấn'; verbose_name_plural = 'Ca tư vấn'; ordering = ['-updated_at']

    def __str__(self):
        return f'Tư vấn #{self.pk} · {self.customer}'

    def last_read_for_staff(self, user):
        r = self.reads.filter(user=user).first()
        return r.last_read_at if r else None

    def unread_for(self, user):
        last_read = self.customer_last_read_at if user == self.customer else self.last_read_for_staff(user)
        qs = self.messages.exclude(sender=user)
        if last_read:
            qs = qs.filter(created_at__gt=last_read)
        return qs.count()


class Message(models.Model):
    TEXT, IMAGE, FILE, SYSTEM, CSAT = 'text', 'image', 'file', 'system', 'csat'
    TYPE_CHOICES = [(TEXT, 'Văn bản'), (IMAGE, 'Hình ảnh'), (FILE, 'Tệp'), (SYSTEM, 'Hệ thống'), (CSAT, 'Mời đánh giá')]

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sent_messages')
    text = models.TextField('Nội dung', max_length=2000, blank=True)
    message_type = models.CharField('Loại tin', max_length=10, choices=TYPE_CHOICES, default=TEXT)
    attachment = models.FileField('Tệp đính kèm', upload_to='chat/%Y/%m/%d/', blank=True, null=True)
    attachment_name = models.CharField('Tên tệp', max_length=255, blank=True)
    attachment_mime = models.CharField('MIME type', max_length=120, blank=True)
    attachment_size = models.PositiveBigIntegerField('Dung lượng', default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Tin nhắn'; verbose_name_plural = 'Tin nhắn'; ordering = ['created_at']

    def __str__(self):
        return f'{self.sender} · {(self.text or self.attachment_name)[:30]}'


class InternalNote(models.Model):
    """Ghi chú nội bộ giữa CSKH/Bác sĩ/Manager — khách hàng KHÔNG bao giờ thấy."""
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='notes')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    text = models.TextField('Ghi chú', max_length=1000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Ghi chú nội bộ'; verbose_name_plural = 'Ghi chú nội bộ'; ordering = ['created_at']


class ConversationEvent(models.Model):
    """Nhật ký thao tác trên ca tư vấn — gán, chuyển, tiếp quản, đóng, chia lại."""
    ASSIGNED, RETURNED, TRANSFERRED, TAKEN_OVER, CLOSED, REASSIGNED, REOPENED, TAGGED, NOTE_ADDED = (
        'assigned', 'returned', 'transferred', 'taken_over', 'closed', 'reassigned', 'reopened', 'tagged', 'note_added')
    EVENT_CHOICES = [(ASSIGNED, 'Nhận ca'), (RETURNED, 'Trả ca'), (TRANSFERRED, 'Chuyển bác sĩ'), (TAKEN_OVER, 'Manager tiếp quản'),
                      (CLOSED, 'Đóng ca'), (REASSIGNED, 'Chia lại ca'), (REOPENED, 'Mở lại ca'),
                      (TAGGED, 'Cập nhật nhãn'), (NOTE_ADDED, 'Thêm ghi chú')]
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='events')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    event_type = models.CharField(max_length=15, choices=EVENT_CHOICES)
    meta = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Sự kiện ca tư vấn'; verbose_name_plural = 'Sự kiện ca tư vấn'; ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_event_type_display()} · {self.conversation_id}'


class ConversationRead(models.Model):
    """Đã đọc riêng từng nhân viên — tránh lỗi 1 người mở là cả nhóm thấy 'đã đọc'."""
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='reads')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    last_read_at = models.DateTimeField()

    class Meta:
        unique_together = ('conversation', 'user')


class Voucher(models.Model):
    """Voucher giảm giá đổi bằng điểm thưởng — quản lý bởi Admin, khách hàng dùng điểm để đổi."""
    code = models.CharField('Mã', max_length=30, unique=True)
    title = models.CharField('Tiêu đề', max_length=150)
    description = models.TextField('Mô tả', blank=True)
    points_cost = models.PositiveIntegerField('Điểm cần đổi')
    discount_value = models.PositiveIntegerField('Giá trị giảm (VNĐ)')
    min_spend = models.PositiveIntegerField('Đơn tối thiểu (VNĐ)', default=0)
    expires_at = models.DateField('Ngày hết hạn', null=True, blank=True)
    is_active = models.BooleanField('Đang kích hoạt', default=True)
    redeemed_by = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name='redeemed_vouchers',
                                          verbose_name='Khách đã đổi')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Voucher'; verbose_name_plural = 'Voucher'; ordering = ['-created_at']

    def __str__(self):
        return f'{self.code} · {self.title}'

    @property
    def is_expired(self):
        from django.utils import timezone
        return bool(self.expires_at and self.expires_at < timezone.localdate())


class VoucherRedemption(models.Model):
    AVAILABLE, USED = 'available', 'used'
    STATUS_CHOICES = [(AVAILABLE, 'Chưa sử dụng'), (USED, 'Đã sử dụng')]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='voucher_redemptions')
    voucher = models.ForeignKey(Voucher, on_delete=models.CASCADE, related_name='redemptions')
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=AVAILABLE)
    redeemed_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)
    booking = models.OneToOneField(Booking, on_delete=models.SET_NULL, null=True, blank=True, related_name='voucher_redemption')

    class Meta:
        unique_together = ('user', 'voucher')
        ordering = ['-redeemed_at']

    def __str__(self):
        return f'{self.user} · {self.voucher.code} · {self.status}'


class Notification(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    event_type = models.CharField(max_length=80, db_index=True)
    title = models.CharField(max_length=160)
    message = models.CharField(max_length=500, blank=True)
    data = models.JSONField(default=dict, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user} · {self.title}'


class Contact(models.Model):
    name = models.CharField('Họ tên', max_length=100)
    email = models.EmailField()
    phone = models.CharField('SĐT', max_length=15, blank=True)
    message = models.TextField('Nội dung')
    is_read = models.BooleanField('Đã đọc', default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        verbose_name = 'Liên hệ'; verbose_name_plural = 'Liên hệ'; ordering = ['-created_at']


# ================= Chatbot AI OHIO =================
class ChatbotSetting(models.Model):
    """Cấu hình singleton cho Trợ lý OHIO. Chatbot vẫn có thể chạy FAQ khi AI/API chưa sẵn sàng."""
    enabled = models.BooleanField('Bật chatbot', default=True)
    ai_enabled = models.BooleanField('Bật trả lời AI', default=True)
    automation_enabled = models.BooleanField('Cho phép AI tự động thao tác', default=True)
    require_confirmation = models.BooleanField('Yêu cầu khách xác nhận trước thao tác thay đổi dữ liệu', default=True)
    assistant_name = models.CharField('Tên trợ lý', max_length=80, default='Trợ lý OHIO')
    greeting_message = models.TextField(
        'Lời chào',
        default='Xin chào, tôi là Trợ lý OHIO. Tôi có thể hỗ trợ bạn về dịch vụ, đặt lịch và thông tin chăm sóc khách hàng.'
    )
    system_prompt = models.TextField(
        'System prompt',
        default=(
            'Bạn là Trợ lý OHIO của hệ thống spa OHIO. Trả lời bằng tiếng Việt, ngắn gọn, lịch sự và chỉ dựa trên '
            'thông tin OHIO được cung cấp. Không tự bịa giá, voucher, lịch bác sĩ hoặc chính sách. Với câu hỏi sức khỏe '
            'hoặc da liễu, chỉ cung cấp thông tin chăm sóc chung; không chẩn đoán bệnh, không kê thuốc và không thay thế '
            'bác sĩ/chuyên viên. Nếu không chắc, hãy nói rõ và đề nghị khách gặp tư vấn viên OHIO.'
        )
    )
    model_name = models.CharField('Gemini model', max_length=80, default='gemini-3.8-flash')
    fallback_message = models.TextField(
        'Tin nhắn khi AI không trả lời được',
        default='Tôi chưa có đủ thông tin để trả lời chính xác. Bạn có thể chọn “Gặp tư vấn viên” để được OHIO hỗ trợ trực tiếp.'
    )
    temperature = models.FloatField('Độ sáng tạo', default=0.2)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Cấu hình chatbot'; verbose_name_plural = 'Cấu hình chatbot'

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return self.assistant_name


class ChatbotFAQ(models.Model):
    question = models.CharField('Câu hỏi mẫu', max_length=255)
    answer = models.TextField('Câu trả lời')
    keywords = models.CharField('Từ khóa', max_length=500, blank=True,
                                help_text='Phân tách bằng dấu phẩy, ví dụ: giờ mở cửa, mấy giờ, thời gian làm việc')
    is_active = models.BooleanField('Đang sử dụng', default=True)
    sort_order = models.PositiveIntegerField('Thứ tự', default=0)
    times_used = models.PositiveIntegerField('Số lần dùng', default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'FAQ chatbot'; verbose_name_plural = 'FAQ chatbot'; ordering = ['sort_order', 'id']

    def __str__(self):
        return self.question


class ChatbotQuickAction(models.Model):
    MESSAGE, URL, HUMAN = 'message', 'url', 'human'
    ACTION_TYPES = [(MESSAGE, 'Gửi câu hỏi'), (URL, 'Mở đường dẫn'), (HUMAN, 'Gặp tư vấn viên')]
    label = models.CharField('Nhãn nút', max_length=60)
    action_type = models.CharField('Loại thao tác', max_length=12, choices=ACTION_TYPES, default=MESSAGE)
    value = models.CharField('Giá trị', max_length=300, blank=True,
                             help_text='Nội dung gửi cho bot hoặc URL. Có thể để trống với “Gặp tư vấn viên”.')
    icon = models.CharField('Bootstrap icon', max_length=60, blank=True, default='bi-chat-dots')
    is_active = models.BooleanField('Đang hiển thị', default=True)
    sort_order = models.PositiveIntegerField('Thứ tự', default=0)

    class Meta:
        verbose_name = 'Nút nhanh chatbot'; verbose_name_plural = 'Nút nhanh chatbot'; ordering = ['sort_order', 'id']

    def __str__(self):
        return self.label


class ChatbotSession(models.Model):
    visitor_key = models.CharField('Mã phiên khách', max_length=64, unique=True, db_index=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
                             related_name='chatbot_sessions', verbose_name='Khách hàng')
    page_url = models.CharField('Trang bắt đầu', max_length=500, blank=True)
    user_agent = models.CharField('Trình duyệt', max_length=300, blank=True)
    is_closed = models.BooleanField('Đã đóng', default=False)
    pending_action = models.JSONField('Thao tác chờ xác nhận', default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Phiên chatbot'; verbose_name_plural = 'Phiên chatbot'; ordering = ['-updated_at']

    def __str__(self):
        return f'Chatbot #{self.pk} · {self.user or self.visitor_key[:10]}'


class ChatbotToolCall(models.Model):
    session = models.ForeignKey(ChatbotSession, on_delete=models.CASCADE, related_name='tool_calls')
    tool_name = models.CharField('Công cụ', max_length=80)
    arguments = models.JSONField('Tham số', default=dict, blank=True)
    result = models.JSONField('Kết quả', default=dict, blank=True)
    success = models.BooleanField('Thành công', default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Nhật ký công cụ chatbot'
        verbose_name_plural = 'Nhật ký công cụ chatbot'
        ordering = ['created_at', 'id']

    def __str__(self):
        return f'{self.tool_name} · {"OK" if self.success else "ERROR"}'


class ChatbotMessage(models.Model):
    USER, ASSISTANT = 'user', 'assistant'
    ROLES = [(USER, 'Khách'), (ASSISTANT, 'Trợ lý')]
    FAQ, AI, FALLBACK, ACTION, ERROR = 'faq', 'ai', 'fallback', 'action', 'error'
    SOURCES = [(FAQ, 'FAQ'), (AI, 'AI'), (FALLBACK, 'Fallback'), (ACTION, 'Tự động hóa'), (ERROR, 'Lỗi')]
    session = models.ForeignKey(ChatbotSession, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField('Vai trò', max_length=12, choices=ROLES)
    content = models.TextField('Nội dung', max_length=5000)
    source = models.CharField('Nguồn', max_length=12, choices=SOURCES, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Tin nhắn chatbot'; verbose_name_plural = 'Tin nhắn chatbot'; ordering = ['created_at', 'id']

    def __str__(self):
        return f'{self.get_role_display()} · {self.content[:50]}'
