import re

from django.db.models import Count, Q
from django.utils.dateparse import parse_datetime
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from django.utils import timezone

from . import comms, comms_templates
from .audit import audit
from core.models import Conversation

from .models import DataConsent, Invoice, MessageTemplate, Patient, PatientMessage
from .permissions import CanReception


class MessageSerializer(serializers.ModelSerializer):
    sent_by_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    html_full = serializers.SerializerMethodField()

    class Meta:
        model = PatientMessage
        fields = ['id', 'patient', 'channel', 'subject', 'body', 'body_html', 'from_address', 'to_address', 'status',
                  'status_label', 'error', 'sent_by_name', 'created_at', 'html_full', 'cc', 'bcc']

    def get_html_full(self, obj):
        if obj.channel != 'email':
            return ''
        src = obj.body_html or f'<p>{obj.body}</p>'
        if src.lstrip().lower().startswith('<!doctype'):
            return re.sub(r'<img[^>]+src="cid:[^"]*"[^>]*>', '', src)
        return comms.wrap_email(src, obj.patient, obj.subject)

    def get_sent_by_name(self, obj):
        u = obj.sent_by
        return (u.get_full_name() or u.username) if u else ''


class PatientMessageViewSet(viewsets.GenericViewSet):
    """Tab Liên lạc trong hồ sơ bệnh nhân: xem, gửi email, gửi SMS, gửi lại, xóa."""
    serializer_class = MessageSerializer
    permission_classes = [CanReception]

    def _patient(self, request):
        pid = request.query_params.get('patient') or request.data.get('patient')
        try:
            return Patient.objects.get(pk=int(pid))
        except (TypeError, ValueError, Patient.DoesNotExist):
            raise serializers.ValidationError({'patient': 'Không tìm thấy bệnh nhân.'})

    def _chats(self, patient):
        """Các cuộc chat (web / Messenger) của tài khoản liên kết với bệnh nhân."""
        if not patient.user_id:
            return []
        out = []
        for c in (Conversation.objects.filter(customer_id=patient.user_id).select_related('assigned_to')
                  .prefetch_related('messages__sender').order_by('-updated_at')[:30]):
            msgs = list(c.messages.all())[-40:]
            if not msgs:
                continue
            last = msgs[-1]
            out.append({
                'id': f'chat-{c.id}', 'conversation_id': c.id, 'channel': 'chat', 'subject': c.subject,
                'channel_label': c.get_channel_display(), 'status_label': c.get_status_display(),
                'created_at': last.created_at, 'message_count': c.messages.count(),
                'from_address': c.get_channel_display(), 'to_address': patient.full_name, 'body': last.text or last.attachment_name,
                'messages': [{'id': m.id, 'own': m.sender_id == patient.user_id, 'name': m.sender.get_full_name() or m.sender.username,
                              'text': m.text or m.attachment_name or '(tệp đính kèm)', 'at': m.created_at, 'type': m.message_type} for m in msgs],
            })
        return out

    def list(self, request):
        patient = self._patient(request)
        base = PatientMessage.objects.filter(patient=patient, is_deleted=False).select_related('sent_by', 'patient')
        agg = base.aggregate(email=Count('id', filter=Q(channel='email')), sms=Count('id', filter=Q(channel='sms')))
        chats = self._chats(patient)
        counts = {'email': agg['email'], 'sms': agg['sms'], 'chat': len(chats)}
        counts['all'] = counts['email'] + counts['sms'] + counts['chat']
        ch = request.query_params.get('channel')
        rows = [] if ch == 'chat' else list(MessageSerializer(base.filter(channel=ch) if ch in ('email', 'sms') else base, many=True).data)
        if ch in (None, '', 'all', 'chat'):
            rows += chats
        rows.sort(key=lambda r: r['created_at'] if hasattr(r['created_at'], 'timestamp') else parse_datetime(r['created_at']), reverse=True)
        has_contact = DataConsent.objects.filter(patient=patient, purpose='contact', status=DataConsent.GRANTED).exists()
        return Response({'counts': counts, 'results': rows, 'has_account': bool(patient.user_id),
                         'patient': {'email': patient.email, 'phone': patient.phone}, 'contact_consent': has_contact,
                         'email_live': comms._email_is_real(), 'sms_live': bool(comms._sms_backend()),
                         'merge_tags': comms.MERGE_TAGS, 'from_options': comms.from_options(request.user),
                         'merge_values': comms.merge_values(patient, request.user), 'clinic': comms.emailkit.clinic()})

    def _deliver(self, request, fn):
        try:
            msg = fn()
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        audit(request.user, f'Gửi {msg.get_channel_display()} cho bệnh nhân', f'{msg.patient.code} · {msg.get_status_display()}')
        return Response(MessageSerializer(msg).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'], url_path='send-email')
    def send_email(self, request):
        patient = self._patient(request)
        d = request.data
        return self._deliver(request, lambda: comms.send_email(
            patient, d.get('subject', ''), d.get('body_html', ''), request.user, to=d.get('to'), cc=d.get('cc'), bcc=d.get('bcc'),
            from_name=d.get('from_name', ''), booking_ids=[int(x) for x in (d.get('booking_ids') or []) if str(x).isdigit()],
            follow_up=bool(d.get('follow_up'))))

    @action(detail=False, methods=['post'], url_path='send-sms')
    def send_sms(self, request):
        patient = self._patient(request)
        return self._deliver(request, lambda: comms.send_sms(patient, request.data.get('body', ''), request.user))

    @action(detail=True, methods=['post'])
    def resend(self, request, pk=None):
        old = PatientMessage.objects.filter(pk=pk, is_deleted=False).select_related('patient').first()
        if not old:
            return Response({'detail': 'Không tìm thấy.'}, status=status.HTTP_404_NOT_FOUND)
        if old.channel == 'email':
            return self._deliver(request, lambda: comms.send_email(old.patient, old.subject, old.body_html, request.user))
        return self._deliver(request, lambda: comms.send_sms(old.patient, old.body, request.user))

    def destroy(self, request, pk=None):
        if request.user.role != 'manager':
            return Response({'detail': 'Chỉ quản lý được xóa nhật ký liên lạc.'}, status=status.HTTP_403_FORBIDDEN)
        n = PatientMessage.objects.filter(pk=pk, is_deleted=False).update(is_deleted=True)
        if not n:
            return Response({'detail': 'Không tìm thấy.'}, status=status.HTTP_404_NOT_FOUND)
        audit(request.user, 'Xóa nhật ký liên lạc', f'#{pk}')
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'])
    def attachables(self, request):
        """Lịch hẹn và hóa đơn gần đây của bệnh nhân, để chèn / đính kèm vào email."""
        patient = self._patient(request)
        from core.models import Booking
        bookings = []
        for b in Booking.objects.filter(patient_id=patient.id).exclude(status='cancelled').prefetch_related('items__service').order_by('-appointment')[:12]:
            at = timezone.localtime(b.appointment)
            bookings.append({'id': b.id, 'service': ', '.join(i.service.name for i in b.items.all()) or 'Lịch hẹn', 'at': at.isoformat(),
                             'staff': b.staff.name if b.staff_id else '', 'code': b.confirm_code})
        invoices = [{'id': i.id, 'code': i.code, 'at': i.created_at.isoformat(), 'total': i.total, 'status': i.status, 'status_label': i.get_status_display()}
                    for i in Invoice.objects.filter(patient=patient).exclude(status='void').order_by('-created_at')[:12]]
        return Response({'bookings': bookings, 'invoices': invoices})


class TemplateSerializer(serializers.ModelSerializer):
    category_label = serializers.CharField(source='get_category_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MessageTemplate
        fields = ['id', 'channel', 'category', 'category_label', 'name', 'subject', 'body', 'created_by_name', 'created_at']

    def get_created_by_name(self, obj):
        return (obj.created_by.get_full_name() or obj.created_by.username) if obj.created_by_id else 'Hệ thống'


class MessageTemplateViewSet(viewsets.GenericViewSet):
    """Danh sách / tạo / xóa mẫu email và SMS."""
    serializer_class = TemplateSerializer
    permission_classes = [CanReception]

    def list(self, request):
        comms_templates.ensure_defaults()
        qs = MessageTemplate.objects.filter(is_active=True).select_related('created_by')
        if request.query_params.get('channel') in ('email', 'sms'):
            qs = qs.filter(channel=request.query_params['channel'])
        return Response(TemplateSerializer(qs, many=True).data)

    def create(self, request):
        d = request.data
        ch = d.get('channel')
        if ch not in ('email', 'sms') or not str(d.get('name', '')).strip() or not str(d.get('body', '')).strip():
            return Response({'detail': 'Cần nhập tên mẫu và nội dung.'}, status=status.HTTP_400_BAD_REQUEST)
        cat = d.get('category') if d.get('category') in dict(MessageTemplate.CATEGORIES) else 'general'
        t = MessageTemplate.objects.create(channel=ch, category=cat, name=str(d['name'])[:120], subject=str(d.get('subject', ''))[:200],
                                           body=comms.sanitize_html(d['body']) if ch == 'email' else str(d['body']), created_by=request.user)
        return Response(TemplateSerializer(t).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        t = MessageTemplate.objects.filter(pk=pk, is_active=True).first()
        if not t:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if request.user.role != 'manager' and t.created_by_id != request.user.id:
            return Response({'detail': 'Chỉ quản lý hoặc người tạo mới được xóa mẫu.'}, status=status.HTTP_403_FORBIDDEN)
        t.is_active = False
        t.save(update_fields=['is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)
