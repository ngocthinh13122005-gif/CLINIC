import re
from datetime import date, timedelta

from django.db import transaction
from django.db.models import F, Q, Sum
from django.utils import timezone
from rest_framework import mixins, permissions, serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from core.models import Service
from core.role_permissions import view_action_allowed
from .audit import audit
from .models import (CashierShift, DebtFollowUp, Invoice, InvoiceItem, Medicine, Patient, Payment, Prescription,
                     PackageTemplate, PrescriptionItem, Refund, StockMovement, TreatmentPlan, Visit)
from .packages import create_plans_for_invoice
from .permissions import CanReadClinical, CanWriteClinical, IsClinicStaff, role_of
from .serializers import uname
from .serializers_v2 import (CashierShiftSerializer, DebtFollowUpSerializer, InvoiceSerializer, MedicineSerializer,
                             PaymentSerializer, PrescriptionSerializer, RefundSerializer, StockMovementSerializer)
from .views import deny

BILLING = {'consultant', 'manager'}          # lập hóa đơn, thu tiền
BILLING_READ = BILLING | {'doctor'}
MANAGER = {'manager'}


class RolePerm(permissions.BasePermission):
    def __init__(self, roles):
        self.roles = roles

    def has_permission(self, request, view):
        return role_of(request) in self.roles and view_action_allowed(request, view)


def perm(roles):
    return RolePerm(set(roles))


# --------------------------------------------------------------------------- kho thuốc
def move_stock(med, delta, kind, user, reference='', note='', **lot_info):
    """Đổi tồn kho an toàn: nhập → tạo lô, xuất → FEFO, điều chỉnh tay → tồn không theo lô."""
    from . import inventory
    if delta > 0 and kind == StockMovement.IN:
        med, _lot = inventory.receive_lot(med, delta, user, reference=reference, note=note, **lot_info)
        return med
    if delta < 0:
        return inventory.consume(med, -delta, kind, user, reference, note)
    if kind == StockMovement.OUT:
        return inventory.restore(med, delta, kind, user, reference, note)
    return inventory.adjust_unlotted(med, delta, user, reference, note)


