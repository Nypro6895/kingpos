# Lượt phát hành chung đã xác minh — 29/10/2026

Web live: https://reylumi.com — deployment `dpl_Gv64Dt919UZ5Pf76BwSerpqTqpAj`.
Nguồn web: `8ede4591f6ad77b7ec072e4a14cb40f33db1072f`; 3.488 file khớp, không thừa/khác.
Nguồn native: `f4e6104fab5ecf2468b7ff624f5e9da9673cdd6b` — TestFlight 1.0.0 (65), Apple VALID, cả hai nhóm hiện có. iPhone đã cài65.
Commit bàn giao nhật ký: `a8ef80f`, branch `codex/combined-security-web-20261029`; commit này chỉ thêm hồ sơ, không phải nguồn binary/web đang chạy.

Đã gồm: bố cục POS iPhone/iPad (+ Add/Reset trên, Services ✎ dưới), điều hướng thiết bị/More, Payroll Staff/rail kỳ lương/biểu đồ, và security social advisory đã được chủ project xác nhận. Windows compact giữ bố cục64. Security chỉ thay server/admin tương thích nên không mở pipeline native thứ hai.

Migration `20261029021000` đã áp dụng bằng wrapper có guard7fingerprint và ledger nguyên tử; đọc lại đúng nguồn, RPC chỉ service_role, automatic notice0. WAF đúng GET `/security-check` chuyển challenge→log, active version2; firewall/điều kiện/quy tắc khác giữ nguyên. Không giao dịch, gộp/xóa khách, đăng bài hoặc cấp quyền mới.

Kiểm tra:235 native tests0fail;28 security SQL/runtime +35 identity/comment; build459assets; finite browser fixtures và authenticated live Payroll/POS Exit/Settings đạt. API customer.history không đăng nhập trả401. Admin preview chưa nghiệm thu vì phiên hiện tại chỉ là Owner; route admin yêu cầu đăng nhập lại, không đổi tài khoản/quyền để vượt qua.

Receipt bất biến: `9adc36dd-2d40-4bba-bad9-b46cbb041828`. Cả10 exact event đã ghi phát hành đúng kênh; selected còn0, global queue90 vẫn giữ lịch sử/task chưa đủ điều kiện. Lock coordinator đã trả05:35:14UTC; không còn pipeline của root đang chạy. Không promote candidate POS-only42Vk hoặc social cũDRx.

QA vật lý65: đã cài qua TestFlight và mở Owner; XCTest từng báo app không chạy khi đang kiểm tra More. Chưa kết luận crash, không ghi các ca POS/Payroll chưa chạy là pass. Chat iPhone đang một lượt recovery hữu hạn, không đo deep performance. Kết quả tiếp theo ghi checkpoint riêng, không sửa receipt cũ.

Còn ngoài lượt này: Market theo nhánh riêng; Check Writer còn provider/staging/native/in máy thật; automatic customer merge còn acceptance schema/data và quyền thao tác dữ liệu riêng; New Appointment wordwrap là lỗi cosmetic64 chưa có patch hoàn tất. Không gọi TestFlight là App Store.
