# Quy tắc hiển thị salon và xác minh danh tính

Tài liệu này ghi lại bố cục và luồng xác minh đã triển khai ngày 5 tháng 10 năm 2026. LUMI Truth phản ánh bằng chứng trải nghiệm; badge xanh phản ánh hồ sơ danh tính được admin duyệt. Hai thông tin độc lập. Công thức, cửa sổ dữ liệu và giới hạn chống gian lận nằm trong `docs/lumi-trust-rules.md`.

## Thứ tự thông tin

1. Tên salon, tiếp theo là badge xanh nếu đã được duyệt. Không đặt LUMI Truth cạnh badge trên hàng tên.
2. Biểu tượng LUMI Truth, tên mức khi đủ chỗ, số lượt `visited`, liên kết `opinions`, khoảng cách nếu có.
3. Loại salon hoặc dịch vụ và giá phù hợp với ngữ cảnh. Thành phố là thông tin phụ.
4. Trạng thái mở cửa và thời gian mở hoặc đóng tiếp theo. Giờ chi tiết mở qua chức năng đang có.

Chữ phụ 11–12 px, khoảng cách hàng nhỏ. Biểu tượng Trust không có nền tròn trắng hoặc viền tròn. Common, Silver, Gold và Diamond dùng cùng một hình spark; trạng thái empty không có biểu tượng. Khi nguồn hợp lệ có 0 lượt ghé: `Building LUMI Truth · 0 visited · 0 opinions`. Khi nguồn không tải được: `Trust unavailable · Visits unavailable`, không suy diễn thành 0.

Tên mức như Silver nằm ngay cạnh spark trên hàng Trust; không cần thêm chữ Silver trước tên salon. Thẻ nhỏ chỉ dùng spark và visited. Lượt ghé là các lượt hợp lệ theo chính sách Trust, không phải tất cả ticket nội bộ hoặc lượt ghé chưa liên kết tài khoản.

## Các vị trí đã đối chiếu

| Vị trí | Hiện trực tiếp | Mở khi nhấn hoặc ẩn |
|---|---|---|
| CompactSalonCard trong carousel | Tên và badge; spark và visited; dịch vụ hoặc giá nhóm phổ biến; status | Toàn thẻ mở salon. Ẩn tên mức, opinions, return và thành phố vì chiều ngang nhỏ |
| TrendingDesignTile chỉ có ảnh | Ảnh và nút love/save hiện có | Không đặt Trust nổi trên ảnh không có tên salon. Mở preview để xem đầy đủ danh tính và visited |
| SalonCard ở kết quả và các nhóm khám phá | Tên và badge; Trust, visited, opinions, khoảng cách; dịch vụ/giá; status | Bằng chứng Trust trong popup; ý kiến trong Experiences; giữ Book/View/Call |
| InspirationPreview | Tên và badge; Trust, visited, opinions, good/concerns; dịch vụ của bài | Bằng chứng Trust và nội dung ý kiến mở từ liên kết. Giữ Save, Book, View, Call và Close |
| RecommendedFeatureCard | Lý do gợi ý; tên và badge; Trust, visited, opinions, khoảng cách; giá nhóm; status | Chi tiết bằng chứng qua popup. Giữ các nút đang có |
| Feed bài cá nhân gắn salon | Tên tác giả, at salon và badge; Trust ở hàng riêng dưới tên | Ý kiến và bằng chứng mở khi nhấn; không dùng trạng thái verify của bài để tính mức salon |
| Feed bài của salon | Tên và badge; Trust, visited, opinions, khoảng cách | Giá và thời lượng theo dịch vụ bài post ở phần quyết định booking. Share/Comment/Love giữ vị trí |
| Feed hero trên mobile | Cùng danh tính và Trust như feed thường, ngay dưới ảnh hero | Không ẩn hàng danh tính như trước |
| Thẻ salon đang chọn trên bản đồ | Tên và badge; Trust, visited, opinions; dịch vụ/giá; địa điểm và khoảng cách; status | Thông tin đầy đủ trong profile; chức năng bản đồ giữ nguyên |
| Header profile salon | Tên và badge; Trust, visited, opinions, good/concerns; loại/giá và địa điểm; status | Follower và số dịch vụ không chen vào header. Follow, Book, Settings và overflow giữ chức năng |
| Experiences và panel LUMI Truth | Mức và các bằng chứng phản hồi/quay lại, cỡ mẫu, cửa sổ dữ liệu | Có bộ lọc All, Verified Visits, Good feedback và Concerns; khách đọc được ý kiến tốt và xấu |
| DesktopInspiredCard | Tên và badge; Trust, visited, opinions, khoảng cách | Dịch vụ, giá và thời lượng của bài vẫn ở phần dịch vụ; Book/Save giữ nguyên |
| DesktopAvailableTodayCard | Tên và badge; Trust, visited, opinions, khoảng cách | Giá dịch vụ được setup và khung giờ book giữ nguyên |
| Trang chi tiết beauty post | Tác giả và salon/badge; Trust, visited, opinions, good/concerns, khoảng cách | Dịch vụ và giá của bài giữ nguyên; bình luận, chia sẻ, save và booking giữ chức năng |
| Trang look showcase mẫu | Tên và địa điểm, nhãn Preview | Không tự gắn badge hoặc sao đánh giá cho dữ liệu mẫu không có hồ sơ xác minh và bằng chứng thật |

