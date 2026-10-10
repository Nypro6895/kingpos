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
- Chọn ảnh/camera dùng input file sẵn có của web. Vị trí chỉ được yêu cầu khi web gọi geolocation; không dùng API quyền vị trí beta.
- Không bổ sung APNs/push nền hay chế độ offline mới. Các tính năng phụ thuộc internet và giới hạn thiết bị của web vẫn áp dụng. Máy in chuyên dụng của bản Windows không trở thành máy in Bluetooth iOS.

Native app chặn đường dẫn admin và client routing; `proxy.ts` chặn thêm request có user-agent `ReylumiIOS/1.0`, Settings không tải các công cụ quản trị. Đây là giới hạn giao diện của app, không thay thế phân quyền Supabase/server.

**Cần deploy thay đổi web trong cùng đợt với app** để server và Settings nhận diện iOS. App tải bản web đã deploy, không tự mang theo các thay đổi Next.js chưa deploy. Đổi `ReylumiServerURL` trong Info.plist sang staging HTTPS nếu cần kiểm tra trước; không đưa secret vào app và không bật HTTP trong bản phát hành.

## Kiểm tra trước khi phát hành

Trên Simulator và iPhone thật, dùng tài khoản guest, personal, owner và staff để kiểm tra: đăng nhập/đăng xuất/khôi phục mật khẩu, chuyển workspace, booking, sửa/hủy booking, POS/tickets, payroll CSV (bao gồm blob download), reports, chụp/chọn/cắt ảnh, map và quyền vị trí, chia sẻ/in, safe area/bàn phím, mở link ngoài, reload/mất mạng, session sau khi đóng app. Tài khoản admin phải không thấy Messaging hoặc recovery back office và không vào `/admin` kể cả client routing.

Trên Mac:

```sh
xcodegen generate
xcodebuild -project Reylumi.xcodeproj -scheme Reylumi -destination 'platform=iOS Simulator,name=iPhone 17' test
```

Dùng tên Simulator có sẵn trong Xcode. Sau khi kiểm tra, chọn Generic iOS Device → Product → Archive để tạo bản phân phối qua TestFlight/App Store; cần Apple Developer Team và cấu hình App Store Connect của chủ app. Chưa phát hành lên TestFlight/App Store từ workspace này. Cần hoàn thiện khai báo quyền riêng tư/App Privacy theo dữ liệu thực của web và kiểm tra App Review trước khi gửi duyệt.

Tài liệu API tải file: [Apple WKDownloadDelegate](https://developer.apple.com/documentation/webkit/wkdownloaddelegate).
