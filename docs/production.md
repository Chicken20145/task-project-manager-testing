# Chạy dịch vụ web

Ứng dụng dùng Python 3.13 và một cơ sở dữ liệu SQLite riêng cho mỗi bản. `scripts/run_local.py` chỉ dùng để phát triển trên máy cá nhân. Khi triển khai, dùng `scripts/run_production.py` sau một proxy HTTPS trên cùng máy.

## Chuẩn bị

Tạo virtualenv của dịch vụ và cài bộ runtime, không cài bộ công cụ kiểm thử vào máy chủ:

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install --no-deps -r requirements-web-lock.txt
.venv/bin/python -m pip check
```

Sao chép `config/production.env.example` thành tệp cấu hình riêng, chẳng hạn `/etc/task-manager/production.env`. Chỉ tài khoản quản trị và tài khoản chạy dịch vụ được đọc tệp này. Thay `PUBLIC_ORIGIN` bằng hostname HTTPS đã cấu hình thật, viết thường, không thêm đường dẫn, dấu `/` cuối hoặc `:443`. Nếu dùng Funnel, điền địa chỉ `.ts.net` thật. Cấu hình mẫu còn placeholder sẽ bị từ chối.

Giữ `APP_EDITION` đúng với `edition.json`; `BUILD_ID` được đọc từ tệp này. Cơ sở dữ liệu phải có sẵn tại `data/task-manager.db` trong đúng bản ứng dụng, đúng schema. Launcher không tạo, seed, reset hoặc nâng cấp dữ liệu. Không dùng chung hoặc liên kết tệp DB giữa hai bản.

## Kiểm tra và khởi chạy

Từ thư mục ứng dụng, chạy kiểm tra trước:

```sh
.venv/bin/python scripts/run_production.py --env-file /etc/task-manager/production.env --check
```

Lệnh trên chỉ kiểm tra cấu hình và schema, không mở cổng hoặc ghi dữ liệu. Biến môi trường đã đặt trong tiến trình được ưu tiên hơn tệp cấu hình; gỡ các giá trị cũ trước khi chạy. Khi kiểm tra đạt, khởi chạy bằng:

```sh
.venv/bin/python scripts/run_production.py --env-file /etc/task-manager/production.env
```

Dịch vụ chỉ nghe tại `127.0.0.1:8003`, chạy một worker, không reload. Proxy trên cùng máy kết thúc HTTPS và phải giữ Host khớp `PUBLIC_ORIGIN`. Cookie phiên có Secure, HttpOnly và SameSite=Lax. Không công khai trực tiếp cổng Uvicorn ra mạng.

Launcher tắt tin tưởng forwarded headers; người gửi không thể đổi địa chỉ mà bộ giới hạn xác thực sử dụng bằng `X-Forwarded-For`. Sau proxy, khách có thể dùng chung hạn mức 20 lần xác thực/phút của peer loopback; toàn tiến trình tối đa 120 lần/phút và hai phép hash đồng thời. Phiên lưu trong SQLite; chỉ bộ đếm giới hạn nằm trong bộ nhớ tiến trình và được đặt lại khi tiến trình khởi động lại.

Giới hạn ban đầu là 16 request đang xử lý, backlog 32, keep-alive 5 giây và dừng mềm 15 giây. Body của các API thay đổi dữ liệu được giới hạn 16 KiB và tổng thời gian nhận 10 giây; dữ liệu quá lớn hoặc quá chậm bị từ chối. Các mức này cần được kiểm tra trên máy đích trước khi tăng tải.

## Dữ liệu và vận hành

Chỉ thư mục `web/` được phục vụ tĩnh. Không đặt cấu hình, DB, bản sao lưu hoặc tài liệu riêng vào đó. Tài khoản dịch vụ chỉ cần quyền đọc mã nguồn và ghi thư mục dữ liệu của chính ứng dụng.

`GET /health` cho biết tiến trình còn phản hồi, không xác nhận DB sẵn sàng. Khi kiểm tra nội bộ, gửi Host giống hostname công khai; kiểm tra thêm một thao tác đọc dữ liệu được xác thực để xác nhận DB.

Sao lưu bằng SQLite backup API hoặc dừng dịch vụ trước khi sao chép DB. Thử khôi phục vào tệp riêng rồi kiểm tra schema và dữ liệu trước khi thay tệp đang dùng. Việc kiểm tra chứng chỉ, truy cập ngoài mạng, service tự khởi động, phục hồi sau reboot và tài nguyên Pi được thực hiện trên máy đích trước bàn giao.
