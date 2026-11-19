"""Billing helpers for treatment plans."""

from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers

from .audit import audit
from .models import CashierShift, Invoice, InvoiceItem, Payment, Refund, TreatmentPlan, TreatmentSession

MODES = ('full', 'partial', 'session')


def _fail(message):
    raise serializers.ValidationError({'detail': message})


def session_amounts(plan, total=None):
    """Split the plan price evenly, assigning any remainder to the last session."""
    target = plan.price if total is None else max(total, 0)
    count = max(plan.total_sessions, 1)
    base, remainder = divmod(target, count)
    return [base + (remainder if number == count else 0) for number in range(1, count + 1)]


def plan_invoice(plan):
    """Return this plan's directly linked, non-void invoice, if one exists."""
    invoices = [invoice for invoice in plan.package_invoices.all() if invoice.status != Invoice.VOID]
    return max(invoices, key=lambda invoice: invoice.pk) if invoices else None


def _allocate(amounts, paid):
    allocated, remaining = [], paid
    for amount in amounts:
        collected = min(remaining, amount)
        remaining -= collected
        allocated.append(collected)
    return allocated


def _refund_commitments(invoice, exclude_refund_id=None):
    refunds = invoice.refunds.filter(status__in=(Refund.PENDING, Refund.APPROVED))
    if exclude_refund_id is not None:
        refunds = refunds.exclude(pk=exclude_refund_id)
    return refunds.aggregate(total=Sum('amount'))['total'] or 0


def refund_capacity(invoice, exclude_refund_id=None):
    """Return the amount that can still be refunded without refunding used treatment."""
    committed = _refund_commitments(invoice, exclude_refund_id)
    plan = invoice.treatment_plan
    if plan:
        if plan.status != TreatmentPlan.CANCELLED:
            return 0
        return max(invoice.paid - invoice.total - committed, 0)
    return max(invoice.paid - committed, 0)


def payment_summary(plan):
    invoice = plan_invoice(plan)
    if invoice and plan.status == TreatmentPlan.CANCELLED:
        amounts_by_session = {
            item.treatment_session.number: item.amount
            for item in invoice.items.select_related('treatment_session')
            if item.treatment_session_id
        }
        amounts = [amounts_by_session.get(number, 0) for number in range(1, plan.total_sessions + 1)]
    else:
        amounts = session_amounts(plan, invoice.total if invoice else None)

    paid = invoice.paid if invoice else 0
    total = invoice.total if invoice else (0 if plan.status == TreatmentPlan.CANCELLED else plan.price)
    sessions_by_number = {session.number: session for session in plan.sessions.all()}
    allocated = _allocate(amounts, paid)
    sessions, used, due_through = [], 0, 0
    pending_seen = False

    for index, amount in enumerate(amounts):
        number = index + 1
        session = sessions_by_number.get(number)
        status = session.status if session else TreatmentSession.PENDING
        if status == TreatmentSession.DONE:
            used += amount
            due_through += amount
        elif status == TreatmentSession.PENDING and not pending_seen:
            pending_seen = True
            if plan.status == TreatmentPlan.ACTIVE:
                due_through += amount

        collected = allocated[index]
        sessions.append({
            'number': number,
            'amount': amount,
            'paid': collected,
            'state': 'paid' if collected >= amount and amount > 0 else (
                'partial' if collected > 0 else 'unpaid'
            ),
        })

    if plan.price <= 0 and not invoice:
        state = 'free'
    elif total <= 0 and paid <= 0:
        state = 'free' if plan.status == TreatmentPlan.CANCELLED else 'unpaid'
    elif paid <= 0:
        state = 'unpaid'
    elif paid < total:
        state = 'partial'
    else:
        state = 'paid'

    labels = {
        'free': 'Không phát sinh thu tiền',
        'unpaid': 'Chưa thanh toán',
        'partial': 'Thanh toán một phần',
        'paid': 'Đã thanh toán',
    }
    balance = max(total - paid, 0)
    refundable = refund_capacity(invoice) if invoice and plan.status == TreatmentPlan.CANCELLED else 0
    return {
        'state': state,
        'label': labels[state],
        'invoice': invoice.pk if invoice else None,
        'invoice_code': invoice.code if invoice else '',
        'total': total,
        'paid': paid,
        'balance': balance,
        'due_now': min(max(due_through - paid, 0), balance),
        'used_amount': used,
        'refundable': refundable,
        'per_session': session_amounts(plan)[0],
        'sessions': sessions,
    }


def _default_due_date():
    from core.operational_settings import clinic_setting

    try:
        days = int(clinic_setting('billing.default_due_days'))
    except (KeyError, TypeError, ValueError):
        days = 0
    terms = {
        0: Invoice.TERM_IMMEDIATE,
        7: Invoice.TERM_7,
        15: Invoice.TERM_15,
        30: Invoice.TERM_30,
    }
    return timezone.localdate() + timedelta(days=days), terms.get(days, Invoice.TERM_IMMEDIATE)


def _build_items(invoice, plan, sessions_only=None, amounts=None):
    amounts = session_amounts(plan) if amounts is None else amounts
    sessions = plan.sessions.order_by('number')
    if sessions_only is not None:
        sessions = sessions.filter(pk__in=sessions_only)
    for session in sessions:
        if session.number <= len(amounts):
            InvoiceItem.objects.create(
                invoice=invoice,
                kind=InvoiceItem.SERVICE,
                service=plan.service,
                treatment_session=session,
                quantity=1,
                name=f'{plan.title} – Buổi {session.number}'[:200],
                unit_price=amounts[session.number - 1],
            )


def _invoice_for_update(plan):
    return Invoice.objects.select_for_update().filter(
        treatment_plan=plan,
    ).exclude(status=Invoice.VOID).order_by('-pk').first()


