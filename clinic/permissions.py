from rest_framework.permissions import BasePermission
from core.role_permissions import view_action_allowed

CLINIC_ROLES = {'manager', 'doctor', 'consultant', 'staff'}  # sysadmin là tài khoản kỹ thuật, không truy cập dữ liệu y tế
CLINICAL_READ = {'doctor', 'manager'}          # được xem nội dung bệnh án
CLINICAL_WRITE = {'doctor'}                    # được ghi/ký bệnh án
RECEPTION = {'consultant', 'manager', 'doctor'}  # được đón khách, mở/sửa hồ sơ hành chính


def role_of(request):
    u = request.user
    return u.role if u and u.is_authenticated else None


class _RoleSet(BasePermission):
    roles = set()
    module = ''
    action = None

    def has_permission(self, request, view):
        return role_of(request) in self.roles and view_action_allowed(request, view, self.module, self.action)


class IsClinicStaff(_RoleSet):
    roles = CLINIC_ROLES


class CanReadClinical(_RoleSet):
    roles = CLINICAL_READ
    module, action = 'clinical', 'view'


class CanWriteClinical(_RoleSet):
    roles = CLINICAL_WRITE
    module, action = 'clinical', 'update'


class CanReception(_RoleSet):
    roles = RECEPTION
    module = 'reception'
