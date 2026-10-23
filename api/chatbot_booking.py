"""Quy trình đặt lịch nhiều bước + các ý định cần tài khoản của Trợ lý OHIO.

Nguyên tắc: AI KHÔNG tự sửa dữ liệu. Mọi giờ trống, nhân viên, giá đều lấy từ backend
(core.availability) và chỉ khi khách bấm [Xác nhận] mới tạo Booking qua BookingSerializer
(cùng bộ kiểm tra với trang /book). Trạng thái các bước lưu ở ChatbotSession.pending_action
nên đóng/mở popup hoặc đăng nhập giữa chừng vẫn đặt tiếp được.

Nút bấm trong tin nhắn dùng cú pháp  [[choice:HÀNH_ĐỘNG|Nhãn]]  (được lưu cùng lịch sử).
"""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import date, datetime, time, timedelta

from django.utils import timezone

from core.availability import available_slots, has_conflict, qualified_staff
from core.models import Booking, ChatbotToolCall, Service, Staff, VoucherRedemption

logger = logging.getLogger(__name__)

WEEKDAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']
MAX_DAYS = 6
MAX_TIMES = 12
LOOKAHEAD_DAYS = 21


def plain(text):
    text = unicodedata.normalize('NFD', (text or '').lower())
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn').replace('đ', 'd')
    return re.sub(r'\s+', ' ', text).strip()


def money(v):
    return f'{int(v or 0):,}'.replace(',', '.') + 'đ'


def link(url, label):
    return f'[[link:{url}|{label}]]'


def choice(action, label):
    return f'[[choice:{action}|{label}]]'


def day_label(d):
    today = timezone.localdate()
    prefix = {0: 'Hôm nay', 1: 'Ngày mai'}.get((d - today).days)
    return f'{prefix} {d:%d/%m}' if prefix else f'{WEEKDAYS[d.weekday()]} {d:%d/%m}'


# ---------------------------------------------------------------- trạng thái
def get_state(session):
    st = session.pending_action or {}
    return dict(st) if st.get('flow') == 'booking' else {}


def save_state(session, st):
    session.pending_action = st
    session.save(update_fields=['pending_action', 'updated_at'])


def clear_state(session):
    if session.pending_action:
        save_state(session, {})


def is_booking_action(action):
    return isinstance(action, str) and action.startswith('bk:')


# ---------------------------------------------------------------- dữ liệu thật
def _staff_for(service):
    return list(qualified_staff(Staff.objects.all(), [service.id]).prefetch_related('working_hours'))


def _slots_by_staff(service, day, staff_list=None):
    staff_list = staff_list if staff_list is not None else _staff_for(service)
    return {s.id: available_slots(s, day, service.duration or 60) for s in staff_list}


def _free_days(service, staff_list):
    today = timezone.localdate()
    out = []
    for i in range(LOOKAHEAD_DAYS):
        d = today + timedelta(days=i)
        if any(available_slots(s, d, service.duration or 60) for s in staff_list):
            out.append(d)
            if len(out) >= MAX_DAYS:
                break
    return out


def _pick_staff(service, start, staff_id=0):
    """Trả về Staff còn rảnh đúng giờ `start` (staff_id=0: bất kỳ), hoặc None."""
    dur = service.duration or 60
    pool = _staff_for(service)
    if staff_id:
        pool = [s for s in pool if s.id == staff_id]
    for s in pool:
        if not has_conflict(s, start, dur):
            return s
    return None


def _hhmm(dt):
    return timezone.localtime(dt).strftime('%H%M')


def _fmt_time(dt):
    return timezone.localtime(dt).strftime('%H:%M')


# ---------------------------------------------------------------- các bước
def step_services(session, head=None):
    rows = [s for s in Service.objects.filter(is_active=True).order_by('name')[:12] if qualified_staff(Staff.objects.all(), [s.id]).exists()][:8]
    if not rows:
        return 'Hiện chưa có dịch vụ nào nhận đặt lịch trực tuyến. Bạn có thể gặp tư vấn viên để được hỗ trợ.\n\n' + choice('human', 'Gặp tư vấn viên')
    save_state(session, {'flow': 'booking'})
    lines = [head or 'Bạn muốn sử dụng dịch vụ nào?'] + [''] + [choice(f'bk:svc:{s.id}', f'{s.name} · {money(s.price)}') for s in rows]
    lines += ['', link('/book', 'Mở trang đặt lịch đầy đủ')]
    return '\n'.join(lines)


