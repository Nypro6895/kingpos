# Kiểm tra thực tế Reylumi sau đăng nhập

Ngày kiểm tra: 06/10/2026. Website: https://reylumi.com. Phiên gồm workspace chủ salon và workspace cá nhân của cùng một người dùng. Giao diện được kiểm tra ở kích thước trình duyệt mặc định khoảng mobile và desktop 1440 × 900.

Hai kết quả cần ưu tiên là nội dung Services được mount hai lần trong DOM và phạm vi mặc định của Reports bị thay đổi sau khi cập nhật dữ liệu. Các luồng mở biểu mẫu, đổi ngày và đổi tab phần lớn trả kết quả, nhưng có thời điểm shell hoặc dữ liệu cũ còn hiển thị trong lúc chờ. Mức tải thừa ở network chưa được định lượng bằng HAR; thời gian của lời gọi công cụ không phải TTFB, LCP hay thời gian tải trang chuẩn.

## Phát hiện đã có bằng chứng giao diện

### Nội dung Services có hai bản với state khác nhau

Mở `/services` ở kích thước mặc định, mở Edit của một dịch vụ, sau đó đổi viewport sang 1440 × 900. DOM có hai phần tử `main`, mỗi phần chứa một region `Salon services`. Một `main` không có client rect đang hiển thị, phần còn lại có client rect. Tab desktop hiện lại danh sách với nút Edit, trong khi bản mobile trước đó đã mở chi tiết.

Kết quả đọc DOM đã quan sát:

```json
[
  { "label": null, "serviceRegions": 1, "visible": false },
  { "label": null, "serviceRegions": 1, "visible": true }
]
```

Đây là xác nhận runtime cho phát hiện 01 trong báo cáo gốc. Không suy ra tất cả server loader đều chạy hai lần; vấn đề được chứng minh là hai cây giao diện client và hai state. Nên dùng một cây nội dung với bố cục responsive chung để việc đổi breakpoint không thay phiên chỉnh sửa đang xem.

### Reports thay đổi kỳ báo cáo sau lần cập nhật đầu

Truy cập `/reports` từ menu owner. Ảnh chụp ban đầu hiển thị Overview với khoảng `Oct 1 - Oct 6`, so sánh `Sep 25, 2026 to Sep 30, 2026`. Ở snapshot sau đó, không thao tác bộ lọc, Overview hiển thị `Oct 6`, so sánh `Oct 5, 2026 to Oct 5, 2026`. Lần mở lại trực tiếp `/reports` cũng đã hiện phạm vi `Oct 6` sau khi nội dung sẵn sàng.

Nguyên nhân phù hợp với mã nguồn: `app/reports/owner-live-reports.tsx:141` thêm `date=initial.report.reportDate` vào request refresh. `lib/operational-report.ts:533–548` chuyển request có date nhưng không có preset/start/end thành kỳ custom một ngày. Server render ban đầu và endpoint refresh vì thế có thể dùng hai kỳ khác nhau. Phải giữ nguyên range/preset đã chuẩn hóa khi gọi endpoint, tách date Daily Closing khỏi range Overview. Đây là vấn đề đúng dữ liệu hiển thị, không chỉ hiệu năng.

### Một số điều hướng giữ dữ liệu cũ hoặc shell trong lúc chờ

Bookings có loading workspace trước khi lịch xuất hiện. Reports có thời điểm URL đã chuyển sang `/reports` nhưng DOM chỉ có main trống; sau đó nội dung xuất hiện. Payroll chuyển Staff Income vẫn còn nội dung Overview trong snapshot đầu, rồi mới thay bằng Staff Income. Settings và POS ở một số lần nhấn liên kết cũng chưa thay nội dung ở snapshot ngay sau click.

Các trạng thái trung gian này chưa chứng minh lỗi điều hướng. Cần trạng thái pending nhất quán và xác nhận kết quả sau khi URL/nội dung đã ổn định. Không gán số giây từ khoảng cách giữa các lần đọc màn hình thành thời gian tải chuẩn.

### Một lần mở salon profile trực tiếp gặp context không hợp lệ

Sau các bước mở Settings, nhấn Profile rồi truy cập trực tiếp `/salon-profile`, giao diện chuyển tới My Place với thông báo `Choose a valid salon workspace before opening that page.` và shell cá nhân. Nhấn shortcut Salon profile trong My Place, shortcut đi qua `/workspace/open?...destination=/salon-profile`, mở được hồ sơ với shell owner.

Ghi nhận là luồng cần tái hiện thêm; chưa kết luận cookie/context tự đổi do Settings và chưa loại trừ race giữa các lần điều hướng hoặc thay đổi phiên. Không nên sửa bằng bỏ guard. Cần trace workspace cookie, action chuyển workspace và router cache trong một chuỗi thao tác có thời điểm rõ ràng.

## Các luồng đã kiểm tra

