# Đo tải đầu trên iPhone thật: DAL/RPC và workspace — 27/10/2026

**Chưa nghiệm thu mục tiêu dưới 1 giây cho toàn bộ app.** Các thay đổi đã giảm thời gian lấy dữ liệu mới; khởi động lạnh và đổi workspace vẫn cần tối ưu tiếp. Không dùng tốc độ mở lại có cache làm kết quả.

## Kết quả đo

| Luồng | Trước, trung vị | Sau, trung vị | Giảm thời gian | Khoảng sau | Sau dưới 1 s |
|---|---:|---:|---:|---:|---:|
| Hồ sơ tiệm và giờ mở cửa | 2.589 s (n=3) | 0.991 s (n=3) | 61.7% | 0.942–1.011 s | 2/3 |
| Dịch vụ: 4 dịch vụ, 2 nhân viên | 2.573 s (n=3) | 0.794 s (n=3) | 69.1% | 0.757–0.894 s | 3/3 |
| Owner → Staff, có dữ liệu My Work | 10.950 s (n=3) | 2.998 s (n=3) | 72.6% | 2.928–3.027 s | 0/3 |
| Owner → Personal, có nội dung feed | 8.101 s (n=3) | 3.845 s (n=3) | 52.5% | 3.828–4.433 s | 0/3 |
| Khởi động lạnh Owner → Sales Today | 10.896 s (n=6) | 2.095 s (n=6) | 80.8% | 1.958–3.011 s | 0/6 |

Mẫu nhỏ: báo toàn bộ mẫu và min/max, không suy ra p95 hoặc năng lực tải đồng thời. Thời gian khởi động Owner tính từ tài liệu JS bắt đầu đến số doanh thu và số ticket sẵn sàng; chưa bao gồm thời gian OS mở tiến trình. Tổng thời gian từ chạm biểu tượng app sẽ không thấp hơn số này.

- Hồ sơ tiệm và giờ mở cửa: trước [2807, 2583, 2589] ms; sau [991, 1011, 942] ms.
- Dịch vụ: 4 dịch vụ, 2 nhân viên: trước [2573, 3634, 2209] ms; sau [794, 757, 894] ms.
- Owner → Staff, có dữ liệu My Work: trước [13247, 9762, 10950] ms; sau [2928, 2998, 3027] ms.
- Owner → Personal, có nội dung feed: trước [8100, 8165, 8101] ms; sau [4433, 3845, 3828] ms.
- Khởi động lạnh Owner → Sales Today: trước [11872, 10474, 10745, 10346, 11151, 11046] ms; sau [2071, 1958, 2720, 2081, 3011, 2108] ms.

Số lượt khởi động Owner không đạt điều kiện chuẩn bị ở bản cuối: **0**. Chi tiết từng lượt ở JSON và artifact; không gộp lượt sai workspace vào nhóm Owner → Personal.

## Phương pháp và dữ liệu

- iPhone 12 Pro Max thật, iOS 27, điều khiển bằng XCTest qua Mac/USB. Cùng cấu hình QA Debug và cách gắn đồng hồ cho trước/sau; không dùng simulator hoặc thời gian thao tác công cụ làm thời gian tải.
- Mỗi mẫu tạo tiến trình app mới, xóa riêng file snapshot đọc đã mã hóa; giữ đăng nhập. Không xóa giao dịch, outbox hoặc cookie phiên. Đo lần ghé đầu tới trang đích trong tiến trình đó.
- Settings: từ chạm mở panel đến form hoặc danh sách có nội dung, thêm hai frame. Today: Sales Today có số và số ticket đã đóng. Staff: Ticket earnings và completed tickets. Personal: feed có card nội dung; không chờ toàn bộ ảnh ngoài viewport giải mã.
- Kiểm tra HTTP 200 của dữ liệu mới. Các lượt trở lại Owner đã có dữ liệu không tính vào điểm cải thiện. Bộ nhớ đệm ảnh/CDN, tài nguyên cài sẵn và cache nội bộ DB/server không bị cưỡng bức xóa; đây là cold read phía thiết bị, không phải mô phỏng máy chủ mới khởi động mỗi lần.
- Dữ liệu hiện tại nhỏ: 4 dịch vụ, 2 nhân viên, 34 ticket/46 dòng, 11 booking/14 dòng, 9 closing. Today có 2 ticket đã đóng, doanh thu $75. Hồ sơ trả 4.829 byte, dịch vụ 4.008 byte; phản hồi Today đầy đủ khoảng 7.882 byte.

