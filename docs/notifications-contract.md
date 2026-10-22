# Lịch và thông báo — đặc tả triển khai

Ngày 21/10/2026. Bổ sung yêu cầu múi giờ theo tài khoản trong cùng đợt. Bổ sung bản web cơ bản đúng chức năng; mô tả hành vi kỳ vọng. “Đã nộp” sử dụng trạng thái Hoàn thành, không có upload.

## Phạm vi và quy tắc

- Menu Dự án → Lưu trữ dự án → Thông báo → Cài đặt tài khoản. Route #/notifications.
- Hai cột trên màn hình rộng; màn hình nhỏ xếp lịch trước, thông báo sau.
- Lịch tháng chỉ có việc hiện được giao cho chính người đăng nhập trong dự án còn là thành viên. Loại việc/dự án đã lưu trữ. Việc Hoàn thành vẫn có trên ngày deadline, nhãn xanh. Ngày không deadline có trạng thái rỗng. Có tháng trước/sau, hôm nay, chọn ngày và phân trang danh sách việc của ngày. Ngày trên lịch lấy từ due_at theo múi giờ đang chọn; đổi múi giờ có thể chuyển ngày/tháng. Deadline có giờ theo hợp đồng password-archive-deadline-contract.md.
- Thông báo giao việc lấy từ lịch sử tạo/đổi người phụ trách, chỉ người được giao nhận; nội dung ghi người giao, tên việc và hạn nếu có.
- Chuyển từ Chưa làm/Đang làm sang Hoàn thành sinh thông báo cho người phụ trách ở thời điểm đó và chủ dự án. Sửa việc đang Hoàn thành không sinh thêm thông báo hoàn thành. Mở lại rồi hoàn thành tiếp là sự kiện mới.
- Báo cáo nhắc hạn chỉ chụp các việc có hạn, chưa Hoàn thành, đang giao cho tài khoản. Số ngày còn lại = hạn trừ ngày theo múi giờ đã lưu của tài khoản; 0 là đến hạn hôm nay, âm là quá hạn. Mỗi user/ngày có một snapshot, không thay thế khi refresh. Các thay đổi sau snapshot xuất hiện ở lịch hiện tại và sự kiện hoàn thành/giao việc.
- Tạo báo cáo khi mở trang Thông báo lần đầu trong ngày; không tạo bù ngày vắng và không chạy cron/email/push. Có nút làm mới; không tự lặp thông báo bằng timer.
- Feed gồm giao việc, hoàn thành và báo cáo ngày, mới nhất trước; phân trang 20 dòng, độc lập danh sách việc trên lịch. Mặc định Asia/Ho_Chi_Minh; khi lưu múi giờ khác thì thời gian hiển thị, ngày hiện tại và ngày/giờ deadline theo lựa chọn đó. Quá hạn so sánh due_at với hiện tại, độc lập cách hiển thị múi giờ.
- Mỗi lần đọc kiểm tra lại quyền thành viên; sự kiện và chi tiết báo cáo của dự án/việc đã lưu trữ hoặc mất quyền bị ẩn. Báo cáo thuộc user nào chỉ user đó đọc. Không trả session/hash/mật khẩu.

## API và kiểu dữ liệu

Mọi endpoint yêu cầu session. POST yêu cầu CSRF. Không nhận user_id từ client. Lỗi theo envelope hiện có. Tham số không hỗ trợ/lặp, ngày hoặc phân trang không hợp lệ trả 422.

- GET /api/calendar?month=YYYY-MM&date=YYYY-MM-DD&page=1&page_size=20: month mặc định tháng hiện tại theo múi giờ tài khoản, date mặc định hôm nay nếu cùng tháng hoặc ngày đầu tháng. Date phải nằm trong month. Tháng/năm 0001–9999; tháng trước/sau ở biên trả null. Response {month,today,timezone,selected_date,previous_month,next_month,start_weekday,days,tasks}. start_weekday: thứ Hai=0. days có đủ từng ngày {date,day,total,done,overdue}; overdue là số việc chưa hoàn thành có due_at trước thời điểm hiện tại. tasks là paginated {items,page,page_size,total}; item {id,title,project_id,project_name,due_date,due_local,due_at,status,is_overdue}.
- POST /api/notifications/daily body {}: UNIQUE(user_id,report_date) và transaction đảm bảo mở nhiều tab không nhân đôi; trả {created,report_date}. GET không ghi dữ liệu.
- GET /api/notifications?page=1&page_size=20: trả {items,page,page_size,total}. Item chung {id,kind,created_at}; kind=assigned/completed có {task_id,title,project_id,project_name,actor_name,due_date,due_local,due_at}; kind=daily có {report_date,timezone,tasks}, tasks là các snapshot còn quyền xem {id,title,project_id,project_name,due_date,due_local,due_at,days_left}. ID dạng assigned:historyID/completed:historyID/daily:reportID, không dùng làm endpoint cập nhật.

