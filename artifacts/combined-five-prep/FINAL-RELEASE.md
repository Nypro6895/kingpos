# Đã phát hành chung web và iOS 64

**Cập nhật QA mới hơn receipt:** iPhone đã cập nhật 64 và có 16 ca đọc/điều hướng được quan sát đạt. Có lỗi More popup: Exit POS và View all settings không điều hướng. Bản sửa một file đã tái hiện fail trước, đạt 14 kiểm tra sau sửa cùng lint/TypeScript/build, commit `a7eeaa2b20dd9af39399e1fa15a34206983125fb`; **chưa deploy hoặc build native cho bản sửa** theo chỉ dẫn không phát hành lẻ tiếp. Xem `physical64-addendum.md/json`. Các đoạn physical pending bên dưới phản ánh đúng thời điểm ghi receipt gốc, không phải trạng thái máy mới nhất. Không đánh dấu toàn bộ notebook More hoặc toàn bộ QA là đạt.

Ngày 28/10/2026, giờ Chicago. Receipt: `5d197e2f-983c-4f85-a152-d1fb227bc4e7`.

Web `reylumi.com` đã chuyển từ 7z sang `dpl_JB1hWgQ7GyqjL4PwxnnMdZ3CsTTY`. iOS **1.0.0 (64)** đã được Apple xử lý và có trong cả **Reylumi Internal** lẫn **Reylumi support**. Đây là TestFlight; không có thao tác nộp hoặc phát hành App Store.

Nguồn sản phẩm cố định: `509985dec00091f285c28b7dcb079460da104249`, nhánh `codex/combined-five-prep-20261028`. Native lấy đúng bản đã upload 63 làm nền; web giữ nguyên các phần không liên quan của bản live 7z. History và phần bỏ panel Payroll của native 63 được bảo toàn.

| Phạm vi đã lên | Kết quả |
|---|---|
| Payroll | Bỏ thông báo và mục chứng từ theo yêu cầu. Đã xác nhận trên phiên Owner tải mới. Không đổi tính lương hoặc dữ liệu. |
| Reports overlap | Ghép cách tải Overview và Closing song song, giữ DTO, phép tính và quyền. Đã mở được cả hai view trên web live và Reports trong POS. Không tuyên bố đạt mục tiêu tốc độ. |
| Startup recovery | Ghép sửa stale-context lên nền 63, chỉ thử lại một lần đọc context mới; không gửi lại lệnh ghi. Test WebKit mới đã thực sự chạy và đạt. |
| Staff/Report spacing | Search và Add Staff cùng hàng ở viewport 390 px; lề 16 px; tiêu đề Reports được giữ cho trình đọc màn hình nhưng không chiếm chỗ hiển thị. |
| POS notebook | Menu mobile hoạt động qua đường điều hướng workspace hiện có, giữ ticket và trạng thái offline. Đã kiểm tra POS, Report, Ticket, Book, More và giao diện desktop. |

## Bằng chứng

- 81 kiểm tra Node tập trung đạt; 16 kiểm tra helper Apple chỉ đọc đạt.
- 12 kiểm tra browser trên component workspace/POS thực với provider dữ liệu giả lập đạt. Đây không phải 12 kiểm tra tài khoản production.
- TypeScript, lint và build production đạt; lint có một cảnh báo cũ, không có lỗi. Build tạo 459 offline assets.
- 235 kiểm tra native đạt, 0 lỗi. Có `testLostStartupResetRecoversContextWithoutReplayingCommands` đạt.
- Đối chiếu đầy đủ 3.465 file web upload và 2.691 file nguồn native; bundle và archive ký/không ký khớp, không sai hash. Hai file kiểm thử được Vercel bỏ qua theo `.vercelignore`, được giữ trong Git và bằng chứng native/test.
- 10 đường dẫn HTTP canonical trả 200; API History đúng trả 401 khi không đăng nhập. Probe ban đầu vào đường dẫn không tồn tại trả 404 được ghi riêng, không dùng làm bằng chứng phân quyền.
- 11 quan sát smoke đọc/điều hướng trên phiên Owner thật được lưu trong `live-browser-smoke.json`. Không thanh toán, lưu phiếu, tạo lịch hẹn, gộp khách, post hoặc upload thật.
- Pipeline upload: `40812613033`; workflow chỉ đọc trạng thái hai nhóm: `40814037975`. Không mời tester hoặc sửa nhóm.

