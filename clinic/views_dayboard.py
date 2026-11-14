"""Bảng lịch hôm nay (mở từ icon lịch trên header): lịch hẹn của một ngày kèm giai đoạn và thanh toán."""
from datetime import date, datetime, time, timedelta

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.models import Booking
from .models import Invoice, Visit
from .permissions import CanReception

# Giai đoạn hiển thị: scheduled (chưa đến) → waiting (đã check-in, chờ) → progress (đang làm) → done
STAGE_LABEL = {'scheduled': 'Chưa đến', 'waiting': 'Đã check-in · đang chờ', 'progress': 'Đang thực hiện',
               'done': 'Hoàn tất', 'cancelled': 'Đã hủy', 'no_show': 'Không đến'}


def stage_of(b, visit_status):
    if b.status == Booking.CANCELLED:
        return 'cancelled'
    if b.status == Booking.NO_SHOW:
        return 'no_show'
    if b.status == Booking.COMPLETED or visit_status == Visit.COMPLETED:
        return 'done'
    if b.status == Booking.IN_PROGRESS or visit_status == Visit.IN_CONSULT:
        return 'progress'
    if b.status == Booking.CHECKED_IN or visit_status == Visit.WAITING:
        return 'waiting'
    return 'scheduled'


def _day(p):
    try:
        return date.fromisoformat(p.get('date') or '')
    except ValueError:
        return timezone.localdate()


@api_view(['GET'])
@permission_classes([CanReception])
def day_board(request):
    p = request.query_params
    day = _day(p)
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(day, time.min), tz)
    qs = (Booking.objects.filter(appointment__gte=start, appointment__lt=start + timedelta(days=1))
          .select_related('staff', 'patient', 'user', 'visit').prefetch_related('items__service').order_by('appointment', 'id'))
    if p.get('staff'):
        qs = qs.filter(staff_id=p['staff'])
    bookings = list(qs)
    # Hóa đơn gắn với lượt khám của từng lịch hẹn
    invs = {}
    for inv in Invoice.objects.filter(visit__booking__in=bookings).exclude(status=Invoice.VOID).select_related('visit'):
        invs.setdefault(inv.visit.booking_id, []).append(inv)
    rows, counts = [], {'scheduled': 0, 'waiting': 0, 'progress': 0, 'done': 0, 'cancelled': 0, 'no_show': 0}
    for b in bookings:
        v = getattr(b, 'visit', None)
        stage = stage_of(b, v.status if v else None)
        counts[stage] += 1
        its = invs.get(b.id, [])
        total, paid = sum(i.total for i in its), sum(i.paid for i in its)
        pay = 'none' if not its else 'paid' if paid >= total and total > 0 else 'partial' if paid > 0 else 'unpaid'
        local = timezone.localtime(b.appointment)
        rows.append({
            'id': b.id, 'time': local.strftime('%H:%M'), 'end': timezone.localtime(b.end_time).strftime('%H:%M'),
            'appointment': b.appointment, 'duration': b.duration_minutes,
            'patient': b.patient_id, 'patient_code': b.patient.code if b.patient else '',
            'client_name': b.patient.full_name if b.patient else b.customer_name,
            'phone': b.customer_phone, 'services': [i.service.name for i in b.items.all()],
            'staff': b.staff_id, 'staff_name': b.staff.name if b.staff else '',
            'stage': stage, 'stage_label': STAGE_LABEL[stage], 'status': b.status, 'status_label': b.get_status_display(),
            'running_late': b.running_late, 'visit': v.pk if v else None,
            'pay': pay, 'invoice': its[0].pk if its else None, 'total': total or b.total, 'paid': paid,
        })
    return Response({'date': day.isoformat(), 'today': timezone.localdate().isoformat(), 'counts': counts, 'results': rows})