## Đã sửa và tối ưu

1. Context DAL lấy membership/account/role/salon/staff/grants bằng một RPC self-scoped. RPC là stable, security invoker, không nhận user/tenant do caller tự chọn; RLS giữ nguyên. Các truy vấn được lên kế hoạch riêng bên trong cùng snapshot SQL, tránh kế hoạch SQL lớn nhiều tầng RLS.
2. Mỗi request chỉ xác minh Auth, public profile và login session một lần cho cùng authority; quyết định từ chối nghiêm ngặt vẫn thuộc từng caller. Mỗi final revocation probe có map mới riêng, không dùng lại dữ liệu trước đó hoặc từ probe khác.
3. Settings dùng permission của đúng membership/tiệm vừa xác minh trong request đọc. Lệnh ghi và final probe tiếp tục nạp quyền mới. Tài khoản mới vẫn dùng provisioning cũ; tài khoản đã có không gọi ensure-personal-account khi chỉ đọc.
4. Hàng đợi không tải trang khác khi trang hiện tại còn đang đọc. Bấm đổi workspace hủy tải nền cũ trước preflight; queue mới chỉ thuộc context đã được chấp nhận tiếp theo.
5. Staff dùng lại staffId trong bằng chứng online vừa được server xác minh, đúng viewer/tiệm/scope và hạn 30 giây. Không biến bằng chứng đó thành quyền offline; Workday giữ resolver riêng. API dữ liệu vẫn kiểm tra người dùng/quyền hiện tại.
6. Today lần đầu lấy một phản hồi đầy đủ thay cho shell cộng năm request phần con. Các phần con dùng projection của chính phản hồi mới đó; sau đó chỉ các reader phần con sở hữu refresh. Khi upstream làm full read thất bại, app quay lại luồng độc lập từng phần; retry tài chính và thu hồi quyền đã được test.
7. Sửa lưu lựa chọn workspace qua restart như phần lỗi phía dưới, với preference gắn phiên và không chứa credential.
8. Đặt backend thử nghiệm tại pdx1, cùng vùng AWS us-west-2 với DB Oregon. Bản đối chứng dùng iad1. Vị trí được xác minh qua Supabase Settings và API deployment Vercel; không suy ra từ IP. [Vercel hướng dẫn đặt function gần nguồn dữ liệu](https://vercel.com/docs/functions/configuring-functions/region), [bảng vùng pdx1/us-west-2](https://vercel.com/docs/regions).

Ví dụ cùng payload hồ sơ 4.829 byte: backend REST giảm **25 → 8**, Auth **2 → 1**, RPC **1 → 1**. Tổng lượt phụ trợ 28 → 10, giảm 64,3%; riêng REST giảm 68%. Context thông thường giảm từ 15 REST xuống 2 REST cộng một RPC đọc. Đây là giảm công việc cho mỗi cold request, không phải giấu thời gian bằng cache lần trước.

Bản trung gian còn ở iad1: hồ sơ 1.424 s, dịch vụ 1.229 s, Staff 5.580 s, Personal 4.830 s, cold Owner 6.029 s. Bản pdx1 trước gộp Today: cold Owner 4.415 s. Những bước này giúp phân biệt tác dụng của DAL, vị trí backend và gộp phản hồi; không lấy số tốt nhất trộn giữa các build.

## Nhận định nghiêm về mục tiêu

Với 4–8 KB DTO và dữ liệu nhỏ hiện tại, nhiều giây chờ chủ yếu là chuỗi công việc và lượt mạng, chưa có bằng chứng do băng thông payload. Native đã có UI/JS cài sẵn nhưng vẫn chờ chuỗi online đó; lợi thế app chưa được dùng đủ ở khởi động và handoff workspace.

Không thể lấy lần web 2,6 s ở pha kiểm tra trước làm đối chứng công bằng cho backend pdx1 mới. Lượt này chưa đo lại website với cùng nguồn mới và cùng trạng thái cache; không tuyên bố native thắng web từ số liệu cũ.

Điện thoại chỉ có một hoặc hai tài khoản không loại bỏ việc admin đổi quyền, tài khoản bị khóa hoặc phiên bị thu hồi từ xa. Cần giữ xác thực hiện tại, membership/tenant, RLS và kiểm tra lệnh ghi. Phần nên bỏ là kiểm tra trùng trong cùng request và nhiều chuyến mạng nối tiếp để lấy cùng facts.

Phần còn lớn nhất là handoff: preflight trung tính → POST chọn workspace → context đích → dữ liệu trang, cùng các lượt tách dữ liệu Explore. Bước tiếp theo cần thiết kế một ranh giới server cho selection + admission + dữ liệu đầu có scope nhất quán, giữ kiểm tra Auth/membership và xử lý cookie commit không rõ kết quả. Không rút bớt kiểm tra chỉ để đạt con số; đây chưa phải phần đã triển khai trong patch này.

Chưa chạy kiểm thử tải đồng thời lớn; giảm lượt gọi không chứng minh hệ thống chịu được số người dùng bất kỳ.

## Lỗi và giới hạn được giữ lại trong đánh giá

- Một lượt build 73 khởi động lại vào Staff sau khi trước đó đã chọn Owner. Log ở build 75 xác nhận cookie gửi lên đã trở về Staff dù request/UI trước tắt app là Owner. Đã sửa bằng preference file ghi atomic, chỉ có lựa chọn và digest gắn cùng auth subject/login session, không lưu access/refresh token. Lần mở mới khôi phục cookie lựa chọn Secure/HttpOnly trước HTTPS; server vẫn xác minh người dùng, membership và quyền. Đổi tài khoản/phiên, logout, denial/reset hoặc root fallback sẽ không dùng lại lựa chọn cũ. 8/8 vòng tắt/mở sau sửa giữ Owner; 44 test iOS về cookie/authority qua. Chưa quy kết chi tiết lỗi lưu trữ bên trong WebKit; giải pháp chỉ bù UI preference, không bù quyền.
- RPC SQL gom lớn đầu tiên đã timeout trên DB thật dù test cô lập qua. Migration tiếp theo thay bằng các SELECT nhỏ trong cùng RPC; EXPLAIN dưới authenticated, có rollback, đo 116,043 ms. Không dùng security definer hoặc nới RLS để chữa chậm.
- Bản thử Today từng gửi phase=full bị API trả 400; hợp đồng thực yêu cầu bỏ phase. Đã sửa caller, thêm kiểm tra args và xác minh HTTP trên thiết bị. Các lượt 400 và cấu hình QA tuyến sai không tính là mẫu sau tối ưu.

## Kiểm chứng và phạm vi phát hành

- 48 test runtime/regression và 44 test iOS cookie/authority qua: scope, revocation, quyền, queue, Staff online proof, Today cold read, fallback/retry, dữ liệu durable cũ không chặn lượt đọc mới.
- Test DB cô lập replay migrations và kiểm tra self scope/RLS, anonymous/suspended bị chặn, quyền/membership bị rút có hiệu lực ở lượt sau, không có DML từ RPC đọc. TypeScript, lint và production build sạch ở distDir mới: 247 trang.
- Hai migration 20261028021000 và 20261028024000 đã áp vào DB đang thử. Hash/nội dung ticket, dòng ticket, booking, dòng booking và closing được đối chiếu trong transaction và sau toàn bộ lượt test iPhone; cả năm bảng giữ nguyên. Không gửi SMS/email, không chạy thanh toán thật.
- Backend QA bảo vệ: dpl_DajPmKsowVnwE3m3aXiXKGHmVdXE, pdx1. 12 file server/config/migration đối chiếu source hash. Các thay đổi client mới hơn backend preview được kiểm tra bằng bundle cài trực tiếp và production build local.
- iPhone QA build 76; JS buildId 7ad10a4b3f1a61018933eb00c36e2a340050a3c850c769e6bb7f1c5ba5ec345b; SHA256 app.js b16e038f075b08e082ce5a29d1679880256f36053ff008cb034273599a146a93. QA chỉ thêm đồng hồ, tuyến thử có bảo vệ và xóa snapshot đọc; không đưa cấu hình/token QA vào Git.
- Chưa promote web công khai hoặc upload TestFlight trong task này. Patch cần phối hợp với dependency iphone-real-performance-fixes-20261027 khi phát hành; Swift và app bundle thay đổi nên cần native build mới.

Nguồn số liệu tổng hợp có thể đọc bằng máy: [iphone-first-load-dal-rpc-20261027.json](iphone-first-load-dal-rpc-20261027.json). Raw benchmark/timing/source/DB receipts ở artifacts/iphone-dal-rpc-20261027, giữ tại máy làm việc.
