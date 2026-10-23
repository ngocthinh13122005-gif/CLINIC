"""Firebase bridge for OHIO realtime chat.

Django owns authorization and persists messages in MySQL/SQLite. Firebase is used only as
an authenticated realtime mirror so the React client can subscribe with onSnapshot.
"""
from __future__ import annotations

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

# Firestore chỉ là bản sao realtime. Mọi thao tác ghi sang Firestore chạy nền để request gửi tin
# trả về ngay, không phải chờ vòng mạng tới Google (nguyên nhân chính khiến chat bị giật/lag).
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix='ohio-firestore')
_acl_cache = {}
_acl_lock = threading.Lock()


def _background(fn, *args, **kwargs):
    def runner():
        try:
            fn(*args, **kwargs)
        except Exception:
            logger.exception('Firestore background task failed')
    _executor.submit(runner)
    return True


def _message_payload(message):
    return {
        'id': message.pk,
        'conversationId': message.conversation_id,
        'senderId': message.sender_id,
        'senderName': message.sender.get_full_name() or message.sender.username,
        'senderRole': message.sender.role,
        'text': message.text,
        'messageType': getattr(message, 'message_type', 'text'),
        'attachmentUrl': message.attachment.url if getattr(message, 'attachment', None) else '',
        'attachmentName': getattr(message, 'attachment_name', ''),
        'attachmentMime': getattr(message, 'attachment_mime', ''),
        'attachmentSize': getattr(message, 'attachment_size', 0),
        'createdAt': message.created_at.isoformat(),
    }


def _allowed_uids(conversation):
    allowed = [f'django-{conversation.customer_id}']
    for user_id in (conversation.assigned_to_id, conversation.escalated_to_id, conversation.taken_over_by_id):
        if user_id:
            allowed.append(f'django-{user_id}')
    return list(dict.fromkeys(allowed))


@lru_cache(maxsize=1)
def firestore_client():
    if not settings.FIREBASE_ENABLED:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            raw = settings.FIREBASE_SERVICE_ACCOUNT_JSON.strip()
            path = settings.FIREBASE_SERVICE_ACCOUNT_FILE.strip()
            if raw:
                credential = credentials.Certificate(json.loads(raw))
            elif path:
                credential_path = Path(path)
                if not credential_path.is_absolute():
                    credential_path = settings.BASE_DIR / credential_path
                if not credential_path.exists():
                    return None
                credential = credentials.Certificate(str(credential_path))
            else:
                return None
            firebase_admin.initialize_app(credential)
        return firestore.client()
    except Exception:
        return None


def create_custom_token(user):
    if not settings.FIREBASE_ENABLED:
        return None
    try:
        from firebase_admin import auth
        if firestore_client() is None:
            return None
        token = auth.create_custom_token(
            f'django-{user.pk}',
            {'role': user.role, 'django_user_id': user.pk},
        )
        return token.decode('utf-8') if isinstance(token, bytes) else str(token)
    except Exception:
        return None


def mirror_message(message, background=True):
    """Ghi 1 tin nhắn lên Firestore bằng 1 batch duy nhất (ACL + tin nhắn)."""
    if firestore_client() is None:
        return False
    allowed = _allowed_uids(message.conversation)
    payload = _message_payload(message)
    stamp = message.created_at.isoformat()
    conversation_id = message.conversation_id
    message_id = message.pk

    def write():
        client = firestore_client()
        if client is None:
            return
        ref = client.collection('ohio_conversations').document(str(conversation_id))
        batch = client.batch()
        batch.set(ref, {'allowedUids': allowed, 'updatedAt': stamp}, merge=True)
        batch.set(ref.collection('messages').document(str(message_id)), payload)
        batch.commit()
        with _acl_lock:
            _acl_cache[conversation_id] = tuple(allowed)

    if background:
        return _background(write)
    write()
    return True


def _backfill(conversation_id):
    from core.models import Conversation
    conversation = Conversation.objects.get(pk=conversation_id)
    client = firestore_client()
    ref = client.collection('ohio_conversations').document(str(conversation_id))
    batch = client.batch()
    count = 0
    for message in conversation.messages.select_related('sender').all():
        batch.set(ref.collection('messages').document(str(message.pk)), _message_payload(message))
        count += 1
        if count % 400 == 0:
            batch.commit()
            batch = client.batch()
    batch.commit()


def sync_conversation(conversation, background=False):
    """Đảm bảo Firestore có ACL đúng. ACL không đổi thì bỏ qua (không gọi mạng);
    chỉ nạp lại lịch sử khi hội thoại chưa từng có trên Firestore."""
    if firestore_client() is None:
        return False
    allowed = _allowed_uids(conversation)
    signature = tuple(allowed)
    conversation_id = conversation.pk
    stamp = conversation.updated_at.isoformat()
    with _acl_lock:
        if _acl_cache.get(conversation_id) == signature:
            return True

    def write():
        client = firestore_client()
        if client is None:
            return
        ref = client.collection('ohio_conversations').document(str(conversation_id))
        existed = ref.get().exists
        ref.set({'allowedUids': allowed, 'updatedAt': stamp}, merge=True)
        if not existed:
            _backfill(conversation_id)
        with _acl_lock:
            _acl_cache[conversation_id] = signature

    if background:
        return _background(write)
    write()
    return True


def mirror_notification(notification, background=True):
    if firestore_client() is None:
        return False
    uid = f'django-{notification.user_id}'
    stamp = notification.created_at.isoformat()
    pk = notification.pk
    payload = {'id': pk, 'eventType': notification.event_type, 'title': notification.title,
               'message': notification.message, 'data': notification.data or {},
               'isRead': notification.is_read, 'createdAt': stamp}

    def write():
        client = firestore_client()
        if client is None:
            return
        ref = client.collection('ohio_notifications').document(uid)
        batch = client.batch()
        batch.set(ref, {'ownerUid': uid, 'updatedAt': stamp}, merge=True)
        batch.set(ref.collection('items').document(str(pk)), payload)
        batch.commit()

    if background:
        return _background(write)
    write()
    return True


def publish_system_event(channel, event_type, payload=None):
    if firestore_client() is None:
        return False
    from django.utils import timezone
    now = timezone.now().isoformat()
    payload = payload or {}

    def write():
        client = firestore_client()
        if client is None:
            return
        ref = client.collection('ohio_events').document(str(channel))
        ref.set({'channel': str(channel), 'updatedAt': now}, merge=True)
        ref.collection('items').add({'eventType': event_type, 'payload': payload, 'createdAt': now})

    return _background(write)


def mark_notification_read(notification):
    if firestore_client() is None:
        return False
    uid = f'django-{notification.user_id}'
    pk = notification.pk

    def write():
        client = firestore_client()
        if client is None:
            return
        client.collection('ohio_notifications').document(uid).collection('items').document(str(pk)).set({'isRead': True}, merge=True)

    return _background(write)
