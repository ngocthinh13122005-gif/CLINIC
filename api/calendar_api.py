from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, MethodNotAllowed, ValidationError
from rest_framework.response import Response

from core.availability import blocked_intervals, qualified_staff, slot_error
from core.models import BlockedTime, Booking, BookingHistory, BookingItem, Service, Staff
from .events import broadcast_dashboard, notify_users
from .permissions import IsStaffRole

LOCKED_BOOKING_STATUSES = {Booking.COMPLETED, Booking.CANCELLED, Booking.NO_SHOW}
ALLOWED_EDIT_FIELDS = {
    'appointment', 'appointment_type', 'duration_minutes', 'note', 'notify',
    'reset_confirm', 'service_ids', 'staff',
}


class CalendarRuleError(APIException):
    status_code = 400
    default_code = 'calendar_rule_violation'


class CalendarSlotConflict(CalendarRuleError):
    status_code = 409


def _calendar_datetime(value, field='appointment'):
    parsed = parse_datetime(str(value)) if value else None
    if parsed is None:
        raise CalendarRuleError(f'Giá trị "{field}" không hợp lệ.')
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return timezone.localtime(parsed)


def _calendar_int(value, field):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise CalendarRuleError(f'Giá trị "{field}" không hợp lệ.')


def _has_visit(booking):
    return getattr(booking, 'visit', None) is not None


def _validate_calendar_slot(staff, start, minutes, service_ids, appointment_type, exclude_id=None):
    if staff is None:
        raise CalendarRuleError('Cần chọn bác sĩ hoặc nhân sự.')
    if start.minute % 5 or start.second or start.microsecond:
        raise CalendarRuleError('Giờ hẹn phải tròn bội số 5 phút.')
    if not 10 <= minutes <= 480 or minutes % 5:
        raise CalendarRuleError('Thời lượng phải từ 10 đến 480 phút và là bội số 5.')
    if start <= timezone.now():
        raise CalendarRuleError('Giờ hẹn mới phải ở tương lai.')
    if (start + timedelta(minutes=minutes)).date() != start.date():
        raise CalendarRuleError('Lịch hẹn không được kéo dài qua nửa đêm.')
    if not staff.is_active or (staff.user_id and not staff.user.is_active):
        raise CalendarRuleError('Bác sĩ hoặc nhân sự đã ngừng hoạt động.')
    if appointment_type in {Booking.APPOINTMENT_TYPE_CONSULT, Booking.APPOINTMENT_TYPE_FOLLOW_UP}:
        if not staff.user_id or staff.user.role != 'doctor':
            raise CalendarRuleError('Loại lịch này cần được phân công cho bác sĩ đang hoạt động.')
    if appointment_type == Booking.APPOINTMENT_TYPE_PROCEDURE and service_ids:
        policies = set(Service.objects.filter(pk__in=service_ids).values_list('booking_policy', flat=True))
        if policies != {Service.BOOKING_DIRECT}:
            raise CalendarRuleError('Thủ thuật chỉ được chọn dịch vụ cho phép đặt trực tiếp.')
    if service_ids and not qualified_staff(Staff.objects.filter(pk=staff.pk), service_ids).exists():
        raise CalendarRuleError(f'{staff.name} không thực hiện đủ các dịch vụ của lịch hẹn này.')
    error = slot_error(staff, start, minutes, exclude_booking_id=exclude_id)
    if error:
        raise CalendarSlotConflict(error)


def _notify_booking_change(request, booking, event, title, text, email_event=None):
    payload = {'booking_id': booking.pk, 'status': booking.status}
    targets = [booking.user] if booking.user else []
    if booking.staff and booking.staff.user:
        targets.append(booking.staff.user)
    notify_users(targets, event, title, text, payload)
    broadcast_dashboard(event, payload)
    if email_event:
        from .views import _queue_email
        _queue_email(booking, request, email_event)


