from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone


class ClinicTimezoneMiddleware:
    """Apply the clinic's configured timezone to request handling and rendering."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            from .operational_settings import clinic_setting
            zone = ZoneInfo(clinic_setting('clinic.timezone'))
        except Exception:
            zone = ZoneInfo(settings.TIME_ZONE)
        timezone.activate(zone)
        try:
            return self.get_response(request)
        finally:
            timezone.deactivate()
