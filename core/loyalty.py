"""One-time reward calculation for a newly completed appointment."""


def award_booking_points(booking):
    if not booking.user_id or booking.loyalty_awarded:
        return 0
    from .operational_settings import clinic_setting
    enabled = clinic_setting('crm.loyalty_enabled')
    threshold = max(1, int(clinic_setting('crm.vnd_per_point')))
    points = max(1, int(booking.total / threshold)) if enabled and booking.total else 0
    if points:
        user = booking.user
        user.loyalty_points = (user.loyalty_points or 0) + points
        user.save(update_fields=['loyalty_points'])
    # Mark this completed transaction as processed even while rewards are paused,
    # so enabling rewards later never backfills historic appointments.
    booking.loyalty_awarded = True
    booking.loyalty_points_earned = points
    return points
