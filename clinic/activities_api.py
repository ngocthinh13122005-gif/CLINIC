"""API "Hoạt động" (Activities) kiểu Pabau, xây trên model CareTask.

Điểm cần nhớ (ràng buộc – server là nơi quyết định):
  1. Phải chọn LOẠI hoạt động đang dùng. Tên để trống thì lấy tên loại (như Pabau).
  2. Phải có HẠN; "từ lúc" ≤ "hạn"; tối đa 30 ngày. Chỉ có một trong hai thì tự bù 30 phút.
  3. Phải gắn với bệnh nhân HOẶC khách tiềm năng (ca tư vấn).
  4. Người phụ trách phải là nhân sự đang làm việc (quản lý / bác sĩ / CSKH). Không chọn thì mặc định là người tạo.
  5. Ghi chú có thể chèn liên kết {{invoice:ID}} / {{plan:ID}} / {{booking:ID}} / {{visit:ID}}; hồ sơ được chèn PHẢI thuộc đúng bệnh nhân.
  6. Việc đã hoàn thành là chỉ-đọc: muốn sửa phải mở lại. Mở lại / đổi giai đoạn tự động đưa việc về trạng thái "đang mở".
  7. Xóa: chỉ quản lý, hoặc người tạo (việc do hệ thống tự tạo chỉ quản lý được xóa).
  8. Việc nhắc công nợ tự tạo sẽ tự hoàn thành khi hóa đơn đã thanh toán đủ / đã hủy.
Mọi thay đổi ghi vào dòng thời gian (ActivityEvent) để hiển thị "Activity created / Assigned to / Status set…".
"""
import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from core.models import Booking, Conversation
from .audit import audit
from .models import ActivityEvent, ActivityType, CareTask, Invoice, Patient, TreatmentPlan, Visit
from .serializers import uname
from .views import deny
from .views_v2 import perm
from .views_v3 import ensure_auto_tasks

User = get_user_model()
ROLES = {'manager', 'doctor', 'consultant'}            # được xem/tạo/sửa hoạt động
STATES = [('todo', 'Cần làm'), ('pending', 'Đang chờ'), ('awaiting_reply', 'Chờ phản hồi'), ('working', 'Đang xử lý'),
          ('stuck', 'Bị kẹt'), ('done', 'Đã xong')]
STATE_LABEL = dict(STATES, skipped='Bỏ qua')
TOKEN = re.compile(r'\{\{(invoice|plan|booking|visit):(\d+)\}\}')
TABS = ('todo', 'overdue', 'today', 'tomorrow', 'this_week', 'next_week', 'completed')
MAX_SPAN = timedelta(days=30)


# ------------------------------------------------------------------ liên kết tới hồ sơ (để bấm là đi đúng nơi)
def resolve_link(kind, pk):
    """-> {kind,id,label,url,patient} hoặc None. url là đường dẫn giao diện sẽ mở đúng bản ghi."""
    pk = int(pk)
    if kind == 'invoice':
        o = Invoice.objects.filter(pk=pk).first()
        return o and {'kind': kind, 'id': pk, 'patient': o.patient_id, 'label': f'Hóa đơn · {o.code} · {timezone.localtime(o.created_at):%d/%m/%Y}', 'url': f'/thu-ngan?hd={pk}'}
    if kind == 'plan':
        o = TreatmentPlan.objects.filter(pk=pk).first()
        return o and {'kind': kind, 'id': pk, 'patient': o.patient_id, 'label': f'Liệu trình · {o.title}', 'url': f'/benh-nhan/{o.patient_id}?tab=plans&plan={pk}'}
    if kind == 'booking':
        o = Booking.objects.filter(pk=pk).first()
        d = timezone.localtime(o.appointment) if o else None
        return o and {'kind': kind, 'id': pk, 'patient': o.patient_id, 'label': f'Lịch hẹn · {d:%d/%m/%Y %H:%M}', 'url': f'/lich-hen?booking={pk}&date={d:%Y-%m-%d}'}
    if kind == 'visit':
        o = Visit.objects.filter(pk=pk).first()
        return o and {'kind': kind, 'id': pk, 'patient': o.patient_id, 'label': f'Lượt khám #{pk}', 'url': f'/benh-nhan/{o.patient_id}?tab=visits&visit={pk}'}
    return None


