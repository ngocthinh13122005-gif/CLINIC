"""Additional clinic-level restrictions layered over the application's fixed role ceilings.

These settings can only deny an operation. The existing DRF role/clinical permission
classes remain the source of grants, so this configuration can never grant a new role.
"""


ACTION_ALIASES = {
    'list': 'view', 'retrieve': 'view', 'summary': 'view', 'analytics': 'view',
    'create': 'create', 'update': 'update', 'partial_update': 'update',
    'confirm': 'confirm', 'cancel': 'cancel', 'reschedule': 'update',
    'complete': 'update', 'no_show': 'confirm', 'hold': 'update',
    'no_show_legacy': 'confirm', 'edit': 'update', 'rebook': 'create',
    'running_late': 'update', 'confirm_state': 'confirm',
    'open': 'create', 'close': 'update', 'pay': 'create', 'reconcile': 'approve',
    'approve': 'approve', 'reject': 'approve', 'void': 'approve',
    'receive': 'approve', 'scrap': 'approve', 'validate': 'approve',
    'campaign_send': 'approve', 'send': 'approve', 'export': 'export',
    'contact': 'update', 'cancel_entry': 'cancel', 'book': 'create',
}


def configured_action_allowed(user, module, action):
    """Return False only when a manager explicitly restricts this existing grant."""
    if not user or not getattr(user, 'is_authenticated', False) or not module or not action:
        return True
    from .operational_settings import clinic_setting
    code = f'{user.role}:{module}:{action}'
    try:
        return code not in clinic_setting('access.restricted_actions')
    except (KeyError, TypeError):
        return True


def module_for_view(view, fallback=''):
    name = f"{view.__class__.__name__} {getattr(view, '__name__', '')}".lower()
    if 'booking' in name or 'appointment' in name or 'blockedtime' in name:
        return 'booking'
    if 'visit' in name or 'reception' in name:
        return 'reception'
    if any(part in name for part in ('medicalrecord', 'prescription', 'treatmentplan', 'treatmentsession', 'clinical')):
        return 'clinical'
    if any(part in name for part in ('invoice', 'payment', 'refund', 'cashier', 'debt')):
        return 'billing'
    if any(part in name for part in ('medicine', 'inventory', 'stock', 'supplier', 'purchaseorder', 'lot')):
        return 'inventory'
    if any(part in name for part in ('marketing', 'campaign', 'mailinglist', 'contact')):
        return 'marketing'
    if 'crm' in name or 'loyalty' in name or 'voucher' in name:
        return 'crm'
    return fallback


def action_for_view(view, request, fallback='view'):
    action = getattr(view, 'action', None)
    if action:
        if 'blockedtime' in view.__class__.__name__.lower():
            return {
                'list': 'view', 'retrieve': 'view', 'create': 'create',
                'update': 'update', 'partial_update': 'update', 'destroy': 'update',
            }.get(action, fallback)
        return ACTION_ALIASES.get(action, fallback)
    function_name = getattr(view, '__name__', '')
    if function_name:
        return ACTION_ALIASES.get(function_name, fallback)
    method = getattr(request, 'method', 'GET').upper()
    return {'GET': 'view', 'HEAD': 'view', 'OPTIONS': 'view', 'POST': 'create',
            'PUT': 'update', 'PATCH': 'update', 'DELETE': 'approve'}.get(method, fallback)


def view_action_allowed(request, view, module='', action=None):
    return configured_action_allowed(
        getattr(request, 'user', None),
        module or module_for_view(view),
        action or action_for_view(view, request),
    )
