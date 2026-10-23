from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Avg, Count, F, Max, Q
from django.utils import timezone
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from api.events import notify_users
from core.models import Booking
from .audit import audit
from .constants import FITZPATRICK, LESION_TYPES, REGIONS
from .models import (Icd10Code, MedicalRecord, Patient, PatientImage, RecordAddendum, Room, TreatmentPlan,
                     TreatmentSession, Visit)
from .permissions import (CLINICAL_READ, CLINICAL_WRITE, CanReadClinical, CanReception, CanWriteClinical,
                          IsClinicStaff)
from .serializers import (AddendumSerializer, Icd10Serializer, MedicalRecordSerializer, PatientImageSerializer,
                          PatientSerializer, RecordSummarySerializer, TreatmentPlanSerializer, VisitSerializer, uname)

User = get_user_model()


def norm_phone(v):
    return ''.join(ch for ch in (v or '') if ch.isdigit() or ch == '+')


def deny(msg, code=403):
    return Response({'detail': msg}, status=code)


# --------------------------------------------------------------------------- bệnh nhân
class PatientViewSet(viewsets.ModelViewSet):
    serializer_class = PatientSerializer

    def get_permissions(self):
        if self.action in {'list', 'retrieve', 'summary', 'history'}:
            return [IsClinicStaff()]
        if self.action == 'destroy':
            return [permissions.IsAuthenticated(), _ManagerOnly()]
        return [CanReception()]

    def get_queryset(self):
        qs = Patient.objects.annotate(visit_count=Count('visits', distinct=True), last_visit=Max('visits__check_in_at'))
        p = self.request.query_params
        q = (p.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(full_name__icontains=q) | Q(phone__icontains=norm_phone(q) or q) | Q(code__icontains=q)
                           | Q(national_id__icontains=q))
        if p.get('active', '1') == '1':
            qs = qs.filter(is_active=True)
        return qs.order_by('-last_visit', '-created_at')

    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        try:
            limit = min(max(int(request.query_params.get('limit', 100)), 1), 300)
        except ValueError:
            limit = 100
        total = qs.count()
        resp = Response(self.get_serializer(qs[:limit], many=True).data)
        resp['X-Total-Count'] = str(total)
        return resp

    def perform_create(self, serializer):
        name = serializer.validated_data['full_name'].strip()
        phone = serializer.validated_data['phone']
        dup = Patient.objects.filter(phone=phone, full_name__iexact=name, is_active=True).first()
        if dup:
            raise serializers.ValidationError({'detail': f'Bệnh nhân đã có hồ sơ ({dup.code}).', 'existing_id': dup.pk})
        obj = serializer.save(created_by=self.request.user, full_name=name)
        audit(self.request.user, 'patient.create', f'{obj.code} {obj.full_name}')

    def perform_update(self, serializer):
        obj = serializer.save()
        audit(self.request.user, 'patient.update', f'{obj.code} {obj.full_name}')

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=['is_active'])
        audit(self.request.user, 'patient.archive', instance.code)

    def retrieve(self, request, *args, **kwargs):
        resp = super().retrieve(request, *args, **kwargs)
        audit(request.user, 'patient.view', f'#{kwargs.get("pk")}')
        return resp

    @action(detail=True, methods=['get'])
    def summary(self, request, pk=None):
        p = self.get_object()
        now = timezone.now()
        upcoming = Booking.objects.filter(patient=p, appointment__gte=now).exclude(status=Booking.CANCELLED)
        data = {
            'visit_count': p.visits.exclude(status=Visit.CANCELLED).count(),
            'last_visit': p.visits.exclude(status=Visit.CANCELLED).order_by('-check_in_at').values_list('check_in_at', flat=True).first(),
            'upcoming': [{'id': b.id, 'appointment': b.appointment, 'type': b.get_appointment_type_display(),
                          'doctor': b.staff.name if b.staff else '', 'status': b.status}
                         for b in upcoming.select_related('staff').order_by('appointment')[:5]],
            'active_visit': None,
        }
        av = p.visits.filter(status__in=[Visit.WAITING, Visit.IN_CONSULT]).first()
        if av:
            data['active_visit'] = {'id': av.id, 'status': av.status, 'status_label': av.get_status_display()}
        if request.user.role in CLINICAL_READ | {'staff'}:
            plans = p.plans.filter(status=TreatmentPlan.ACTIVE)
            data['active_plans'] = [{'id': x.id, 'title': x.title, 'done': x.done_sessions, 'total': x.total_sessions} for x in plans]
        else:
            data['active_plans'] = []
        return Response(data)

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        p = self.get_object()
        visits = p.visits.select_related('doctor', 'patient').order_by('-check_in_at')
        clinical = request.user.role in CLINICAL_READ
        out = []
        for v in visits:
            row = VisitSerializer(v, context={'request': request}).data
            row['record'] = None
            if clinical:
                try:
                    row['record'] = RecordSummarySerializer(v.record).data
                except MedicalRecord.DoesNotExist:
                    pass
            out.append(row)
        return Response(out)


