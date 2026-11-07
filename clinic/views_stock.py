"""Module Kho kiểu Pabau: tổng quan, lô, biến động, kho/vị trí, chuyển kho, ."""
import csv
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.db.models.functions import TruncDate
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from . import inventory
from .audit import audit
from .models import (Medicine, PurchaseOrder, StockCount, StockLocation, StockLot, StockMovement,
                     StockTransfer, StockTransferLine)
from .permissions import IsClinicStaff, role_of
from .serializers import uname
from .views import deny
from .views_money import _page, _rng
from .views_v2 import perm
from .views_v3 import MANAGER, _int, pc

KIND_LABEL = dict(StockMovement.KINDS)


def _csv(name, header, rows):
    r = HttpResponse(content_type='text/csv; charset=utf-8')
    r['Content-Disposition'] = f'attachment; filename="{name}-{timezone.localdate().isoformat()}.csv"'
    r.write('﻿')  # BOM để Excel đọc đúng tiếng Việt
    w = csv.writer(r)
    w.writerow(header)
    w.writerows(rows)
    return r


def _loc_name(l):
    return l.location.name if l.location_id else inventory.default_location().name


def _is_mgr(request):
    return role_of(request) in MANAGER


# =========================================================================== tổng quan
@api_view(['GET'])
@permission_classes([IsClinicStaff])
def overview(request):
    today = timezone.localdate()
    meds = Medicine.objects.filter(is_active=True)
    lots = StockLot.objects.filter(quantity__gt=0)
    mgr = _is_mgr(request)
    d_from, d_to = _rng(request.query_params)
    days = [d_from + timedelta(days=i) for i in range((d_to - d_from).days + 1)]
    mv = StockMovement.objects.filter(created_at__date__gte=d_from, created_at__date__lte=d_to)

    def series(qs):
        got = {r['d']: r['v'] or 0 for r in qs.annotate(d=TruncDate('created_at')).values('d').annotate(v=Sum('quantity'))}
        return [got.get(d, 0) for d in days]
    ins = series(mv.filter(quantity__gt=0).exclude(kind=StockMovement.TRANSFER))
    outs = series(mv.filter(quantity__lt=0).exclude(kind=StockMovement.TRANSFER))
    locs = []
    for loc in StockLocation.objects.filter(is_active=True):
        q = inventory.lots_at(loc, lots)
        qty = q.aggregate(s=Sum('quantity'))['s'] or 0
        val = sum(l.quantity * l.unit_cost for l in q) if mgr else None
        if loc.is_default:
            qty += sum(max(inventory.unlotted_qty(m), 0) for m in meds)
        locs.append({'id': loc.id, 'name': loc.name, 'qty': qty, 'value': val, 'lots': q.count()})
    low = meds.filter(stock__lte=F('min_stock')).order_by('stock')[:8]
    soon = lots.filter(expiry_date__isnull=False, expiry_date__lte=today + timedelta(days=90)).select_related('medicine').order_by('expiry_date')[:8]
    return Response({
        'items': meds.count(),
        'units': sum(m.stock for m in meds),
        'value': sum(m.stock * m.cost for m in meds) if mgr else None,
        'low': meds.filter(stock__lte=F('min_stock')).count(),
        'out_of_stock': meds.filter(stock__lte=0).count(),
        'expiring': lots.filter(expiry_date__gte=today, expiry_date__lte=today + timedelta(days=90)).count(),
        'expired': lots.filter(expiry_date__lt=today).count(),
        'open_orders': PurchaseOrder.objects.filter(status__in=[PurchaseOrder.ORDERED, PurchaseOrder.PARTIAL]).count(),
        'open_counts': StockCount.objects.filter(status=StockCount.DRAFT).count(),
        'pending_transfers': StockTransfer.objects.filter(status__in=[StockTransfer.PENDING, StockTransfer.PARTIAL]).count(),
        'range': {'from': d_from, 'to': d_to},
        'days': [d.isoformat() for d in days], 'in': ins, 'out': [-x for x in outs],
        'locations': locs,
        'low_items': [{'id': m.id, 'name': m.name, 'code': m.code, 'unit': m.unit, 'stock': m.stock, 'min_stock': m.min_stock} for m in low],
        'expiring_lots': [{'id': l.id, 'medicine': l.medicine.name, 'lot_no': l.lot_no, 'qty': l.quantity, 'expiry': l.expiry_date,
                           'days': (l.expiry_date - today).days} for l in soon],
    })


