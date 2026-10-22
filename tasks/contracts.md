# Quy ước dữ liệu và API — bản nền đúng

Ngày lập: 12/10/2026. Cập nhật15/10: endpoint nghiệp vụ đã triển khai trong backend/api.py; frontend dùng HTTP cùng origin. Kết quả nghiệm thu ghi riêng trong reports/baseline.md.

## Quy tắc chung

- ID là số nguyên dương. JSON dùng snake_case, ngày hạn YYYY-MM-DD hoặc null; timestamp UTC có timezone.
- Trạng thái todo/doing/done; ưu tiên low/medium/high. Quá hạn: due_date < ngày hiện tại Asia/Ho_Chi_Minh và status != done, chỉ tính việc chưa archive.
- assignee_id có thể null (Chưa giao), hoặc ID owner/thành viên hiện tại của dự án; không giao cho người ngoài. Mock đã thực hiện quy tắc này; schema/BE cần giữ tương ứng.
- Chuỗi title sau trim dài 1–120 ký tự; description tối đa 2.000; comment dài 1–1.000; tên project dài 1–100.
- Danh sách {items, page, page_size, total}; page >=1; page_size 1–100, mặc định 20. Project/task ID giảm dần; comment/history ID tăng dần. Count/filter trước phân trang. Query lặp/không hỗ trợ bị422; assignee_id=unassigned là null, bỏ query là tất cả; overdue chỉ nhận true/false. Stats không nhận bộ lọc danh sách.
- Error {error:{code,message,details}}. details chỉ chứa thông tin validation an toàn, không stacktrace, SQL hoặc mật khẩu.
- 401: chưa đăng nhập; 403: thành viên có quyền xem nhưng thiếu quyền thao tác; 404: không tồn tại hoặc người ngoài không được biết tài nguyên; 409: version/duplicate conflict; 422: input sai; 503: AI chưa khả dụng; 504: AI timeout.
- FE không được tự quyết quyền dựa trên việc ẩn nút; BE kiểm tra từng request. FE hiển thị lỗi 409 và cho tải dữ liệu mới, không tự ghi đè.

## Mẫu Task và lỗi

```json
{"id":101,"project_id":10,"title":"Soạn mô tả dự án","description":"Ghi phạm vi bản đầu","assignee_id":2,"due_date":"2026-10-20","priority":"medium","status":"todo","version":1,"is_overdue":false,"created_at":"2026-10-12T00:00:00Z","updated_at":"2026-10-12T00:00:00Z"}
```

```json
{"error":{"code":"VERSION_CONFLICT","message":"Công việc đã được cập nhật. Hãy tải lại trước khi lưu.","details":{}}}
```

## Quyền nghiệp vụ

| Thao tác | Chủ dự án | Thành viên |
|---|---|---|
| Xem dự án/việc/bình luận/lịch sử | Có | Có trong dự án đang tham gia |
| Sửa/archive dự án đang xem, thêm/loại thành viên | Có | Không |
| Tạo/sửa/giao/archive công việc | Có | Không |
| Đổi trạng thái công việc | Có | Chỉ việc được giao |
| Thêm bình luận | Có | Có trên việc của dự án |
| Đề xuất AI và xác nhận tạo việc | Có ở bản AI | Không |
| Tóm tắt AI | Có ở bản AI | Có trong dự án đang tham gia |

Chủ dự án luôn là thành viên; không loại chủ. Khi loại member, hủy assignment còn lại và ghi audit trong cùng transaction. Quyền hiện tại được kiểm tra lại khi xác nhận đề xuất AI.
Hủy giao do loại member áp dụng cả task đã archive trong project đang hoạt động: giữ archived_at, tăng version và ghi assignee_removed. Mutation trực tiếp lên nội dung archive vẫn bị cấm. Đây là quy tắc đã có trong mock và database, không phải mở quyền chỉnh sửa task archive.
Mọi tài khoản đăng nhập có thể tạo dự án mới và trở thành owner của dự án đó; không cấp vai trò owner/member toàn cục khi đăng ký.

Đăng ký: username trim/lowercase,3–32 ký tự ASCII chữ/số/._-; display_name trim,1–80 codepoints; password15–128 codepoints, không trim, cho phép Unicode/khoảng trắng. confirm_password chỉ ở UI. Username trùng=409; input sai=422. Register trả public User, không tự login. Mock giữ credential riêng trong memory; BE thật phải hash password và thực thi policy/session. Mốc15 ký tự được chọn cho luồng không MFA theo [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html); demo123 chỉ là mật khẩu seed của mock.
Archive thay cho hard delete trong bản chính. Project archive làm nội dung chỉ đọc; task archive ẩn khỏi danh sách/dashboard nhưng giữ comment/audit. Không có unarchive trong phạm vi chính.

