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
        html_body = f'''<!doctype html>
<html><body style="margin:0;padding:0;background-color:#f1f5f7;font-family:Arial,Helvetica,sans-serif;color:#243746">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f7">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #d9e3e8">
      <tr><td bgcolor="#0a5964" style="padding:24px 28px;background-color:#0a5964;color:#ffffff">
        <div style="font-size:12px;line-height:18px;font-weight:bold;letter-spacing:1px;color:#d9f0f1">AKINACLINIC</div>
        <h1 style="margin:8px 0 0;font-size:21px;line-height:29px;font-weight:700;color:#ffffff">{escape(heading)}</h1>
      </td></tr>
      <tr><td style="padding:24px 28px">
        <p style="margin:0 0 12px;font-size:15px;line-height:23px;color:#243746">Xin chào <strong>{customer_name}</strong>,</p>
        <p style="margin:0 0 16px;font-size:14px;line-height:22px;color:#435767">Thông tin lịch hẹn của bạn tại AkinaClinic:</p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:21px">
          <tr><td style="padding:9px 0;border-bottom:1px solid #e6ecef;color:#526777">Dịch vụ</td><td align="right" style="padding:9px 0;border-bottom:1px solid #e6ecef;color:#243746;font-weight:bold">{safe_services}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #e6ecef;color:#526777">Ngày giờ</td><td align="right" style="padding:9px 0;border-bottom:1px solid #e6ecef;color:#243746;font-weight:bold">{appointment_text}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #e6ecef;color:#526777">Chuyên viên</td><td align="right" style="padding:9px 0;border-bottom:1px solid #e6ecef;color:#243746">{safe_staff_name}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #e6ecef;color:#526777">Trạng thái</td><td align="right" style="padding:9px 0;border-bottom:1px solid #e6ecef;color:#243746">{safe_status}</td></tr>
          <tr><td style="padding:9px 0;color:#526777">Chi phí</td><td align="right" style="padding:9px 0;color:#243746;font-weight:bold">{safe_amount}</td></tr>
        </table>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:20px;background-color:#eaf4f5;border:1px solid #b8d7db">
          <tr><td align="center" style="padding:16px">
            <div style="font-size:12px;line-height:18px;font-weight:bold;color:#385866">MÃ VÉ / MÃ XÁC NHẬN</div>
            <div style="margin-top:5px;font-size:25px;line-height:32px;font-weight:800;color:#123d47;letter-spacing:3px;word-break:break-all">{safe_confirm_code}</div>
          </td></tr>
        </table>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:18px">
          <tr><td align="center">
            <img src="cid:ohio-booking-qr" width="180" height="180" alt="QR check-in AkinaClinic" style="display:block;width:180px;height:180px;max-width:100%;border:0" />
            <p style="margin:8px 0 0;font-size:12px;line-height:18px;color:#526777">Quét QR hoặc mở vé điện tử để check-in.</p>
          </td></tr>
          <tr><td align="center" style="padding-top:18px">
            <a href="{safe_url}" style="display:inline-block;padding:12px 22px;background-color:#0f7280;color:#ffffff;text-decoration:none;font-size:14px;line-height:20px;font-weight:bold">Mở vé điện tử</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:14px 20px;background-color:#f7f9fa;border-top:1px solid #e6ecef;font-size:12px;line-height:18px;color:#526777">Email tự động từ AkinaClinic. Vui lòng không chia sẻ mã vé công khai.</td></tr>
    </table>
  </td></tr>
</table></body></html>'''

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