# =========================================================================== lô hàng (Batches)
def _lot_row(l, today, mgr):
    days = (l.expiry_date - today).days if l.expiry_date else None
    return {'id': l.id, 'medicine': l.medicine_id, 'medicine_name': l.medicine.name, 'code': l.medicine.code, 'unit': l.medicine.unit,
            'lot_no': l.lot_no, 'expiry_date': l.expiry_date, 'days': days, 'quantity': l.quantity, 'initial_qty': l.initial_qty,
            'unit_cost': l.unit_cost if mgr else None, 'value': l.quantity * l.unit_cost if mgr else None,
            'supplier': l.supplier.name if l.supplier_id else '', 'location': _loc_name(l), 'location_id': l.location_id,
            'received_at': l.received_at, 'reference': l.reference}


def _lot_qs(p):
    today = timezone.localdate()
    qs = StockLot.objects.select_related('medicine', 'supplier', 'location')
    if p.get('show') != 'all':
        qs = qs.filter(quantity__gt=0)
    if p.get('q'):
        qs = qs.filter(Q(medicine__name__icontains=p['q']) | Q(lot_no__icontains=p['q']) | Q(medicine__code__icontains=p['q']))
    if p.get('location'):
        loc = StockLocation.objects.filter(pk=_int(p['location'])).first()
        if loc:
            qs = inventory.lots_at(loc, qs)
    if p.get('medicine'):
        qs = qs.filter(medicine_id=_int(p['medicine']))
    e = p.get('expiry')
    if e == 'expired':
        qs = qs.filter(expiry_date__lt=today)
    elif e in {'30', '60', '90'}:
        qs = qs.filter(expiry_date__gte=today, expiry_date__lte=today + timedelta(days=int(e)))
    elif e == 'none':
        qs = qs.filter(expiry_date__isnull=True)
    elif e == 'valid':
        qs = qs.filter(Q(expiry_date__gte=today) | Q(expiry_date__isnull=True))
    return qs.order_by(F('expiry_date').asc(nulls_last=True), 'id')


@api_view(['GET'])
@permission_classes([IsClinicStaff])
def batches(request):
    p, mgr, today = request.query_params, _is_mgr(request), timezone.localdate()
    qs = _lot_qs(p)
    if p.get('export'):
        return _csv('lo-hang', ['Sản phẩm', 'Mã', 'Số lô', 'Hạn dùng', 'Còn lại', 'Đơn vị', 'Kho', 'Nhà cung cấp', 'Ngày nhập'] + (['Giá vốn', 'Giá trị'] if mgr else []),
                    [[l.medicine.name, l.medicine.code, l.lot_no, l.expiry_date or '', l.quantity, l.medicine.unit, _loc_name(l),
                      l.supplier.name if l.supplier_id else '', timezone.localtime(l.received_at).date()] + ([l.unit_cost, l.quantity * l.unit_cost] if mgr else []) for l in qs])
    agg = qs.aggregate(q=Sum('quantity'))
    rows, meta = _page(p, qs)
    meta['total_qty'] = agg['q'] or 0
    return Response({**meta, 'results': [_lot_row(l, today, mgr) for l in rows]})


@api_view(['POST'])
@permission_classes([pc(MANAGER)])
@transaction.atomic
def quick_setup(request):
    """Thiết lập nhanh: biến phần tồn chưa theo lô thành một lô "tồn đầu kỳ" (để bắt đầu quản lý hạn dùng / số lô)."""
    exp = request.data.get('expiry') or None
    try:
        exp = date.fromisoformat(exp) if exp else None
    except ValueError:
        return deny('Hạn dùng không hợp lệ.', 400)
    loc = StockLocation.objects.filter(pk=request.data.get('location')).first() or inventory.default_location()
    made = 0
    for med in Medicine.objects.filter(is_active=True, stock__gt=0):
        free = inventory.unlotted_qty(med)
        if free > 0:
            StockLot.objects.create(medicine=med, lot_no='TON-DAU', expiry_date=exp, quantity=free, initial_qty=free, unit_cost=med.cost,
                                    reference='Thiết lập', location=loc)
            made += 1
    audit(request.user, 'stock.quick_setup', f'{made} lô tồn đầu kỳ')
    return Response({'created': made})