class _ManagerOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.role in {'manager', 'sysadmin'}


# --------------------------------------------------------------------------- lượt khám / tiếp đón
class VisitViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                   mixins.UpdateModelMixin, viewsets.GenericViewSet):
    serializer_class = VisitSerializer

    def get_permissions(self):
        if self.action in {'list', 'retrieve', 'board'}:
            return [IsClinicStaff()]
        if self.action == 'record':
            return [CanReadClinical()] if self.request.method == 'GET' else [CanWriteClinical()]
        return [CanReception()]

    def get_queryset(self):
        qs = Visit.objects.select_related('patient', 'doctor', 'attended_by', 'record')
        u = self.request.user
        if u.role == 'doctor':
            qs = qs.filter(Q(doctor=u) | Q(doctor__isnull=True))
        p = self.request.query_params
        if p.get('date'):
            qs = qs.filter(check_in_at__date=p['date'])
        if p.get('status'):
            qs = qs.filter(status__in=p['status'].split(','))
        if p.get('patient'):
            qs = qs.filter(patient_id=p['patient'])
        return qs

    def _check_doctor(self, doctor):
        if doctor and doctor.role != 'doctor':
            raise serializers.ValidationError({'doctor': 'Người được chọn không phải bác sĩ.'})

    def perform_create(self, serializer):
        patient = serializer.validated_data['patient']
        if Visit.objects.filter(patient=patient, status__in=[Visit.WAITING, Visit.IN_CONSULT]).exists():
            raise serializers.ValidationError({'detail': 'Bệnh nhân này đang có một lượt khám chưa kết thúc.'})
        self._check_doctor(serializer.validated_data.get('doctor'))
        v = serializer.save(attended_by=self.request.user)
        audit(self.request.user, 'visit.checkin', f'#{v.pk} {patient.code}')
        self._notify_doctor(v, 'Có bệnh nhân đang chờ', f'{patient.full_name} vừa đến phòng khám.')

    def perform_update(self, serializer):
        self._check_doctor(serializer.validated_data.get('doctor'))
        serializer.save()

    def _notify_doctor(self, visit, title, msg):
        if visit.doctor:
            notify_users([visit.doctor], 'visit.update', title, msg, {'visit_id': visit.pk})

    @action(detail=True, methods=['post'])
    def call(self, request, pk=None):
        """Mời bệnh nhân từ sảnh vào tư vấn / khám."""
        v = self.get_object()
        if v.status != Visit.WAITING:
            return deny('Chỉ mời được bệnh nhân đang chờ ở sảnh.', 400)
        doc_id = request.data.get('doctor')
        doctor = User.objects.filter(pk=doc_id, role='doctor', is_active=True).first() if doc_id else None
        if doc_id and not doctor:
            return deny('Không tìm thấy bác sĩ.', 400)
        if not doctor and request.user.role == 'doctor':
            doctor = request.user
        if doctor:
            v.doctor = doctor
        if request.data.get('room'):
            room = Room.objects.filter(pk=request.data.get('room'), is_active=True).first()
            if not room:
                return deny('Không tìm thấy phòng.', 400)
            busy = Visit.objects.filter(room=room, status=Visit.IN_CONSULT).exclude(pk=v.pk).select_related('patient').first()
            if busy:
                return deny(f'{room.name} đang có bệnh nhân ({busy.patient.full_name}).', 400)
            v.room = room
        v.status = Visit.IN_CONSULT
        v.called_at = timezone.now()
        v.save()
        self._notify_doctor(v, 'Mời bệnh nhân vào khám', f'{v.patient.full_name} đã được mời vào.')
        return Response(self.get_serializer(v).data)

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        v = self.get_object()
        doctor = User.objects.filter(pk=request.data.get('doctor'), role='doctor', is_active=True).first()
        if not doctor:
            return deny('Vui lòng chọn bác sĩ.', 400)
        if v.status in {Visit.COMPLETED, Visit.CANCELLED}:
            return deny('Lượt khám đã kết thúc.', 400)
        v.doctor = doctor
        v.save(update_fields=['doctor'])
        self._notify_doctor(v, 'Bạn được phân công ca khám', f'Bệnh nhân {v.patient.full_name}.')
        return Response(self.get_serializer(v).data)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        v = self.get_object()
        if v.status != Visit.IN_CONSULT:
            return deny('Chỉ kết thúc được lượt khám đang tư vấn.', 400)
        rec = getattr(v, 'record', None) if hasattr(v, 'record') else None
        if rec and rec.status == MedicalRecord.DRAFT:
            return deny('Bệnh án chưa được bác sĩ ký — hãy ký trước khi kết thúc lượt khám.', 400)
        v.status = Visit.COMPLETED
        v.finished_at = timezone.now()
        v.save()
        if v.booking and v.booking.status != Booking.CANCELLED:
            v.booking.status = Booking.COMPLETED
            v.booking.save(update_fields=['status'])
        return Response(self.get_serializer(v).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        v = self.get_object()
        if v.status in {Visit.COMPLETED, Visit.CANCELLED}:
            return deny('Lượt khám đã kết thúc.', 400)
        if getattr(v, 'record', None) and v.record.status == MedicalRecord.SIGNED:
            return deny('Bệnh án đã ký, không thể hủy lượt khám.', 400)
        v.status = Visit.CANCELLED
        v.finished_at = timezone.now()
        v.note = (request.data.get('reason') or v.note)[:255]
        v.save()
        return Response(self.get_serializer(v).data)

    @action(detail=False, methods=['post'], url_path='from-booking')
    @transaction.atomic
    def from_booking(self, request):
        """Khách có lịch hẹn đến phòng khám → tiếp đón (tự tạo/liên kết hồ sơ bệnh nhân)."""
        try:
            b = Booking.objects.select_for_update().select_related('user', 'staff__user').get(pk=request.data.get('booking_id'))
        except (Booking.DoesNotExist, ValueError, TypeError):
            return deny('Không tìm thấy lịch hẹn.', 404)
        if b.status == Booking.CANCELLED:
            return deny('Lịch hẹn đã hủy.', 400)
        if Visit.objects.filter(booking=b).exists():
            return deny('Lịch hẹn này đã được tiếp đón.', 400)
        phone = norm_phone(b.customer_phone)
        patient = b.patient
        if not patient and b.user_id:
            patient = Patient.objects.filter(user=b.user).first()
        if not patient and phone:
            patient = Patient.objects.filter(phone=phone, is_active=True).first()
        if not patient:
            patient = Patient.objects.create(full_name=b.customer_name, phone=phone or '0000000000', email=b.customer_email,
                                             user=b.user if b.user_id and not hasattr(b.user, 'patient_profile') else None,
                                             created_by=request.user, referral_source='Đặt lịch online')
        if Visit.objects.filter(patient=patient, status__in=[Visit.WAITING, Visit.IN_CONSULT]).exists():
            return deny('Bệnh nhân đang có một lượt khám chưa kết thúc.', 400)
        doctor = b.staff.user if b.staff and b.staff.user and b.staff.user.role == 'doctor' else None
        vt = {'consult': Visit.NEW, 'follow_up': Visit.FOLLOW_UP, 'procedure': Visit.PROCEDURE, 'session': Visit.SESSION}.get(b.appointment_type, Visit.NEW)
        reason = ', '.join(i.service.name for i in b.items.select_related('service')) or b.note[:200]
        v = Visit.objects.create(patient=patient, booking=b, source=Visit.APPOINTMENT, visit_type=vt, doctor=doctor,
                                 reason=reason[:255], attended_by=request.user)
        b.patient = patient
        if b.status == Booking.PENDING:
            b.status = Booking.CONFIRMED
        b.save(update_fields=['patient', 'status'])
        audit(request.user, 'visit.checkin', f'#{v.pk} {patient.code} (lịch #{b.pk})')
        self._notify_doctor(v, 'Bệnh nhân có lịch hẹn đã đến', f'{patient.full_name} đã đến phòng khám.')
        return Response(self.get_serializer(v).data, status=201)

    @action(detail=True, methods=['get', 'post'])
    def record(self, request, pk=None):
        v = self.get_object()
        if request.method == 'GET':
            rec = MedicalRecord.objects.filter(visit=v).first()
            if not rec:
                return deny('Lượt khám chưa có bệnh án.', 404)
            audit(request.user, 'record.view', rec.code)
            return Response(MedicalRecordSerializer(rec, context={'request': request}).data)
        if v.status in {Visit.COMPLETED, Visit.CANCELLED}:
            rec = MedicalRecord.objects.filter(visit=v).first()
            if not rec:
                return deny('Lượt khám đã kết thúc.', 400)
        else:
            rec = MedicalRecord.objects.filter(visit=v).first()
            if not rec:
                rec = MedicalRecord.objects.create(visit=v, patient=v.patient, doctor=request.user,
                                                   chief_complaint=v.reason)
                audit(request.user, 'record.create', rec.code)
            if v.status == Visit.WAITING:
                v.status, v.called_at = Visit.IN_CONSULT, timezone.now()
            if not v.doctor_id:
                v.doctor = request.user
            v.save()
        return Response(MedicalRecordSerializer(rec, context={'request': request}).data)

    @action(detail=False, methods=['get'])
    def board(self, request):
        """Bảng tiếp đón hôm nay: chờ ở sảnh · đang tư vấn · đã xong · lịch hẹn sắp tới."""
        today = timezone.localdate()
        qs = self.get_queryset().filter(check_in_at__date=today)
        ser = lambda q: VisitSerializer(q, many=True, context={'request': request}).data
        waiting = qs.filter(status=Visit.WAITING).order_by('check_in_at')
        consult = qs.filter(status=Visit.IN_CONSULT).order_by('called_at')
        done = qs.filter(status__in=[Visit.COMPLETED, Visit.CANCELLED]).order_by('-finished_at')
        b = Booking.objects.filter(appointment__date=today, visit__isnull=True).exclude(
            status__in=[Booking.CANCELLED, Booking.COMPLETED]).select_related('staff', 'user', 'patient').order_by('appointment')
        if request.user.role == 'doctor':
            b = b.filter(staff__user=request.user)
        upcoming = [{'id': x.id, 'appointment': x.appointment, 'customer_name': x.customer_name, 'phone': x.customer_phone,
                     'doctor': x.staff.name if x.staff else '', 'type': x.get_appointment_type_display(),
                     'status': x.status, 'patient_id': x.patient_id,
                     'late': x.appointment < timezone.now() - timedelta(minutes=10)} for x in b]
        return Response({'date': today, 'counts': {'waiting': waiting.count(), 'in_consult': consult.count(),
                                                     'done': done.filter(status=Visit.COMPLETED).count(),
                                                     'upcoming': len(upcoming)},
                         'waiting': ser(waiting), 'in_consult': ser(consult), 'done': ser(done[:30]), 'upcoming': upcoming})


# --------------------------------------------------------------------------- bệnh án
class MedicalRecordViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                           viewsets.GenericViewSet):
    serializer_class = MedicalRecordSerializer
    http_method_names = ['get', 'patch', 'post', 'head', 'options']

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [CanReadClinical()]
        if self.action == 'unlock':
            return [permissions.IsAuthenticated(), _ManagerOnly()]
        return [CanWriteClinical()]

    def get_queryset(self):
        qs = MedicalRecord.objects.select_related('patient', 'doctor', 'visit', 'signed_by').prefetch_related('marks', 'addenda__author')
        if self.request.query_params.get('patient'):
            qs = qs.filter(patient_id=self.request.query_params['patient'])
        return qs

    def retrieve(self, request, *args, **kwargs):
        resp = super().retrieve(request, *args, **kwargs)
        audit(request.user, 'record.view', resp.data.get('code', ''))
        return resp

    def partial_update(self, request, *args, **kwargs):
        rec = self.get_object()
        if rec.locked:
            return deny('Bệnh án đã ký — chỉ được bổ sung phụ lục.')
        if rec.doctor_id and rec.doctor_id != request.user.id:
            return deny('Bệnh án này do bác sĩ khác phụ trách.')
        resp = super().partial_update(request, *args, **kwargs)
        audit(request.user, 'record.update', rec.code)
        return resp

    @action(detail=True, methods=['post'])
    def sign(self, request, pk=None):
        rec = self.get_object()
        if rec.locked:
            return deny('Bệnh án đã được ký.', 400)
        if rec.doctor_id and rec.doctor_id != request.user.id:
            return deny('Chỉ bác sĩ phụ trách mới được ký bệnh án này.')
        missing = [lbl for f, lbl in (('examination', 'khám lâm sàng'), ('diagnosis_name', 'chẩn đoán')) if not getattr(rec, f).strip()]
        if missing:
            return deny('Cần điền: ' + ', '.join(missing) + ' trước khi ký.', 400)
        when = timezone.now()
        rec.status, rec.signed_at, rec.signed_by = MedicalRecord.SIGNED, when, request.user
        rec.signature_hash = rec.compute_hash(request.user.pk, when)
        rec.save()
        audit(request.user, 'record.sign', f'{rec.code} {rec.signature_hash[:12]}')
        return Response(self.get_serializer(rec).data)

    @action(detail=True, methods=['post'])
    def addendum(self, request, pk=None):
        rec = self.get_object()
        if not rec.locked:
            return deny('Bệnh án chưa ký — hãy sửa trực tiếp.', 400)
        content = (request.data.get('content') or '').strip()
        if not content:
            return deny('Nội dung bổ sung không được để trống.', 400)
        RecordAddendum.objects.create(record=rec, author=request.user, content=content)
        audit(request.user, 'record.addendum', rec.code)
        return Response(self.get_serializer(MedicalRecord.objects.get(pk=rec.pk)).data)

    @action(detail=True, methods=['post'])
    def unlock(self, request, pk=None):
        rec = self.get_object()
        reason = (request.data.get('reason') or '').strip()
        if len(reason) < 5:
            return deny('Cần nhập lý do mở khóa (tối thiểu 5 ký tự).', 400)
        rec.status, rec.signed_at, rec.signed_by, rec.signature_hash = MedicalRecord.DRAFT, None, None, ''
        rec.save()
        audit(request.user, 'record.unlock', f'{rec.code}: {reason}')
        return Response(self.get_serializer(rec).data)


