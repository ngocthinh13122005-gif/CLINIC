from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views
from .messenger import messenger_webhook
from .settings_views import SettingsAuditView, SettingsScopeView, SupportSettingsView, clinic_profile

router = DefaultRouter()
router.register('categories', views.CategoryViewSet, basename='category')
router.register('services', views.ServiceViewSet, basename='service')
router.register('staff', views.StaffViewSet, basename='staff')
router.register('working-hours', views.WorkingHoursViewSet, basename='working-hours')
router.register('roster-shifts', views.RosterShiftViewSet, basename='roster-shift')
router.register('blocked-times', views.BlockedTimeViewSet, basename='blocked-time')
router.register('appointment-waitlist', views.AppointmentWaitlistViewSet, basename='appointment-waitlist')
router.register('bookings', views.BookingViewSet, basename='booking')
router.register('vouchers', views.VoucherViewSet, basename='voucher')
router.register('attendance', views.AttendanceViewSet, basename='attendance')
router.register('leave-requests', views.LeaveRequestViewSet, basename='leave-request')
router.register('conversations', views.ConversationViewSet, basename='conversation')
router.register('tags', views.TagViewSet, basename='tag')
router.register('notifications', views.NotificationViewSet, basename='notification')

urlpatterns = [
    path('integrations/meta/webhook/', messenger_webhook, name='meta-messenger-webhook'),
    path('settings/audit/', SettingsAuditView.as_view(), name='api-settings-audit'),
    path('settings/support/', SupportSettingsView.as_view(), name='api-settings-support'),
    path('settings/<str:scope>/', SettingsScopeView.as_view(), name='api-settings-scope'),
    path('clinic/profile/', clinic_profile, name='api-clinic-profile'),
    path('auth/register/', views.RegisterView.as_view(), name='api-register'),
    path('auth/login/', views.LoginView.as_view(), name='api-login'),
    path('auth/logout/', views.LogoutView.as_view(), name='api-logout'),
    path('auth/me/', views.MeView.as_view(), name='api-me'),
    path('auth/change-password/', views.ChangePasswordView.as_view(), name='api-change-password'),
    path('auth/forgot-password/request/', views.ForgotPasswordRequestView.as_view(), name='api-forgot-password-request'),
    path('auth/forgot-password/verify/', views.ForgotPasswordVerifyView.as_view(), name='api-forgot-password-verify'),
    path('auth/forgot-password/reset/', views.ForgotPasswordResetView.as_view(), name='api-forgot-password-reset'),
    path('firebase/token/', views.firebase_token, name='api-firebase-token'),
    path('dashboard/summary/', views.dashboard_summary, name='api-dashboard-summary'),
    path('dashboard/manager/', views.manager_dashboard, name='api-dashboard-manager'),
    path('dashboard/crm/', views.crm_directory, name='api-dashboard-crm'),
    path('dashboard/crm-forecast/', views.crm_forecast, name='api-dashboard-crm-forecast'),
    path('dashboard/customers/<int:user_id>/points/', views.adjust_customer_points, name='api-customer-points'),
    path('dashboard/customers/<int:user_id>/tier/', views.set_customer_tier, name='api-customer-tier'),
    path('dashboard/payroll/', views.payroll_report, name='api-dashboard-payroll'),
    path('media/upload/', views.media_upload, name='api-media-upload'),
    path('chatbot/session/', views.chatbot_session, name='api-chatbot-session'),
    path('chatbot/message/', views.chatbot_message, name='api-chatbot-message'),
    path('availability/', views.availability, name='api-availability'),
    path('tickets/<str:code>/', views.public_ticket, name='api-public-ticket'),
    path('', include(router.urls)),
]
