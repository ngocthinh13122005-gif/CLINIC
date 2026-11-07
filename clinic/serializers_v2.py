import re

from rest_framework import serializers

from .models import (CashierShift, DebtFollowUp, Invoice, InvoiceItem, Medicine, Payment, Prescription,
                     PrescriptionItem, Refund, StockMovement)
from .serializers import uname


class MedicineSerializer(serializers.ModelSerializer):
    low_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = Medicine
        fields = ('id', 'code', 'name', 'active_ingredient', 'strength', 'form', 'unit', 'default_usage', 'price', 'cost',
                  'stock', 'min_stock', 'is_prescription', 'is_controlled', 'is_active', 'low_stock')
        read_only_fields = ('code', 'stock')  # tồn kho chỉ đổi qua nhập kho / kiểm kê / bán hàng

    def to_representation(self, inst):
        d = super().to_representation(inst)
        r = self.context.get('request')
        if not (r and r.user.role in {'manager', 'sysadmin'}):
            d.pop('cost', None)
        return d


class StockMovementSerializer(serializers.ModelSerializer):
    by_name = serializers.SerializerMethodField()
    medicine_name = serializers.CharField(source='medicine.name', read_only=True)
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)

    class Meta:
        model = StockMovement
        fields = ('id', 'medicine', 'medicine_name', 'kind', 'kind_label', 'quantity', 'balance_after', 'reference',
                  'note', 'by_name', 'created_at')

    def get_by_name(self, o):
        return uname(o.by)


class PrescriptionItemSerializer(serializers.ModelSerializer):
    medicine_name = serializers.CharField(source='medicine.name', read_only=True)
    unit = serializers.CharField(source='medicine.unit', read_only=True)
    strength = serializers.CharField(source='medicine.strength', read_only=True)
    stock = serializers.IntegerField(source='medicine.stock', read_only=True)

    class Meta:
        model = PrescriptionItem
        fields = ('id', 'medicine', 'medicine_name', 'unit', 'strength', 'stock', 'quantity', 'dosage', 'usage', 'days', 'unit_price')
        read_only_fields = ('unit_price',)


def allergy_hits(patient, items):
    """Cảnh báo đơn giản: tên thuốc / hoạt chất trùng từ khóa trong mục dị ứng của bệnh nhân."""
    text = (patient.allergies or '').lower()
    if not text.strip():
        return []
    tokens = {t for t in re.split(r'[\s,;/.()+\-]+', text) if len(t) >= 4}
    hits = []
    for it in items:
        m = it.medicine
        hay = f'{m.name} {m.active_ingredient}'.lower()
        if any(t in hay for t in tokens):
            hits.append({'medicine': m.name, 'allergies': patient.allergies})
    return hits


class PrescriptionSerializer(serializers.ModelSerializer):
    items = PrescriptionItemSerializer(many=True, read_only=True)
    doctor_name = serializers.SerializerMethodField()
    patient_name = serializers.CharField(source='patient.full_name', read_only=True)
    patient_code = serializers.CharField(source='patient.code', read_only=True)
    allergy_warnings = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    visit_status = serializers.CharField(source='visit.status', read_only=True)

    class Meta:
        model = Prescription
        fields = ('id', 'code', 'visit', 'visit_status', 'patient', 'patient_name', 'patient_code', 'doctor', 'doctor_name',
                  'diagnosis', 'advice', 'status', 'issued_at', 'created_at', 'items', 'allergy_warnings', 'total',
                  'patient_national_id', 'patient_address', 'age_months', 'weight_kg', 'guardian_name', 'national_status', 'national_code')

    def get_doctor_name(self, o):
        return uname(o.doctor)

    def get_allergy_warnings(self, o):
        return allergy_hits(o.patient, o.items.select_related('medicine'))

    def get_total(self, o):
        return sum(i.quantity * i.unit_price for i in o.items.all())


class InvoiceItemSerializer(serializers.ModelSerializer):
    amount = serializers.IntegerField(read_only=True)

    class Meta:
        model = InvoiceItem
        fields = ('id', 'kind', 'name', 'medicine', 'service', 'package_template', 'quantity', 'unit_price', 'amount')