Các vị trí dùng chung `components/salon-trust-line.tsx` và `SalonVerifiedBadge`. Không tự dựng điều kiện badge theo số visits hoặc theo việc bài có gắn salon. Header và mọi adapter nhận `identityVerified` từ RPC `get_public_salon_identity`.

Nhấn visited mở bằng chứng Trust. Nhấn opinions mở tất cả ý kiến. Liên kết good/concerns mở Experiences với bộ lọc tương ứng. Các số ở hàng Trust là mẫu khách phản hồi độc lập trong cửa sổ 180 ngày; danh sách Experiences vẫn giữ các nội dung cũ, kể cả nội dung không tham gia điểm, để không xóa lịch sử khách hàng.

Những nhóm khám phá và bộ lọc trước đây dùng sao hiện dùng mức LUMI Truth. Việc này chỉ thay nguồn chất lượng theo công thức đã thống nhất; không đổi logic booking, save, share, thời gian hoạt động hoặc đánh giá quyền thao tác.

## Giá salon và giá bài post

RPC `get_public_salon_identity` đếm booking có `status = completed`. Đếm một booking một lần trong một nhóm, kể cả booking có nhiều dòng dịch vụ cùng nhóm. Booking đang chờ, confirmed, cancelled hoặc no-show không được tính. Dòng add-on và dòng cancelled không được dùng làm dịch vụ phổ biến.

Nhóm sử dụng trường category hiện có trong catalog, đã trim; nếu category trống thì dùng tên dịch vụ. Không đoán nhóm bằng cách cắt tên. Các gói Pedicure cần cùng category Pedicure để có khoảng giá chung. Một nhóm có nhiều category đặt sai sẽ cần chủ tiệm chỉnh catalog, không tự hợp nhất các dịch vụ khác nhau.

Nhóm có nhiều booking hoàn tất nhất được chọn; nếu bằng nhau dùng thứ tự tên để kết quả ổn định. Giá thấp nhất và cao nhất lấy từ giá hiện tại của các dịch vụ đang active trong nhóm. Giá bằng nhau hiện một giá; khác nhau hiện khoảng, ví dụ `Pedicure $40–$100`. Khi không có booking hoàn tất thì không gọi bất kỳ dịch vụ nào là phổ biến và không dựng khoảng giá giả.

