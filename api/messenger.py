import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone as dt_timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from core.models import Conversation, ConversationSession, Message

logger = logging.getLogger(__name__)
User = get_user_model()


def _graph_url(path, query=None):
    base = f'https://graph.facebook.com/{settings.META_GRAPH_API_VERSION}/{path.lstrip("/")}'
    return f'{base}?{urlencode(query)}' if query else base


def _graph_json(path, *, method='GET', payload=None, token=None):
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    request = Request(_graph_url(path), data=body, method=method)
    request.add_header('Content-Type', 'application/json')
    if token:
        request.add_header('Authorization', f'Bearer {token}')
    try:
        with urlopen(request, timeout=12) as response:
            return json.loads(response.read().decode('utf-8'))
    except (HTTPError, URLError, TimeoutError) as exc:
        logger.warning('Meta Graph request failed: %s', exc)
        raise RuntimeError('Không thể kết nối Meta Graph API.') from exc


def send_messenger_text(recipient_id, text):
    if not settings.META_PAGE_ACCESS_TOKEN:
        raise RuntimeError('META_PAGE_ACCESS_TOKEN chưa được cấu hình.')
    return _graph_json(
        'me/messages', method='POST', token=settings.META_PAGE_ACCESS_TOKEN,
        payload={'recipient': {'id': recipient_id}, 'messaging_type': 'RESPONSE', 'message': {'text': text[:2000]}},
    )


def send_message_to_channel(message):
    conversation = message.conversation
    if conversation.channel != Conversation.FACEBOOK or message.sender_id == conversation.customer_id:
        return None
    if message.message_type != Message.TEXT or not message.text:
        raise RuntimeError('Messenger demo hiện chỉ gửi được tin nhắn văn bản.')
    result = send_messenger_text(conversation.external_customer_id, message.text)
    mid = result.get('message_id')
    if mid:
        message.external_message_id = mid
        message.external_sent_at = timezone.now()
        message.save(update_fields=['external_message_id', 'external_sent_at'])
    return result


def _valid_signature(request):
    secret = settings.META_APP_SECRET
    signature = request.headers.get('X-Hub-Signature-256', '')
    if not secret or not signature.startswith('sha256='):
        return False
    expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature[7:], expected)


def _profile(psid):
    if not settings.META_PAGE_ACCESS_TOKEN:
        return {}
    try:
        return _graph_json(f'{psid}?fields=first_name,last_name,profile_pic', token=settings.META_PAGE_ACCESS_TOKEN)
    except RuntimeError:
        return {}


def _customer_for_psid(psid):
    username = f'fb_{psid}'
    user = User.objects.filter(username=username).first()
    if user:
        return user
    profile = _profile(psid)
    user = User(username=username, role=User.Role.CUSTOMER, first_name=(profile.get('first_name') or 'Khách Facebook')[:150], last_name=(profile.get('last_name') or '')[:150])
    user.set_unusable_password()
    user.save()
    return user


@transaction.atomic
def _receive_message(event, page_id):
    sender_id = str((event.get('sender') or {}).get('id') or '')
    data = event.get('message') or {}
    mid = data.get('mid')
    if not sender_id or not mid or data.get('is_echo') or Message.objects.filter(external_message_id=mid).exists():
        return
    customer = _customer_for_psid(sender_id)
    conversation = Conversation.objects.filter(channel=Conversation.FACEBOOK, external_customer_id=sender_id).order_by('-updated_at').first()
    text = (data.get('text') or '').strip()
    attachments = data.get('attachments') or []
    if not conversation:
        conversation = Conversation.objects.create(customer=customer, subject=(text or 'Tin nhắn Facebook')[:255], channel=Conversation.FACEBOOK, external_customer_id=sender_id, external_page_id=page_id)
        ConversationSession.objects.create(conversation=conversation, sequence=1, started_at=conversation.session_started_at)
    elif conversation.status == Conversation.CLOSED:
        conversation.status = Conversation.OPEN
        conversation.resolved_at = None
        conversation.session_started_at = timezone.now()
        conversation.session_ended_at = None
        conversation.session_end_reason = ''
        conversation.csat_invited_at = None
        conversation.save(update_fields=['status', 'resolved_at', 'session_started_at', 'session_ended_at', 'session_end_reason', 'csat_invited_at', 'updated_at'])
        last = conversation.sessions.order_by('-sequence').first()
        ConversationSession.objects.create(conversation=conversation, sequence=(last.sequence + 1 if last else 1), started_at=conversation.session_started_at)
    msg_type = Message.TEXT
    if attachments and not text:
        kind = attachments[0].get('type')
        msg_type = Message.IMAGE if kind == 'image' else Message.FILE
        text = '[Khách gửi ảnh]' if kind == 'image' else '[Khách gửi tệp đính kèm]'
    sent_at = None
    if event.get('timestamp'):
        sent_at = datetime.fromtimestamp(event['timestamp'] / 1000, tz=dt_timezone.utc)
    Message.objects.create(conversation=conversation, sender=customer, text=text[:2000], message_type=msg_type, external_message_id=mid, external_sent_at=sent_at)
    conversation.save(update_fields=['updated_at'])


@csrf_exempt
@require_http_methods(['GET', 'POST'])
def messenger_webhook(request):
    if request.method == 'GET':
        mode = request.GET.get('hub.mode')
        token = request.GET.get('hub.verify_token')
        challenge = request.GET.get('hub.challenge', '')
        if mode == 'subscribe' and settings.META_WEBHOOK_VERIFY_TOKEN and hmac.compare_digest(token or '', settings.META_WEBHOOK_VERIFY_TOKEN):
            return HttpResponse(challenge, content_type='text/plain')
        return HttpResponse('Verification failed', status=403)
    if not _valid_signature(request):
        return JsonResponse({'detail': 'Invalid signature'}, status=403)
    try:
        payload = json.loads(request.body.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'detail': 'Invalid JSON'}, status=400)
    if payload.get('object') != 'page':
        return JsonResponse({'status': 'ignored'})
    for entry in payload.get('entry', []):
        page_id = str(entry.get('id') or '')
        for event in entry.get('messaging', []):
            try:
                _receive_message(event, page_id)
            except Exception:
                logger.exception('Could not process Messenger webhook event')
    return JsonResponse({'status': 'ok'})
