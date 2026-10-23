from rest_framework.permissions import BasePermission


class IsStaffRole(BasePermission):
    roles = {'consultant', 'staff', 'doctor', 'manager', 'sysadmin'}

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in self.roles)


class IsManagerRole(BasePermission):
    roles = {'manager', 'sysadmin'}

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role in self.roles)
