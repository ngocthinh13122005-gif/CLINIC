import re

from rest_framework import serializers

from .models import (Invoice, InvoiceItem, Medicine, Payment, Prescription, PrescriptionItem, StockMovement)
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
        fields = ('id', 'kind', 'name', 'medicine', 'service', 'quantity', 'unit_price', 'amount')


class PaymentSerializer(serializers.ModelSerializer):
    method_label = serializers.CharField(source='get_method_display', read_only=True)
    received_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = ('id', 'amount', 'method', 'method_label', 'reference', 'note', 'received_by_name', 'paid_at')

    def get_received_by_name(self, o):
        return uname(o.received_by)


class InvoiceSerializer(serializers.ModelSerializer):
    items = InvoiceItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    patient_name = serializers.CharField(source='patient.full_name', read_only=True)
    patient_code = serializers.CharField(source='patient.code', read_only=True)
    patient_phone = serializers.CharField(source='patient.phone', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    balance = serializers.IntegerField(read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = ('id', 'code', 'patient', 'patient_name', 'patient_code', 'patient_phone', 'visit', 'status', 'status_label',
                  'subtotal', 'discount', 'total', 'paid', 'balance', 'note', 'void_reason', 'created_by_name', 'created_at',
                  'items', 'payments', 'buyer_name', 'buyer_tax_code', 'buyer_address', 'buyer_email', 'einvoice_status',
                  'einvoice_symbol', 'einvoice_no', 'einvoice_lookup', 'einvoice_at')

    def get_created_by_name(self, o):
        return uname(o.created_by)
