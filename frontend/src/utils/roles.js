export const roleLabel = (role) => ({
  customer: 'Bệnh nhân',
  consultant: 'Nhân viên CSKH / Lễ tân',
  staff: 'Điều dưỡng / Kỹ thuật viên',
  doctor: 'Bác sĩ',
  manager: 'Quản lý phòng khám',
  sysadmin: 'Quản trị hệ thống',
}[role] || role || 'Tài khoản');
