# Phạm vi bản iOS đầu và gói chuẩn bị khai báo — 16/11/2026

**SCOPE_CONFIRMED_RUNTIME_EVIDENCE_PENDING.** Chủ app đã chốt: iOS, app tải/sử dụng nền tảng miễn phí, storefront Mỹ, operator Reylumi LLC, copyright nền tảng Reylumi, quyền UGC của người dùng/chủ quyền; không tự đặt ngưỡng tuổi toàn cục hoặc admin duyệt trước từng ảnh. Câu trả lời mới giữ **Market và giao dịch credit quảng cáo trong phạm vi kiểm tra/khai báo** của bản đầu. Điều đó không xác nhận provider đang bật, phê duyệt giá mới hoặc cho phép kích hoạt một tính năng đang đóng.

Nguồn sản phẩm đối chiếu: `5b9609c`. Native purpose-copy sau baseline chỉ đổi mô tả Camera/Photos, không thêm quyền hoặc đổi bundle/version. Đây là hồ sơ chuẩn bị; **chưa deploy, upload native, nhập tờ khai hay gửi App Review**. Chưa có source/schema/provider hosted cuối được đóng băng cho release.

## Phạm vi đã xác định để kiểm tra

| Nhóm | Cách xử lý trong hồ sơ bản đầu |
| --- | --- |
| Account, Customer/Owner/Staff/Tax, settings | Giữ quyền/quan hệ vai trò hiện có; mô tả account, auth, profile, session và phân quyền. Không cấp admin cho tài khoản reviewer. |
| Explore, salon, maps/location, booking/check-in | Có trong phạm vi; kiểm tra GPS/server lookup/direct map requests, customer history và quyền dùng vị trí theo lựa chọn. |
| Beauty/Salon, review/reply, Forum/chat | Có UGC; không bỏ Forum chỉ vì Owner-only. Bộ lọc bài ảnh mới hiện có hạ tầng local nhưng chưa có verifier thật; các bề mặt khác vẫn cần kiểm kê/lọc phù hợp. |
| POS, Gift/Wallet, receipt/rewards | Giữ canonical trạng thái và số dư; tách ghi nhận POS, mua Gift, redeem/transfer và charge thực tế của provider. |
| Payroll, Tax, bank/Check Writer nếu có quyền | Giữ dữ liệu và quyền nghiệp vụ; lập disclosure theo dữ liệu thật, kể cả chứng từ/private. Sales/trial đang đóng không tự xóa nghĩa vụ với dữ liệu hoặc quyền cũ. |
| Market first-party và ad-credit transactions | **Giữ để rà/khai theo quyết định mới.** Tách miễn phí, activation, trial, subscription, credit/welcome credit và recurring top-up. Không đổi giá/billing/entitlement trong lượt này. |
| Hosted app/developer runtime và preview | Phân loại riêng theo flag/readiness. Không gọi preview/test-only là hàng đang bán; cũng không ẩn tính năng để tránh reviewer. Nếu thực sự cung cấp remote software, cần rà nhóm quy tắc Apple tương ứng. |
| Support, report/block, export/deletion, Legal | Reviewer cần tìm và dùng được. Xác nhận mailbox/nhân sự, requests/appeals và bằng chứng kết quả thực; không chỉ có nút hoặc văn bản chính sách. |

Chi tiết: [12 nhóm commerce](ios-submission-commerce-scope-20261116.md), [11 nhóm dữ liệu nghiệp vụ](ios-submission-business-data-map-20261116.md), [11 luồng native/web và provider](ios-submission-native-data-map-20261116.md), [App Privacy worksheet mới](ios-submission-app-privacy-20261116.md). Bản JSON tổng hợp: `ios-submission-scope-20261116.json`.

## Nội dung Privacy cần thay trước khi công bố bản cuối

GET public ngày 16/11 Chicago cho cả `/privacy`, `/terms`, `/community`, `/business-terms` đều HTTP 200. Privacy vẫn chứa lời hứa “normally completes within 24 hours” sau pending period; operator LLC và email đã chọn không xuất hiện dưới dạng literal trong phần policy text được trích. Đây là bằng chứng nội dung public, không phải xác minh source deployment hoặc mailbox.

