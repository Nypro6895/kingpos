# iOS Store: bước tiếp theo, 18/11/2026

Đây là bản chuẩn bị nghiệm thu từ source local `8a9d933`, không phải hồ sơ đã nộp Apple. Không push, deploy, upload native, sửa metadata Apple, tạo tài khoản demo hoặc gọi provider trong lượt này. Giữ yêu cầu rà soát mọi thay đổi và tích hợp một lần chung trước final push.

## Kết quả mới cần đưa vào candidate cuối

1. **Sửa bản khai Privacy nháp theo dữ liệu thật trong source.** Truy vấn tìm kiếm và tọa độ GPS được lưu trong search sessions; không còn đủ cơ sở để gọi đây chỉ là endpoint chưa biết có lưu hay không. Beauty follows là social graph cần đối chiếu mục Contacts của Apple. OpenAI là bên nhận ảnh khi người dùng đồng ý và cấu hình thực sự được bật. Chi tiết, hash và giới hạn runtime ở [bản khai cập nhật](ios-store-declarations-next-20261118.md).
2. **Tách các đường thanh toán.** Market mua tiện ích, mua credit và auto-topup ngoài phiên là những đường khác nhau. App hiển thị sponsored ads trong Explore, nên không thể dùng riêng lý do “B2B”, “app miễn phí” hoặc “ads manager” để kết luận được miễn mọi yêu cầu thanh toán. Phạm vi USA vẫn phải đối chiếu storefront/availability thật. Ad reporting và thông tin nhắm mục tiêu cần được xử lý trước khi final candidate có các quảng cáo đó. [Commerce và reviewer notes](ios-commerce-store-next-20261118.md).
3. **Ẩn bài khác với gỡ ảnh gốc.** Ảnh được giữ làm bằng chứng trong review case hiện chưa được queue xóa public origin. Không đặt bản sao nội bộ vào support attachments vốn có thể được trả cho người báo cáo hoặc guest được cấp quyền. Cần private evidence riêng, quyền operator theo case và quyết định gỡ/khôi phục có audit. [Thiết kế quyền và bằng chứng](ios-rights-operations-next-20261118.md).

Apple đã thêm câu hỏi Social Media vào questionnaire năm 2026. Với social feed hiện có, cần khai đúng khả năng này; Apple nêu rating tối thiểu 13+ cho app có social media. Đây là rating Store, không phải tự thêm tuổi tối thiểu vào Terms; câu trả lời khác có thể làm rating cao hơn. Tùy chọn social media disabled under 13 chỉ được chọn khi có cơ chế tương ứng, gồm Declared Age Range API tối thiểu. [Apple WWDC26 App Store guide](https://developer.apple.com/wwdc26/guides/app-store/).

Các kết luận trên là audit source và bản sửa hồ sơ nháp. Lượt này chưa thêm checkbox, nút admin hoặc thay đổi cách thu thập dữ liệu/thanh toán.

## Native và Apple đã đọc mới

Scan 19 file native first-party thấy hai nhóm required-reason API là UserDefaults và SystemBootTime; manifest hiện có cả hai và `ios/project.yml` khai báo manifest trong resources. Review giới hạn thấy app-local launch/generation preferences và elapsed in-app timings. Không sửa manifest hoặc thêm reason theo suy đoán.

Đây là heuristic source inventory, không bao phủ SDK/binary hoặc chứng minh reason của toàn archive đúng. Apple yêu cầu khai reason phản ánh đúng cách dùng API, gồm dữ liệu phát sinh từ API; xem [required-reason policy](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api). Final archive vẫn cần kiểm PrivacyInfo được đóng gói, aggregate Privacy Report, SDK, encryption classification và cấu hình ký thật.

App Store Connect vừa đọc qua Chrome trả trang đăng nhập `authResult=FAILED`. Process không có đủ bốn trường cấu hình cho Apple read-only API. Vì vậy không có build/version/age/Privacy labels mới nào được xác minh; không lấy số build trong snapshot cũ làm số upload tiếp theo. Không gọi helper có thể tạo tester/group hoặc sửa metadata để kiểm tra trạng thái.

Evidence: [native inventory](../artifacts/ios-store-next-20261118/native-source-privacy-inventory.json), [Apple/native readback](../artifacts/ios-store-next-20261118/native-apple-readback.json).

## Thứ tự thực hiện đã cụ thể hóa

| Thứ tự | Việc tiếp theo | Điều kiện đóng |
| --- | --- | --- |
| 1 | Duyệt admin r2 và thông báo/checkbox OpenAI theo yêu cầu minh họa trước của owner | Owner chọn đúng phiên bản giao diện đã được minh họa |
| 2 | Triển khai phần UI được duyệt và hoàn tất secure key flow | End-user permission trước mọi chuyển ảnh; native destination confirmation thật sự approved trước create/write key |
| 3 | Kiểm thử OpenAI bằng ảnh benign tổng hợp, allow/reject/error/retry và thời gian xử lý | Key hợp lệ, không dùng ảnh payroll/tax/support hoặc dữ liệu khách; không dùng mocks làm API acceptance |
| 4 | Hoàn thiện private-evidence/public-origin removal và sponsored-ad controls | Phạm vi/retention/quyết định gỡ đã rõ; source, quyền, recovery và shared refs được nghiệm thu |
| 5 | Lấy authenticated deployment/source/applied-environment và đọc provider metadata tối thiểu | Exact live baseline và binding đủ bằng chứng; không tự tạo receipt “verified” hoặc bulk-pull secrets |
| 6 | Đóng support, retention/rights và commercial disclosure còn thiếu | Mailbox/queue có người vận hành, deadline/appeal/refund khớp nghiệp vụ thật; không suy từ DNS hoặc vendor defaults |
| 7 | Refresh toàn bộ pending inventory, ghép frozen source, chạy required checks và push chung | Không lẫn blocked/working code; giữ mọi tính năng đã ship từ exact production baseline |
| 8 | Archive, kiểm thiết bị, chốt hồ sơ Apple và Submit | Readback Apple mới, demo access/screenshot đúng binary, Privacy/age/content rights/payment declarations đúng candidate |

Các câu hỏi UI/key đang được gửi trong chat. Chưa có phản hồi thì giữ việc phụ thuộc ở pending; vẫn hoàn thành các audit độc lập trong báo cáo này. Tool lưu key trước đó trả not-approved hai lần; lượt này không tự retry hoặc bypass. Không tự đặt một tuổi tối thiểu chung, chọn tracking No, cash-refund rule hoặc thời hạn private-evidence để điền đủ hồ sơ.

## Nghiệm thu iPhone/iPad và reviewer access

Đã chuẩn bị [sáu tình huống nghiệm thu](../artifacts/ios-store-next-20261118/reviewer-acceptance-draft.json): photo permission, account/salon scope, report/rights, financial permissions, export/deletion và commerce/ads. Mỗi tình huống có hành động và tiêu chí đạt; tất cả physical results còn pending. Không tạo demo account hoặc lưu credentials trong artifact.

Chuẩn bị role demo personal/owner/staff bằng dữ liệu giả trên môi trường được chọn và đã cấp quyền. Không đưa tài liệu lương, thuế, ngân hàng hay khách thật vào tài khoản reviewer. Kiểm lại Support URL/public recovery và thông tin người liên hệ khi có Apple session. Chỉ nhập credential qua đường bảo mật phù hợp, không chat/journal/report.

Lượt này chỉ thêm tài liệu và read-only evidence, nên không chạy lại app build. Kết quả build/render trước là evidence có timestamp của lượt trước, không phải kết quả build mới hoặc physical acceptance.