def step_dates(session, st, head=None):
    service = Service.objects.filter(pk=st.get('service_id'), is_active=True).first()
    if not service:
        return step_services(session)
    days = _free_days(service, _staff_for(service))
    if not days:
        return (f'Rất tiếc, "{service.name}" hiện chưa còn lịch trống trong {LOOKAHEAD_DAYS} ngày tới. '
                'Bạn có thể chọn dịch vụ khác hoặc gặp tư vấn viên để được sắp xếp.\n\n'
                + choice('bk:edit', 'Chọn dịch vụ khác') + '\n' + choice('human', 'Gặp tư vấn viên'))
    save_state(session, {'flow': 'booking', 'service_id': service.id})
    lines = [head or f'Bạn muốn đến vào ngày nào cho dịch vụ "{service.name}" ({service.duration} phút)?', '']
    lines += [choice(f'bk:date:{d.isoformat()}', day_label(d)) for d in days]
    lines += ['', choice('bk:cancel', 'Hủy đặt lịch')]
    return '\n'.join(lines)


def step_staff(session, st):
    service = Service.objects.filter(pk=st.get('service_id'), is_active=True).first()
    day = _parse_iso_date(st.get('date'))
    if not service or not day:
        return step_services(session)
    staff_list = _staff_for(service)
    slots = _slots_by_staff(service, day, staff_list)
    avail = [s for s in staff_list if slots.get(s.id)]
    if not avail:
        return step_dates(session, st, head=f'Ngày {day:%d/%m} đã kín lịch. Bạn chọn ngày khác nhé:')
    lines = [f'Chuyên viên khả dụng ngày {day_label(day)}:', '', choice('bk:staff:0', 'Bất kỳ chuyên viên')]
    lines += [choice(f'bk:staff:{s.id}', f'{s.name}' + (f' · {s.position}' if s.position else '')) for s in avail]
    lines += ['', choice('bk:cancel', 'Hủy đặt lịch')]
    return '\n'.join(lines)


def step_times(session, st, head=None):
    service = Service.objects.filter(pk=st.get('service_id'), is_active=True).first()
    day = _parse_iso_date(st.get('date'))
    if not service or not day:
        return step_services(session)
    staff_list = _staff_for(service)
    if st.get('staff_id'):
        staff_list = [s for s in staff_list if s.id == st['staff_id']]
    seen = {}
    for slot_list in _slots_by_staff(service, day, staff_list).values():
        for sl in slot_list:
            seen.setdefault(_hhmm(sl), sl)
    slots = [seen[k] for k in sorted(seen)]
    if len(slots) > MAX_TIMES:  # rút gọn bước 30 phút để popup gọn
        half = [x for x in slots if timezone.localtime(x).minute in (0, 30)]
        slots = (half if len(half) >= 3 else slots)[:MAX_TIMES]
    if not slots:
        return step_dates(session, {**st, 'staff_id': 0}, head=f'Không còn giờ trống ngày {day:%d/%m}. Bạn chọn ngày khác nhé:')
    lines = [head or f'Các khung giờ còn trống ngày {day_label(day)}:', '']
    lines += [choice(f'bk:time:{_hhmm(x)}', _fmt_time(x)) for x in slots]
    lines += ['', choice('bk:cancel', 'Hủy đặt lịch')]
    return '\n'.join(lines)


def step_confirm(session, st):
    service = Service.objects.filter(pk=st.get('service_id'), is_active=True).first()
    start = _parse_iso_dt(st.get('time'))
    if not service or not start:
        return step_services(session)
    staff = _pick_staff(service, start, st.get('staff_id') or 0)
    if not staff:
        return step_times(session, {k: v for k, v in st.items() if k != 'time'}, head='Khung giờ đó vừa có người đặt. Bạn chọn giờ khác nhé:')
    st['staff_id'] = staff.id
    save_state(session, st)
    lines = [
        'XÁC NHẬN LỊCH HẸN', '',
        f'Dịch vụ: {service.name}',
        f'Ngày: {timezone.localtime(start):%d/%m/%Y}',
        f'Giờ: {_fmt_time(start)}',
        f'Chuyên viên: {staff.name}',
        f'Giá: {money(service.price)}', '',
        choice('bk:confirm', 'Xác nhận'), choice('bk:edit', 'Chỉnh sửa'), choice('bk:cancel', 'Hủy'),
    ]
    return '\n'.join(lines)


