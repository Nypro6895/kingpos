# Nghiệm thu Android QA và Settings — 11/11/2026

Đã tạo APK QA độc lập, cài cạnh app hiện tại trên Galaxy A16 và sửa các lỗi được
xác nhận trong quá trình thử. Đây là nguồn QA local, chưa phải bản phát hành
production hoặc gói phân phối cho khách.

## Nguồn và bản cài

- Worktree: `C:\Reylumi-worktrees\android-qa-settings-20261111`.
- Nhánh: `fix/android-qa-settings-20261111`; nền QA `8b2b267` bắt đầu từ nguồn
  tổng hợp `acb17696eabeb49fc03a680b2610d4b6d1dc92bc` ngày 06/11. Không suy ra
  nguồn này trùng production hiện tại.
- Android chọn lọc nền hardware/Back từ `e3924e1`; cấu hình QA mới được giữ riêng.
- Package `com.reylumi.android.qa`, tên **Reylumi QA**, icon cam QA,
  debug-signed và `testOnly`. App thường giữ package, dữ liệu và phiên riêng.
- APK: `artifacts/android-qa-settings-20261111/Reylumi-QA.apk`.
- SHA-256: `A8AAE1ABE08B4D98472CCBF031EE75C33F891D3D53E45F1CE9A45D22945EDF9B`.
- Cần giữ USB/ADB, Docker và app local hoạt động. Cài/mở lại bằng
  `qa/local/Open-AndroidQA.ps1 -Serial <serial>`.

## Lỗi đã xác nhận và sửa

1. **Settings báo cập nhật thất bại khi chuyển mục.** Điều hướng query nội bộ
   làm lifecycle khởi động refresh toàn trang; timeout của lần cũ có thể xuất
   hiện ở mục mới hoặc sau khi Activity đã ẩn. Settings nay giữ lifecycle theo
   trang, từng mục tự đọc dữ liệu; timer có generation và được hủy khi bỏ lần
   refresh. Vẫn kiểm tra quyền khi quay lại trang và giữ retry cho lỗi thật.
   Login & security/Delete account khởi tạo lại form khi ẩn; mục thông thường
   giữ bản nháp. Không gộp lỗi này với mọi trường hợp “Loading settings…” trước
   đây: trạng thái loading toàn trang chưa được tái hiện đủ để kết luận cùng RCA.
2. **Đọc badge gây vòng lặp invalidation.** Hai endpoint POST chỉ đọc
   `/api/membership/salon-badges` và `/api/app-local/read` bị coi là lệnh ghi.
   Đã phân loại đúng hai transport này. Lệnh ghi, server action revalidation và
   hint dữ liệu/quyền rõ ràng vẫn giữ cơ chế invalidation.
   Khi kiểm tra đặt lịch, đã xác nhận thêm request đọc ví thưởng trả 200 nhưng
   phát mutation giả, hủy request tải chi tiết lịch; Retry lặp lại cùng lỗi.
   GET chi tiết có xác thực trực tiếp vẫn trả 200 đúng lịch. Phân loại thao tác
   đọc trong endpoint có cả đọc/ghi phải do server quyết định; không miễn trừ
   nguyên endpoint. [Ma trận kiểm tra RPC](experience-read-operation-audit-20261111.md)
   ghi rõ cả thao tác mang tên load/read nhưng thực sự tạo membership/session.
   Đã thêm hint `none` do server trả sau xác thực/RPC thành công cho đúng 14
   cặp scope/op thuần đọc của Rewards/Gift; client giữ invalidation cho lệnh ghi,
   op chưa biết, hint data/scope và Server Action revalidation. Sau sửa, chi tiết
   tải được và hủy lịch bằng UI thành công; không đổi quyền hoặc nghiệp vụ tiền.
3. **Thanh toán Gift xong nhưng ví báo rỗng.** Nhánh receipt chỉ gọi status,
   bỏ qua tải ví. Nay hoàn tất status trước rồi tải ví; giữ receipt/bearer nếu
   ví cần đăng nhập hoặc lỗi. Chỉ hiện trạng thái rỗng khi tải ví thành công.
   Không đổi tiền, ownership, chuyển thẻ hoặc schema.

Đã sửa thêm cấu hình fixture QA: script ban đầu chỉ mở dịch vụ/staff/giờ làm,
chưa bật `booking_enabled` và `online_booking_visible` của salon thử. Đã bổ
sung vào `qa/local/configure.mjs` và xác nhận context public chuyển từ
`booking_disabled` sang `ready` trong đúng database có marker QA. Không bật
đặt cọc hoặc thay đổi cấu hình salon thật.

