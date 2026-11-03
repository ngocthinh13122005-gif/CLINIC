from django.core.cache import cache

from .models import ClinicSettingValue
from .settings_registry import DEFINITIONS


def setting_value(scope, key, user=None):
    definition = DEFINITIONS.get(scope, {}).get(key)
    if not definition:
        raise KeyError(f'Unknown setting: {scope}.{key}')
    scope_key = str(user.pk) if scope == ClinicSettingValue.SCOPE_USER and user else 'default'
    cache_key = f'akina_setting:{scope}:{scope_key}:{key}'
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    value = ClinicSettingValue.objects.filter(scope=scope, scope_key=scope_key, key=key).values_list('value', flat=True).first()
    if value is None:
        value = definition['default']
    cache.set(cache_key, value, 60)
    return value


def clinic_setting(key):
    return setting_value(ClinicSettingValue.SCOPE_CLINIC, key)
