"""
Engine tính "nhân viên phù hợp" và "slot khả dụng" cho luồng đặt lịch nâng cao.

Quy tắc:
- Một nhân sự "phù hợp" với một tổ hợp dịch vụ khi họ đang hoạt động và được gán
  thực hiện được TẤT CẢ dịch vụ trong tổ hợp đó (Staff.services).
- Slot khả dụng = nằm trong lịch làm việc (WorkingHours) của nhân sự ngày hôm đó,
  đủ chỗ cho tổng thời lượng dịch vụ, không trùng với lịch hẹn khác (pending/confirmed)
  của cùng nhân sự, và không ở trong quá khứ (có buffer tối thiểu so với hiện tại).
"""
from datetime import datetime, timedelta

from django.db.models import Count, Q
from django.utils import timezone

from .operational_settings import clinic_setting


def qualified_staff(staff_qs, service_ids):
    """Nhân sự đang hoạt động, thực hiện được TẤT CẢ dịch vụ trong service_ids."""
    service_ids = [i for i in service_ids if i]
    if not service_ids:
        return staff_qs.none()
    return (staff_qs.filter(is_active=True, services__id__in=service_ids)
            .annotate(n=Count('services', filter=Q(services__id__in=service_ids), distinct=True))
            .filter(n=len(set(service_ids))).distinct())


def _busy_intervals(staff, day, exclude_booking_id=None):
    """[(start, end)] các lịch hẹn (chưa hủy) của staff trong ngày `day` (tz-aware datetimes)."""
    from .models import Booking
    tz = timezone.get_current_timezone()
    day_start = timezone.make_aware(datetime.combine(day, datetime.min.time()), tz)
    day_end = day_start + timedelta(days=1)
    qs = (Booking.objects.filter(
        staff=staff,
        appointment__gte=day_start - timedelta(days=1),
        appointment__lt=day_end,
        status__in=Booking.ACTIVE_STATUSES,
    ).prefetch_related('items__service'))
    if exclude_booking_id:
        qs = qs.exclude(pk=exclude_booking_id)
    return [(b.appointment, b.end_time) for b in qs]


def blocked_intervals(staff, day, exclude_block_id=None):
    """[(start, end, kind)] các khung giờ khóa giao với ngày `day`."""
    from .models import BlockedTime
    tz = timezone.get_current_timezone()
    day_start = timezone.make_aware(datetime.combine(day, datetime.min.time()), tz)
    day_end = day_start + timedelta(days=1)
    qs = BlockedTime.objects.filter(staff=staff, start__lt=day_end, end__gt=day_start)
    if exclude_block_id:
        qs = qs.exclude(pk=exclude_block_id)
    return [(block.start, block.end, block.kind) for block in qs]


def _working_windows(staff, day):
    """[(start_dt, end_dt)] khung giờ làm việc của staff trong ngày `day`, tz-aware."""
    tz = timezone.get_current_timezone()
    windows = []
    for wh in staff.working_hours.filter(weekday=day.weekday()):
        windows.append((timezone.make_aware(datetime.combine(day, wh.start_time), tz),
                        timezone.make_aware(datetime.combine(day, wh.end_time), tz)))
    return windows


def _on_approved_leave(staff, day):
    from .models import LeaveRequest
    if not staff.user_id:
        return False
    return LeaveRequest.objects.filter(
        staff_id=staff.user_id, status=LeaveRequest.APPROVED, start_date__lte=day, end_date__gte=day
    ).exists()



def _off_duty_by_roster(staff, day):
    from .models import RosterShift
    shift = RosterShift.objects.filter(staff=staff, date=day).first()
    return bool(shift and not shift.is_on_duty)


def has_conflict(staff, start, duration_minutes, exclude_booking_id=None):
    """True nếu [start, start+duration) chồng lấn lịch hẹn khác, ngoài giờ, inactive hoặc đang nghỉ phép."""
    if (
        not staff.is_active
        or (staff.user_id and not staff.user.is_active)
        or _on_approved_leave(staff, start.date())
        or _off_duty_by_roster(staff, start.date())
    ):
        return True
    end = start + timedelta(minutes=duration_minutes)
    buffer = timedelta(minutes=int(clinic_setting('booking.buffer_minutes')))
    windows = _working_windows(staff, start.date())
    if not any(w_start <= start and end <= w_end for w_start, w_end in windows):
        return True
    if any(start < block_end and block_start < end for block_start, block_end, _kind in blocked_intervals(staff, start.date())):
        return True
    for b_start, b_end in _busy_intervals(staff, start.date(), exclude_booking_id):
        if start < b_end and b_start < end:
            return True
        if start >= b_end and start - b_end < buffer:
            return True
        if b_start >= end and b_start - end < buffer:
            return True
    return False