def links_for(t):
    """Liên kết hiển thị cho một hoạt động: token trong ghi chú + liên kết ngầm của việc tự tạo."""
    out, seen = [], set()

    def add(kind, pk, token=True):
        if (kind, int(pk)) in seen:
            return
        seen.add((kind, int(pk)))
        r = resolve_link(kind, pk)
        if r:
            out.append({**r, 'token': f'{{{{{kind}:{pk}}}}}' if token else ''})
    for kind, pk in TOKEN.findall(t.note or ''):
        add(kind, pk)
    if t.auto:
        if t.kind == CareTask.PAYMENT:
            m = re.search(r'HD\d+', t.title or '')
            inv = Invoice.objects.filter(code=m.group()).first() if m else None
            if inv is None and t.patient_id:
                inv = next(
                    (candidate for candidate in Invoice.objects.filter(patient_id=t.patient_id)
                     if candidate.code and candidate.code in (t.title or '')),
                    None,
                )
            if inv is None and t.patient_id:
                inv = next(
                    (candidate for candidate in Invoice.objects.filter(patient_id=t.patient_id).order_by('-id')
                     if candidate.status in (Invoice.PAID, Invoice.VOID) or candidate.total <= candidate.paid),
                    None,
                )
            if inv:
                add('invoice', inv.pk, token=False)
        elif t.kind == CareTask.SESSION and t.plan_id:
            add('plan', t.plan_id, token=False)
        elif t.kind in (CareTask.POST_CARE, CareTask.REVISIT) and t.visit_id:
            add('visit', t.visit_id, token=False)
    return out


def validate_tokens(note, patient):
    for kind, pk in dict.fromkeys(TOKEN.findall(note or '')):
        r = resolve_link(kind, pk)
        if not r:
            raise serializers.ValidationError({'note': f'Không tìm thấy hồ sơ được chèn ({kind} #{pk}).'})
        if not patient:
            raise serializers.ValidationError({'note': 'Hãy chọn bệnh nhân trước khi chèn hồ sơ liên kết.'})
        if r['patient'] != patient.pk:
            raise serializers.ValidationError({'note': f'"{r["label"]}" không thuộc bệnh nhân {patient.full_name}.'})


# ------------------------------------------------------------------ trạng thái + dòng thời gian
def state_of(t):
    return 'done' if t.status == CareTask.DONE else 'skipped' if t.status == CareTask.SKIPPED else t.stage


def apply_state(t, st, user):
    if st == 'done':
        if t.status != CareTask.DONE:
            t.status, t.completed_at, t.completed_by = CareTask.DONE, timezone.now(), user
    elif st in {s[0] for s in STATES}:
        t.status, t.stage, t.completed_at, t.completed_by = CareTask.PENDING, st, None, None


def log(t, user, kind, text):
    ActivityEvent.objects.create(task=t, kind=kind, text=text[:255], by=user)


def flat_errors(detail):
    """Gộp lỗi DRF (dict/list lồng nhau) thành một câu tiếng Việt."""
    if isinstance(detail, dict):
        return ' '.join(flat_errors(v) for v in detail.values())
    if isinstance(detail, (list, tuple)):
        return ' '.join(flat_errors(v) for v in detail)
    return str(detail)


def to_int(v, default):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def fmt(dt):
    return f'{timezone.localtime(dt):%d/%m/%Y %H:%M}'