## Kiểm chứng

| Phạm vi | Kết quả và mức bằng chứng |
| --- | --- |
| Hồi quy Settings, passive POST, Gift, checkout, mixed API reads | 24/24 đạt; test hành vi trên component/observer/cache thật, có baseline lỗi trước sửa |
| Kiểu TypeScript và ESLint vùng thay đổi | Đạt |
| Native QA/debug unit | Mỗi variant 9/9 đạt |
| Native bridge, Back, WebSocket guard | 3/3 đạt |
| Android assemble QA/debug và lint | Build đạt; lint không lỗi, còn cảnh báo toolchain/icon có sẵn |
| Settings trên Chromium với app/backend QA thật | 7 mục đạt; 0 RSC khi đổi mục; 5 badge POST trả 200 nhưng 0 mutation event/context GET; không cảnh báo sau 16 giây |
| Gift trên Galaxy A16 trong APK QA | Từ giao diện mua → checkout local → chấp nhận → quay lại; database QA xác nhận paid và đã phát hành thẻ. Hủy checkout cũng quay lại được |
| Gift receipt và Settings trên Galaxy sau sửa | Receipt và 4 thẻ tải đúng; 7 mục Settings ở 384px, không tràn ngang/lỗi JS/cảnh báo sau 16 giây; 0 RSC do đổi mục |
| Đăng Forum qua giao diện Chromium QA | Owner tạo bài, nhập tiêu đề/nội dung/state, publish; tải lại vẫn thấy bài và tác giả QA |
| Campaign qua giao diện Chromium QA | Owner tạo quảng cáo ảnh mới và gửi duyệt; Reviewer duyệt bằng UI, cả Reviewer/Owner thấy Running. Đúng 300 đơn vị nội bộ = 360 credit hiển thị được giữ, không giữ/trừ trùng; wallet/ledger khớp, 12/12 kiểm tra chỉ đọc đạt |
| Đổi thưởng qua giao diện Chromium QA | Khách yêu cầu/đồng ý 100 điểm; Owner POS $50 − $5, Submit $45; khách thấy Paid và QR không còn hoạt động |
| Đặt/hủy lịch qua giao diện Chromium QA | Lượt mới Nov15 đi đủ wizard, response 200/accountLinked, chuyển tới My bookings với thông báo tạo thành công; lịch Nov14 tải chi tiết và hủy qua UI sau sửa |
| Hủy lịch trên Galaxy trong APK QA | Customer mở lịch Nov15, xem chi tiết, nhập lý do và xác nhận hủy; database chuyển cancelled, tải lại History vẫn Cancelled, không lỗi JS/tràn ngang |

Checkout QA là route local có kiểm tra môi trường, người mua/đơn, số tiền,
Origin và CSRF. Provider token chỉ nằm ở server. APK chặn mạng ngoài, chỉ cho
đúng app/backend local và hai đường WebSocket HMR/realtime; mapping checkout
chỉ nhận mẫu ID giả chính xác. Route không hoạt động trong production. Không
gọi Stripe, thu tiền thật hoặc gửi email thật.

Hai lỗi harness đã được khắc phục trước lượt nghiệm thu đạt: thiếu WebSocket
realtime trong allowlist QA và `Referrer-Policy:no-referrer` khiến form gửi
`Origin:null`. Chính sách hiện tại vẫn giữ kiểm tra Origin/CSRF.

Settings trên Galaxy không phát RSC do chuyển mục. Trong khoảng idle có 2
request mang `next-hmr-refresh:1`, khớp log Fast Refresh của server dev khi các
kiểm thử khác biên dịch route. Thử chặn URL bằng CDP không tắt socket HMR đã mở;
không coi lượt này là môi trường đã tắt HMR. Assertion phụ “mọi idle RSC bằng 0”
thất bại được giữ riêng, còn các kiểm tra UI/timer đều đạt. CDP block đã gỡ.

Ảnh Hours & booking trong lượt đầu được chụp sau 1,8 giây khi reader con còn
Loading; phép kiểm whole-body của harness không chứng minh reader đã tải xong.
Đã làm lại bằng kiểm tra loader đang hiển thị và các trường dữ liệu thực:
**7/7 reader trên Galaxy đạt**, thời gian chờ 0,8–8,6 giây trong môi trường dev,
ảnh chụp sau khi settle. Hours có đủ 7 ngày/giờ/timezone; Go online có tagline/
story; Payroll có pay cycle; mục cá nhân có form/toggles đúng. Lượt cuối có
1 RSC mang `next-hmr-refresh:1`, 0 RSC do thao tác chuyển mục; 16.005 giây idle
không RSC/cảnh báo/lỗi. Không dùng thời gian dev này làm benchmark production.

