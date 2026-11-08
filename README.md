# AkinaClinic – Hệ thống quản lý phòng khám da liễu

Hệ thống quản lý phòng khám da liễu / spa y tế: đặt lịch online, tiếp đón, khám bệnh, kê đơn, liệu trình, thu ngân, kho thuốc, chăm sóc khách hàng và tuân thủ dữ liệu. Giao diện tiếng Việt.

- **Backend:** Django 5 + Django REST Framework
- **Frontend:** React 18 + Vite
- **Cơ sở dữ liệu:** SQLite (chạy local) hoặc MySQL 8 (Docker)
- **Tác vụ nền:** Celery + Redis
- **Tích hợp:** Firebase (chat realtime), Cloudinary (ảnh), Gemini (chatbot), Meta Messenger, SMTP (email)

## Tính năng chính

| Nhóm | Nội dung |
|---|---|
| Khách hàng | Xem dịch vụ, đặt lịch, tra vé, cổng hồ sơ sức khỏe (bệnh án, đơn thuốc, liệu trình đã được phát hành) |
| Tiếp đón & lịch | Lịch hẹn, phân công người thực hiện, hàng chờ khám |
| Khám bệnh | Bệnh nhân, lượt khám, bệnh án, ICD-10, ảnh tổn thương, kê đơn, phiếu đồng ý |
| Liệu trình | Tạo gói nhiều buổi, ghi nhận từng buổi, phân công người thực hiện, thu tiền theo liệu trình |
| Thu ngân | Hóa đơn, thanh toán, ca thu ngân, đối soát, hoàn tiền, công nợ |
| Kho thuốc | Thuốc, nhà cung cấp, nhập/xuất, kiểm kê |
| CSKH | Chat, chatbot Gemini, Facebook Messenger, voucher, điểm thưởng và hạng thành viên, email marketing |
| Quản lý | Nhân sự, ca làm, chấm công, nghỉ phép, lương, báo cáo, cài đặt phòng khám |
| Tuân thủ | Nhật ký thao tác, yêu cầu dữ liệu, sự cố, sao lưu |

### Vai trò người dùng

Bệnh nhân (`customer`), CSKH/lễ tân (`consultant`), điều dưỡng/KTV (`staff`), bác sĩ (`doctor`), quản lý (`manager`), quản trị hệ thống (`sysadmin`). Quyền được kiểm tra ở phía máy chủ; giao diện chỉ hỗ trợ thao tác.

## Cấu trúc thư mục

```
accounts/   Người dùng, vai trò, điểm thưởng, quên mật khẩu
core/       Dịch vụ, nhân viên, đặt lịch, ca làm, chat/CSKH, cài đặt, lệnh seed
clinic/     Bệnh nhân, khám bệnh, kê đơn, liệu trình, thu ngân, kho thuốc, tuân thủ
api/        Endpoint REST, chatbot, Firebase, Celery tasks, webhook Messenger
config/     Cấu hình Django
frontend/   Ứng dụng React (Vite)
```

## Chạy ở máy local

Yêu cầu: Python 3.11+ và Node.js 18+. Không cần MySQL hay Redis khi chạy local.

**1. Backend**

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # Windows: copy .env.example .env
python manage.py migrate
python manage.py seed            # dữ liệu mẫu + tài khoản demo
python manage.py runserver       # http://127.0.0.1:8000
```


Dữ liệu mẫu bổ sung (tùy chọn): `python manage.py seed_clinic` (bệnh nhân, lượt khám, liệu trình) hoặc `python manage.py seed_demo` (bộ demo đầy đủ).

**2. Frontend**

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Vite tự chuyển tiếp `/api` và `/media` sang `http://127.0.0.1:8000`.

Cấu hình Firebase phía giao diện đặt trong `frontend/.env` với các biến `VITE_FIREBASE_*` (xem `frontend/src/services/firebase.js`).

### Tài khoản demo

Tạo bởi `python manage.py seed`. **Chỉ dùng để thử nghiệm; đổi hoặc xóa trước khi đưa lên môi trường thật.**

| Vai trò | Tài khoản | Mật khẩu |
|---|---|---|
| CSKH | `cskh1` | `cskh12345` |
| Điều dưỡng | `nhanvien1` | `nv12345` |
| Bác sĩ | `bacsi1` | `bacsi12345` |
| Quản lý | `quanly1` | `quanly12345` |
| Khách hàng | `khach1` | `khach12345` |

