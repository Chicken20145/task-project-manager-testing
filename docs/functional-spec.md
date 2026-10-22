# Đặc tả chức năng — Quản lý công việc và dự án nhỏ

Ngày 22/10/2026. Tài liệu quy định hành vi kỳ vọng để đối chiếu khi kiểm thử.

## 1. Mục tiêu và phạm vi

Ứng dụng quản lý công việc và dự án cho nhóm nhỏ. Đăng ký, đăng nhập, cài đặt tài khoản, dự án, thành viên, công việc, lịch deadline và thông báo trong web là phạm vi hiện tại. Không thêm email/khôi phục mật khẩu, OAuth, MFA, thông báo đẩy, thanh toán hoặc AI. Vai trò chủ dự án/thành viên tính riêng theo từng dự án; không có admin toàn cục.

## 2. Quy tắc dữ liệu

Độ dài chuỗi tính bằng Unicode codepoints. Trim tên đăng nhập, tên hiển thị, tên dự án, tiêu đề và bình luận; không trim mô tả hoặc mật khẩu. Từ chối NUL/lone surrogate. ID là số nguyên dương. Deadline gồm ngày và giờ địa phương YYYY-MM-DDTHH:mm hợp lệ; được để trống hoặc trong quá khứ. Server lưu thời điểm UTC trong due_at. Ngày hiện tại tính theo múi giờ đã lưu của tài khoản, mặc định Asia/Ho_Chi_Minh (UTC+7). Đổi múi giờ tự chuyển ngày/giờ hiển thị, giữ nguyên thời điểm thực; lịch nhóm lại theo ngày địa phương mới. Deadline cũ chỉ có ngày được hiểu là 23:59:59 UTC+07:00.

| Trường | Hợp lệ |
|---|---|
| Tên đăng nhập |3–32 ký tự ASCII chữ/số/._-, chuyển chữ thường, duy nhất, không đổi sau đăng ký |
| Tên hiển thị |1–80 codepoints sau trim |
| Mật khẩu đăng ký/mật khẩu mới |6–128 codepoints, có ít nhất một số ASCII 0–9 và dấu/ký hiệu Unicode nhóm P/S (ví dụ @); giữ nguyên khoảng trắng |
| Tên dự án / tiêu đề việc |1–100 /1–120 codepoints sau trim |
| Mô tả dự án/việc |0–2.000 codepoints |
| Bình luận |1–1.000 codepoints sau trim |
| Trạng thái / ưu tiên |todo,doing,done / low,medium,high |

Tài khoản seed công khai chỉ dành cho demo: nguyen.van.a, tran.thi.b, le.van.c; mật khẩu demo123. Policy mới áp dụng cho đăng ký/đổi mật khẩu, không chặn đăng nhập bằng mật khẩu seed cũ.

## 3. Yêu cầu và tiêu chí chấp nhận

