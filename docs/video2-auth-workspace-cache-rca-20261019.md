# Điều tra video 2 — Auth, workspace và cache

Ngày: 2026-10-19. Video do chủ project xác nhận quay trên TestFlight **1.0.0 (38)**. Nguồn sản phẩm đối chiếu: `1c2628c4df2069de0722874ce8972231945e7146`; baseline checkout `48b56d29a819a519c636253ba9e2ca2ddaf895bc` chỉ thêm hai receipt, không đổi sản phẩm. Không phát hành trong lượt điều tra này.

## Triệu chứng và luồng đã truy vết

- Khoảng 00:09–00:42: header Staff nhưng vẫn mở Today/điều hướng Owner, báo trang không còn khả dụng.
- Khoảng 00:57: chọn Owner từ Staff. Sau đó Today bắt đầu hiện rồi chuyển sang “Your workspace access must be checked again”.
- Khoảng 01:12–01:37: “Open Today” và chuyển trang không phục hồi ổn định.

Đã đọc luồng: khởi động native → cookie jar/transport → context + offline grant → admission React → shell/Today đọc song song → cache và sự kiện reset. Luồng chuyển vai trò: thao tác người dùng → command scope/origin → workspace membership/destination → ghi cookie → đọc lại home và quyền trang đích. Các thao tác nghiệp vụ, RLS, MFA, tiền và database không được thay đổi.

## Nguyên nhân có bằng chứng và cách sửa

| Vấn đề | Điều kiện tái hiện và bằng chứng | Sửa tại ranh giới phát sinh lỗi |
| --- | --- | --- |
| Cookie không cấp quyền bị hiểu thành đổi tài khoản | Hai read cùng khởi chạy; quảng cáo tạo/đổi cookie trước; read còn lại không có cùng Set-Cookie. Transport iOS thật trả 409 và reset toàn bộ. Chỉ gia hạn expiry với cùng giá trị không gây trường hợp này. RED CI `39207645489` build thành công, 121 test chạy, 6 test mới thất bại đúng assertion, 112 test cũ và 3 control vẫn đạt. | Transport và BackgroundSync dùng chung projection theo origin/domain; chỉ loại đúng 7 marker đã audit khỏi phép so sánh authority. Vẫn lưu/gửi tất cả cookie; Auth/MFA/workspace/admin/POS/anti-abuse và tên chưa biết vẫn fail closed. |
| HTTP 200 bị hiểu thành được phép mở trang dù grant trả 403 | Handler context thật gọi offline-context thật; selected Staff + đường dẫn Owner Today trả envelope HTTP 200 nhưng `grantStatus:403`. Entry cũ vẫn nhận nhờ thời gian online dưới 30 giây. UI regression bắt được trước sửa, gồm cả cached Owner đã hiện rồi nhận Staff denial trong nền. | Tách transport success và page admission. Từ chối 401/403/409/unconfirmed; kiểm tra đúng capability trang. Đọc fresh server home một lần và kiểm tra trang đích, không gửi lệnh đổi vai trò. Giữ fallback lease-service 503 cho đúng workspace và giữ Staff Post dùng chung `/salon-profile`. |
| Chuyển workspace thất bại được báo thành công | Handler GET dùng redirect cho cả thành công và lỗi. Adapter native nhận mọi redirect cùng origin là thành công; membership đã mất hoặc ghi cookie lỗi vẫn nhận `ok:true`. Regression handler lồng nhau: 5/6 thất bại trước sửa. | Dùng chung selection service với kết quả có cấu trúc. Native nhận đúng 403/503; web giữ redirect cũ. Giữ năm thao tác cookie, kiểm tra target/origin/destination và không replay lệnh khi không chắc kết quả. |
| Auth/context bị tải lặp trong cùng command | Đếm execution của các handler thực: command → shell → workspace GET gọi ba lần context đầy đủ trước ghi. Đây là số lần, không phải số giây latency đo trên điện thoại. | Chia sẻ một fresh prewrite context chỉ trong đúng command chuyển workspace: **3 → 1**. Postwrite destination admission vẫn đọc mới. Không dùng cache Auth toàn cục hoặc tái sử dụng context sau ghi. |
| Today giữ trạng thái bị chặn dù bấm mở lại | `blocked` được giữ trong Activity; anchor cùng đường dẫn không tạo admission mới hoặc component mới. Regression cùng đường dẫn bắt việc không có lần validate mới. | Native Open Today yêu cầu fresh validation, xoá đúng shell/năm phase của Today đang phục hồi và bản lưu tương ứng, rồi đọc shell mới và tải từng phần. Mạng lỗi/denial/lỗi xoá bản lưu giữ trang bị ẩn. Callback muộn sau rời trang không được phục hồi trang hoặc khoá nút thử lại. Các trang/draft khác được giữ. |
| Read cũ có thể ghi lại DTO sau khi vừa xoá cache | Regression native bổ sung giữ HTTP 200 → remove đúng key → cho response cũ hoàn tất → kiểm tra durable cache và retry timeout. Đối chiếu trước/sau CI được ghi trong verification.json. | Store actor cấp permit theo resource/scope trước read. Remove/revoke/đổi quyền vô hiệu permit; kiểm tra permit và ghi dữ liệu được thực hiện trong cùng actor turn. Cả 200, 304 và offline fallback đều có fence; giữ nguyên lỗi 403/404 và chính sách offline. Không đổi định dạng lưu trữ hoặc bridge. |

