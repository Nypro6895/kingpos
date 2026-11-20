# Android QA local — 2026-11-11

## Phạm vi

APK riêng `com.reylumi.android.qa`, tên **Reylumi QA**, icon cam QA, debug-signed
và `testOnly`. Bản production vẫn giữ `com.reylumi.android`, HTTPS Reylumi và
không bật cleartext. Không tạo khóa ký release, không upload Play và không deploy.

Nền Android chọn lọc từ commit `e3924e173b1228dd7c484ff04bb8a50cbb770a7c`:
native Back tôn trọng pending/dirty, camera và vị trí khi dùng đã được chủ app
đồng ý, FileProvider/cache ảnh, share/print/save, khôi phục đường dẫn và offline.
Không lấy thay đổi web hoặc dữ liệu production từ worktree cũ.

## Kết nối và cách dùng

- App: `http://localhost:3117`; backend: `http://127.0.0.1:55421`.
- Script `qa/local/Open-AndroidQA.ps1 -Serial <serial>` kiểm tra QA identity và
  package APK rồi `adb reverse` hai cổng, cài/mở đúng package QA.
- Backend/database/email/nhà cung cấp dùng môi trường giả đã tách riêng.
- Quyền và phiên đăng nhập QA độc lập với app production; cần đăng nhập tài khoản
  giả. Không đưa mật khẩu hay token vào APK hoặc báo cáo.
- USB/ADB và server local phải còn hoạt động. Không dùng APK này độc lập cho khách.

## Giới hạn mạng

Manifest QA chỉ cho HTTP localhost/127.0.0.1, không cho subdomain. WebView và
service worker chỉ cho đúng hai origin/cổng trên; HTTP ngoài bị trả 403 cục bộ.
Các điều hướng ngoài, tel/mailto/intent và backend ở top-level đều bị chặn.
Native bridge/camera/vị trí chỉ tin app origin, không tin backend origin.
WebSocket trong document chỉ dùng `ws://localhost:3117/_next/webpack-hmr` cho
HMR và `ws://127.0.0.1:55421/realtime/v1/websocket` cho realtime backend QA.
Query xác thực của realtime được giữ trong kết nối, không ghi vào log/báo cáo.

URL checkout giả duy nhất có thể đổi thành trang local:
`https://checkout.stripe.com/qa/cs_test_qa_<32 lowercase hex>` →
`http://localhost:3117/qa/checkout/<id>`. Không query/fragment/userinfo/cổng khác.
Server local tự kiểm tra phiên/đơn hàng và dùng token provider ở server, không
gửi token cho điện thoại. Đây là giả lập, không gọi Stripe thật.

Đây là guard của ứng dụng, không phải firewall toàn máy. Kiểm thử thẻ thật,
3DS, webhook thật, hoàn tiền, printer và Play billing vẫn cần nghiệm thu riêng.

## Bằng chứng

- `testQaUnitTest` và `testDebugUnitTest`: mỗi variant 9/9 ca đạt, gồm kiểm tra
  origin/cổng, từ chối backend ở top-level, bỏ query/fragment khi resume, exact
  checkout mapping và phân biệt cấu hình QA/production.
- `node --test android/tests/qa-bridge.test.mjs`: 3/3 ca đạt. Back giữ dialog
  pending và bản nháp, đóng dialog trước More ở cả hai origin; WebSocket chỉ
  chấp nhận đúng đường dẫn HMR/realtime local; bridge không chạy ở origin ngoài.
- `lintQa`: 0 lỗi, 1 cảnh báo Gradle có bản mới. `lintDebug`: 0 lỗi, 2 cảnh báo
  có sẵn (Gradle và icon monochrome). Không nâng toolchain hoặc icon production.
- `assembleQa`, `assembleDebug`: đạt. Manifest sinh ra xác nhận chỉ QA có
  `testOnly`, icon QA, network security local và package `.qa`. Debug thường
  giữ `usesCleartextTraffic=false` và không có network config QA.
- Parser PowerShell và `git diff --check`: đạt. Launcher từ chối APK production
  trước khi kết nối/cài app; chỉ chấp nhận package `.qa`.
- Signing gate release từ chối khi thiếu `REYLUMI_ANDROID_KEYSTORE`. Không nạp
  khóa, không bỏ gate và không tạo bản release có ký.

APK: `android/app/build/outputs/apk/qa/app-qa.apk` (ignored build output).
SHA256: `A8AAE1ABE08B4D98472CCBF031EE75C33F891D3D53E45F1CE9A45D22945EDF9B`.
Build log: `artifacts/android-qa-build.log`.

APK đã cài/mở độc lập trên emulator API 36. Hai package thường/QA cùng tồn tại,
không thay cookie hay quyền của app thường. Native bridge, marker user-agent và
guard QA đã xuất hiện; fetch tới HTTPS ngoài và cổng provider 3118 bị trả 403
cục bộ. Đăng nhập tài khoản customer giả thành công.

Luồng native emulator đã đạt: Gift UI → URL provider giả được map vào checkout
local → bấm chấp nhận → quay lại Gift → database QA có order `paid` và `card_id`.
Giao diện trả về thông báo mở wallet. Ảnh checkout:
`artifacts/android-qa-emulator-checkout.png`; script bằng chứng riêng:
`artifacts/android-qa-gift-proof.mjs`.

Hai lỗi trong harness đã được xác định bằng trace và sửa trước lượt đạt:
guard WebSocket ban đầu thiếu endpoint realtime Supabase; form checkout dùng
`Referrer-Policy:no-referrer` tạo `Origin:null` và bị CSRF/Origin guard từ chối.
Guard hiện cho đúng realtime local; route checkout dùng `same-origin` để giữ
Origin đúng, tiếp tục kiểm tra Origin và CSRF. Không mở truy cập nhà cung cấp thật.

Phát hiện thêm: trang receipt đã báo có thẻ trong wallet nhưng danh sách “My
gift cards” vẫn hiện “No cards yet”. Khi bấm “My wallet” để bỏ query order,
3 thẻ QA active hiển thị đúng; ownership có hiệu lực. Nguyên nhân xác nhận từ
`customer-gift-cards.tsx`: nhánh có order chỉ tải status, bỏ qua `wallet(list)`
và vẫn vẽ trạng thái cards=[] rỗng. Đã bàn giao coordinator sửa/kiểm tra phần
UI chung; không sửa trong patch Android. Coordinator đã sửa nhánh paid-return,
giữ receipt khi ví lỗi và xác nhận fresh reload có 4 thẻ trên emulator/Galaxy.
APK cũng đã cài riêng trên Galaxy A16 và hoàn tất mua/hủy Gift qua checkout local.
Settings và phiếu đổi thưởng Paid trên máy thật được ghi trong
[báo cáo tổng hợp](android-qa-settings-20261111.md). Không suy ra nghiệm thu toàn
bộ thao tác máy thật từ unit test, emulator hoặc kiểm thử Chromium.