class MedicineViewSet(viewsets.ModelViewSet):
    serializer_class = MedicineSerializer

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [IsClinicStaff()]
        if self.action == 'movements':
            return [perm(MANAGER)]
        return [perm(MANAGER)]

    def get_queryset(self):
        qs = Medicine.objects.all()
        p = self.request.query_params
        if p.get('q'):
            qs = qs.filter(Q(name__icontains=p['q']) | Q(active_ingredient__icontains=p['q']) | Q(code__icontains=p['q']))
        if p.get('low') == '1':
            qs = qs.filter(stock__lte=F('min_stock'))
        if p.get('active', '1') == '1' and self.action == 'list':
            qs = qs.filter(is_active=True)
        return qs

    def destroy(self, request, *args, **kwargs):
        m = self.get_object()
        m.is_active = False          # không xóa cứng: còn nằm trong đơn thuốc / hóa đơn cũ
        m.save(update_fields=['is_active'])
        audit(request.user, 'medicine.disable', m.code)
        return Response(status=204)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def receive(self, request, pk=None):
        """Nhập kho."""
        m = self.get_object()
        try:
            qty = int(request.data.get('quantity'))
        except (TypeError, ValueError):
            return deny('Số lượng không hợp lệ.', 400)
        if qty <= 0:
            return deny('Số lượng nhập phải lớn hơn 0.', 400)
        cost = request.data.get('cost')
        if cost not in (None, ''):
            m.cost = max(int(cost), 0)
            m.save(update_fields=['cost'])
        m = move_stock(m, qty, StockMovement.IN, request.user, request.data.get('reference', ''), request.data.get('note', ''),
                       lot_no=request.data.get('lot_no', ''), expiry=request.data.get('expiry') or None,
                       cost=request.data.get('cost') if request.data.get('cost') not in (None, '') else None)
        audit(request.user, 'stock.in', f'{m.code} +{qty}')
        return Response(self.get_serializer(m).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def adjust(self, request, pk=None):
        """Kiểm kê: đặt lại tồn kho theo số đếm thực tế."""
        m = self.get_object()
        try:
            actual = int(request.data.get('actual'))
        except (TypeError, ValueError):
            return deny('Số tồn thực tế không hợp lệ.', 400)
        if actual < 0:
            return deny('Số tồn không được âm.', 400)
        delta = actual - Medicine.objects.get(pk=m.pk).stock
        if delta == 0:
            return Response(self.get_serializer(m).data)
        m = move_stock(m, delta, StockMovement.ADJUST, request.user, 'Kiểm kê', request.data.get('note', ''))
        audit(request.user, 'stock.adjust', f'{m.code} {delta:+d}')
        return Response(self.get_serializer(m).data)

    @action(detail=False, methods=['get'])
    def movements(self, request):
        qs = StockMovement.objects.select_related('medicine', 'by')
        if request.query_params.get('medicine'):
            qs = qs.filter(medicine_id=request.query_params['medicine'])
        return Response(StockMovementSerializer(qs[:200], many=True).data)


# --------------------------------------------------------------------------- đơn thuốc
MAX_RX_DAYS = 30


def age_in_months(dob):
    if not dob:
        return None
    t = timezone.localdate()
    return (t.year - dob.year) * 12 + (t.month - dob.month) - (1 if t.day < dob.day else 0)


class PrescriptionViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = PrescriptionSerializer

    def get_permissions(self):
        if self.action in {'national', 'mark_sent'}:
            return [perm(MANAGER)]
        return [CanWriteClinical()] if self.action in {'save', 'cancel'} else [CanReadClinical()]

    def get_queryset(self):
        qs = Prescription.objects.select_related('patient', 'doctor', 'visit').prefetch_related('items__medicine')
        p = self.request.query_params
        if p.get('visit'):
            qs = qs.filter(visit_id=p['visit'])
        if p.get('patient'):
            qs = qs.filter(patient_id=p['patient'])
        return qs

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def save(self, request):
        """Lưu (tạo/ghi đè) đơn thuốc của một lượt khám. body: {visit, diagnosis, advice, issue, items:[{medicine,quantity,dosage,usage,days}]}"""
        d = request.data
        visit = Visit.objects.select_for_update().filter(pk=d.get('visit')).select_related('patient').first()
        if not visit:
            return deny('Không tìm thấy lượt khám.', 404)
        if visit.doctor_id and visit.doctor_id != request.user.id:
            return deny('Lượt khám này do bác sĩ khác phụ trách.', 403)
        if visit.status != Visit.IN_CONSULT:
            return deny('Chỉ kê đơn khi lượt khám đang diễn ra.', 400)
        rows = d.get('items') or []
        if not isinstance(rows, list):
            return deny('Danh sách thuốc không hợp lệ.', 400)
        rx, created = Prescription.objects.get_or_create(visit=visit, defaults={'patient': visit.patient, 'doctor': request.user})
        if rx.status == Prescription.CANCELLED:
            rx.status = Prescription.DRAFT
        rx.doctor = request.user
        rx.diagnosis = (d.get('diagnosis') or '')[:255]
        rx.advice = (d.get('advice') or '')[:2000]
        rx.items.all().delete()
        seen = set()
        for r in rows:
            med = Medicine.objects.filter(pk=r.get('medicine'), is_active=True).first()
            if not med:
                raise serializers.ValidationError({'detail': 'Có thuốc không tồn tại hoặc đã ngừng kinh doanh.'})
            if med.pk in seen:
                raise serializers.ValidationError({'detail': f'Thuốc "{med.name}" bị kê hai lần.'})
            seen.add(med.pk)
            try:
                qty = int(r.get('quantity') or 1)
                days = int(r.get('days') or 0)
            except (TypeError, ValueError):
                raise serializers.ValidationError({'detail': 'Số lượng / số ngày không hợp lệ.'})
            if qty <= 0:
                raise serializers.ValidationError({'detail': f'Số lượng "{med.name}" phải lớn hơn 0.'})
            if med.is_controlled:
                raise serializers.ValidationError({'detail': f'"{med.name}" là thuốc kiểm soát đặc biệt — không kê trên hệ thống, phải kê đơn giấy theo quy định.'})
            if days > MAX_RX_DAYS:
                raise serializers.ValidationError({'detail': f'"{med.name}": tối đa {MAX_RX_DAYS} ngày thuốc cho mỗi lần kê.'})
            PrescriptionItem.objects.create(prescription=rx, medicine=med, quantity=qty, days=max(days, 0),
                                            dosage=(r.get('dosage') or '')[:120], usage=(r.get('usage') or '')[:255],
                                            unit_price=med.price)
        if d.get('issue') and not rows:
            return deny('Đơn thuốc trống, hãy thêm ít nhất một thuốc.', 400)
        rx.weight_kg = d.get('weight_kg') or None
        rx.guardian_name = (d.get('guardian_name') or '')[:120]
        if d.get('issue'):
            for it in rx.items.all():
                if it.days <= 0:
                    raise serializers.ValidationError({'detail': f'"{it.medicine.name}": cần ghi số ngày dùng thuốc.'})
            pt = visit.patient
            if not (pt.address or '').strip():
                raise serializers.ValidationError({'detail': 'Thiếu nơi cư trú của bệnh nhân (bắt buộc trên đơn thuốc). Hãy cập nhật hồ sơ bệnh nhân.'})
            months = age_in_months(pt.date_of_birth)
            if months is None:
                raise serializers.ValidationError({'detail': 'Thiếu ngày sinh của bệnh nhân — cần để xác định độ tuổi khi kê đơn.'})
            if months < 72:
                if not rx.weight_kg:
                    raise serializers.ValidationError({'detail': 'Trẻ dưới 72 tháng tuổi: bắt buộc ghi cân nặng.'})
                if not rx.guardian_name.strip():
                    raise serializers.ValidationError({'detail': 'Trẻ dưới 72 tháng tuổi: bắt buộc ghi tên người đi cùng.'})
                rx.age_months = months
            else:
                rx.age_months = None
            rx.patient_national_id, rx.patient_address = pt.national_id or '', pt.address
            rx.status, rx.issued_at = Prescription.ISSUED, timezone.now()
            rx.national_status = Prescription.NAT_PENDING
        rx.save()
        audit(request.user, 'rx.issue' if d.get('issue') else 'rx.save', f'{rx.code} {visit.patient.code}')
        return Response(self.get_serializer(rx).data)

    @action(detail=False, methods=['get'])
    def national(self, request):
        """Hàng đợi liên thông đơn thuốc quốc gia (chưa kết nối tự động — quản lý đối soát thủ công)."""
        qs = Prescription.objects.filter(status=Prescription.ISSUED).exclude(national_status=Prescription.NAT_SENT).select_related('patient', 'doctor')
        return Response([{'id': r.id, 'code': r.code, 'patient': r.patient.full_name, 'doctor': uname(r.doctor), 'issued_at': r.issued_at,
                          'national_status': r.national_status} for r in qs[:200]])

    @action(detail=True, methods=['post'])
    def mark_sent(self, request, pk=None):
        rx = self.get_object()
        code = (request.data.get('national_code') or '').strip()[:40]
        if not code:
            return deny('Nhập mã đơn thuốc quốc gia đã được cấp.', 400)
        rx.national_status, rx.national_code, rx.national_sent_at = Prescription.NAT_SENT, code, timezone.now()
        rx.save(update_fields=['national_status', 'national_code', 'national_sent_at'])
        audit(request.user, 'rx.national', f'{rx.code} → {code}')
        return Response(self.get_serializer(rx).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        rx = self.get_object()
        if rx.visit.status != Visit.IN_CONSULT:
            return deny('Chỉ hủy đơn khi lượt khám đang diễn ra.', 400)
        rx.status = Prescription.CANCELLED
        rx.save(update_fields=['status'])
        audit(request.user, 'rx.cancel', rx.code)
        return Response(self.get_serializer(rx).data)


# --------------------------------------------------------------------------- hóa đơn
def _sync_stock(invoice, user):
    """Đưa tồn kho khớp với các dòng thuốc hiện tại của hóa đơn (idempotent)."""
    want = {}
    if invoice.status != Invoice.VOID:
        for it in invoice.items.filter(kind=InvoiceItem.MEDICINE, medicine__isnull=False):
            want[it.medicine_id] = want.get(it.medicine_id, 0) + it.quantity
    have = {}
    for m in StockMovement.objects.filter(reference=invoice.code, kind=StockMovement.OUT):
        have[m.medicine_id] = have.get(m.medicine_id, 0) - m.quantity    # quantity âm khi xuất
    for mid in set(want) | set(have):
        delta = want.get(mid, 0) - have.get(mid, 0)
        if delta:
            med = Medicine.objects.get(pk=mid)
            move_stock(med, -delta, StockMovement.OUT, user, invoice.code,
                       'Bán theo hóa đơn' if delta > 0 else 'Điều chỉnh / hủy hóa đơn')


def _walkin_patient():
    """Hồ sơ ẩn dùng cho hóa đơn bán cho khách vãng lai."""
    p, _ = Patient.objects.get_or_create(
        code='KHACHLE',
        defaults={'full_name': 'Khách vãng lai', 'phone': '', 'is_active': False},
    )
    return p


def _write_payments(invoice, rows, user):
    """Ghi các khoản thanh toán gửi kèm lúc tạo hóa đơn."""
    if not isinstance(rows, list):
        raise serializers.ValidationError({'detail': 'Danh sách thanh toán không hợp lệ.'})
    shift = CashierShift.objects.filter(cashier=user, status=CashierShift.OPEN).first()
    total_pay = 0
    for r in rows:
        try:
            amount = int(r.get('amount'))
        except (TypeError, ValueError):
            raise serializers.ValidationError({'detail': 'Số tiền thanh toán không hợp lệ.'})
        if amount <= 0:
            raise serializers.ValidationError({'detail': 'Số tiền thanh toán phải lớn hơn 0.'})
        total_pay += amount
        if total_pay > invoice.total:
            raise serializers.ValidationError({'detail': 'Tổng thanh toán vượt quá tổng hóa đơn.'})
        method = r.get('method') if r.get('method') in dict(Payment.METHODS) else Payment.CASH
        if method == Payment.CASH and not shift:
            raise serializers.ValidationError({'detail': 'Cần mở ca thu ngân trước khi nhận tiền mặt.'})
        Payment.objects.create(
            invoice=invoice, amount=amount, method=method,
            reference=(r.get('reference') or '')[:60],
            note=(r.get('note') or '')[:255], received_by=user, shift=shift,
        )
    invoice.recalc()
    audit(user, 'invoice.pay', f'{invoice.code} {total_pay}')


def _write_items(invoice, rows, allow_package=False):
    invoice.items.all().delete()
    if not isinstance(rows, list) or not rows:
        raise serializers.ValidationError({'detail': 'Hóa đơn cần ít nhất một dòng.'})
    for r in rows:
        try:
            qty, price = int(r.get('quantity') or 1), int(r.get('unit_price') or 0)
        except (TypeError, ValueError):
            raise serializers.ValidationError({'detail': 'Số lượng / đơn giá không hợp lệ.'})
        if qty <= 0 or price < 0:
            raise serializers.ValidationError({'detail': 'Số lượng phải > 0 và đơn giá không âm.'})
        kind = r.get('kind') if r.get('kind') in {'service', 'medicine', 'other', 'package'} else 'other'
        med = Medicine.objects.filter(pk=r.get('medicine')).first() if kind == 'medicine' else None
        svc = Service.objects.filter(pk=r.get('service')).first() if kind == 'service' and r.get('service') else None
        name = (r.get('name') or (med.name if med else svc.name if svc else '')).strip()
        template = PackageTemplate.objects.filter(pk=r.get('package_template'), is_active=True).first() if kind == 'package' else None
        if kind == 'package' and not template and isinstance(r.get('package'), dict):
            custom = r['package']
            try:
                template = PackageTemplate.objects.create(
                    name=(name or 'Gói tùy chỉnh')[:160],
                    service=svc,
                    total_sessions=max(1, min(int(custom.get('total_sessions') or 1), 60)),
                    interval_days=max(0, min(int(custom.get('interval_days') or 14), 365)),
                    validity_months=max(0, min(int(custom.get('validity_months') or 0), 60)),
                    price=price,
                    is_custom=True,
                )
            except (TypeError, ValueError):
                raise serializers.ValidationError({'detail': 'Thông tin gói tùy chỉnh không hợp lệ.'})
        if kind == 'package' and not allow_package:
            raise serializers.ValidationError({'detail': 'Chỉ được bán gói trong hóa đơn mới.'})
        if kind == 'package' and not template:
            raise serializers.ValidationError({'detail': 'Gói liệu trình không hợp lệ hoặc đã ngừng bán.'})
        name = (name or (template.name if template else '')).strip()
        if not name:
            raise serializers.ValidationError({'detail': 'Mỗi dòng cần có tên.'})
        if kind == 'medicine' and not med:
            raise serializers.ValidationError({'detail': 'Dòng thuốc cần chọn thuốc trong kho.'})
        InvoiceItem.objects.create(invoice=invoice, kind=kind, name=name[:200], medicine=med, service=svc,
                                   package_template=template, quantity=qty, unit_price=price)


class InvoiceViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = InvoiceSerializer

    def get_permissions(self):
        if self.action in {'list', 'retrieve', 'summary'}:
            return [perm(BILLING_READ)]
        if self.action == 'void':
            return [perm(MANAGER)]
        return [perm(BILLING)]

    def get_queryset(self):
        qs = Invoice.objects.select_related('patient', 'created_by', 'treatment_plan').prefetch_related(
            'items', 'payments__received_by', 'refunds__requested_by', 'refunds__approved_by', 'followups__created_by')
        p = self.request.query_params
        if p.get('status'):
            qs = qs.filter(status__in=p['status'].split(','))
        if p.get('patient'):
            qs = qs.filter(patient_id=p['patient'])
        if p.get('visit'):
            qs = qs.filter(visit_id=p['visit'])
        if p.get('einvoice'):
            qs = qs.filter(einvoice_status=p['einvoice'])
        if p.get('date'):
            qs = qs.filter(created_at__date=p['date'])
        if p.get('due') == 'overdue':
            qs = qs.filter(status__in=[Invoice.UNPAID, Invoice.PARTIAL], due_date__lt=timezone.localdate())
        if p.get('q'):
            qs = qs.filter(Q(code__icontains=p['q']) | Q(patient__full_name__icontains=p['q']) | Q(patient__phone__icontains=p['q']))
        return qs[:300] if self.action == 'list' else qs

    @action(detail=False, methods=['get'], url_path='draft-from-visit')
    def draft_from_visit(self, request):
        """Gợi ý các dòng hóa đơn từ lượt khám: dịch vụ của lịch hẹn + thuốc trong đơn đã kê."""
        v = Visit.objects.filter(pk=request.query_params.get('visit')).select_related('patient', 'booking').first()
        if not v:
            return deny('Không tìm thấy lượt khám.', 404)
        rows = []
        session = v.treatment_session if v.treatment_session_id else (
            v.booking.treatment_session if v.booking_id and v.booking.treatment_session_id else None
        )
        covered_by_package = bool(session and session.plan.package_invoices.exclude(status=Invoice.VOID).exists())
        skipped_package_service = False
        if v.booking_id:
            for bi in v.booking.items.select_related('service'):
                if (covered_by_package and not skipped_package_service
                        and session.plan.service_id and bi.service_id == session.plan.service_id):
                    skipped_package_service = True
                    continue
                rows.append({'kind': 'service', 'service': bi.service_id, 'name': bi.service.name, 'quantity': 1, 'unit_price': bi.price})
        rx = Prescription.objects.filter(visit=v, status=Prescription.ISSUED).prefetch_related('items__medicine').first()
        if rx:
            for it in rx.items.all():
                rows.append({'kind': 'medicine', 'medicine': it.medicine_id, 'name': it.medicine.name,
                             'quantity': it.quantity, 'unit_price': it.medicine.price})
        return Response({'patient': v.patient_id, 'patient_name': v.patient.full_name, 'visit': v.pk,
                         'items': rows, 'has_prescription': bool(rx),
                         'covered_by_package': covered_by_package,
                         'treatment_plan_title': session.plan.title if covered_by_package else ''})

    @transaction.atomic
    def _save(self, request, invoice=None):
        d = request.data
        creating = invoice is None
        if invoice is None:
            patient = _walkin_patient() if d.get('walk_in') else Patient.objects.filter(
                pk=d.get('patient'), is_active=True
            ).first()
            if not patient:
                raise serializers.ValidationError({'detail': 'Chọn khách hàng hoặc bán cho khách vãng lai.'})
            visit = Visit.objects.filter(pk=d.get('visit'), patient=patient).first() if d.get('visit') else None
            plan = None
            if d.get('treatment_plan'):
                plan = TreatmentPlan.objects.select_for_update().filter(pk=d.get('treatment_plan'), patient=patient).first()
                if not plan:
                    raise serializers.ValidationError({'detail': 'Liệu trình không thuộc khách hàng đã chọn.'})
                if plan.status in {TreatmentPlan.CANCELLED, TreatmentPlan.COMPLETED}:
                    raise serializers.ValidationError({'detail': 'Không thể bán gói cho liệu trình đã kết thúc hoặc bị hủy.'})
                if plan.price <= 0:
                    raise serializers.ValidationError({'detail': 'Liệu trình chưa có giá trọn gói hợp lệ.'})
                if plan.sessions.filter(status='done').exists():
                    raise serializers.ValidationError({'detail': 'Không thể bán trọn gói sau khi đã ghi nhận buổi điều trị. Hãy tiếp tục thu theo từng buổi.'})
                if plan.service_id:
                    session_visit_ids = Visit.objects.filter(
                        Q(treatment_session__plan=plan) | Q(booking__treatment_session__plan=plan)
                    ).values_list('pk', flat=True)
                    already_billed = InvoiceItem.objects.filter(
                        invoice__visit_id__in=session_visit_ids,
                        invoice__status__in=[Invoice.UNPAID, Invoice.PARTIAL, Invoice.PAID],
                        service_id=plan.service_id,
                    ).exists()
                    if already_billed:
                        raise serializers.ValidationError({'detail': 'Đã có buổi trong liệu trình được lập hóa đơn riêng. Không thể bán gói hồi tố để tránh thu trùng.'})
                if Invoice.objects.filter(treatment_plan=plan).exclude(status=Invoice.VOID).exists():
                    raise serializers.ValidationError({'detail': 'Gói liệu trình này đã có hóa đơn. Mở hóa đơn hiện tại để thu phần còn lại.'})
                if visit:
                    raise serializers.ValidationError({'detail': 'Hóa đơn bán gói cần lập riêng với hóa đơn lượt khám.'})
            if visit and Invoice.objects.filter(visit=visit).exclude(status=Invoice.VOID).exists():
                raise serializers.ValidationError({'detail': 'Lượt khám này đã có hóa đơn.'})
            invoice = Invoice.objects.create(patient=patient, visit=visit, treatment_plan=plan, created_by=request.user)
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if invoice.status == Invoice.VOID:
            raise serializers.ValidationError({'detail': 'Hóa đơn đã hủy.'})
        if 'items' in d:
            if not creating and (invoice.items.filter(kind=InvoiceItem.PACKAGE).exists() or invoice.plans.exists()):
                raise serializers.ValidationError({'detail': 'Hóa đơn đã bán gói liệu trình; không thể sửa dòng hàng.'})
            if invoice.payments.exists():
                raise serializers.ValidationError({'detail': 'Hóa đơn đã thu tiền, không sửa được các dòng.'})
            if invoice.treatment_plan_id:
                package_rows = d.get('items')
                try:
                    package_valid = (isinstance(package_rows, list) and len(package_rows) == 1
                                     and package_rows[0].get('kind') == 'other'
                                     and int(package_rows[0].get('quantity') or 0) == 1
                                     and int(package_rows[0].get('unit_price') or 0) == invoice.treatment_plan.price)
                except (TypeError, ValueError, AttributeError):
                    package_valid = False
                if not package_valid:
                    raise serializers.ValidationError({'detail': 'Hóa đơn gói phải giữ đúng một dòng với giá trọn gói đã thiết lập.'})
            _write_items(invoice, d.get('items'), allow_package=creating and not d.get('walk_in'))
        if 'discount' in d:
            try:
                invoice.discount = max(int(d.get('discount') or 0), 0)
            except (TypeError, ValueError):
                raise serializers.ValidationError({'detail': 'Giảm giá không hợp lệ.'})
        if 'note' in d:
            invoice.note = (d.get('note') or '')[:255]
        if creating or 'payment_term' in d or 'due_date' in d:
            if creating and 'payment_term' not in d:
                from core.operational_settings import clinic_setting
                default_days = int(clinic_setting('billing.default_due_days'))
                term = {0: Invoice.TERM_IMMEDIATE, 7: Invoice.TERM_7,
                        15: Invoice.TERM_15, 30: Invoice.TERM_30}.get(default_days, Invoice.TERM_IMMEDIATE)
            else:
                term = d.get('payment_term') or Invoice.TERM_IMMEDIATE
            days = {Invoice.TERM_IMMEDIATE: 0, Invoice.TERM_7: 7, Invoice.TERM_15: 15, Invoice.TERM_30: 30}
            if term == Invoice.TERM_CUSTOM:
                try:
                    due = date.fromisoformat(str(d.get('due_date') or ''))
                except ValueError:
                    raise serializers.ValidationError({'detail': 'Chọn ngày đến hạn cho điều khoản tùy chỉnh.'})
            elif term in days:
                due = timezone.localdate() + timedelta(days=days[term])
            else:
                raise serializers.ValidationError({'detail': 'Điều khoản thanh toán không hợp lệ.'})
            invoice.payment_term, invoice.due_date = term, due
        invoice.save()
        invoice.recalc()
        if creating and invoice.items.filter(kind=InvoiceItem.PACKAGE).exists():
            create_plans_for_invoice(invoice)
        if creating and d.get('payments'):
            _write_payments(invoice, d.get('payments'), request.user)
        _sync_stock(invoice, request.user)
        return invoice

    def create(self, request):
        inv = self._save(request)
        audit(request.user, 'invoice.create', f'{inv.code} {inv.total}')
        return Response(self.get_serializer(inv).data, status=201)

    def update(self, request, pk=None, partial=False):
        inv = self._save(request, self.get_object())
        audit(request.user, 'invoice.update', inv.code)
        return Response(self.get_serializer(inv).data)

    partial_update = update

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def pay(self, request, pk=None):
        inv = Invoice.objects.select_for_update().get(pk=self.get_object().pk)
        if inv.status == Invoice.VOID:
            return deny('Hóa đơn đã hủy.', 400)
        try:
            amount = int(request.data.get('amount'))
        except (TypeError, ValueError):
            return deny('Số tiền không hợp lệ.', 400)
        if amount <= 0:
            return deny('Số tiền phải lớn hơn 0.', 400)
        if amount > inv.balance:
            return deny(f'Số tiền vượt quá số còn nợ ({inv.balance:,}đ).'.replace(',', '.'), 400)
        method = request.data.get('method') if request.data.get('method') in dict(Payment.METHODS) else Payment.CASH
        shift = CashierShift.objects.filter(cashier=request.user, status=CashierShift.OPEN).first()
        if method == Payment.CASH and not shift:
            return deny('Cần mở ca thu ngân trước khi nhận tiền mặt.', 400)
        Payment.objects.create(invoice=inv, amount=amount, method=method, reference=(request.data.get('reference') or '')[:60],
                               note=(request.data.get('note') or '')[:255], received_by=request.user, shift=shift)
        inv.recalc()
        audit(request.user, 'invoice.pay', f'{inv.code} {amount}')
        return Response(self.get_serializer(Invoice.objects.get(pk=inv.pk)).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def void(self, request, pk=None):
        inv = Invoice.objects.select_for_update().get(pk=self.get_object().pk)
        reason = (request.data.get('reason') or '').strip()
        if inv.status == Invoice.VOID:
            return deny('Hóa đơn đã hủy.', 400)
        if inv.payments.exists():
            return deny('Hóa đơn đã thu tiền, không thể hủy (chức năng hoàn tiền sẽ có ở bản sau).', 400)
        if inv.plans.filter(sessions__status='done').exists() or (
            inv.treatment_plan_id and inv.treatment_plan.sessions.filter(status='done').exists()
        ):
            return deny('Gói đã có buổi điều trị được ghi nhận, không thể hủy hóa đơn gói.', 400)
        if len(reason) < 5:
            return deny('Nhập lý do hủy (tối thiểu 5 ký tự).', 400)
        inv.status, inv.void_reason = Invoice.VOID, reason[:255]
        inv.save()
        inv.plans.exclude(status=TreatmentPlan.COMPLETED).update(status=TreatmentPlan.CANCELLED)
        _sync_stock(inv, request.user)
        audit(request.user, 'invoice.void', f'{inv.code}: {reason}')
        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=['post'])
    def buyer(self, request, pk=None):
        """Ghi thông tin người mua để xuất hóa đơn điện tử (MST 10 hoặc 13 số). Bỏ trống tất cả = không xuất."""
        inv = self.get_object()
        if inv.status == Invoice.VOID:
            return deny('Hóa đơn đã hủy.', 400)
        if inv.einvoice_status == Invoice.EI_ISSUED:
            return deny('Hóa đơn điện tử đã được xuất, không sửa thông tin người mua. Cần lập hóa đơn điều chỉnh qua nhà cung cấp.', 400)
        d = request.data
        tax = re.sub(r'[\s.]', '', d.get('buyer_tax_code') or '')
        if tax and not re.fullmatch(r'\d{10}(-?\d{3})?', tax):
            return deny('Mã số thuế không hợp lệ (10 số, hoặc 13 số cho đơn vị phụ thuộc).', 400)
        name = (d.get('buyer_name') or '').strip()
        if tax and not name:
            return deny('Nhập tên đơn vị mua hàng kèm mã số thuế.', 400)
        inv.buyer_name, inv.buyer_tax_code = name[:200], tax
        inv.buyer_address, inv.buyer_email = (d.get('buyer_address') or '')[:255], (d.get('buyer_email') or '')[:254]
        inv.einvoice_status = Invoice.EI_REQUESTED if d.get('request') else Invoice.EI_NONE
        inv.save()
        audit(request.user, 'invoice.buyer', inv.code)
        return Response(self.get_serializer(inv).data)

    @action(detail=True, methods=['post'])
    def einvoice(self, request, pk=None):
        """Ghi nhận hóa đơn điện tử đã phát hành trên hệ thống của nhà cung cấp (hệ thống này không tự phát hành)."""
        inv = self.get_object()
        no, sym = (request.data.get('einvoice_no') or '').strip(), (request.data.get('einvoice_symbol') or '').strip()
        if inv.status == Invoice.VOID or not no or not sym:
            return deny('Nhập ký hiệu và số hóa đơn điện tử đã phát hành.', 400)
        inv.einvoice_status, inv.einvoice_no, inv.einvoice_symbol = Invoice.EI_ISSUED, no[:20], sym[:20]
        inv.einvoice_lookup, inv.einvoice_at = (request.data.get('einvoice_lookup') or '')[:60], timezone.now()
        inv.save()
        audit(request.user, 'invoice.einvoice', f'{inv.code} {sym}-{no}')
        return Response(self.get_serializer(inv).data)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        today = timezone.localdate()
        month_start = today.replace(day=1)
        pays = Payment.objects.filter(invoice__status__in=[Invoice.PAID, Invoice.PARTIAL, Invoice.UNPAID])
        refunds = Refund.objects.filter(status=Refund.COMPLETED)

        def total(qs):
            return qs.aggregate(s=Sum('amount'))['s'] or 0

        def net_for(day_filter, method=None):
            payment_qs = pays.filter(**{f'paid_at__date{day_filter[0]}': day_filter[1]})
            refund_qs = refunds.filter(**{f'completed_at__date{day_filter[0]}': day_filter[1]})
            if method:
                payment_qs, refund_qs = payment_qs.filter(method=method), refund_qs.filter(method=method)
            return total(payment_qs) - total(refund_qs)

        by_method = {m: net_for(('', today), m) for m, _ in Payment.METHODS}
        debt = Invoice.objects.filter(status__in=[Invoice.UNPAID, Invoice.PARTIAL])
        debt_total = sum(i.balance for i in debt)
        overdue = debt.filter(due_date__lt=today)
        out = {'today_revenue': net_for(('', today)), 'today_refunds': total(refunds.filter(completed_at__date=today)),
               'by_method': by_method,
               'today_invoices': Invoice.objects.filter(created_at__date=today).exclude(status=Invoice.VOID).count(),
               'debt_total': debt_total, 'debt_count': debt.count(), 'overdue_count': overdue.count(),
               'overdue_total': sum(i.balance for i in overdue),
               'pending_reconciliation': pays.filter(reconciliation_status=Payment.PENDING).count()}
        if role_of(request) == 'manager':
            out['month_revenue'] = net_for(('__gte', month_start))
            out['series_14d'] = [{'label': (today - timedelta(days=i)).strftime('%d/%m'),
                                  'amount': net_for(('', today - timedelta(days=i)))} for i in range(13, -1, -1)]
            out['low_stock'] = Medicine.objects.filter(is_active=True, stock__lte=F('min_stock')).count()
        return Response(out)


class CashierShiftViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = CashierShiftSerializer

    def get_permissions(self):
        return [perm(BILLING)]

    def get_queryset(self):
        qs = CashierShift.objects.select_related('cashier', 'closed_by').prefetch_related('payments', 'refunds')
        if role_of(self.request) != 'manager':
            qs = qs.filter(cashier=self.request.user)
        return qs[:100] if self.action == 'list' else qs

    @action(detail=False, methods=['get'])
    def current(self, request):
        shift = CashierShift.objects.filter(cashier=request.user, status=CashierShift.OPEN).first()
        return Response(self.get_serializer(shift).data if shift else None)

    @action(detail=False, methods=['post'])
    @transaction.atomic
    def open(self, request):
        if CashierShift.objects.filter(cashier=request.user, status=CashierShift.OPEN).exists():
            return deny('Bạn đang có một ca thu ngân chưa đóng.', 400)
        try:
            opening = max(int(request.data.get('opening_cash') or 0), 0)
        except (TypeError, ValueError):
            return deny('Tiền đầu ca không hợp lệ.', 400)
        shift = CashierShift.objects.create(cashier=request.user, opening_cash=opening)
        audit(request.user, 'cashier_shift.open', f'Ca #{shift.pk}: {opening}')
        return Response(self.get_serializer(shift).data, status=201)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def close(self, request, pk=None):
        shift = CashierShift.objects.select_for_update().get(pk=self.get_object().pk)
        if shift.status == CashierShift.CLOSED:
            return deny('Ca thu ngân đã đóng.', 400)
        if shift.cashier_id != request.user.id and role_of(request) != 'manager':
            return deny('Bạn không được đóng ca của người khác.', 403)
        try:
            counted = max(int(request.data.get('counted_cash') or 0), 0)
        except (TypeError, ValueError):
            return deny('Tiền kiểm đếm không hợp lệ.', 400)
        shift.expected_cash = max(shift.opening_cash + shift.cash_total(), 0)
        difference = counted - shift.expected_cash
        from core.operational_settings import clinic_setting
        approval_threshold = int(clinic_setting('billing.cash_close_variance_manager_threshold'))
        if approval_threshold and abs(difference) > approval_threshold and role_of(request) != 'manager':
            return deny(f'Chênh lệch quỹ {abs(difference):,}đ vượt ngưỡng {approval_threshold:,}đ. Quản lý cần duyệt hoặc đóng ca này.'.replace(',', '.'), 403)
        shift.counted_cash, shift.difference = counted, difference
        shift.note = (request.data.get('note') or '')[:255]
        shift.status, shift.closed_at, shift.closed_by = CashierShift.CLOSED, timezone.now(), request.user
        shift.save()
        shift.payments.filter(method=Payment.CASH, reconciliation_status=Payment.PENDING).update(
            reconciliation_status=Payment.RECONCILED, reconciled_at=timezone.now(), reconciled_by=request.user)
        audit(request.user, 'cashier_shift.close', f'Ca #{shift.pk}: lệch {shift.difference}')
        return Response(self.get_serializer(shift).data)


class PaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = PaymentSerializer

    def get_permissions(self):
        return [perm(MANAGER if self.action == 'reconcile' else BILLING)]

    def get_queryset(self):
        qs = Payment.objects.select_related('invoice__patient', 'received_by', 'shift')
        if self.request.query_params.get('reconciliation'):
            qs = qs.filter(reconciliation_status=self.request.query_params['reconciliation'])
        qs = qs.order_by('-paid_at', '-id')
        return qs[:200] if self.action == 'list' else qs

    @action(detail=True, methods=['post'])
    def reconcile(self, request, pk=None):
        payment = self.get_object()
        payment.reconciliation_status, payment.reconciled_at, payment.reconciled_by = Payment.RECONCILED, timezone.now(), request.user
        payment.save(update_fields=['reconciliation_status', 'reconciled_at', 'reconciled_by'])
        audit(request.user, 'payment.reconcile', f'{payment.invoice.code}: {payment.amount}')
        return Response(self.get_serializer(payment).data)


class RefundViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = RefundSerializer

    def get_permissions(self):
        if self.action in {'approve', 'reject'}:
            return [perm(MANAGER)]
        return [perm(BILLING)]

    def get_queryset(self):
        qs = Refund.objects.select_related('invoice__patient', 'requested_by', 'approved_by', 'completed_by')
        if self.request.query_params.get('invoice'):
            qs = qs.filter(invoice_id=self.request.query_params['invoice'])
        return qs[:200] if self.action == 'list' else qs

    @transaction.atomic
    def create(self, request):
        inv = Invoice.objects.select_for_update().filter(pk=request.data.get('invoice')).first()
        if not inv or inv.status == Invoice.VOID:
            return deny('Không tìm thấy hóa đơn hợp lệ.', 404)
        try:
            amount = int(request.data.get('amount'))
        except (TypeError, ValueError):
            return deny('Số tiền hoàn không hợp lệ.', 400)
        pending = inv.refunds.filter(status__in=[Refund.PENDING, Refund.APPROVED]).aggregate(v=Sum('amount'))['v'] or 0
        if amount <= 0 or amount > inv.paid - pending:
            return deny('Số tiền hoàn vượt quá số tiền có thể hoàn.', 400)
        reason = (request.data.get('reason') or '').strip()
        if len(reason) < 5:
            return deny('Nhập lý do hoàn tiền (tối thiểu 5 ký tự).', 400)
        method = request.data.get('method') if request.data.get('method') in dict(Payment.METHODS) else Payment.CASH
        refund = Refund.objects.create(invoice=inv, amount=amount, method=method, reason=reason[:255], requested_by=request.user)
        audit(request.user, 'refund.request', f'{inv.code}: {amount}')
        return Response(self.get_serializer(refund).data, status=201)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        refund = self.get_object()
        if refund.status != Refund.PENDING:
            return deny('Yêu cầu không còn ở trạng thái chờ duyệt.', 400)
        refund.status, refund.approved_by, refund.approved_at = Refund.APPROVED, request.user, timezone.now()
        refund.save(update_fields=['status', 'approved_by', 'approved_at'])
        audit(request.user, 'refund.approve', f'{refund.invoice.code}: {refund.amount}')
        return Response(self.get_serializer(refund).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        refund = self.get_object()
        if refund.status != Refund.PENDING:
            return deny('Yêu cầu không còn ở trạng thái chờ duyệt.', 400)
        refund.status, refund.approved_by, refund.approved_at = Refund.REJECTED, request.user, timezone.now()
        refund.save(update_fields=['status', 'approved_by', 'approved_at'])
        audit(request.user, 'refund.reject', f'{refund.invoice.code}: {refund.amount}')
        return Response(self.get_serializer(refund).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def complete(self, request, pk=None):
        refund = Refund.objects.select_for_update().get(pk=self.get_object().pk)
        if refund.status != Refund.APPROVED:
            return deny('Yêu cầu hoàn tiền chưa được quản lý duyệt.', 400)
        shift = CashierShift.objects.filter(cashier=request.user, status=CashierShift.OPEN).first()
        if refund.method == Payment.CASH and not shift:
            return deny('Cần mở ca thu ngân trước khi hoàn tiền mặt.', 400)
        refund.status, refund.completed_by, refund.completed_at = Refund.COMPLETED, request.user, timezone.now()
        refund.reference, refund.shift = (request.data.get('reference') or '')[:60], shift
        refund.save()
        refund.invoice.recalc()
        audit(request.user, 'refund.complete', f'{refund.invoice.code}: {refund.amount}')
        return Response(self.get_serializer(refund).data)


class DebtFollowUpViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = DebtFollowUpSerializer

    def get_permissions(self):
        return [perm(BILLING)]

    def get_queryset(self):
        qs = DebtFollowUp.objects.select_related('invoice__patient', 'created_by')
        if self.request.query_params.get('invoice'):
            qs = qs.filter(invoice_id=self.request.query_params['invoice'])
        if self.request.query_params.get('next_date'):
            qs = qs.filter(next_follow_up__lte=self.request.query_params['next_date'])
        return qs[:300]

    def create(self, request):
        inv = Invoice.objects.filter(pk=request.data.get('invoice'), status__in=[Invoice.UNPAID, Invoice.PARTIAL]).first()
        if not inv or not inv.balance:
            return deny('Hóa đơn không còn công nợ.', 400)
        note = (request.data.get('note') or '').strip()
        if len(note) < 3:
            return deny('Nhập nội dung chăm sóc công nợ.', 400)
        action_name = request.data.get('action') if request.data.get('action') in dict(DebtFollowUp.ACTIONS) else DebtFollowUp.NOTE
        follow = DebtFollowUp.objects.create(invoice=inv, action=action_name, note=note[:500],
            promised_date=request.data.get('promised_date') or None, next_follow_up=request.data.get('next_follow_up') or None,
            created_by=request.user)
        audit(request.user, 'debt.followup', f'{inv.code}: {action_name}')
        return Response(self.get_serializer(follow).data, status=201)