## Kiểm chứng

- 116 regression liên quan Auth/context/resource/Today/workspace: đạt.
- 40 UI case trên Chrome và 40 trên WebKit: đạt. Có tải chậm/lỗi từng phần, tải trùng giữa consumer, quay lại Activity giữ draft, đổi tài khoản/quyền, lost acknowledgment không gửi lại write, Staff ↔ Owner nhiều vòng, mismatch home và callback muộn.
- TypeScript toàn project, ESLint các nguồn thay đổi và production build: đạt. Bộ asset web tạo 430 tài nguyên, 8,475,745 byte, trong budget hiện hành.
- Bundle iOS đã build lại: 345 tài nguyên, 96 route, 322 command, không thiếu route; build ID `a33d8d1db1b70f540f25fd0bf9343ee424160fdc86acb676b5eddf9eb95e9645`. Hash từng tài nguyên được kiểm tra trước CI và trong app được Xcode copy.
- Native CI sau sửa [39209692361](https://github.com/Nypro6895/kingpos/actions/runs/39209692361): **126 test đạt, 0 lỗi, 0 bỏ qua**, archive kiểm tra không ký thành công. Đã đối chiếu đúng commit `9eebc09fb1fbf48ab4c99bef86a79dbad771053d`, 400 native Git blob, 25 file overlay, 345 tài nguyên bundle và ba bridge. Chưa có bản cài/phát hành mới.
- Bản app thực trong Simulator giữ nguyên DOM khi quay lại Today, không gọi lại Today trong lần quay lại còn fresh. Bản lưu mã hoá phục hồi sáu phase mà không gọi HTTP Today. Sau hơn 60 giây để yên và chạm thử, Today không có lượt đọc thêm/reset/reload; foreground làm 10 conditional read nhận 304, vẫn giữ DOM. HTTP ở đây là fixture kiểm soát, không phải đo latency Supabase thật hoặc iOS suspend/resume thật.
- Hai lượt review độc lập bắt và sửa thêm lỗi giữ nút recovery disabled khi rời trang, cùng lỗi vô tình chặn Staff Post. Review native permit không còn blocker.

Hai fixture Owner cũ dùng nhầm grant `customer` đã được sửa thành `owner` theo handler thật; các assertion hành vi được giữ và bổ sung các ca từ chối quyền.

Các test giữ logic component, cache, policy, handler hoặc transport thực ở lớp cần kiểm tra; Auth/DB/HTTP và cookie jar có dữ liệu kiểm soát. Chrome/WebKit và iOS Simulator không thay thế kiểm thử trên iPhone thật.

## Các file thay đổi

Nguồn web/JS:

- `app/(app)/workspace/open/route.ts`
- `app/api/app-local/command/route.ts`
- `app/local-app/entry.tsx`
- `app/local-app/scope.tsx`
- `app/staff/today/today-progressive-client.tsx`
- `lib/app-local-resource.ts`
- `lib/app-local-page-admission.ts`
- `lib/app-local-shell-server.ts`
- `lib/workspace-selection.ts`

Nguồn native:

- `ios/Reylumi/ReylumiCookieAuthority.swift`
- `ios/Reylumi/ReylumiLocalAppTransport.swift`
- `ios/Reylumi/ReylumiBackgroundSync.swift`
- `ios/Reylumi/ReylumiLocalReadStore.swift`

Kiểm thử:

- `ios/ReylumiTests/NativeCookieAuthorityTests.swift`
- `ios/ReylumiTests/LocalReadStoreTests.swift`
- `tests/app-local-page-admission-ui.test.mjs`
- `tests/app-local-scope-admission.test.mjs`
- `tests/workspace-selection-contract.test.mjs`
- `tests/app-local-entry-recovery-ui.test.mjs`
- `tests/app-local-workspace-recovery-ui.test.mjs`
- `tests/owner-today-progressive-ui.test.mjs`

Bundle sinh lại: `ios/Reylumi/LocalAppBundle/{app.js,app.css,manifest.json,brand/reylumi-admin-favicon.svg}`. Favicon được lấy từ asset web đã có. Báo cáo, verification và journal là tài liệu kiểm chứng; không đưa video, frame hoặc thông tin đăng nhập lên GitHub.

## Chưa thể kết luận

Chưa xác minh việc hết lỗi trên iPhone thật. Build 38 không bật trace release nên video không có request ID/cookie/reset reason để gán từng khung hình cho một nguyên nhân duy nhất. Những lỗi trên được tái hiện độc lập và phù hợp các triệu chứng; không đủ cơ sở nói mọi timeout trong video đều do cookie quảng cáo hoặc mọi độ trễ web đã được giải quyết.

Các điểm còn cần đo khi có request thực: refresh Auth giữa hai writer, chi phí context ở các HTTP request độc lập, lock của personal-account provisioning, latency Supabase/RLS và lần điều hướng web đầu tiên. Không tăng timeout, bỏ kiểm tra quyền hoặc sửa SQL theo suy đoán. Phải đối chiếu bản mới trên iPhone với khởi động nguội, Staff → Owner, để yên rồi chạm lại, mạng yếu/mất mạng/phục hồi và quay lại Today/Book trước khi đóng sự cố thực tế.

Nguồn sửa được giữ ở nhánh `codex/video2-root-cause-20261019`; không promote `reylumi.com`, không upload TestFlight hoặc phát hành App Store trong lượt này.
