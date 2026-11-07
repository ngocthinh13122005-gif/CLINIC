"""Nghiệp vụ kho thuốc theo lô (kiểu Odoo): nhập theo lô/hạn dùng, xuất FEFO, kiểm kho, hủy hàng.

Quy ước: Medicine.stock là tổng tồn. Các lô (StockLot) là phần tồn có truy vết lô; phần còn lại
(stock - tổng các lô) là "tồn không theo lô" (dữ liệu cũ hoặc điều chỉnh tay).
Mọi biến động đều ghi StockMovement (thẻ kho).
"""
from django.db import transaction
from django.db.models import F, Q, Sum
from django.utils import timezone
from rest_framework import serializers

from .models import (Medicine, PurchaseOrder, PurchaseOrderLine, StockCount, StockCountLine, StockLocation, StockLot,
                     StockMovement, StockTransfer)


def default_location():
    loc = StockLocation.objects.filter(is_default=True, is_active=True).first() or StockLocation.objects.filter(is_active=True).first()
    if not loc:
        loc = StockLocation.objects.create(code='KHO-CHINH', name='Kho chính', is_default=True)
    return loc


def lots_at(loc, qs=None):
    qs = StockLot.objects.all() if qs is None else qs
    condition = Q(location=loc)
    if loc.is_default:
        condition |= Q(location__isnull=True)
    return qs.filter(condition)


def _lock(med):
    return Medicine.objects.select_for_update().get(pk=med.pk)


def unlotted_qty(med):
    return med.stock - (med.lots.aggregate(s=Sum('quantity'))['s'] or 0)


def _log(med, kind, delta, user, reference='', note='', lot=None, unit_cost=0):
    return StockMovement.objects.create(medicine=med, kind=kind, quantity=delta, balance_after=med.stock, reference=reference,
                                        note=(note or '')[:255], by=user, lot=lot, unit_cost=unit_cost or 0)


@transaction.atomic
def receive_lot(med, qty, user, *, lot_no='', expiry=None, cost=None, supplier=None, reference='', note='',
                kind=StockMovement.IN, location=None):
    if qty <= 0:
        raise serializers.ValidationError({'detail': 'Số lượng nhập phải lớn hơn 0.'})
    from core.operational_settings import clinic_setting
    if clinic_setting('inventory.require_lot_number') and not str(lot_no or '').strip():
        raise serializers.ValidationError({'lot_no': 'Cấu hình phòng khám yêu cầu nhập số lô.'})
    if clinic_setting('inventory.require_expiry_date') and not expiry:
        raise serializers.ValidationError({'expiry': 'Cấu hình phòng khám yêu cầu nhập hạn dùng.'})
    med = _lock(med)
    cost = med.cost if cost in (None, '') else max(int(cost), 0)
    lot = StockLot.objects.create(medicine=med, lot_no=(lot_no or '')[:40], expiry_date=expiry or None, quantity=qty, initial_qty=qty,
                                  unit_cost=cost, supplier=supplier, reference=reference[:40], location=location or default_location())
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
                    supplier=order.supplier, reference=order.code, note=f'Nhận hàng đơn {order.code}', location=order.location)
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
def start_count(user, note='', medicine_ids=None, name='', location=None):
    count = StockCount.objects.create(created_by=user, note=note[:255], name=(name or '')[:120], location=location)
    meds = Medicine.objects.filter(is_active=True)
    if medicine_ids:
        meds = meds.filter(pk__in=medicine_ids)
    for med in meds.order_by('name'):
        all_lots = list(med.lots.filter(quantity__gt=0))
        lots = list(lots_at(location, med.lots.filter(quantity__gt=0))) if location else all_lots
        for lot in lots:
            StockCountLine.objects.create(count=count, medicine=med, lot=lot, expected_qty=lot.quantity)
        if location and not location.is_default:
            continue
        rest = med.stock - sum(l.quantity for l in all_lots)
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


# --------------------------------------------------------------------------- chuyển kho
def available_at(med, loc):
    qty = lots_at(loc, med.lots.all()).aggregate(s=Sum('quantity'))['s'] or 0
    return qty + (max(unlotted_qty(med), 0) if loc.is_default else 0)


def check_transfer(transfer):
    short = []
    for line in transfer.lines.select_related('medicine'):
        need = line.quantity - line.received_qty
        have = available_at(line.medicine, transfer.from_location)
        if need > have:
            short.append({'medicine': line.medicine.name, 'need': need, 'have': have})
    return short