def step_for(session, st):
    """Đi tới bước kế tiếp còn thiếu thông tin."""
    if not st.get('service_id'):
        return step_services(session)
    if not st.get('date'):
        return step_dates(session, st)
    if st.get('time'):
        return step_confirm(session, st)
    if 'staff_id' not in st:
        return step_staff(session, st)
    return step_times(session, st)


# ---------------------------------------------------------------- tạo lịch thật
def do_confirm(request, session):
    user = request.user if request.user.is_authenticated else None
    st = get_state(session)
    service = Service.objects.filter(pk=st.get('service_id'), is_active=True).first()
    start = _parse_iso_dt(st.get('time'))
    if not (service and start and st.get('staff_id')):
        return 'Phiên đặt lịch đã hết hạn. Mình bắt đầu lại nhé.\n\n' + step_services(session)
    if not user or user.role != 'customer':
        return ('Bạn cần đăng nhập tài khoản khách hàng để xác nhận lịch hẹn. Thông tin bạn đã chọn vẫn được giữ lại, '
                'đăng nhập xong hãy mở lại Trợ lý OHIO và bấm Xác nhận.\n\n'
                + link('/login', 'Đăng nhập') + '\n' + link('/signup', 'Tạo tài khoản') + '\n' + choice('bk:confirm', 'Xác nhận'))
    from rest_framework.exceptions import ValidationError
    from .serializers import BookingSerializer
    from . import views
    ser = BookingSerializer(data={
        'appointment': start.isoformat(), 'service_ids': [service.id], 'staff': st['staff_id'],
        'note': 'Đặt lịch qua Trợ lý OHIO',
    }, context={'request': request})
    try:
        ser.is_valid(raise_exception=True)
        booking = ser.save()
    except ValidationError as exc:
        ChatbotToolCall.objects.create(session=session, tool_name='create_booking', arguments={'service': service.id, 'time': st.get('time')}, result={'error': str(exc.detail)[:300]}, success=False)
        return 'Mình chưa tạo được lịch này (giờ có thể vừa được đặt). Bạn chọn lại giờ nhé:\n\n' + step_times(
            session, {k: v for k, v in st.items() if k not in ('time', 'staff_id')})
    try:
        views.after_booking_created(booking, request)
    except Exception:
        logger.exception('booking side effects failed')
    ChatbotToolCall.objects.create(session=session, tool_name='create_booking', arguments={'service': service.id, 'time': st.get('time'), 'staff': st['staff_id']}, result={'booking_id': booking.pk}, success=True)
    clear_state(session)
    return (f'Đặt lịch thành công! Lịch hẹn #{booking.pk} đang chờ xác nhận.\n\n'
            f'Dịch vụ: {service.name}\nThời gian: {_fmt_time(start)} ngày {timezone.localtime(start):%d/%m/%Y}\n'
            f'Chuyên viên: {booking.staff.name if booking.staff else "—"}\nMã vé: {booking.confirm_code}\n\n'
            + link('/bookings', 'Xem lịch của tôi'))


# ---------------------------------------------------------------- điều phối hành động bk:*
def handle_action(request, session, action):
    """Trả về nội dung trả lời cho một nút bk:*. Dữ liệu từ nút luôn được kiểm tra lại."""
    parts = action.split(':')
    kind = parts[1] if len(parts) > 1 else ''
    arg = parts[2] if len(parts) > 2 else ''
    st = get_state(session)
    if kind == 'cancel':
        clear_state(session)
        return 'Mình đã hủy phiên đặt lịch. Cần gì thêm bạn cứ nhắn nhé.'
    if kind == 'edit':
        return step_services(session, head='Bạn muốn chỉnh lại. Chọn dịch vụ nhé:')
    if kind == 'confirm':
        return do_confirm(request, session)
    if kind == 'svc':
        svc = Service.objects.filter(pk=arg if arg.isdigit() else 0, is_active=True).first()
        if not svc:
            return step_services(session)
        return step_for(session, {'flow': 'booking', 'service_id': svc.id})
    if not st.get('service_id'):
        return step_services(session, head='Phiên đặt lịch đã hết hạn, bạn chọn lại dịch vụ nhé:')
    if kind == 'date':
        d = _parse_iso_date(arg)
        if not d or d < timezone.localdate():
            return step_dates(session, st)
        st = {'flow': 'booking', 'service_id': st['service_id'], 'date': d.isoformat()}
        save_state(session, st)
        return step_for(session, st)
    if kind == 'staff':
        if not st.get('date'):
            return step_for(session, st)
        st['staff_id'] = int(arg) if arg.isdigit() else 0
        st.pop('time', None)
        save_state(session, st)
        return step_for(session, st)
    if kind == 'time':
        d = _parse_iso_date(st.get('date'))
        if not d or not re.fullmatch(r'\d{4}', arg):
            return step_for(session, st)
        start = _make_dt(d, int(arg[:2]), int(arg[2:]))
        if not start:
            return step_for(session, st)
        st['time'] = start.isoformat()
        save_state(session, st)
        return step_for(session, st)
    return step_services(session)