# =========================================================================== biến động
@api_view(['GET'])
@permission_classes([IsClinicStaff])
def movements(request):
    p, mgr = request.query_params, _is_mgr(request)
    d_from, d_to = _rng(p)
    qs = StockMovement.objects.select_related('medicine', 'by', 'lot', 'lot__location').filter(created_at__date__gte=d_from, created_at__date__lte=d_to)
    if p.get('kind'):
        qs = qs.filter(kind=p['kind'])
    if p.get('medicine'):
        qs = qs.filter(medicine_id=_int(p['medicine']))
    if p.get('q'):
        qs = qs.filter(Q(medicine__name__icontains=p['q']) | Q(reference__icontains=p['q']) | Q(note__icontains=p['q']))
    if p.get('location'):
        loc = StockLocation.objects.filter(pk=_int(p['location'])).first()
        if loc:
            cond = Q(lot__location=loc) | (Q(lot__location__isnull=True) if loc.is_default else Q(pk__in=[]))
            qs = qs.filter(cond)
    qs = qs.order_by('-created_at', '-id')

    def row(m):
        return {'id': m.id, 'created_at': m.created_at, 'medicine': m.medicine_id, 'medicine_name': m.medicine.name, 'code': m.medicine.code,
                'unit': m.medicine.unit, 'kind': m.kind, 'kind_label': KIND_LABEL.get(m.kind, m.kind), 'quantity': m.quantity,
                'balance_after': m.balance_after, 'reference': m.reference, 'note': m.note, 'lot_no': m.lot.lot_no if m.lot_id else '',
                'location': (m.lot.location.name if m.lot.location_id else inventory.default_location().name) if m.lot_id else '',
                'by': uname(m.by) if m.by_id else 'Hệ thống', 'unit_cost': m.unit_cost if mgr else None}
    if p.get('export'):
        return _csv('bien-dong-kho', ['Thời gian', 'Sản phẩm', 'Loại', 'Số lượng', 'Tồn sau', 'Số lô', 'Kho', 'Chứng từ', 'Ghi chú', 'Người thực hiện'],
                    [[timezone.localtime(m['created_at']).strftime('%d/%m/%Y %H:%M'), m['medicine_name'], m['kind_label'], m['quantity'], m['balance_after'],
                      m['lot_no'], m['location'], m['reference'], m['note'], m['by']] for m in map(row, qs[:20000])])
    rows, meta = _page(p, qs)
    return Response({**meta, 'results': [row(m) for m in rows]})


# =========================================================================== kho / vị trí
class LocationSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    qty = serializers.SerializerMethodField()

    class Meta:
        model = StockLocation
        fields = ('id', 'code', 'name', 'note', 'is_default', 'is_active', 'items', 'qty')
        extra_kwargs = {'code': {'required': False}}

    def _lots(self, o):
        return inventory.lots_at(o, StockLot.objects.filter(quantity__gt=0))

    def get_items(self, o):
        return self._lots(o).values('medicine').distinct().count()

    def get_qty(self, o):
        n = self._lots(o).aggregate(s=Sum('quantity'))['s'] or 0
        if o.is_default:
            n += sum(max(inventory.unlotted_qty(m), 0) for m in Medicine.objects.filter(is_active=True))
        return n

    def validate(self, a):
        if not self.instance and not a.get('code'):
            base = ''.join(c for c in a.get('name', '').upper() if c.isalnum())[:10] or 'KHO'
            code, i = f'KHO-{base}', 1
            while StockLocation.objects.filter(code=code).exists():
                i += 1
                code = f'KHO-{base}{i}'
            a['code'] = code
        return a


class LocationViewSet(viewsets.ModelViewSet):
    serializer_class = LocationSerializer
    queryset = StockLocation.objects.all()
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_permissions(self):
        return [IsClinicStaff()] if self.action in {'list', 'retrieve'} else [perm(MANAGER)]

    def list(self, request, *a, **k):
        inventory.default_location()
        return super().list(request, *a, **k)

    @transaction.atomic
    def perform_create(self, ser):
        o = ser.save()
        if o.is_default:
            StockLocation.objects.exclude(pk=o.pk).update(is_default=False)

    @transaction.atomic
    def perform_update(self, ser):
        o = ser.save()
        if o.is_default:
            StockLocation.objects.exclude(pk=o.pk).update(is_default=False)

    def destroy(self, request, *a, **k):
        o = self.get_object()
        if o.is_default:
            return deny('Không xóa được kho mặc định.', 400)
        if o.lots.filter(quantity__gt=0).exists():
            return deny('Kho còn hàng — hãy chuyển hết hàng sang kho khác trước khi xóa.', 400)
        if StockTransfer.objects.filter(Q(from_location=o) | Q(to_location=o), status__in=['draft', 'pending', 'partial']).exists():
            return deny('Kho đang có phiếu chuyển chưa hoàn tất.', 400)
        o.is_active = False
        o.save(update_fields=['is_active'])
        return Response(status=204)


