"""Cổng bệnh nhân: thanh toán và phiếu cam kết của chính bệnh nhân đăng nhập (chỉ đọc)."""
from rest_framework import permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .audit import audit
from .models import ConsentForm, Invoice, Patient


def _patient_or_response(request):
    if request.user.role != 'customer':
        return None, Response({'detail': 'Cổng bệnh nhân chỉ dành cho bệnh nhân.'}, status=403)
    return Patient.objects.filter(user=request.user).first(), None


def _no_store(response):
    response['Cache-Control'] = 'private, no-store'
    response['Vary'] = 'Authorization, Cookie'
    return response


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def portal_billing(request):
    patient, denied = _patient_or_response(request)
    if denied is not None:
        return _no_store(denied)
    empty = {'patient_linked': False, 'outstanding': 0, 'due_count': 0, 'due': [], 'paid': [], 'transactions': []}
    if not patient:
        return _no_store(Response(empty))
    audit(request.user, 'patient.portal.billing', patient.code)
    invoices = list(Invoice.objects.filter(patient=patient).exclude(status=Invoice.VOID)
                    .prefetch_related('items', 'payments').order_by('-created_at', '-id'))

    def row(inv):
        return {
            'id': inv.pk, 'code': inv.code, 'date': inv.created_at, 'due_date': inv.due_date,
            'status': inv.status, 'status_label': inv.get_status_display(),
            'total': inv.total, 'discount': inv.discount, 'paid': inv.paid, 'balance': inv.balance,
            'items': [{'name': i.name, 'quantity': i.quantity, 'unit_price': i.unit_price} for i in inv.items.all()],
            'payments': [{'date': p.paid_at, 'method': p.get_method_display(), 'amount': p.amount} for p in inv.payments.all()],
        }

    rows = [row(i) for i in invoices]
    due = [r for r in rows if r['balance'] > 0]
    paid = [r for r in rows if r['balance'] == 0]
    transactions = sorted(
        ({'invoice_id': r['id'], 'invoice_code': r['code'], 'date': p['date'], 'method': p['method'], 'amount': p['amount']}
         for r in rows for p in r['payments']),
        key=lambda t: t['date'], reverse=True)
    return _no_store(Response({
        'patient_linked': True, 'outstanding': sum(r['balance'] for r in due), 'due_count': len(due),
        'due': due, 'paid': paid, 'transactions': transactions,
    }))


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def portal_forms(request):
    patient, denied = _patient_or_response(request)
    if denied is not None:
        return _no_store(denied)
    if not patient:
        return _no_store(Response({'patient_linked': False, 'forms': []}))
    audit(request.user, 'patient.portal.forms', patient.code)
    forms = ConsentForm.objects.filter(patient=patient).exclude(status=ConsentForm.REVOKED).order_by('-created_at')
    return _no_store(Response({'patient_linked': True, 'forms': [{
        'id': f.pk, 'code': f.code, 'title': f.title, 'kind': f.get_kind_display(), 'body': f.body,
        'status': f.status, 'status_label': f.get_status_display(),
        'created_at': f.created_at, 'signed_at': f.signed_at, 'valid_until': f.valid_until,
    } for f in forms]}))
