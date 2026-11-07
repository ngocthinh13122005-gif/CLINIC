from django.utils import timezone
from rest_framework import serializers

from core.models import Booking, Service
from .models import (Icd10Code, LesionMark, MedicalRecord, Patient, PatientImage, RecordAddendum,
                     TreatmentPlan, TreatmentSession, Visit)
from .permissions import CLINICAL_READ, CLINICAL_WRITE


def uname(u):
    return (u.get_full_name() or u.username) if u else ''


# Vai trò chỉ cần biết để phục vụ khách, không cần số điện thoại đầy đủ / CCCD của bệnh nhân.
MASKED_ROLES = {'staff'}


def mask_phone(v):
    v = v or ''
    return v if len(v) < 7 else v[:3] + '*' * (len(v) - 6) + v[-3:]


def maybe_mask(phone, request):
    u = getattr(request, 'user', None)
    return mask_phone(phone) if u is not None and getattr(u, 'role', None) in MASKED_ROLES else phone


class PatientSerializer(serializers.ModelSerializer):
    age = serializers.IntegerField(read_only=True)
    gender_label = serializers.CharField(source='get_gender_display', read_only=True)
    visit_count = serializers.IntegerField(read_only=True, required=False)
    last_visit = serializers.DateTimeField(read_only=True, required=False)

    class Meta:
        model = Patient
        fields = ('id', 'code', 'full_name', 'gender', 'gender_label', 'date_of_birth', 'age', 'phone', 'email',
                  'national_id', 'address', 'occupation', 'referral_source', 'emergency_contact', 'allergies',
                  'skin_type', 'chronic_conditions', 'current_medications', 'family_history', 'skin_history',
                  'pregnancy_status', 'clinical_notes', 'is_active', 'created_at', 'visit_count', 'last_visit')
        read_only_fields = ('code', 'created_at')

    def _can_clinical(self):
        r = self.context.get('request')
        return bool(r and r.user.is_authenticated and r.user.role in CLINICAL_READ)

    def to_representation(self, obj):
        data = super().to_representation(obj)
        if not self._can_clinical():
            for f in Patient.CLINICAL_FIELDS:
                data.pop(f, None)
        r = self.context.get('request')
        if r and r.user.is_authenticated and r.user.role in MASKED_ROLES:
            data['phone'] = mask_phone(data.get('phone'))
            data['national_id'] = ''
            data['email'] = ''
            data['address'] = ''
            data['phone_masked'] = True
        return data

    def validate(self, attrs):
        r = self.context.get('request')
        if r and r.user.role not in CLINICAL_READ:
            for f in Patient.CLINICAL_FIELDS:
                attrs.pop(f, None)
        return attrs

    def validate_phone(self, v):
        v = ''.join(ch for ch in (v or '') if ch.isdigit() or ch == '+')
        if len(v) < 8:
            raise serializers.ValidationError('Số điện thoại không hợp lệ.')
        return v


class PatientBriefSerializer(serializers.ModelSerializer):
    age = serializers.IntegerField(read_only=True)

    class Meta:
        model = Patient
        fields = ('id', 'code', 'full_name', 'gender', 'age', 'phone', 'allergies', 'date_of_birth')

    def to_representation(self, obj):
        data = super().to_representation(obj)
        r = self.context.get('request')
        if r and r.user.is_authenticated and r.user.role in MASKED_ROLES:
            data['phone'] = mask_phone(data.get('phone'))
        return data