Salon card và profile dùng giá nhóm phổ biến. Thẻ bài post, trang book và Available Today giữ giá dịch vụ được setup cho ngữ cảnh booking. Không lấy giá nhóm phổ biến để thay giá dịch vụ mà khách đang chọn. Available Today lấy đúng giá catalog của bookableServiceId qua RPC `get_public_salon_service_prices`; không ghép tên dịch vụ với giá thấp nhất toàn salon. Nguồn tiền tệ tiếp tục là USD theo giao diện hiện tại.

## Xác minh salon

Chỉ owner có membership đang active được gửi hồ sơ. Chủ tiệm mở Profile Settings → Verify your salon. Form có tên đúng, địa chỉ đầy đủ, số điện thoại. Gửi form tạo OTP riêng cho salon; không cập nhật hoặc thay số điện thoại đăng nhập của owner.

Luồng trạng thái: chưa gửi → otp_pending → waiting → approved hoặc rejected. Trước khi OTP đúng, admin không thấy hồ sơ trong hàng chờ. Duyệt xong badge xanh xuất hiện trên các vị trí có danh tính salon. Waiting và rejected không có badge.

Lần 1 không có upload. Từ lần xin lại đầu tiên, upload là tùy chọn: tối đa 3 file JPG, PNG hoặc PDF, mỗi file tối đa 5 MB. Không đính kèm vẫn gửi được. Số application tăng theo lần xin mới sau khi bị từ chối; gửi lại OTP cho hồ sơ chưa submit giữ nguyên số application.

Admin mở `/admin/verification`. Quyền đọc dùng `admin.locations.read`; quyền duyệt, từ chối, khóa hoặc mở lại dùng `admin.locations.update_status`. Chỉ hồ sơ mới nhất được xử lý. Approve/Reject dùng cho hồ sơ waiting. Reject hoặc Block cần lý do. Các quyết định được ghi lịch sử riêng.

Blocked chỉ khóa quyền gửi hồ sơ verify của salon. Không suspend owner, không khóa tài khoản, POS, booking hoặc các quyền đang có. Admin có thể mở lại quyền xin; sau đó owner xin tiếp theo cùng quy trình retry.

Hồ sơ giữ bản chụp tên/địa chỉ/điện thoại đã nộp. Luồng hiện tại không tự cập nhật thông tin public từ hồ sơ verify và không tự thu hồi badge khi owner sửa profile; việc xét lại sau thay đổi danh tính cần thống nhất riêng trước khi thêm quy tắc.

## OTP và file riêng tư

Mã 6 số, hết hạn sau 10 phút; tối đa 5 lần thử; gửi lại sau ít nhất 60 giây và tối đa 5 lần trong một giờ cho một salon. Giới hạn và quyền owner được kiểm tra ở database, không chỉ ở UI. Hash OTP không được trả về browser hoặc admin. Browser không có quyền tạo challenge với hash tự chọn.

File nằm trong bucket riêng `salon-verification`; không có URL public. Server kiểm tra nội dung nhận dạng file và giới hạn kích thước. Admin chỉ mở file được gắn với hồ sơ họ có quyền đọc, qua URL ký có hạn 60 giây.