def slot_error(staff, start, duration_minutes, exclude_booking_id=None):
    """Thông báo tiếng Việt giải thích vì sao một lịch không thể dùng khung giờ này."""
    if staff is None:
        return 'Cần chọn bác sĩ hoặc nhân sự.'
    start = timezone.localtime(start) if timezone.is_aware(start) else timezone.make_aware(start)
    end = start + timedelta(minutes=duration_minutes)
    if not staff.is_active or (staff.user_id and not staff.user.is_active):
        return 'Bác sĩ hoặc nhân sự đã ngừng hoạt động.'
    if _on_approved_leave(staff, start.date()):
        return 'Bác sĩ đang nghỉ phép trong ngày này.'
    if _off_duty_by_roster(staff, start.date()):
        return 'Bác sĩ không có ca trực trong ngày này.'
    if not any(w_start <= start and end <= w_end for w_start, w_end in _working_windows(staff, start.date())):
        return 'Khung giờ nằm ngoài giờ làm việc của bác sĩ.'

    collision = slot_collision_error(staff, start, duration_minutes, exclude_booking_id)
    if collision:
        return collision
    busy = _busy_intervals(staff, start.date(), exclude_booking_id)
    buffer = timedelta(minutes=int(clinic_setting('booking.buffer_minutes')))
    for busy_start, busy_end in busy:
        if (start >= busy_end and start - busy_end < buffer) or (busy_start >= end and busy_start - end < buffer):
            return 'Khung giờ không đủ thời gian đệm với lịch hẹn khác.'
    return None


def slot_collision_error(staff, start, duration_minutes, exclude_booking_id=None):
    """Thông báo nếu khung giờ đè trực tiếp lên giờ khóa hoặc lịch hẹn khác."""
    from .models import BlockedTime

    if staff is None:
        return 'Cần chọn bác sĩ hoặc nhân sự.'
    start = timezone.localtime(start) if timezone.is_aware(start) else timezone.make_aware(start)
    end = start + timedelta(minutes=duration_minutes)
    for block_start, block_end, kind in blocked_intervals(staff, start.date()):
        if start < block_end and block_start < end:
            label = dict(BlockedTime.KINDS).get(kind, kind)
            return f'Trùng khung giờ khóa "{label}" của bác sĩ.'
    for busy_start, busy_end in _busy_intervals(staff, start.date(), exclude_booking_id):
        if start < busy_end and busy_start < end:
            return 'Khung giờ bị trùng với một lịch hẹn khác.'
    return None


def available_slots(staff, day, duration_minutes, exclude_booking_id=None):
    """Danh sách datetime hợp lệ; tự loại staff inactive, off duty, approved leave hoặc bị trùng lịch."""
    if not staff.is_active or _on_approved_leave(staff, day) or _off_duty_by_roster(staff, day):
        return []
    windows = _working_windows(staff, day)
    if not windows:
        return []
    busy = _busy_intervals(staff, day, exclude_booking_id)
    blocked = [(start, end) for start, end, _kind in blocked_intervals(staff, day)]
    now_floor = timezone.now() + timedelta(minutes=int(clinic_setting('booking.minimum_advance_minutes')))
    dur = timedelta(minutes=duration_minutes)
    buffer = timedelta(minutes=int(clinic_setting('booking.buffer_minutes')))
    step = timedelta(minutes=int(clinic_setting('booking.slot_interval_minutes')))
    slots = []
    for w_start, w_end in windows:
        cursor = w_start
        while cursor + dur <= w_end:
            end = cursor + dur
            overlap = any(
                (cursor < b_end and b_start < end)
                or (cursor >= b_end and cursor - b_end < buffer)
                or (b_start >= end and b_start - end < buffer)
                for b_start, b_end in busy
            )
            overlap = overlap or any(cursor < block_end and block_start < end for block_start, block_end in blocked)
            if cursor >= now_floor and end + buffer <= w_end and not overlap:
                slots.append(cursor)
            cursor += step
    return slots
