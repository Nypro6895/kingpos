# App Privacy cho bản iOS đầu — bảng khai để đối chiếu

Ngày 16/11/2026, America/Chicago. **DRAFT_EVIDENCE_PENDING — chưa nhập hoặc xác nhận trên Apple.** Phạm vi giữ Market và giao dịch credit quảng cáo theo câu trả lời mới của chủ app. Không thay giá, kích hoạt provider/cờ đang tắt hoặc mở thêm thị trường.

Nguồn sản phẩm nền là `5b9609c`; bản đồ chi tiết và file/dòng có trong [business map](ios-submission-business-data-map-20261116.md), [native map](ios-submission-native-data-map-20261116.md) và [commerce map](ios-submission-commerce-scope-20261116.md). Hai purpose strings của Info.plist được sửa riêng sau baseline; không thêm quyền.

## Cách đọc bảng

“Đề nghị Có” là kết luận từ luồng gửi/lưu dữ liệu trong nguồn nếu tính năng đó nằm trong candidate, không phải khai báo đã nộp. Cần đối chiếu bản triển khai và đối tác thực tế trước khi xác nhận cuối. Dữ liệu lưu private, mã hóa, chỉ Owner/Staff/Tax xem hoặc chỉ một nhóm người dùng sử dụng vẫn có thể cần khai. Xử lý hoàn toàn trên thiết bị khác với việc lưu ở server. [Định nghĩa Apple](https://developer.apple.com/app-store/app-privacy-details/).

Mục đích **App Functionality** dưới đây gồm vận hành tính năng, tài khoản, phân quyền, an toàn và support. Chỉ thêm mục đích khác khi đúng luồng thực tế. Các trường gắn account/customer/staff/salon/recipient được đề nghị **linked**; UUID/hash không đủ chứng minh anonymous. **Tracking chưa chốt** cho tới khi kiểm tra cách dùng/chia sẻ của đối tác; không tự chọn No từ việc không thấy IDFA/ATT.

## Ma trận khai nháp

| Loại dữ liệu Apple | Dữ liệu/luồng thực tế | Đề nghị và giới hạn |
| --- | --- | --- |
| Name | Account, khách, staff, payee, Tax profile, support | Có; linked; App Functionality. Không chỉ xét tên của người đăng nhập. |
| Email Address | Auth/profile, customer/staff, Tax và người nhận hỗ trợ | Có; linked; App Functionality. Marketing chỉ thêm nếu luồng thực tế dùng cho mục đích đó. |
| Phone Number | Account verification, customer/staff và nghiệp vụ liên quan | Có; linked; App Functionality. Nhà cung cấp OTP không tự chứng minh có SMS marketing. |
| Physical Address | Staff/issuer/payee và địa chỉ được người dùng cung cấp | Có nếu candidate lưu các trường cá nhân này. Địa chỉ salon công khai đơn thuần không tự là địa chỉ cá nhân. |
| User ID | Auth/user/customer IDs, memberships, author/recipient, attribution signup | Có; linked; App Functionality. Analytics/advertising bổ sung cho ID thật sự được dùng trong attribution. |
| Device ID | Mã thiết bị/browser chống lạm dụng và các identifier ổn định | Ứng viên Có. Phân biệt token thiết bị với device class; kiểm tra lifetime/linking và provider. Không IDFA không đồng nghĩa không có identifier. |
| Photos or Videos | Ảnh hồ sơ/bài, ảnh support và ảnh tài liệu được chọn tải | Có cho ảnh được tải; linked. Frame camera chỉ decode QR tại thiết bị không tự là video upload. |
| Other User Content | Caption, review, reply, Forum, notes, PDF/nội dung gửi | Có; thường linked; App Functionality. Không coi mọi PDF là Photos or Videos. |
| Emails or Text Messages | Nội dung/metadata giao tiếp riêng thực tế, gồm Tax messages | Ứng viên Có theo luồng; không gọi mọi caption/comment công khai là private message. |
| Customer Support | Case, nội dung trao đổi, report/appeal và evidence | Có cho luồng support thu thập thường xuyên trong nguồn. Không dùng ngoại lệ optional disclosure nếu chưa đáp ứng đủ điều kiện. |
| Purchase History | Booking/POS/Gift, đơn hàng/thuê bao Market, ad credits | Có trong full scope; linked; App Functionality. Record nghiệp vụ không chứng minh tiền đã được provider settle. |
| Other Financial Info | Thu nhập, commission, tip/bonus, payroll/tax/withholding | Có; linked; App Functionality. Phân quyền riêng tư không loại dữ liệu lương khỏi nhãn. |
| Payment Info | Routing/account của Check Writer và các trường thanh toán app tiếp cận | Cần khai trong scope có xử lý bank account. Stripe hosted-card entry có ngoại lệ riêng khi đúng điều kiện; không dùng ngoại lệ đó để bỏ cả dữ liệu bank/POS. |
| Precise Location | Tọa độ GPS gửi tới server rồi MapTiler/Census tùy đường chạy | Chờ chứng cứ retained collection/linking tại hosting/provider. Không gán thành coarse chỉ vì `highAccuracy:false`. |
| Coarse Location | City/state/ZIP, IP-derived country/area khi được giữ | Đối chiếu mức chi tiết, nơi lưu và mục đích thực; không thay thế dòng precise. |
| Product Interaction / Other Usage Data | Navigation, thao tác, session, discovery/measurement | Có hoặc conditional theo event thật sự lưu; đối chiếu App Functionality/Analytics/Personalization, không khai mọi purpose mặc định. |
| Advertising Data | Campaign/session/audience/path, impression/click và signup attribution | Cần đối chiếu trong scope quảng cáo. Ads của salon khác là ứng viên Third-Party Advertising; quảng bá Reylumi là Developer Advertising; thống kê là Analytics. Cách triển khai ads nội bộ không tự quyết định tracking. |
| Performance / Crash / Other Diagnostic Data | Log/telemetry hosting, BotID; native local diagnostics | Từng subtype chờ network/log/SDK evidence. Log nằm hoàn toàn trên máy không tự là collected; file support gửi lên là luồng khác. |
| Search History | Search/address query đi tới server/provider | Endpoint có tồn tại, nhưng việc giữ query cần chứng cứ; không tự khai Có/Không chỉ từ tên route. |
| Browsing History | External web navigation nếu được thu thập | Chưa chứng minh thu thập. In-app path không tự là lịch sử duyệt web bên ngoài. |
| Other Data Types / government identifiers | SSN/EIN được người gửi đặt trong tài liệu Tax | Phải mô tả xử lý tài liệu; chốt taxonomy theo payload/mục đích. Không tự biến SSN/EIN thành ID tài khoản hoặc chọn Sensitive Info chỉ vì gọi là dữ liệu nhạy cảm. |
| Contacts / Health / Fitness / Audio / Sensitive Info / Credit Info | Chưa có luồng dedicated đã chứng minh cho tất cả các nhóm này | Không tick hàng loạt chỉ vì free text có thể chứa bất kỳ dữ liệu nào. Rà forms, social graph, uploads và SDK/candidate trước khi loại; không suy ra có/không từ riêng native permission list. |

## Các kết luận cần giữ đúng

1. **Không chọn Data Not Collected.** Nguồn có account, nội dung và dữ liệu nghiệp vụ được gửi/lưu ngoài thiết bị.
2. **Không đánh dấu toàn bộ dữ liệu là unlinked.** Có quan hệ account/customer/staff/recipient và signup attribution.
3. **Không bỏ Payment Info chỉ vì Stripe mở ngoài app.** Check Writer server giải mã routing/account khi có quyền; inventory đã chỉ rõ source.
4. **Quảng cáo và tracking là hai câu hỏi khác nhau.** Cần phân loại theo chủ quảng cáo và hành vi đối tác, không theo tên thư viện.
5. **PrivacyInfo.xcprivacy khác App Privacy trên Store.** File nguồn hiện chỉ liệt kê required-reason APIs; phải xem report của archive cuối và khai thực tế app/web/backend.
6. Không hứa dữ liệu chỉ ở Mỹ, không giữ log hoặc không dùng cho mục đích phụ khi chưa có chứng cứ provider/config/hợp đồng.

## Chứng cứ cần lấy trước khi lưu câu trả lời cuối

| Việc | Người thực hiện | Kết quả cần có |
| --- | --- | --- |
| Đối chiếu project/provider đang chạy | Engineering có quyền read-only | Project/source đúng, enabled flags, live/test, đường server/client và các field; không lấy dữ liệu khách để chứng minh. |
| Log, backup, vùng xử lý, secondary use | Engineering/provider admin; business xác nhận hợp đồng | Setting/plan/điều khoản thực, thời hạn/tiêu chí và người được truy cập. Không hỏi chủ app đoán SDK. |
| Ads, recipient và purpose/linking | Engineering + người vận hành ads | Payload thực đã tối thiểu hóa, bên nhận, attribution, có/không cross-company matching/broker use. |
| Native archive và network | macOS/iPhone/iPad QA | SDK/privacy report, permission và traffic trên đúng candidate; capture không chứa tài liệu lương/thuế thật. |
| Retention/xóa/export | Engineering + legal/business | Bảng theo nhóm và historical residual plan; hosted maintenance/erasure/export được nghiệm thu, không suy ra từ fixture. |
| Final policy và labels | Người có quyền Apple/operator | So sánh một lần cuối, lưu/readback nhãn thật; không dùng bảng nháp này như tờ khai đã nộp. |

Lần thử ràng buộc cấu hình Auth public của lượt này không xác định được project từ ngân sách JS đã đọc nên dừng **trước** request provider. Không lấy đó làm bằng chứng provider tắt. Bản đồ hiện đủ để chuẩn bị câu trả lời và yêu cầu chứng cứ cụ thể, chưa đủ để xác nhận nhãn cuối.
