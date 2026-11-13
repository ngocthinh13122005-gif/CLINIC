"""Email/QR notifications for AkinaClinic bookings.

Sending is intentionally best-effort: a temporary SMTP problem must never rollback or
break a booking that was already created in the database.
"""
from __future__ import annotations

import io
import logging
import threading
from html import escape
from email.mime.image import MIMEImage

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import close_old_connections
from django.utils import timezone

from .models import Booking

logger = logging.getLogger(__name__)


def _confirmation_url(booking: Booking, absolute_url: str | None = None) -> str:
    if absolute_url:
        return absolute_url
    base = getattr(settings, 'FRONTEND_BASE_URL', 'http://localhost:5173').rstrip('/')
    return f'{base}/ticket/{booking.confirm_code}'


def _qr_png_bytes(text: str) -> bytes:
    import qrcode

    qr = qrcode.QRCode(version=None, box_size=7, border=3)
    qr.add_data(text)
    qr.make(fit=True)
    image = qr.make_image(fill_color='#0f2a4a', back_color='white').convert('RGB')
    buffer = io.BytesIO()
    image.save(buffer, format='PNG', optimize=True)
    return buffer.getvalue()


def _subject(event: str, booking: Booking) -> str:
    prefix = {
        'created': 'Xác nhận yêu cầu đặt lịch',
        'confirmed': 'Lịch hẹn đã được xác nhận',
        'rescheduled': 'Lịch hẹn đã được thay đổi',
        'cancelled': 'Lịch hẹn đã được hủy',
    }.get(event, 'Thông tin lịch hẹn')
    return f'AkinaClinic — {prefix} — {booking.confirm_code}'


def _event_heading(event: str) -> str:
    return {
        'created': 'AkinaClinic đã nhận yêu cầu đặt lịch của bạn',
        'confirmed': 'Lịch hẹn AkinaClinic của bạn đã được xác nhận',
        'rescheduled': 'Lịch hẹn AkinaClinic của bạn đã được cập nhật',
        'cancelled': 'Lịch hẹn AkinaClinic của bạn đã được hủy',
    }.get(event, 'Thông tin lịch hẹn AkinaClinic')


