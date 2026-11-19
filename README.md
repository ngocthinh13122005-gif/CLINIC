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
| Khách hàng | Xem dịch vụ, đặt lịch, voucher, chat tư vấn, cổng hồ sơ sức khỏe |
| Tiếp đón & lịch | Lịch hẹn, phân công người thực hiện, tiếp đón trong ngày |
| Khám bệnh | Bệnh nhân, lượt khám, bệnh án, ICD-10, ảnh tổn thương, kê đơn, phiếu đồng ý |
| Liệu trình | Gói nhiều buổi, ghi nhận từng buổi, xếp lịch, ủy quyền buổi cho nhân sự |
| Thu ngân | Hóa đơn, thanh toán, ca thu ngân, đối soát, hoàn tiền, công nợ, bán hàng |
| Kho thuốc | Thuốc, lô, nhà cung cấp, nhập hàng, kiểm kê, phòng |
| Chăm sóc | Chăm sóc sau điều trị, hoạt động/công việc, hộp thư tư vấn, chatbot Gemini, Messenger |
| Quản lý | Dịch vụ & bảng giá, nhân sự, chấm công, nghỉ phép, lương, CRM, voucher, báo cáo |
| Tuân thủ | Nhật ký hệ thống, yêu cầu dữ liệu, sự cố, sao lưu |

## Cấu trúc thư mục

```
accounts/   Người dùng, vai trò, điểm thưởng, quên mật khẩu
core/       Dịch vụ, nhân viên, đặt lịch, ca làm, chat, cài đặt, lệnh seed
clinic/     Bệnh nhân, khám bệnh, kê đơn, liệu trình, thu ngân, kho thuốc, tuân thủ
api/        Endpoint REST, chatbot, Firebase, Celery tasks, webhook Messenger
config/     Cấu hình Django
frontend/   Ứng dụng React (Vite)
```

## Vai trò và quyền