| Nội dung | Bản cần dùng khi đã đủ chứng cứ |
| --- | --- |
| Operator/contact | Dùng Reylumi LLC và kênh liên hệ đã chọn; xác minh mailbox/monitoring, notice address và vai trò xử lý còn thiếu. Không hỏi lại tên LLC/email đã chốt. |
| Xóa tài khoản | Dùng quy trình pending, xử lý/retry và trạng thái hoàn tất thực. Bỏ mốc 24 giờ chưa có bằng chứng; không nói đã xóa mọi bản lưu/backup hoặc thu hồi bản người khác đã nhận. |
| POS/payroll/tax/bank | Nêu nhóm trường, người có quyền/recipient và mục đích; tách personal profile khỏi chứng từ/hồ sơ doanh nghiệp. Không gọi mọi hồ sơ còn lại là luật bắt buộc lưu. |
| Nội dung/copyright | Giữ quyền UGC và license vận hành theo phạm vi; phân biệt tài sản Reylumi/lumiAi và quyền người khác. Không dùng trách nhiệm người nhập để bỏ nghĩa vụ riêng của nền tảng. |
| Providers/location/ads | Chốt roster và data-purpose-retention thực; tách request trực tiếp từ máy với server proxy. Không tuyên bố không tracking/US-only/no logs chỉ từ source. |
| Bộ lọc ảnh | Chỉ đưa mô tả provider/xử lý vào policy sau khi đã chọn và kiểm chứng. Không tự tuyến luồng payroll, Tax, support hoặc hồ sơ tài chính riêng sang verifier ảnh bài Beauty/Salon. Ảnh người dùng chủ động gửi qua luồng bài đăng được xử lý theo provider đã công bố; không thể bảo đảm pixels của ảnh không chứa dữ liệu riêng. |
| Dates/acceptance | Chỉ đổi ngày hiệu lực/cập nhật và công bố khi đã duyệt nội dung cuối và có plan thông báo phù hợp. Bản source candidate hiện không tự là policy đã phát hành. |

Candidate chính sách đã có trong `lib/legal-policies.ts`; không tạo lời hứa mới để lấp ô chưa biết. Các ID D1–D13/E1–E8 ở draft ngày 09/11 được giữ để theo dõi; bằng chứng/decision mới dưới đây cập nhật trạng thái, không xóa lịch sử.

## Các điểm đã chốt và phần cần chứng cứ

- D1: operator, USA và designated email đã chốt; mailbox/notice details/vai trò thực còn cần kiểm chứng.
- D10/E8: **đã chốt giữ Market/ad transactions trong scope**; actual catalog/flags/live-test/prices/merchant/refund/return flow vẫn là chứng cứ kỹ thuật/thương mại cần lấy.
- D11: không yêu cầu duyệt admin từng ảnh; verifier/provider chưa chọn. Report/takedown/appeal vẫn phải có người xử lý.
- E1–E4: đã truy vết source, dependency, data flow và config-name presence; chưa xác minh runtime provider/log/backup/secondary use. Lượt public Auth probe dừng trước provider vì chưa bind project an toàn.
- E5–E7: các fix Tax/export/retained ownership/quarantine đã có fixture/bằng chứng local; hosted/installed-app/historical residual acceptance vẫn còn.
- D6/age rating: không tự thêm 13+/18+ hoặc thu DOB; phải hoàn thành questionnaire thật và quy trình xử lý trẻ em theo phạm vi áp dụng.

## Bước kỹ thuật tiếp theo đã cụ thể

1. Read-only preflight đúng project/source đang phục vụ app: catalog/flags/payment modes và chỉ metadata cấu hình cần thiết; không đọc tài liệu khách/lương/thuế để chứng minh activation. Giữ giá trị credential ngoài báo cáo.
2. Lấy cấu hình/điều khoản provider, logs/backup/retention và xác nhận mailbox vận hành. Chốt các ô App Privacy còn conditional bằng bằng chứng, không yêu cầu owner đoán SDK.
3. Chọn và nối verifier ảnh thật, hoàn thiện các bề mặt UGC còn lại; kiểm tra nhầm lẫn/lỗi và report → quyết định → trạng thái nội dung. Không sử dụng fixture verifier để mở public.
4. Ghép đúng live baseline và migrations đã kiểm tra; hoàn thiện/publish policy tương ứng với triển khai thật theo quyền release. Trước mắt chưa có lệnh deploy.
5. Rebuild native bundle/binary vì các module nằm trong app và purpose strings đã đổi; thử thiết bị/screenshot/demo, ghép đúng version/build, hoàn thành declarations và lưu/readback trước Submit.

## Gói cho reviewer cần chuẩn bị

Tài khoản demo và dữ liệu giả cho Customer, Owner/POS, Staff/My Pay/QR, Tax/Documents theo tính năng được reviewer kiểm; hướng dẫn chuyển vai trò/salon và đi tới Report/Block, Support, Delete account. Cung cấp credential qua mục App Review an toàn, không qua Git/chat. Không dùng paystub/tax documents, giao dịch hoặc tin nhắn khách thật làm ảnh/demo. Market/ads phải được mô tả đúng đường thanh toán và quyền dùng, gồm Safari/hosted return nếu candidate sử dụng.

Hồ sơ Apple gần nhất vẫn là snapshot 16/11 14:31–14:32 Chicago; không có refresh trong lượt này. Việc chọn build/version, giá miễn phí, copyright, Content Rights, age rating, nhãn Privacy và review details cần được đọc lại sau khi bản cuối sẵn sàng. Không tự tăng build number từ snapshot cũ.