| ID | Chức năng và điều kiện | Kết quả đúng, trường hợp bị từ chối |
|---|---|---|
| AUTH-01 |Khách đăng ký với tên đăng nhập/tên hiển thị/mật khẩu/nhập lại |Hợp lệ tạo đúng1 tài khoản, chuyển đăng nhập và chưa tự đăng nhập. Trùng tên=409; sai ràng buộc=422; nhập lại không khớp bị chặn ở UI. Không cho tự chọn vai trò. |
| AUTH-02 |Đăng nhập tài khoản tồn tại |Đúng mật khẩu trở về trang cần đăng nhập đã yêu cầu trước đó; mặc định vào danh sách dự án. Trang đích vẫn kiểm tra quyền theo phiên mới. Sai thông tin=401, thông báo chung không tiết lộ tài khoản tồn tại. Session cookie HttpOnly; không lưu mật khẩu/token trong localStorage. |
| AUTH-03 |Người đã đăng nhập đăng xuất |Hủy phiên hiện tại, quay về đăng nhập, không hiện thông báo “Đã đăng xuất”. URL cần đăng nhập không truy cập được bằng phiên đã hủy. |
| ACCOUNT-01 |Người đăng nhập xem/sửa tên hiển thị tại #/settings |Tên đăng nhập chỉ đọc. Tên hiển thị1–80 sau trim được lưu DB và còn sau reload/đăng nhập lại; không đổi quyền, mật khẩu hoặc người dùng khác. Sai/thiếu field=422. |
| ACCOUNT-02 |Người đăng nhập đổi mật khẩu |Cần mật khẩu hiện tại đúng, mật khẩu mới 6–128 ký tự có số và ký tự đặc biệt, khác mật khẩu hiện tại và nhập lại khớp. Thành công cập nhật nguyên tử, hủy tất cả phiên của chính người dùng và yêu cầu đăng nhập lại. Mật khẩu cũ không đăng nhập được; mật khẩu mới được; phiên người khác không bị ảnh hưởng. |
| ACCOUNT-03 |Mật khẩu hiện tại sai, mật khẩu mới sai, nhập lại lệch hoặc request không hợp lệ |Báo lỗi gắn trường; không đổi hash và không hủy phiên vì lỗi nhập liệu. Thiếu phiên=401; CSRF sai=403. Không ghi mật khẩu vào draft/lịch sử/log/storage. Các yêu cầu hash được giới hạn số lượng/đồng thời. |
| LANG-01 |Khách chọn Tiếng Việt/English ở đăng nhập/đăng ký; người đăng nhập chọn tại Cài đặt → Ngôn ngữ |Đổi nhãn, nút, thông báo thông dụng và tiêu đề UI ngay khi chọn; không có nút lưu riêng. html.lang khớp vi/en; lựa chọn lưu trên cùng browser, giữ sau reload. Mặc định vi; giá trị storage lạ/lỗi storage vẫn chạy được. Lỗi kỹ thuật chưa có trong từ điển hiển thị nguyên văn, được escape. |
| LANG-02 |Đổi ngôn ngữ ngay trên form đăng nhập/đăng ký/cài đặt |Giữ route và dữ liệu đang nhập trên trang đó; không tự submit hoặc gọi mutation API. Không dịch tên/tiêu đề/mô tả/bình luận do người dùng nhập. Mật khẩu chỉ giữ tạm trong DOM, không lưu draft/storage. Không cam kết giữ nháp chưa lưu khi rời trang khác để vào Cài đặt. |
| TZ-01 |Người đăng nhập chọn múi giờ tại Cài đặt |Chọn một trong 12 múi giờ có nhãn UTC±HH:mm và địa danh (lưu IANA bên trong) rồi Lưu; lưu DB theo tài khoản, còn sau đăng nhập lại, không ảnh hưởng người khác. Mặc định Asia/Ho_Chi_Minh; giá trị lạ=422, thiếu phiên=401, sai CSRF=403. Thời gian thông báo/bình luận/lịch sử/deadline và ngày lịch theo lựa chọn; hỗ trợ DST. Quá hạn so sánh thời điểm thực với hiện tại, không đổi vì đổi múi giờ. |
| NOTIFY-01 |Mục Thông báo giữa Lưu trữ dự án và Cài đặt |Lịch tháng đánh dấu ngày có deadline của việc hiện giao cho mình trong dự án còn quyền xem và chưa archive; chọn ngày hiện việc ngày đó, kể cả done. Có tháng trước/sau, hôm nay, hai loại phân trang độc lập; ngày/tháng sai=422. Desktop hai cột, màn nhỏ xếp dọc. |
| NOTIFY-02 |Giao việc hoặc chuyển sang done |Người nhận assignment thấy người giao/việc/hạn từ lịch sử. Chuyển todo/doing→done báo cho chủ dự án và người được giao lúc hoàn thành, không trùng khi hai vai trò là cùng user. Sửa nội dung của việc đang done không báo hoàn thành thêm; mở lại rồi done là sự kiện mới. “Đã nộp” là done, không có upload. |
| NOTIFY-03 |Mở mục Thông báo lần đầu theo ngày địa phương |Tạo một snapshot nhắc các việc có hạn chưa done đang giao cho mình; hiện còn N ngày/đến hạn hôm nay/quá hạn N ngày. Mỗi user/ngày chỉ một bản kể cả nhiều tab; lưu múi giờ gốc, không viết lại ngày lập/múi giờ gốc/days_left khi refresh hoặc đổi múi giờ; riêng ngày/giờ deadline hiển thị được chuyển từ due_at sang vùng đang chọn. Không tạo bù ngày vắng; không chạy cron/email/push. |
| NOTIFY-04 |Đọc lịch/feed và báo cáo cũ |Session quyết định user; mọi lần đọc kiểm tra lại thành viên và archive, kể cả task nằm trong snapshot. Không đọc báo cáo của người khác, không rò event/total của dự án mất quyền. Feed mới trước, tối đa100/trang, mặc định20; GET không tạo báo cáo. |
| PROJECT-01 |Tài khoản đăng nhập tạo dự án |Tên/mô tả đúng tạo1 dự án, người tạo là chủ và thành viên. Version bắt đầu1. Người ngoài không thấy trong danh sách hoặc xem qua ID (404). |
| PROJECT-02 |Chủ sửa/lưu trữ dự án |Sửa với version hiện tại tăng1. Lưu trữ phải xác nhận; Hủy không gửi mutation. Dự án archive ẩn khỏi danh sách, mở trực tiếp vẫn xem nhưng mọi nội dung chỉ đọc. Chủ xem các dự án đã lưu trữ tại #/projects/archived, có tìm tên và phân trang; thành viên không có dự án đó trong danh sách lưu trữ của mình. |
| PROJECT-03 |Chủ khôi phục dự án đã lưu trữ |Bỏ archived_at của dự án, tăng version, audit updated; thành viên và nội dung được giữ. Công việc đã lưu trữ riêng vẫn giữ trạng thái lưu trữ. Active=409, member=403, người ngoài=404; version cũ=409. |
| PROJECT-04 |Chủ xóa vĩnh viễn dự án đã lưu trữ |Phải xác nhận mất dữ liệu, Hủy không gửi API. Xóa project/tasks/comments/history/membership và tham chiếu snapshot của riêng dự án trong một transaction; không xóa user/session hoặc nội dung dự án khác. Chỉ dự án đã lưu trữ; quyền/version/session/CSRF kiểm tra lại trong transaction, kể cả phiên hết hạn lúc chờ. Lỗi DB rollback toàn bộ. Xóa lại=404. |
| DEADLINE-01 |Chủ nhập/sửa hạn có giờ |Gửi due_local và due_timezone của biểu mẫu; server đổi theo múi giờ tài khoản. Bỏ qua deadline khi không sửa để giữ cả giây của dữ liệu cũ; null để xóa hạn. Không nhận cùng due_date. API vẫn nhận due_date cũ theo cuối ngày UTC+7. |
| DEADLINE-02 |Múi giờ đổi ở tab khác hoặc giờ DST không rõ |Múi giờ biểu mẫu cũ=409 TIMEZONE_CHANGED; UI có nút tải lại deadline/vùng mới, giữ các trường khác. Giờ địa phương không tồn tại hoặc trùng do DST=422, hướng dẫn chọn giờ khác. Không tự chọn một trong hai mốc. |
| MEMBER-01 |Chủ thêm tài khoản đã tồn tại |Thành viên có quyền xem sau thêm; trùng=409; không thêm tài khoản không tồn tại, không loại chủ. Thành viên không được quản lý thành viên. |
| MEMBER-02 |Chủ loại thành viên |Sau xác nhận, người bị loại mất quyền truy cập; mọi việc được giao chuyển Chưa giao, kể cả việc đã archive, tăng version và ghi audit cùng transaction. Không xóa việc/bình luận. |
| MEMBER-03 |Chủ tìm tài khoản để thêm thành viên |Ban đầu không hiện danh sách tài khoản gợi ý và không gọi API tìm tài khoản. Nhập tên hiển thị hoặc tên đăng nhập, bấm Tìm: chuỗi sau trim được tìm literal, không phân biệt hoa thường, có phân biệt dấu trong một trong hai trường. Rỗng/toàn khoảng trắng: không hiện gợi ý; API trả danh sách rỗng. Không khớp: báo không tìm thấy. Kết quả chỉ gồm id,username,display_name; tài khoản đã trong dự án có nhãn và không có nút Thêm. Danh sách thành viên hiện tại vẫn hiển thị riêng. Chỉ chủ dự án dùng được API tìm tài khoản; thành viên thường=403. |
| TASK-01 |Chủ tạo/sửa/giao công việc |Việc mới luôn todo, ưu tiên mặc định medium; assignee thuộc dự án hoặc null. Owner được sửa fields; member chỉ sửa status việc được giao. Chuyển tự do trong ba trạng thái. User khác/assignee ngoài dự án bị từ chối. |
| TASK-02 |Hai lượt sửa cùng version |Chỉ một thành công; lượt sau409, DB và lịch sử không bị ghi đè. UI giữ bản nháp, yêu cầu tải dữ liệu mới và người dùng chủ động lưu lại. |
| TASK-03 |Chủ lưu trữ việc |Hủy hộp xác nhận không đổi dữ liệu. Xác nhận ẩn việc khỏi danh sách/thống kê, vẫn xem chi tiết/bình luận/lịch sử qua ID; không cho sửa/thêm bình luận. |
| QUERY-01 |Tìm/lọc công việc |q tìm literal trong tiêu đề HOẶC mô tả, không phân biệt hoa thường, có phân biệt dấu; %/_ là ký tự thường. Các filter kết hợp AND. Lọc trước count/phân trang, không lẫn dữ liệu dự án khác. |
| QUERY-02 |Phân trang |Mặc định20, page>=1, page_size1–100. Project/task ID giảm dần; bình luận/lịch sử tăng dần. Tổng số dòng bằng số kết quả sau lọc; trang cuối không trùng/mất dòng. |
| QUERY-03 |Quá hạn và thống kê |Quá hạn khi due_at < thời điểm hiện tại, status!=done và chưa archive. Bằng đúng hạn chưa quá hạn; sau hạn một giây là quá hạn, kể cả trong cùng ngày. “Trong hạn” gồm tất cả việc không quá hạn, kể cả không hạn/đã hoàn thành. Stats tính mọi việc chưa archive trong dự án, độc lập filter danh sách. |
| COMMENT-01 |Thành viên dự án bình luận |Được bình luận mọi việc đang hoạt động của dự án; sai quyền/archive bị chặn. Bình luận không đổi task.version; lịch sử ghi create/update/archive/assignee_removed. |
| UI-01 |Lỗi API, tải chậm, input đặc biệt |Có loading/empty/error, không thay DB thật bằng mock. Escape nội dung người dùng, giữ nháp công khai phù hợp; nháp trong memory không bảo đảm giữ qua F5. Timeout không chứng minh server chưa ghi: kiểm tra lại trước gửi tiếp. |
| UI-02 |Thông báo và lỗi nhập liệu |Thông báo thành công có khung xanh; lỗi có khung đỏ và role=alert; thông tin có khung riêng và role=status. Form do app xử lý có novalidate để dùng thông báo Việt/Anh của app. Trước khi gửi, kiểm tra validity của trường có tên, đang bật và có thể nhập; trường trống/sai kiểu được đánh dấu aria-invalid, có mô tả dưới trường và focus trường lỗi đầu tiên. Thiếu ít nhất một ô bắt buộc (kể cả tên đăng nhập/mật khẩu) hiển thị box “Vui lòng điền đầy đủ các ô bắt buộc.”; tiếng Anh là “Please fill in all required fields.”. Không gửi API khi còn lỗi native; backend vẫn kiểm tra quy tắc dữ liệu. Mật khẩu đăng ký/mới tính 6–128 codepoints và kiểm tra số/ký tự đặc biệt, không lưu giá trị vào thông báo/draft/storage. Thông báo thành công cũ được xóa khi bắt đầu thao tác tiếp theo. |
| UI-03 |Hiện/Ẩn mật khẩu |Sáu ô ở login/register/settings có nút riêng type=button, mặc định che; toggle giữ nguyên giá trị/vị trí chọn, không submit hay lưu secret. Submit/render/đổi trang/ngôn ngữ che lại; không tự ghi mật khẩu vào HTML/state/storage. |

