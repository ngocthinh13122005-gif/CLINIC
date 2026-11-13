"""Gửi email / SMS cho bệnh nhân. SMS thật cần nhà cung cấp: đặt SMS_BACKEND trong settings/.env."""
import html as htmllib
import logging
import re
from datetime import timezone as dt_tz

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone

from . import emailkit
from .models import Patient, PatientMessage

log = logging.getLogger(__name__)

MERGE_TAGS = [('ten_khach', 'Tên khách'), ('ma_khach', 'Mã khách'), ('lich_hen', 'Lịch hẹn kế tiếp'), ('phong_kham', 'Tên phòng khám'),
              ('hotline', 'Hotline phòng khám'), ('dia_chi', 'Địa chỉ phòng khám'), ('nguoi_gui', 'Người gửi'), ('ngay_hom_nay', 'Ngày hôm nay')]


def clinic_name():
    return getattr(settings, 'CLINIC_NAME', 'AkinaClinic')


def merge_values(patient, user=None):
    from core.models import Booking
    nxt = (Booking.objects.filter(patient_id=patient.id, appointment__gte=timezone.now())
           .exclude(status__in=['cancelled']).order_by('appointment').first())
    lich = timezone.localtime(nxt.appointment).strftime('%H:%M %d/%m/%Y') if nxt else '(chưa có lịch sắp tới)'
    c = emailkit.clinic()
    return {'ten_khach': patient.full_name, 'ma_khach': patient.code, 'lich_hen': lich, 'phong_kham': c['name'],
            'hotline': c['phone'] or '(liên hệ phòng khám)', 'dia_chi': c['address'] or '', 'dia_chi_dong': f" — {c['address']}" if c['address'] else '',
            'nguoi_gui': (user.get_full_name() or user.username) if user else c['name'], 'ngay_hom_nay': timezone.localdate().strftime('%d/%m/%Y')}


def render_tags(text, values):
    return re.sub(r'\{\{\s*(\w+)\s*\}\}', lambda m: str(values.get(m.group(1), m.group(0))), text or '')


def normalize_phone(raw):
    d = re.sub(r'\D', '', raw or '')
    if d.startswith('84') and len(d) >= 11:
        d = '0' + d[2:]
    if not re.fullmatch(r'0\d{9}', d):
        raise ValueError('Số điện thoại không hợp lệ (cần 10 số, bắt đầu bằng 0).')
    return d


