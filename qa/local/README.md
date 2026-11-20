# Reylumi QA riêng trên máy này

Môi trường bắt đầu từ nguồn cố định `acb17696eabeb49fc03a680b2610d4b6d1dc92bc`
(bản tổng hợp ngày 06/11), không phải cam kết trùng source production hiện tại.
Nguồn QA đang hoạt động: `C:\Reylumi-worktrees\android-qa-settings-20261111`.
Nguồn này có các bản sửa Settings và APK Android QA chọn lọc của đợt 11/11;
worktree `qa-isolated-environment-20261111` là môi trường QA được thiết lập trước đó.
Không triển khai nhánh này lên production.
Đã áp dụng riêng bản sửa pending của Staff Requests từ đợt Android audit
(`e3924e1`); không lấy nguyên checkout đang có thay đổi dở.

## Mở và sử dụng

- App: <http://localhost:3117/login>.
- Hộp thư gửi giả: <http://127.0.0.1:3118/outbox>.
- Supabase Studio: <http://127.0.0.1:55423>.
- Mở trình duyệt QA riêng, tự đăng nhập Owner: chạy `Open-QA.ps1` trong thư mục này.
  Trình duyệt đó chặn request HTTP ra ngoài và mô phỏng checkout bằng dữ liệu local.
- Đổi vai: `Open-QA.ps1 -Role customer`, `staff`, `outsider` hoặc `reviewer`.
  Reviewer là quản trị viên giả, chỉ trong database QA, dùng thử duyệt campaign.
- Khởi động lại sau khi tắt máy: chạy `Start-QA.ps1`.
- Dừng: chạy `Stop-QA.ps1`. Database và file thử được giữ lại.
  Nếu dừng bằng Ctrl+C ở terminal đang chạy app, backend vẫn còn chạy.

Các script được chạy từ PowerShell; không cần gửi mật khẩu qua chat. Tài khoản
và mật khẩu ngẫu nhiên chỉ lưu tại `qa/runtime/access.json`, bị loại khỏi Git.
Không dùng tài khoản, thẻ, email hoặc số điện thoại thật trong môi trường này.

## Các tình huống đã sẵn sàng

Salon `QA ONLY — Reylumi Test Salon`, dịch vụ QA Manicure, giờ 08:00–20:00 hằng
ngày theo America/Chicago; có Owner, Staff, Customer, Outsider và Reviewer giả.

1. Đặt lịch/hủy lịch bằng tài khoản Customer; Owner/Staff xem lịch của salon thử.
2. POS và Gift tại quầy ghi nhận tiền giả; không xử lý tiền qua nhà cung cấp.
3. Đổi thưởng: yêu cầu của khách → báo giá POS → khách đồng ý → quyết toán.
4. Campaign: credit giả → gửi duyệt → Reviewer duyệt → ghi nhận view local.
   Campaign là quảng cáo trong feed; không phải tác vụ gửi SMS hàng loạt.
5. Đăng bài Forum và bài salon trong database local, không đăng lên website thật.
6. Mua Gift online: dùng **trình duyệt mở bằng Open-QA.ps1** hoặc **APK Reylumi QA**
   trên Galaxy/emulator. Checkout hiển thị `QA ONLY — no real money`; chọn chấp nhận
   thanh toán thử hoặc Cancel. APK tự chuyển đúng URL checkout giả được sinh trong
   QA sang trang HTTP local; không mở Stripe. Provider token chỉ nằm ở server.
   Đã thử từ giao diện mua Gift tới phát hành Gift trong database QA; mức bằng chứng
   trên từng thiết bị được ghi riêng trong báo cáo Android QA.
   Đây là mô phỏng provider, không phải kiểm chứng Stripe sandbox, webhook hay ngân hàng.
7. Email của app được bắt vào outbox local. Email Auth của Supabase ở Mailpit,
   <http://127.0.0.1:55424>. SMS/OTP từ nhà mạng chưa được mô phỏng đầy đủ.

