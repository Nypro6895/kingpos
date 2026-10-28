# iPhone thật: sửa lỗi và đánh giá hiệu năng

Ngày kiểm tra: 27–28/10/2026. Thiết bị iPhone 12 Pro Max, điều khiển bằng XCTest qua USB từ Mac. Đây là kiểm tra trên thiết bị thật. Bản sửa dùng bản cài QA và preview có bảo vệ; chưa phát hành web công khai hoặc TestFlight. Migration `20261028003000` đã áp dụng vào DB bản nháp theo phê duyệt của chủ dự án.

## Phạm vi và cách đo

- Trước: bộ JS của build 54, backend control từ baseline đã xác minh. Sau: bộ JS giai đoạn đo QA build 61, backend preview đã sửa. Cùng iPhone, tài khoản Owner, Wi-Fi và DB.
- Dữ liệu so sánh: 2 nhân viên, 4 dịch vụ, 30 ticket đóng trong báo cáo tháng, 2 ticket đóng/$75 ngày 27/10. Các thử nghiệm booking bổ sung thực hiện sau lượt đo để tránh thay đổi mẫu.
- Thời gian HTTP đo ở native URLSession/Resource Timing. Thời gian biểu mẫu sẵn sàng đo từ sự kiện click trong DOM đến khi có trường nhập/nút của panel, hết trạng thái loading và qua hai animation frame. Không bao gồm quá trình khởi động app.
- Thời gian XCTest truyền lệnh, tìm phần tử và lấy accessibility tree được giữ riêng. Không gọi đó là page load. Không cộng các span backend chạy chồng lấp. Bỏ TTFB âm do Safari không cung cấp `responseStart`.
- Web comparator là trang web được host thật mở trong WKWebView trên chính iPhone, cùng backend và dữ liệu. Đây không phải phép so sánh Safari độc lập hay benchmark app SwiftUI thuần.
- Bypass riêng chỉ mở deployment protection của preview thuộc dự án; xác thực phiên, salon scope, permission và RLS của sản phẩm vẫn chạy. Mã instrumentation và cấu hình bí mật nằm ngoài source sản phẩm.

## Kết quả đo biểu mẫu

Median click → nội dung sẵn sàng, đã loại thời gian bộ điều khiển:

| Biểu mẫu, mở mới | App trước | App sau | Giảm | Web sau, cùng iPhone/backend |
|---|---:|---:|---:|---:|
| Thông tin tiệm | 6,233 s (n=3) | 2,480 s (n=5) | 60,2% | 2,635 s (n=4) |
| Dịch vụ, 4 dịch vụ/2 nhân viên | 6,029 s (n=2) | 2,458 s (n=5) | 59,2% | 2,612 s (n=4) |

Khoảng mẫu app sau: thông tin tiệm 2,424–3,077 s; dịch vụ 2,411–2,659 s. DTO native lần lượt 4.829/4.008 bytes, web nén khoảng 2.095/1.264 bytes. So sánh biểu mẫu thực hiện sau khi đã vào danh mục Settings, không gộp toàn bộ cold launch hay tải asset web vào số này. Chênh lệch app/web sau chỉ khoảng 0,15 s, quá nhỏ để kết luận lợi thế chắc chắn với mẫu ít, không xen kẽ/ngẫu nhiên và không kiểm soát thermal/network.

Quay lại thông tin tiệm trong cùng phiên app: 5/5 lần Back về đúng danh mục, 5/5 mở lại có nội dung; click → hai frame sẵn sàng 46/47/40/38/34 ms, median **40 ms**. Lần priming trước đó 2.688 ms được loại khỏi mẫu warm. Đây là lợi ích của giữ màn hình/dữ liệu đang có, không chứng minh dữ liệu mới được fetch trong 40 ms và không dùng để tính phần trăm giảm của mở mới.

Lượt baseline đo frame có một lệnh điều khiển timeout ở mẫu dịch vụ thứ ba; chỉ dùng hai mẫu hoàn tất. Lượt web có một lần lấy accessibility result timeout sau khi DOM đã báo sẵn sàng; bảng web dùng 4 mẫu DOM, còn số lượt có cả AX xác nhận là 4 thông tin tiệm/3 dịch vụ. Các lượt baseline 10/10 với mốc quan sát XCTest trước đó vẫn được giữ riêng, không trộn vào median DOM. Không công bố p95 từ số mẫu ít này.

