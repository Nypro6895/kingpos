# Kết quả đợt Auth–workspace–timeout

Nguồn sản phẩm cố định: `345c5b8ad88227477ed121e0ad54d245e54cfe3e`, bắt đầu từ đúng nguồn build39. **Chưa deploy web production, chưa upload TestFlight, chưa xác nhận lỗi trên iPhone đã hết.**

## Đã sửa trong mã nguồn

1. **Phản hồi Auth lệch thứ tự:** chỉ loại bỏ phản hồi cũ khi toàn bộ cookie hiện tại trùng chính xác với lần cập nhật đã hoàn tất do transport quản lý. Không xóa phiên/cache mới vì một phản hồi cũ. Thay đổi từ bên ngoài vẫn buộc kiểm tra lại. Thao tác ghi không tự gửi lại.
2. **Quyền thật vẫn bị thu hồi:** giữ xử lý401/403/409, kể cả lỗi nằm trong envelope HTTP200. Chặn việc dùng lại snapshot Owner đã bị từ chối; thay đổi workspace từ ngoài không được coi nhầm là đổi cookie nội bộ. Đã rà soát chéo các nhánh này.
3. **Auth online và quyền lưu offline:** HTTP200 có quyền online phù hợp có thể hiển thị dù dịch vụ cấp lease tạm503. Không tạo/gia hạn lease, không lưu dữ liệu mới để dùng offline, không mở quyền command/background khi chưa có grant hợp lệ. Lease cũ chỉ được giữ nguyên hạn và đúng quyền.
4. **Timeout/retry:** SDK GET chỉ có một lớp sở hữu retry. Trong phép thử,8 lượt gọi giảm còn2. Deadline context12 giây hủy GET đang chạy và ngăn GET tiếp theo, kể cả công việc đã bắt đầu trong cùng request. Không áp dụng retry/hủy suy đoán cho giao dịch POST/PATCH/DELETE.
5. **Khôi phục giao diện:** phân biệt cần đăng nhập, bị từ chối quyền, workspace đổi và cần xác minh lại. Request đọc cũ bị native hủy chỉ được kiểm tra lại một lần trong đúng trang/scope/epoch còn hiệu lực; không replay command hoặc POST body. Kết quả lặp lỗi dừng ở trạng thái có thể thao tác, không giữ Opening vô hạn.
6. **Đo trên thiết bị:** thêm bộ ghi giới hạn trong RAM ở bản Release và nút Save diagnostic report ở màn hình lỗi/Help. Native lọc lại dữ liệu xuất bằng danh sách enum, số và boolean; không nhận token, cookie, URL, account ID, nội dung lỗi tùy ý hoặc dữ liệu nghiệp vụ. Chỉ mở bảng chia sẻ khi người dùng bấm; không tự upload. File tạm được bảo vệ và dọn sau khi đóng bảng chia sẻ.

## Các nhóm file thay đổi

- Native: `ReylumiLocalAppTransport.swift`, `ReylumiLocalAppViewController.swift`, `ReylumiLocalDiagnostics.swift`, `AppLocalBridge.js` và bundle được tạo lại.
- Giao diện chung: `entry.tsx`, `app-local-context-recovery.ts`, `app-local-page-admission.ts`, `app-local-resource.ts`, `experience-trace.ts`, `app-local-help.tsx`.
- Server read: `bounded-get.ts`, `read-context-scope.ts`, `request-business-context.ts`, `supabase/auth-rest.ts`, `app-local-role-resources-server.ts`.
- Regression/fixture liên quan; toàn bộ danh sách và SHA-256 ở `frozen-source.json`.

Không sửa migration, RLS, phép tính kế toán, payload nghiệp vụ, quyền thiết bị hoặc cấu hình phân phối.

## Kiểm chứng đã có kết quả

| Kiểm tra | Kết quả |
|---|---|
| Hồi quy chung18 file test |135/135 đạt,0 bỏ qua|
| Bộ kiểm thử server liên quan |70/70 đạt, có phần trùng bộ chung; không cộng thành tổng độc lập|
| UI Chrome |18/18 đạt|
| UI WebKit |18/18 đạt; không phải iPhone vật lý|
| Typecheck, lint phạm vi thay đổi |Đạt|
| Production build web |Đạt|
| Bundle iOS |345 file xác minh hash,96 route,322 command; giữ cấu hình kết nối của build39|
| Swift/Xcode simulator và unsigned archive |Chưa có kết quả: CI đang chờ runner|
| iPhone vật lý |Chưa kiểm chứng|

Đã lưu lỗi trước sửa: SDK8 lượt gọi và2 lượt sau deadline; entry/helper của build39 thất bại3 ca; resource cancellation thất bại5/8 ca. Hai test chung từng thất bại do loader fixture chưa nạp module recovery mới; đã sửa dependency thật, không mock thay validator, và chạy lại135/135 đạt.

Thêm15 XCTest cho native và2 ca kiểm tra lọc báo cáo. Chưa gọi các test này là PASS khi chưa thực thi Xcode. Các fixture native chỉ dùng identity/cookie/JWT giả từ backend có kiểm soát, không lấy phiên thật của chủ tài khoản.

CI chính xác nguồn trên: https://github.com/Nypro6895/kingpos/actions/runs/39281462819 . Tại thời điểm ghi báo cáo, chưa bắt đầu chạy trên runner. GitHub công bố sự cố Actions từ15:49UTC19/10/2026: https://www.githubstatus.com/incidents/8tzbpcnl75jp . Đây là bằng chứng sự cố hạ tầng đồng thời, chưa khẳng định quan hệ nguyên nhân tuyệt đối cho từng phút chờ của job.

## Phần còn lại

- Phải đọc kết quả Swift/unsigned archive và sửa mọi lỗi mới nếu có trước khi đưa bản này vào phát hành. Nhật ký ghi `needs-integration`, chưa đánh dấu ready.
- Cần một bản native được phát hành riêng sau khi đủ kiểm chứng để thu báo cáo trên iPhone. Build39 đang cài không tự nhận nút xuất này qua thay đổi web.
- Chưa xác định chính xác nhánh gây lỗi trên chiếc iPhone của người dùng. Không khẳng định toàn bộ app đã nhanh hoặc mọi timeout đã hết.
- Promise đã khởi chạy ở các caller cũ vẫn chỉ giới hạn thời gian chờ nếu chưa chuyển sang lazy callback/signal; không tuyên bố mọi tác vụ của toàn project đã được hủy end-to-end.
- Tối ưu reference/data dùng chung của Today và entity cache giữa các trang nằm trong `next-phase-plan.md`, chưa ghép vào đợt Auth này. Ưu tiên đo và thay đổi nhỏ; chỉ xét streaming nếu số liệu chứng minh cần.
