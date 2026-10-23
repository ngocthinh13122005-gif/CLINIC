"""Nghiệp vụ kho thuốc theo lô (kiểu Odoo): nhập theo lô/hạn dùng, xuất FEFO, kiểm kho, hủy hàng.

Quy ước: Medicine.stock là tổng tồn. Các lô (StockLot) là phần tồn có truy vết lô; phần còn lại
(stock - tổng các lô) là "tồn không theo lô" (dữ liệu cũ hoặc điều chỉnh tay).
Mọi biến động đều ghi StockMovement (thẻ kho).
"""
from django.db import transaction
from django.db.models import F, Sum
from django.utils import timezone
from rest_framework import serializers

from .models import Medicine, PurchaseOrder, PurchaseOrderLine, StockCount, StockCountLine, StockLot, StockMovement


def _lock(med):
    return Medicine.objects.select_for_update().get(pk=med.pk)


def unlotted_qty(med):
    return med.stock - (med.lots.aggregate(s=Sum('quantity'))['s'] or 0)


def _log(med, kind, delta, user, reference='', note='', lot=None, unit_cost=0):
    return StockMovement.objects.create(medicine=med, kind=kind, quantity=delta, balance_after=med.stock, reference=reference,
                                        note=(note or '')[:255], by=user, lot=lot, unit_cost=unit_cost or 0)


@transaction.atomic
def receive_lot(med, qty, user, *, lot_no='', expiry=None, cost=None, supplier=None, reference='', note='', kind=StockMovement.IN):
    if qty <= 0:
        raise serializers.ValidationError({'detail': 'Số lượng nhập phải lớn hơn 0.'})
    med = _lock(med)
    cost = med.cost if cost in (None, '') else max(int(cost), 0)
    lot = StockLot.objects.create(medicine=med, lot_no=(lot_no or '')[:40], expiry_date=expiry or None, quantity=qty, initial_qty=qty,
                                  unit_cost=cost, supplier=supplier, reference=reference[:40])
    med.stock += qty
    if cost:
        med.cost = cost
    med.save(update_fields=['stock', 'cost'])
    _log(med, kind, qty, user, reference, note, lot, cost)
    return med, lot


@transaction.atomic
def consume(med, qty, kind, user, reference='', note=''):
    """Xuất kho theo FEFO: lô hết hạn sớm nhất trước, lô không có hạn sau cùng, phần dư lấy từ tồn không theo lô."""
    if qty <= 0:
        return Medicine.objects.get(pk=med.pk)
    med = _lock(med)
    if med.stock < qty:
        raise serializers.ValidationError({'detail': f'Không đủ tồn kho "{med.name}" (còn {med.stock} {med.unit}).'})
    need = qty
    lots = list(med.lots.select_for_update().filter(quantity__gt=0).order_by(F('expiry_date').asc(nulls_last=True), 'id'))
    for lot in lots:
        if need <= 0:
            break
        take = min(lot.quantity, need)
        lot.quantity -= take
        lot.save(update_fields=['quantity'])
        med.stock -= take
        med.save(update_fields=['stock'])
        _log(med, kind, -take, user, reference, note, lot, lot.unit_cost)
        need -= take
    if need > 0:  # phần không theo lô
        med.stock -= need
        med.save(update_fields=['stock'])
        _log(med, kind, -need, user, reference, note, None, med.cost)
    return med


@transaction.atomic
def adjust_unlotted(med, delta, user, reference='', note=''):
    med = _lock(med)
    if med.stock + delta < 0:
        raise serializers.ValidationError({'detail': 'Tồn kho không được âm.'})
    med.stock += delta
    med.save(update_fields=['stock'])
    _log(med, StockMovement.ADJUST, delta, user, reference, note, None, med.cost)
    return med


@transaction.atomic
def scrap_lot(lot, qty, user, note=''):
    lot = StockLot.objects.select_for_update().get(pk=lot.pk)
    if qty <= 0 or qty > lot.quantity:
        raise serializers.ValidationError({'detail': 'Số lượng hủy không hợp lệ.'})
    med = _lock(lot.medicine)
    lot.quantity -= qty
    lot.save(update_fields=['quantity'])
    med.stock -= qty
    med.save(update_fields=['stock'])
    _log(med, StockMovement.SCRAP, -qty, user, f'Lô {lot.lot_no or lot.pk}', note or 'Hủy hàng', lot, lot.unit_cost)
    return med