**Kết luận:** giảm khoảng 60% là thực, nhưng mở biểu mẫu nhỏ còn khoảng 2,5 s vẫn chưa đạt yêu cầu trải nghiệm nhanh. App không có lợi thế lớn ở lần fetch đầu vì cùng nút thắt server. Mục tiêu dự án cho bước tối ưu tiếp theo nên là phản hồi UI ngay và dữ liệu biểu mẫu warm-network p50 dưới 1 s/p95 dưới 2 s; đây là tiêu chí đề xuất để kiểm chứng, không phải SLA đã đạt hay ngưỡng Apple cho tải mạng.

## Chi tiết thay đổi

1. Settings: named GET read thay cho Server Action ở những panel đủ điều kiện; dùng lại kết quả xác thực trong một read request. App có cache bộ nhớ theo scope, làm mới sau 15 giây, không lưu DTO Settings xuống disk. Roles, permissions và recovery giữ đường kiểm tra riêng. Mutation buộc refresh; đổi tài khoản/quyền phải thu hồi dữ liệu cũ.
2. Today: chạy các phần đọc độc lập song song, không dựng chi tiết hiển thị correction không dùng ở Today; giữ phép tính tiền/lock. HTTP lỗi kết thúc Loading, hiển thị dữ liệu tạm không có hoặc giữ số tiền xác minh trước đó.
3. Closing/history: đưa GET/POST vào native transport và đọc lịch sử qua endpoint xác thực, thay truy vấn browser anonymous.
4. Điều hướng: dùng một retained view cho họ Settings/Bookings để Back/query phản ánh đúng trạng thái; drawer dùng booking hiện hành; Help không render hai bản; lưu/khôi phục scroll theo họ trang.
5. Booking → POS: bổ sung cột description snapshot còn thiếu; chặn chuyển booking của salon ngoài quyền ngay trong RPC, kể cả nhánh trả ticket có sẵn; khóa booking và giữ tính idempotent.

Kiểm tra nối tiếp phát hiện thêm URL chi tiết cũ đứng sau URL đã đóng trong danh sách retained. `Set` theo URL không đưa một URL đã tồn tại lên cuối; khi rời trang, Map theo page family lại chọn query mở drawer cũ. Bản cuối lưu đúng URL gần nhất cho từng family và giới hạn 16 family; liên kết Open POS cũng đóng drawer trước khi điều hướng. Cả row edit dialog và detail drawer dùng booking mới từ server, thay vì chụp bằng useState lúc mount. Các sửa cuối này không đổi named GET/server Settings; số đo A/B ở trên lấy build QA 61, và bản cuối kiểm tra hồi quy riêng.

## Luồng booking đã chạy trên thiết bị

Tạo lịch mới cho hồ sơ QA không có phone/email, TEST QA Claude, 15 phút, $1, ngày 28/10 09:00. Pending → Confirmed, mở quản lý lại trong cùng phiên thấy Confirmed và nút chuyển POS bật. Chuyển thành ticket **T00031**, Open/Unpaid, booking reference `df14ee78-3ea5-4b06-8f3c-6f629e84e49f`; trang POS hiển thị booking snapshot, Quantity 1, Booked $1, Subtotal $1, duration 15 min. Drawer đổi sang Open POS ticket, không còn nút Create POS ticket. Kiểm thử idempotency/race bằng SQL fixture; không cố tạo trùng qua UI bằng cách sửa request.

Ticket QA để Open/Unpaid, không tạo thanh toán ngoài và không cộng vào doanh thu ticket đóng. Khi mới vào ngày 28/10, danh sách hiện cache cũ (0 booked) rồi cập nhật 1 booked sau fetch; đây là stale-while-refresh có độ trễ thực, chưa được gọi là dữ liệu live tức thì.

## Hồi quy trên iPhone

