"""API số liệu cho màn hình Thu ngân & Tài chính (tổng quan, hóa đơn, thanh toán, lịch sử bán, lịch hẹn, công nợ)."""
from datetime import date, timedelta

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.models import Booking
from .models import Invoice, InvoiceItem, Patient, Payment
from .serializers import uname
from .views_v2 import BILLING
from .views_v3 import pc

METHOD_LABEL = dict(Payment.METHODS)


def _rng(p):
    """?from=YYYY-MM-DD&to=YYYY-MM-DD (mặc định 30 ngày gần nhất, tối đa 366 ngày)."""
    try:
        d_to = date.fromisoformat(p.get('to') or '')
    except ValueError:
        d_to = timezone.localdate()
    try:
        d_from = date.fromisoformat(p.get('from') or '')
    except ValueError:
        d_from = d_to - timedelta(days=29)
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    if (d_to - d_from).days > 365:
        d_from = d_to - timedelta(days=365)
    return d_from, d_to


def _page(p, rows, total=None):
    try:
        size = min(max(int(p.get('page_size', 50)), 1), 200)
        page = max(int(p.get('page', 1)), 1)
    except ValueError:
        size, page = 50, 1
    count = total if total is not None else (rows.count() if hasattr(rows, 'count') and not isinstance(rows, list) else len(rows))
    return rows[(page - 1) * size: page * size], {'count': count, 'page': page, 'page_size': size}


def _days(d_from, d_to):
    return [d_from + timedelta(days=i) for i in range((d_to - d_from).days + 1)]


def _series(qs, field, days, agg):
    got = {r['d']: r['v'] or 0 for r in qs.annotate(d=TruncDate(field)).values('d').annotate(v=agg)}
    return [got.get(d, 0) for d in days]


def _payments(d_from, d_to):
    return Payment.objects.filter(paid_at__date__gte=d_from, paid_at__date__lte=d_to).exclude(invoice__status=Invoice.VOID)


@api_view(['GET'])
@permission_classes([pc(BILLING)])
def overview(request):
    d_from, d_to = _rng(request.query_params)
    days = _days(d_from, d_to)
    n = len(days)
    p_to, p_from = d_from - timedelta(days=1), d_from - timedelta(days=n)
    pdays = _days(p_from, p_to)
    cur, prev = _payments(d_from, d_to), _payments(p_from, p_to)
    gross = cur.aggregate(s=Sum('amount'))['s'] or 0
    gross_prev = prev.aggregate(s=Sum('amount'))['s'] or 0
    cnt, cnt_prev = cur.count(), prev.count()
    new_cur = Patient.objects.filter(created_at__date__gte=d_from, created_at__date__lte=d_to)
    new_prev = Patient.objects.filter(created_at__date__gte=p_from, created_at__date__lte=p_to)
    pay_series = _series(cur, 'paid_at', days, Sum('amount'))
    pay_prev = _series(prev, 'paid_at', pdays, Sum('amount'))
    cnt_series = _series(cur, 'paid_at', days, Count('id'))
    cnt_prev_series = _series(prev, 'paid_at', pdays, Count('id'))
    methods = [{'method': r['method'], 'label': METHOD_LABEL.get(r['method'], r['method']), 'amount': r['v']}
               for r in cur.values('method').annotate(v=Sum('amount')).order_by('-v')]
    open_inv = Invoice.objects.filter(status__in=[Invoice.UNPAID, Invoice.PARTIAL])
    unpaid = sum(i.total - i.paid for i in open_inv)
    billed = Invoice.objects.filter(created_at__date__gte=d_from, created_at__date__lte=d_to).exclude(status=Invoice.VOID)
    top = (InvoiceItem.objects.filter(invoice__in=billed).values('name', 'kind')
           .annotate(qty=Sum('quantity'), amount=Sum(F('quantity') * F('unit_price'))).order_by('-amount')[:6])
    today = timezone.localdate()
    due_today = Invoice.objects.filter(status__in=[Invoice.UNPAID, Invoice.PARTIAL], created_at__date=today).count()
    return Response({
        'range': [d_from, d_to], 'previous': [p_from, p_to],
        'kpis': {'gross': gross, 'gross_prev': gross_prev, 'net': gross, 'net_prev': gross_prev,
                 'payments': cnt, 'payments_prev': cnt_prev, 'new_clients': new_cur.count(), 'new_clients_prev': new_prev.count(),
                 'avg_sale': round(gross / cnt) if cnt else 0, 'avg_sale_prev': round(gross_prev / cnt_prev) if cnt_prev else 0,
                 'unpaid_balance': unpaid, 'unpaid_count': open_inv.count(), 'invoices': billed.count(),
                 'billed_total': billed.aggregate(s=Sum('total'))['s'] or 0, 'due_today': due_today},
        'series': {'dates': days, 'gross': pay_series, 'gross_prev': pay_prev,
                   'payments': cnt_series, 'payments_prev': cnt_prev_series,
                   'new_clients': _series(new_cur, 'created_at', days, Count('id')),
                   'new_clients_prev': _series(new_prev, 'created_at', pdays, Count('id')),
                   'avg': [round(a / b) if b else 0 for a, b in zip(pay_series, cnt_series)],
                   'avg_prev': [round(a / b) if b else 0 for a, b in zip(pay_prev, cnt_prev_series)]},
        'methods': methods,
        'summary': {'received': gross, 'refunds': 0, 'fees': 0, 'chargebacks': 0, 'net': gross},
        'top_items': list(top),
    })


