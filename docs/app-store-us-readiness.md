# Reylumi — chuẩn bị App Store Mỹ

Ngày kiểm tra: 14/10/2026 UTC. Phạm vi phát hành dự kiến: United States.

## Trạng thái

Ba ưu tiên đã được triển khai lên production: xóa tài khoản, chặn người dùng, thanh toán Market bằng trình duyệt ngoài trên iOS. Ba migration đã áp dụng thành công. TestFlight **1.0.1 (5.1)** đã được Apple xử lý `VALID`, trạng thái nội bộ `IN_BETA_TESTING`. Chưa gửi App Review.

Nguồn web được ghép từ đúng deployment phục vụ reylumi.com trước phát hành: `dpl_3drS7Mm42hrGGf4LdkPT8sYn1xRt`. Deployment mới **`dpl_DmN3YBZodqJsKGVdNkUouMTN97uP`** đã được promote sau khi xác minh alias gốc ngay trước promotion. Bản này gồm Booking Deposit, giữ nguyên 101 tệp Explore/location và 1700 tệp ngoài phạm vi. Nguồn candidate trên Vercel khớp toàn bộ 1732 tệp của manifest. Chi tiết và hash nằm trong `artifacts/app-store-us-20261013/release-receipt.json`.

Nhánh iOS: `codex/app-store-us-readiness`, commit đã upload `ffbcd24513cd991a8c7a883a53d6ac360f3ff137`. Bản này dựa trên mã iOS đã kiểm thử trước đó, chỉ thêm phần điều hướng thanh toán. [Xcode CI: 9 tests và archive thành công](https://github.com/Nypro6895/kingpos/actions/runs/38504521801). [TestFlight upload và xử lý thành công](https://github.com/Nypro6895/kingpos/actions/runs/38608983958). Các commit sau trên nhánh bổ sung công cụ hồ sơ/ảnh chụp, không thay đổi mã app đã upload.

Hồ sơ App Store Connect đã lưu phiên bản 1.0.1, chọn build 5.1, mô tả/keywords tiếng Anh, subtitle, URL hỗ trợ/marketing/quyền riêng tư và danh mục Lifestyle / Business. Đã đọc lại và xác nhận **chỉ USA bật trong 175 thị trường**, không tự bật các thị trường mới, không pre-order. Phát hành được đặt thủ công. [Kết quả chuẩn bị hồ sơ](https://github.com/Nypro6895/kingpos/actions/runs/38611472380).

Đã chụp, kiểm tra trực quan và upload **hai ảnh Explore thực tế**: iPhone 16 Pro (1206 × 2622) và iPad Pro 13-inch (2064 × 2752), JPEG RGB không alpha. UI test đóng popup qua nút “Close promotion” trước khi chụp; không thay nội dung trang. Hai lượt UI test đều qua và toàn bộ hash nguồn native khớp TestFlight 5.1. Apple trả `COMPLETE` cho cả hai ảnh. [Lượt chụp](https://github.com/Nypro6895/kingpos/actions/runs/38613742368), [upload và đọc lại hồ sơ](https://github.com/Nypro6895/kingpos/actions/runs/38616171409). Ảnh có nội dung công khai của King Nails Spa LLC; chủ app vẫn cần xác nhận quyền sử dụng nội dung trong metadata trước khi gửi review.

## Những gì thay đổi

| Hạng mục | Hành vi mới |
| --- | --- |
| Xóa tài khoản | Giữ quy trình yêu cầu/hủy trong 30 ngày. Sau thời hạn, loại bỏ nội dung cá nhân, ảnh và tệp cá nhân, rồi xóa danh tính đăng nhập. Chỉ báo hoàn tất sau khi xác minh cả lưu trữ và xác thực. |
| Theo dõi xóa | Có đường dẫn trạng thái riêng không yêu cầu đăng nhập; đường dẫn chỉ hiển thị trạng thái/ngày, không hiển thị danh tính và không thể thay đổi yêu cầu. Gửi email hoàn tất nếu dịch vụ email sẵn sàng. |
| Lỗi khi xóa | Xử lý theo hàng đợi, có khóa tác vụ và thử lại. Không báo thành công khi xóa tệp hoặc xác thực thất bại. Tác vụ có lỗi trả HTTP 503 để hệ thống giám sát phát hiện. |
| Hồ sơ doanh nghiệp | Giữ các hồ sơ giao dịch, lương, thuế và bằng chứng cần thiết theo chính sách. Tệp được giữ chuyển quyền sở hữu bằng Storage API, giữ nguyên đường dẫn/nội dung; không sửa trực tiếp metadata lưu trữ. |
| Chặn người dùng | Có trong menu bài viết, bình luận và phần trải nghiệm. Nội dung xã hội bị ẩn hai chiều khi đăng nhập; chặn tương tác bình luận/trả lời/theo dõi/lưu bài. Có danh sách bỏ chặn trong Settings. |
| Bỏ chặn | Nạp lại nội dung theo trạng thái máy chủ; không giữ nhầm danh sách bị chặn trong bộ nhớ lâu dài của trình duyệt và không tự theo dõi lại. |
| Market trên iOS | Checkout/portal Stripe mở trình duyệt ngoài qua bridge đã kiểm tra nguồn và tên miền. iOS mặc định mở Safari; nếu người dùng chọn trình duyệt mặc định khác, hệ điều hành sử dụng lựa chọn đó. Web giữ luồng thanh toán hiện có. |
| Trở lại app | Checkout chung có nút quay lại app. Booking Deposit giữ màn hình xác nhận trong app. Khi trở lại, app xác minh thanh toán trên máy chủ; đường dẫn quay về không tự cấp quyền sử dụng. |
| Stripe Connect | Mở Market trên website để đăng nhập và bắt đầu kết nối trong cùng một trình duyệt, tránh lỗi cookie OAuth giữa WKWebView và Safari. |

Chặn không thay thế báo cáo vi phạm/kiểm duyệt. Nội dung công khai vẫn có thể được xem khi đăng xuất. Quyền truy cập hồ sơ vận hành của salon không thay đổi theo danh sách chặn cá nhân.

## Bằng chứng kiểm tra

- Kiểm thử thực thi migration trong PostgreSQL cục bộ: quyền hạn, chặn hai chiều, bình luận/phân trang, trải nghiệm và phản hồi, hàng đợi xóa, lỗi/thử lại và điều kiện xác nhận hoàn tất.
- Kiểm thử hành vi giao diện và server action: iOS không tải thanh toán nhúng, đường dẫn Stripe được giới hạn, trạng thái thanh toán được xác minh, bỏ chặn làm mới đúng dữ liệu, Booking Deposit tiếp tục ở màn hình xác nhận trong app.
- Kiểm tra tương thích trên database thật bằng transaction có `ROLLBACK`; không lưu thay đổi schema hoặc xóa dữ liệu người dùng trong bước này.
- Kiểm tra Storage API thật với tài khoản và ảnh thử riêng: chuyển quyền sở hữu tại cùng đường dẫn, kiểm tra bytes không đổi, xóa danh tính xác thực khi tệp vẫn còn; đã dọn toàn bộ tài khoản/tệp thử.
- Sau migration, kiểm thử bằng hai tài khoản riêng trên hệ thống thật: chặn hai chiều, quyền riêng tư danh sách chặn, bỏ chặn, yêu cầu/hủy yêu cầu xóa, biên nhận mới, xóa profile cá nhân/ảnh Storage/danh tính Auth, xác nhận hoàn tất. Chỉ đẩy nhanh thời hạn của tài khoản thử mới tạo; không sửa hạn xóa của người dùng thật. Toàn bộ tài khoản, ảnh, profile và hàng đợi/biên nhận thử đã được dọn. Bằng chứng: `live-account-verification.json`, `live-test-cleanup-result.json`.
- Kiểm tra live sau promotion: Explore, Privacy, trang quay về từ thanh toán và biên nhận không hợp lệ hoạt động; cron từ chối truy cập không xác thực. Cron có xác thực trả 200 với 0 hoàn tất / 0 lỗi sau khi xác minh không có yêu cầu đến hạn hoặc hàng đợi. Không có email được gửi trong kiểm thử tài khoản thử.
- Web production build và log kiểm thử nằm trong `artifacts/app-store-us-20261013/`. Xcode Simulator và unsigned archive đã qua; chưa thay thế cho việc thử trên iPhone thật.
- Đợt kiểm thử cuối: **84/84 web/backend thành công**, không có bài bị bỏ qua; **9/9 iOS thành công**. Production build của bản đã ghép với Booking Deposit mới nhất thành công.

## Đã phát hành và việc cần thử trên thiết bị

1. Đã áp dụng riêng ba migration `202610140001_market_safari_checkout.sql`, `202610140002_user_blocking.sql`, `202610140003_account_erasure.sql` trong một transaction và ghi lịch sử migration. Không áp dụng migration khác.
2. Web đang chạy nguồn đã ghép tại `artifacts/app-store-us-20261013/release`. Lịch xóa 09:23 UTC hằng ngày dùng `CRON_SECRET`; route đã được kiểm tra. Cần theo dõi các lần chạy thực tế, lỗi 503 và hàng đợi còn lại. Không hứa xóa ngay khi một yêu cầu vừa được tạo.
3. Cài TestFlight **5.1** để thử bridge mới. Bản 4.1 cũ không có bridge này; portal/Connect sẽ yêu cầu cập nhật app.
4. Còn cần thử trên iPhone thật: mua/hủy/thoát thanh toán, xác thực ngân hàng nếu có, quay lại app, đổi salon, quản lý/hủy gia hạn, kết nối Stripe; chặn/bỏ chặn giữa hai tài khoản; yêu cầu/hủy xóa. Giao dịch thử phải ở môi trường Stripe thử nghiệm được cấu hình riêng; không dùng thẻ thử trên Stripe live.
5. Lần phát hành tiếp theo phải bắt đầu bằng việc đọc lại alias và nguồn deployment đang live tại thời điểm đó; không mặc định dùng lại baseline cũ hoặc checkout chung.

## Trước khi gửi App Review

- United States đã được chọn và xác minh. Cần rà chính sách thanh toán lại trước khi mở thêm thị trường.
- Khai App Privacy theo dữ liệu thực của cả web, backend và nhà cung cấp; xác nhận nội dung Privacy Policy/Terms, URL hỗ trợ, tuổi sử dụng và nội dung do người dùng tạo.
- Ảnh và mô tả đã được lưu trong hồ sơ nháp. Cần xác nhận quyền sử dụng hình ảnh và chuẩn bị tài khoản review hoạt động với dữ liệu mẫu phù hợp. Không ghi thông tin đăng nhập review vào repository.
- Ghi chú review đã soạn bên dưới; cần bổ sung tài khoản demo trước khi nhập phần Review Details. Ghi chú chưa được gửi cho Apple.
- Còn thiếu thông tin chủ sở hữu bản quyền và họ tên/email/số điện thoại người liên hệ review. Không tự điền thông tin cá nhân hoặc pháp nhân chưa được chủ app xác nhận. Cần tài khoản review có salon/dữ liệu mẫu và không phụ thuộc OTP của người dùng thật; giữ thông tin đăng nhập ngoài repository.
- App Privacy, bảng hỏi độ tuổi và tuyên bố quyền đối với nội dung chưa được xác nhận đầy đủ. Audit API đã xác nhận base territory USA nhưng không có giá manual hoặc automatic cho Mỹ; đang chờ quyết định giá tải app. Chính sách hiện tại có câu mô tả nhà cung cấp/analytics theo điều kiện và phần luật áp dụng chưa chốt; cần hoàn tất theo vận hành thực tế trước khi gửi.
- Kiểm tra giá trị sử dụng thực trên iPhone, độ ổn định khi mất mạng, đăng nhập, tải ảnh, bàn phím, tải/chia sẻ tệp và hỗ trợ tiếp cận. Các kiểm thử hiện tại không bảo đảm Apple chấp thuận tiêu chí chức năng tối thiểu của một app dùng WKWebView.

## Ghi chú review đã soạn

Dùng nội dung sau sau khi bổ sung tài khoản review có quyền salon và xác minh lại đường dẫn trên thiết bị. Không đưa mật khẩu vào tài liệu này.

> Reylumi provides public beauty discovery, salon profiles and booking, plus authenticated personal and salon workspaces. This release is available only in the United States. Public Explore content can be browsed without signing in. The review account supplied separately must have access to the sample salon workspace so the reviewer can inspect its features.
>
> Account deletion: sign in, open Settings, then “Delete personal account”. The app displays a 30-day cancellation period and a private status receipt. Requests can be cancelled during that period. After the deadline, the service deletes personal content and files and permanently removes the authentication account. Completion is shown only after storage and identity deletion succeed. Required business and financial records are retained as described in the Privacy Policy.
>
> User safety: open a post/comment action menu to report content or choose “Block user”. Confirm the block. Signed-in users cannot see each other's social content or interact through these social features. Open Settings → “Blocked users” to unblock. Public content can still be viewed when signed out. Salon operational records are not affected by personal blocking.
>
> Optional paid salon features are available in Market. On iOS, checkout and billing management open in the system browser. Stripe Connect starts on the Reylumi website to preserve browser authentication. Returning to the app refreshes server-verified purchase status; the return link does not itself unlock a feature. Prices and subscription terms are displayed before purchase.
>
> Help is available at https://reylumi.com/support, including a guest contact form. Privacy Policy: https://reylumi.com/privacy. Terms: https://reylumi.com/terms.

## Cơ sở chuẩn bị App Privacy

Đây là bảng đối chiếu mã nguồn của bản phát hành, **chưa phải khai báo đã xuất bản trên Apple**. Cần đối chiếu cấu hình nhà cung cấp và cách sử dụng dữ liệu thực tế trước khi xác nhận mục đích/“linked to you”/“tracking”. Dữ liệu gắn ID tài khoản không tự trở thành dữ liệu vô danh chỉ vì ID là UUID.

| Nhóm dữ liệu cần rà | Nguồn/chức năng hiện có | Mục đích cần đối chiếu |
| --- | --- | --- |
| Name, Email Address, Phone Number, Physical Address | Tài khoản, hồ sơ, salon, đặt lịch, hỗ trợ | App Functionality; thông tin tài khoản/đặt lịch có liên kết người dùng |
| User ID | Auth, quyền salon, hồ sơ, lịch sử đặt lịch | App Functionality; liên kết người dùng |
| Photos or Videos, Other User Content | Avatar, bài viết, bình luận, đánh giá, nội dung salon | App Functionality; liên kết tác giả khi đăng nhập |
| Customer Support | Yêu cầu hỗ trợ và hội thoại | App Functionality; có thể chứa email/ID người gửi |
| Purchases, Other Financial Info | Đơn Market, hóa đơn, POS, lương/thuế khi dùng | App Functionality; kiểm tra cả dữ liệu nghiệp vụ gắn người dùng |
| Payment Info | Stripe checkout/portal, cấu hình thanh toán và ngân hàng | Đối chiếu dữ liệu thực được app/backend nhận; không suy ra app lưu số thẻ chỉ từ việc dùng Stripe |
| Precise/Coarse Location | Tìm gần đây, địa chỉ salon, reverse-geocoding Census/MapTiler | Phân biệt GPS gửi máy chủ/nhà cung cấp với tọa độ chỉ xử lý trên thiết bị |
| Search History, Product Interaction | Tìm kiếm, lưu bài, theo dõi, lịch sử nghiệp vụ và quảng cáo Explore | Phân biệt local storage với thu thập máy chủ; kiểm tra cá nhân hóa và quảng cáo đang bật |
| Diagnostics, Other Data | Log auth/hosting, lỗi, chống lạm dụng và audit | App Functionality / Analytics tùy cách sử dụng và nhà cung cấp thực tế |

Nguồn có tích hợp Supabase, Vercel, Stripe, Resend, Census/MapTiler và chức năng quảng cáo Explore. Không chọn “Data Not Collected”, “No advertising” hoặc “No tracking” chỉ dựa trên việc app native không tích hợp SDK quảng cáo. Bảng hỏi độ tuổi cũng phải phản ánh nội dung người dùng tạo và khả năng tương tác; chưa xác nhận tần suất nội dung hay quyền sở hữu để tự nộp các tuyên bố này.

Nguồn chính sách để đối chiếu khi gửi: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Payments](https://developer.apple.com/app-store/review/guidelines/#payments), [Account deletion](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion), [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/), [Age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/), [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