| Luồng | Trước | Sau sửa, bằng chứng thiết bị |
|---|---|---|
| Owner Book/Profile/Reports/Today, 5 vòng | Book 5/5, Profile 4/5, Reports 4/5 nội dung quan sát đầu; Today Sales Loading 5/5 | 20/20 có nội dung quan sát đầu, không Loading/error trong cây quan sát; Today $75/2 closed tickets |
| Settings Back/mở lại | Back tải lại chi tiết | 5/5 về danh mục và mở lại được; bản cuối bổ sung giữ URL mới nhất khi rời trang |
| Booking/POS | Drawer Pending cũ; RPC thiếu cột | Confirmed, tạo T00031 đúng snapshot/giá; mở POS và về Today không còn drawer (build QA 63) |
| Help | Hai bản VI/EN nối tiếp | Một heading VI; đổi English thành một heading EN |
| Market | Header ở tọa độ âm do kế thừa scroll More | Heading Market ở y=162, đầu nội dung hiển thị |
| Closing | Load failed/không xác minh hoặc lịch sử | Closing Inputs, Save → Saved, lịch sử hiện một thay đổi; Verification có 3 ticket/2 finalized/1 open excluded, tổng $75 |

Đã lưu closing với số hiện có 0/0/0, không sửa số tiền; hiển thị chênh -$75 là chênh lệch đã có, không tự cân sổ. Tháng vẫn gross $1.770/net $1.755/revenue $1.785/30 closed. Market preview báo checkout chưa khả dụng; preview thiếu một số cấu hình production, không kiểm tra mua plugin hoặc thanh toán ngoài trong lượt này. Không tuyên bố đã test lại mọi permutation, logout/login, mất mạng hoặc tải nhiều người đồng thời.

Owner → Staff → Personal → Owner đã thực hiện trên build cuối. Staff Today thấy Staff-Ny, $35 earnings/2 completed tickets; Personal Explore, Bookings và Beauty hiện đúng Nene, không còn bảng tiền Owner. Đã quay lại chờ tải xong My Pay và Analysis: có pay period, take-home pay, service sales, biểu đồ và top services; không ghi payroll/payment. Lượt chờ accessibility sau nhấn khoảng 5,2 s cho My Pay và 4,2 s cho Analysis, chưa có A/B DOM riêng để công bố phần trăm cải thiện hai trang này. Chuyển workspace vẫn nhiều giây (Staff: quan sát khoảng 5 s còn Switching workspace, quan sát 17 s đã có nội dung, bao gồm thời gian điều khiển); chưa có mốc DOM đủ chính xác để công bố mức cải thiện. Không dùng ca đổi role thành bằng chứng đã test logout/login hay thu hồi quyền từ một thiết bị khác.

## Chi tiết áp dụng DB

Migration được chạy trong transaction, xác nhận ledger có đúng một version, cột tồn tại, permission guard tồn tại và anonymous không có execute. Hash dữ liệu được bảo vệ trước/sau giữ nguyên: 33 tickets, 45 ticket items, 10 bookings, 13 booking lines, 9 daily closings. Kết quả này chứng minh migration giữ dữ liệu hiện có; kiểm thử tạo/chuyển booking trên iPhone được ghi riêng.

Kiểm thử DB cô lập đã chứng minh: mô tả/giá/số lượng được giữ, chuyển lại không tạo ticket trùng, lỗi rollback không để ticket mồ côi, tài khoản ngoài tiệm bị từ chối. Không thay kết luận kiểm thử iPhone bằng kết quả fixture.

Trace sau sửa có closing/history HTTP 200 (history khoảng 1,59–1,93 s; Save khoảng 4,14 s). Today financials có HTTP 200/304, không có 503 trên preview cuối trong log đã thu. Ở các mẫu cuối, riêng `financial_report` khoảng 0,39–0,62 s và cả request gồm auth/so sánh khoảng 2,30–2,75 s. HTTP 304 vẫn là server đã xác nhận nội dung không đổi, không phải đo tải body mới. Save và read history còn chậm, không được đánh đồng với chuyển tab có cache.

## Nhận định kiến trúc

Một điện thoại chỉ đăng nhập một người không thay thế kiểm tra server. Phiên có thể hết hạn, bị thu hồi, người dùng mất quyền hoặc đổi salon; API có thể được gọi ngoài app. Cần kiểm tra identity và quyền đúng dữ liệu ở server. Tuy nhiên, dựng lại toàn bộ workspace, danh sách vai trò/tài khoản và lặp cùng một validation nhiều lần cho biểu mẫu vài KB là chi phí có thể tránh.