## API baseline đã triển khai

| Method / path | Input / output và hành vi |
|---|---|
| GET /api/meta | Công khai: edition baseline/ai/testing, build_id, ai_enabled=false ở mốc SPLIT; không trả đường dẫn, cấu hình bí mật hoặc dữ liệu người dùng |
| POST /api/auth/register | username/display_name/password -> public User;201; không trả credential; không tự tạo phiên |
| POST /api/auth/login | username/password -> user + csrf_token; session cookie HttpOnly; không trả password/hash |
| GET /api/auth/me | User đăng nhập hiện tại và csrf_token; 401 nếu hết phiên |
| POST /api/auth/logout | Hủy phiên; 204 |
| GET /api/projects | q/page/page_size; danh sách dự án đang có quyền và chưa archive, tìm theo tên trước phân trang |
| POST /api/projects | name/description -> Project, version=1, owner=current user; 201 |
| GET /api/projects/{id} | Project + vai trò người dùng và thành viên hiện tại |
| PATCH /api/projects/{id} | name/description/version -> Project; stale version=409 |
| POST /api/projects/{id}/archive | version -> Project đã archive, audit; 200 |
| GET /api/users | Chủ dự án đăng nhập được tìm username trong bộ tài khoản demo, dữ liệu tối thiểu; không lộ hash/session |
| POST /api/projects/{id}/members | user_id -> Member; duplicate=409 |
| DELETE /api/projects/{id}/members/{user_id} | 204; chỉ owner, cấm loại owner |
| GET /api/projects/{id}/tasks | q tìm literal không phân biệt hoa thường trong title hoặc description; status/priority/assignee_id/overdue/page/page_size; Task chưa archive |
| POST /api/projects/{id}/tasks | title/description/assignee_id/due_date/priority; status mặc định todo; 201 |
| GET /api/tasks/{id} | Task; 404 nếu không được xem |
| PATCH /api/tasks/{id} | owner sửa fields + version; member chỉ status + version của việc được giao; tăng version nguyên tử |
| POST /api/tasks/{id}/archive | version -> Task archived, audit; chỉ owner |
| GET /api/tasks/{id}/comments | Phân trang comment theo id tăng dần |
| POST /api/tasks/{id}/comments | body -> Comment, 201; cấm ghi khi archive |
| GET /api/tasks/{id}/history | Phân trang audit, id tăng dần |
| GET /api/projects/{id}/stats | total/todo/doing/done/overdue từ database, loại task archived |

API mutation xác thực session và CSRF; public HTTPS dùng Secure cookie. Token/session thuộc BE; mock FE chỉ mô phỏng phiên và quyền, không được coi là kiểm thử bảo mật.

## API chỉ ở bản hoàn chỉnh có AI

Thiết kế cho giai đoạn AI; hiện chưa triển khai các endpoint dưới đây.

- POST /api/projects/{id}/ai/proposals: description -> {proposal_id,intent,tasks,clarification}; draft lưu riêng, chưa tạo Task. Tối đa 5 task, chỉ title/description do AI đề xuất.
- POST /api/projects/{id}/ai/proposals/{proposal_id}/confirm: tasks người dùng duyệt + request_id -> danh sách Task; xác nhận cùng proposal một lần, retry đúng request replay; payload khác=409. Toàn bộ tạo Task trong một transaction.
- POST /api/projects/{id}/ai/summary: backend lấy snapshot quyền hiện tại -> {summary,referenced_task_ids,snapshot_at}; số liệu do backend tính.
- Không có các route này ở bản không AI; không trả giả response như đã gọi model.

## Mock FE và thay bằng API thật

web/data/client.js cung cấp cùng thao tác domain cho hai provider: mock và HTTP. Chế độ dev chọn provider rõ ràng; khi deploy baseline phải dùng HTTP, không âm thầm fallback mock khi BE lỗi.
Mock có tài khoản owner/member/outsider và dữ liệu dự án đủ trạng thái. Cố định đồng hồ dev cho ca deadline, cung cấp loading/empty/error/409 để kiểm chứng UX. Không cài lỗi bài tập ở giai đoạn FE mock.
Chi tiết DB ở database-plan.md. Thay đổi contract phải cập nhật mock, schema và test liên quan cùng một slice.