class VisitSerializer(serializers.ModelSerializer):
    patient_detail = PatientBriefSerializer(source='patient', read_only=True)
    doctor_name = serializers.SerializerMethodField()
    attended_by_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    visit_type_label = serializers.CharField(source='get_visit_type_display', read_only=True)
    source_label = serializers.CharField(source='get_source_display', read_only=True)
    record_id = serializers.SerializerMethodField()
    record_status = serializers.SerializerMethodField()
    waiting_minutes = serializers.SerializerMethodField()
    room_name = serializers.CharField(source='room.name', read_only=True, default='')
    active_plans = serializers.SerializerMethodField()
    treatment_session = serializers.PrimaryKeyRelatedField(queryset=TreatmentSession.objects.select_related('plan__patient'),
                                                            required=False, allow_null=True)

    class Meta:
        model = Visit
        fields = ('id', 'patient', 'patient_detail', 'booking', 'source', 'source_label', 'visit_type',
                  'visit_type_label', 'reason', 'status', 'status_label', 'doctor', 'doctor_name', 'attended_by_name',
                  'ticket_no', 'check_in_at', 'called_at', 'finished_at', 'note', 'record_id', 'record_status',
                  'waiting_minutes', 'room', 'room_name', 'active_plans', 'treatment_session')
        read_only_fields = ('booking', 'source', 'status', 'ticket_no', 'check_in_at', 'called_at', 'finished_at')

    def get_doctor_name(self, o):
        return uname(o.doctor)

    def get_attended_by_name(self, o):
        return uname(o.attended_by)

    def _rec(self, o):
        try:
            return o.record
        except MedicalRecord.DoesNotExist:
            return None

    def get_record_id(self, o):
        r = self._rec(o)
        return r.id if r else None

    def get_record_status(self, o):
        r = self._rec(o)
        return r.status if r else None

    def get_active_plans(self, o):
        return [
            {'id': plan.id, 'title': plan.title, 'done': plan.done_sessions, 'total': plan.total_sessions,
             'status_label': plan.get_status_display()}
            for plan in o.patient.plans.filter(status=TreatmentPlan.ACTIVE).only('id', 'title', 'total_sessions', 'status')
        ]

    def validate_treatment_session(self, session):
        if session and session.plan.patient_id != self.initial_data.get('patient'):
            raise serializers.ValidationError('Buổi liệu trình không thuộc bệnh nhân đã chọn.')
        if session and session.status != TreatmentSession.PENDING:
            raise serializers.ValidationError('Buổi liệu trình này đã được ghi nhận hoặc bỏ qua.')
        if session and session.plan.status != TreatmentPlan.ACTIVE:
            raise serializers.ValidationError('Liệu trình chưa được kích hoạt hoặc đã kết thúc.')
        if session and hasattr(session, 'visit'):
            raise serializers.ValidationError('Buổi liệu trình đã có lượt tiếp đón.')
        return session

    def get_waiting_minutes(self, o):
        if o.status != Visit.WAITING:
            return None
        return max(0, int((timezone.now() - o.check_in_at).total_seconds() // 60))


class LesionMarkSerializer(serializers.ModelSerializer):
    region_label = serializers.SerializerMethodField()
    lesion_label = serializers.CharField(source='get_lesion_type_display', read_only=True)

    class Meta:
        model = LesionMark
        fields = ('id', 'region', 'region_label', 'lesion_type', 'lesion_label', 'severity', 'note')

    def get_region_label(self, o):
        return o.get_region_display()

    def validate_severity(self, v):
        if not 1 <= v <= 3:
            raise serializers.ValidationError('Mức độ từ 1 đến 3.')
        return v


class AddendumSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = RecordAddendum
        fields = ('id', 'content', 'author_name', 'created_at')

    def get_author_name(self, o):
        return uname(o.author)


class MedicalRecordSerializer(serializers.ModelSerializer):
    marks = LesionMarkSerializer(many=True, required=False)
    addenda = AddendumSerializer(many=True, read_only=True)
    doctor_name = serializers.SerializerMethodField()
    signed_by_name = serializers.SerializerMethodField()
    patient_detail = PatientBriefSerializer(source='patient', read_only=True)
    visit_date = serializers.DateTimeField(source='visit.check_in_at', read_only=True)
    locked = serializers.BooleanField(read_only=True)

    class Meta:
        model = MedicalRecord
        fields = ('id', 'code', 'visit', 'visit_date', 'patient', 'patient_detail', 'doctor', 'doctor_name',
                  'chief_complaint', 'history_present', 'previous_treatment', 'examination', 'diagnosis_code',
                  'diagnosis_name', 'secondary_diagnoses', 'differential', 'treatment_direction', 'advice',
                  'follow_up_date', 'status', 'locked', 'signed_at', 'signed_by_name', 'signature_hash', 'marks',
                  'addenda', 'created_at', 'updated_at')
        read_only_fields = ('code', 'visit', 'patient', 'doctor', 'status', 'signed_at', 'signature_hash', 'created_at',
                            'updated_at')

    def get_doctor_name(self, o):
        return uname(o.doctor)

    def get_signed_by_name(self, o):
        return uname(o.signed_by)

    def validate_secondary_diagnoses(self, v):
        if not isinstance(v, list):
            raise serializers.ValidationError('Định dạng không hợp lệ.')
        return [{'code': str(x.get('code', ''))[:12], 'name': str(x.get('name', ''))[:255]} for x in v if isinstance(x, dict)]

    def update(self, instance, validated):
        marks = validated.pop('marks', None)
        for k, v in validated.items():
            setattr(instance, k, v)
        instance.save()
        if marks is not None:
            instance.marks.all().delete()
            LesionMark.objects.bulk_create([LesionMark(record=instance, **m) for m in marks])
        return instance


class RecordSummarySerializer(serializers.ModelSerializer):
    """Bản rút gọn dùng cho lịch sử khám."""
    doctor_name = serializers.SerializerMethodField()
    visit_date = serializers.DateTimeField(source='visit.check_in_at', read_only=True)
    mark_count = serializers.SerializerMethodField()

    class Meta:
        model = MedicalRecord
        fields = ('id', 'code', 'visit', 'visit_date', 'doctor_name', 'chief_complaint', 'diagnosis_code',
                  'diagnosis_name', 'status', 'follow_up_date', 'mark_count')

    def get_doctor_name(self, o):
        return uname(o.doctor)

    def get_mark_count(self, o):
        return o.marks.count()


class Icd10Serializer(serializers.ModelSerializer):
    class Meta:
        model = Icd10Code
        fields = ('id', 'code', 'name', 'group')


class TreatmentSessionSerializer(serializers.ModelSerializer):
    performed_by_name = serializers.SerializerMethodField()
    has_active_booking = serializers.SerializerMethodField()
    visit_id = serializers.SerializerMethodField()
    record_id = serializers.IntegerField(read_only=True)
    record_code = serializers.CharField(source='record.code', read_only=True, default='')
    booking_label = serializers.SerializerMethodField()
    booking_at = serializers.DateTimeField(source='booking.appointment', read_only=True)

    class Meta:
        model = TreatmentSession
        fields = (
            'id', 'number', 'planned_date', 'performed_at', 'performed_by_name',
            'status', 'content', 'procedures', 'parameters', 'patient_response', 'adverse_reactions', 'outcome',
            'allow_staff_delegation', 'has_active_booking', 'visit_id', 'record_id', 'record_code',
            'booking', 'booking_label', 'booking_at',
        )

    def get_performed_by_name(self, o):
        return uname(o.performed_by)

    def get_has_active_booking(self, o):
        return any(booking.status in Booking.ACTIVE_STATUSES for booking in o.bookings.all())

    def get_visit_id(self, o):
        try:
            return o.visit.id
        except Visit.DoesNotExist:
            return None

    def get_booking_label(self, o):
        return o.booking.service_summary if o.booking_id and hasattr(o.booking, 'service_summary') else (
            o.booking.get_appointment_type_display() if o.booking_id else ''
        )


class TreatmentPlanSerializer(serializers.ModelSerializer):
    sessions = TreatmentSessionSerializer(many=True, read_only=True)
    doctor_name = serializers.SerializerMethodField()
    service_name = serializers.CharField(source='service.name', read_only=True, default='')
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    done_sessions = serializers.IntegerField(read_only=True)
    patient_name = serializers.CharField(source='patient.full_name', read_only=True)
    record_code = serializers.CharField(source='record.code', read_only=True, default='')
    record_status = serializers.CharField(source='record.status', read_only=True, default='')
    package_invoice = serializers.SerializerMethodField()
    display_status = serializers.SerializerMethodField()
    display_status_label = serializers.SerializerMethodField()
    value_each = serializers.SerializerMethodField()
    invoice_code = serializers.CharField(source='invoice.code', read_only=True, default='')

    class Meta:
        model = TreatmentPlan
        fields = ('id', 'patient', 'patient_name', 'record', 'doctor', 'doctor_name', 'service', 'service_name', 'title',
                  'diagnosis', 'content', 'total_sessions', 'interval_days', 'price', 'status', 'status_label',
                  'start_date', 'note', 'created_at', 'done_sessions', 'sessions', 'record_code', 'record_status',
                  'package_invoice', 'code', 'expires_at', 'invoice', 'invoice_code', 'template', 'display_status',
                  'display_status_label', 'value_each')
        read_only_fields = (
            'doctor', 'created_at', 'status', 'code', 'expires_at', 'invoice', 'invoice_code',
            'display_status', 'display_status_label', 'value_each',
        )

    def get_doctor_name(self, o):
        return uname(o.doctor)

    def get_package_invoice(self, o):
        invoice = o.package_invoices.exclude(status='void').order_by('-created_at', '-id').first()
        if not invoice:
            return None
        return {'id': invoice.id, 'code': invoice.code, 'status': invoice.status,
                'status_label': invoice.get_status_display(), 'total': invoice.total,
                'paid': invoice.paid, 'balance': invoice.balance}

    def get_display_status(self, o):
        if o.status in {TreatmentPlan.ACTIVE, TreatmentPlan.DRAFT} and o.expires_at and o.expires_at < timezone.localdate():
            return TreatmentPlan.EXPIRED
        return o.status

    def get_display_status_label(self, o):
        status = self.get_display_status(o)
        return dict(TreatmentPlan.STATUS).get(status, status)

    def get_value_each(self, o):
        return round(o.price / o.total_sessions) if o.total_sessions else 0

    def validate_total_sessions(self, v):
        if not 1 <= v <= 60:
            raise serializers.ValidationError('Số buổi từ 1 đến 60.')
        return v


class PatientImageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)
    region_label = serializers.SerializerMethodField()

    class Meta:
        model = PatientImage
        fields = ('id', 'patient', 'visit', 'image', 'url', 'kind', 'kind_label', 'region', 'region_label', 'caption',
                  'taken_at', 'created_at')
        read_only_fields = ('created_at',)
        extra_kwargs = {'image': {'write_only': True}}

    def get_url(self, o):
        try:
            return o.image.url
        except Exception:
            return ''

    def get_region_label(self, o):
        return o.get_region_display() if o.region else ''