Trace A/B còn chỉ ra đường cũ đọc Settings qua command được xử lý như mutation: ngoài preflight và command, nó kích hoạt lại `owner.bookings` (~23,8 KB) dù chỉ xem thông tin tiệm/dịch vụ. Mẫu cũ có 10 auth-provider calls/50 REST calls cho thông tin tiệm, 7/44 cho dịch vụ trong command; mẫu GET sau sửa còn 2/25, cùng 1 RPC. Số span có thể chạy song song nên không cộng thời lượng của chúng. 25 REST calls cho DTO 4–5 KB vẫn quá nhiều: giảm được việc lặp, nhưng phần dựng context còn nặng.

Hướng đang áp dụng: admission/UI cache có scope và giới hạn; request server kiểm tra đầy đủ nhưng dùng lại validation trong cùng request; dữ liệu chỉ chứa phần panel cần. Bước tiếp theo là gom selected-workspace authority và panel DTO qua DAL/RPC nhỏ, giảm lượt mạng nối tiếp, tránh bootstrap tài khoản cá nhân và hydrate toàn bộ workspace cho mỗi read. Không cache quyết định quyền vô thời hạn hay bỏ kiểm tra cho mutation.

App hiện đóng gói React trong WKWebView, không phải toàn bộ UI SwiftUI. Lợi thế là asset cục bộ và giữ trạng thái/cache, nhưng lần đầu đọc dữ liệu vẫn chịu cùng backend. Vì vậy không có cơ sở hứa app tự nhanh hơn web nếu request giống nhau. Biểu mẫu vài KB còn chờ nhiều giây là chưa đạt, dù có cải thiện.

Next.js phân biệt kiểm tra lạc quan để trình bày UI và kiểm tra an toàn gần nguồn dữ liệu; memoization tránh gọi lặp trong một render/request: [Authentication guide](https://nextjs.org/docs/app/guides/authentication).

## Khối lượng dữ liệu và giới hạn kết luận

Test PostgreSQL 17 cô lập dùng định nghĩa cột/index thật của tickets, giữ 30 dòng ngày hiện hành, tăng tổng lịch sử 30 → 3.000 → 30.000. Query có bộ lọc trả 30 dòng/7.255 bytes ở cả ba mức; median execution 5 mẫu lần lượt 0,071/0,063/0,067 ms trong điều kiện local warm. Payload đọc toàn bộ lịch sử tăng 7.255 → 725.662 → 7.256.638 bytes. Đây là minh họa query giới hạn tốt và payload không giới hạn; không phải tải đồng thời, không gồm auth/RLS/join/network và không chứng nhận sức chứa production.

Độ trễ hiện tại với dữ liệu nhỏ là bằng chứng chi phí cố định quá cao, chưa phải bằng chứng hệ thống chắc chắn sập khi có nhiều người. Cần benchmark concurrency riêng, đo p50/p95, số request/DB calls mỗi thao tác, pool saturation, query plan dưới RLS và tỷ lệ lỗi trước khi kết luận năng lực phục vụ.

## Bằng chứng

Raw evidence ngoài Git: `artifacts/iphone-performance-fixes-20261027/`; audit trước: `C:/Reylumi/output/iphone-real-audit-20261027/real-device-report.md`. Các log có cấu hình riêng tư/diagnostics không được đưa vào commit. Kết quả build/typecheck/lint, 26 regression tests và integration SQL/scale được lưu riêng với lượt đo thiết bị.

Bản cuối: **26/26 regression tests**, SQL/scale integration 1/1, TypeScript, scoped ESLint, production build 247 pages và native signed Debug build 63 đều qua. JS trong binary QA có SHA256 `b27543bf5a9c9d065d6b8845012965a09ee164dc1b7f1a41e19373f97706287f`, khớp source đóng gói; runtime buildId `eab4117db4d7a2c9bf07efe364cd7888ae9de7c10a4015abde301c0c81132e7b`. Lượt smoke cuối hai panel Settings đều sẵn sàng sau vòng đổi workspace. iPhone để lại Owner trên bản QA. Không dùng bản Debug làm cam kết tốc độ Release; không có so sánh mobile Safari riêng hoặc kiểm thử tải đồng thời trong kết quả này.