class PaymentSerializer(serializers.ModelSerializer):
    method_label = serializers.CharField(source='get_method_display', read_only=True)
    reconciliation_label = serializers.CharField(source='get_reconciliation_status_display', read_only=True)
    received_by_name = serializers.SerializerMethodField()
    invoice_code = serializers.CharField(source='invoice.code', read_only=True)
    patient_name = serializers.CharField(source='invoice.patient.full_name', read_only=True)

    class Meta:
        model = Payment
        fields = ('id', 'invoice_code', 'patient_name', 'amount', 'method', 'method_label', 'reference', 'note',
                  'received_by_name', 'paid_at', 'shift', 'reconciliation_status', 'reconciliation_label', 'reconciled_at')

    def get_received_by_name(self, o):
        return uname(o.received_by)


class RefundSerializer(serializers.ModelSerializer):
    method_label = serializers.CharField(source='get_method_display', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Refund
        fields = ('id', 'invoice', 'amount', 'method', 'method_label', 'reason', 'status', 'status_label',
                  'reference', 'requested_by_name', 'approved_by_name', 'created_at', 'approved_at', 'completed_at')

    def get_requested_by_name(self, o):
        return uname(o.requested_by)

    def get_approved_by_name(self, o):
        return uname(o.approved_by)


class DebtFollowUpSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source='get_action_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DebtFollowUp
        fields = ('id', 'invoice', 'action', 'action_label', 'note', 'promised_date', 'next_follow_up',
                  'created_by_name', 'created_at')

    def get_created_by_name(self, o):
        return uname(o.created_by)


class CashierShiftSerializer(serializers.ModelSerializer):
    cashier_name = serializers.SerializerMethodField()
    closed_by_name = serializers.SerializerMethodField()
    cash_received = serializers.SerializerMethodField()
    cash_refunded = serializers.SerializerMethodField()
    current_expected = serializers.SerializerMethodField()

    class Meta:
        model = CashierShift
        fields = ('id', 'cashier', 'cashier_name', 'status', 'opening_cash', 'expected_cash', 'counted_cash',
                  'difference', 'note', 'opened_at', 'closed_at', 'closed_by_name', 'cash_received', 'cash_refunded',
                  'current_expected')

    def get_cashier_name(self, o):
        return uname(o.cashier)

    def get_closed_by_name(self, o):
        return uname(o.closed_by)

    def get_cash_received(self, o):
        return sum(p.amount for p in o.payments.all() if p.method == Payment.CASH)

    def get_cash_refunded(self, o):
        return sum(r.amount for r in o.refunds.all() if r.method == Payment.CASH and r.status == Refund.COMPLETED)

    def get_current_expected(self, o):
        return max(o.opening_cash + self.get_cash_received(o) - self.get_cash_refunded(o), 0)


class InvoiceSerializer(serializers.ModelSerializer):
    items = InvoiceItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    patient_name = serializers.CharField(source='patient.full_name', read_only=True)
    patient_code = serializers.CharField(source='patient.code', read_only=True)
    patient_phone = serializers.CharField(source='patient.phone', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    balance = serializers.IntegerField(read_only=True)
    created_by_name = serializers.SerializerMethodField()
    payment_term_label = serializers.CharField(source='get_payment_term_display', read_only=True)
    due_status = serializers.CharField(read_only=True)
    overdue_days = serializers.IntegerField(read_only=True)
    refunds = RefundSerializer(many=True, read_only=True)
    followups = DebtFollowUpSerializer(many=True, read_only=True)
    refunded = serializers.SerializerMethodField()
    treatment_plan_title = serializers.CharField(source='treatment_plan.title', read_only=True, default='')

    class Meta:
        model = Invoice
        fields = ('id', 'code', 'patient', 'patient_name', 'patient_code', 'patient_phone', 'visit', 'status', 'status_label',
                  'subtotal', 'discount', 'total', 'paid', 'balance', 'payment_term', 'payment_term_label', 'due_date',
                  'due_status', 'overdue_days', 'note', 'void_reason', 'created_by_name', 'created_at',
                  'items', 'payments', 'treatment_plan', 'treatment_plan_title', 'buyer_name', 'buyer_tax_code', 'buyer_address', 'buyer_email', 'einvoice_status',
                  'einvoice_symbol', 'einvoice_no', 'einvoice_lookup', 'einvoice_at', 'refunds', 'followups', 'refunded')

    def get_created_by_name(self, o):
        return uname(o.created_by)

    def get_refunded(self, o):
        return sum(r.amount for r in o.refunds.all() if r.status == Refund.COMPLETED)
