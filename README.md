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
| Quản lý | Dịch vụ & bảng giá, nhân sự, chấm công, nghỉ phép, lương, CRM, voucher, email marketing, báo cáo |
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

Hệ thống có 6 vai trò (`accounts.models.User.Role`). Quyền được kiểm tra ở phía máy chủ; giao diện chỉ ẩn/hiện menu cho phù hợp.

| Mã | Vai trò | Mô tả ngắn |
|---|---|---|
| `customer` | Bệnh nhân / khách hàng | Đặt lịch, xem hồ sơ của chính mình |
| `consultant` | Nhân viên CSKH / Lễ tân | Tiếp đón, lịch hẹn, thu ngân, chăm sóc khách |
| `staff` | Điều dưỡng / Kỹ thuật viên | Thực hiện buổi liệu trình được phân công |
| `doctor` | Bác sĩ | Khám bệnh, bệnh án, kê đơn, liệu trình |
| `manager` | Quản lý phòng khám | Toàn quyền vận hành, duyệt và quản trị |
| `sysadmin` | Quản trị hệ thống | Tài khoản kỹ thuật, không truy cập dữ liệu y tế |

### Quyền theo chức năng (nhân sự phòng khám)

✓ = được làm · 👁 = chỉ xem · — = không có quyền

| Chức năng | Quản lý | Bác sĩ | CSKH / Lễ tân | Điều dưỡng / KTV |
|---|:-:|:-:|:-:|:-:|
| Tổng quan | ✓ | ✓ | ✓ | ✓ |
| Tiếp đón hôm nay | ✓ | ✓ | ✓ | — |
| Lịch hẹn | ✓ | ✓ | ✓ | ✓ |
| Danh sách bệnh nhân, hồ sơ hành chính | ✓ | ✓ | ✓ | ✓ |
| Mở / sửa hồ sơ hành chính, đón khách | ✓ | ✓ | ✓ | — |
| Xem nội dung bệnh án, ảnh tổn thương, đơn thuốc | ✓ | ✓ | — | — |
| Ghi / ký bệnh án, tải ảnh, kê đơn | — | ✓ | — | — |
| Khám bệnh (màn khám) | — | ✓ | — | — |
| Xem liệu trình | ✓ | ✓ | ✓ | ✓ (buổi được giao) |
| Tạo, sửa, hủy liệu trình; cho phép ủy quyền buổi | — | ✓ (bác sĩ phụ trách) | — | — |
| Ghi nhận buổi đã thực hiện | — | ✓ | — | ✓ (buổi được phân công) |
| Xếp lịch buổi, gia hạn, liên kết lịch hẹn | ✓ | ✓ | ✓ | — |
| Chuyển, hết hạn, hủy buổi liệu trình | ✓ | — | — | — |
| Thu ngân & công nợ: lập hóa đơn, thu tiền, yêu cầu hoàn tiền | ✓ | — | ✓ | — |
| Xem hóa đơn | ✓ | 👁 | ✓ | — |
| Hủy hóa đơn, duyệt / từ chối hoàn tiền, đối soát thanh toán | ✓ | — | — | — |
| Bán hàng (POS) | ✓ | — | ✓ | — |
| Kho thuốc: xem danh mục, tồn kho | ✓ | ✓ | ✓ | — |
| Kho thuốc: thêm/sửa thuốc, nhập hàng, nhà cung cấp, kiểm kê | ✓ | — | — | — |
| Chăm sóc sau điều trị, Hoạt động | ✓ | ✓ | ✓ | — |
| Hộp thư tư vấn | ✓ | ✓ (tư vấn được chuyển) | ✓ | — |
| Báo cáo, Nhật ký hệ thống, Tuân thủ & bảo mật | ✓ | — | — | — |
| Dịch vụ & bảng giá, Nhân sự, Chấm công, Lương | ✓ | — | — | — |
| CRM, Voucher, Email marketing | ✓ | — | — | — |

Ghi chú:

- **Dữ liệu y tế** (bệnh án, ảnh, đơn thuốc): chỉ bác sĩ và quản lý xem được; chỉ bác sĩ được ghi. CSKH và điều dưỡng không thấy nội dung chuyên môn.
- **Liệu trình:** bác sĩ phụ trách chịu trách nhiệm chuyên môn và mặc định tự thực hiện các buổi. Bác sĩ có thể cho phép điều phối nhân sự đủ điều kiện theo từng buổi; quyền này không đổi bác sĩ phụ trách. Nhân viên không tự đổi người thực hiện hoặc xác nhận lịch.
- **Quản lý có thể thu hẹp quyền** của từng vai trò theo từng thao tác trong phần cài đặt phòng khám (`access.restricted_actions`), nhưng **không thể cấp thêm** quyền ngoài bảng trên.
- Bảng trên lấy theo route giao diện (`frontend/src/App.jsx`) và các permission class của API (`clinic/views*.py`, `clinic/permissions.py`). Khi đổi phân quyền, cập nhật cả hai và cập nhật bảng này.

### Bệnh nhân / khách hàng (`customer`)

- Xem dịch vụ, đặt và quản lý lịch hẹn của mình, dùng voucher của mình.
- Chat với phòng khám.
- **Hồ sơ sức khỏe** (`/ho-so-suc-khoe`): chỉ thấy dữ liệu của chính mình và chỉ những bệnh án, đơn thuốc, liệu trình đã được phát hành.
- Không vào được các màn hình nhân sự.

### Quản trị hệ thống (`sysadmin`)

- Là tài khoản kỹ thuật: **không truy cập dữ liệu y tế** (không nằm trong nhóm vai trò phòng khám).
- Vào trang tổng quan và Django admin (`/admin/`, dành cho `manager` và `sysadmin`).
- Nhận thông báo vận hành (lịch hẹn mới, nghỉ phép...) và xem một số dữ liệu quản trị chung như quản lý.

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
