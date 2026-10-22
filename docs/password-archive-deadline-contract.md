# Hoàn thiện mật khẩu, lưu trữ và deadline có giờ

Yêu cầu ngày21/10/2026: bản đúng, mô tả hành vi kỳ vọng. Deadline có cả ngày và giờ theo lựa chọn trực tiếp của người dùng.

## Quy tắc chốt

- Mật khẩu đăng ký/mới:6–128 Unicode codepoints, ít nhất một số ASCII0–9 và một dấu/ký hiệu Unicode (nhóm P hoặc S, ví dụ@); khoảng trắng không thay thế ký tự đặc biệt. Không trim mật khẩu. Đăng nhập và kiểm tra mật khẩu hiện tại tiếp tục chấp nhận mật khẩu cũ đã lưu.
- Mỗi ô mật khẩu ở login/register/settings có nút Hiện/Ẩn riêng, type=button, aria-controls/aria-pressed, mặc định che. Toggle chỉ đổi DOM, không render lại form hoặc lưu secret vào state/storage/log. Submit/đổi trang/đổi ngôn ngữ che lại.
- Sidebar thêm Lưu trữ dự án dưới Dự án. Chỉ liệt kê dự án đã archive do user hiện tại làm chủ; có tìm tên/phân trang. POST /api/projects/{id}/restore body{version}; DELETE /api/projects/{id} body{version}. Hai thao tác chỉ chủ thực hiện trên dự án đã lưu trữ, kiểm tra version và reauthenticate trong write transaction. Restore bỏ archive của project, giữ archive riêng của task. Delete xóa vĩnh viễn project/tasks/comments/history/membership và bỏ các tham chiếu trong snapshot daily_reports; không xóa user/session hoặc báo cáo không liên quan. UI xác nhận rõ mất dữ liệu trước delete; không tự xóa dữ liệu hiện hữu để test.
- Múi giờ giữ IANA trong DB để chuyển giờ/DST chính xác; UI dùng nhãn UTC±HH:MM và địa danh, không lộ chuỗi đường dẫn IANA làm nhãn chính.
- Deadline mới nhập ngày+giờ địa phương; server đổi sang due_at UTC. Đổi múi giờ chỉ đổi giờ/ngày hiển thị và lịch nhóm ngày, giữ nguyên thời điểm thực. Kiểm tra quá hạn theo thời điểm UTC, không chờ hết ngày. Server từ chối giờ địa phương không tồn tại/không rõ do DST bằng422, hướng dẫn chọn giờ khác. Giữ legacy API due_date khi chỉ nhập ngày: quy ước cuối ngày23:59:59 UTC+7; mốc cũ được nâng cấp theo cùng quy tắc để không mất deadline.
- API input due_local=YYYY-MM-DDTHH:mm hoặc null, kèm due_timezone của biểu mẫu; đổi vùng ở phiên khác trả409 và có nút tải lại riêng giữ các trường khác; không nhận cùng due_date. Output thêm due_at UTC, due_local của người xem; due_date là ngày địa phương của người xem. Lịch, lọc/stats, thông báo giao/hoàn thành và biểu mẫu dùng nhất quán. Snapshot báo cáo giữ ngày/múi giờ lúc lập; deadline trong snapshot hiển thị theo múi giờ đang chọn từ mốc đã lưu.

## Kế hoạch thực hiện

- [x] Antigravity: ba slice độc lập — helper nút/CSS, renderer danh sách lưu trữ và nhãn múi giờ, có test, worktree riêng; Codex review trước tích hợp.
- [x] Codex: policy mật khẩu/backend+FE+mock và test biên5/6/128/129, thiếu số/dấu, Unicode, login mật khẩu cũ.
- [x] Codex: restore/delete nguyên tử, quyền/version/rollback và snapshot cleanup; test trên DB tạm hoặc dự án QA mới.
- [x] Codex: schema v3 thêm due_at, backup trước migrate local, chuyển deadline cũ cuối ngày, không reset. Chuyển giờ địa phương/UTC, DST, lịch qua ngày/tháng/năm, form sửa giữ đúng mốc.
- [x] Codex: tích hợp route/client/controller/nav/form/i18n, nút Hiện/Ẩn giữ nội dung; kiểm thử hồi quy, phân quyền, đồng thời, thời gian và HTTP thực tế. Ghi đặc tả/ca kiểm thử chốt, cập nhật manifest, giữ local để người dùng test.

Nghiệm thu tự động/HTTP:204 Python,158 JavaScript và36 kiểm tra HTTP local đạt; schema v3 đã backup/migrate và giữ dữ liệu cũ. Browser local bị chặn nên kiểm tra trực quan còn chờ, không đánh dấu hoàn tất thủ công.
