"""v3: kho theo lô / nhập hàng / kiểm kho, phòng, chăm sóc, cam kết ký điện tử, nhật ký, báo cáo."""
import hashlib
import re
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from accounts.models import ActivityLog
from . import inventory, reports
from .audit import audit
from .models import (CareContactLog, CareTask, ConsentForm, Invoice, Medicine, Patient, PurchaseOrder, PurchaseOrderLine, Room, StockCount,
                     StockCountLine, StockLocation, StockLot, StockMovement, Supplier, TreatmentPlan, TreatmentSession, Visit, MedicalRecord)
from .permissions import IsClinicStaff, role_of
from .serializers import uname
from .views import deny
from rest_framework.permissions import BasePermission
from .views_v2 import perm
from core.role_permissions import view_action_allowed


def pc(roles):
    """Lớp quyền theo vai trò (dùng cho decorator cần class, không phải instance)."""
    return type('RolePC', (BasePermission,), {'has_permission': lambda self, request, view: role_of(request) in roles and view_action_allowed(request, view)})

MANAGER = {'manager'}
FRONT = {'manager', 'consultant'}
CLINICAL_ROLES = {'manager', 'doctor', 'consultant'}


def _int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


# =========================================================================== nhà cung cấp
class SupplierSerializer(serializers.ModelSerializer):
    order_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Supplier
        fields = ('id', 'code', 'name', 'contact', 'phone', 'email', 'address', 'tax_code', 'note', 'is_active', 'order_count')
        read_only_fields = ('code',)


class SupplierViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierSerializer

    def get_permissions(self):
        return [IsClinicStaff()] if self.action in {'list', 'retrieve'} else [perm(MANAGER)]

    def get_queryset(self):
        qs = Supplier.objects.annotate(order_count=Count('orders'))
        q = self.request.query_params.get('q')
        return qs.filter(Q(name__icontains=q) | Q(code__icontains=q) | Q(phone__icontains=q)) if q else qs

    def destroy(self, request, *args, **kwargs):
        s = self.get_object()
        s.is_active = False
        s.save(update_fields=['is_active'])
        return Response(status=204)


# =========================================================================== lô thuốc
class LotSerializer(serializers.ModelSerializer):
    medicine_name = serializers.CharField(source='medicine.name', read_only=True)
    medicine_code = serializers.CharField(source='medicine.code', read_only=True)
    unit = serializers.CharField(source='medicine.unit', read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True, default='')
    location_name = serializers.CharField(source='location.name', read_only=True, default='')
    days_left = serializers.SerializerMethodField()

    class Meta:
        model = StockLot
        fields = ('id', 'medicine', 'medicine_name', 'medicine_code', 'unit', 'lot_no', 'expiry_date', 'days_left', 'quantity', 'initial_qty',
                  'unit_cost', 'supplier_name', 'location', 'location_name', 'received_at', 'reference')

    def get_days_left(self, o):
        return (o.expiry_date - timezone.localdate()).days if o.expiry_date else None


class LotViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = LotSerializer
    permission_classes = [IsClinicStaff]

    def get_queryset(self):
        qs = StockLot.objects.select_related('medicine', 'supplier')
        p = self.request.query_params
        if p.get('medicine'):
            qs = qs.filter(medicine_id=p['medicine'])
        if p.get('all') != '1':
            qs = qs.filter(quantity__gt=0)
        if p.get('expiring'):
            from core.operational_settings import clinic_setting
            warning_days = int(clinic_setting('inventory.expiry_warning_days'))
            requested_days = warning_days if p['expiring'] == 'default' else _int(p['expiring'], warning_days)
            qs = qs.filter(expiry_date__isnull=False, expiry_date__lte=timezone.localdate() + timedelta(days=requested_days))
        return qs.order_by(F('expiry_date').asc(nulls_last=True), 'id')

    @action(detail=True, methods=['post'], permission_classes=[pc(MANAGER)])
    def scrap(self, request, pk=None):
        lot = self.get_object()
        med = inventory.scrap_lot(lot, _int(request.data.get('quantity')), request.user, request.data.get('note', ''))
        audit(request.user, 'stock.scrap', f'{med.code} lô {lot.lot_no or lot.pk}')
        return Response({'ok': True, 'stock': med.stock})


# =========================================================================== đơn nhập hàng
class POLineSerializer(serializers.ModelSerializer):
    medicine_name = serializers.CharField(source='medicine.name', read_only=True)
    unit = serializers.CharField(source='medicine.unit', read_only=True)

    class Meta:
        model = PurchaseOrderLine
        fields = ('id', 'medicine', 'medicine_name', 'unit', 'quantity', 'unit_cost', 'received_qty')


class POSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source='supplier.name', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    lines = POLineSerializer(many=True, read_only=True)
    total = serializers.IntegerField(read_only=True)
    created_by_name = serializers.SerializerMethodField()
    location_name = serializers.CharField(source='location.name', read_only=True, default='')

    class Meta:
        model = PurchaseOrder
        fields = ('id', 'code', 'supplier', 'supplier_name', 'location', 'location_name', 'supplier_ref', 'status', 'status_label',
                  'expected_date', 'note', 'created_at', 'ordered_at', 'received_at', 'total', 'lines', 'created_by_name')
        read_only_fields = ('code', 'status')

    def get_created_by_name(self, o):
        return uname(o.created_by)


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    serializer_class = POSerializer
    http_method_names = ['get', 'post', 'put', 'head', 'options']

    def get_permissions(self):
        return [IsClinicStaff()] if self.action in {'list', 'retrieve'} else [perm(MANAGER)]

    def get_queryset(self):
        qs = PurchaseOrder.objects.select_related('supplier', 'created_by', 'location').prefetch_related('lines__medicine')
        p = self.request.query_params
        if p.get('status'):
            qs = qs.filter(status__in=p['status'].split(','))
        if p.get('q'):
            qs = qs.filter(Q(code__icontains=p['q']) | Q(supplier__name__icontains=p['q']))
        return qs

    def _write_lines(self, order, rows):
        order.lines.all().delete()
        n = 0
        for r in rows or []:
            med = Medicine.objects.filter(pk=r.get('medicine')).first()
            qty = _int(r.get('quantity'))
            if med and qty > 0:
                PurchaseOrderLine.objects.create(order=order, medicine=med, quantity=qty, unit_cost=max(_int(r.get('unit_cost'), med.cost), 0))
                n += 1
        if not n:
            raise serializers.ValidationError({'detail': 'Đơn nhập cần ít nhất một dòng hàng hợp lệ.'})

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        sup = Supplier.objects.filter(pk=request.data.get('supplier')).first()
        if not sup:
            return deny('Vui lòng chọn nhà cung cấp.', 400)
        o = PurchaseOrder.objects.create(supplier=sup, expected_date=request.data.get('expected_date') or None,
                                         note=(request.data.get('note') or '')[:255], created_by=request.user,
                                         location_id=request.data.get('location') or inventory.default_location().id,
                                         supplier_ref=(request.data.get('supplier_ref') or '')[:80])
        self._write_lines(o, request.data.get('lines'))
        audit(request.user, 'po.create', o.code)
        return Response(self.get_serializer(o).data, status=201)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        o = self.get_object()
        if o.status != PurchaseOrder.DRAFT:
            return deny('Chỉ sửa được đơn ở trạng thái nháp.', 400)
        sup = Supplier.objects.filter(pk=request.data.get('supplier')).first() or o.supplier
        o.supplier, o.expected_date, o.note = sup, request.data.get('expected_date') or None, (request.data.get('note') or '')[:255]
        o.location_id = request.data.get('location') or o.location_id
        o.supplier_ref = (request.data.get('supplier_ref') or '')[:80]
        o.save(update_fields=['supplier', 'expected_date', 'note', 'location', 'supplier_ref'])
        self._write_lines(o, request.data.get('lines'))
        return Response(self.get_serializer(o).data)

    @action(detail=True, methods=['post'])
    def confirm(self, request, pk=None):
        o = self.get_object()
        if o.status != PurchaseOrder.DRAFT:
            return deny('Đơn đã được xác nhận.', 400)
        o.status, o.ordered_at = PurchaseOrder.ORDERED, timezone.now()
        o.save()
        audit(request.user, 'po.confirm', o.code)
        return Response(self.get_serializer(o).data)

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        o = inventory.receive_order(self.get_object(), request.user, request.data.get('lines') or [])
        audit(request.user, 'po.receive', f'{o.code} → {o.status}')
        return Response(self.get_serializer(PurchaseOrder.objects.get(pk=o.pk)).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        o = self.get_object()
        if o.status in {PurchaseOrder.RECEIVED, PurchaseOrder.CANCELLED} or any(l.received_qty for l in o.lines.all()):
            return deny('Đơn đã nhận hàng hoặc đã hủy, không thể hủy.', 400)
        o.status = PurchaseOrder.CANCELLED
        o.save()
        return Response(self.get_serializer(o).data)


# =========================================================================== kiểm kho
class CountLineSerializer(serializers.ModelSerializer):
    medicine_name = serializers.CharField(source='medicine.name', read_only=True)
    medicine_code = serializers.CharField(source='medicine.code', read_only=True)
    unit = serializers.CharField(source='medicine.unit', read_only=True)
    lot_no = serializers.SerializerMethodField()
    expiry_date = serializers.DateField(source='lot.expiry_date', read_only=True, default=None)
    diff = serializers.IntegerField(read_only=True)

    class Meta:
        model = StockCountLine
        fields = ('id', 'medicine', 'medicine_name', 'medicine_code', 'unit', 'lot', 'lot_no', 'expiry_date', 'expected_qty', 'counted_qty', 'diff')

    def get_lot_no(self, o):
        return (o.lot.lot_no or f'#{o.lot_id}') if o.lot_id else 'Không theo lô'


class CountSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    validated_by_name = serializers.SerializerMethodField()
    line_count = serializers.SerializerMethodField()
    diff_count = serializers.SerializerMethodField()
    lines = serializers.SerializerMethodField()
    location_name = serializers.CharField(source='location.name', read_only=True, default='')

    class Meta:
        model = StockCount
        fields = ('id', 'code', 'name', 'location', 'location_name', 'status', 'status_label', 'note', 'created_at', 'created_by_name',
                  'validated_at', 'validated_by_name', 'line_count', 'diff_count', 'lines')

    def get_created_by_name(self, o):
        return uname(o.created_by)

    def get_validated_by_name(self, o):
        return uname(o.validated_by) if o.validated_by_id else ''

    def get_line_count(self, o):
        return len(o.lines.all())

    def get_diff_count(self, o):
        return sum(1 for l in o.lines.all() if l.diff)

    def get_lines(self, o):
        if not self.context.get('detail'):
            return []
        return CountLineSerializer(o.lines.select_related('medicine', 'lot'), many=True).data


class StockCountViewSet(viewsets.GenericViewSet, mixins.ListModelMixin, mixins.RetrieveModelMixin):
    serializer_class = CountSerializer

    def get_permissions(self):
        return [IsClinicStaff()] if self.action in {'list', 'retrieve'} else [perm(MANAGER)]

    def get_queryset(self):
        return StockCount.objects.select_related('created_by', 'validated_by', 'location').prefetch_related('lines__medicine', 'lines__lot')

    def get_serializer_context(self):
        c = super().get_serializer_context()
        c['detail'] = self.action != 'list'
        return c

    def create(self, request):
        location = StockLocation.objects.filter(pk=request.data.get('location')).first() if request.data.get('location') else None
        c = inventory.start_count(request.user, request.data.get('note', ''), request.data.get('medicine_ids') or None,
                                  request.data.get('name', ''), location)
        audit(request.user, 'count.start', c.code)
        return Response(self.get_serializer(c).data, status=201)

    @action(detail=True, methods=['post'])
    def lines(self, request, pk=None):
        """Lưu số đếm: body {lines:[{id, counted_qty}]}."""
        c = self.get_object()
        if c.status != StockCount.DRAFT:
            return deny('Phiếu kiểm đã chốt.', 400)
        for row in request.data.get('lines') or []:
            line = c.lines.filter(pk=row.get('id')).first()
            if not line:
                continue
            v = row.get('counted_qty')
            line.counted_qty = None if v in (None, '') else max(_int(v), 0)
            line.save(update_fields=['counted_qty'])
        return Response(self.get_serializer(StockCount.objects.get(pk=c.pk)).data)

    @action(detail=True, methods=['post'])
    def validate(self, request, pk=None):
        c, changed = inventory.validate_count(self.get_object(), request.user)
        audit(request.user, 'count.validate', f'{c.code} · {changed} điều chỉnh')
        return Response(self.get_serializer(StockCount.objects.get(pk=c.pk)).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        c = self.get_object()
        if c.status != StockCount.DRAFT:
            return deny('Phiếu kiểm đã chốt.', 400)
        c.status = StockCount.CANCELLED
        c.save()
        return Response(self.get_serializer(c).data)


@api_view(['GET'])
@permission_classes([IsClinicStaff])
def stock_card(request):
    """Thẻ kho: lịch sử biến động của một thuốc (tuỳ chọn khoảng ngày)."""
    p = request.query_params
    qs = StockMovement.objects.select_related('medicine', 'by', 'lot')
    if p.get('medicine'):
        qs = qs.filter(medicine_id=p['medicine'])
    if p.get('kind'):
        qs = qs.filter(kind=p['kind'])
    if p.get('from'):
        qs = qs.filter(created_at__date__gte=p['from'])
    if p.get('to'):
        qs = qs.filter(created_at__date__lte=p['to'])
    rows = [{'id': m.id, 'at': m.created_at, 'medicine': m.medicine_id, 'medicine_name': m.medicine.name, 'unit': m.medicine.unit,
             'kind': m.kind, 'kind_label': m.get_kind_display(), 'quantity': m.quantity, 'balance_after': m.balance_after,
             'reference': m.reference, 'note': m.note, 'lot_no': (m.lot.lot_no or f'#{m.lot_id}') if m.lot_id else '',
             'unit_cost': m.unit_cost, 'by': uname(m.by)} for m in qs[:300]]
    return Response(rows)


@api_view(['GET'])
@permission_classes([IsClinicStaff])
def inventory_overview(request):
    today = timezone.localdate()
    from core.operational_settings import clinic_setting
    warning_days = int(clinic_setting('inventory.expiry_warning_days'))
    meds = Medicine.objects.filter(is_active=True)
    lots = StockLot.objects.filter(quantity__gt=0)
    return Response({
        'items': meds.count(),
        'low': meds.filter(stock__lte=F('min_stock')).count(),
        'value': sum(m.stock * m.cost for m in meds) if role_of(request) in MANAGER else None,
        'expiring': lots.filter(expiry_date__isnull=False, expiry_date__lte=today + timedelta(days=warning_days), expiry_date__gte=today).count(),
        'expiry_warning_days': warning_days,
        'expired': lots.filter(expiry_date__isnull=False, expiry_date__lt=today).count(),
        'open_orders': PurchaseOrder.objects.filter(status__in=[PurchaseOrder.ORDERED, PurchaseOrder.PARTIAL]).count(),
        'open_counts': StockCount.objects.filter(status=StockCount.DRAFT).count(),
    })


# =========================================================================== phòng / ghế
class RoomSerializer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = Room
        fields = ('id', 'name', 'kind', 'kind_label', 'order', 'is_active')


class RoomViewSet(viewsets.ModelViewSet):
    serializer_class = RoomSerializer
    queryset = Room.objects.all()

    def get_permissions(self):
        return [IsClinicStaff()] if self.action in {'list', 'retrieve', 'board'} else [perm(MANAGER)]

    @action(detail=False, methods=['get'])
    def board(self, request):
        """Sơ đồ phòng: phòng nào đang có bệnh nhân."""
        busy = {v.room_id: v for v in Visit.objects.filter(status=Visit.IN_CONSULT, room__isnull=False).select_related('patient', 'doctor')}
        out = []
        for r in Room.objects.filter(is_active=True):
            v = busy.get(r.id)
            out.append({'id': r.id, 'name': r.name, 'kind': r.kind, 'kind_label': r.get_kind_display(),
                        'visit': {'id': v.id, 'patient': v.patient.full_name, 'doctor': uname(v.doctor), 'since': v.called_at} if v else None})
        return Response(out)


# =========================================================================== chăm sóc sau điều trị
def create_post_care_task(visit):
    from core.operational_settings import clinic_setting

    if not clinic_setting('care.post_care_enabled') or not visit.finished_at:
        return False
    delay = int(clinic_setting('care.post_care_delay_days'))
    _, created = CareTask.objects.get_or_create(source_key=f'visit:post_care:{visit.pk}', defaults={
        'patient': visit.patient, 'visit': visit, 'kind': CareTask.POST_CARE, 'auto': True,
        'title': f'Gọi hỏi thăm sau lượt khám #{visit.pk} — tình trạng da, phản ứng sau điều trị',
        'due_date': timezone.localtime(visit.finished_at).date() + timedelta(days=delay),
    })
    return created


def create_revisit_task(record):
    from core.operational_settings import clinic_setting

    if not clinic_setting('care.revisit_enabled') or not record.follow_up_date:
        return False
    today = timezone.localdate()
    lead = int(clinic_setting('care.revisit_lead_days'))
    _, created = CareTask.objects.get_or_create(source_key=f'record:revisit:{record.pk}', defaults={
        'patient': record.patient, 'visit': record.visit, 'kind': CareTask.REVISIT, 'auto': True,
        'title': f'Nhắc tái khám ngày {record.follow_up_date:%d/%m/%Y} (bệnh án {record.code})',
        'due_date': max(record.follow_up_date - timedelta(days=lead), today),
    })
    return created


def ensure_auto_tasks():
    """Tạo việc chăm sóc tự động (idempotent): hỏi thăm sau khám, nhắc tái khám, nhắc buổi liệu trình, nhắc công nợ."""
    from core.operational_settings import clinic_setting

    today = timezone.localdate()
    made = 0
    # Backfill legacy automatic tasks created before the activity timeline used
    # start_at/end_at. CareTask.save() derives the 09:00-09:30 window from due_date.
    for task in CareTask.objects.filter(auto=True, end_at__isnull=True).only('id', 'due_date', 'start_at', 'end_at'):
        task.save(update_fields=['start_at', 'end_at', 'due_date'])
    post_enabled = clinic_setting('care.post_care_enabled')
    post_delay = int(clinic_setting('care.post_care_delay_days'))
    revisit_enabled = clinic_setting('care.revisit_enabled')
    session_enabled = clinic_setting('care.session_enabled')
    session_lead = int(clinic_setting('care.session_lead_days'))
    debt_enabled = clinic_setting('care.debt_enabled')
    debt_after = int(clinic_setting('care.debt_after_days'))

    if post_enabled:
        lookback = max(7, post_delay + 7)
        for v in Visit.objects.filter(status=Visit.COMPLETED, finished_at__date__gte=today - timedelta(days=lookback)).select_related('patient'):
            made += int(create_post_care_task(v))
    if revisit_enabled:
        for r in MedicalRecord.objects.filter(status=MedicalRecord.SIGNED, follow_up_date__isnull=False, follow_up_date__gte=today - timedelta(days=7)).select_related('patient'):
            made += int(create_revisit_task(r))
    if session_enabled:
        for s in TreatmentSession.objects.filter(status=TreatmentSession.PENDING, plan__status=TreatmentPlan.ACTIVE, planned_date__isnull=False,
                                                 planned_date__lte=today + timedelta(days=session_lead)).select_related('plan__patient'):
            tag = f'buổi {s.number} · liệu trình #{s.plan_id}'
            _, created = CareTask.objects.get_or_create(source_key=f'session:{s.pk}', defaults={
                'patient': s.plan.patient, 'plan': s.plan, 'kind': CareTask.SESSION, 'auto': True,
                'title': f'Nhắc lịch {tag} ({s.plan.title}) ngày {s.planned_date:%d/%m/%Y}',
                'due_date': max(s.planned_date - timedelta(days=session_lead), today),
            })
            made += int(created)
    if debt_enabled:
        for i in Invoice.objects.filter(status__in=[Invoice.UNPAID, Invoice.PARTIAL], created_at__date__lte=today - timedelta(days=debt_after)).select_related('patient'):
            if i.total <= i.paid:
                continue
            _, created = CareTask.objects.get_or_create(source_key=f'invoice:payment:{i.pk}', defaults={
                'patient': i.patient, 'kind': CareTask.PAYMENT, 'auto': True, 'due_date': today,
                'title': f'Nhắc thanh toán hóa đơn {i.code} — còn nợ {i.total - i.paid:,}đ'.replace(',', '.'),
            })
            made += int(created)
    return made


class CareSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.full_name', read_only=True)
    patient_code = serializers.CharField(source='patient.code', read_only=True)
    patient_phone = serializers.SerializerMethodField()
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)
    assigned_name = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()
    priority_label = serializers.CharField(source='get_priority_display', read_only=True)
    contact_count = serializers.IntegerField(read_only=True)
    last_contact = serializers.SerializerMethodField()
    contact_history = serializers.SerializerMethodField()

    class Meta:
        model = CareTask
        fields = ('id', 'patient', 'patient_name', 'patient_code', 'patient_phone', 'kind', 'kind_label', 'title', 'due_date', 'status', 'priority',
                  'priority_label', 'assigned_to', 'assigned_name', 'outcome', 'auto', 'overdue', 'contact_count', 'last_contact',
                  'contact_history', 'escalation_reason', 'escalated_at', 'completed_at', 'created_at')
        read_only_fields = ('status', 'completed_at', 'auto')

    def get_patient_phone(self, o):
        from .serializers import maybe_mask
        return maybe_mask(o.patient.phone, self.context.get('request'))

    def get_assigned_name(self, o):
        return uname(o.assigned_to) if o.assigned_to_id else ''

    def get_overdue(self, o):
        return o.status == CareTask.PENDING and o.due_date < timezone.localdate()

    def get_last_contact(self, o):
        log = o.contact_logs.first()
        if not log:
            return None
        return {'id': log.id, 'channel': log.channel, 'channel_label': log.get_channel_display(),
                'result': log.result, 'result_label': log.get_result_display(), 'note': log.note,
                'next_contact_at': log.next_contact_at, 'clinical_alert': log.clinical_alert,
                'created_by': uname(log.created_by), 'created_at': log.created_at}

    def get_contact_history(self, o):
        return [{
            'id': log.id,
            'channel': log.channel,
            'channel_label': log.get_channel_display(),
            'result': log.result,
            'result_label': log.get_result_display(),
            'note': log.note,
            'next_contact_at': log.next_contact_at,
            'clinical_alert': log.clinical_alert,
            'created_by': uname(log.created_by),
            'created_at': log.created_at,
        } for log in o.contact_logs.all()]


class CareTaskViewSet(viewsets.ModelViewSet):
    serializer_class = CareSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_permissions(self):
        if self.action in {'list', 'retrieve', 'summary', 'contact', 'done', 'reopen'}:
            return [perm(CLINICAL_ROLES)]
        return [perm(FRONT)]

    def get_queryset(self):
        qs = CareTask.objects.select_related('patient', 'assigned_to').prefetch_related('contact_logs__created_by').annotate(contact_count=Count('contact_logs'))
        p = self.request.query_params
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        if p.get('patient'):
            qs = qs.filter(patient_id=p['patient'])
        if p.get('kind'):
            qs = qs.filter(kind=p['kind'])
        if p.get('priority'):
            qs = qs.filter(priority=p['priority'])
        if p.get('q'):
            q = p['q'].strip()
            qs = qs.filter(Q(patient__full_name__icontains=q) | Q(patient__code__icontains=q) | Q(patient__phone__icontains=q) | Q(title__icontains=q))
        if p.get('mine') == '1':
            qs = qs.filter(Q(assigned_to=self.request.user) | Q(assigned_to__isnull=True))
        return qs

    def list(self, request, *args, **kwargs):
        if request.query_params.get('status') in (None, '', 'pending'):
            ensure_auto_tasks()
        qs = self.filter_queryset(self.get_queryset())[:300]
        return Response(self.get_serializer(qs, many=True).data)

    def perform_create(self, serializer):
        serializer.save(assigned_to=serializer.validated_data.get('assigned_to') or self.request.user)

    @action(detail=True, methods=['post'])
    def contact(self, request, pk=None):
        t = self.get_object()
        note = (request.data.get('note') or '').strip()
        if not note:
            return deny('Nhập nội dung trao đổi hoặc tình trạng bệnh nhân.', 400)
        channel = request.data.get('channel', CareContactLog.CALL)
        result = request.data.get('result', CareContactLog.CONTACTED)
        if channel not in dict(CareContactLog.CHANNELS) or result not in dict(CareContactLog.RESULTS):
            return deny('Kênh liên hệ hoặc kết quả không hợp lệ.', 400)
        next_at = request.data.get('next_contact_at') or None
        clinical = bool(request.data.get('clinical_alert')) or result == CareContactLog.NEEDS_DOCTOR
        CareContactLog.objects.create(task=t, channel=channel, result=result, note=note, next_contact_at=next_at,
                                      clinical_alert=clinical, created_by=request.user)
        t.outcome = note[:255]
        if clinical:
            t.status, t.priority, t.escalation_reason, t.escalated_at = CareTask.ESCALATED, CareTask.URGENT, note[:500], timezone.now()
        elif result == CareContactLog.COMPLETED:
            t.status, t.completed_at, t.completed_by = CareTask.DONE, timezone.now(), request.user
        elif next_at:
            t.due_date = datetime.fromisoformat(next_at.replace('Z', '+00:00')).date()
        t.save()
        audit(request.user, 'care.contact', f'#{t.pk} · {result}')
        return Response(self.get_serializer(self.get_queryset().get(pk=t.pk)).data)

    @action(detail=True, methods=['post'])
    def done(self, request, pk=None):
        t = self.get_object()
        if t.status != CareTask.PENDING:
            return deny('Việc này đã được xử lý.', 400)
        t.status, t.completed_at, t.completed_by = (CareTask.SKIPPED if request.data.get('skip') else CareTask.DONE), timezone.now(), request.user
        t.outcome = (request.data.get('outcome') or '')[:255]
        t.save()
        audit(request.user, 'care.done', f'#{t.pk}')
        return Response(self.get_serializer(t).data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        t = self.get_object()
        t.status, t.completed_at, t.completed_by, t.escalated_at = CareTask.PENDING, None, None, None
        t.save()
        return Response(self.get_serializer(t).data)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        ensure_auto_tasks()
        today = timezone.localdate()
        pend = CareTask.objects.filter(status=CareTask.PENDING)
        return Response({'pending': pend.count(), 'overdue': pend.filter(due_date__lt=today).count(), 'today': pend.filter(due_date=today).count(),
                         'escalated': CareTask.objects.filter(status=CareTask.ESCALATED).count(),
                         'done_week': CareTask.objects.filter(status=CareTask.DONE, completed_at__date__gte=today - timedelta(days=7)).count()})


# =========================================================================== cam kết ký điện tử
CONSENT_TEXT = {
    'treatment': ('Phiếu đồng ý điều trị', """1. Tôi đã được bác sĩ giải thích về tình trạng da/bệnh lý, phương pháp điều trị đề xuất, lợi ích, rủi ro, tác dụng phụ có thể gặp và các phương án thay thế.
2. Tôi đã cung cấp thông tin trung thực về tiền sử bệnh, dị ứng, thuốc đang dùng và tình trạng thai kỳ (nếu có).
3. Tôi cam kết tuân thủ hướng dẫn chăm sóc và lịch tái khám của bác sĩ.
4. Tôi hiểu kết quả điều trị phụ thuộc vào cơ địa từng người và không thể cam kết kết quả tuyệt đối.
5. Tôi tự nguyện đồng ý thực hiện điều trị tại phòng khám."""),
    'laser': ('Cam kết điều trị laser / ánh sáng', """1. Tôi đã được giải thích về nguyên lý, mục đích, số buổi dự kiến và thời gian hồi phục của điều trị laser/ánh sáng.
2. Các phản ứng có thể gặp: đỏ, rát, sưng nhẹ, đóng vảy, tăng/giảm sắc tố tạm thời; hiếm gặp: bỏng, sẹo, nhiễm trùng.
3. Tôi cam kết chống nắng nghiêm ngặt, không tự ý bóc vảy, không dùng sản phẩm gây kích ứng trong thời gian hồi phục.
4. Tôi đã thông báo việc dùng isotretinoin, thuốc nhạy sáng, tiền sử sẹo lồi, herpes hoặc đang mang thai/cho con bú (nếu có).
5. Tôi tự nguyện đồng ý thực hiện."""),
    'peel': ('Cam kết peel da y khoa', """1. Tôi đã được giải thích về hoạt chất, nồng độ, mục đích và quy trình peel da.
2. Phản ứng thường gặp: châm chích, đỏ, khô, bong tróc trong 3–7 ngày; hiếm gặp: kích ứng nặng, tăng sắc tố sau viêm.
3. Tôi cam kết không tẩy tế bào chết, không dùng retinoid/AHA/BHA trong thời gian bác sĩ yêu cầu và chống nắng đầy đủ.
4. Tôi tự nguyện đồng ý thực hiện."""),
    'photo': ('Đồng ý chụp và lưu trữ hình ảnh', """1. Tôi đồng ý để phòng khám chụp ảnh vùng da điều trị nhằm theo dõi, đánh giá hiệu quả và lưu hồ sơ bệnh án.
2. Hình ảnh được bảo mật như hồ sơ bệnh án, chỉ nhân sự có thẩm quyền được xem.
3. Phòng khám không sử dụng hình ảnh của tôi cho mục đích quảng cáo nếu chưa có sự đồng ý riêng bằng văn bản."""),
    'warranty': ('Phiếu bảo hành dịch vụ', """1. Phòng khám bảo hành dịch vụ theo thời hạn ghi trên phiếu, áp dụng khi khách hàng tuân thủ đầy đủ liệu trình và lịch tái khám.
2. Bảo hành không áp dụng khi khách hàng tự ý dùng thuốc/mỹ phẩm khác, phơi nắng không bảo vệ, hoặc điều trị ở nơi khác trong thời gian bảo hành.
3. Nội dung bảo hành: bác sĩ đánh giá lại và hỗ trợ điều trị bổ sung phù hợp với tình trạng thực tế, không bao gồm hoàn tiền."""),
}


class ConsentSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.full_name', read_only=True)
    patient_code = serializers.CharField(source='patient.code', read_only=True)
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    witness_name = serializers.SerializerMethodField()
    plan_title = serializers.CharField(source='plan.title', read_only=True, default='')

    class Meta:
        model = ConsentForm
        fields = ('id', 'code', 'patient', 'patient_name', 'patient_code', 'visit', 'plan', 'plan_title', 'kind', 'kind_label', 'title', 'body', 'status',
                  'status_label', 'signer_name', 'signer_relation', 'signature', 'signed_at', 'content_hash', 'created_at', 'created_by_name',
                  'witness_name', 'valid_until')
        read_only_fields = ('code', 'status', 'signer_name', 'signer_relation', 'signature', 'signed_at', 'content_hash')

    def get_created_by_name(self, o):
        return uname(o.created_by)

    def get_witness_name(self, o):
        return uname(o.witness) if o.witness_id else ''

    def to_representation(self, inst):
        d = super().to_representation(inst)
        if self.context.get('list'):
            d.pop('signature', None)
        return d


class ConsentViewSet(viewsets.ModelViewSet):
    serializer_class = ConsentSerializer
    http_method_names = ['get', 'post', 'head', 'options']

    def get_permissions(self):
        return [perm(CLINICAL_ROLES)]

    def get_queryset(self):
        qs = ConsentForm.objects.select_related('patient', 'plan', 'created_by', 'witness')
        p = self.request.query_params
        if p.get('patient'):
            qs = qs.filter(patient_id=p['patient'])
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        return qs

    def get_serializer_context(self):
        c = super().get_serializer_context()
        c['list'] = self.action == 'list'
        return c

    @action(detail=False, methods=['get'])
    def templates(self, request):
        return Response([{'kind': k, 'title': t, 'body': b} for k, (t, b) in CONSENT_TEXT.items()])

    def create(self, request, *args, **kwargs):
        patient = Patient.objects.filter(pk=request.data.get('patient')).first()
        if not patient:
            return deny('Không tìm thấy bệnh nhân.', 400)
        kind = request.data.get('kind') or 'treatment'
        title, body = CONSENT_TEXT.get(kind, CONSENT_TEXT['treatment'])
        body = (request.data.get('body') or body).strip()
        plan = TreatmentPlan.objects.filter(pk=request.data.get('plan'), patient=patient).first() if request.data.get('plan') else None
        c = ConsentForm.objects.create(patient=patient, plan=plan, kind=kind, title=(request.data.get('title') or title)[:200], body=body, created_by=request.user,
                                       valid_until=request.data.get('valid_until') or None)
        audit(request.user, 'consent.create', f'{c.code} · {patient.code}')
        return Response(self.get_serializer(c).data, status=201)

    @action(detail=True, methods=['post'])
    def sign(self, request, pk=None):
        c = self.get_object()
        if c.status != ConsentForm.PENDING:
            return deny('Phiếu đã ký hoặc đã thu hồi.', 400)
        sig = request.data.get('signature') or ''
        if not re.match(r'^data:image/png;base64,[A-Za-z0-9+/=]{200,}$', sig) or len(sig) > 400_000:
            return deny('Chưa có chữ ký hợp lệ.', 400)
        name = (request.data.get('signer_name') or '').strip()
        if not name:
            return deny('Vui lòng nhập họ tên người ký.', 400)
        when = timezone.now()
        c.signer_name, c.signer_relation = name[:120], (request.data.get('signer_relation') or 'Bản thân')[:60]
        c.signature, c.signed_at, c.witness, c.status = sig, when, request.user, ConsentForm.SIGNED
        c.signed_ip = (request.META.get('HTTP_X_FORWARDED_FOR') or request.META.get('REMOTE_ADDR') or '').split(',')[0].strip() or None
        c.content_hash = hashlib.sha256(f'{c.code}|{c.title}|{c.body}|{c.signer_name}|{when.isoformat()}|{hashlib.sha256(sig.encode()).hexdigest()}'.encode()).hexdigest()
        c.save()
        audit(request.user, 'consent.sign', f'{c.code} {c.content_hash[:12]}')
        return Response(self.get_serializer(c).data)

    @action(detail=True, methods=['post'])
    def revoke(self, request, pk=None):
        if role_of(request) not in {'manager', 'doctor'}:
            return deny('Chỉ bác sĩ hoặc quản lý được thu hồi phiếu.')
        c = self.get_object()
        c.status = ConsentForm.REVOKED
        c.save(update_fields=['status'])
        audit(request.user, 'consent.revoke', c.code)
        return Response(self.get_serializer(c).data)


# =========================================================================== nhật ký truy cập
@api_view(['GET'])
@permission_classes([pc(MANAGER)])
def audit_log(request):
    p = request.query_params
    qs = ActivityLog.objects.select_related('user')
    if p.get('q'):
        qs = qs.filter(Q(action__icontains=p['q']) | Q(detail__icontains=p['q']) | Q(user__username__icontains=p['q']) | Q(user__first_name__icontains=p['q']))
    if p.get('prefix'):
        qs = qs.filter(action__startswith=p['prefix'])
    if p.get('user'):
        qs = qs.filter(user_id=p['user'])
    if p.get('from'):
        qs = qs.filter(created_at__date__gte=p['from'])
    if p.get('to'):
        qs = qs.filter(created_at__date__lte=p['to'])
    total = qs.count()
    limit = min(max(_int(p.get('limit'), 100), 1), 500)
    rows = [{'id': a.id, 'at': a.created_at, 'user': uname(a.user) if a.user_id else 'Hệ thống', 'role': a.user.role if a.user_id else '',
             'action': a.action, 'detail': a.detail} for a in qs[:limit]]
    groups = sorted({a.split('.')[0] for a in ActivityLog.objects.values_list('action', flat=True).distinct()[:500]})
    return Response({'total': total, 'rows': rows, 'groups': groups})


# =========================================================================== báo cáo
@api_view(['GET'])
@permission_classes([pc(MANAGER)])
def report(request, name):
    fn = reports.REPORTS.get(name)
    if not fn:
        return deny('Không có báo cáo này.', 404)
    d_from, d_to = reports.parse_range(request.query_params)
    rep = fn(d_from, d_to)
    audit(request.user, 'report.view', f'{name} {d_from}→{d_to}')
    if request.query_params.get('export') == 'xlsx':
        audit(request.user, 'report.export', f'{name} {d_from}→{d_to}')
        resp = HttpResponse(reports.to_xlsx(rep), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        resp['Content-Disposition'] = f'attachment; filename="bao-cao-{name}-{d_from:%Y%m%d}-{d_to:%Y%m%d}.xlsx"'
        return resp
    return Response(rep)
