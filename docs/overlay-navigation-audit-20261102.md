# Rà soát popup và điều hướng — 2026-11-02

Phạm vi: toàn bộ nguồn UI hiện có tại C:/Reylumi/kingpos; bản sửa cô lập tại C:/Reylumi-worktrees/overlay-navigation-audit-20261102. Không phát hành.

## Kết quả

Đã lập đồ thị import/layout cho 138 route template và phân loại 72 module ứng viên có popup/menu/portal hoặc selector liên quan. Đây là kiểm tra nguồn, không phải 138 trang đã thử bằng phiên đăng nhập. Chi tiết từng route và module: artifacts/overlay-navigation/audit-inventory.json.

Các nhóm vai trò được xét: khách, khách hàng, chủ salon, manager qua cùng bề mặt quản lý, staff, admin, Portable POS và kiosk/customer display. Quyền thực tế vẫn do các guard hiện có quyết định; không sửa guard hay cấp quyền mới.

| Vấn đề | Bản sửa |
| --- | --- |
| Observer đóng popup chỉ nằm trong layout nhóm app và theo dõi pathname | Đưa observer lên document root trong Suspense; theo dõi pathname/query, hashchange và popstate. |
| Trang được React Activity giữ lại có thể giữ trạng thái popup và mở lại khi quay về | Hook useTransientOverlay chỉ reset trạng thái hiển thị cục bộ khi rời/ẩn trang. Không chạy callback lưu, submit, thanh toán, đăng xuất hay chuyển workspace. |
| Dialog native có thể còn trong top layer khi Activity đã tháo ref | Hook useNativeDialogNavigation giữ phần tử dialog cuối cùng để đóng sau disconnect. Generation guard tránh đóng nhầm khi StrictMode kết nối lại ngay. Lỗi được tái hiện bằng browser fixture trước khi sửa. |
| Callback đóng drawer có thể đổi URL cũ hoặc hỏi bỏ draft sau khi đã chuyển trang | Bỏ việc gọi callback đóng thủ công từ modal frame dùng chung của Bookings, Salon profile/studio và Settings; reset tại owner bằng setter UI. Hook cũ theo dõi pathname của chính instance, không broadcast đóng cả dialog mới của trang đích. |
| Kết quả tải lịch sử trả về muộn có thể gọi showModal sau khi đã rời trang | Thêm request epoch trước khi mở HistoryLinkControl. |
| Link tên/logo salon thiếu đóng preview trực tiếp | Bao gồm bản sửa từ task Explore trước: đóng trên tap thông thường, giữ modified/middle/prevented clicks. |

Các popup form không tự đóng khi query thay đổi nội bộ: mặc định hook chỉ theo dõi pathname/page hide. ContentViewer chọn theo dõi cả query/hash để nhả viewer khi điều hướng sang anchor hoặc kết quả khác. Không có listener bắt mọi click để ép điều hướng, nên link bị chặn, Ctrl/Cmd click và tác vụ mở popup con không bị coi là đã rời trang.

Giữ nguyên công cụ chat support toàn cục có draft và cảnh báo bỏ reply; chỉ đóng dropdown thông báo khi đổi trang. Giữ nguyên drawer do route/query quyết định, deep link Staff/appointment, điều kiện ban đầu của drawer Admin, session expiry và POS lock. Luồng Save post → đăng nhập được reset ở setter của owner, không gọi callback có thể xóa pending auth intent. Không sửa dữ liệu nghiệp vụ, tổng tiền, Payroll hoặc giao dịch.

## Kiểm chứng

- Browser fixture dùng component/hook thật, gắn nhãn 8 vai trò: pathname, query, hash, Back/Forward, cache Activity, native top layer, khóa cuộn, draft không liên quan, link bị chặn, popup lồng nhau, dialog mới của trang đích và StrictMode.
- Browser regression ContentViewer với 8 kích thước: 320×568, 390×844, 430×932, 667×375, 844×390, 932×430, 390×360, 1280×800; thử cả có/không có script AppViewport.js. Thanh điều hướng và thao tác cuối popup vẫn chạm được. Đây không phải WebKit/iPhone thật.
- Runtime test trên HistoryLinkControl thật: response muộn sau navigation không mở dialog.
- Test popover hiện có: click ngoài, chuyển menu, chọn link, Escape, focus; accordion thường được giữ nguyên.
- TypeScript source check dùng import graph hiện tại của canonical, overlay đúng các file sửa, bỏ generated Next route-cache declarations: 0 diagnostic ở baseline và overlay.
- ESLint so sánh trước/sau: không phát sinh diagnostic mới. Các lỗi cũ ngoài phạm vi không bị đưa vào patch.

## Giới hạn và tích hợp

Chưa thử trực tiếp từng route bằng các tài khoản/permission thật; chưa thử iPhone/WebKit, kiosk vật lý hay native binary. Chưa chạy production build trên source release đã ghép. Không deploy, không build/upload iOS, không migration, không giao dịch/provider test.

Bản sửa chỉ thay web/React và giữ nguyên hợp đồng bridge; không đổi Swift hoặc native JS đóng gói. Coordinator vẫn phải đối chiếu bản native đang phát hành để xác định ứng dụng đó dùng hosted source hay cần tạo lại bundle.

Chỉ áp dụng artifacts/overlay-navigation/product.patch lên baseline release mới, sau khi đối chiếu hashes-before. Không copy nguyên file từ worktree vì các file được lấy từ canonical đang có các thay đổi chưa phát hành khác. Bản sửa này đã bao gồm handler identity của changeId explore-salon-preview-dismiss-20261102; không áp dụng hai lần.

Frozen source, hashes, kiểm tra và patch được ghi trong nhật ký release với trạng thái needs-integration. Phải build nguồn đã ghép và thử các phiên vai trò thật trước khi tuyên bố nghiệm thu toàn bộ ứng dụng.