# ------------------------------------------------------------------ serializer
class ActivitySerializer(serializers.ModelSerializer):
    set_state = serializers.ChoiceField(choices=[s[0] for s in STATES], required=False, write_only=True)
    state = serializers.SerializerMethodField()
    state_label = serializers.SerializerMethodField()
    type_code = serializers.SerializerMethodField()
    type_name = serializers.SerializerMethodField()
    type_icon = serializers.SerializerMethodField()
    type_color = serializers.SerializerMethodField()
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)
    overdue = serializers.SerializerMethodField()
    patient_name = serializers.SerializerMethodField()
    patient_code = serializers.SerializerMethodField()
    patient_phone = serializers.SerializerMethodField()
    conversation_label = serializers.SerializerMethodField()
    assigned_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()
    links = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = CareTask
        fields = ('id', 'title', 'type', 'type_code', 'type_name', 'type_icon', 'type_color', 'kind', 'kind_label', 'state', 'state_label', 'set_state',
                  'status', 'stage', 'start_at', 'end_at', 'due_date', 'overdue', 'note', 'links', 'patient', 'patient_name', 'patient_code',
                  'patient_phone', 'conversation', 'conversation_label', 'assigned_to', 'assigned_name', 'created_by', 'created_by_name',
                  'created_at', 'completed_at', 'completed_by_name', 'outcome', 'auto', 'can_delete')
        read_only_fields = ('kind', 'status', 'stage', 'due_date', 'created_by', 'created_at', 'completed_at', 'auto')
        extra_kwargs = {'title': {'required': False, 'allow_blank': True}, 'outcome': {'required': False}}

    # --- đọc
    def get_state(self, o): return state_of(o)
    def get_state_label(self, o): return STATE_LABEL[state_of(o)]
    def get_type_code(self, o): return o.type.code if o.type else ''
    def get_type_name(self, o): return o.type.name if o.type else o.get_kind_display()
    def get_type_icon(self, o): return o.type.icon if o.type else 'task'
    def get_type_color(self, o): return o.type.color if o.type else '#5b6570'
    def get_overdue(self, o): return o.status == CareTask.PENDING and bool(o.end_at) and o.end_at < timezone.now()
    def get_patient_name(self, o): return o.patient.full_name if o.patient else ''
    def get_patient_code(self, o): return o.patient.code if o.patient else ''
    def get_patient_phone(self, o): return (o.patient.phone if o.patient else '') or ''
    def get_assigned_name(self, o): return uname(o.assigned_to)
    def get_created_by_name(self, o): return uname(o.created_by) if o.created_by else ('Hệ thống' if o.auto else '')
    def get_completed_by_name(self, o): return uname(o.completed_by)
    def get_links(self, o): return links_for(o)

    def get_conversation_label(self, o):
        c = o.conversation
        return f'#{c.pk} · {uname(c.customer)} · {c.subject[:40]}' if c else ''

    def get_can_delete(self, o):
        u = self.context['request'].user
        return u.role == 'manager' or (o.created_by_id == u.id and not o.auto)

    def to_representation(self, o):
        data = super().to_representation(o)
        if self.context.get('with_events'):
            data['events'] = [{'id': e.id, 'kind': e.kind, 'text': e.text, 'by': uname(e.by), 'at': e.created_at} for e in o.events.select_related('by')]
        return data

    # --- ghi
    def validate(self, attrs):
        inst, user = self.instance, self.context['request'].user
        if inst and inst.status in (CareTask.DONE, CareTask.SKIPPED) and (set(attrs) - {'set_state', 'outcome'}):
            raise serializers.ValidationError({'detail': 'Hoạt động đã hoàn thành — hãy mở lại trước khi chỉnh sửa.'})
        t = attrs.get('type', inst.type if inst else None)
        state_only_update = bool(inst and set(attrs).issubset({'set_state', 'outcome'}))
        if not t and not state_only_update:
            raise serializers.ValidationError({'type': 'Hãy chọn loại hoạt động.'})
        if 'type' in attrs and not t.is_active:
            raise serializers.ValidationError({'type': f'Loại "{t.name}" đã ngừng sử dụng.'})
        title = (attrs.get('title') if 'title' in attrs else (inst.title if inst else '')) or ''
        title = title.strip() or (t.name if t else '')
        if len(title) > 200:
            raise serializers.ValidationError({'title': 'Tên hoạt động tối đa 200 ký tự.'})
        attrs['title'] = title
        start, end = attrs.get('start_at', inst.start_at if inst else None), attrs.get('end_at', inst.end_at if inst else None)
        if not (start or end):
            raise serializers.ValidationError({'end_at': 'Hãy chọn hạn xử lý.'})
        if start and not end:
            end = start + timedelta(minutes=30)
        if end and not start:
            start = end - timedelta(minutes=30)
        if end < start:
            raise serializers.ValidationError({'end_at': 'Giờ kết thúc phải sau giờ bắt đầu.'})
        if end - start > MAX_SPAN:
            raise serializers.ValidationError({'end_at': 'Khoảng thời gian tối đa 30 ngày.'})
        attrs['start_at'], attrs['end_at'] = start, end
        patient, conv = attrs.get('patient', inst.patient if inst else None), attrs.get('conversation', inst.conversation if inst else None)
        if not patient and not conv:
            raise serializers.ValidationError({'patient': 'Hãy chọn bệnh nhân hoặc khách tiềm năng (ca tư vấn).'})
        a = attrs.get('assigned_to')
        if a and (a.role not in ROLES or not a.is_active):
            raise serializers.ValidationError({'assigned_to': 'Người phụ trách phải là nhân sự đang làm việc.'})
        if 'note' in attrs or 'patient' in attrs:
            validate_tokens(attrs.get('note', inst.note if inst else ''), patient)
        if 'outcome' in attrs:
            attrs['outcome'] = (attrs['outcome'] or '')[:255]
        return attrs

    @transaction.atomic
    def create(self, vd):
        user = self.context['request'].user
        st = vd.pop('set_state', 'todo')
        vd['assigned_to'] = vd.get('assigned_to') or user
        t = CareTask(**vd, kind=CareTask.OTHER, status=CareTask.PENDING, created_by=user)
        apply_state(t, st, user)
        t.save()
        log(t, user, 'created', 'Hoạt động được tạo')
        log(t, user, 'assign', f'Giao cho {uname(t.assigned_to)}')
        log(t, user, 'status', f'Trạng thái đặt thành {STATE_LABEL[state_of(t)]}')
        log(t, user, 'type', f'Loại đặt thành {t.type.name}')
        log(t, user, 'due', f'Hạn đặt thành {fmt(t.end_at)}')
        if st == 'done':
            log(t, user, 'done', 'Đã đánh dấu hoàn thành')
        audit(user, 'activity.create', f'#{t.pk}')
        return t

    @transaction.atomic
    def update(self, inst, vd):
        user = self.context['request'].user
        st = vd.pop('set_state', None)
        was = state_of(inst)
        old = (inst.title, inst.type_id, inst.end_at, inst.assigned_to_id, inst.note, inst.patient_id, inst.conversation_id)
        for k, v in vd.items():
            setattr(inst, k, v)
        if st:
            apply_state(inst, st, user)
        inst.save()
        if inst.title != old[0]: log(inst, user, 'title', f'Đổi tên thành “{inst.title}”')
        if inst.type_id != old[1]: log(inst, user, 'type', f'Loại đổi thành {inst.type.name}')
        if inst.end_at != old[2]: log(inst, user, 'due', f'Hạn đặt thành {fmt(inst.end_at)}')
        if inst.assigned_to_id != old[3]: log(inst, user, 'assign', f'Giao cho {uname(inst.assigned_to) or "chưa ai"}')
        if inst.note != old[4]: log(inst, user, 'note', 'Đã cập nhật ghi chú')
        if (inst.patient_id, inst.conversation_id) != old[5:]: log(inst, user, 'link', 'Đã đổi khách hàng liên kết')
        now = state_of(inst)
        if now != was:
            if now == 'done':
                log(inst, user, 'done', 'Đã đánh dấu hoàn thành')
                audit(user, 'activity.done', f'#{inst.pk}')
            elif was in ('done', 'skipped'):
                log(inst, user, 'reopen', f'Mở lại — trạng thái đặt thành {STATE_LABEL[now]}')
            else:
                log(inst, user, 'status', f'Trạng thái đặt thành {STATE_LABEL[now]}')
        return inst


