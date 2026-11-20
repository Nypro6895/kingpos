# Reylumi for iOS

Ứng dụng iPhone/iPad (iOS 16+) dùng SwiftUI và WKWebView, tải giao diện thật từ `https://reylumi.com`. Cùng backend, tài khoản, phân quyền, dữ liệu và giao diện responsive với web. Đây là app tích hợp web, không phải bản viết lại giao diện bằng Swift.

## Mở và chạy trên Mac

Nếu chỉ có Windows và iPhone, xem [hướng dẫn cloud build và TestFlight](TESTFLIGHT-SETUP.md). Workflow GitHub đã được chuẩn bị; cần đưa source lên GitHub và chạy workflow để xác nhận build thực tế.

1. Cài Xcode và XcodeGen (`brew install xcodegen`).
2. Trong thư mục `ios`, chạy `xcodegen generate` rồi mở `Reylumi.xcodeproj`.
3. Chọn target **Reylumi → Signing & Capabilities → Team** bằng tài khoản Apple của bạn; đổi Bundle Identifier nếu cần.
4. Chọn iPhone Simulator hoặc iPhone kết nối và bấm Run.
5. Chạy Product → Test để kiểm tra quy tắc điều hướng.

Máy Windows không có Xcode nên chưa biên dịch Swift, chạy Simulator hay tạo IPA. Mã Swift và project cần được xác nhận trên Mac trước khi phát hành.

## Phạm vi

- Guest/Explore/Market, đăng nhập/đăng ký, Beauty, đặt lịch, lịch sử, thông báo trong app, My Place, Settings và hỗ trợ dùng các trang hiện có.
- Owner/manager: booking, POS trên mobile, tickets, khách hàng, nhân viên, dịch vụ, payroll, reports, salon profile và salon settings theo quyền hiện có.
- Staff: Today/My Work, appointments, working hours, hồ sơ và các trang được cấp quyền.
- Admin nền tảng và back office quản trị bị loại; owner/manager salon vẫn hoạt động.
- Session dùng kho cookie WebKit bền vững; vuốt để quay lại, xử lý mất kết nối có nút thử lại, chia sẻ native, AirPrint và tải file qua WKDownload rồi mở bảng Save/Share.
- Trang trong app cố định tỷ lệ 1:1: không pinch zoom hay zoom khi chạm hai lần. `AppViewport.js` giữ viewport qua mỗi lần chuyển trang, nâng chữ trong ô nhập nhỏ lên tối thiểu 16px, giữ cửa sổ thao tác trong màn hình và cho phép cuộn nội dung dài. Bàn phím mở sẽ thu chiều cao WebView để các nút vẫn có thể tiếp cận. Thao tác bản đồ và các vùng cuộn riêng vẫn dùng sự kiện chạm của web.
- Chọn ảnh/camera dùng input file sẵn có của web. Vị trí chỉ được yêu cầu khi web gọi geolocation; không dùng API quyền vị trí beta.
- Trang đã được chuẩn bị đầy đủ có thể mở lại bằng service worker và kho WebKit bền vững. App chỉ nhớ đường dẫn đơn, không có query/token, sau ACK `reylumi:offline-ready` kèm thời hạn quyền offline tối đa 24 giờ. Giao diện web kiểm tra lại quyền trước khi hiện dữ liệu riêng; tín hiệu `screen-ready` của màn hình công khai không cấp quyền offline. Đăng xuất, khóa POS hoặc đổi quyền xóa gợi ý khởi động và dữ liệu đọc nền native; hàng đợi thao tác POS vẫn theo cơ chế hiện có.
- `BGAppRefresh` chỉ làm GET cho dữ liệu Today/My Work đã đăng ký từ phiên có quyền, kiểm tra lại scope hiện tại, tối đa 4 bản đọc/2 MiB và 20 giây mỗi đợt. Bản đọc được mã hóa bằng khóa Keychain chỉ trên thiết bị, không sao lưu, không lưu cookie/token. Khi trở lại app, web kiểm tra quyền mới trước khi nhận bản đọc nền. iOS quyết định có chạy nền hay không; đồng bộ khi mở lại/kết nối lại vẫn cần thiết. Không bổ sung APNs, thông báo xin quyền hoặc tự gửi lại giao dịch. Máy in chuyên dụng của bản Windows không trở thành máy in Bluetooth iOS.