## 4. API mới cho cài đặt tài khoản

- PATCH /api/account/profile: JSON {display_name}; session+CSRF; trả200 public User gồm id,username,display_name.
- POST /api/account/password: JSON {current_password,new_password}; session+CSRF; thành công204 và xóa cookie. confirm_password chỉ ở UI. Sai mật khẩu hiện tại=422 CURRENT_PASSWORD_INVALID với details.current_password; trùng mật khẩu mới=422; phiên mất hiệu lực=401.
- Các thao tác ghi kiểm tra lại phiên và CSRF trong transaction bằng thời gian hiện tại; login đang chạy bằng hash cũ không được tạo phiên sau khi mật khẩu đã thay đổi.

Đổi mật khẩu yêu cầu phiên còn hiệu lực và kiểm tra mật khẩu hiện tại; hủy mọi phiên của chính user là policy của app này. Tham khảo [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#change-password-feature) và [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#renew-the-session-id-after-any-privilege-level-change). Phiên bị thu hồi hoặc hết hạn trong lúc chờ khóa ghi không được tiếp tục thao tác.

## 5. Cơ sở kiểm thử và báo lỗi

Theo ISTQB CTFL v4.0.1 do người dùng cung cấp: §1.1/tr15, §1.4.4/tr20–21, §2.2.2/tr29, §4.2/tr39–42, §4.4/tr43–44 và §5.5/tr56–57. Đây là cách áp dụng cho bài tập, không phải yêu cầu PDF buộc phải cài lỗi.

Mỗi test có Test ID, Requirement ID, điều kiện/dữ liệu, bước, expected và actual/build. Dùng phân vùng tương đương, biên 5/6/7 và 127/128/129, có/thiếu số và dấu của mật khẩu mới; biên0/1/2 và79/80/81 của tên hiển thị; bảng vai trò×archive×thao tác; chuyển trạng thái đăng nhập/lưu trữ. Thêm khám phá có mục tiêu: refresh, Back, nhiều tab, Unicode, đổi ngôn ngữ khi có lỗi form.

Mỗi báo lỗi ghi: ID/tiêu đề, build/môi trường, Requirement/Test ID hoặc căn cứ kỳ vọng, dữ liệu trước test, từng bước tái hiện, expected, actual, ảnh/log không chứa secret, tần suất, severity (tác động), priority (ưu tiên), trạng thái. Hành vi ngoài đặc tả cần căn cứ nhu cầu sử dụng và phân loại: lỗi, báo nhầm hay yêu cầu thay đổi. Không mặc định mọi tính năng chưa có là lỗi.

## 6. Kiểm tra

Ca kiểm thử nằm ở [test-cases.md](test-cases.md). Mỗi ca có dữ liệu, bước và expected; kết quả thực chạy cần ghi kèm phiên bản và môi trường. Các kiểm tra tự động nằm trong tests/:

```powershell
python -m pytest tests -q
node --test tests/*.test.mjs
```

Dùng tài khoản và dự án QA riêng. Kiểm tra cả thao tác trên giao diện và gọi API trực tiếp: thiếu phiên, CSRF sai, sai vai trò, ID của dự án khác, dữ liệu vượt biên, đồng thời và thu hồi phiên. API kiểm tra trên server, không dựa vào việc ẩn nút trên giao diện. Nội dung người dùng phải được hiển thị dưới dạng văn bản an toàn. Các ca desktop/mobile và thao tác bàn phím cần kiểm tra thêm trên trình duyệt thật.