Luồng SMS sử dụng Twilio trên server. Cần `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, cặp `REYLUMI_TWILIO_ACCOUNT_SID`/`REYLUMI_TWILIO_AUTH_TOKEN` hoặc `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`, và Messaging Service SID hoặc From đã cấu hình. Không đặt khóa bí mật trong biến NEXT_PUBLIC. Môi trường hiện tại chưa có đủ cấu hình này; gửi SMS thật còn cần cấu hình nhà cung cấp. Không có mã bypass trong production.

## Điểm chỉnh sửa và kiểm thử

- Bố cục/nhãn và badge: `components/salon-trust-line.tsx`.
- Form owner và các thao tác: `app/settings/salon-verification-panel.tsx`, `salon-verification-actions.ts`.
- Hàng chờ admin: `app/(app)/admin/verification`.
- Luồng database, OTP, file bucket và giá nhóm: migration `202610050002_salon_identity_verification.sql`; thay đổi tiếp theo phải bằng migration mới.
- Công thức Trust: `LUMI_TRUST_RULES` và policy SQL trong tài liệu Trust.

Kiểm thử database bao gồm quyền owner/admin, không lộ OTP, mã sai/null, retry tùy chọn file, khóa riêng quyền verify, mở lại, duyệt badge, ẩn salon private, lịch sử quyết định và giá nhóm tính theo booking hoàn tất. Giao diện cần kiểm tra mobile 320/390/768 px, desktop, không tràn ngang, popup và link good/concerns. SMS đến điện thoại thật chỉ xác nhận được sau khi cấu hình nhà cung cấp.


## Kết quả đối chiếu ngày 05/10/2026

- Đã triển khai migration Trust v2, verify salon và giá dịch vụ công khai vào database liên kết.
- Build production và TypeScript đã qua; 41 kiểm thử liên quan đã qua; kiểm thử SQL về bằng chứng Trust, quyền/OTP/duyệt verify và giá booking hoàn tất đã qua.
- Explore và Profile đã kiểm tra ở 320, 390, 768 và 1280 px: 8 trường hợp không tràn ngang, không có lỗi trang; liên kết opinions/good/concerns mở đúng mục.
- Ảnh `artifacts/lumi-truth-review/trust-layout-examples.png` dùng dữ liệu mẫu để so sánh bốn mức. `explore-mobile.png` và `profile-mobile.png` là ảnh giao diện chạy với dữ liệu hiện tại.
- SMS thật chưa được kiểm thử đến điện thoại vì môi trường thiếu cấu hình nhà cung cấp và khóa server. Các kiểm thử OTP hiện xác nhận quyền, mã sai/đúng, hết hạn và chuyển trạng thái tại database.
- Hai kiểm thử hợp đồng cũ ngoài phạm vi vẫn có kỳ vọng đã lỗi thời: AuthIntentPrompt trong luồng booking showcase và chuỗi thông báo backend reputation. Không sửa logic các luồng này để làm xanh kiểm thử.


## Đồng bộ booking từ ticket đã hoàn tất

Bổ sung ngày 05/10/2026, migration `202610050004_booking_ticket_completion.sql`: tạo ticket từ booking đã lưu liên kết hai chiều nhưng trước đây không hoàn tất booking khi đóng ticket. Database hiện đồng bộ khi liên kết một ticket đã đóng vào booking, hoặc khi đóng một ticket đã liên kết.

Chỉ đồng bộ khi salon, khách hàng và liên kết hai chiều khớp. Dịch vụ phải có item chưa bị xóa và source_booking_line_id khớp đúng dòng booking. Những dòng scheduled/in_service/in_progress tương ứng chuyển completed, lấy thời điểm đóng ticket. Booking chỉ chuyển completed khi tất cả dòng đã completed/cancelled/skipped; nếu còn dòng chưa làm thì giữ in_service. Không tự đánh dấu hoàn tất vì đã qua giờ hẹn; không biến booking cancelled/no_show/pending thành completed. Đóng lại ticket không tạo ghi nhận hoàn tất trùng. Mở lại ticket không tự đảo ngược booking hoặc dịch vụ đã hoàn tất; thay đổi chính sách đảo ngược cần thảo luận riêng.

Không tạo booking giả cho ticket walk-in cũ. Các bản ghi lịch sử chỉ được đồng bộ nếu đã có đủ liên kết gốc và ánh xạ dịch vụ. Kiểm thử: portable-booking-edit, portable-booking-service-staff và booking-ticket-completion, chạy trong transaction rollback; bao gồm đủ dịch vụ, một phần dịch vụ, ticket còn mở, item bị xóa, đóng lại và chống tạo ticket trùng.