class ActivityTypeSerializer(serializers.ModelSerializer):
    usage = serializers.SerializerMethodField()

    class Meta:
        model = ActivityType
        fields = ('id', 'code', 'name', 'icon', 'color', 'sort', 'is_active', 'usage')

    def get_usage(self, o): return o.tasks.count()

    def validate_color(self, v):
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', v or ''):
            raise serializers.ValidationError('Màu phải có dạng #RRGGBB.')
        return v


# ------------------------------------------------------------------ đồng bộ việc nhắc công nợ
def sync_paid_invoice_tasks(user=None):
    """Việc nhắc công nợ tự tạo → tự hoàn thành khi hóa đơn đã trả đủ hoặc đã hủy."""
    n = 0
    for t in CareTask.objects.filter(kind=CareTask.PAYMENT, auto=True, status=CareTask.PENDING):
        m = re.search(r'HD\d+', t.title or '')
        inv = Invoice.objects.filter(code=m.group()).first() if m else None
        if inv is None and t.patient_id:
            inv = next(
                (candidate for candidate in Invoice.objects.filter(patient_id=t.patient_id).order_by('-id')
                 if candidate.status in (Invoice.PAID, Invoice.VOID) or candidate.total <= candidate.paid),
                None,
            )
        if inv and (inv.status in (Invoice.PAID, Invoice.VOID) or inv.total <= inv.paid):
            t.status, t.completed_at, t.outcome = CareTask.DONE, timezone.now(), 'Hóa đơn đã thanh toán đủ' if inv.status != Invoice.VOID else 'Hóa đơn đã hủy'
            t.save()
            log(t, None, 'done', t.outcome)
            n += 1
    return n


