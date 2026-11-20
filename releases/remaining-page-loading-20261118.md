# Loading các trang còn lại — local QA111

Nguồn nền `cf77926b698cc23d7f6d570ac75cf617bb78a525`. Đây là thay đổi riêng, phụ thuộc nguồn đã duyệt của `iphone-qa-approved-fixes-20261115` và `payroll-loading-20261118`; không thay thế ready event của hai task đó. Không deploy, push, upload TestFlight hay thao tác App Store.

## Phạm vi đã cố định

| Nhóm | Thay đổi |
|---|---|
| Staff | Chỉ giữ `staff`, `invite_email`, `invite_phone` trong read key, nguyên giá trị kể cả chuỗi rỗng. Add/form/filter/thông báo vẫn theo URL gốc; cùng DTO dùng chung key cho trang, prefetch và bootstrap cũ đã được chấp nhận. |
| Book | Chỉ gộp các mặc định đơn lẻ chính xác `tab=calendar`, `view=list`, `range=day`. Giữ nguyên ngày, bộ lọc thực, tham số lặp, tab khác và query gốc cho giao diện. Không suy ngày salon từ đồng hồ thiết bị. |
| Library | Trang Library riêng không mount timeline ẩn hoặc đọc Love/trạng thái ẩn của PostCards không hiển thị. Ảnh, mở bài và tải thêm giữ luồng cũ; trang Beauty thông thường vẫn có các lượt đọc cần thiết. |
| Services | Sau command Save được chấp nhận, dùng `ensureFresh` của `page.services` để nối lượt invalidation đang chạy hoặc dùng kết quả vừa hoàn tất, tránh refresh lại route/admission. Giữ actions, Save/Cancel, dữ liệu và quyền. |

Các bộ chuẩn hóa bootstrap chỉ đổi key của đúng named read; không đổi scope, điều kiện chấp nhận, timestamp hay freshness. 122 file được bảo vệ và registry Today được đối chiếu không đổi so với `cf77926`. Không sửa server/RPC, logic lương, tiền, auth, grant hoặc permission.

Các adapter là phía client; Library và helper Book cũng nằm trong nguồn dùng chung của web. Nhật ký hoàn thành ghi cả web/iOS để giữ đúng phần còn chờ phát hành. Các trang HTTPS được app chuyển tới vẫn dùng nguồn hosted hiện tại; không suy việc đã cập nhật web từ bản QA cài cục bộ.

## Kiểm tra local

- 156 focused tests đạt, không lỗi và không skip. Có đối chứng nguồn cũ đọc lặp, held read, prefetch, draft cùng DOM, thời hạn freshness, denial, đổi scope/reset, late reply và bootstrap cũ không thêm lượt đọc.
- ESLint cả 8 file sản phẩm, production build và offline bundle verification đạt.
- Local signed Debug `1.0.0 (111)` đã cài và đọc lại trên iPhone thật; codesign và toàn bộ 368 file bundle được xác minh. Cài cập nhật tại chỗ, giữ dữ liệu/cache native.
- Bundle build ID: `56527674847c5326bf4150f2e4d1a291f79d7a96370774de81b67c858ec493ec`.
- Manifest SHA256: `692e49c251ed35d9c152571d384e68c51f956b8f923c9601e6e5e1d95b1808c7`.

## Bằng chứng iPhone hiện có

- **Staff → Add Staff:** baseline 110 còn Loading ở frame 0–3, form đầu tiên frame 4 với cận 519–1449 ms. QA111 đã có form ở frame 0, cận trên 773 ms. Chỉ một cặp quan sát, cache giữ qua cập nhật; không phải phép đo cold load, phần trăm tăng tốc hay số request.
- **Book:** Appointments với route mặc định và tiêu đề Next day đúng ở các mốc 1432/1434. Không suy tốc độ backend từ ảnh.
- **Services:** tạo service QA riêng `QA Loading111 Inactive` với Active/online booking tắt; sửa description `QA loading check111`, Save thành công và DTO mới được xác minh ở 1426. Xóa service QA chưa dùng được xác nhận ở 1428; danh sách gốc được kiểm tra lại ở 1429, gồm Gel `$35`, `45` phút, Active và online booking.
- **Services Save:** cả 38 frame giữ editor; không thấy trang Opening/Loading chung. Đây là bằng chứng phần nhìn thấy còn nguyên, không chứng minh toàn bộ DOM ngoài màn hình, số request hay latency mạng.
- **Library:** trang riêng và ba bộ lọc All/Photos/Before & After đạt với thư viện trống trên máy; quay về sau background/foreground vẫn đúng Library (1563). Giảm hai lượt đọc với timeline có ảnh được xác nhận bằng browser fixture, không phải đếm request trên máy.
- **Điều hướng:** Owner → Staff → Personal và Personal → Owner → Personal đạt, không yêu cầu đăng nhập lại. Kiểm tra thêm các trang Book, Reports/Expenses, Customers/detail, Profile/Post, Market, Advertising, Gift, Rewards, Forum, Notifications, Settings, Support, Help, My Place, Staff My Pay/Analysis/Bookings, Personal Bookings/History/Saved/Following/Reviews/Memberships/My QR. Các màn chưa bật giữ nguyên trạng thái chặn; không Activate, gửi tin, đặt lịch, trả tiền hoặc tính/chốt lương. Đây là kiểm tra mở trang và trạng thái đã nêu, không phải mọi nút hoặc mọi nhánh của 148 route nguồn.
- **Kết thúc:** controller `TEST EXECUTE SUCCEEDED`, đã dừng ở 1564 và giải phóng lease thiết bị của task. iPhone giữ Personal Library trong QA111. Bằng chứng wait/tap sai selector hoặc chưa tới nội dung được ghi loại riêng, không tính là lỗi sản phẩm hay acceptance.

Evidence root: `C:\Reylumi\qa-evidence\remaining-page-loading-20261118`. Xem `REPORT.html`, `acceptance111.json`, `candidate111-installed.json`, `comparison.json`, `service-save-observations.json`, `protected-source-verification.json`, thư mục `before110`, `after111` và các log trong `validation`.

Trước một lần phát hành được cho phép sau này, tích hợp patch đã cố định và các dependency vào đúng nguồn production/native hiện hành, build lại và chạy acceptance liên quan. Local QA111 chưa phải bằng chứng phân phối hay publication.