# ---------------------------------------------------------------- hiểu câu nói tự nhiên (không cần AI)
def _parse_iso_date(v):
    try:
        return date.fromisoformat(v) if v else None
    except ValueError:
        return None


def _parse_iso_dt(v):
    try:
        dt = datetime.fromisoformat(v) if v else None
    except ValueError:
        return None
    return timezone.make_aware(dt) if dt and timezone.is_naive(dt) else dt


def _make_dt(d, h, m):
    if not (0 <= h < 24 and 0 <= m < 60):
        return None
    return timezone.make_aware(datetime.combine(d, time(h, m)), timezone.get_current_timezone())


def parse_text(text):
    """Trích dịch vụ / ngày / giờ từ câu nói. Chỉ để ĐIỀN SẴN, mọi thứ vẫn được kiểm tra với backend."""
    t = plain(text)
    out = {}
    today = timezone.localdate()
    if re.search(r'\bhom nay\b', t):
        out['date'] = today
    elif re.search(r'\b(ngay kia|ngay mot)\b', t):
        out['date'] = today + timedelta(days=2)
    elif re.search(r'\b(ngay mai|mai)\b', t):
        out['date'] = today + timedelta(days=1)
    else:
        m = re.search(r'\b(\d{1,2})\s*/\s*(\d{1,2})(?:\s*/\s*(\d{4}))?\b', t)
        if m:
            try:
                d = date(int(m.group(3) or today.year), int(m.group(2)), int(m.group(1)))
                if d < today and not m.group(3):
                    d = d.replace(year=d.year + 1)
                out['date'] = d
            except ValueError:
                pass
    m = re.search(r'\b(\d{1,2})\s*(?:h|gio|:)\s*(\d{1,2})?\b', t)
    if m:
        h, mi = int(m.group(1)), int(m.group(2) or 0)
        if h < 12 and re.search(r'\b(chieu|toi)\b', t):
            h += 12
        if 0 <= h < 24 and 0 <= mi < 60:
            out['hhmm'] = (h, mi)
    svc = match_service(text)
    if svc:
        out['service'] = svc
    return out


_STOP = {'dich', 'vu', 'dieu', 'cham', 'soc', 'goi', 'lieu', 'trinh', 'test'}


def match_service(text):
    """Khớp dịch vụ theo tên đầy đủ, hoặc theo từ khóa đặc trưng (chỉ nhận khi không mơ hồ)."""
    t = plain(text)
    scored = []
    for s in Service.objects.filter(is_active=True):
        name = plain(s.name)
        if not name:
            continue
        if name in t:
            scored.append((1000 + len(name), s))
            continue
        toks = [w for w in re.split(r'\W+', name) if len(w) >= 3 and w not in _STOP]
        hit = sum(1 for w in toks if re.search(rf'\b{re.escape(w)}\b', t))
        if hit:
            scored.append((hit * 10 + hit / max(len(toks), 1), s))
    if not scored:
        return None
    scored.sort(key=lambda x: -x[0])
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return None
    return scored[0][1]


