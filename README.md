# AkinaClinic-CLINIC
AkinaClinic Clinic Management System

## Phân công buổi liệu trình

- Bác sĩ phụ trách liệu trình chịu trách nhiệm chuyên môn; mặc định trực tiếp thực hiện các buổi.
- Bác sĩ có thể cho phép điều phối nhân sự đủ điều kiện theo từng buổi. Quyền này không thay đổi bác sĩ phụ trách.
- Bệnh nhân chọn ngày và giờ; phòng khám xác nhận người thực hiện. Lễ tân/quản lý/bác sĩ có thể phân công trong lịch điều phối.
- Nhân sự được phân công phải có tài khoản bác sĩ hoặc nhân viên đang hoạt động và được cho phép thực hiện dịch vụ đó. Nhân viên không tự đổi người thực hiện hoặc xác nhận lịch.
- API kiểm tra lại quyền phân công khi đổi lịch và xác nhận; giao diện chỉ hỗ trợ thao tác, không thay thế kiểm tra phía máy chủ.