`node qa/local/smoke.mjs` tạo dữ liệu thử và thực hiện các RPC nghiệp vụ thật
trong QA. Dữ liệu tích lũy, có thể gặp giới hạn campaign/giới hạn đăng bài khi
chạy lặp; không tự xóa lịch sử để làm test xanh. Dùng `--only=Reward` hoặc
`--only="Campaign review"` để tiếp tục phần cụ thể sau khi đã sửa fixture.
`node qa/local/verify.mjs` kiểm tra cô lập, outbox, Storage và các receipt nghiệp vụ.

## Android native QA trên Galaxy và emulator

APK **Reylumi QA**, icon cam QA, package `com.reylumi.android.qa`, đã có để cài/chạy
trên Galaxy A16 và emulator. Đây là bản debug-signed, `testOnly`, có phiên đăng nhập
và quyền riêng với app production. Không đóng gói mật khẩu hoặc provider token.

Sau khi khởi động backend/app local, chạy từ thư mục gốc của nguồn QA đang hoạt động:

```powershell
.\qa\local\Open-AndroidQA.ps1 -Serial '<ADB device serial>'
```

Launcher kiểm tra QA identity và package trước khi cài/mở APK, rồi chỉ ADB reverse
hai cổng 3117 và 55421. Cần giữ USB/ADB, Docker và server local hoạt động. APK ở
`android/app/build/outputs/apk/qa/app-qa.apk`; chưa phải bản release phân phối cho khách.

WebView chỉ nhận app `http://localhost:3117` và backend `http://127.0.0.1:55421`.
Checkout giả được ánh xạ vào `http://localhost:3117/qa/checkout/<id>`; các URL provider
khác vẫn bị chặn. Bản production vẫn dùng HTTPS Reylumi, không bật cleartext và
không đổi sang database thử.

`Open-EmulatorQA.ps1` vẫn mở **Chrome của emulator** để kiểm tra web. Dùng
`Open-AndroidQA.ps1` khi cần kiểm tra native Back, bàn phím, bridge, quyền thiết bị
và luồng checkout trong APK. Xem [báo cáo native QA](../../docs/android-native-qa-20261111.md)
để phân biệt kết quả unit test, emulator và máy thật; cài được APK không đồng nghĩa
toàn bộ luồng đã nghiệm thu trên từng thiết bị.

## Cô lập và khả năng chạy lại

- Project Docker `reylumi-qa-20261111`, database, Auth và Storage riêng.
- Tất cả cổng Docker được công bố ở loopback `127.0.0.1`; app/provider cũng chỉ
  lắng nghe loopback. Hai container MP3 đang có trước đó không bị tác động.
- Không link Supabase cloud, không sao chép dump hay credentials production.
- 402 migration được sinh vào `qa/runtime` đúng thứ tự từ source gốc, chuẩn hóa
  CRLF thành LF và cấp số phiên bản local duy nhất. Ánh xạ và SHA-256 ở
  `qa/runtime/migration-map.json`. Không sửa migration lịch sử.
- `serve.mjs` loại biến môi trường provider kế thừa; chỉ nạp khóa local và chuỗi
  giả. Background dispatch tự động bị tắt. Guard chuyển fetch với khóa giả sang
  provider local; host ngoài khác hoặc khóa không đúng bị chặn, không có fallback.
- Request vào API điều khiển provider phải có token local riêng. Trình duyệt QA
  có profile/cookie riêng, chặn service worker để route interception có hiệu lực.
- API nhận diện QA trả 404 trong production; không có đường đăng nhập tắt RLS.
- Khi chuyển cổng Docker sang loopback, container cũ được giữ **đã dừng** làm
  điểm phục hồi; không xóa volume. Không reset/clean source hoặc dữ liệu khác.

Local Supabase workflow tham khảo: [tài liệu Supabase](https://supabase.com/docs/guides/local-development/cli-workflows).

## Giới hạn còn lại

Chưa xác nhận Stripe thật/test mode chính thức, 3DS, webhook retry, hoàn tiền,
ngân hàng, thuế/phí thực tế, thiết bị in, GPS máy thật hoặc Play billing.
APK native QA đã có; nghiệm thu từng luồng trên Galaxy và emulator vẫn phải theo
bằng chứng riêng. Không dùng kết quả local làm bằng chứng toàn bộ app đã đạt
ngang iOS hoặc đã sẵn sàng phát hành.
