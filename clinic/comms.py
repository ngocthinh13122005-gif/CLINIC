"""Gửi email / SMS cho bệnh nhân. SMS thật cần nhà cung cấp: đặt SMS_BACKEND trong settings/.env."""
import html as htmllib
import logging
import re
from html.parser import HTMLParser

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone

from .models import PatientMessage

log = logging.getLogger(__name__)

TEMPLATES = [
    {'key': 'reminder', 'name': 'Nhắc lịch hẹn', 'subject': 'Nhắc lịch hẹn tại {{phong_kham}}',
     'body': 'Chào {{ten_khach}}, {{phong_kham}} xin nhắc bạn có lịch hẹn: {{lich_hen}}. Nếu cần đổi lịch, vui lòng phản hồi tin nhắn này. Hẹn gặp bạn!'},
    {'key': 'aftercare', 'name': 'Chăm sóc sau điều trị', 'subject': 'Hướng dẫn chăm sóc sau điều trị',
     'body': 'Chào {{ten_khach}}, cảm ơn bạn đã tin tưởng {{phong_kham}}. Bạn nhớ giữ da sạch, dùng kem chống nắng và liên hệ phòng khám nếu có dấu hiệu bất thường.'},
    {'key': 'birthday', 'name': 'Chúc mừng sinh nhật', 'subject': 'Chúc mừng sinh nhật từ {{phong_kham}}',
     'body': 'Chúc mừng sinh nhật {{ten_khach}}! {{phong_kham}} chúc bạn một ngày thật nhiều niềm vui và làn da khỏe đẹp.'},
]
MERGE_TAGS = [('ten_khach', 'Tên khách'), ('ma_khach', 'Mã khách'), ('lich_hen', 'Lịch hẹn kế tiếp'), ('phong_kham', 'Tên phòng khám')]


def clinic_name():
    return getattr(settings, 'CLINIC_NAME', 'AkinaClinic')


def merge_values(patient):
    from core.models import Booking
    nxt = (Booking.objects.filter(patient_id=patient.id, appointment__gte=timezone.now())
           .exclude(status__in=['cancelled']).order_by('appointment').first())
    lich = timezone.localtime(nxt.appointment).strftime('%H:%M %d/%m/%Y') if nxt else '(chưa có lịch sắp tới)'
    return {'ten_khach': patient.full_name, 'ma_khach': patient.code, 'lich_hen': lich, 'phong_kham': clinic_name()}


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


ALLOWED = {'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote', 'div', 'span'}


class _Clean(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        elif tag in ALLOWED and not self.skip:
            extra = ''
            if tag == 'a':
                href = dict(attrs).get('href', '')
                if re.match(r'^(https?://|mailto:)', href or '', re.I):
                    extra = f' href="{htmllib.escape(href, quote=True)}" target="_blank" rel="noopener noreferrer"'
            self.out.append(f'<{tag}{extra}>')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
        elif tag in ALLOWED and tag != 'br' and not self.skip:
            self.out.append(f'</{tag}>')

    def handle_data(self, data):
        if not self.skip:
            self.out.append(htmllib.escape(data))


def sanitize_html(src):
    p = _Clean()
    p.feed(src or '')
    p.close()
    return ''.join(p.out)


def html_to_text(src):
    t = re.sub(r'<br\s*/?>|</(p|div|li|h2|h3|blockquote)>', '\n', src or '', flags=re.I)
    return htmllib.unescape(re.sub(r'<[^>]+>', '', t)).strip()


def wrap_email(body_html, patient):
    name = htmllib.escape(clinic_name())
    return (f'<div style="background:#f3f6f9;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#26323d">'
            f'<div style="max-width:560px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.12)">'
            f'<div style="padding:20px 28px;border-bottom:3px solid #0f7c8a"><b style="font-size:20px;color:#0f7c8a">{name}</b>'
            f'<div style="font-size:12px;color:#6b7a86">Phòng khám da liễu</div></div>'
            f'<div style="padding:24px 28px;font-size:15px;line-height:1.6">{body_html}</div>'
            f'<div style="padding:14px 28px;background:#f8fafb;font-size:12px;color:#7a8791">Email này gửi riêng cho bạn. '
            f'Vui lòng không chuyển tiếp nếu có thông tin cá nhân.</div></div></div>')


def _email_is_real():
    return not str(settings.EMAIL_BACKEND).endswith('console.EmailBackend')


def send_email(patient, subject, body_html, user):
    if not patient.email:
        raise ValueError('Bệnh nhân chưa có email.')
    values = merge_values(patient)
    subject = render_tags(subject, values).strip()
    clean = sanitize_html(render_tags(body_html, values))
    text = html_to_text(clean)
    if not subject or not text:
        raise ValueError('Cần nhập tiêu đề và nội dung.')
    msg = PatientMessage(patient=patient, channel=PatientMessage.EMAIL, subject=subject[:200], body=text, body_html=clean,
                         from_address=settings.DEFAULT_FROM_EMAIL, to_address=patient.email, sent_by=user)
    try:
        mail = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, [patient.email])
        mail.attach_alternative(wrap_email(clean, patient), 'text/html')
        mail.send(fail_silently=False)
        msg.status = PatientMessage.SENT if _email_is_real() else PatientMessage.SIMULATED
    except Exception as exc:  # lỗi SMTP không được làm hỏng request
        log.warning('send email failed: %s', exc)
        msg.status, msg.error = PatientMessage.FAILED, str(exc)[:250]
    msg.save()
    return msg


def _sms_backend():
    return getattr(settings, 'SMS_BACKEND', '') or ''


def send_sms(patient, text, user):
    phone = normalize_phone(patient.phone)
    text = render_tags(text, merge_values(patient)).strip()
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