class Icd10ViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = Icd10Serializer
    permission_classes = [CanReadClinical]
    pagination_class = None

    def get_queryset(self):
        q = (self.request.query_params.get('q') or '').strip()
        qs = Icd10Code.objects.all()
        if q:
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q))
        return qs[:40]


# --------------------------------------------------------------------------- liệu trình
class TreatmentPlanViewSet(viewsets.ModelViewSet):
    serializer_class = TreatmentPlanSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [IsClinicStaff()]
        if self.action == 'complete_session':
            return [_Roles('doctor', 'manager', 'staff')]
        if self.action == 'schedule_session':
            return [_Roles('doctor', 'manager', 'consultant', 'staff')]
        return [_Roles('doctor', 'manager')]

    def get_queryset(self):
        qs = TreatmentPlan.objects.select_related('patient', 'doctor', 'service').prefetch_related('sessions__performed_by')
        p = self.request.query_params
        if p.get('patient'):
            qs = qs.filter(patient_id=p['patient'])
        if p.get('status'):
            qs = qs.filter(status__in=p['status'].split(','))
        return qs

    def to_representation_hide(self, data):
        return data

    def list(self, request, *args, **kwargs):
        resp = super().list(request, *args, **kwargs)
        self._mask(request, resp.data if isinstance(resp.data, list) else resp.data.get('results', []))
        return resp

    def retrieve(self, request, *args, **kwargs):
        resp = super().retrieve(request, *args, **kwargs)
        self._mask(request, [resp.data])
        return resp

    def _mask(self, request, rows):
        if request.user.role in CLINICAL_READ | {'staff'}:
            return
        for r in rows:  # CSKH chỉ thấy tiến độ liệu trình, không thấy chẩn đoán/nội dung chuyên môn
            for f in ('diagnosis', 'content', 'note'):
                r[f] = ''
            for s in r.get('sessions', []):
                s['content'] = ''

    def _make_sessions(self, plan):
        existing = {s.number: s for s in plan.sessions.all()}
        for n in range(1, plan.total_sessions + 1):
            planned = plan.start_date + timedelta(days=plan.interval_days * (n - 1)) if plan.start_date else None
            if n in existing:
                if existing[n].status == TreatmentSession.PENDING and planned:
                    existing[n].planned_date = planned
                    existing[n].save(update_fields=['planned_date'])
            else:
                TreatmentSession.objects.create(plan=plan, number=n, planned_date=planned)
        plan.sessions.filter(number__gt=plan.total_sessions, status=TreatmentSession.PENDING).delete()

    @transaction.atomic
    def perform_create(self, serializer):
        plan = serializer.save(doctor=self.request.user if self.request.user.role == 'doctor' else None)
        self._make_sessions(plan)
        audit(self.request.user, 'plan.create', f'#{plan.pk} {plan.patient.code}')

    def perform_update(self, serializer):
        if serializer.instance.status in {TreatmentPlan.COMPLETED, TreatmentPlan.CANCELLED}:
            raise serializers.ValidationError({'detail': 'Liệu trình đã kết thúc, không thể chỉnh sửa.'})
        plan = serializer.save()
        if plan.total_sessions < plan.done_sessions:
            raise serializers.ValidationError({'total_sessions': 'Ít hơn số buổi đã thực hiện.'})
        self._make_sessions(plan)

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        plan = self.get_object()
        if plan.status != TreatmentPlan.DRAFT:
            return deny('Chỉ xác nhận được liệu trình chưa xác nhận.', 400)
        plan.status = TreatmentPlan.ACTIVE
        plan.start_date = plan.start_date or timezone.localdate()
        plan.save()
        self._make_sessions(plan)
        audit(request.user, 'plan.activate', f'#{plan.pk}')
        return Response(self.get_serializer(plan).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        plan = self.get_object()
        if plan.status in {TreatmentPlan.COMPLETED, TreatmentPlan.CANCELLED}:
            return deny('Liệu trình đã kết thúc.', 400)
        plan.status = TreatmentPlan.CANCELLED
        plan.save(update_fields=['status'])
        return Response(self.get_serializer(plan).data)

    @action(detail=True, methods=['post'], url_path='complete-session')
    @transaction.atomic
    def complete_session(self, request, pk=None):
        plan = self.get_object()
        if plan.status != TreatmentPlan.ACTIVE:
            return deny('Liệu trình chưa được xác nhận hoặc đã kết thúc.', 400)
        s = plan.sessions.select_for_update().filter(pk=request.data.get('session_id')).first()
        if not s:
            return deny('Không tìm thấy buổi liệu trình.', 404)
        if s.status != TreatmentSession.PENDING:
            return deny('Buổi này đã được ghi nhận.', 400)
        new_status = TreatmentSession.SKIPPED if request.data.get('status') == 'skipped' else TreatmentSession.DONE
        s.status, s.performed_at, s.performed_by = new_status, timezone.now(), request.user
        s.content = (request.data.get('content') or '')[:2000]
        s.save()
        if not plan.sessions.filter(status=TreatmentSession.PENDING).exists():
            plan.status = TreatmentPlan.COMPLETED
            plan.save(update_fields=['status'])
        audit(request.user, 'plan.session', f'#{plan.pk} buổi {s.number}')
        return Response(self.get_serializer(TreatmentPlan.objects.get(pk=plan.pk)).data)

    @action(detail=True, methods=['post'], url_path='schedule-session')
    def schedule_session(self, request, pk=None):
        plan = self.get_object()
        s = plan.sessions.filter(pk=request.data.get('session_id'), status=TreatmentSession.PENDING).first()
        if not s:
            return deny('Không tìm thấy buổi chưa thực hiện.', 404)
        try:
            s.planned_date = timezone.datetime.fromisoformat(request.data.get('planned_date')).date()
        except (TypeError, ValueError):
            return deny('Ngày không hợp lệ.', 400)
        s.save(update_fields=['planned_date'])
        return Response(self.get_serializer(plan).data)


class _Roles(permissions.BasePermission):
    def __init__(self, *roles):
        self.roles = set(roles)

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in self.roles)