# =========================================================================== chuyển kho
class TLineSerializer(serializers.ModelSerializer):
    medicine_name = serializers.CharField(source='medicine.name', read_only=True)
    code = serializers.CharField(source='medicine.code', read_only=True)
    unit = serializers.CharField(source='medicine.unit', read_only=True)

    class Meta:
        model = StockTransferLine
        fields = ('id', 'medicine', 'medicine_name', 'code', 'unit', 'quantity', 'received_qty')


class TransferSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    from_name = serializers.CharField(source='from_location.name', read_only=True)
    to_name = serializers.CharField(source='to_location.name', read_only=True)
    lines = TLineSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()
    total_qty = serializers.SerializerMethodField()
    short = serializers.SerializerMethodField()

    class Meta:
        model = StockTransfer
        fields = ('id', 'code', 'from_location', 'to_location', 'from_name', 'to_name', 'status', 'status_label', 'note', 'created_at', 'sent_at',
                  'received_at', 'created_by_name', 'total_qty', 'lines', 'short')
        read_only_fields = ('code', 'status')

    def get_created_by_name(self, o):
        return uname(o.created_by)

    def get_total_qty(self, o):
        return sum(l.quantity for l in o.lines.all())

    def get_short(self, o):
        return inventory.check_transfer(o) if o.status in {'draft', 'pending', 'partial'} else []


class TransferViewSet(viewsets.ModelViewSet):
    serializer_class = TransferSerializer
    http_method_names = ['get', 'post', 'put', 'head', 'options']

    def get_permissions(self):
        return [IsClinicStaff()] if self.action in {'list', 'retrieve'} else [perm(MANAGER)]

    def get_queryset(self):
        qs = StockTransfer.objects.select_related('from_location', 'to_location', 'created_by').prefetch_related('lines__medicine')
        p = self.request.query_params
        if p.get('status'):
            qs = qs.filter(status__in=p['status'].split(','))
        if p.get('q'):
            qs = qs.filter(Q(code__icontains=p['q']) | Q(from_location__name__icontains=p['q']) | Q(to_location__name__icontains=p['q']))
        return qs

    def _write(self, t, data):
        a = StockLocation.objects.filter(pk=data.get('from_location'), is_active=True).first()
        b = StockLocation.objects.filter(pk=data.get('to_location'), is_active=True).first()
        if not a or not b:
            raise serializers.ValidationError({'detail': 'Chọn kho gửi và kho nhận.'})
        if a.id == b.id:
            raise serializers.ValidationError({'detail': 'Kho gửi và kho nhận phải khác nhau.'})
        t.from_location, t.to_location, t.note = a, b, (data.get('note') or '')[:255]
        t.save()
        t.lines.all().delete()
        merged = {}
        for r in data.get('lines') or []:
            q = _int(r.get('quantity'))
            if q > 0 and Medicine.objects.filter(pk=r.get('medicine')).exists():
                merged[int(r['medicine'])] = merged.get(int(r['medicine']), 0) + q
        if not merged:
            raise serializers.ValidationError({'detail': 'Phiếu chuyển cần ít nhất một mặt hàng.'})
        for mid, q in merged.items():
            StockTransferLine.objects.create(transfer=t, medicine_id=mid, quantity=q)

    @transaction.atomic
    def create(self, request, *a, **k):
        t = StockTransfer(created_by=request.user, from_location=inventory.default_location(), to_location=inventory.default_location())
        self._write(t, request.data)
        audit(request.user, 'transfer.create', t.code)
        return Response(self.get_serializer(t).data, status=201)

    @transaction.atomic
    def update(self, request, *a, **k):
        t = self.get_object()
        if t.status != StockTransfer.DRAFT:
            return deny('Chỉ sửa được phiếu nháp.', 400)
        self._write(t, request.data)
        return Response(self.get_serializer(t).data)

    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        t = inventory.send_transfer(self.get_object(), request.user)
        audit(request.user, 'transfer.send', t.code)
        return Response(self.get_serializer(t).data)

    @action(detail=True, methods=['post'])
    def receive(self, request, pk=None):
        t = inventory.receive_transfer(self.get_object(), request.user, request.data.get('lines'))
        audit(request.user, 'transfer.receive', f'{t.code} → {t.status}')
        return Response(self.get_serializer(StockTransfer.objects.get(pk=t.pk)).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        t = self.get_object()
        if t.status in {StockTransfer.RECEIVED, StockTransfer.CANCELLED} or any(l.received_qty for l in t.lines.all()):
            return deny('Phiếu đã nhận hàng hoặc đã hủy, không thể hủy.', 400)
        t.status = StockTransfer.CANCELLED
        t.save()
        return Response(self.get_serializer(t).data)