Bằng chứng chi tiết (ignored, không commit tài khoản/token):

- `artifacts/settings-refresh-runtime/{baseline-test.log,fixed-test.log,local-app-integration.json}`.
- `artifacts/experience-passive-posts/{baseline-test.log,fixed-test.log}`.
- `artifacts/android-qa-settings-20261111/{galaxy-gift-result.json,types-final.log,eslint-final.log}`.
- `artifacts/android-qa-settings-20261111/{galaxy-settings-final-acceptance.json,galaxy-settings-strict-attempt.json}`.
- `artifacts/android-qa-settings-20261111/galaxy-settings-settled-acceptance.json` và ảnh `galaxy-settings-settled-*` là bằng chứng reader hoàn chỉnh sau sửa harness.
- `artifacts/android-qa-settings-20261111/galaxy-booking-native-cancel.json` và ảnh Nov15 là bằng chứng hủy lịch bằng máy thật.
- `artifacts/android-qa-settings-20261111/customer-history-triage.json` và bằng chứng regression đọc/ghi API.
- `artifacts/business-ui-qa/results.json` và ảnh từng bước giao diện nghiệp vụ.
- `artifacts/business-ui-qa/campaign-credit-verification.json`: đúng một reserve -300, target giữ 300, wallet/reservation/ledger khớp; chỉ đọc dữ liệu.
- `artifacts/reward-ui-qa/{receipt.json,galaxy-receipt.json}`: một fixture visit/draft QA được tạo riêng, còn yêu cầu/đồng ý/POS Submit đều qua UI thật; 530 − 100 + 40 = 470 điểm.
- Báo cáo cấu hình, kiểm tra native và giới hạn: [Android native QA](android-native-qa-20261111.md).

## Các luồng nghiệp vụ và phần còn lại

Receipt QA trước đó `qa/local/RECEIPT.json` xác nhận 7 tình huống RPC/backend:
phân quyền outsider, đặt/hủy lịch, đăng Forum, Gift tại quầy ghi tiền giả,
đổi thưởng qua đồng ý của khách và quyết toán POS, gửi campaign/reserve credit,
duyệt campaign/view local. Đây là bằng chứng nghiệp vụ local; không phải mọi
luồng đã được bấm hết trên Galaxy trong lần này.

Còn cần nghiệm thu đầy đủ thao tác ghi trên máy thật theo vai Customer/Staff/Owner
cho tạo/đổi lịch, campaign và đăng bài, gồm lỗi mạng, từ chối quyền, thao tác lặp
và Back/khôi phục. Galaxy đã kiểm tra wizard dịch vụ/staff/thời gian, đọc topic
Forum và phiếu đổi thưởng Paid; không suy ra toàn bộ thao tác ghi trên Galaxy
từ các lượt Chromium. Một hydration warning ở Forum trong lượt dev đầu chưa
tái hiện lại sau fresh reload; giữ làm rủi ro cần kiểm tra trên candidate đã build.
Lần đầu wizard đặt lịch quay về Services sau submit cũng chưa tái hiện trong
lượt trace mới: lượt mới đi đúng trang xác nhận. Không tự gộp vào RCA đã sửa.
ADB từng ngắt sau khi lưu phiếu đổi thưởng; Windows vẫn nhận interface, lệnh
`adb reconnect offline` phục hồi được. Sau khi đưa app QA ra foreground, bấm
Try again của native overlay đã mở lại app; lượt Settings reader và hủy lịch
máy thật sau đó đều đạt. Thanh toán provider chính thức, 3DS/webhook retry/hoàn tiền,
máy in và yêu cầu ký/phân phối Play chưa được chứng minh bởi QA local.

Trước khi đóng gói bản phát hành cần ghép riêng các bản sửa dùng chung vào
đúng nguồn live/native mới nhất, build và nghiệm thu lại. Không đưa nguyên
nhánh QA hoặc credentials local lên production. Chưa publish web, upload Play,
thay signing ownership hay tạo iOS binary trong đợt này. Kênh `ios` trong journal
chỉ tương thích schema cũ của công cụ; công việc native ở đây là Android.