# ------------------------------------------------------------------ viewset
class ActivityViewSet(viewsets.ModelViewSet):
    serializer_class = ActivitySerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_permissions(self):
        return [perm(ROLES)]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['with_events'] = self.action in {'retrieve', 'create', 'partial_update', 'complete', 'reopen', 'duplicate'}
        return ctx

    # lọc nền: phạm vi + khách + loại + tìm kiếm (KHÔNG gồm tab, để đếm được số của từng tab)
    def scoped(self, with_filters=True):
        p, u = self.request.query_params, self.request.user
        qs = CareTask.objects.select_related('patient', 'type', 'assigned_to', 'created_by', 'completed_by', 'conversation__customer')
        if p.get('scope') == 'mine':
            qs = qs.filter(assigned_to=u)
        if p.get('assigned_to'):
            qs = qs.filter(assigned_to_id=p['assigned_to'])
        if p.get('patient'):
            qs = qs.filter(patient_id=p['patient'])
        if p.get('conversation'):
            qs = qs.filter(conversation_id=p['conversation'])
        if not with_filters:
            return qs
        if p.get('type'):
            qs = qs.filter(type_id=p['type']) if p['type'].isdigit() else qs.filter(type__code=p['type'])
        q = (p.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(title__icontains=q) | Q(note__icontains=q) | Q(patient__full_name__icontains=q) | Q(patient__code__icontains=q)
                           | Q(patient__phone__icontains=q) | Q(conversation__subject__icontains=q))
        return qs

    def get_queryset(self):
        return self.scoped()

    @staticmethod
    def by_tab(qs, tab):
        now, today = timezone.now(), timezone.localdate()
        mon = today - timedelta(days=today.weekday())
        op = qs.filter(status=CareTask.PENDING)
        return {
            'todo': op,
            'overdue': op.filter(end_at__lt=now),
            'today': op.filter(due_date=today),
            'tomorrow': op.filter(due_date=today + timedelta(days=1)),
            'this_week': op.filter(due_date__gte=mon, due_date__lte=mon + timedelta(days=6)),
            'next_week': op.filter(due_date__gte=mon + timedelta(days=7), due_date__lte=mon + timedelta(days=13)),
            'completed': qs.exclude(status=CareTask.PENDING),
        }[tab]

    ORDER = {'due': ('end_at', 'id'), '-due': ('-end_at', '-id'), 'title': ('title', 'id'), '-title': ('-title', '-id'), 'state': ('status', 'stage', 'id'),
             '-state': ('-status', '-stage', '-id'), 'assignee': ('assigned_to__first_name', 'id'), '-assignee': ('-assigned_to__first_name', '-id'),
             'type': ('type__sort', 'id'), '-type': ('-type__sort', '-id')}

    def list(self, request, *args, **kwargs):
        p = request.query_params
        tab = p.get('tab') if p.get('tab') in TABS else 'todo'
        if tab != 'completed':
            ensure_auto_tasks()
            sync_paid_invoice_tasks()
        base = self.scoped(with_filters=False)
        counts = {t: self.by_tab(base, t).count() for t in TABS}
        qs = self.by_tab(self.scoped(), tab).order_by(*self.ORDER.get(p.get('ordering'), self.ORDER['-due']))
        size = min(max(to_int(p.get('page_size'), 50), 1), 200)
        page = max(to_int(p.get('page'), 1), 1)
        total = qs.count()
        rows = qs[(page - 1) * size: page * size]
        return Response({'count': total, 'page': page, 'page_size': size, 'counts': counts, 'results': self.get_serializer(rows, many=True).data})

    # --- xóa
    def destroy(self, request, *args, **kwargs):
        t = self.get_object()
        if not (request.user.role == 'manager' or (t.created_by_id == request.user.id and not t.auto)):
            return deny('Chỉ quản lý hoặc người tạo mới được xóa hoạt động này.', 403)
        pk = t.pk
        t.delete()
        audit(request.user, 'activity.delete', f'#{pk}')
        return Response(status=204)

    # --- trạng thái nhanh
    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        t = self.get_object()
        if t.status != CareTask.PENDING:
            return deny('Hoạt động này đã hoàn thành.', 400)
        s = ActivitySerializer(t, data={'set_state': 'done', **({'outcome': request.data['outcome']} if 'outcome' in request.data else {})},
                               partial=True, context=self.get_serializer_context())
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        t = self.get_object()
        if t.status == CareTask.PENDING:
            return deny('Hoạt động này đang mở.', 400)
        s = ActivitySerializer(t, data={'set_state': request.data.get('state') or 'todo'}, partial=True, context=self.get_serializer_context())
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def duplicate(self, request, pk=None):
        o = self.get_object()
        n = CareTask.objects.create(patient=o.patient, conversation=o.conversation, type=o.type, kind=CareTask.OTHER, title=o.title, note=o.note,
                                    start_at=o.start_at, end_at=o.end_at, assigned_to=o.assigned_to, created_by=request.user)
        log(n, request.user, 'created', f'Nhân bản từ hoạt động #{o.pk}')
        log(n, request.user, 'assign', f'Giao cho {uname(n.assigned_to) or "chưa ai"}')
        return Response(self.get_serializer(n).data, status=201)

    @action(detail=False, methods=['post'])
    def bulk(self, request):
        """{ids:[...], op:'done'|'reopen'|'delete'|'assign', assigned_to}"""
        op, ids = request.data.get('op'), list(dict.fromkeys(request.data.get('ids') or []))[:200]
        if op not in {'done', 'reopen', 'delete', 'assign'} or not ids:
            return deny('Thao tác hoặc danh sách hoạt động không hợp lệ.', 400)
        who = None
        if op == 'assign':
            who = User.objects.filter(pk=request.data.get('assigned_to'), is_active=True, role__in=ROLES).first()
            if not who:
                return deny('Người phụ trách không hợp lệ.', 400)
        ok, skipped = [], []
        for t in CareTask.objects.filter(pk__in=ids).select_related('type', 'assigned_to'):
            try:
                if op == 'delete':
                    if not (request.user.role == 'manager' or (t.created_by_id == request.user.id and not t.auto)):
                        raise serializers.ValidationError('Không có quyền xóa')
                    t.delete()
                else:
                    data = {'set_state': 'done'} if op == 'done' else {'set_state': 'todo'} if op == 'reopen' else {'assigned_to': who.pk}
                    if op == 'done' and t.status != CareTask.PENDING or op == 'reopen' and t.status == CareTask.PENDING:
                        raise serializers.ValidationError('Không cần thay đổi')
                    s = ActivitySerializer(t, data=data, partial=True, context=self.get_serializer_context())
                    s.is_valid(raise_exception=True)
                    s.save()
                ok.append(t.pk)
            except serializers.ValidationError as e:
                skipped.append({'id': t.pk, 'reason': flat_errors(e.detail)})
        return Response({'ok': ok, 'skipped': skipped})

    # --- dữ liệu cho form
    @action(detail=False, methods=['get'])
    def assignees(self, request):
        rows = User.objects.filter(is_active=True, role__in=ROLES).order_by('first_name', 'username')
        return Response([{'id': u.pk, 'name': uname(u), 'role': u.role, 'role_label': u.get_role_display()} for u in rows])

    @action(detail=False, methods=['get'])
    def leads(self, request):
        q = (request.query_params.get('q') or '').strip()
        qs = Conversation.objects.select_related('customer').order_by('-updated_at')
        if q:
            qs = qs.filter(Q(subject__icontains=q) | Q(customer__first_name__icontains=q) | Q(customer__last_name__icontains=q) | Q(customer__username__icontains=q))
        return Response([{'id': c.pk, 'label': f'#{c.pk} · {uname(c.customer)} · {c.subject[:40]}', 'customer': uname(c.customer), 'status': c.status} for c in qs[:15]])

    @action(detail=False, methods=['get'])
    def linkables(self, request):
        """Hồ sơ của bệnh nhân có thể chèn vào ghi chú (nút Insert)."""
        patient = Patient.objects.filter(pk=request.query_params.get('patient') or 0).first()
        if not patient:
            return deny('Hãy chọn bệnh nhân trước.', 400)
        loc = timezone.localtime
        out = []
        for o in Invoice.objects.filter(patient=patient).order_by('-created_at')[:10]:
            out.append({'kind': 'invoice', 'id': o.pk, 'token': f'{{{{invoice:{o.pk}}}}}', 'label': f'Hóa đơn · {o.code} · {loc(o.created_at):%d/%m/%Y}'})
        for o in TreatmentPlan.objects.filter(patient=patient).order_by('-created_at')[:10]:
            out.append({'kind': 'plan', 'id': o.pk, 'token': f'{{{{plan:{o.pk}}}}}', 'label': f'Liệu trình · {o.title}'})
        for o in Booking.objects.filter(patient=patient).exclude(status='cancelled').order_by('-appointment')[:10]:
            out.append({'kind': 'booking', 'id': o.pk, 'token': f'{{{{booking:{o.pk}}}}}', 'label': f'Lịch hẹn · {loc(o.appointment):%d/%m/%Y %H:%M}'})
        for o in Visit.objects.filter(patient=patient).order_by('-id')[:10]:
            out.append({'kind': 'visit', 'id': o.pk, 'token': f'{{{{visit:{o.pk}}}}}', 'label': f'Lượt khám #{o.pk}'})
        return Response(out)


class ActivityTypeViewSet(viewsets.ModelViewSet):
    serializer_class = ActivityTypeSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_permissions(self):
        return [perm(ROLES)] if self.action in {'list', 'retrieve'} else [perm({'manager'})]

    def get_queryset(self):
        qs = ActivityType.objects.all()
        if not (self.request.query_params.get('all') == '1' and self.request.user.role == 'manager'):
            qs = qs.filter(is_active=True)
        return qs

    def destroy(self, request, *args, **kwargs):
        t = self.get_object()
        if t.tasks.exists():            # đã có hoạt động dùng loại này → chỉ tắt, không xóa mất dữ liệu
            t.is_active = False
            t.save(update_fields=['is_active'])
            return Response(self.get_serializer(t).data)
        t.delete()
        return Response(status=204)
