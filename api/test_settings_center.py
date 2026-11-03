from rest_framework.test import APITestCase
from django.core.cache import cache
from unittest.mock import patch

from accounts.models import User
from core.models import ChatSetting, ChatbotSetting, ClinicSettingAudit, ClinicSettingValue
from api.events import notify_users


class SettingsCenterApiTests(APITestCase):
    def make_user(self, username, role):
        return User.objects.create_user(username=username, password='test-only-password', role=role)

    def test_personal_settings_are_scoped_to_the_authenticated_user(self):
        first = self.make_user('settings-a', User.Role.CONSULTANT)
        second = self.make_user('settings-b', User.Role.CONSULTANT)
        self.client.force_authenticate(first)
        response = self.client.get('/api/settings/user/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['definitions'][0]['group'], 'personal')
        self.assertEqual(response.data['values']['ui.calendar_view'], 'calendar')
        versions = response.data['versions']
        response = self.client.put('/api/settings/user/', {
            'values': {'ui.compact_sidebar': True},
            'versions': {'ui.compact_sidebar': versions['ui.compact_sidebar']},
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['values']['ui.compact_sidebar'])
        self.assertEqual(ClinicSettingValue.objects.get(scope='user', scope_key=str(first.pk), key='ui.compact_sidebar').value, True)
        self.assertFalse(ClinicSettingValue.objects.filter(scope='user', scope_key=str(second.pk)).exists())

        self.client.force_authenticate(second)
        response = self.client.get('/api/settings/user/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['values']['ui.compact_sidebar'])

    def test_clinic_settings_are_read_only_for_clinical_roles_and_manager_writes_are_audited(self):
        staff = self.make_user('settings-doctor', User.Role.DOCTOR)
        manager = self.make_user('settings-manager', User.Role.MANAGER)
        self.client.force_authenticate(staff)
        readable = self.client.get('/api/settings/clinic/')
        self.assertEqual(readable.status_code, 200)
        self.assertIn('booking.online_enabled', readable.data['values'])
        self.assertNotIn('clinic.tax_code', readable.data['values'])
        forbidden = self.client.put('/api/settings/clinic/', {
            'values': {'booking.online_enabled': False},
            'versions': {'booking.online_enabled': readable.data['versions']['booking.online_enabled']},
            'reason': 'Không được quyền ghi',
        }, format='json')
        self.assertEqual(forbidden.status_code, 403)

        self.client.force_authenticate(manager)
        current = self.client.get('/api/settings/clinic/').data
        response = self.client.put('/api/settings/clinic/', {
            'values': {'booking.minimum_advance_minutes': 45},
            'versions': {'booking.minimum_advance_minutes': current['versions']['booking.minimum_advance_minutes']},
            'reason': 'Kiểm thử chính sách đặt lịch',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['values']['booking.minimum_advance_minutes'], 45)
        audit = ClinicSettingAudit.objects.get(setting_key='booking.minimum_advance_minutes')
        self.assertEqual(audit.actor, manager)
        self.assertEqual(audit.reason, 'Kiểm thử chính sách đặt lịch')

    def test_settings_reject_unknown_or_invalid_values(self):
        manager = self.make_user('settings-validation', User.Role.MANAGER)
        self.client.force_authenticate(manager)
        unknown = self.client.put('/api/settings/clinic/', {
            'values': {'SECRET_KEY': 'not-allowed'}, 'versions': {'SECRET_KEY': 0}, 'reason': 'test',
        }, format='json')
        self.assertEqual(unknown.status_code, 400)
        invalid = self.client.put('/api/settings/clinic/', {
            'values': {'booking.minimum_advance_minutes': 5000},
            'versions': {'booking.minimum_advance_minutes': 0}, 'reason': 'test',
        }, format='json')
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(ClinicSettingValue.objects.filter(scope='clinic').exists())

    def test_stale_versions_return_conflict(self):
        manager = self.make_user('settings-conflict', User.Role.MANAGER)
        self.client.force_authenticate(manager)
        version = self.client.get('/api/settings/clinic/').data['versions']['booking.slot_interval_minutes']
        first = self.client.put('/api/settings/clinic/', {
            'values': {'booking.slot_interval_minutes': 30},
            'versions': {'booking.slot_interval_minutes': version}, 'reason': 'Thay đổi bước lịch',
        }, format='json')
        self.assertEqual(first.status_code, 200)
        second = self.client.put('/api/settings/clinic/', {
            'values': {'booking.slot_interval_minutes': 10},
            'versions': {'booking.slot_interval_minutes': version}, 'reason': 'Ghi cũ',
        }, format='json')
        self.assertEqual(second.status_code, 409)
        self.assertEqual(ClinicSettingAudit.objects.filter(setting_key='booking.slot_interval_minutes').count(), 1)

    def test_audit_visibility_is_role_scoped(self):
        manager = self.make_user('settings-audit-manager', User.Role.MANAGER)
        clinic = ClinicSettingValue.objects.create(scope='clinic', scope_key='default', key='booking.online_enabled', value=False)
        ClinicSettingAudit.objects.create(setting_key=clinic.key, scope='clinic', scope_key='default', new_value=False, version=1)
        ClinicSettingAudit.objects.create(setting_key='ui.show_date', scope='user', scope_key='7', new_value=False, version=1)
        self.client.force_authenticate(manager)
        response = self.client.get('/api/settings/audit/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['scope'] for item in response.data['results']], ['clinic'])
        self.assertEqual(self.client.get('/api/settings/audit/?scope=user').status_code, 403)

    def test_disabling_online_booking_blocks_public_availability(self):
        ClinicSettingValue.objects.create(scope='clinic', scope_key='default', key='booking.online_enabled', value=False)
        cache.delete('akina_setting:clinic:default:booking.online_enabled')
        response = self.client.get('/api/availability/', {'date': '2026-11-10'})
        self.assertEqual(response.status_code, 403)
        self.assertIn('tạm ngưng', response.data['detail'])

    def test_sensitive_clinic_details_are_only_returned_to_staff(self):
        ClinicSettingValue.objects.create(scope='clinic', scope_key='default', key='clinic.tax_code', value='TAX-123')
        cache.delete('akina_setting:clinic:default:clinic.tax_code')
        public = self.client.get('/api/clinic/profile/')
        self.assertEqual(public.status_code, 200)
        self.assertNotIn('tax_code', public.data)
        self.client.force_authenticate(self.make_user('profile-doctor', User.Role.DOCTOR))
        staff = self.client.get('/api/clinic/profile/')
        self.assertEqual(staff.data['tax_code'], 'TAX-123')

    def test_support_settings_are_read_only_to_staff_and_live_for_chatbot(self):
        staff = self.make_user('settings-support-staff', User.Role.CONSULTANT)
        manager = self.make_user('settings-support-manager', User.Role.MANAGER)
        self.client.force_authenticate(staff)
        readable = self.client.get('/api/settings/support/')
        self.assertEqual(readable.status_code, 200)
        self.assertTrue(readable.data['confirmation_required'])
        self.assertIn('support.sla_minutes', readable.data['values'])
        self.assertNotIn('chatbot.system_prompt', readable.data['values'])
        self.assertNotIn('chatbot.model_name', readable.data['values'])
        forbidden = self.client.put('/api/settings/support/', {
            'values': {'support.sla_minutes': 20},
            'versions': {'support.sla_minutes': readable.data['versions']['support.sla_minutes']},
            'reason': 'Không được quyền ghi',
        }, format='json')
        self.assertEqual(forbidden.status_code, 403)

        self.client.force_authenticate(manager)
        current = self.client.get('/api/settings/support/').data
        response = self.client.put('/api/settings/support/', {
            'values': {'support.sla_minutes': 20, 'chatbot.assistant_name': 'Akina Hỗ trợ'},
            'versions': current['versions'],
            'reason': 'Điều chỉnh quy trình tiếp nhận',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ChatSetting.load().sla_minutes, 20)
        self.assertEqual(ChatbotSetting.load().assistant_name, 'Akina Hỗ trợ')
        from api.chatbot import public_config
        self.assertEqual(public_config()['name'], 'Akina Hỗ trợ')
        self.assertTrue(response.data['confirmation_required'])
        audit = ClinicSettingAudit.objects.get(setting_key='support.sla_minutes')
        self.assertEqual(audit.actor, manager)
        self.assertEqual(audit.reason, 'Điều chỉnh quy trình tiếp nhận')

    def test_support_settings_validate_hours_and_reject_stale_versions(self):
        manager = self.make_user('settings-support-validation', User.Role.MANAGER)
        self.client.force_authenticate(manager)
        current = self.client.get('/api/settings/support/').data
        invalid_hours = self.client.put('/api/settings/support/', {
            'values': {'support.business_start': '22:00', 'support.business_end': '08:00'},
            'versions': current['versions'], 'reason': 'Kiểm thử giờ trực',
        }, format='json')
        self.assertEqual(invalid_hours.status_code, 400)
        self.assertEqual(ChatSetting.load().business_start.strftime('%H:%M'), '08:00')

        first = self.client.put('/api/settings/support/', {
            'values': {'support.auto_close_daily': False},
            'versions': {'support.auto_close_daily': current['versions']['support.auto_close_daily']},
            'reason': 'Điều chỉnh ca trực',
        }, format='json')
        self.assertEqual(first.status_code, 200)
        stale = self.client.put('/api/settings/support/', {
            'values': {'support.auto_close_daily': True},
            'versions': {'support.auto_close_daily': current['versions']['support.auto_close_daily']},
            'reason': 'Gửi từ phiên cũ',
        }, format='json')
        self.assertEqual(stale.status_code, 409)
        self.assertFalse(ChatSetting.load().auto_close_daily)

    def test_role_action_settings_only_restrict_existing_role_grants(self):
        manager = self.make_user('settings-role-matrix', User.Role.MANAGER)
        consultant = self.make_user('settings-role-consultant', User.Role.CONSULTANT)
        self.client.force_authenticate(manager)
        current = self.client.get('/api/settings/clinic/').data
        response = self.client.put('/api/settings/clinic/', {
            'values': {'access.restricted_actions': ['consultant:booking:confirm', 'consultant:billing:create']},
            'versions': {'access.restricted_actions': current['versions']['access.restricted_actions']},
            'reason': 'Phân công quyền theo ca trực',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        from core.role_permissions import configured_action_allowed
        self.assertFalse(configured_action_allowed(consultant, 'booking', 'confirm'))
        self.assertFalse(configured_action_allowed(consultant, 'billing', 'create'))
        self.assertTrue(configured_action_allowed(consultant, 'clinical', 'update'))
        invalid = self.client.put('/api/settings/clinic/', {
            'values': {'access.restricted_actions': ['sysadmin:clinical:view']},
            'versions': {'access.restricted_actions': response.data['versions']['access.restricted_actions']},
            'reason': 'Giá trị không được cấp phép',
        }, format='json')
        self.assertEqual(invalid.status_code, 400)

    def test_optional_notification_preferences_cannot_disable_critical_events(self):
        user = self.make_user('settings-notification-pref', User.Role.CONSULTANT)
        ClinicSettingValue.objects.create(scope='user', scope_key=str(user.pk),
                                          key='notification.profile_updates', value=False)
        cache.delete(f'akina_setting:user:{user.pk}:notification.profile_updates')
        with patch('api.events.mirror_notification'):
            notify_users([user], 'profile.updated', 'Hồ sơ đã cập nhật')
            notify_users([user], 'booking.cancelled', 'Lịch hẹn đã hủy')
        self.assertEqual(user.notifications.count(), 1)
        self.assertEqual(user.notifications.first().event_type, 'booking.cancelled')

    def test_loyalty_settings_apply_once_to_newly_completed_transaction(self):
        from types import SimpleNamespace
        from core.loyalty import award_booking_points
        user = self.make_user('settings-loyalty', User.Role.CUSTOMER)
        ClinicSettingValue.objects.create(scope='clinic', scope_key='default', key='crm.loyalty_enabled', value=True)
        ClinicSettingValue.objects.create(scope='clinic', scope_key='default', key='crm.vnd_per_point', value=20000)
        cache.delete('akina_setting:clinic:default:crm.loyalty_enabled')
        cache.delete('akina_setting:clinic:default:crm.vnd_per_point')
        booking = SimpleNamespace(user_id=user.pk, user=user, loyalty_awarded=False,
                                  loyalty_points_earned=0, total=50000)
        self.assertEqual(award_booking_points(booking), 2)
        user.refresh_from_db()
        self.assertEqual(user.loyalty_points, 2)
        self.assertEqual(award_booking_points(booking), 0)
        user.refresh_from_db()
        self.assertEqual(user.loyalty_points, 2)