# --------------------------------------------------------------------------- đơn nhập hàng
@transaction.atomic
def receive_order(order, user, lines):
    """lines: [{line_id, quantity, lot_no, expiry}] — nhận hàng (cho phép nhận từng phần)."""
    order = PurchaseOrder.objects.select_for_update().get(pk=order.pk)
    if order.status not in {PurchaseOrder.ORDERED, PurchaseOrder.PARTIAL}:
        raise serializers.ValidationError({'detail': 'Đơn này không ở trạng thái chờ nhận hàng.'})
    got = 0
    for row in lines:
        line = order.lines.select_for_update().filter(pk=row.get('line_id')).select_related('medicine').first()
        if not line:
            continue
        try:
            qty = int(row.get('quantity') or 0)
        except (TypeError, ValueError):
            qty = 0
        if qty <= 0:
            continue
        if qty > line.quantity - line.received_qty:
            raise serializers.ValidationError({'detail': f'"{line.medicine.name}": nhận vượt số lượng đặt.'})
        expiry = row.get('expiry') or None
        receive_lot(line.medicine, qty, user, lot_no=row.get('lot_no', ''), expiry=expiry, cost=line.unit_cost,
                    supplier=order.supplier, reference=order.code, note=f'Nhận hàng đơn {order.code}')
        line.received_qty += qty
        line.save(update_fields=['received_qty'])
        got += qty
    if not got:
        raise serializers.ValidationError({'detail': 'Chưa nhập số lượng nhận nào.'})
    done = not any(l.received_qty < l.quantity for l in order.lines.all())
    order.status = PurchaseOrder.RECEIVED if done else PurchaseOrder.PARTIAL
    if done:
        order.received_at = timezone.now()
    order.save()
    return order


# --------------------------------------------------------------------------- kiểm kho
@transaction.atomic
def start_count(user, note='', medicine_ids=None):
    count = StockCount.objects.create(created_by=user, note=note[:255])
    meds = Medicine.objects.filter(is_active=True)
    if medicine_ids:
        meds = meds.filter(pk__in=medicine_ids)
    for med in meds.order_by('name'):
        lots = list(med.lots.filter(quantity__gt=0))
        for lot in lots:
            StockCountLine.objects.create(count=count, medicine=med, lot=lot, expected_qty=lot.quantity)
        rest = med.stock - sum(l.quantity for l in lots)
        if rest > 0 or not lots:
            StockCountLine.objects.create(count=count, medicine=med, lot=None, expected_qty=max(rest, 0))
    return count


@transaction.atomic
def validate_count(count, user):
    count = StockCount.objects.select_for_update().get(pk=count.pk)
    if count.status != StockCount.DRAFT:
        raise serializers.ValidationError({'detail': 'Phiếu kiểm đã chốt hoặc đã hủy.'})
    lines = list(count.lines.select_related('medicine', 'lot'))
    if any(l.counted_qty is None for l in lines):
        raise serializers.ValidationError({'detail': 'Còn dòng chưa nhập số đếm thực tế.'})
    changed = 0
    for l in lines:
        med = _lock(l.medicine)
        if l.lot_id:
            lot = StockLot.objects.select_for_update().get(pk=l.lot_id)
            delta = l.counted_qty - lot.quantity
            if delta == 0:
                continue
            lot.quantity += delta
            lot.save(update_fields=['quantity'])
            med.stock += delta
            med.save(update_fields=['stock'])
            _log(med, StockMovement.ADJUST, delta, user, count.code, 'Kiểm kho', lot, lot.unit_cost)
        else:
            delta = l.counted_qty - max(unlotted_qty(med), 0)
            if delta == 0:
                continue
            if med.stock + delta < 0:
                raise serializers.ValidationError({'detail': f'"{med.name}": số đếm làm tồn âm.'})
            med.stock += delta
            med.save(update_fields=['stock'])
            _log(med, StockMovement.ADJUST, delta, user, count.code, 'Kiểm kho', None, med.cost)
        changed += 1
    count.status, count.validated_by, count.validated_at = StockCount.VALIDATED, user, timezone.now()
    count.save()
    return count, changed


@transaction.atomic
def restore(med, qty, kind, user, reference='', note=''):
    """Hoàn kho (hủy / giảm số lượng trên hóa đơn): trả lại đúng lô đã xuất, phần dư vào tồn không theo lô."""
    if qty <= 0:
        return Medicine.objects.get(pk=med.pk)
    med = _lock(med)
    need = qty
    taken = {}
    for m in StockMovement.objects.filter(medicine=med, reference=reference, kind=kind).exclude(lot__isnull=True):
        taken[m.lot_id] = taken.get(m.lot_id, 0) - m.quantity
    for lot_id, net in sorted(taken.items(), key=lambda kv: -kv[0]):
        if need <= 0:
            break
        give = min(max(net, 0), need)
        if give <= 0:
            continue
        lot = StockLot.objects.select_for_update().get(pk=lot_id)
        lot.quantity += give
        lot.save(update_fields=['quantity'])
        med.stock += give
        med.save(update_fields=['stock'])
        _log(med, kind, give, user, reference, note, lot, lot.unit_cost)
        need -= give
    if need > 0:
        med.stock += need
        med.save(update_fields=['stock'])
        _log(med, kind, need, user, reference, note, None, med.cost)
    return med
