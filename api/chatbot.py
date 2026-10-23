"""Trợ lý OHIO: chatbot công khai (khách chưa đăng nhập vẫn dùng được).

Thứ tự xử lý một câu hỏi:
 1. Nút/ý định nghiệp vụ (dịch vụ, khuyến mãi, đặt lịch, gặp tư vấn viên) -> dữ liệu thật từ DB.
 2. FAQ do quản trị cấu hình (khớp từ khóa).
 3. Gemini cho câu hỏi tự do (có kèm dữ liệu dịch vụ/voucher thật làm ngữ cảnh).
 4. Nếu Gemini lỗi hoặc chưa có key: tin nhắn dự phòng + gợi ý các nút.

Liên kết trong tin nhắn dùng cú pháp  [[link:/duong-dan|Nhãn nút]]  để lịch sử vẫn giữ được nút bấm.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core.models import (
    ChatbotFAQ, ChatbotMessage, ChatbotSession, ChatbotSetting, Conversation, Message, Service, Voucher,
)
from . import ai
from . import chatbot_booking as bk

logger = logging.getLogger(__name__)

VISITOR_RE = re.compile(r'^[A-Za-z0-9_-]{16,64}$')
MAX_INPUT = 500
RATE_PER_MINUTE = 20

ACTIONS = [
    {'key': 'services', 'label': 'Dịch vụ'},
    {'key': 'booking', 'label': 'Đặt lịch'},
    {'key': 'promotions', 'label': 'Khuyến mãi'},
    {'key': 'human', 'label': 'Gặp tư vấn viên'},
]
ACTION_LABELS = {a['key']: a['label'] for a in ACTIONS}


def _plain(text):
    text = unicodedata.normalize('NFD', (text or '').lower())
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn').replace('đ', 'd')
    return re.sub(r'\s+', ' ', text).strip()


def money(v):
    return f'{int(v or 0):,}'.replace(',', '.') + 'đ'


def link(url, label):
    return f'[[link:{url}|{label}]]'


# ---------------------------------------------------------------- phiên
def get_session(request, visitor_key, page_url=''):
    """Lấy/tạo phiên theo visitor_key. Trả về (session, visitor_key_hiệu_lực)."""
    if not VISITOR_RE.match(visitor_key or ''):
        return None, ''
    user = request.user if request.user.is_authenticated else None
    session = ChatbotSession.objects.filter(visitor_key=visitor_key).first()
    if session and session.user_id and (user is None or session.user_id != user.id):
        # Khóa này thuộc về tài khoản khác: không được xem lịch sử, cấp phiên mới.
        import secrets
        visitor_key = secrets.token_hex(16)
        session = None
    if session is None:
        session = ChatbotSession.objects.create(
            visitor_key=visitor_key, user=user, page_url=(page_url or '')[:500],
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:300],
        )
    elif user and not session.user_id:
        session.user = user
        session.save(update_fields=['user', 'updated_at'])
    return session, visitor_key


def serialize_message(m):
    return {'id': m.pk, 'role': m.role, 'content': m.content, 'source': m.source, 'created_at': m.created_at.isoformat()}


def recent_history(session, limit=30):
    rows = list(session.messages.order_by('-id')[:limit])
    rows.reverse()
    return [serialize_message(m) for m in rows]


def public_config():
    cfg = ChatbotSetting.load()
    extra = []
    from core.models import ChatbotQuickAction
    for qa in ChatbotQuickAction.objects.filter(is_active=True):
        if qa.label not in ACTION_LABELS.values() and qa.action_type in ('message', 'url') and qa.value:
            extra.append({'key': f'custom:{qa.pk}', 'label': qa.label})
    return {
        'enabled': cfg.enabled,
        'name': cfg.assistant_name,
        'greeting': cfg.greeting_message,
        'actions': ACTIONS + extra,
        'ai_enabled': bool(ai._key()) and cfg.ai_enabled,
    }


# ---------------------------------------------------------------- nghiệp vụ
def reply_services():
    rows = list(Service.objects.filter(is_active=True).select_related('category').order_by('category__name', 'name')[:8])
    if not rows:
        return 'OHIO chưa có dịch vụ nào đang mở bán. Bạn vui lòng quay lại sau hoặc gặp tư vấn viên nhé.'
    lines = ['Các dịch vụ nổi bật của OHIO:']
    for s in rows:
        lines.append(f'• {s.name} — {money(s.price)} · {s.duration} phút')
    lines.append('')
    lines.append(link('/dich-vu', 'Xem tất cả dịch vụ'))
    lines.append(link('/book', 'Đặt lịch ngay'))
    return '\n'.join(lines)


def reply_promotions():
    today = timezone.localdate()
    rows = list(Voucher.objects.filter(is_active=True).filter(Q(expires_at__isnull=True) | Q(expires_at__gte=today))[:6])
    if not rows:
        return 'Hiện OHIO chưa có chương trình khuyến mãi đang diễn ra. Bạn theo dõi website để cập nhật sớm nhất nhé.'
    lines = ['Ưu đãi OHIO đang áp dụng:']
    for v in rows:
        parts = [f'giảm {money(v.discount_value)}']
        if v.min_spend:
            parts.append(f'đơn từ {money(v.min_spend)}')
        if v.expires_at:
            parts.append(f'hết hạn {v.expires_at.strftime("%d/%m/%Y")}')
        lines.append(f'• {v.title} ({v.code}) — ' + ', '.join(parts))
    lines.append('')
    lines.append('Voucher được đổi bằng điểm thưởng trong tài khoản của bạn.')
    lines.append(link('/my-vouchers', 'Xem & đổi voucher'))
    return '\n'.join(lines)


def reply_booking():
    return 'Mình đưa bạn tới trang đặt lịch nhé. Bạn chọn dịch vụ, ngày giờ và chuyên viên phù hợp là xong.\n\n' + link('/book', 'Đặt lịch ngay')


def reply_human(request, session, subject='Gặp tư vấn viên từ Trợ lý OHIO', first_msg='Xin chào, tôi muốn được tư vấn viên OHIO hỗ trợ.'):
    user = request.user if request.user.is_authenticated else None
    if not user or user.role != 'customer':
        return ('Để gặp tư vấn viên, bạn vui lòng đăng nhập tài khoản khách hàng. '
                'Sau khi đăng nhập, ca tư vấn sẽ được đưa vào hàng chờ CSKH.\n\n' + link('/login', 'Đăng nhập') + '\n' + link('/signup', 'Tạo tài khoản'))
    from .events import notify_roles
    from .firebase import sync_conversation
    with transaction.atomic():
        conv = Conversation.objects.filter(customer=user).exclude(status=Conversation.CLOSED).order_by('-updated_at').first()
        created = conv is None
        if created:
            conv = Conversation.objects.create(customer=user, subject=subject)
            Message.objects.create(conversation=conv, sender=user, text=first_msg)
    if created:
        try:
            notify_roles(['consultant', 'manager'], 'chat.created', 'Có hội thoại CSKH mới',
                         f'{user.get_full_name() or user.username} yêu cầu gặp tư vấn viên từ Trợ lý OHIO.', {'conversation_id': conv.pk})
        except Exception:
            logger.exception('notify failed')
        try:
            sync_conversation(conv, background=True)
        except Exception:
            logger.exception('sync failed')
        head = 'Mình đã chuyển yêu cầu của bạn vào hàng chờ CSKH. Tư vấn viên sẽ phản hồi trong ít phút.'
    else:
        head = 'Bạn đang có một ca tư vấn đang mở. Mình đưa bạn tới đúng cuộc trò chuyện đó nhé.'
    return head + '\n\n' + link(f'/chat?c={conv.pk}', 'Mở cuộc trò chuyện với CSKH')


def detect_intent(text):
    t = _plain(text)
    if re.search(r'\b(bac si|gap bs)\b', t):
        return 'doctor'
    if re.search(r'\b(tu van vien|nhan vien|cskh|gap nguoi that|nguoi that|tong dai)\b', t):
        return 'human'
    if re.search(r'\b(lich (hen )?(cua toi|cua minh|da dat|sap toi)|xem lich hen|lich hen cua)\b', t):
        return 'my_bookings'
    if re.search(r'\b(diem (thanh vien|tich luy|thuong|cua toi|cua minh)|bao nhieu diem|hang thanh vien)\b', t):
        return 'points'
    if re.search(r'\bvoucher (cua toi|cua minh|dang co|da doi)\b', t):
        return 'my_vouchers'
    if re.search(r'\b(khuyen mai|uu dai|voucher|giam gia|ma giam)\b', t):
        return 'promotions'
    if (re.search(r'\b(dat lich|hen lich|booking|dat hen|muon dat|dat duoc|con lich|con cho|lich trong|con trong)\b', t)
            or (re.search(r'\bdat\b', t) and re.search(r'\b(mai|hom nay|ngay|gio|\d+ ?h)\b', t))):
        return 'booking'
    if re.search(r'\b(dich vu|bang gia|gia dich vu|gia bao nhieu|bao nhieu tien|spa co gi|gia)\b', t):
        return 'services'
    return None


def match_faq(text):
    t = _plain(text)
    best, score = None, 0
    for faq in ChatbotFAQ.objects.filter(is_active=True):
        s = 0
        for kw in (faq.keywords or '').split(','):
            kw = _plain(kw)
            if kw and kw in t:
                s += len(kw)
        if _plain(faq.question) == t:
            s += 100
        if s > score:
            best, score = faq, s
    return best


# ---------------------------------------------------------------- AI
def _context():
    services = Service.objects.filter(is_active=True).order_by('name')[:25]
    today = timezone.localdate()
    vouchers = Voucher.objects.filter(is_active=True).filter(Q(expires_at__isnull=True) | Q(expires_at__gte=today))[:10]
    out = ['DỮ LIỆU THẬT CỦA OHIO (chỉ dùng thông tin này, không bịa thêm):', 'Dịch vụ:']
    out += [f'- {s.name}: {money(s.price)}, {s.duration} phút' for s in services] or ['- (chưa có)']
    out.append('Voucher đang chạy:')
    out += [f'- {v.title} ({v.code}): giảm {money(v.discount_value)}, đơn tối thiểu {money(v.min_spend)}' for v in vouchers] or ['- (không có)']
    faqs = ChatbotFAQ.objects.filter(is_active=True)[:15]
    if faqs:
        out.append('FAQ:')
        out += [f'- {f.question}: {f.answer}' for f in faqs]
    return '\n'.join(out)


def ai_answer(session, text, cfg):
    if not (cfg.ai_enabled and ai._key()):
        return None
    history = list(session.messages.order_by('-id')[:6])[::-1]
    convo = '\n'.join(f'{"Khách" if m.role == "user" else "Trợ lý"}: {m.content[:300]}' for m in history)
    system = cfg.system_prompt + '\n\n' + _context() + '\n\nQUY TẮC BẮT BUỘC: không chẩn đoán bệnh, không kê thuốc, không khẳng định kết quả điều trị, không tự nêu giá/khuyến mãi ngoài dữ liệu ở trên, không tự xác nhận hay tạo lịch hẹn (việc đặt lịch do hệ thống thực hiện khi khách bấm nút). Câu hỏi cần chuyên môn thì khuyên khách bấm "Gặp tư vấn viên". Trả lời tối đa 120 từ.'
    prompt = f'Lịch sử gần đây:\n{convo}\n\nCâu hỏi mới của khách: {text}'
    try:
        return ai._generate([{'text': prompt}], system_instruction=system)
    except Exception:
        logger.warning('Gemini error', exc_info=True)
        return None


# ---------------------------------------------------------------- điều phối
def _flow_continues(text):
    """Đang đặt lịch dở: câu mới có chứa ngày/giờ/dịch vụ thì coi là trả lời cho quy trình."""
    p = bk.parse_text(text)
    return bool(p.get('service') or p.get('date') or p.get('hhmm'))


def handle(request, session, text='', action=''):
    """Lưu tin khách + trả lời, trả về (user_msg, bot_msg, navigate)."""
    cfg = ChatbotSetting.load()
    navigate = ''
    key = action
    user_text = text.strip()[:MAX_INPUT]
    if bk.is_booking_action(action):
        user_text = (text.strip() or 'Đặt lịch')[:80]
    elif action in ACTION_LABELS:
        user_text = ACTION_LABELS[action]
    elif action.startswith('custom:'):
        from core.models import ChatbotQuickAction
        qa = ChatbotQuickAction.objects.filter(pk=action.split(':', 1)[1], is_active=True).first()
        if qa:
            if qa.action_type == 'url':
                user_text = qa.label
                bot = f'{qa.label}:\n\n' + link(qa.value, 'Mở')
                u = ChatbotMessage.objects.create(session=session, role='user', content=user_text)
                b = ChatbotMessage.objects.create(session=session, role='assistant', content=bot, source=ChatbotMessage.ACTION)
                return u, b, ''
            user_text, key = qa.value, ''
    if not user_text:
        return None, None, ''

    since = timezone.now() - timedelta(minutes=1)
    if session.messages.filter(role='user', created_at__gte=since).count() >= RATE_PER_MINUTE:
        b = ChatbotMessage.objects.create(session=session, role='assistant', content='Bạn nhắn hơi nhanh, vui lòng chờ một chút rồi thử lại nhé.', source=ChatbotMessage.ERROR)
        return None, b, ''

    user_msg = ChatbotMessage.objects.create(session=session, role='user', content=user_text)
    intent = key if key in ACTION_LABELS else detect_intent(user_text)
    source = ChatbotMessage.ACTION
    in_flow = bool(bk.get_state(session))
    if bk.is_booking_action(action):
        reply = bk.handle_action(request, session, action)
    elif intent == 'booking' or (in_flow and not intent and not bk.is_medical(user_text) and _flow_continues(user_text)):
        reply = bk.start_from_text(request, session, '' if key == 'booking' else user_text, fresh=(intent == 'booking' and not in_flow) or key == 'booking')
    elif intent == 'services':
        reply = (bk.reply_price(user_text) if key != 'services' else None) or reply_services()
    elif intent == 'promotions':
        reply = reply_promotions()
    elif intent == 'my_bookings':
        reply = bk.reply_my_bookings(request)
    elif intent == 'points':
        reply = bk.reply_points(request)
    elif intent == 'my_vouchers':
        reply = bk.reply_my_vouchers(request)
    elif intent == 'doctor':
        reply = reply_human(request, session, subject='Khách muốn gặp bác sĩ (từ Trợ lý OHIO)', first_msg='Xin chào, tôi muốn được bác sĩ/chuyên viên OHIO tư vấn.')
    elif intent == 'human':
        reply = reply_human(request, session)
    elif bk.is_medical(user_text):
        reply, source = bk.MEDICAL_REPLY, ChatbotMessage.ACTION
    else:
        faq = match_faq(user_text)
        if faq:
            reply, source = faq.answer, ChatbotMessage.FAQ
            ChatbotFAQ.objects.filter(pk=faq.pk).update(times_used=faq.times_used + 1)
        else:
            reply = ai_answer(session, user_text, cfg)
            source = ChatbotMessage.AI
            if not reply:
                reply, source = cfg.fallback_message, ChatbotMessage.FALLBACK
    bot_msg = ChatbotMessage.objects.create(session=session, role='assistant', content=reply[:5000], source=source)
    ChatbotSession.objects.filter(pk=session.pk).update(updated_at=timezone.now())
    return user_msg, bot_msg, navigate
