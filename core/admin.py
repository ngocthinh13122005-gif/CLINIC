from django.contrib import admin
from .models import *

admin.site.site_header = 'Quản trị Spa'

@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    search_fields = ('name',)

@admin.register(Service)
class ServiceAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'price', 'duration', 'is_active')
    list_filter = ('category', 'is_active')
    search_fields = ('name',)

class WorkingHoursInline(admin.TabularInline):
    model = WorkingHours; extra = 1

@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ('name', 'position', 'phone', 'user', 'is_active')
    filter_horizontal = ('services',)
    inlines = [WorkingHoursInline]

class ItemInline(admin.TabularInline):
    model = BookingItem; extra = 0

@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ('id', 'customer_name', 'appointment', 'total', 'status', 'staff', 'confirm_code')
    list_filter = ('status',)
    list_editable = ('status',)
    search_fields = ('user__username', 'user__first_name', 'guest_name', 'guest_phone', 'confirm_code')
    readonly_fields = ('confirm_code',)
    inlines = [ItemInline]

@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ('service', 'user', 'rating', 'is_visible', 'created_at')
    list_editable = ('is_visible',)

@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ('name', 'email', 'created_at', 'is_read')

@admin.register(ChatbotSetting)
class ChatbotSettingAdmin(admin.ModelAdmin):
    list_display = ('assistant_name', 'enabled', 'ai_enabled', 'model_name', 'updated_at')


@admin.register(ChatbotFAQ)
class ChatbotFAQAdmin(admin.ModelAdmin):
    list_display = ('question', 'is_active', 'sort_order', 'times_used', 'updated_at')
    list_filter = ('is_active',)
    search_fields = ('question', 'answer', 'keywords')


@admin.register(ChatbotQuickAction)
class ChatbotQuickActionAdmin(admin.ModelAdmin):
    list_display = ('label', 'action_type', 'is_active', 'sort_order')
    list_filter = ('action_type', 'is_active')


class ChatbotMessageInline(admin.TabularInline):
    model = ChatbotMessage
    extra = 0
    readonly_fields = ('role', 'content', 'source', 'created_at')
    can_delete = False


@admin.register(ChatbotSession)
class ChatbotSessionAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'visitor_key', 'created_at', 'updated_at')
    search_fields = ('visitor_key', 'user__username', 'user__first_name', 'user__last_name')
    readonly_fields = ('visitor_key', 'user', 'page_url', 'user_agent', 'created_at', 'updated_at')
    inlines = [ChatbotMessageInline]

@admin.register(ChatbotToolCall)
class ChatbotToolCallAdmin(admin.ModelAdmin):
    list_display = ('id', 'session', 'tool_name', 'success', 'created_at')
    list_filter = ('tool_name', 'success', 'created_at')
    search_fields = ('session__visitor_key', 'session__user__username', 'tool_name')
    readonly_fields = ('session', 'tool_name', 'arguments', 'result', 'success', 'created_at')


@admin.register(VoucherRedemption)
class VoucherRedemptionAdmin(admin.ModelAdmin):
    list_display = ('user', 'voucher', 'status', 'redeemed_at', 'used_at', 'booking')
    list_filter = ('status',)

@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ('user', 'event_type', 'title', 'is_read', 'created_at')
    list_filter = ('event_type', 'is_read')
    search_fields = ('user__username', 'title', 'message')
