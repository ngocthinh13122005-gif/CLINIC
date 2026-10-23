from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        CUSTOMER = 'customer', 'Bệnh nhân'
        CONSULTANT = 'consultant', 'Nhân viên CSKH / Lễ tân'
        STAFF = 'staff', 'Điều dưỡng / Kỹ thuật viên'
        DOCTOR = 'doctor', 'Bác sĩ'
        MANAGER = 'manager', 'Quản lý phòng khám'
        SYSADMIN = 'sysadmin', 'Quản trị hệ thống'

    # Vai trò được cấp quyền quản trị Django /admin/ (không dùng cho tài khoản khách hàng/nhân sự thường)
    STAFF_LOGIN_ROLES = (Role.MANAGER, Role.SYSADMIN)

    phone = models.CharField('Số điện thoại', max_length=15, blank=True)
    date_of_birth = models.DateField('Ngày sinh', null=True, blank=True)
    avatar = models.ImageField('Ảnh đại diện', upload_to='avatars/', blank=True, null=True)
    role = models.CharField('Vai trò', max_length=12, choices=Role.choices, default=Role.CUSTOMER)
    must_change_password = models.BooleanField('Bắt buộc đổi mật khẩu', default=False)
    loyalty_points = models.PositiveIntegerField('Điểm thưởng', default=0)
    membership_tier_override = models.CharField('Hạng thành viên chỉ định', max_length=12, blank=True, choices=[('', 'Tự động'), ('Bronze','Bronze'), ('Silver','Silver'), ('Gold','Gold'), ('Platinum','Platinum')])
    created_by = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='created_accounts', verbose_name='Được tạo bởi')
    REQUIRED_FIELDS = ['email']

    def __str__(self):
        return self.get_full_name() or self.username

    LOYALTY_TIERS = [(0, 'Bronze', 'secondary'), (500_000, 'Silver', 'info'),
                      (2_000_000, 'Gold', 'warning'), (5_000_000, 'Platinum', 'primary')]

    @staticmethod
    def loyalty_tier_for_spend(spend):
        """Hạng thành viên dựa trên tổng chi tiêu (VNĐ) các lịch hẹn đã hoàn thành."""
        spend = spend or 0
        tier = User.LOYALTY_TIERS[0]
        for threshold, name, color in User.LOYALTY_TIERS:
            if spend >= threshold:
                tier = (threshold, name, color)
        return {'name': tier[1], 'color': tier[2]}

    def save(self, *args, **kwargs):
        # Chỉ Quản lý phòng khám và Quản trị hệ thống được vào Django Admin
        if self.role in self.STAFF_LOGIN_ROLES:
            self.is_staff = True
        elif not self.is_superuser:
            self.is_staff = False
        super().save(*args, **kwargs)

    def is_role(self, *roles):
        return self.role in roles


class ActivityLog(models.Model):
    """Nhật ký hoạt động phục vụ System Administrator theo dõi audit log."""
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name='activity_logs', verbose_name='Người thực hiện')
    action = models.CharField('Hành động', max_length=80)
    detail = models.CharField('Chi tiết', max_length=255, blank=True)
    created_at = models.DateTimeField('Thời gian', auto_now_add=True)

    class Meta:
        verbose_name = 'Nhật ký hoạt động'
        verbose_name_plural = 'Nhật ký hoạt động'
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.created_at:%d/%m/%Y %H:%M} · {self.user} · {self.action}'


class PasswordResetCode(models.Model):
    email = models.EmailField(db_index=True)
    code_hash = models.CharField(max_length=128)
    reset_token = models.CharField(max_length=80, blank=True, db_index=True)
    expires_at = models.DateTimeField()
    verified = models.BooleanField(default=False)
    used = models.BooleanField(default=False)
    attempts = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.email} · {self.created_at:%d/%m/%Y %H:%M}'
