import re

from django.db.models import Count, Q
from django.utils.dateparse import parse_datetime
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from . import comms
from .audit import audit
from core.models import Conversation

from .models import DataConsent, Patient, PatientMessage
from .permissions import CanReception


class MessageSerializer(serializers.ModelSerializer):
    sent_by_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    html_full = serializers.SerializerMethodField()

    class Meta:
        model = PatientMessage
        fields = ['id', 'patient', 'channel', 'subject', 'body', 'body_html', 'from_address', 'to_address', 'status',
                  'status_label', 'error', 'sent_by_name', 'created_at', 'html_full']

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
                         'templates': comms.TEMPLATES, 'merge_tags': comms.MERGE_TAGS})

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
        return self._deliver(request, lambda: comms.send_email(patient, request.data.get('subject', ''), request.data.get('body_html', ''), request.user))

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