| Khu vực | Thao tác | Kết quả và giới hạn |
| --- | --- | --- |
| Explore và account switcher | Từ cá nhân sang owner, sau đó từ owner về cá nhân | Đến Today và Explore, nhãn workspace đúng sau khi chuyển hoàn tất. Có trạng thái Opening/Loading. |
| Today | Đọc summary, team, quick access | Hiển thị các liên kết và dữ liệu ngày hiện tại; ít dữ liệu giao dịch. |
| Bookings | Mở Calendar, chọn ngày trước | URL và tiêu đề ngày thay đổi, dữ liệu trả empty state. |
| Bookings tạo hẹn | Mở New, chuyển Services, Professional, Date & time, đóng | Danh mục dịch vụ và staff xuất hiện. Availability báo chưa có giờ phù hợp, có liên kết Set staff hours. Không tạo booking. |
| Reports | Overview, Daily Closing, đổi business date bằng Load | Ngày và trạng thái khóa ngày cũ thay đổi. Không lưu closing hoặc request correction. |
| Payroll | Tải trực tiếp, đổi Staff Income | Tab đổi và empty state hiện; chưa có dòng thu nhập để kiểm tra autosave. |
| Tax Company | Tải trang độc lập | Kỳ lương và tổng tiền hiển thị, không có reportable lines. Không print/pay/export. |
| Customers | Tìm chuỗi không khớp | URL/filter có kết quả No matching customers. Danh sách ban đầu empty. |
| Staff | Mở Edit một dòng | Các field mở tại chỗ. Không đổi status, PIN, quyền hay lưu nhân viên. |
| Services | Mở Edit, xem staff/add-ons, đổi breakpoint | Xác nhận hai cây nội dung và state tách biệt. Không đổi cấu hình hay lưu. |
| POS owner | Mở Add customer rồi đóng | Dialog tìm khách mở, giỏ vẫn trống. Staff chưa check-in nên không kiểm tra checkout. |
| POS History | Nhấn History rồi thử tải trực tiếp pos-tickets | Liên kết chưa đổi nội dung ở các snapshot sau click; tải trực tiếp trả trang ticket empty. Chưa xác nhận đây là lỗi sản phẩm vì cần loại trừ thời điểm navigation và cơ chế công cụ. |
| POS Tickets | Đọc ngày và bộ lọc | Trang ngày hiện tại empty; chưa kiểm tra mở/correct ticket có dữ liệu. |
| Salon Settings | Đọc sections | Nội dung tổng hợp lớn, phần permission có loading riêng. Map lookup báo chưa được cấu hình. Không thay setting. |
| All Settings | Mở Notifications detail rồi đóng | Có dialog, loading preferences và các switch disabled trong thời gian tải. Không đổi preference. |
| Salon Profile | Overview, Services, Book Full Set | Tab dịch vụ đổi tại chỗ, booking popup mở rồi báo online booking chưa bật. Không thể kiểm tra slot/confirm hợp lệ trên salon này. |
| My Place | Mở shortcut Salon profile có chọn workspace | Đưa về đúng owner profile sau context error nêu trên. Không đổi lifecycle hay ownership. |
| Notifications | Mở center, lọc Unread | Loading rồi empty state. Website tự đánh dấu thông báo visible là viewed; số unread giảm theo hành vi sẵn có. Không dùng Mark all viewed. |
| My Bookings cá nhân | Upcoming rồi Past | Các empty state đúng tab, không có booking để mở detail/cancel/reschedule. |
| Activity cá nhân | Từ All visits & receipts | Empty state, không có receipt/history detail để kiểm tra. |
| Beauty cá nhân | Overview rồi Library | Library đổi tại chỗ, empty state. Không đăng bài hay upload. |
| POS Portable | Mở từ POS Settings | Mở tab riêng và yêu cầu POS ID/passcode. Chưa đăng nhập thiết bị. |

Đây là coverage theo luồng đã thực hiện, không phải xác nhận tất cả nút trong 90 trang. Không tạo giao dịch, appointment, staff, service hoặc thay settings trong lượt này. POS có thể tạo state giỏ trống cục bộ theo cơ chế có sẵn khi mount.

## Điều kiện cần cho lượt tiếp theo

### Bổ sung: Saved Post và Account

- Saved Post có hai bài đã lưu. Nhấn View New salon look đưa tới đúng URL salon với fragment `#look-…`, nhưng giao diện vẫn ở Overview và không mở bài. Phải chọn Gallery rồi mở bài thủ công. Đây là lỗi luồng deep link quan sát trực tiếp; cần cho fragment chọn đúng tab và mở bài sau khi dữ liệu sẵn sàng.
- Post detail mở được, comments có trạng thái loading riêng. Không bình luận, lưu lại hoặc đặt dịch vụ.
- My Place trong workspace cá nhân tải hợp lệ ở lượt sau, không lặp lại cảnh báo workspace nêu trên.
- Account settings mở được Profile & contact và Danger Zone. Không chỉnh hồ sơ, xuất dữ liệu hoặc thực hiện deletion. Security chưa kiểm tra trong lượt này.

Tài khoản hiện tại có 0 salon liên kết dưới vai trò staff, nên cần người dùng đăng nhập tài khoản nhân viên đã liên kết salon để kiểm tra My Work, Appointments, attendance, profile và quyền. POS Portable cần phiên thiết bị riêng. Admin cần tài khoản có quyền admin. Để kiểm tra độ chậm dưới tải và các trang detail, nên dùng môi trường/tài khoản kiểm thử có khách hàng, lịch hẹn, ticket và dữ liệu payroll đại diện.

Việc lưu/correct/pay/check-in/create booking trên dữ liệu đang dùng thật chưa được thực hiện. Trước các lượt mutation cần chốt bản ghi thử nghiệm và thao tác cụ thể, tránh để audit làm thay đổi nghiệp vụ thực tế.

## Kết hợp với báo cáo mã nguồn

Ưu tiên xử lý runtime Services và Reports trước. Các phát hiện tải context trùng, full workspace refresh, revalidation rộng, polling tab ẩn và offline shell vẫn là bằng chứng mã nguồn; chưa có số request/byte production để khẳng định mức tải trong phiên này. Không đồng nhất working tree local với deployment production khi chưa xác nhận phiên bản deploy.
