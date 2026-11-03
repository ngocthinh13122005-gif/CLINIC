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
