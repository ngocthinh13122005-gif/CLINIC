"""Email/QR notifications for OHIO bookings.

Sending is intentionally best-effort: a temporary SMTP problem must never rollback or
break a booking that was already created in the database.
"""
from __future__ import annotations

import io
import logging
import threading
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
    return f'OHIO — {prefix} — {booking.confirm_code}'


def _event_heading(event: str) -> str:
    return {
        'created': 'OHIO đã nhận yêu cầu đặt lịch của bạn',
        'confirmed': 'Lịch hẹn OHIO của bạn đã được xác nhận',
        'rescheduled': 'Lịch hẹn OHIO của bạn đã được cập nhật',
        'cancelled': 'Lịch hẹn OHIO của bạn đã được hủy',
    }.get(event, 'Thông tin lịch hẹn OHIO')


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
        services = ', '.join(item.service.name for item in booking.items.all()) or 'Dịch vụ OHIO'
        appointment = timezone.localtime(booking.appointment)
        heading = _event_heading(event)
        status = booking.get_status_display()
        staff_name = booking.staff.name if booking.staff else 'OHIO sẽ sắp xếp'
        amount = f'{booking.total:,}đ'.replace(',', '.')

        text_body = (
            f'{heading}\n\n'
            f'Mã xác nhận: {booking.confirm_code}\n'
            f'Dịch vụ: {services}\n'
            f'Ngày giờ: {appointment.strftime("%d/%m/%Y %H:%M")}\n'
            f'Chuyên viên: {staff_name}\n'
            f'Trạng thái: {status}\n'
            f'Tổng tiền: {amount}\n\n'
            f'Vé điện tử: {url}\n\n'
            'Vui lòng xuất trình mã hoặc QR khi đến OHIO.'
        )
        html_body = f'''<!doctype html>
<html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#172033">
<div style="max-width:620px;margin:0 auto;padding:28px 16px">
  <div style="background:linear-gradient(135deg,#0f2a4a,#2563eb);padding:24px;border-radius:20px 20px 0 0;color:white">
    <div style="font-size:12px;letter-spacing:.14em;opacity:.78">OHIO MANAGEMENT SYSTEM</div>
    <h2 style="margin:8px 0 0;font-size:22px">{heading}</h2>
  </div>
  <div style="background:white;padding:24px;border:1px solid #dfe8f4;border-top:0">
    <p style="margin-top:0">Xin chào <strong>{booking.customer_name}</strong>,</p>
    <p>Thông tin lịch hẹn của bạn tại OHIO:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:8px 0;color:#64748b">Dịch vụ</td><td style="padding:8px 0;text-align:right"><strong>{services}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#64748b">Ngày giờ</td><td style="padding:8px 0;text-align:right"><strong>{appointment.strftime('%d/%m/%Y %H:%M')}</strong></td></tr>
      <tr><td style="padding:8px 0;color:#64748b">Chuyên viên</td><td style="padding:8px 0;text-align:right">{staff_name}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b">Trạng thái</td><td style="padding:8px 0;text-align:right">{status}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b">Tổng tiền</td><td style="padding:8px 0;text-align:right"><strong>{amount}</strong></td></tr>
    </table>
    <div style="margin:22px 0;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:14px;text-align:center">
      <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.08em">Mã vé / mã xác nhận</div>
      <div style="font-size:26px;font-weight:800;color:#0f2a4a;letter-spacing:.12em;margin-top:6px;word-break:break-all">{booking.confirm_code}</div>
    </div>
    <div style="text-align:center;margin:18px 0">
      <img src="cid:ohio-booking-qr" width="190" height="190" alt="QR check-in OHIO" style="display:block;margin:0 auto;width:190px;height:190px;max-width:100%" />
      <div style="font-size:12px;color:#64748b;margin-top:8px">Quét QR hoặc mở vé điện tử để check-in.</div>
    </div>
    <div style="text-align:center;margin-top:22px">
      <a href="{url}" style="display:inline-block;background:#2563eb;color:white;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">Mở vé điện tử</a>
    </div>
  </div>
  <div style="text-align:center;font-size:12px;color:#94a3b8;padding:14px">Email tự động từ OHIO. Vui lòng không chia sẻ mã vé công khai.</div>
</div></body></html>'''

        email = EmailMultiAlternatives(
            subject=_subject(event, booking),
            body=text_body,
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
            to=[recipient],
        )
        email.attach_alternative(html_body, 'text/html')
        qr_part = MIMEImage(_qr_png_bytes(url), _subtype='png')
        qr_part.add_header('Content-ID', '<ohio-booking-qr>')
        qr_part.add_header('Content-Disposition', 'inline', filename=f'OHIO-{booking.confirm_code}-QR.png')
        email.attach(qr_part)
        email.send(fail_silently=False)
        return True
    except Exception:
        logger.exception('OHIO booking email failed for booking_id=%s', booking_id)
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