def ensure_invoice(plan, user):
    invoice = _invoice_for_update(plan)
    if invoice:
        return invoice

    due_date, payment_term = _default_due_date()
    invoice = Invoice.objects.create(
        patient=plan.patient,
        treatment_plan=plan,
        created_by=user,
        payment_term=payment_term,
        due_date=due_date,
        note=f'Liệu trình: {plan.title}'[:255],
    )
    _build_items(invoice, plan)
    invoice.recalc()
    audit(user, 'plan.invoice', f'#{plan.pk} {invoice.code} {invoice.total}')
    return invoice


def resync_invoice(plan, user):
    """Rebuild an unpaid plan invoice after its price or session count changes."""
    invoice = _invoice_for_update(plan)
    if not invoice:
        return
    if invoice.payments.exists():
        _fail('Liệu trình đã thu tiền, không đổi được giá hoặc số buổi.')
    invoice.items.all().delete()
    invoice.discount = 0
    _build_items(invoice, plan)
    invoice.recalc()
    audit(user, 'plan.invoice_resync', f'#{plan.pk} {invoice.code} {invoice.total}')


def has_paid_invoice(plan):
    return Payment.objects.filter(
        invoice__treatment_plan=plan,
    ).exclude(invoice__status=Invoice.VOID).exists()


def collect(plan, user, mode, amount=None, count=1, method=Payment.CASH, reference='', note=''):
    if plan.status == TreatmentPlan.CANCELLED:
        _fail('Liệu trình đã hủy; công nợ và hoàn tiền xử lý trên hóa đơn.')
    if plan.price <= 0:
        _fail('Liệu trình chưa có giá. Nhờ bác sĩ cập nhật giá trước khi thu tiền.')
    if mode not in MODES:
        _fail('Chọn hình thức thu: cả gói, một phần hoặc theo buổi.')

    invoice = ensure_invoice(plan, user)
    balance = invoice.balance
    if balance <= 0:
        _fail('Liệu trình đã thanh toán đủ.')

    if mode == 'full':
        amount = balance
    elif mode == 'session':
        try:
            count = int(count)
        except (TypeError, ValueError):
            _fail('Số buổi thu không hợp lệ.')
        amounts = session_amounts(plan, invoice.total)
        unpaid = [
            session_amount - collected
            for session_amount, collected in zip(amounts, _allocate(amounts, invoice.paid))
            if session_amount - collected > 0
        ]
        if not 1 <= count <= len(unpaid):
            _fail(f'Chỉ còn {len(unpaid)} buổi chưa thanh toán.')
        amount = min(sum(unpaid[:count]), balance)
    else:
        try:
            amount = int(amount)
        except (TypeError, ValueError):
            _fail('Số tiền không hợp lệ.')
        if amount <= 0:
            _fail('Số tiền phải lớn hơn 0.')
        if amount > balance:
            _fail(f'Số tiền vượt quá số còn nợ ({balance:,}đ).'.replace(',', '.'))

    if method not in dict(Payment.METHODS):
        method = Payment.CASH
    shift = CashierShift.objects.filter(cashier=user, status=CashierShift.OPEN).first()
    if method == Payment.CASH and not shift:
        _fail('Cần mở ca thu ngân trước khi nhận tiền mặt.')

    label = {
        'full': 'Thu cả gói',
        'partial': 'Thu một phần / đặt cọc',
        'session': f'Thu theo buổi ({count} buổi)',
    }[mode]
    Payment.objects.create(
        invoice=invoice,
        amount=amount,
        method=method,
        reference=(reference or '')[:60],
        note=(note or label)[:255],
        received_by=user,
        shift=shift,
    )
    invoice.recalc()
    audit(user, 'plan.collect', f'#{plan.pk} {invoice.code} {mode} {amount}')
    return invoice


def settle_cancellation(plan, user):
    """Keep only performed-session value on a cancelled plan's linked invoice."""
    completed_sessions = list(plan.sessions.filter(status=TreatmentSession.DONE))
    invoice = _invoice_for_update(plan)
    if not invoice:
        if not completed_sessions:
            return None
        due_date, payment_term = _default_due_date()
        invoice = Invoice.objects.create(
            patient=plan.patient,
            treatment_plan=plan,
            created_by=user,
            payment_term=payment_term,
            due_date=due_date,
            note=f'Liệu trình (đã hủy): {plan.title}'[:255],
        )
        _build_items(
            invoice,
            plan,
            sessions_only={session.pk for session in completed_sessions},
            amounts=session_amounts(plan),
        )
        invoice.recalc()
        return invoice

    amounts = session_amounts(plan, invoice.total)
    used_total = sum(
        amounts[session.number - 1]
        for session in completed_sessions
        if 1 <= session.number <= len(amounts)
    )
    commitments = _refund_commitments(invoice)
    if commitments > max(invoice.paid - used_total, 0):
        _fail('Có yêu cầu hoàn tiền đang chờ xử lý vượt phần dư sau khi đối chiếu buổi đã dùng.')

    if not completed_sessions and not invoice.payments.exists() and not invoice.refunds.exists():
        invoice.status = Invoice.VOID
        invoice.void_reason = 'Hủy liệu trình trước khi thực hiện buổi nào'
        invoice.save(update_fields=['status', 'void_reason'])
    else:
        invoice.items.all().delete()
        invoice.discount = 0
        _build_items(
            invoice,
            plan,
            sessions_only={session.pk for session in completed_sessions},
            amounts=amounts,
        )
        invoice.recalc()

    audit(user, 'plan.cancel_settle', f'#{plan.pk} {invoice.code} dùng {len(completed_sessions)} buổi')
    return invoice
