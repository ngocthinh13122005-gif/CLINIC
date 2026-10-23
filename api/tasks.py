from celery import shared_task


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def send_booking_email_task(self, booking_id, confirmation_url=None, event='created'):
    from core.booking_notifications import send_booking_email
    return send_booking_email(booking_id, confirmation_url=confirmation_url, event=event)


@shared_task
def mirror_chat_message_task(message_id):
    from core.models import Message
    from .firebase import mirror_message
    try:
        message = Message.objects.select_related('sender').get(pk=message_id)
    except Message.DoesNotExist:
        return False
    return mirror_message(message)