## Giới hạn còn lại

**Chưa cài và chưa smoke bản 64 trên iPhone thật.** CoreDevice trước/sau lượt cuối vẫn xác minh build 62. Sau khi owner xác nhận điện thoại đang ở Owner Today, chat iPhone thử đúng một lượt có giới hạn; XCTest tiếp tục lỗi `Timed out while enabling automation mode.` trước UI, sau khoảng 62,583 giây. Không tiếp tục retry, reset hoặc đổi bảo mật. Bằng chứng tại `C:/Reylumi/kingpos-iphone-performance-20261027/artifacts/iphone-cold-release-20261028/smoke64-315`.

Bước tối thiểu để owner xem bản mới là mở TestFlight trên iPhone, cập nhật Reylumi 1.0.0 (64), rồi Open. Việc này không tự chứng minh automation đã sửa. Chỉ nghiệm thu tiếp khi xác minh đúng bản đã cài và có điều kiện điều khiển an toàn. Không chuyển nhãn bằng chứng của 62 sang 64.

Một tab đã mở trước phát hành vẫn giữ script của 7z. Một tab tải mới dùng script JB và hiển thị đúng thay đổi. Không xóa cache hoặc ticket nháp của người dùng để ép đổi phiên. Nếu tab cũ còn giao diện cũ, mở lại bằng tab mới.

Mục tiêu dưới một giây, ma trận performance và nghiệm thu toàn bộ 134 pattern không phải gate theo chỉ dẫn owner. Không tuyên bố chúng đã hoàn tất. Lỗi chữ các bước New appointment xuống dòng giữa từ từng thấy ở bản 62 được bàn giao cho lượt rà UI tiếp; chưa có xác nhận vật lý trên 64 và chưa chứng minh chặn hoàn tất booking.

## Phần không đưa vào lượt này

Market tiếp tục nhánh riêng theo yêu cầu trực tiếp của owner. Check Writer chưa đủ staging/provider/native/print acceptance; bản cập nhật mới đạt 74 kiểm tra tập trung và 18 kiểm tra PostgreSQL nhưng vẫn giữ bán đóng và trạng thái needs-integration. Customer auto-merge còn thiếu full-schema/current-baseline và nghiệm thu tự động gộp dữ liệu production. Social migration và rule WAF đổi từ challenge sang log còn chờ xác nhận hành động riêng. Chi tiết exact action, target và phân biệt việc kỹ thuật với quyết định owner ở `DEFERRED-ACTIONS.md`.

Rà lại journal sau freeze phát hiện thêm các việc trong Market và Check Writer đã tách ở trên; không có patch runtime đủ điều kiện khác bị âm thầm thêm hoặc bỏ qua. `post-freeze-delta.json` giữ từng event. Sau receipt, các phạm vi đã chọn còn **0 pending**; toàn journal còn **91 bản ghi khác** gồm lịch sử, công cụ, WIP và các phần hoãn. Không tuyên bố toàn bộ queue rỗng.

Một candidate thử ban đầu được tạo nhầm project riêng; không gán vào `reylumi.com` và không dùng làm bản phát hành. Đã ngắt Git của project thử để tránh deploy tự động, xác minh liên kết đã mất và trả local project link về KingPOS. Giữ bằng chứng, không xóa lịch sử hoặc dữ liệu để che lỗi. Candidate social + Payroll cũ cũng không được dùng thay thế.

Không chạy migration production, thay rule bảo mật, tạo credential, dùng tiền thật hoặc mở quyền mới. Chỉ một coordinator giữ khóa xuyên suốt lượt phát hành. Receipt và các ready revision đã tích hợp được sao về canonical; khóa sẽ được trả tại ranh giới hoàn tất metadata, không có lịch phát hành nền hoặc leaf release tiếp.

Nguồn và bằng chứng gốc: `C:/Reylumi-worktrees/combined-five-prep-20261028/artifacts/combined-five-prep`. Bản bàn giao canonical: `C:/Reylumi/kingpos/artifacts/combined-release-audit-20261028/combined-five-final`.
