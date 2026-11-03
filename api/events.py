from django.contrib.auth import get_user_model
from core.models import Notification
from .firebase import mirror_notification, publish_system_event

User = get_user_model()

OPTIONAL_NOTIFICATION_SETTINGS = {
    'profile.updated': 'notification.profile_updates',
    'payroll.updated': 'notification.payroll_updates',
    'loyalty.adjusted': 'notification.loyalty_updates',
    'loyalty.tier': 'notification.loyalty_updates',
    'marketing.campaign': 'notification.marketing_updates',
}


def notify_users(users, event_type, title, message='', data=None):
    seen = set()
    created = []
    for user in users:
        if not user or not getattr(user, 'pk', None) or user.pk in seen:
            continue
        seen.add(user.pk)
        # Only optional notices have a personal switch. Appointment, clinical,
        # inbox, safety, and approval notifications always remain enabled.
        preference = OPTIONAL_NOTIFICATION_SETTINGS.get(event_type)
        if preference:
            from core.operational_settings import setting_value
            if not setting_value('user', preference, user=user):
                continue
        item = Notification.objects.create(
            user=user, event_type=event_type, title=title, message=message, data=data or {},
        )
        created.append(item)
        try:
            mirror_notification(item)
        except Exception:
            pass
    return created


def notify_roles(roles, event_type, title, message='', data=None):
    return notify_users(User.objects.filter(role__in=roles, is_active=True), event_type, title, message, data)


def broadcast_dashboard(event_type, payload=None):
    try:
        publish_system_event('manager-dashboard', event_type, payload or {})
    except Exception:
        pass
