from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, ActivityLog, PasswordResetCode

@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (('Thông tin thêm', {'fields': ('phone', 'date_of_birth', 'avatar', 'role', 'loyalty_points', 'must_change_password', 'created_by')}),)
    list_display = ('username', 'first_name', 'role', 'phone', 'email', 'is_active', 'is_staff')
    list_filter = UserAdmin.list_filter + ('role',)

@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'user', 'action', 'detail')
    list_filter = ('action',)
    search_fields = ('user__username', 'detail')
    readonly_fields = ('user', 'action', 'detail', 'created_at')


@admin.register(PasswordResetCode)
class PasswordResetCodeAdmin(admin.ModelAdmin):
    list_display = ('email', 'verified', 'used', 'attempts', 'expires_at', 'created_at')
    search_fields = ('email',)
    readonly_fields = ('code_hash', 'reset_token', 'created_at')
