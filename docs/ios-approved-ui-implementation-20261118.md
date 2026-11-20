# Checkbox OpenAI và admin r2 — triển khai đã được duyệt

Owner chọn **“Triển khai cả hai”** ngày 18/11/2026, America/Chicago. Source bắt đầu tại `40b1b6e`. Phạm vi là implementation/QA local và bàn giao cho một đợt final tổng hợp; chưa push, deploy, chạy migration hosted, upload native hoặc ghi Apple.

## Checkbox cho ảnh Beauty/Salon

Ba file sản phẩm: hai composer hiện có và shared client-only component/hook. Thông báo nêu OpenAI, ảnh đã xử lý, mục đích kiểm tra và khả năng có dữ liệu cá nhân; có link Privacy và lựa chọn mặc định chưa chọn. Chỉ khi đồng ý mới tạo đúng object provider/noticeVersion/accepted cho submission ảnh mới.

Lựa chọn nằm trong memory của đúng composer/bộ ảnh. Đổi ảnh, đổi account/salon hoặc mở submission mới yêu cầu lựa chọn lại; đổi caption đơn thuần giữ lựa chọn. Bài Salon chỉ có chữ không có checkbox/field này. Avatar, cover, payroll, Tax, Support và các upload khác nằm ngoài phạm vi.

Unknown receipt giữ nguyên request ID, bộ ảnh và payload đã gửi. Không thêm sự đồng ý vào receipt cũ. Completed lookup vẫn đi trước xử lý mới; sau khi một request thiếu permission đã được xác định là không thể xử lý mới, việc đồng ý tạo submission mới thay vì đổi raw intent dưới ID cũ. Không persist một quyền đồng ý chung trong draft/account.

[Handoff consent](public-photo-processing-consent-ui-20261118.md), [ảnh Beauty chưa chọn checkbox](../artifacts/public-photo-processing-consent-ui-20261118/beauty-visuals/beauty-consent-unchecked-phone.png).

## Admin r2 và quyết định nội dung

Màn review có nguồn/loại nội dung và trạng thái cạnh nhau, nội dung đang xét, lý do bắt buộc, một hành động chính và lịch sử thu gọn. Case handling là khối riêng; Record resolution là hành động phụ. Resolve/Close không đồng nghĩa ẩn hoặc khôi phục nội dung.

Năm canonical targets là comment, review, experience, review reply và experience reply; hai alias từ lịch sử khách được resolve về đúng reply. Backend dùng case binding, version nguồn hiện tại, quyền admin, request ID và decision history. Mỗi vụ việc giữ/release hạn chế của chính nó; hạn chế từ case khác và trạng thái private/deleted/withdrawn/parent/author tiếp tục có thẩm quyền riêng.

Overlay áp dụng cho danh sách/count/projection công khai đã kiểm kê và direct RLS; hồ sơ nghiệp vụ gốc được giữ. Các routine private/history/POS và phép tổng hợp Truth/reputation được phân loại riêng, không rewrite tự động bằng scan. Phản hồi muộn không được ghi đè trạng thái/quyền mới trên UI; retry chưa rõ kết quả giữ nguyên quyết định đang gửi.

[Handoff UI r2](admin-exact-text-r2-ui-20261118.md), [ảnh mobile đang hiện](../artifacts/admin-exact-text-r2-ui-20261118/r2-visible-390.png), [ảnh mobile đã ẩn](../artifacts/admin-exact-text-r2-ui-20261118/r2-hidden-390.png).

[Backend và kiểm chứng quyền](admin-exact-text-moderation-20261118.md) lưu danh sách function đã kiểm kê từ schema thực. Summary RPC vốn dựa vào RLS được định nghĩa lại với đầy đủ điều kiện visible/public salon/block hiện có khi chuyển sang private filtered views; không cấp client quyền đọc các view nội bộ. Các chuỗi ancestor không xác minh hết ở giới hạn hoặc có cycle bị giữ kín. Bằng chứng private-own-history không tự cấp quyền Restore.

## Kiểm chứng và nguồn

| Phần | Kết quả hiện ghi nhận |
| --- | --- |
| Consent/composer browser + recovery + compatibility | 22/22, zero skip; visual fixture được bật |
| Admin r2 browser và SQL/SSR consumer | 12/12, zero skip; ESLint đạt |
| Coordinator adapter/permission/server wiring | 26/26, zero skip, mocked transport |
| Full Next build | R4 đạt: Next, TypeScript và offline assets; R3 phát hiện null guard và được giữ làm lịch sử |
| Backend schema và mutation/security/concurrency | 7/7, zero skip; full schema 436 migrations và actual Auth/PostgREST/RLS |

R3 source đã được giữ để ghi nhận lỗi kiểm tra kiểu. UI revision 2 sửa explicit null guard và thay thế revision UI cũ bằng journal event riêng; snapshot cũ giữ nguyên. Một cập nhật fixture loader sau đó chỉ mock đúng transport mới, không đổi UI/runtime. Chỉ receipt build thành công và hash runtime cuối được dùng cho bàn giao hoàn tất.

[Build R4](../artifacts/ios-steps-234-20261118/combined-build-result-r4.json) có 5.484 source inputs; runtime files được đối chiếu với nguồn hiện tại. SQL và integration tests tiếp tục hoàn thiện sau lúc staging build, nên được xác minh riêng bằng full-schema receipt/hash, không gọi đó là zero drift cho toàn bộ input tree. [Database acceptance](../artifacts/admin-exact-text-moderation-20261118/acceptance/admin-exact-text-acceptance.json) khớp raw/executed SHA256 migration `ebe4e2970a3e0a1a99ea6eca86b59ab7fe1af516d40eb47ff151a7428b108572`.

Build source cô lập dùng dependencies đã đối chiếu lockfile, không copy/inherit `.env.local` hoặc key production và tắt background dispatch. Các browser fixtures render component thật với dữ liệu tổng hợp và transport mock, không thay product authorization. Live Preview viewer không chạy nên không mở viewer hoặc đăng ký một mock làm product preview. Chromium/source/DB fixture không phải Safari/native hoặc thiết bị thật.

Source sản phẩm trong lượt này không gửi ảnh/record người dùng cho provider và không gọi OpenAI thật. Phép kiểm tra key bằng đúng một ảnh màu tổng hợp đã có receipt riêng ở [live acceptance](openai-photo-live-acceptance-20261118.md); không đổi nó thành benchmark tốc độ upload hoặc classifier accuracy.

## Phần Store còn riêng

Sau khi implementation/QA này hoàn tất, vẫn phải ghép toàn bộ pending source từ exact production baseline và push chung. Private evidence/public-origin removal cho ảnh có review case, ad reporting/targeting/payment disclosure, runtime/provider/Support/retention và các bản khai Apple vẫn cần nghiệm thu theo [hồ sơ bước tiếp theo](ios-store-next-20261118.md).

Checkbox và admin r2 đã được owner duyệt; không hỏi lại thiết kế này. Public policy/version/Privacy labels, native bundle/archive, physical-device QA, demo/screenshot đúng binary và Apple readback vẫn thuộc đợt final. Không dùng các snapshot cũ còn ghi “chờ duyệt UI/key” làm trạng thái hiện tại của hai phần đã triển khai; giữ chúng như lịch sử.