@transaction.atomic
def send_transfer(transfer, user):
    transfer = StockTransfer.objects.select_for_update().get(pk=transfer.pk)
    if transfer.status != StockTransfer.DRAFT:
        raise serializers.ValidationError({'detail': 'Phiếu này đã được gửi hoặc đã đóng.'})
    if transfer.from_location_id == transfer.to_location_id:
        raise serializers.ValidationError({'detail': 'Kho gửi và kho nhận phải khác nhau.'})
    if not transfer.lines.exists():
        raise serializers.ValidationError({'detail': 'Phiếu chuyển chưa có mặt hàng nào.'})
    short = check_transfer(transfer)
    if short:
        item = short[0]
        raise serializers.ValidationError({'detail': f'Kho nguồn không đủ "{item["medicine"]}" (cần {item["need"]}, còn {item["have"]}).'})
    transfer.status, transfer.sent_at = StockTransfer.PENDING, timezone.now()
    transfer.save(update_fields=['status', 'sent_at'])
    return transfer


def _move_qty(med, qty, src, dst, user, code):
    need = qty
    lots = list(lots_at(src, med.lots.select_for_update().filter(quantity__gt=0))
                .order_by(F('expiry_date').asc(nulls_last=True), 'id'))
    for lot in lots:
        if need <= 0:
            break
        take = min(lot.quantity, need)
        lot.quantity -= take
        lot.save(update_fields=['quantity'])
        new = lots_at(dst, med.lots.select_for_update().filter(
            lot_no=lot.lot_no, expiry_date=lot.expiry_date, unit_cost=lot.unit_cost
        )).exclude(pk=lot.pk).first()
        if new:
            new.quantity += take
            new.initial_qty += take
            new.save(update_fields=['quantity', 'initial_qty'])
        else:
            new = StockLot.objects.create(
                medicine=med, lot_no=lot.lot_no, expiry_date=lot.expiry_date, quantity=take,
                initial_qty=take, unit_cost=lot.unit_cost, supplier=lot.supplier,
                reference=code[:40], location=dst, received_at=lot.received_at,
            )
        _log(med, StockMovement.TRANSFER, -take, user, code, f'Chuyển {src.name} → {dst.name}', lot, lot.unit_cost)
        _log(med, StockMovement.TRANSFER, take, user, code, f'Chuyển {src.name} → {dst.name}', new, lot.unit_cost)
        need -= take
    if need > 0 and src.is_default:
        take = min(max(unlotted_qty(med), 0), need)
        if take:
            new = StockLot.objects.create(
                medicine=med, lot_no='', quantity=take, initial_qty=take,
                unit_cost=med.cost, reference=code[:40], location=dst,
            )
            _log(med, StockMovement.TRANSFER, take, user, code, f'Chuyển {src.name} → {dst.name}', new, med.cost)
            need -= take
    if need > 0:
        raise serializers.ValidationError({'detail': f'Kho nguồn không đủ "{med.name}" để chuyển.'})


@transaction.atomic
def receive_transfer(transfer, user, rows=None):
    transfer = StockTransfer.objects.select_for_update().get(pk=transfer.pk)
    if transfer.status not in {StockTransfer.PENDING, StockTransfer.PARTIAL}:
        raise serializers.ValidationError({'detail': 'Phiếu này không ở trạng thái chờ nhận.'})
    wanted = {int(row['line_id']): int(row.get('quantity') or 0) for row in (rows or [])
              if row.get('line_id') is not None}
    received = 0
    for line in transfer.lines.select_related('medicine'):
        left = line.quantity - line.received_qty
        qty = wanted.get(line.id, left) if rows else left
        if qty <= 0:
            continue
        if qty > left:
            raise serializers.ValidationError({'detail': f'"{line.medicine.name}": nhận vượt số lượng chuyển.'})
        _move_qty(line.medicine, qty, transfer.from_location, transfer.to_location, user, transfer.code)
        line.received_qty += qty
        line.save(update_fields=['received_qty'])
        received += qty
    if not received:
        raise serializers.ValidationError({'detail': 'Chưa nhập số lượng nhận nào.'})
    done = not any(line.received_qty < line.quantity for line in transfer.lines.all())
    transfer.status = StockTransfer.RECEIVED if done else StockTransfer.PARTIAL
    if done:
        transfer.received_at = timezone.now()
    transfer.save(update_fields=['status', 'received_at'])
    return transfer