Tài khoản quản trị: xem `core/management/commands/seed.py` hoặc tạo mới bằng `python manage.py createsuperuser`.


## Chạy bằng Docker

cp .env.example .env
docker compose up --build
```

- Backend: http://localhost:8000
- Frontend: http://localhost:8080

Backend tự chạy `migrate` và `seed` khi khởi động.

## Kiểm thử

```bash
python manage.py test clinic api core accounts
```



## Vai trò và quyền
1. Khách hàng / Bệnh nhân (Customer)

Đăng ký, đăng nhập, đăng xuất và quản lý thông tin tài khoản cá nhân.
Xem danh sách dịch vụ khám và chăm sóc da, bảng giá và thông tin phòng khám.
Đặt lịch khám mới, tư vấn, tái khám hoặc buổi liệu trình theo điều kiện nghiệp vụ.
Lựa chọn ngày, khung giờ và bác sĩ/chuyên viên phù hợp.
Xem danh sách lịch hẹn, trạng thái và thông tin chi tiết từng lịch.
Đổi lịch hoặc hủy lịch hẹn của mình theo thời hạn và quy định của phòng khám.
Xem mã vé và thông tin xác nhận lịch hẹn.
Truy cập cổng hồ sơ bệnh nhân để xem lịch sử khám, hướng dẫn chăm sóc, liệu trình và đơn thuốc khi tài khoản đã được liên kết hồ sơ.
Tạo hội thoại và nhắn tin trực tiếp với nhân viên CSKH.
Gửi hình ảnh, tài liệu và tệp đính kèm trong hội thoại.
Theo dõi phản hồi, lịch sử tin nhắn và trạng thái hỗ trợ.
Đánh giá chất lượng phiên tư vấn bằng CSAT (1–5 sao) khi nhận được lời mời.
Sử dụng AI Receptionist để hỏi dịch vụ, giá, thông tin phòng khám và được hướng dẫn đặt lịch.
Xác nhận đặt lịch qua AI Receptionist sau khi đăng nhập tài khoản bệnh nhân.

2. Nhân viên tiếp đón / Chăm sóc khách hàng (Consultant)

Đăng nhập hệ thống và truy cập các chức năng tiếp đón, CSKH theo phân quyền.
Xem danh sách lịch hẹn, tra cứu và lọc lịch theo ngày, trạng thái hoặc thông tin bệnh nhân.
Xác nhận, thay đổi, hủy và xử lý lịch hẹn theo quyền được cấp.
Tiếp nhận bệnh nhân đến phòng khám và thực hiện Check-in.
Tạo lượt khám từ lịch hẹn hoặc hỗ trợ tiếp nhận bệnh nhân đến trực tiếp.
Điều phối bệnh nhân, hỗ trợ phân công bác sĩ và theo dõi trạng thái lượt khám.
Tạo, xem và cập nhật thông tin hành chính trong hồ sơ bệnh nhân.
Xem thông tin liệu trình cần thiết để hỗ trợ điều phối, không được tự chỉnh sửa phác đồ chuyên môn.
Quản lý hộp thư tư vấn và danh sách hội thoại khách hàng.
Nhận ca tư vấn từ hàng chờ, trả ca về hàng chờ khi cần.
Gửi và nhận tin nhắn trực tiếp với bệnh nhân trong ca được phân công.
Gửi hình ảnh, tài liệu và tệp đính kèm.
Sử dụng mẫu phản hồi nhanh và ghi chú nội bộ.
Phân loại, tìm kiếm và gắn nhãn hội thoại.
Chuyển hội thoại cho bác sĩ khi nội dung cần tư vấn chuyên môn.
Sử dụng AI Copilot để tham khảo gợi ý phản hồi khi được cấu hình và cấp quyền.
Kết thúc phiên tư vấn và gửi lời mời đánh giá CSAT theo điều kiện hệ thống.
Theo dõi công việc chăm sóc sau điều trị, liên hệ hỏi thăm, nhắc tái khám và ghi nhận kết quả liên hệ.
Chuyển trường hợp có dấu hiệu cần đánh giá chuyên môn sang bác sĩ.

3. Bác sĩ (Doctor)

Đăng nhập hệ thống và truy cập không gian làm việc của bác sĩ.
Xem lịch khám, lịch hẹn và danh sách bệnh nhân được phân công.
Xem thông tin hành chính và hồ sơ bệnh nhân trong phạm vi được phép.
Xem tiền sử, bệnh sử, tiền sử dị ứng và thông tin lâm sàng.
Tiếp nhận bệnh nhân vào khám.
Ghi nhận lý do khám, triệu chứng, khám lâm sàng và kết quả đánh giá.
Ghi chẩn đoán, mã bệnh ICD-10 và hướng xử lý chuyên môn.
Lưu bản nháp, cập nhật và ký bệnh án theo quy định.
Xem lịch sử khám, hồ sơ bệnh án và những thông tin điều trị liên quan.
Ghi nhận, xem và quản lý hình ảnh da của bệnh nhân.
Sử dụng sơ đồ vị trí tổn thương trên khuôn mặt hoặc cơ thể.
Lập và quản lý kế hoạch/liệu trình điều trị.
Xác định dịch vụ, nội dung điều trị, số buổi và bác sĩ phụ trách.
Kích hoạt, cập nhật hoặc hủy liệu trình theo điều kiện nghiệp vụ.
Thực hiện và ghi nhận kết quả từng buổi điều trị được phân công.
Cho phép giao buổi liệu trình cho nhân sự đủ điều kiện khi phù hợp.
Kê đơn thuốc, ghi hướng dẫn sử dụng và quản lý đơn thuốc thuộc lượt khám phụ trách.
Tham gia lập và xác nhận phiếu đồng ý điều trị theo phân quyền.
Theo dõi các công việc chăm sóc sau điều trị có liên quan.
Tiếp nhận và phản hồi những hội thoại CSKH được chuyển đến để tư vấn chuyên môn.

4. Điều dưỡng / Kỹ thuật viên (Staff)

Đăng nhập hệ thống và xem Dashboard cá nhân.
Xem lịch hẹn và các công việc được phân công.
Xem danh sách bệnh nhân và những thông tin cần thiết trong phạm vi được cấp quyền.
Xem những liệu trình và buổi điều trị được giao thực hiện.
Theo dõi nội dung, thời gian và tiến độ buổi liệu trình liên quan.
Thực hiện buổi liệu trình khi bác sĩ phụ trách đã cho phép giao nhân sự đủ điều kiện.
Ghi nhận nội dung thực hiện và kết quả buổi liệu trình theo quy trình.
Cập nhật trạng thái hoàn tất buổi điều trị khi đủ điều kiện và được phân quyền.
Xem thông tin dịch vụ liên quan đến công việc.
Quản lý hồ sơ tài khoản cá nhân.
Giới hạn quyền: Kỹ thuật viên không có quyền tự ý chẩn đoán, kê đơn, ký bệnh án, thay đổi phác đồ hoặc quản lý các hội thoại CSKH không được phân công.

5. Quản lý phòng khám (Manager)

Đăng nhập và truy cập Dashboard quản lý hoạt động phòng khám.
Theo dõi tổng quan tình trạng lịch hẹn, lượt khám, bệnh nhân và liệu trình.
Xem các chỉ số vận hành và báo cáo theo khoảng thời gian.
Quản lý lịch hẹn, xác nhận, thay đổi, hủy và điều phối lịch theo phân quyền.
Quản lý lịch làm việc và phân công nhân sự phục vụ hoạt động phòng khám.
Quản lý danh mục dịch vụ, bảng giá và trạng thái hoạt động của dịch vụ.
Xem và quản lý thông tin hành chính của hồ sơ bệnh nhân.
Giám sát lượt khám và tiến độ điều trị, không thay thế bác sĩ trong việc ký hoặc chỉnh sửa chuyên môn.
Theo dõi công việc chăm sóc sau điều trị và những trường hợp cần xử lý.
Giám sát toàn bộ hàng chờ và trạng thái hội thoại tư vấn.
Phân công hoặc phân công lại hội thoại cho nhân viên CSKH.
Tiếp quản hội thoại và trực tiếp xử lý khi cần.
Theo dõi các ca được chuyển sang bác sĩ.
Xem ghi chú nội bộ, nhãn hội thoại và lịch sử xử lý.
Theo dõi thời gian phản hồi, chất lượng hỗ trợ và các đánh giá CSAT.
Quản lý danh sách bác sĩ, nhân viên và thông tin phục vụ phân công chuyên môn.
Xem và xuất báo cáo hoạt động phòng khám dưới dạng Excel.
Quản lý một số thiết lập vận hành, chính sách đặt lịch và phân quyền theo thẩm quyền.
Xem nhật ký hoạt động và các thông tin kiểm soát hệ thống được cấp quyền.

