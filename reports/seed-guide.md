# Hướng dẫn database/seed — 14/10/2026

Database local đã được tạo; frontend hiện vẫn dùng mock. Chưa có API đăng nhập/nghiệp vụ hoặc kết nối web với database.

## Ba file hiện có

| File | Profile | Users | Projects | Tasks |
|---|---|---:|---:|---:|
| data/task-manager.db | demo | 3 | 3 | 27 |
| data/load.db | load | 3 | 10 | 1.000 |
| data/stress.db | stress | 3 | 100 | 10.000 |

Đây là dữ liệu giả; không có bảng AI. Đồng hồ fixture2026-10-13 cố định để đối chiếu với FE; khi làm API thật, ngày hiện tại Asia/Ho_Chi_Minh và test clock cần được chọn rõ. Hash dùng salt ngẫu nhiên nên các file seed không giống nhau từng byte, nhưng dữ liệu nghiệp vụ/counts tái lập được.

Tài khoản mẫu nguyen.van.a, tran.thi.b, le.van.c tương ứng owner/member/outsider của dự án10. Mật khẩu mẫu demo123 được hash bằng scrypt khi seed, không nằm trong fixture dictionary hoặc báo cáo kiểm chứng. Đây là mật khẩu công khai cho demo, không dùng cho triển khai public. Biến môi trường DEMO_PASSWORD có thể cung cấp mật khẩu mẫu khác khi tạo một DB rỗng; không ghi credential thật vào source/command history. Registration API sau phải giữ policy15–128codepoints.

## Tạo một database mới

Các lệnh chạy từ thư mục dự án với Python3.13. SQLite runtime cần hỗ trợ STRICT tables/JSON (máy hiện tại3.50.4). `backend.db` không được chạy tự động khi import hoặc startup health.

```powershell
.\.venv\Scripts\python.exe -m backend.db --db data/new-demo.db
.\.venv\Scripts\python.exe -m backend.seed --db data/new-demo.db --profile demo
```

Initialize lại schema đã biết không làm mất dữ liệu. Seed vào DB đã có dữ liệu sẽ từ chối; không append duplicate hoặc reset ngầm. Không chạy lại seed mặc định với file hiện có để mong làm mới dữ liệu.

## Reset có chủ đích

Chỉ file baseline `data/task-manager.db` đã seed và có marker đúng mới được reset. Phải lặp lại đúng đường dẫn để xác nhận; công cụ từ chối file khác, schema lạ/newer, symlink/hardlink và directory alias. Lệnh này xóa dữ liệu demo trong transaction rồi seed lại; nếu seed lỗi, dữ liệu cũ rollback. Không xóa file database hay WAL sidecar.

```powershell
.\.venv\Scripts\python.exe -m backend.seed --reset --db data/task-manager.db --confirm-path data/task-manager.db --profile demo
```

Không thực hiện reset khi người test đang nhập dữ liệu. Khi tách hai bản, cần workflow/config reset riêng cho từng edition; hiện công cụ không cho reset `testing.db`, `ai.db`, `load.db` hoặc `stress.db`.

## Kiểm tra

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
node --test tests/*.test.mjs
```

Số liệu tại máy: reports/database-counts.json và reports/database-profiles.json. Database cùng journal/WAL/SHM nằm trong Git ignore; source schema/seed/repository/tests là phần cần quản lý phiên bản khi được phép commit.