# --------------------------------------------------------------------------- hình ảnh
class PatientImageViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = PatientImageSerializer

    def get_permissions(self):
        return [CanReadClinical()] if self.action == 'list' else [CanWriteClinical()]

    def get_queryset(self):
        qs = PatientImage.objects.all()
        if self.request.query_params.get('patient'):
            qs = qs.filter(patient_id=self.request.query_params['patient'])
        return qs

    def perform_create(self, serializer):
        img = serializer.validated_data['image']
        if img.size > 10 * 1024 * 1024:
            raise serializers.ValidationError({'image': 'Ảnh tối đa 10MB.'})
        obj = serializer.save(uploaded_by=self.request.user)
        audit(self.request.user, 'image.upload', f'{obj.patient.code}')


# --------------------------------------------------------------------------- meta + dashboard
@api_view(['GET'])
@permission_classes([IsClinicStaff])
def meta(request):
    doctors = User.objects.filter(role='doctor', is_active=True).order_by('first_name', 'username')
    return Response({
        'regions': [{'key': k, 'label': v, 'group': g} for k, v, g in REGIONS],
        'lesion_types': [{'key': k, 'label': v} for k, v in LESION_TYPES],
        'fitzpatrick': [{'key': k, 'label': v} for k, v in FITZPATRICK],
        'visit_types': [{'key': k, 'label': v} for k, v in Visit.TYPES],
        'doctors': [{'id': d.id, 'name': uname(d)} for d in doctors],
    })