@api_view(['GET'])
@permission_classes([pc(BILLING)])
def invoices(request):
    p = request.query_params
    d_from, d_to = _rng(p) if p.get('from') or p.get('to') else (None, None)
    qs = Invoice.objects.select_related('patient', 'created_by').prefetch_related('items')
    if d_from:
        qs = qs.filter(created_at__date__gte=d_from, created_at__date__lte=d_to)
    if p.get('status'):
        qs = qs.filter(status__in=p['status'].split(','))
    if p.get('q'):
        qs = qs.filter(Q(code__icontains=p['q']) | Q(patient__full_name__icontains=p['q']) | Q(patient__phone__icontains=p['q']) | Q(buyer_name__icontains=p['q']))
    qs = qs.order_by('-created_at', '-id')
    stats = qs.exclude(status=Invoice.VOID).aggregate(total=Sum('total'), paid=Sum('paid'))
    page, meta = _page(p, qs)
    rows = [{'id': i.id, 'code': i.code, 'created_at': i.created_at, 'patient': i.patient_id, 'patient_name': i.patient.full_name,
             'patient_code': i.patient.code, 'debtor': i.buyer_name or i.patient.full_name, 'subtotal': i.subtotal, 'discount': i.discount,
             'total': i.total, 'paid': i.paid, 'balance': i.balance, 'status': i.status, 'status_label': i.get_status_display(),
             'items': ', '.join(x.name for x in list(i.items.all())[:3]) + (f' +{i.items.count() - 3}' if i.items.count() > 3 else ''),
             'created_by_name': uname(i.created_by), 'einvoice_status': i.einvoice_status} for i in page]
    return Response({**meta, 'results': rows, 'totals': {'total': stats['total'] or 0, 'paid': stats['paid'] or 0,
                                                       'outstanding': (stats['total'] or 0) - (stats['paid'] or 0)}})


@api_view(['GET'])
@permission_classes([pc(BILLING)])
def payments(request):
    p = request.query_params
    d_from, d_to = _rng(p)
    qs = _payments(d_from, d_to).select_related('invoice__patient', 'received_by')
    if p.get('method'):
        qs = qs.filter(method__in=p['method'].split(','))
    if p.get('q'):
        qs = qs.filter(Q(invoice__code__icontains=p['q']) | Q(invoice__patient__full_name__icontains=p['q']) | Q(reference__icontains=p['q']))
    qs = qs.order_by('-paid_at', '-id')
    total = qs.aggregate(s=Sum('amount'))['s'] or 0
    page, meta = _page(p, qs)
    rows = [{'id': x.id, 'code': f'TT{x.id:06d}', 'invoice': x.invoice_id, 'invoice_code': x.invoice.code, 'paid_at': x.paid_at,
             'patient': x.invoice.patient_id, 'patient_name': x.invoice.patient.full_name, 'amount': x.amount, 'method': x.method,
             'method_label': x.get_method_display(), 'reference': x.reference, 'received_by_name': uname(x.received_by)} for x in page]
    return Response({**meta, 'results': rows, 'totals': {'amount': total}})