Native app chặn đường dẫn admin và client routing; `proxy.ts` chặn thêm request có user-agent `ReylumiIOS/1.0`, Settings không tải các công cụ quản trị. Đây là giới hạn giao diện của app, không thay thế phân quyền Supabase/server.

**Cần deploy thay đổi web trong cùng đợt với app** để server và Settings nhận diện iOS. App tải bản web đã deploy, không tự mang theo các thay đổi Next.js chưa deploy. Đổi `ReylumiServerURL` trong Info.plist sang staging HTTPS nếu cần kiểm tra trước; không đưa secret vào app và không bật HTTP trong bản phát hành.

## Kiểm tra trước khi phát hành

Trên Simulator và iPhone thật, dùng tài khoản guest, personal, owner và staff để kiểm tra: đăng nhập/đăng xuất/khôi phục mật khẩu, chuyển workspace, booking, sửa/hủy booking, POS/tickets, payroll CSV (bao gồm blob download), reports, chụp/chọn/cắt ảnh, map và quyền vị trí, chia sẻ/in, safe area/bàn phím, mở link ngoài, reload/mất mạng, session sau khi đóng app. Tài khoản admin phải không thấy Messaging hoặc recovery back office và không vào `/admin` kể cả client routing.

Kiểm tra viewport trên iPhone màn hình nhỏ và khi xoay ngang: chạm các ô nhập email, tìm kiếm, số tiền; mở bàn phím trong dialog; thử pinch và chạm hai lần; cuộn tới nút cuối của form dài; chuyển qua lại Explore/đăng nhập/Settings/POS. Trang phải giữ tỷ lệ 1, không kéo ngang toàn trang; bảng hoặc danh sách có cuộn riêng vẫn phải xem và thao tác được. Bản sửa viewport được đóng gói trong app, cần build và cài bản iOS mới để áp dụng; không cần sửa viewport của Safari hay deploy web riêng cho thay đổi này.

Trên Mac:

```sh
xcodegen generate
xcodebuild -project Reylumi.xcodeproj -scheme Reylumi -destination 'platform=iOS Simulator,name=iPhone 17' test
```

Các kiểm tra `OfflineWebViewTests` dùng HTTP localhost chỉ trong cấu hình Debug: chuẩn bị HTML/JS POS và nháp IDB qua service worker, hủy WebView, cho máy chủ trả 503 rồi mở lại bằng WebView mới. Bản Release chỉ khai báo `reylumi.com` trong App Bound Domains và giữ HTTPS; localhost và ATS local networking không có trong cấu hình phát hành. `BackgroundSyncTests` dùng cookie/payload giả và transport GET nội bộ, không chạm tài khoản hay giao dịch thật. Kiểm tra bridge chạy được trên Windows bằng `node --test ios/scripts/native-offline-bridge.test.mjs`.

Dùng tên Simulator có sẵn trong Xcode. Sau khi kiểm tra, chọn Generic iOS Device → Product → Archive để tạo bản phân phối qua TestFlight/App Store; cần Apple Developer Team và cấu hình App Store Connect của chủ app. Chưa phát hành lên TestFlight/App Store từ workspace này. Cần hoàn thiện khai báo quyền riêng tư/App Privacy theo dữ liệu thực của web và kiểm tra App Review trước khi gửi duyệt.

Tài liệu API tải file: [Apple WKDownloadDelegate](https://developer.apple.com/documentation/webkit/wkdownloaddelegate).
