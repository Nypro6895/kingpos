# Reylumi — Android và iPad, hồ sơ cửa hàng

Ngày chuẩn bị: 05/11/2026 America/Chicago. Phạm vi: tạo Android preview,
chuẩn bị kiểm thử iPad và hồ sơ App Store / Google Play. Chưa gửi duyệt,
chưa upload store, chưa deploy web và chưa thay đổi giá/thị trường.

## Nguồn và giới hạn bằng chứng

- Canonical checkout: `C:\Reylumi\kingpos`.
- Task branch: `codex/android-ipad-store-20261105`, worktree:
  `C:\Reylumi-worktrees\android-ipad-store-20261105`.
- Android là native WebView host dùng giao diện responsive/backend hiện có,
  không phải app offline hoặc viết lại toàn bộ UI. APK preview không phải AAB
  đã ký để phát hành. Xem `android/README.md` cho lệnh build và giới hạn.
- iPad đã có trong cấu hình canonical: `TARGETED_DEVICE_FAMILY: "1,2"`,
  bốn hướng màn hình iPad trong Info.plist. Không đổi bundle/team/version cũ.
  Không dùng iOS trong worktree HEAD này thay cho baseline binary đã upload;
  coordinator phải lấy đúng source native mới nhất thực sự đã upload.
- Workflow iPad mới chạy unit tests hiện có trên Simulator iPad. Nó chưa
  kiểm chứng UI, Split View, dữ liệu thật hay thiết bị vật lý.
- Tài liệu App Store cũ có dữ kiện lịch sử, không chứng minh trạng thái store
  hiện tại. Cần đọc lại App Store Connect và Play Console trước phát hành.

## Kết quả kiểm tra local

- Gradle wrapper 8.13 kiểm SHA-256; Java 17, Android SDK 36.
- `testDebugUnitTest lintDebug assembleDebug`: thành công; 2 unit tests,
  0 failures; lint 0 errors, 2 warnings (monochrome launcher icon còn thiếu và
  thư mục resource v26 rỗng cục bộ). Chưa coi đây là kiểm chứng thiết bị thật.
- `bundleRelease` khi không có khóa bị chặn đúng ở `verifyReleaseSigning`.
- `adb devices -l`: chưa có thiết bị Android kết nối trong lượt kiểm tra này.
- iPad Simulator workflow mới chưa được chạy. Chưa archive/ký/upload mới.
- APK debug và các log/hash được bàn giao ở `artifacts/mobile-store-handoff/`.

## Nội dung listing nháp

Tên app: **Reylumi**.

Short description Google Play (nháp, tiếng Anh):

> Discover salons, book beauty appointments, and manage your salon workspace.

Subtitle App Store (nháp): **Beauty bookings & salon tools**

Description (nháp; chỉ giữ chức năng đã qua QA trên binary được gửi):

> Discover beauty inspiration and explore salon profiles with Reylumi.
> Book appointments with participating salons and manage your bookings from
> your personal account. Salon owners and staff can access their authorized
> workspace to organize appointments and daily salon work.
>
> An internet connection is required. Available services and workspace tools
> depend on the salon and your account permissions.

Support URL: https://reylumi.com/support

Privacy URL: https://reylumi.com/privacy

Terms URL: https://reylumi.com/terms

Các URL này là đầu vào cần kiểm tra live và nội dung trước khi nộp; chưa được
xác nhận chỉ nhờ xuất hiện trong tài liệu. Không quảng cáo push, offline,
camera/GPS, máy in hay thanh toán Android khi chưa được kiểm chứng.

Review notes (nháp):

> Public discovery is available without an account. Review credentials are
> supplied separately through the store's secure review access fields. The
> sample account provides access to a demonstration salon with no real
> customer data. Please test personal bookings and the permitted salon
> workspace. Account deletion and user safety controls must be verified on
> the submitted build; include their exact navigation steps here after QA.

## Checklist App Store

1. Đọc lại đúng bản đang có trong App Store Connect, binary đã upload và
   source receipt. Giữ bundle `com.reylumi.ios`/team hiện có; chọn version/build
   hợp lệ theo dữ kiện live, không lấy số 1.0.0/1 trong project cũ làm chuẩn.
2. Ghép nguồn được phép theo release policy; chạy iPhone + iPad tests/archive,
   ký bằng kênh chủ app hiện có. Theo dõi riêng upload, Apple processing,
   TestFlight, submitted, approved và published.
3. Chụp UI thật của binary candidate: ít nhất bộ iPhone hợp lệ và iPad 13-inch
   theo thông số Apple. Không dùng ảnh mockup hoặc ảnh bản cũ để chứng minh
   UI mới. Giữ screenshot, thiết bị, OS và hash binary trong receipt.