Frontend model {type:'notifications',calendar:<calendar response>,notifications:<feed response>,language:'vi'|'en'}. Query route gồm month,date,day_page,page; hai trang độc lập. Client thêm getCalendar(options), ensureDailyReport(), listNotifications(options). Không dùng mock thay API khi lỗi.

## Kế hoạch và nghiệm thu

- [x] Codex: test và migration v1→v2 chỉ thêm daily_reports và account_preferences; kiểm tra schema nhận diện, backup trước áp dụng DB local, không reset/seed lại. Xác minh rollback, idempotency và giữ nguyên dữ liệu cũ.
- [x] Codex: backend lịch/feed/báo cáo theo quyền; test UTC+7, biên ngày/tháng/năm, phân trang, giao lại/hoàn thành, thu hồi quyền, archive, CSRF và concurrency.
- [x] Antigravity: renderer/CSS/i18n mới trong worktree riêng theo contract này; test render Việt/Anh, link ngày/tháng và hai loại phân trang, XSS, empty/done/overdue.
- [x] Codex: nối route/client/controller/sidebar, kiểm thử load/refresh/session expiry và stale result; các form/tính năng cũ giữ đúng.
- [x] Codex: review diff độc lập, chạy toàn bộ Python/JS, HTTP trên app local sau migrate/restart; thử browser nếu quyền mở. Ghi bằng chứng và giới hạn trực quan; cập nhật manifest và đặc tả, không README/commit/push.

## Múi giờ tài khoản

GET /api/account/preferences trả {timezone,timezones}; PATCH cùng URL nhận đúng {timezone}, yêu cầu session+CSRF và lưu theo user từ session, không nhận user_id. Tham số query không hỗ trợ bị từ chối 422. Mặc định Asia/Ho_Chi_Minh cho tài khoản chưa có preference. Menu Cài đặt gồm Hồ sơ, Ngôn ngữ, Múi giờ, Mật khẩu; chọn rồi bấm Lưu múi giờ. Khác với ngôn ngữ lưu trên browser, múi giờ lưu trong DB và giữ sau đăng nhập lại trên browser khác.

Danh sách hỗ trợ: Asia/Ho_Chi_Minh, Asia/Bangkok, Asia/Singapore, Asia/Tokyo, Asia/Kolkata, UTC, Europe/London, Europe/Berlin, America/New_York, America/Los_Angeles, Australia/Sydney, Pacific/Auckland. Dùng IANA ZoneInfo và tzdata==2026.5; không dùng offset cố định cho vùng có DST. Lý do phụ thuộc trên Windows: [Python ZoneInfo](https://docs.python.org/3/library/zoneinfo.html#data-sources), [tzdata của Python](https://pypi.org/project/tzdata/).

Báo cáo lưu cả múi giờ lúc tạo. Đổi múi giờ không viết lại snapshot cũ; UNIQUE(user_id,report_date) vẫn chặn tạo thêm bản nếu ngày địa phương đó đã có báo cáo, kể cả đổi múi giờ qua lại. Nếu ngày địa phương mới chưa có bản, lần mở mục tiếp theo có thể tạo một bản cho ngày đó. Hiển thị múi giờ gốc cạnh ngày báo cáo bằng nhãn UTC±HH:mm. Số ngày còn lại giữ theo snapshot; ngày/giờ deadline trong API và UI chuyển theo vùng người xem từ due_at. Báo cáo cũ chỉ có due_date quy đổi cuối ngày cố định UTC+7. Title/project_name trong báo cáo là snapshot; ID quyết định quyền xem hiện tại. Sự kiện giao/hoàn thành lấy title và hạn lịch sử từ after_json; tên người thực hiện và tên dự án dùng giá trị công khai hiện tại.

## Bằng chứng nghiệm thu hiện hành

204/204 Python, 158/158 JavaScript, 36 kiểm tra HTTP local đạt ngày 21/10/2026. DB local schema v3 đã backup và giữ nguyên dữ liệu cũ 11 bảng khi migrate v2→v3. Đợt đầu v1→v2 vẫn được test hồi quy, cùng rollback/idempotency. Xem mục 6 functional-spec.md và báo cáo tại workspace gốc data/basic-web-20261021. Chưa xác minh trực quan trên browser do công cụ bị chặn; tài liệu hành vi kỳ vọng.
