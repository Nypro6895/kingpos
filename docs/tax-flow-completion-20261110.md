# Tax workspace: tổng hợp yêu cầu và bàn giao local — 2026-11-10

Phạm vi: toàn bộ quyết định trong chat, giữ code hiện có, bổ sung các khoảng trống. Chưa deploy, chưa chạy migration trên dữ liệu thật, chưa gửi lời mời hoặc phát sinh thanh toán thật.

## Danh sách yêu cầu đã đối chiếu

| Nhóm | Yêu cầu đã chốt | Kết quả trong source local |
|---|---|---|
| Tài khoản | Dùng tài khoản Reylumi cá nhân; không tạo tài khoản salon cho người khai thuế | Có; dùng chung đăng ký, đăng nhập, xác minh và khôi phục |
| Vai trò | Tax là workspace tự kích hoạt; chuyển được Owner/Staff/Personal/Tax qua avatar | Có; Tax không phụ thuộc salon hoặc gói salon |
| Lối vào | `/tax` dùng trực tiếp trên web, cài PWA tùy chọn; ưu tiên Windows | Có; không bắt cài app hoặc đăng ký salon |
| Hồ sơ | Tên, email, điện thoại, tên đơn vị tùy chọn; bảo mật/session của tài khoản chung | Có; không tự coi đây là chứng nhận hành nghề |
| Kết nối | Một tài khoản thêm nhiều salon bất kỳ được owner cấp quyền | Có; salon active chỉ là điều kiện cần, không tự cấp quyền |
| Thủ công | Owner tạo ID/password kết nối, tách biệt mật khẩu tài khoản cá nhân | Có; đổi password/Disconnect thu hồi thế hệ kết nối cũ |
| Lời mời | Owner tạo packet/link, người mới đăng ký rồi tiếp tục đúng salon | Bổ sung link mời gắn salon, giữ `next` qua login/signup và chuỗi onboarding chung |
| Nhận lời mời | Chưa có Tax: kích hoạt và kết nối cùng một lần xác nhận; có Tax: xác nhận kết nối | Bổ sung; mở link GET không tạo kết nối; nhận xong mở workspace salon |
| Lời mời lỗi | Hết hạn, thu hồi, đã dùng bởi tài khoản khác, đổi password, salon hết gói | Bổ sung kiểm tra DB; link 7 ngày, hash lưu DB, một tài khoản nhận, tạo mới hủy link chưa nhận cũ |
| Đổi tài khoản nhận | Hiện danh tính đang đăng nhập; có đường đăng xuất rồi đăng nhập khác, giữ lời mời | Bổ sung |
| Gia hạn tại chỗ | Paused → xem giá → thanh toán/hủy → quay lại trang ban đầu | Bổ sung ở owner plugin settings/workspace; thông báo trong Settings dẫn thẳng tới hộp giá của plugin |
| Giá/thanh toán | Dùng cấu hình giá, thuế/phí hiện có; không đổi giá hay tự mua | Giữ nguyên; checkout cuối cùng hiển thị tổng tiền, subscription đến hạn mở billing hiện có |
| Xác nhận tiền | Không tin query success; chỉ server/provider xác nhận mới mở quyền | Giữ nguyên; polling có giới hạn, kiểm tra đúng salon, chống duplicate subscription |
| Hết hạn | Tài khoản Tax vẫn tồn tại; salon Paused chỉ giữ nhãn, không hiện dữ liệu tài chính | Có; renew khôi phục kết nối còn hợp lệ; không hồi sinh quyền đã bị thu hồi |
| Ownership | Tài liệu salon, receipts, trao đổi và lịch sử thuộc owner | Có; thay người làm thuế không bắt nhập lại dữ liệu |
| Quyền Tax | Chỉ thông tin owner cho phép, không xóa dữ liệu owner, không nút download/export | Có; không bổ sung cơ chế chặn chức năng tải của trình duyệt |
| Phiên bản | Sửa file bằng upload bản mới; bản cũ vào Archive, giữ tác giả/lịch sử | Có |
| Staff | Chỉ tài liệu dành cho mình; xem/tải Current và Archive, kể cả rời salon | Có; quyền cá nhân tồn tại độc lập với kết nối Tax và bản ghi salon bị owner bỏ |
| Sheet chính | Mỗi nhân viên một hàng, thao tác paystub ngay trong hàng, upload nhiều file | Có; kiểm tra kỳ lương và phiên bản trước khi hoàn tất upload |
| Số liệu | Reported wage/tip/bonus/total, salon withholding, actual check; cash chỉ theo quyền owner | Có; dùng snapshot payroll đã công bố, không tạo engine khai thuế mới |
| Giải thích | Giải thích giá trị và ví dụ cuối trang để tránh nhầm reported gross/check payout | Có |
| Filter | Lọc kỳ/tháng/năm, tìm nhân viên gọn, ngày tùy chọn thu gọn | Có |
| Status | Dùng cột paystub: cần tải / xem file; không thêm cột trạng thái trùng | Có; trạng thái workflow cũ trong model được giữ tương thích, không phục hồi UI thừa |
| Trao đổi | Tab trao đổi chung; bỏ conversation/version button trong từng nhân viên | Có |
| Tài liệu | Nhóm tài liệu nhân viên và tiệm, Current/Archive; receipts riêng | Có |
| Thay đổi cách tính | Chỉ trọn kỳ hiện tại hoặc từ đầu kỳ sau; thông báo thay đổi | Có; kiểm tra client/server/DB, Tax chỉ nhận số mới sau khi owner công bố lại payroll |
| Phone | Tối ưu owner và staff; không ép sheet Windows thành trải nghiệm Tax phone đầy đủ | Có; kiểm tra viewport Chromium, chưa xác nhận native iPhone/Safari |
| Tương lai | Team/mod cho người khai thuế, nghiệp vụ tính toán/chặn tải | Chưa làm theo phạm vi đã chốt; không cần để vận hành tài khoản cá nhân |

