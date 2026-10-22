# Web/API baseline: các ranh giới đã triển khai

Ngày 15/10/2026. Contract nghiệp vụ: tasks/contracts.md. Không thêm quyền admin toàn cục; owner/member theo từng dự án. Không có endpoint AI trong baseline.

## HTTP và phiên

FastAPI phục vụ duy nhất thư mục web/ ở `/`; API ở `/api`. Không phục vụ repository root, database hoặc config. Trình duyệt dùng URL tương đối cùng origin, credentials same-origin; không có CORS wildcard, token localStorage hoặc fallback mock. Mock còn được giữ để test logic độc lập.

Đăng ký trả public user và không tự đăng nhập. Backend hash bằng primitive scrypt đã có; policy đăng ký 15–128 codepoints, không trim mật khẩu. Seed `demo123` là credential giả dùng để test luồng đăng nhập cũ; không dùng làm tài khoản public.

Login tạo token ngẫu nhiên 32 byte; SQLite chỉ lưu SHA256 của token, user_id, CSRF và thời điểm. Cookie HttpOnly/SameSite=Lax, Path=/, không Domain; thời hạn tuyệt đối 8 giờ. Login thành công thu hồi token cũ của trình duyệt đó; logout xóa phiên trong DB và cookie. Phiên và dữ liệu còn qua restart. Mỗi request xác thực lại từ DB. Request đang xử lý đồng thời logout có thể hoàn tất; logout chặn request bắt đầu xác thực sau đó.

Mọi mutation cần `X-Requested-With: TaskManager`. Body phải application/json, ngoại trừ DELETE/logout không cần body. Nếu Origin có mặt thì phải khớp PUBLIC_ORIGIN chính xác; Origin:null và Sec-Fetch-Site:cross-site bị chặn. Client không phải browser có thể thiếu Origin nhưng vẫn cần custom header. Mutation đã đăng nhập còn cần X-CSRF-Token của đúng phiên, so sánh constant-time. Login/register được bảo vệ bằng custom header + JSON + origin; không dùng CSRF của phiên cũ để đăng nhập.

HTTP development chỉ cho loopback. Chế độ production yêu cầu HTTPS origin và Secure cookie tên `__Host-task_manager_session`. Cookie development là `task_manager_session`. Đây là cấu hình chuẩn bị, chưa xác minh HTTPS/domain/Pi hoặc chứng nhận sẵn sàng public.

## Validation và dữ liệu

Đếm số byte stream trước parse JSON: tối đa 16 KiB, kể cả không có Content-Length. Backend từ chối extra fields, sai kiểu/enum/ngày/ID, NUL và lone surrogate. Lỗi dùng envelope đã chốt, không echo input mật khẩu, SQL hoặc stacktrace. API no-store; có CSP/self, nosniff, frame deny và referrer policy. Generic 500 cũng giữ các header bảo vệ.

Auth có giới hạn dùng chung login/register:20 lần/IP/phút,120 lần/phút cho một tiến trình, tối đa 2 hash song song. IP lấy từ request.client; không tự đọc header forwarded. Counter dùng lock và giới hạn số phần tử. Trước khi chạy nhiều worker/instance hoặc public cần thiết kế limiter dùng chung và proxy trust đã xác minh. Không khẳng định bộ giới hạn local là cơ chế chống lạm dụng production hoàn chỉnh.

Mỗi endpoint đồng bộ tạo/dùng/đóng connection trong cùng worker thread. SQLite FK bật trước transaction. Read có snapshot chung cho kiểm tra membership và truy vấn; mutation dùng Store BEGIN IMMEDIATE để kiểm tra lại quyền/archive/version và ghi dữ liệu+audit nguyên tử. Truy vấn nội bộ queries.py không tự phân quyền; chỉ API đã kiểm tra resource mới gọi. Không nhận actor_id từ body.

Không initialize/reset/migrate tự động khi khởi động hoặc khi gọi API. Missing/unknown schema trả503; health chỉ là liveness. Múi giờ nghiệp vụ duy nhất hiện tại là Việt Nam UTC+7 cố định, không phụ thuộc ngày local của Windows. Đây không phải hỗ trợ lịch sử múi giờ hoặc nhiều vùng. Filter chạy trước count/page; task/project ID giảm dần, comment/history ID tăng dần. `assignee_id=unassigned` nghĩa là null; bỏ query nghĩa tất cả; overdue=true/false rõ ràng. Stats không nhận bộ lọc danh sách.

## Nguồn kỹ thuật

Triển khai đối chiếu [FastAPI cookies](https://fastapi.tiangolo.com/advanced/response-cookies/), [Starlette middleware và vị trí xử lý500](https://starlette.dev/middleware/), [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Python3.13 sqlite3](https://docs.python.org/3.13/library/sqlite3.html) và [datetime.timezone](https://docs.python.org/3.13/library/datetime.html#datetime.timezone).
# Nhận diện và cách ly bản local — 19/10/2026

Hai source trong editions/ đọc edition.json từ thư mục chứa source, không từ working directory. APP_EDITION/BUILD_ID nếu đặt phải khớp marker. /api/meta chỉ công khai edition/build_id/ai_enabled; frontend hiện nhãn bản, chưa kích hoạt AI.

Cookie development riêng: task_manager_ai_session và task_manager_testing_session; production thêm tiền tố __Host- cùng Secure. Baseline giữ tên cũ. Database bản đã tách chỉ nhận data/task-manager.db thuộc chính source; startup và API kiểm tra đường dẫn canonical, symlink/junction/hardlink. CLI seed/reset cũng tính file mặc định từ source đó; không tự reset khi startup.

Các guard này ngăn cấu hình nhầm và alias file thông thường; hai tiến trình cùng tài khoản hệ điều hành vẫn có quyền filesystem của tài khoản đó. Public cần hai hostname HTTPS như kế hoạch. Bằng chứng local: báo cáo edition-split-completion.md trong reports/ của workspace điều phối.
