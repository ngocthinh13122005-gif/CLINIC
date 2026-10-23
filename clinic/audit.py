from accounts.models import ActivityLog


def audit(user, action, detail=''):
    """Ghi nhật ký truy cập/chỉnh sửa dữ liệu y tế."""
    try:
        ActivityLog.objects.create(user=user if getattr(user, 'pk', None) else None, action=action[:80], detail=detail[:255])
    except Exception:
        pass
