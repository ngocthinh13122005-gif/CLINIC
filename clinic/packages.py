"""Gói liệu trình: tạo buổi, tạo gói khi bán hàng, gia hạn."""
import calendar
from datetime import date, timedelta

from django.utils import timezone

from .models import InvoiceItem, PackageTemplate, TreatmentPlan, TreatmentSession


def add_months(d, n):
    """Cộng n tháng, giữ ngày trong tháng (31/01 + 1 tháng = 28/02)."""
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def make_sessions(plan):
    existing = {s.number: s for s in plan.sessions.all()}
    for n in range(1, plan.total_sessions + 1):
        planned = plan.start_date + timedelta(days=plan.interval_days * (n - 1)) if plan.start_date else None
        if n in existing:
            if existing[n].status == TreatmentSession.PENDING and planned:
                existing[n].planned_date = planned
                existing[n].save(update_fields=['planned_date'])
        else:
            TreatmentSession.objects.create(plan=plan, number=n, planned_date=planned)
    plan.sessions.filter(number__gt=plan.total_sessions, status=TreatmentSession.PENDING).delete()


def display_status(plan, today=None):
    """Trạng thái hiển thị: gói đang hiệu lực nhưng quá hạn → 'expired'."""
    today = today or timezone.localdate()
    if plan.status in (TreatmentPlan.ACTIVE, TreatmentPlan.DRAFT) and plan.expires_at and plan.expires_at < today:
        return TreatmentPlan.EXPIRED
    return plan.status


def create_plans_for_invoice(invoice):
    """Mỗi dòng 'Gói liệu trình' của hóa đơn → tạo (số lượng) gói đã xác nhận, hiệu lực từ hôm nay."""
    today = timezone.localdate()
    out = []
    for it in invoice.items.filter(kind=InvoiceItem.PACKAGE).select_related('package_template'):
        tpl = it.package_template
        if not tpl:
            continue
        for _ in range(it.quantity):
            plan = TreatmentPlan.objects.create(
                patient=invoice.patient, service=tpl.service, template=tpl, invoice=invoice, title=tpl.name[:160],
                total_sessions=tpl.total_sessions, interval_days=tpl.interval_days, price=it.unit_price,
                status=TreatmentPlan.ACTIVE, start_date=today,
                expires_at=add_months(today, tpl.validity_months) if tpl.validity_months else None)
            make_sessions(plan)
            out.append(plan)
    return out