def sms_segments(text):
    n = len(text or '')
    if not n:
        return 0
    ascii_only = all(ord(c) < 128 for c in text)
    single, multi = (160, 153) if ascii_only else (70, 67)
    return 1 if n <= single else -(-n // multi)


def sanitize_html(src):
    return emailkit.clean(src)


def html_to_text(src):
    t = re.sub(r'<br\s*/?>|</(p|div|li|h2|h3|blockquote)>', '\n', src or '', flags=re.I)
    return htmllib.unescape(re.sub(r'<[^>]+>', '', t)).strip()


def wrap_email(body_html, patient, heading='', preheader=''):
    """Khung email chuyên nghiệp (xem emailkit.layout)."""
    return emailkit.layout(heading or clinic_name(), emailkit.fragment_to_html(body_html), preheader=preheader)


def patient_for_booking(booking):
    """Tìm hồ sơ bệnh nhân ứng với một lịch hẹn (theo tài khoản, email rồi số điện thoại)."""
    q = Patient.objects.all()
    if booking.user_id and (p := q.filter(user_id=booking.user_id).first()):
        return p
    if booking.customer_email and (p := q.filter(email__iexact=booking.customer_email).first()):
        return p
    phone = re.sub(r'\D', '', booking.customer_phone or '')
    return q.filter(phone=phone).first() if phone else None


def log_booking_email(booking, subject, text, html, to_address):
    """Ghi email xác nhận / đổi / hủy lịch vào tab Liên lạc của bệnh nhân (nếu tìm được hồ sơ)."""
    patient = patient_for_booking(booking)
    if not patient:
        return None
    return PatientMessage.objects.create(patient=patient, channel=PatientMessage.EMAIL, subject=subject[:200], body=text,
                                         body_html=html, from_address=settings.DEFAULT_FROM_EMAIL, to_address=to_address,
                                         status=PatientMessage.SENT)


def _email_is_real():
    return not str(settings.EMAIL_BACKEND).endswith('console.EmailBackend')


def booking_ics(booking):
    start = booking.appointment.astimezone(dt_tz.utc)
    end = start + timezone.timedelta(minutes=booking.duration_minutes or 60)
    f = lambda d: d.strftime('%Y%m%dT%H%M%SZ')
    c = emailkit.clinic()
    services = ', '.join(i.service.name for i in booking.items.select_related('service')) or 'Lịch hẹn'
    esc = lambda t: str(t).replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\n', '\\n')
    return ('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AkinaClinic//VN\r\nBEGIN:VEVENT\r\n'
            f'UID:booking-{booking.id}@akinaclinic\r\nDTSTAMP:{f(timezone.now())}\r\nDTSTART:{f(start)}\r\nDTEND:{f(end)}\r\n'
            f'SUMMARY:{esc(services + " tại " + c["name"])}\r\nLOCATION:{esc(c["address"])}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')


def _emails(raw):
    out = []
    for e in (raw or []):
        e = str(e).strip()
        if e:
            if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', e):
                raise ValueError(f'Địa chỉ email không hợp lệ: {e}')
            out.append(e)
    return out


def from_options(user):
    base = settings.DEFAULT_FROM_EMAIL
    addr = re.search(r'<([^>]+)>', base)
    addr = addr.group(1) if addr else base
    opts = [{'name': clinic_name(), 'email': addr}]
    if user and (user.get_full_name() or '').strip():
        opts.append({'name': f"{user.get_full_name()} ({clinic_name()})", 'email': addr})
    return opts


def send_email(patient, subject, body_html, user, *, cc=None, bcc=None, to=None, from_name='', booking_ids=(), follow_up=False):
    to = _emails(to) or ([patient.email] if patient.email else [])
    if not to:
        raise ValueError('Bệnh nhân chưa có email.')
    cc, bcc = _emails(cc), _emails(bcc)
    values = merge_values(patient, user)
    subject = render_tags(subject, values).strip()
    clean = sanitize_html(render_tags(body_html, values))
    text = html_to_text(clean)
    if not subject or not text:
        raise ValueError('Cần nhập tiêu đề và nội dung.')
    sender = next((o for o in from_options(user) if o['name'] == from_name), from_options(user)[0])
    from_addr = f"{sender['name']} <{sender['email']}>"
    msg = PatientMessage(patient=patient, channel=PatientMessage.EMAIL, subject=subject[:200], body=text, body_html=clean,
                         from_address=from_addr, to_address=', '.join(to), cc=', '.join(cc), bcc=', '.join(bcc), sent_by=user)
    try:
        mail = EmailMultiAlternatives(subject, text, from_addr, to, cc=cc, bcc=bcc)
        mail.attach_alternative(wrap_email(clean, patient, subject), 'text/html')
        from core.models import Booking
        for b in Booking.objects.filter(pk__in=list(booking_ids), patient_id=patient.id):
            mail.attach(f'lich-hen-{b.id}.ics', booking_ics(b), 'text/calendar')
        mail.send(fail_silently=False)
        msg.status = PatientMessage.SENT if _email_is_real() else PatientMessage.SIMULATED
    except Exception as exc:  # lỗi SMTP không được làm hỏng request
        log.warning('send email failed: %s', exc)
        msg.status, msg.error = PatientMessage.FAILED, str(exc)[:250]
    msg.save()
    if follow_up:
        from .models import CareTask
        CareTask.objects.create(patient=patient, kind=CareTask.OTHER, title=f'Theo dõi phản hồi: {subject}'[:200],
                                due_date=timezone.localdate() + timezone.timedelta(days=2), assigned_to=user, created_by=user)
    return msg


def _sms_backend():
    return getattr(settings, 'SMS_BACKEND', '') or ''


def send_sms(patient, text, user):
    phone = normalize_phone(patient.phone)
    text = render_tags(text, merge_values(patient, user)).strip()
    if not text:
        raise ValueError('Nội dung tin nhắn trống.')
    msg = PatientMessage(patient=patient, channel=PatientMessage.SMS, body=text, from_address=clinic_name(), to_address=phone, sent_by=user)
    backend = _sms_backend()
    if not backend:
        msg.status = PatientMessage.SIMULATED
        log.info('[SMS giả lập] %s: %s', phone, text)
    else:
        try:
            from importlib import import_module
            mod, func = backend.rsplit('.', 1)
            getattr(import_module(mod), func)(phone, text)
            msg.status = PatientMessage.SENT
        except Exception as exc:
            log.warning('send sms failed: %s', exc)
            msg.status, msg.error = PatientMessage.FAILED, str(exc)[:250]
    msg.save()
    return msg