> Đây là **thiết kế phân quyền mục tiêu** của hệ thống. Code hiện tại chưa khớp hoàn toàn; xem mục [Việc cần sửa để code khớp](#việc-cần-sửa-để-code-khớp-bảng-quyền).

### Nguyên tắc

1. **Tối thiểu cần thiết:** mỗi vai trò chỉ thấy và làm những gì phục vụ công việc của mình.
2. **Tách quyền chuyên môn và tài chính:** bác sĩ quyết định điều trị, thu ngân quyết định thu tiền; không ai tự làm cả hai.
3. **Người tạo không phải người duyệt:** hoàn tiền, hủy hóa đơn, đối soát do quản lý duyệt.
4. **Dữ liệu y tế là dữ liệu nhạy cảm:** chỉ bác sĩ ghi; bác sĩ và quản lý xem; CSKH và điều dưỡng không xem nội dung chuyên môn; quản trị hệ thống không truy cập.
5. **Quyền được kiểm tra ở máy chủ.** Giao diện chỉ ẩn/hiện menu.
6. **Quản lý chỉ thu hẹp được quyền, không cấp thêm** ngoài bảng này (cài đặt `access.restricted_actions`).

### Các vai trò

| Mã | Vai trò | Trách nhiệm chính |
|---|---|---|
| `customer` | Bệnh nhân / khách hàng | Đặt lịch, xem hồ sơ của chính mình |
| `consultant` | Nhân viên CSKH / Lễ tân | Tiếp đón, lịch hẹn, thu ngân, chăm sóc khách |
| `staff` | Điều dưỡng / Kỹ thuật viên | Thực hiện buổi điều trị được giao |
| `doctor` | Bác sĩ | Khám, bệnh án, kê đơn, liệu trình |
| `manager` | Quản lý phòng khám | Vận hành, duyệt, nhân sự, báo cáo |
| `sysadmin` | Quản trị hệ thống | Tài khoản, sao lưu, tích hợp; không xem dữ liệu y tế |

### Quyền của nhân sự theo chức năng

✓ = được làm · 👁 = chỉ xem · — = không có quyền. "Của tôi" = chỉ phần được giao cho chính người đó.

| Chức năng | Quản lý | Bác sĩ | CSKH / Lễ tân | Điều dưỡng / KTV | Quản trị HT |
|---|:-:|:-:|:-:|:-:|:-:|
| **Tiếp đón & lịch** | | | | | |
| Tổng quan | ✓ toàn phòng khám | ✓ của tôi | ✓ | ✓ của tôi | ✓ kỹ thuật |
| Tiếp đón hôm nay | ✓ | ✓ | ✓ | — | — |
| Xem lịch hẹn | ✓ | ✓ của tôi | ✓ | ✓ của tôi | — |
| Tạo, đổi, xác nhận, hủy lịch hẹn | ✓ | — | ✓ | — | — |
| Phân công người thực hiện | ✓ | ✓ | ✓ | — | — |
| **Hồ sơ bệnh nhân** | | | | | |
| Xem danh sách, hồ sơ hành chính | ✓ | ✓ | ✓ | 👁 bệnh nhân được giao | — |
| Mở, sửa hồ sơ hành chính | ✓ | ✓ | ✓ | — | — |
| Xem bệnh án, ảnh tổn thương, đơn thuốc | ✓ | ✓ | — | — | — |
| Ghi, ký bệnh án; tải ảnh; kê đơn | — | ✓ | — | — | — |
| Khám bệnh (màn khám) | — | ✓ | — | — | — |
| **Liệu trình** | | | | | |
| Xem liệu trình | ✓ | ✓ | 👁 không xem nội dung chuyên môn | 👁 buổi được giao | — |
| Tạo, sửa, hủy liệu trình; cho phép ủy quyền buổi | — | ✓ bác sĩ phụ trách | — | — | — |
| Ghi nhận buổi đã thực hiện | — | ✓ | — | ✓ buổi được giao và được ủy quyền | — |
| Xếp lịch buổi, gia hạn, liên kết lịch hẹn | ✓ | ✓ | ✓ | — | — |
| Chuyển, hết hạn, hủy buổi | ✓ | — | — | — | — |
| **Thu ngân & tài chính** | | | | | |
| Xem hóa đơn | ✓ | 👁 hóa đơn bệnh nhân của mình | ✓ | — | — |
| Lập hóa đơn, thu tiền, mở / đóng ca thu ngân | ✓ | — | ✓ | — | — |
| Bán hàng (POS) | ✓ | — | ✓ | — | — |
| Tạo yêu cầu hoàn tiền | ✓ | — | ✓ | — | — |
| Duyệt / từ chối hoàn tiền, hủy hóa đơn, đối soát thanh toán | ✓ | — | — | — | — |
| Công nợ: xem, ghi nhắc nợ | ✓ | — | ✓ | — | — |
| **Kho thuốc** | | | | | |
| Xem danh mục, tồn kho | ✓ | ✓ | ✓ | 👁 | — |
| Thêm/sửa thuốc, nhập hàng, nhà cung cấp, kiểm kê | ✓ | — | — | — | — |
| **Chăm sóc & tư vấn** | | | | | |
| Chăm sóc sau điều trị | ✓ | ✓ | ✓ | — | — |
| Hoạt động / công việc | ✓ | ✓ | ✓ | ✓ việc của tôi | — |
| Hộp thư tư vấn | ✓ | ✓ tư vấn được chuyển | ✓ | — | — |
| **Quản lý & kinh doanh** | | | | | |
| Báo cáo điều hành | ✓ | — | — | — | — |
| Dịch vụ & bảng giá | ✓ | — | — | — | — |
| Nhân sự, ca làm, chấm công, nghỉ phép | ✓ | — | — | gửi đơn nghỉ của mình | — |
| Bảng lương | ✓ | — | — | 👁 phiếu lương của mình | — |
| Cài đặt phòng khám (giờ làm, thu hẹp quyền) | ✓ | — | — | — | — |
| **Hệ thống & tuân thủ** | | | | | |
| Tạo, sửa tài khoản nhân sự (trừ quản trị hệ thống) | ✓ | — | — | — | ✓ |
| Khóa tài khoản, đặt lại mật khẩu | ✓ nhân sự | — | — | — | ✓ mọi tài khoản |
| Yêu cầu dữ liệu, sự cố dữ liệu | ✓ | — | — | — | — |
| Nhật ký hệ thống | ✓ | — | — | — | ✓ |
| Sao lưu, khôi phục, cấu hình tích hợp (Firebase, Gemini, Messenger, email) | — | — | — | — | ✓ |

### Bệnh nhân / khách hàng (`customer`)

- Xem dịch vụ, đặt và quản lý lịch hẹn của mình, dùng voucher của mình, chat với phòng khám.
- **Hồ sơ sức khỏe:** chỉ thấy dữ liệu của chính mình và chỉ những bệnh án, đơn thuốc, liệu trình đã được phát hành.
- Không vào được bất kỳ màn hình nhân sự nào.

### Quản trị hệ thống (`sysadmin`)

- Tài khoản kỹ thuật, **không truy cập dữ liệu y tế** (bệnh nhân, bệnh án, đơn thuốc, hóa đơn).
- Quản lý tài khoản, sao lưu / khôi phục, cấu hình tích hợp và xem nhật ký hệ thống.
- Vào Django admin (`/admin/`) cùng với `manager`.

## Chạy ở máy local

Yêu cầu: Python 3.11+ và Node.js 18+. Không cần MySQL hay Redis khi chạy local.

**1. Backend**

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # Windows: copy .env.example .env
python manage.py migrate
python manage.py runserver       # http://127.0.0.1:8000
```

Để trống `DB_ENGINE` trong `.env` thì dùng SQLite. `CELERY_TASK_ALWAYS_EAGER=1` giúp tác vụ nền chạy ngay trong tiến trình, không cần Redis.

**2. Tạo tài khoản**

Lệnh `seed` **không tự tạo tài khoản**. Cần có sẵn ít nhất một tài khoản đang hoạt động cho mỗi vai trò. Tạo nhanh 6 tài khoản thử nghiệm:

```bash
python manage.py shell -c "
from accounts.models import User
for username, role in [('admin','sysadmin'), ('quanly','manager'), ('bacsi','doctor'),
                       ('cskh','consultant'), ('dieuduong','staff'), ('khach','customer')]:
    User.objects.create_user(username=username, password='DoiMatKhauNay@123', role=role)
"
```

Hoặc dùng `python manage.py createsuperuser` rồi đổi `role` trong Django admin. **Đổi mật khẩu trước khi đưa lên môi trường thật.**

**3. Dữ liệu demo (tùy chọn)**

```bash
python manage.py seed            # bệnh nhân, thuốc, lịch hẹn, liệu trình, hóa đơn mẫu
```

Lệnh này chỉ thêm dữ liệu mẫu, giữ nguyên tài khoản, và từ chối chạy nếu DB đã có dữ liệu ngoài bộ demo. Muốn xóa dữ liệu nghiệp vụ và nạp lại thì dùng `python manage.py seed_minimal_demo --reset`; lệnh này chỉ chạy được khi `DJANGO_DEBUG=1` và `AKINA_DEMO_RESET_ALLOWED=1`, **chỉ dùng trên DB phát triển cô lập**.

**4. Frontend**

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Vite tự chuyển tiếp `/api` và `/media` sang `http://127.0.0.1:8000`. Cấu hình Firebase phía giao diện đặt trong `frontend/.env` với các biến `VITE_FIREBASE_*` (xem `frontend/src/services/firebase.js`).

## Biến môi trường

Sao chép `.env.example` thành `.env` rồi điền. Các nhóm chính:

| Nhóm | Biến | Ghi chú |
|---|---|---|
| Django | `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS` | **Bắt buộc đổi `DJANGO_SECRET_KEY` và tắt `DJANGO_DEBUG` khi triển khai** |
| Cơ sở dữ liệu | `DB_ENGINE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` | Để trống `DB_ENGINE` = SQLite |
| CORS | `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` | Thêm địa chỉ frontend khi triển khai |
| Celery | `CELERY_TASK_ALWAYS_EAGER`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` | Production đặt `CELERY_TASK_ALWAYS_EAGER=0` |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL`, … | Không có khóa thì chatbot AI không hoạt động |
| Messenger | `META_*` | Chỉ dùng phía máy chủ |
| Firebase | `FIREBASE_ENABLED`, `FIREBASE_SERVICE_ACCOUNT_FILE` hoặc `FIREBASE_SERVICE_ACCOUNT_JSON` | `FIREBASE_ENABLED=0` để tắt chat realtime |
| Ảnh / Email | `CLOUDINARY_URL`, `EMAIL_*`, `DEFAULT_FROM_EMAIL` | |
| Điểm thưởng | `LOYALTY_VND_PER_POINT`, `PASSWORD_RESET_CODE_TTL_MINUTES` | |
| Demo | `AKINA_DEMO_RESET_ALLOWED` | Cho phép `seed_minimal_demo --reset`; **không bật ở môi trường thật** |

> Không commit file `.env` và file khóa Firebase lên Git.

## Chạy bằng Docker

`docker-compose.yaml` dựng MySQL, Redis, backend (gunicorn), Celery worker, Celery beat và frontend (build từ `./frontend`).

Trước khi chạy cần chỉnh trong `docker-compose.yaml`:

- **File khóa Firebase:** dòng `volumes` của `backend` và `celery` đang trỏ tới đường dẫn Windows cá nhân. Đổi sang đường dẫn file khóa trên máy bạn, hoặc đặt `FIREBASE_ENABLED: "0"` nếu không dùng chat realtime.
- **`AKINA_DEMO_RESET_ALLOWED: "1"`** đang bật cho backend. Tắt (`"0"`) nếu không phải môi trường demo.

```bash
cp .env.example .env
docker compose up --build
```

- Backend: http://localhost:8000
- Frontend: http://localhost:8080

Backend tự chạy `migrate` khi khởi động; **không tự tạo tài khoản hay dữ liệu demo**. Sau khi lên, tạo tài khoản và seed trong container:

```bash
docker compose exec backend python manage.py shell      # tạo tài khoản như phần trên
docker compose exec backend python manage.py seed
```

## Kiểm thử

```bash
python manage.py test clinic api core accounts
```

## Triển khai

- **Backend:** chạy bằng gunicorn (xem `Dockerfile` và `docker-compose.yaml`).
- **Frontend:** `npm run build` trong `frontend/`, kết quả ở `frontend/dist`.
- **Firebase:** `firebase.json` và `firebase.rules` chứa cấu hình và luật bảo mật cho chat realtime.