4. Chuẩn bị privacy manifest/required-reason API audit, App Privacy, age rating,
   UGC/report/block, xóa tài khoản, export compliance, content rights và hợp
   đồng hiện hành theo dữ liệu thực, bao gồm website và nhà cung cấp.
5. Hoàn thiện copyright, review contact, tài khoản demo, giá tải app và thị
   trường theo quyết định chủ sở hữu. Không tự mở thêm thị trường hoặc khai
   “không thu thập dữ liệu”. Không lưu mật khẩu demo trong Git.
6. Đánh giá chức năng tối thiểu và thanh toán theo App Review Guidelines hiện
   hành. App dùng WebView không mặc nhiên được Apple chấp thuận.

## Checklist Google Play

1. Chủ app xác nhận tài khoản developer/pháp nhân, package đề xuất
   `com.reylumi.android`, chủ sở hữu upload key và Play App Signing. Không
   đăng ký package hoặc tạo khóa đại diện chủ sở hữu khi chưa xác nhận.
2. Target API 36 theo yêu cầu hiện tại; tạo AAB release có ký, kiểm tra
   versionCode duy nhất. APK debug chỉ để thử, không gửi như store release.
3. Hoàn thiện web/server nhận diện Android và rà mọi đường vào Market,
   subscription/checkout/provider return. Navigation filter native không chặn
   SPA/fetch; đây là blocker phát hành, không phải cơ chế compliance hoàn tất.
   Giữ nguyên quyền đã mua và logic tiền hiện có.
4. Điền Data safety theo dữ liệu thực của app/web/backend, ads declaration,
   content rating, target audience, app access và quyền riêng tư. Xác minh cả
   đường xóa tài khoản trong app lẫn URL web bên ngoài app cho yêu cầu xóa.
5. Icon store 512×512, feature graphic 1024×500 và ảnh chụp điện thoại thật
   từ candidate (tối thiểu hai ảnh). Nếu liệt kê tablet, bổ sung bộ tablet phù
   hợp. Không dùng icon launcher thay feature graphic hoặc giả ảnh UI.
6. Chạy internal testing, pre-launch report và thử thiết bị thật. Với tài
   khoản personal thuộc diện áp dụng, closed test cần ít nhất 12 tester liên
   tục 14 ngày trước khi xin production access. Không tự gửi lời mời tester.
7. Chỉ upload/chọn rollout sau khi QA, signing và khai báo hoàn tất.

## Kiểm thử cần ghi kết quả trên thiết bị

| Khu vực | Android phone | iPad |
| --- | --- | --- |
| Layout | 360/412dp, ngang/dọc, font lớn, system Back/IME | 768/820/1024px, ngang/dọc, Split View/Stage Manager |
| Session | login/logout/reset, đóng/mở, đổi tài khoản/quyền | tương tự; không lộ cache workspace cũ |
| Booking | khám phá → public salon → book → lịch sử/hủy | tương tự, form/dialog không tràn |
| Salon | owner/staff Today, POS/ticket, payroll/report | bảng cuộn riêng, footer/nút Save không che |
| Bàn phím | input/dialog, cuộn tới nút, Back đóng keyboard | keyboard mềm/cứng, focus, xoay khi nhập |
| Media | system picker/cancel; camera/QR còn chờ | ảnh/camera/QR theo bridge binary hiện tại |
| Network | offline/retry/HTTP lỗi, không mất draft | tương tự; resume sau background |
| Providers | auth return/payment: blocker chưa chấp nhận | browser return, trạng thái server-authoritative |
| Safety | report/block/delete, privacy/support links | tương tự; review account không chứa dữ liệu thật |
| Export | tải/in còn thiếu trên Android | PDF/CSV/share/AirPrint theo bản native hiện tại |

## Những thông tin cần chủ sở hữu chốt trước khi nộp

- Google Play developer account và package; quyền sở hữu/ký upload key.
- Tên pháp lý/copyright, người liên hệ review, thị trường và giá tải app.
- Xác nhận khai báo privacy/ads/age/content rights dựa trên vận hành thực tế.
- Tài khoản demo được cung cấp qua trường bảo mật của cửa hàng, không qua Git.

## Nguồn chính thức đã tra cứu

- https://developer.android.com/google/play/requirements/target-sdk
- https://developer.android.com/build/releases/agp-8-13-0-release-notes
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/13327111
- https://support.google.com/googleplay/android-developer/answer/9866151
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/

Release journal hiện chỉ chấp nhận `web`/`ios`; event task gắn `ios` cho bộ
chuẩn bị iPad, scope Android được ghi rõ ở đây và manifest handoff. Không dùng
event đó để tuyên bố Android đã phát hành và không đổi schema journal trong task.