## Luồng gia hạn và các ảnh hưởng đã cân nhắc

- Owner trả tiền; Tax professional chỉ thấy Paused/Refresh. Owner vẫn xem lịch sử và tài liệu của mình khi hết gói.
- Hủy ở hộp giá đóng hộp, không đổi trang, không mua hoặc hủy subscription. Hủy tại hosted checkout trở về trang đã lưu.
- Giá mới lấy từ catalog hiện hành. Khi đã có checkout cũ, giữ snapshot/provider request/idempotency cũ để không tạo giao dịch thứ hai hoặc thay điều khoản đã đóng băng.
- Chỉ reservation Tax mới được lưu đường quay về thông qua RPC owner-checked và trigger INSERT. Plugin khác giữ đường thanh toán hiện tại.
- Đường quay về chỉ cho phép owner Tax settings/workspace, luôn gắn salon. Nếu đổi workspace, server kiểm tra và chuyển về đúng salon có quyền quản lý.
- Subscription hiện có chưa thanh toán mở billing của đúng payer. Legacy Tax billing dùng provider cũ và đường quay về mới, không chuyển số tiền hoặc subscription sang provider khác.
- Thanh toán hosted trên desktop tự tiếp tục về trang gốc. Native giữ payment bridge đang có và kiểm tra khi app foreground; chưa khẳng định nghiệm thu trên iPhone thật.
- Lời mời là capability do owner chủ động cấp, không phải chỉ biết salon active là thêm được. Bản này tạo/sao chép link để owner gửi; không tự gửi email/SMS.
- SQL nhận lời mời khóa credentials rồi invitation, kiểm tra bản ghi đã khóa để tránh race với đổi password/thu hồi. Không sửa ownership, payroll, storage hoặc các policy tài liệu cũ.
- Link đã nhận không phải công cụ thu hồi kết nối. Dùng Disconnect/đổi password để thu hồi tài khoản đã kết nối; Revoke unused invitation chỉ thu hồi lời mời chưa nhận.

## Tích hợp và mức chứng cứ

Source này phụ thuộc các task Tax personal workspace, period alignment, activation handoff; billing/card/trial migrations đang có, đặc biệt trial_ends_at và market_card_reserve_safari. Chỉ ghép delta đã đóng băng vào đúng production baseline, không deploy toàn bộ worktree.

Kiểm tra SQL dùng PGlite fixture, provider dùng mocks; ảnh là component/route Next thực tế với dữ liệu mẫu trong QA chỉ loopback/development. Không dùng token, phiên đăng nhập hoặc khoản tiền thật. Hosted auth/email/phone verification, Stripe webhook thật, Storage thật, Safari và thiết bị iOS vẫn cần nghiệm thu môi trường tích hợp.

Kết quả cuối: 81/81 tests đạt (gồm SQL, auth routing, billing/provider mocks, settings và browser interaction), scoped lint 20 file đạt, production build 241 trang đạt. Có 33 ảnh chụp mới và hai acceptance logs. Production-local với cả QA env/cookie vẫn không render dữ liệu QA; /tax/qa trả notFound trong stream PPR sau shell HTTP 200.
