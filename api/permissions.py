from rest_framework.permissions import BasePermission
from core.role_permissions import view_action_allowed


class IsStaffRole(BasePermission):
    roles = {'consultant', 'staff', 'doctor', 'manager', 'sysadmin'}

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in self.roles
                    and view_action_allowed(request, view))


class IsManagerRole(BasePermission):
    roles = {'manager', 'sysadmin'}

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in self.roles
                    and view_action_allowed(request, view))


class CanCompleteBooking(BasePermission):
    roles = {'doctor', 'staff', 'manager'}

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in self.roles
                    and view_action_allowed(request, view, 'booking', 'confirm'))


class CanManageAppointmentWaitlist(BasePermission):
    """Front-desk and clinic managers may manage contact requests; doctors only see assigned requests."""
    roles = {'consultant', 'doctor', 'manager'}

    def has_permission(self, request, view):
        role = getattr(request.user, 'role', '')
        action = getattr(view, 'action', '')
        if action not in {'list', 'retrieve'} and role not in {'consultant', 'manager'}:
            return False
        return bool(
            request.user and request.user.is_authenticated
            and role in self.roles
            and view_action_allowed(request, view, 'booking')
        )