@api_view(['GET'])
@permission_classes([IsClinicStaff])
def dashboard(request):
    u = request.user
    today = timezone.localdate()
    visits = Visit.objects.all()
    records = MedicalRecord.objects.all()
    if u.role == 'doctor':
        visits = visits.filter(Q(doctor=u) | Q(doctor__isnull=True))
        records = records.filter(doctor=u)
    tv = visits.filter(check_in_at__date=today)
    month_start = today.replace(day=1)
    series = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        series.append({'date': d.isoformat(), 'label': d.strftime('%d/%m'),
                       'count': visits.filter(check_in_at__date=d).exclude(status=Visit.CANCELLED).count()})
    avg_wait = tv.filter(called_at__isnull=False).aggregate(a=Avg(F('called_at') - F('check_in_at')))['a']
    top = (records.filter(status=MedicalRecord.SIGNED, signed_at__date__gte=today - timedelta(days=30)).exclude(diagnosis_name='')
           .values('diagnosis_code', 'diagnosis_name').annotate(n=Count('id')).order_by('-n')[:6])
    due = (TreatmentSession.objects.filter(status=TreatmentSession.PENDING, plan__status=TreatmentPlan.ACTIVE,
                                           planned_date__lte=today + timedelta(days=3))
           .select_related('plan__patient').order_by('planned_date')[:8])
    data = {
        'today': {'total': tv.exclude(status=Visit.CANCELLED).count(), 'waiting': tv.filter(status=Visit.WAITING).count(),
                  'in_consult': tv.filter(status=Visit.IN_CONSULT).count(), 'completed': tv.filter(status=Visit.COMPLETED).count(),
                  'avg_wait_minutes': round(avg_wait.total_seconds() / 60) if avg_wait else 0},
        'appointments_today': Booking.objects.filter(appointment__date=today).exclude(status=Booking.CANCELLED).count(),
        'new_patients_month': Patient.objects.filter(created_at__date__gte=month_start).count(),
        'total_patients': Patient.objects.filter(is_active=True).count(),
        'active_plans': TreatmentPlan.objects.filter(status=TreatmentPlan.ACTIVE).count(),
        'visits_14d': series,
        'sessions_due': [{'id': s.id, 'plan_id': s.plan_id, 'patient_id': s.plan.patient_id, 'patient': s.plan.patient.full_name,
                          'plan': s.plan.title, 'number': s.number, 'date': s.planned_date,
                          'overdue': bool(s.planned_date and s.planned_date < today)} for s in due],
        'top_diagnoses': list(top) if u.role in CLINICAL_READ else [],
        'unsigned_records': records.filter(status=MedicalRecord.DRAFT).count() if u.role in CLINICAL_READ else 0,
    }
    return Response(data)
