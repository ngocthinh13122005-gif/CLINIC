import re
from datetime import timedelta

from django.db import transaction
from django.db.models import F, Q, Sum
from django.utils import timezone
from rest_framework import mixins, permissions, serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from core.models import Service
from .audit import audit
from .models import (Invoice, InvoiceItem, Medicine, Patient, Payment, Prescription, PrescriptionItem, StockMovement, Visit)
from .permissions import CanReadClinical, CanWriteClinical, IsClinicStaff, role_of
from .serializers import uname
from .serializers_v2 import (InvoiceSerializer, MedicineSerializer, PaymentSerializer, PrescriptionSerializer,
                             StockMovementSerializer)
from .views import deny

BILLING = {'consultant', 'manager'}          # lập hóa đơn, thu tiền
BILLING_READ = BILLING | {'doctor'}
MANAGER = {'manager'}


class RolePerm(permissions.BasePermission):
    def __init__(self, roles):
        self.roles = roles

    def has_permission(self, request, view):
        return role_of(request) in self.roles


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


def _write_items(invoice, rows):
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
        kind = r.get('kind') if r.get('kind') in {'service', 'medicine', 'other'} else 'other'
        med = Medicine.objects.filter(pk=r.get('medicine')).first() if kind == 'medicine' else None
        svc = Service.objects.filter(pk=r.get('service')).first() if kind == 'service' and r.get('service') else None
        name = (r.get('name') or (med.name if med else svc.name if svc else '')).strip()
        if not name:
            raise serializers.ValidationError({'detail': 'Mỗi dòng cần có tên.'})
        if kind == 'medicine' and not med:
            raise serializers.ValidationError({'detail': 'Dòng thuốc cần chọn thuốc trong kho.'})
        InvoiceItem.objects.create(invoice=invoice, kind=kind, name=name[:200], medicine=med, service=svc,
                                   quantity=qty, unit_price=price)


class InvoiceViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = InvoiceSerializer

    def get_permissions(self):
        if self.action in {'list', 'retrieve', 'summary'}:
            return [perm(BILLING_READ)]
        if self.action == 'void':
            return [perm(MANAGER)]
        return [perm(BILLING)]

    def get_queryset(self):
        qs = Invoice.objects.select_related('patient', 'created_by').prefetch_related('items', 'payments__received_by')
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
        if v.booking_id:
            for bi in v.booking.items.select_related('service'):
                rows.append({'kind': 'service', 'service': bi.service_id, 'name': bi.service.name, 'quantity': 1, 'unit_price': bi.price})
        rx = Prescription.objects.filter(visit=v, status=Prescription.ISSUED).prefetch_related('items__medicine').first()
        if rx:
            for it in rx.items.all():
                rows.append({'kind': 'medicine', 'medicine': it.medicine_id, 'name': it.medicine.name,
                             'quantity': it.quantity, 'unit_price': it.medicine.price})
        return Response({'patient': v.patient_id, 'patient_name': v.patient.full_name, 'visit': v.pk,
                         'items': rows, 'has_prescription': bool(rx)})

    @transaction.atomic
    def _save(self, request, invoice=None):
        d = request.data
        if invoice is None:
            patient = Patient.objects.filter(pk=d.get('patient'), is_active=True).first()
            if not patient:
                raise serializers.ValidationError({'detail': 'Chọn bệnh nhân.'})
            visit = Visit.objects.filter(pk=d.get('visit'), patient=patient).first() if d.get('visit') else None
            if visit and Invoice.objects.filter(visit=visit).exclude(status=Invoice.VOID).exists():
                raise serializers.ValidationError({'detail': 'Lượt khám này đã có hóa đơn.'})
            invoice = Invoice.objects.create(patient=patient, visit=visit, created_by=request.user)
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if invoice.status == Invoice.VOID:
            raise serializers.ValidationError({'detail': 'Hóa đơn đã hủy.'})
        if 'items' in d:
            if invoice.payments.exists():
                raise serializers.ValidationError({'detail': 'Hóa đơn đã thu tiền, không sửa được các dòng.'})
            _write_items(invoice, d.get('items'))
        if 'discount' in d:
            try:
                invoice.discount = max(int(d.get('discount') or 0), 0)
            except (TypeError, ValueError):
                raise serializers.ValidationError({'detail': 'Giảm giá không hợp lệ.'})
        if 'note' in d:
            invoice.note = (d.get('note') or '')[:255]
        invoice.save()
        invoice.recalc()
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
        Payment.objects.create(invoice=inv, amount=amount, method=method, reference=(request.data.get('reference') or '')[:60],
                               note=(request.data.get('note') or '')[:255], received_by=request.user)
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
        if len(reason) < 5:
            return deny('Nhập lý do hủy (tối thiểu 5 ký tự).', 400)
        inv.status, inv.void_reason = Invoice.VOID, reason[:255]
        inv.save()
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

        def total(qs):
            return qs.aggregate(s=Sum('amount'))['s'] or 0
        by_method = {m: total(pays.filter(paid_at__date=today, method=m)) for m, _ in Payment.METHODS}
        debt = Invoice.objects.filter(status__in=[Invoice.UNPAID, Invoice.PARTIAL])
        debt_total = sum(i.balance for i in debt)
        out = {'today_revenue': total(pays.filter(paid_at__date=today)), 'by_method': by_method,
               'today_invoices': Invoice.objects.filter(created_at__date=today).exclude(status=Invoice.VOID).count(),
               'debt_total': debt_total, 'debt_count': debt.count()}
        if role_of(request) == 'manager':
            out['month_revenue'] = total(pays.filter(paid_at__date__gte=month_start))
            out['series_14d'] = [{'label': (today - timedelta(days=i)).strftime('%d/%m'),
                                  'amount': total(pays.filter(paid_at__date=today - timedelta(days=i)))} for i in range(13, -1, -1)]
            out['low_stock'] = Medicine.objects.filter(is_active=True, stock__lte=F('min_stock')).count()
        return Response(out)
