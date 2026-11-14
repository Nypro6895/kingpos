# POS Portable trên iPad

Nguồn triển khai: `C:\Reylumi-worktrees\ipad-portable-app-20261113`, nhánh
`feat/ipad-portable-app-20261113`, dựa trên release source `ec2c292` (TestFlight 99).
Đây là thay đổi để tích hợp/phát hành sau; việc build QA không cập nhật website
hoặc binary đã cài trên iPad.

## Lưu từ Safari

- Trang Reylumi thông thường tiếp tục dùng manifest, tên và điểm mở Reylumi.
- Mọi trang thuộc `/pos/portable` có manifest riêng ngay trong HTML server:
  `id`, `start_url`, `scope` là `/pos/portable`; tên biểu tượng là **Reylumi POS**.
  Chỉ có một manifest trên mỗi trang, kể cả chuyển trang bằng client router.
- Nút hướng dẫn cài có ở màn hình nhập POS ID và thanh công cụ Portable.
  iPad dùng Safari → Chia sẻ → Thêm vào Màn hình chính → Mở dưới dạng ứng dụng
  nếu có. Trình duyệt desktop có hướng dẫn riêng; app native, Windows app và
  web app đã cài không hiện lời mời cài trùng.
- Biểu tượng Reylumi đã lưu trước đó giữ điểm mở cũ. Mở Portable rồi thêm
  **biểu tượng mới**; không tự đổi đích của biểu tượng cũ. Đăng nhập POS trong
  cửa sổ vừa cài, vì phiên Safari và cửa sổ đã cài có thể độc lập.

## Chế độ Portable trong app Reylumi

- Cài đặt POS và màn hình đăng nhập Portable có lựa chọn **Open POS when the
  app starts**. Lựa chọn chỉ áp dụng trên thiết bị, không đổi cài đặt của tiệm.
- Native nhớ một đường dẫn Portable được cấp quyền. Thiết bị chỉ có Check-in
  hoặc Book không bị ép khởi động vào bàn POS không được phép dùng.
- **Return to Reylumi** yêu cầu bản nháp ghi thành công trước khi chuyển màn
  hình; hàng đợi ticket vẫn được giữ. QR, Market return, account authority,
  thanh toán, AirPrint và luồng đăng nhập hiện có tiếp tục theo hợp đồng cũ.

## Lưu trữ và khôi phục

- Draft, Saved tickets, chỉnh sửa ticket đã đóng, bản nháp report, staff
  verifier và hàng đợi thao tác Portable dùng SQLite native, WAL,
  `synchronous=FULL`; dữ liệu được AES-GCM mã hóa với khóa Keychain riêng máy.
  Dữ liệu được ràng buộc với scope/key/operation ID để phát hiện tráo bản mã,
  bảo vệ file và loại khỏi sao lưu. Không lưu PIN nhân viên dạng rõ.
- Ghi draft đồng bộ chỉ trả thành công sau commit. Lỗi native không chuyển
  sang bộ nhớ JavaScript hoặc IndexedDB rồi báo thành công. Bản nháp chưa lưu
  không được gửi lên server trước khi ID thao tác được ghi bền vững.
- Receipt và checkpoint chống khôi phục lại cart đã nộp cùng một transaction.
  Thứ tự và ID thao tác ổn định qua retry, đóng/mở app và mất mạng. Chỉ outbox
  hiện có gửi thao tác nghiệp vụ; bridge không tự replay request thanh toán.
- Dữ liệu WebKit cũ được sao chép khi nâng cấp, giữ nguyên ID/payload/trạng
  thái, thứ tự và checkpoint lịch sử. Không xóa bản gốc trong lúc migration.
- Editor chỉ được mở sau khi native xác nhận lease/scope và migration hoàn
  tất. Khóa, hết hạn hoặc đổi quyền che/inert editor; ticket đã lưu không bị
  xóa. Quyền POS khác không được đọc hoặc sửa namespace của POS trước.
- Giao diện lấy từ bundle được ký trong app. App chuẩn bị các panel GET được
  phép và staff verifier; chỉ báo sẵn sàng offline khi các phần cần thiết đã
  thực sự có. Không tải hoặc cache API mutation để giả lập thành công.

## Giới hạn quyền offline

Lease đọc dữ liệu riêng của app hiện có tối đa **24 giờ**. Thay đổi này giữ
nguyên giới hạn và hiển thị thời điểm cần kết nối lại. Ticket/hàng đợi native
không tự xóa khi lease hết hạn; cần kết nối lại để xác nhận quyền rồi tiếp tục.
Đây là khác biệt có chủ đích với cơ chế Windows không giới hạn tuổi shell,
không phải cam kết iPad hoạt động vô hạn không mạng.

Máy in chuyên dụng Windows, màn hình phụ và thiết bị thanh toán cần tích hợp
theo phần cứng iPad riêng. Không suy ra khả năng dùng máy thật từ Chromium.

## Kiểm tra

- PWA: 8 ca hành vi và HTML thật của Next đạt; iPad dọc/ngang, desktop,
  installed/native suppression, prompt accept/dismiss/failure, metadata đầu
  tiên của Portable/Ticket/Explore. Không lỗi trang/overflow trên ảnh login.
- Web native integration: kiểm tra SQLite bridge giả lập lỗi, bảo toàn ID,
  IndexedDB thật, checkpoint lịch sử, không mount editor trước admission,
  che editor khi khóa/reset/hết hạn và giữ state đang nhập.
- Swift: unit tests cho vault, rollback, mã hóa/row substitution, scope,
  idempotency, chuyển trạng thái; test WKWebView thật chuẩn bị dữ liệu, hủy
  WebView, mở lại offline và khóa rõ ràng.
- Workflow QA dùng commit chính xác, iPad Simulator và archive không ký;
  không upload TestFlight, không đổi tester, không deploy web. Kết quả và
  artifact được ghi tại `artifacts/ipad-portable-app-20261113/`.

Trước khi công bố sẵn sàng sử dụng tại tiệm: tích hợp đúng production/native
baseline hiện hành, build/upload kênh được cho phép và nghiệm thu iPad thật:
cài từ Safari, đăng nhập POS, tạo draft/Saved ticket bằng dữ liệu QA, force-quit,
mở offline, kết nối lại đồng bộ đúng một lần, khóa/đổi POS, xoay màn hình, bàn
phím, in và thiết bị phụ được dùng thực tế. Không thử giao dịch thật trong QA.
