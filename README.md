# Công việc & Dự án
Website: https://iot-pi.tail61a7bf.ts.net/

Ứng dụng web quản lý công việc nhóm nhỏ, xây dựng bằng FastAPI, SQLite và giao diện HTML/CSS/JavaScript thuần. Phiên bản kiểm thử chạy tại cổng 8003.

## Tính năng chính

- Tài khoản: đăng ký, đăng nhập, đổi mật khẩu và tuỳ chỉnh ngôn ngữ VI/EN.
- Dự án: tạo nhóm, quản lý thành viên, lưu trữ hoặc khôi phục dự án.
- Công việc: phân công, trạng thái, mức độ ưu tiên, hạn chót và thông báo giao việc/hoàn thành.
- Trao đổi: lịch sử thay đổi công việc và bình luận thảo luận.

## Cài đặt

Chạy trên PowerShell từ thư mục gốc (lưu ý: khởi tạo cơ sở dữ liệu chỉ áp dụng cho DB mới):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-lock.txt
python -m backend.db
python -m backend.seed --profile demo
.\start.ps1
```

Truy cập tại `http://127.0.0.1:8003`. Cấu hình mẫu tự đọc từ `config/web.env.example`.