def start_from_text(request, session, text, fresh=False):
    """Bắt đầu/tiếp tục đặt lịch từ câu nói, điền sẵn những gì hiểu được."""
    parsed = parse_text(text)
    st = {} if fresh else get_state(session)
    st['flow'] = 'booking'
    if parsed.get('service'):
        if st.get('service_id') != parsed['service'].id:
            st = {'flow': 'booking'}
        st['service_id'] = parsed['service'].id
    if parsed.get('date') and st.get('service_id'):
        st['date'] = parsed['date'].isoformat()
        st.pop('staff_id', None)
        st.pop('time', None)
    if parsed.get('hhmm') and st.get('date') and st.get('service_id'):
        service = Service.objects.get(pk=st['service_id'])
        start = _make_dt(_parse_iso_date(st['date']), *parsed['hhmm'])
        if start and start > timezone.now() + timedelta(minutes=30) and _pick_staff(service, start, 0):
            st['time'] = start.isoformat()
            st['staff_id'] = 0
        elif start:
            st['staff_id'] = 0
            save_state(session, st)
            return step_times(session, st, head=f'Khung giờ {parsed["hhmm"][0]:02d}:{parsed["hhmm"][1]:02d} không còn trống. Các giờ còn lại ngày {day_label(_parse_iso_date(st["date"]))}:')
    save_state(session, st)
    return step_for(session, st)


# ---------------------------------------------------------------- ý định cần tài khoản
def _need_login(what):
    return (f'Bạn vui lòng đăng nhập tài khoản khách hàng để xem {what}.\n\n' + link('/login', 'Đăng nhập') + '\n' + link('/signup', 'Tạo tài khoản'))


def _customer(request):
    u = request.user if request.user.is_authenticated else None
    return u if u and u.role == 'customer' else None


def reply_my_bookings(request):
    user = _customer(request)
    if not user:
        return _need_login('lịch hẹn của bạn')
    rows = list(Booking.objects.filter(user=user, appointment__gte=timezone.now()).exclude(status=Booking.CANCELLED)
                .prefetch_related('items__service').select_related('staff').order_by('appointment')[:5])
    if not rows:
        return 'Bạn chưa có lịch hẹn sắp tới nào.\n\n' + choice('booking', 'Đặt lịch')
    lines = ['Lịch hẹn sắp tới của bạn:']
    for b in rows:
        names = ', '.join(i.service.name for i in b.items.all()) or 'Dịch vụ'
        lines.append(f'• {timezone.localtime(b.appointment):%H:%M %d/%m/%Y} · {names} · {b.get_status_display()}')
    return '\n'.join(lines) + '\n\n' + link('/bookings', 'Xem tất cả lịch hẹn')


def reply_points(request):
    user = _customer(request)
    if not user:
        return _need_login('điểm thành viên')
    return f'Bạn đang có {user.loyalty_points:,} điểm thành viên.'.replace(',', '.') + '\n\n' + link('/vouchers', 'Đổi điểm lấy voucher')


def reply_my_vouchers(request):
    user = _customer(request)
    if not user:
        return _need_login('voucher của bạn')
    rows = list(VoucherRedemption.objects.filter(user=user, status=VoucherRedemption.AVAILABLE).select_related('voucher')[:8])
    if not rows:
        return 'Bạn chưa có voucher nào chưa dùng. Bạn có thể dùng điểm để đổi voucher.\n\n' + link('/vouchers', 'Đổi điểm lấy voucher')
    lines = ['Voucher của bạn (chưa sử dụng):']
    for r in rows:
        v = r.voucher
        lines.append(f'• {v.title} ({v.code}): giảm {money(v.discount_value)}, đơn tối thiểu {money(v.min_spend)}')
    return '\n'.join(lines)


def reply_price(text):
    svc = match_service(text)
    if not svc:
        return None
    return f'{svc.name}: {money(svc.price)} · {svc.duration} phút.\n\n' + choice(f'bk:svc:{svc.id}', 'Đặt lịch dịch vụ này')


MEDICAL_RE = re.compile(r'\b(chan doan|ke don|thuoc|benh|di ung|mang thai|co bau|dang bau|bien chung|nhiem trung|man do|sung tay|chay mau|tac dung phu|tuong tac)\b')


def is_medical(text):
    return bool(MEDICAL_RE.search(plain(text)))


MEDICAL_REPLY = ('Vấn đề này cần chuyên môn của bác sĩ/chuyên viên, nên mình không đưa ra chẩn đoán hay hướng dẫn điều trị qua chatbot để đảm bảo an toàn cho bạn. '
                 'Mình có thể chuyển bạn cho tư vấn viên OHIO để được hỗ trợ trực tiếp.\n\n' + choice('human', 'Gặp tư vấn viên'))
