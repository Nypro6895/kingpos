# QA bổ sung sau phát hành iOS 64

Receipt gốc 5d197e2f-983c-4f85-a152-d1fb227bc4e7 giữ nguyên theo thời điểm ghi. Sau đó owner cập nhật và mở app; đã xác minh máy chạy 1.0.0 (64). Automation đã hoạt động sau điều kiện mới, nguyên nhân các timeout trước vẫn chưa được xác định.

Có 16 ca đọc/điều hướng được quan sát đạt: cold start, Book mở/đóng không lưu, Payroll, Reports hai view, Staff, notebook chuyển tab/Settings, History Details và mở lại, Staff Today/My Pay. Chuyển Personal, Staff, Owner thành công và kết thúc ở Owner Today. Không dùng số tiền của bản cũ làm kỳ vọng vì dữ liệu live đã đổi.

**Có lỗi chức năng chưa sửa trên bản đang phát hành:** Exit POS và View all settings trong More popup không điều hướng dù nhìn thấy và hittable. Tab Settings của notebook là positive control đã điều hướng được. Ảnh More đã được root xem trực tiếp, cả hai link nằm trong viewport. Vì vậy không đánh dấu toàn bộ More hoặc toàn bộ QA là đạt.

Root đã tái hiện lỗi nhân quả trên component thật. React portal vẫn truyền pointer/click lên nav; nav chặn link popup. Bản sửa tối thiểu chỉ thay một file để bỏ qua gesture/click/focus từ popup. Trước sửa test thất bại; sau sửa 14 kiểm tra browser, lint, TypeScript và build production đạt. Commit chuẩn bị: a7eeaa2b20dd9af39399e1fa15a34206983125fb; event 953f5a12-69a8-4051-90f3-ebcca2e482d8 ở trạng thái needs-integration.

**Bản sửa chưa deploy hoặc build native mới.** Giữ theo chỉ dẫn một lượt gộp và không phát hành lẻ tiếp; lần phát hành phối hợp tiếp phải dùng native64 và web JB làm nền, chỉ ghép delta này, chạy native/archive/provenance và kiểm tra lại link popup trên đúng bản mới. Không lấy 235 test của source509985d để gắn nhãn bản sửa đã đạt native.

Gói evidence: C:/Reylumi/kingpos-iphone-performance-20261027/artifacts/iphone-cold-release-20261028/functional64-316-checkpoint.zip. SHA-256 18b56bde2d39489f1118657a9cabd9b679a71351143c0743ea814f94c8a6d80f. Dữ liệu chi tiết nằm trong physical64-addendum.json và checkpoint-manifest.json của gói. Các lượt harness chọn sai hàng được giữ riêng như lỗi thao tác, không tính là lỗi app. Không trộn bằng chứng62. Nonzero draft, đối chiếu resume đầy đủ, broad134 và performance không được tuyên bố đã nghiệm thu.