def send_booking_email(booking_id: int, *, confirmation_url: str | None = None, event: str = 'created') -> bool:
    """Send one branded HTML booking email. Returns False when there is no recipient/config."""
    close_old_connections()
    try:
        booking = (
            Booking.objects.select_related('user', 'staff')
            .prefetch_related('items__service')
            .get(pk=booking_id)
        )
        recipient = (booking.customer_email or '').strip()
        if not recipient:
            return False

        url = _confirmation_url(booking, confirmation_url)
        services = ', '.join(item.service.name for item in booking.items.all()) or 'Dịch vụ AkinaClinic'
        appointment = timezone.localtime(booking.appointment)
        heading = _event_heading(event)
        status = booking.get_status_display()
        staff_name = booking.staff.name if booking.staff else 'AkinaClinic sẽ sắp xếp'
        if booking.total:
            amount = f'{booking.total:,}đ'.replace(',', '.')
        elif booking.appointment_type == Booking.APPOINTMENT_TYPE_SESSION:
            amount = 'Đã bao gồm trong gói liệu trình'
        elif booking.appointment_type == Booking.APPOINTMENT_TYPE_CONSULT:
            amount = 'Phí khám được thông báo sau khi bác sĩ tư vấn'
        elif booking.appointment_type == Booking.APPOINTMENT_TYPE_FOLLOW_UP:
            amount = 'Phí tái khám được xác nhận tại phòng khám'
        elif booking.discount_total:
            amount = 'Đã áp dụng ưu đãi — không phát sinh thanh toán'
        else:
            amount = 'Chưa phát sinh khoản thu khi đặt lịch'

        text_body = (
            f'{heading}\n\n'
            f'Mã xác nhận: {booking.confirm_code}\n'
            f'Dịch vụ: {services}\n'
            f'Ngày giờ: {appointment.strftime("%d/%m/%Y %H:%M")}\n'
            f'Chuyên viên: {staff_name}\n'
            f'Trạng thái: {status}\n'
            f'Chi phí: {amount}\n\n'
            f'Vé điện tử: {url}\n\n'
            'Vui lòng xuất trình mã hoặc QR khi đến AkinaClinic.'
        )
        customer_name = escape(booking.customer_name)
        safe_services = escape(services)
        safe_staff_name = escape(staff_name)
        safe_status = escape(status)
        safe_amount = escape(amount)
        safe_confirm_code = escape(booking.confirm_code)
        safe_url = escape(url, quote=True)
        appointment_text = appointment.strftime('%d/%m/%Y %H:%M')
        from clinic import emailkit
        e = emailkit.esc
        rows = [('Dịch vụ', safe_services), ('Ngày giờ', appointment_text), ('Chuyên viên', safe_staff_name),
                ('Trạng thái', safe_status), ('Chi phí', safe_amount)]
        inner = (
            f'<p style="margin:0 0 14px;font-size:15px;line-height:25px">Xin chào <strong>{customer_name}</strong>,</p>'
            '<p style="margin:0 0 6px;font-size:15px;line-height:25px">Dưới đây là thông tin lịch hẹn của bạn tại AkinaClinic:</p>'
            + emailkit.details_table(rows)
            + emailkit.callout(
                '<div style="font-size:12px;letter-spacing:1px;font-weight:700;color:#385866">MÃ VÉ / MÃ XÁC NHẬN</div>'
                f'<div style="margin-top:4px;font-size:26px;line-height:34px;font-weight:800;letter-spacing:3px;color:#123d47;word-break:break-all">{safe_confirm_code}</div>')
            + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding-top:6px">'
            '<img src="cid:ohio-booking-qr" width="170" height="170" alt="QR check-in AkinaClinic" style="display:block;width:170px;height:170px;max-width:100%;border:0" />'
            '<p style="margin:8px 0 0;font-size:12px;line-height:18px;color:#6b7c88">Quét QR hoặc mở vé điện tử để check-in.</p></td></tr>'
            f'<tr><td align="center">{emailkit.button(url, "Mở vé điện tử")}</td></tr></table>'
            '<p style="margin:0 0 14px;font-size:13px;line-height:21px;color:#6b7c88">Vui lòng xuất trình mã hoặc QR khi đến phòng khám. Nếu cần đổi lịch, hãy phản hồi email này hoặc liên hệ hotline.</p>')
        html_body = emailkit.layout(heading, inner, eyebrow='Lịch hẹn', preheader=f'Mã xác nhận {booking.confirm_code} · {appointment_text}')

        email = EmailMultiAlternatives(
            subject=_subject(event, booking),
            body=text_body,
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
            to=[recipient],
        )
        email.attach_alternative(html_body, 'text/html')
        qr_part = MIMEImage(_qr_png_bytes(url), _subtype='png')
        qr_part.add_header('Content-ID', '<ohio-booking-qr>')
        qr_part.add_header('Content-Disposition', 'inline', filename=f'AkinaClinic-{booking.confirm_code}-QR.png')
        email.attach(qr_part)
        email.send(fail_silently=False)
        try:  # hiện trên tab Liên lạc của hồ sơ bệnh nhân; lỗi ở đây không được làm hỏng việc gửi mail
            from clinic.comms import log_booking_email
            log_booking_email(booking, email.subject, text_body, html_body, recipient)
        except Exception:
            logger.exception('Could not log booking email for booking_id=%s', booking_id)
        return True
    except Exception:
        logger.exception('AkinaClinic booking email failed for booking_id=%s', booking_id)
        return False
    finally:
        close_old_connections()


def queue_booking_email(booking_id: int, *, confirmation_url: str | None = None, event: str = 'created') -> None:
    """Send in a daemon thread so SMTP latency does not slow down the booking/chat response."""
    if not getattr(settings, 'EMAIL_HOST_USER', ''):
        return
    if not getattr(settings, 'EMAIL_BACKEND', '').endswith('smtp.EmailBackend'):
        return
    thread = threading.Thread(
        target=send_booking_email,
        kwargs={'booking_id': booking_id, 'confirmation_url': confirmation_url, 'event': event},
        name=f'ohio-booking-email-{booking_id}',
        daemon=True,
    )
    thread.start()