@api_view(['GET'])
@permission_classes([pc(BILLING)])
def lines(request):
    p = request.query_params
    d_from, d_to = _rng(p)
    qs = (InvoiceItem.objects.filter(invoice__created_at__date__gte=d_from, invoice__created_at__date__lte=d_to)
          .exclude(invoice__status=Invoice.VOID).select_related('invoice__patient', 'invoice__created_by'))
    if p.get('kind'):
        qs = qs.filter(kind__in=p['kind'].split(','))
    if p.get('q'):
        qs = qs.filter(Q(name__icontains=p['q']) | Q(invoice__code__icontains=p['q']) | Q(invoice__patient__full_name__icontains=p['q']))
    qs = qs.order_by('-invoice__created_at', '-id')
    total = qs.aggregate(s=Sum(F('quantity') * F('unit_price')))['s'] or 0
    page, meta = _page(p, qs)
    rows = [{'id': x.id, 'created_at': x.invoice.created_at, 'name': x.name, 'kind': x.kind, 'kind_label': x.get_kind_display(),
             'invoice': x.invoice_id, 'invoice_code': x.invoice.code, 'patient': x.invoice.patient_id, 'patient_name': x.invoice.patient.full_name,
             'quantity': x.quantity, 'unit_price': x.unit_price, 'amount': x.amount, 'created_by_name': uname(x.invoice.created_by)} for x in page]
    return Response({**meta, 'results': rows, 'totals': {'amount': total}})


@api_view(['GET'])
@permission_classes([pc(BILLING)])
def appointments(request):
    p = request.query_params
    d_from, d_to = _rng(p)
    qs = (Booking.objects.filter(appointment__date__gte=d_from, appointment__date__lte=d_to)
          .select_related('staff', 'patient', 'user').prefetch_related('items__service'))
    if p.get('status'):
        qs = qs.filter(status__in=p['status'].split(','))
    if p.get('q'):
        qs = qs.filter(Q(guest_name__icontains=p['q']) | Q(patient__full_name__icontains=p['q']) | Q(user__first_name__icontains=p['q']) | Q(confirm_code__icontains=p['q']))
    qs = qs.order_by('-appointment', '-id')
    page, meta = _page(p, qs)
    rows = [{'id': b.id, 'code': b.confirm_code, 'created_at': b.created_at, 'appointment': b.appointment, 'patient': b.patient_id,
             'client_name': b.patient.full_name if b.patient else b.customer_name, 'duration': b.duration_minutes,
             'services': ', '.join(i.service.name for i in b.items.all()), 'staff_name': b.staff.name if b.staff else '',
             'type': b.get_appointment_type_display(), 'status': b.status, 'status_label': b.get_status_display(), 'total': b.total} for b in page]
    return Response({**meta, 'results': rows})


@api_view(['GET'])
@permission_classes([pc(BILLING)])
def receivables(request):
    """Công nợ: hóa đơn chưa thu đủ, kèm số ngày quá hạn (tính từ ngày lập, hạn thanh toán mặc định 7 ngày)."""
    p = request.query_params
    qs = Invoice.objects.filter(status__in=[Invoice.UNPAID, Invoice.PARTIAL]).select_related('patient')
    if p.get('q'):
        qs = qs.filter(Q(code__icontains=p['q']) | Q(patient__full_name__icontains=p['q']) | Q(patient__phone__icontains=p['q']))
    qs = qs.order_by('created_at')
    today = timezone.localdate()
    rows = []
    for i in qs:
        due = timezone.localtime(i.created_at).date() + timedelta(days=7)
        rows.append({'id': i.id, 'code': i.code, 'patient': i.patient_id, 'patient_name': i.patient.full_name, 'patient_phone': i.patient.phone,
                     'total': i.total, 'paid': i.paid, 'balance': i.balance, 'status': i.status, 'status_label': i.get_status_display(),
                     'due_date': due, 'days_left': (due - today).days, 'created_at': i.created_at})
    page, meta = _page(p, rows, total=len(rows))
    return Response({**meta, 'results': page, 'totals': {'balance': sum(r['balance'] for r in rows)}})
