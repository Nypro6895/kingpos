# Admin/users — giao diện và chức năng đã triển khai

Ngày: 2026-10-07. Đã deploy production tại https://reylumi.com (deployment dpl_CfgCdroWMAFNBNJpQ9zjVVxzxGFJ). Migration 018 đã có trên môi trường thật; migration 020 cập nhật đầy đủ các hàm và đã áp dụng, ghi nhận lịch sử. Chưa gửi email thật trong kiểm tra.

## Giao diện

Bảng mật độ cao, bộ lọc trực tiếp, checkbox và toolbar khi chọn nhiều dòng. Chọn tên, Edit, Security hoặc menu mở drawer tại trang Users. Drawer có Profile, Access, Security, Activity; chuyển user trước/sau, giữ dữ liệu khi lưu lỗi và xác nhận trước khi bỏ thay đổi chưa lưu. Trên điện thoại drawer phủ màn hình, giữ focus và đóng bằng Escape. Các nhóm hiếm dùng thu gọn; mỗi kết quả chỉ hiển thị một lần.

## Chức năng

| Nhóm | Chức năng |
| --- | --- |
| Hồ sơ | Sửa tên, điện thoại, ngôn ngữ, múi giờ; kiểm tra phiên bản tránh ghi đè; note nội bộ; thông báo in-app |
| Tạo và mời | Tạo identity với mật khẩu tạm tối thiểu 12 ký tự; mời, gửi lại, hủy lời mời chưa nhận; nhận lời mời và đặt mật khẩu |
| Danh tính | Gửi/gửi lại link đặt lại mật khẩu; đổi email, xác nhận email và reset MFA theo case đã xác minh |
| Truy cập | Suspend/restore, thu hồi một hoặc toàn bộ phiên Auth thực tế và refresh token; xóa thiết bị tin cậy khi thu hồi toàn bộ |
| Quyền | Thêm/sửa/gỡ membership business/salon; chuyển ownership; cấp, đổi, suspend/revoke platform role theo quyền admin team |
| Support | Tạo case có sẵn thông tin user; liên kết case liên quan đã tồn tại; người phụ trách, ưu tiên, trạng thái, kết quả, email khôi phục, bằng chứng; tùy chọn suspend và revoke cùng giao dịch |
| Vòng đời | Xem ảnh hưởng, bảo vệ last owner, lịch xóa 30 ngày và hủy lịch |
| Vận hành | Activity/audit, tìm/lọc/phân trang, CSV theo bộ lọc hoặc dòng đã chọn; bulk suspend/restore trả kết quả riêng từng user |

## Quy tắc thao tác

- Full access thuộc platform owner. Các vai trò khác chỉ thấy và thực hiện thao tác có permission; RPC cũng kiểm tra quyền độc lập với giao diện.
- Chặn tự khóa, tự thu hồi phiên qua công cụ admin và đổi trực tiếp membership owner. Chuyển ownership phải tạo quyền cho người nhận trước, xác minh case và ghi audit.
- Email/MFA phải dựa trên case mở đã xác minh danh tính và liên hệ khôi phục. Khi có case bị chiếm, link reset không được gửi về email chưa được xác minh độc lập.
- Không đọc hoặc gửi lại mật khẩu cũ. Link nhạy cảm chỉ đưa vào email, không lưu vào audit hoặc trả về trình duyệt admin.
- Mỗi yêu cầu danh tính có khóa chống gửi trùng. Trạng thái provider accepted khác với delivered; kết quả không rõ chặn lặp lại và có luồng platform owner ghi nhận kết quả đã kiểm tra.
- Case cùng loại đang mở không tạo trùng. Liên kết case support giữ source và cuộc hội thoại. Lưu case kiểm tra phiên bản; bằng chứng ở bucket private, kiểm tra chữ ký PDF/PNG/JPEG, giới hạn dung lượng và đường dẫn thuộc user.
- Thu hồi phiên chặn refresh; access token đã cấp có thể còn hiệu lực đến khi hết hạn.

## Kích hoạt

Chạy `supabase/migrations/202610070018_admin_users_workspace.sql` sau các migration trước đó. Migration tạo RPC, ledger, permission, trigger thu hồi phiên và bucket private `admin-user-evidence`. Máy chủ cần `SUPABASE_SERVICE_ROLE_KEY` và cấu hình support email hợp lệ. Trong Supabase Auth, cho phép redirect `/accept-invite` và `/reset-password` trên origin ứng dụng. Server Actions cho phép request 16 MB; tổng bằng chứng mỗi lần tối đa 12 MB, từng tệp tối đa 8 MB, tối đa 3 tệp/lần và 15 tệp/case.

Không gửi thử email và không thay đổi tài khoản thật trong kiểm tra. Khi RPC hoặc cấu hình chưa có, giao diện báo lỗi rõ và giữ nội dung đang nhập.

## Kiểm tra

TypeScript toàn dự án và ESLint phần thay đổi đạt. Bộ kiểm tra SQL có 7 trường hợp và runtime có 3 trường hợp: permission, xác minh, chống lặp, stale version, containment rollback, native session, owner transfer, evidence scope, liên kết support và bulk partial failure. 12 kiểm tra admin dùng chung cũng đạt.

Kiểm tra trình duyệt dùng component thực với dữ liệu giả: desktop, mobile 390px, focus, giữ dữ liệu khi lỗi, guard đổi tab, case drawer, xác nhận bulk và Escape. Ảnh kết quả ở `artifacts/admin-users-workspace/`. Production build và TypeScript đạt; kiểm tra đọc workspace/selected export dưới quyền platform owner trên DB thật đạt. Kiểm tra trình duyệt production đạt cho trang lời mời và bảo vệ các endpoint workspace/evidence/export cùng trang Users. Chưa kiểm tra mutation tài khoản thật hoặc email delivery.

## Tham khảo thiết kế

- [Carbon Data Table](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines): toolbar, hành động theo hàng và batch selection.
- [Auth0 user management](https://auth0.com/docs/manage-users/user-accounts/manage-users-using-the-management-api): quản trị danh tính bằng API và permission.
- [Auth0 dashboard roles](https://auth0.com/docs/get-started/manage-dashboard-access/add-dashboard-users): phân quyền quản trị users.