class BookingCalendarMixin:
    STAFF_ACTIONS = {
        'edit', 'rebook', 'running_late', 'confirm_state', 'update',
        'partial_update', 'confirm', 'complete', 'hold', 'no_show',
    }

    def get_permissions(self):
        if (
            getattr(self, 'action', None) in self.STAFF_ACTIONS
            and getattr(getattr(self, 'request', None), 'user', None)
            and self.request.user.is_authenticated
            and self.request.user.role == 'customer'
        ):
            return [IsStaffRole()]
        return super().get_permissions()

    def _edit_calendar_booking(self, request, booking):
        data = request.data
        if 'status' in data:
            raise MethodNotAllowed(request.method)
        unknown = set(data) - ALLOWED_EDIT_FIELDS
        if unknown:
            raise CalendarRuleError(f'Trường không được hỗ trợ: {", ".join(sorted(unknown))}.')
        with timezone.override(timezone.get_current_timezone()):
            from django.db import transaction

            with transaction.atomic():
                current = Booking.objects.select_for_update().select_related('staff', 'user').get(pk=booking.pk)
                if current.status in LOCKED_BOOKING_STATUSES:
                    raise CalendarRuleError('Lịch đã hoàn thành, đã hủy hoặc vắng mặt nên không thể chỉnh sửa.')
                slot_fields = {'appointment', 'staff', 'duration_minutes', 'service_ids'}
                if _has_visit(current) and slot_fields.intersection(data):
                    raise CalendarRuleError('Bệnh nhân đã được đón — chỉ có thể sửa ghi chú và loại lịch hẹn.')

                services = None
                if 'service_ids' in data:
                    service_ids = data['service_ids']
                    if not isinstance(service_ids, list):
                        raise CalendarRuleError('Danh sách dịch vụ không hợp lệ.')
                    ids = [_calendar_int(value, 'service_ids') for value in service_ids]
                    services = list(Service.objects.filter(pk__in=ids, is_active=True))
                    if len(services) != len(set(ids)):
                        raise CalendarRuleError('Có dịch vụ không hợp lệ hoặc đã ngừng hoạt động.')
                current_service_ids = list(current.items.values_list('service_id', flat=True))
                service_ids = [service.pk for service in services] if services is not None else current_service_ids

                appointment_type = data.get('appointment_type', current.appointment_type)
                if appointment_type not in dict(Booking.APPOINTMENT_TYPES):
                    raise CalendarRuleError('Loại lịch hẹn không hợp lệ.')
                if current.treatment_session_id and appointment_type != Booking.APPOINTMENT_TYPE_SESSION:
                    raise CalendarRuleError('Không thể đổi loại lịch của buổi liệu trình đã liên kết.')
                if current.follow_up_visit_id and appointment_type != Booking.APPOINTMENT_TYPE_FOLLOW_UP:
                    raise CalendarRuleError('Không thể đổi loại lịch của lịch tái khám đã liên kết.')
                if appointment_type == Booking.APPOINTMENT_TYPE_SESSION and not current.treatment_session_id:
                    raise CalendarRuleError('Buổi liệu trình phải được đặt từ hồ sơ liệu trình.')
                if appointment_type == Booking.APPOINTMENT_TYPE_FOLLOW_UP and not current.follow_up_visit_id:
                    raise CalendarRuleError('Lịch tái khám phải được đặt từ hồ sơ lượt khám.')
                if appointment_type == Booking.APPOINTMENT_TYPE_PROCEDURE and not service_ids:
                    raise CalendarRuleError('Thủ thuật cần có ít nhất một dịch vụ.')

                new_staff = current.staff
                if 'staff' in data:
                    staff_id = _calendar_int(data['staff'], 'staff')
                    if staff_id != current.staff_id:
                        if request.user.role == 'doctor':
                            raise CalendarRuleError('Tài khoản bác sĩ không được chuyển lịch sang bác sĩ khác.')
                        new_staff = Staff.objects.filter(pk=staff_id).first()
                        if new_staff is None:
                            raise CalendarRuleError('Không tìm thấy bác sĩ hoặc nhân sự.')
                new_start = _calendar_datetime(data['appointment']) if 'appointment' in data else current.appointment
                natural_duration = (
                    60 if appointment_type in {
                        Booking.APPOINTMENT_TYPE_CONSULT,
                        Booking.APPOINTMENT_TYPE_FOLLOW_UP,
                    } else sum(service.duration for service in services)
                    if services is not None else current.duration_minutes
                )
                if 'duration_minutes' in data:
                    minutes = _calendar_int(data['duration_minutes'], 'duration_minutes')
                elif services is not None and appointment_type not in {
                    Booking.APPOINTMENT_TYPE_CONSULT,
                    Booking.APPOINTMENT_TYPE_FOLLOW_UP,
                }:
                    minutes = natural_duration
                else:
                    minutes = current.duration_minutes or natural_duration or 60

                moved = new_start != current.appointment or new_staff != current.staff
                schedule_changed = moved or services is not None or 'duration_minutes' in data
                if schedule_changed and not _has_visit(current):
                    _validate_calendar_slot(
                        new_staff, new_start, minutes, service_ids, appointment_type, exclude_id=current.pk,
                    )

                old_status = current.status
                old_appointment = current.appointment
                if 'note' in data:
                    current.note = str(data.get('note') or '')[:2000]
                if appointment_type != current.appointment_type:
                    current.appointment_type = appointment_type
                if services is not None:
                    current.items.all().delete()
                    for service in services:
                        BookingItem.objects.create(
                            booking=current,
                            service=service,
                            price=0 if appointment_type in {
                                Booking.APPOINTMENT_TYPE_CONSULT,
                                Booking.APPOINTMENT_TYPE_FOLLOW_UP,
                                Booking.APPOINTMENT_TYPE_SESSION,
                            } else service.price,
                        )
                    subtotal = sum(item.price for item in current.items.all())
                    current.discount_total = min(current.discount_total, subtotal)
                    current.total = max(0, subtotal - current.discount_total)
                if moved:
                    current.rescheduled_from = current.appointment
                    current.reschedule_count += 1
                    current.appointment = new_start
                    current.staff = new_staff
                    current.running_late = False
                    current.confirm_state = Booking.CONFIRM_STATE_UNCONFIRMED
                    current.status = Booking.PENDING
                if schedule_changed:
                    effective_natural = (
                        60 if appointment_type in {
                            Booking.APPOINTMENT_TYPE_CONSULT,
                            Booking.APPOINTMENT_TYPE_FOLLOW_UP,
                        } else sum(item.service.duration for item in current.items.select_related('service'))
                    )
                    current.duration_override = None if minutes == effective_natural else minutes
                current.save()
                if moved or services is not None or 'duration_minutes' in data or appointment_type != booking.appointment_type or 'note' in data:
                    BookingHistory.objects.create(
                        booking=current,
                        actor=request.user,
                        event='rescheduled' if moved else 'updated',
                        old_status=old_status,
                        new_status=current.status,
                        old_appointment=old_appointment,
                        new_appointment=current.appointment,
                    )

        if moved:
            _notify_booking_change(
                request,
                current,
                'booking.rescheduled',
                'Lịch hẹn đã đổi giờ',
                f'Lịch hẹn #{current.pk} đã được dời sang {timezone.localtime(current.appointment):%H:%M %d/%m/%Y}.',
                email_event='rescheduled' if data.get('notify') else None,
            )
        return Response(self.get_serializer(current).data)

    def update(self, request, *args, **kwargs):
        return self._edit_calendar_booking(request, self.get_object())

    def partial_update(self, request, *args, **kwargs):
        return self._edit_calendar_booking(request, self.get_object())

    @action(detail=True, methods=['post'], permission_classes=[IsStaffRole])
    def edit(self, request, pk=None):
        return self._edit_calendar_booking(request, self.get_object())

    @action(detail=True, methods=['post'], permission_classes=[IsStaffRole])
    def rebook(self, request, pk=None):
        source = self.get_object()
        if source.status not in LOCKED_BOOKING_STATUSES:
            raise CalendarRuleError('Chỉ lịch đã kết thúc, đã hủy hoặc vắng mặt mới có thể đặt lại.')
        if source.appointment_type not in {
            Booking.APPOINTMENT_TYPE_CONSULT,
            Booking.APPOINTMENT_TYPE_PROCEDURE,
        }:
            raise CalendarRuleError('Lịch tái khám hoặc buổi liệu trình cần được đặt lại từ hồ sơ tương ứng.')
        items = list(source.items.select_related('service'))
        if source.appointment_type == Booking.APPOINTMENT_TYPE_PROCEDURE and (
            not items or any(not item.service.is_active or item.service.booking_policy != Service.BOOKING_DIRECT for item in items)
        ):
            raise CalendarRuleError('Có dịch vụ đã ngừng hoạt động hoặc không còn cho phép đặt trực tiếp.')
        start = _calendar_datetime(request.data.get('appointment'))
        staff = source.staff
        if request.data.get('staff') is not None:
            staff_id = _calendar_int(request.data['staff'], 'staff')
            if staff_id != source.staff_id and request.user.role == 'doctor':
                raise CalendarRuleError('Tài khoản bác sĩ không được đặt lại cho bác sĩ khác.')
            staff = Staff.objects.filter(pk=staff_id).first()
        duration = source.duration_minutes or (60 if source.appointment_type == Booking.APPOINTMENT_TYPE_CONSULT else 60)
        service_ids = [item.service_id for item in items]
        _validate_calendar_slot(staff, start, duration, service_ids, source.appointment_type)

        from django.db import transaction

        with transaction.atomic():
            booking = Booking.objects.create(
                user=source.user,
                guest_name=source.guest_name,
                guest_phone=source.guest_phone,
                guest_email=source.guest_email,
                patient=source.patient,
                appointment_type=source.appointment_type,
                staff=staff,
                appointment=start,
                note=source.note,
                total=sum(item.price for item in items),
                rebooked_from=source,
                duration_override=(
                    duration if duration != (
                        60 if source.appointment_type == Booking.APPOINTMENT_TYPE_CONSULT
                        else sum(item.service.duration for item in items)
                    ) else None
                ),
            )
            for item in items:
                BookingItem.objects.create(booking=booking, service=item.service, price=item.price)
            BookingHistory.objects.create(
                booking=booking,
                actor=request.user,
                event='created',
                new_status=booking.status,
                new_appointment=booking.appointment,
            )
        _notify_booking_change(
            request,
            booking,
            'booking.created',
            'Lịch hẹn mới',
            f'Lịch hẹn #{booking.pk} được đặt lại từ #{source.pk}.',
            email_event='created' if request.data.get('notify') else None,
        )
        return Response(self.get_serializer(booking).data, status=201)

    @action(detail=True, methods=['post'], url_path='running-late', permission_classes=[IsStaffRole])
    def running_late(self, request, pk=None):
        booking = self.get_object()
        if booking.status not in {Booking.PENDING, Booking.CONFIRMED} or _has_visit(booking):
            raise CalendarRuleError('Chỉ đánh dấu đến trễ cho lịch chưa đón khách.')
        if timezone.localtime(booking.appointment).date() != timezone.localdate():
            raise CalendarRuleError('Chỉ đánh dấu đến trễ cho lịch trong ngày hôm nay.')
        booking.running_late = bool(request.data.get('late', True))
        booking.save(update_fields=['running_late'])
        return Response(self.get_serializer(booking).data)

    @action(detail=True, methods=['post'], url_path='confirm-state', permission_classes=[IsStaffRole])
    def confirm_state(self, request, pk=None):
        booking = self.get_object()
        state = request.data.get('state')
        if state not in dict(Booking.CONFIRM_STATES):
            raise CalendarRuleError('Tình trạng liên hệ không hợp lệ.')
        if booking.status in LOCKED_BOOKING_STATUSES or _has_visit(booking):
            raise CalendarRuleError('Lịch này không còn cần xác nhận.')
        booking.confirm_state = state
        if state == Booking.CONFIRM_STATE_CONFIRMED:
            booking.status = Booking.CONFIRMED
        elif booking.status == Booking.CONFIRMED:
            booking.status = Booking.PENDING
        booking.save(update_fields=['confirm_state', 'status'])
        return Response(self.get_serializer(booking).data)


class BlockedTimeSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source='staff.name', read_only=True)
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = BlockedTime
        fields = ('id', 'staff', 'staff_name', 'kind', 'kind_label', 'start', 'end', 'note', 'created_at')
        read_only_fields = ('created_at',)

    def validate(self, attrs):
        instance = self.instance
        staff = attrs.get('staff') or (instance.staff if instance else None)
        start = attrs.get('start') or (instance.start if instance else None)
        end = attrs.get('end') or (instance.end if instance else None)
        if staff is None or start is None or end is None:
            raise CalendarRuleError('Cần chọn nhân sự, giờ bắt đầu và giờ kết thúc.')
        start = timezone.localtime(start)
        end = timezone.localtime(end)
        if end <= start:
            raise CalendarRuleError('Giờ kết thúc phải sau giờ bắt đầu.')
        if start.date() != end.date():
            raise CalendarRuleError('Khung giờ khóa không được kéo qua nửa đêm.')
        if start.minute % 5 or start.second or end.minute % 5 or end.second:
            raise CalendarRuleError('Giờ phải tròn bội số 5 phút.')
        if start <= timezone.now():
            raise CalendarRuleError('Không thể khóa khung giờ đã bắt đầu hoặc đã qua.')
        if not staff.is_active or (staff.user_id and not staff.user.is_active):
            raise CalendarRuleError('Bác sĩ hoặc nhân sự đã ngừng hoạt động.')
        request = self.context['request']
        if request.user.role == 'doctor' and (not staff.user_id or staff.user_id != request.user.id):
            raise CalendarRuleError('Bác sĩ chỉ được khóa giờ của chính mình.')

        block_id = instance.pk if instance else None
        if any(start < block_end and block_start < end for block_start, block_end, _kind in blocked_intervals(staff, start.date(), block_id)):
            raise CalendarSlotConflict('Trùng với một khung giờ khóa khác của nhân sự này.')
        bookings = Booking.objects.filter(
            staff=staff,
            appointment__gte=start - timedelta(hours=8),
            appointment__lt=end,
        ).exclude(status__in=[Booking.CANCELLED, Booking.NO_SHOW]).prefetch_related('items__service')
        for booking in bookings:
            if start < booking.end_time and booking.appointment < end:
                raise CalendarSlotConflict(
                    f'Khung giờ này trùng lịch hẹn #{booking.pk} lúc {timezone.localtime(booking.appointment):%H:%M}.'
                )
        attrs['staff'] = staff
        return attrs


class BlockedTimeViewSet(viewsets.ModelViewSet):
    serializer_class = BlockedTimeSerializer
    permission_classes = [IsStaffRole]

    def get_queryset(self):
        queryset = BlockedTime.objects.select_related('staff', 'staff__user')
        params = self.request.query_params
        start = parse_date(params.get('from', '')) if params.get('from') else None
        end = parse_date(params.get('to', '')) if params.get('to') else None
        if params.get('from') and start is None:
            raise ValidationError({'from': 'Ngày bắt đầu không hợp lệ.'})
        if params.get('to') and end is None:
            raise ValidationError({'to': 'Ngày kết thúc không hợp lệ.'})
        if start and end and start > end:
            raise ValidationError({'to': 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.'})
        if start:
            queryset = queryset.filter(end__date__gte=start)
        if end:
            queryset = queryset.filter(start__date__lte=end)
        if params.get('staff'):
            try:
                queryset = queryset.filter(staff_id=int(params['staff']))
            except (TypeError, ValueError):
                raise ValidationError({'staff': 'Nhân sự không hợp lệ.'})
        user = self.request.user
        if user.role == 'doctor':
            queryset = queryset.filter(staff__user=user)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save()
