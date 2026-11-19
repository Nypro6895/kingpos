# Reylumi iOS — triển khai bước 3, 4 và 2, ngày18/11/2026

**Đã triển khai và kiểm tra source local; chưa push, deploy, chạy migration hosted, upload native hoặc gửi Apple.** Toàn bộ phần này phải được tích hợp trong một đợt final cùng các thay đổi đã hoàn tất khác. Không dùng nguyên nhánh hiện tại làm release vì còn các feature bị chặn.

## Bước3 — Privacy, Terms và dữ liệu riêng

Candidate `lib/legal-policies.ts` bổ sung nguồn dữ liệu gián tiếp từ salon/employer/professional; phân biệt bank routing/account được server có quyền giải mã với card nhập ở provider; làm rõ dữ liệu payroll/tax/SSN/EIN, browser/security identifiers, dữ liệu lưu trên thiết bị, request recovery và diagnostic share. Hosted account và salon exports dùng chung controls7ngày, link mới tối đa15phút và capped bởi expiry; không coi expiry là xóa bytes hoặc tự thu hồi legacy/downloaded/printed copies.

Terms assent không thay cho privacy consent. Retained business/support records vẫn có thể nhận diện người; pending period trong app không kéo dài deadline pháp luật. Giữ quyền UGC/license giới hạn và nghĩa vụ riêng của Reylumi, không đưa mọi rủi ro xử lý/tính toán/security cho người nhập. Không thêm giá/hoàn tiền/cap/arbitration/DMCA safe-harbor hoặc một tuổi tối thiểu chung chưa được chốt.

Sau khi chủ app chọn OpenAI, source addendum nêu bên nhận, mục đích kiểm tra ảnh bài Beauty/Salon, khả năng pixels chứa thông tin cá nhân và yêu cầu sự đồng ý riêng. Không đưa captions hoặc luồng upload riêng payroll/tax/bank/Support vào adapter này. Candidate cũng giải thích ảnh có thể được dùng ở cover, booking hoặc shared media: xóa một bài chưa đồng nghĩa xóa mọi nơi dùng hoặc raw/cache copy; quyền yêu cầu review/removal vẫn được giữ.

Giữ routes/section IDs/metadata/ngày cũ trong bản draft. Phải review ngày/version/chấp thuận/thông báo tại thời điểm công bố, không coi nội dung mới đã có hiệu lực từ tháng10. [Legal implementation và nguồn nghiên cứu](ios-privacy-implementation-20261118.md); [addendum OpenAI](openai-photo-consented-wiring-20261118.md).

## Bước4 — Market và credit quảng cáo

Đã sửa hai lỗi có bằng chứng:

1. Market return không còn báo kiểm tra hoàn tất khi đối soát provider thất bại. Vẫn xử lý các purchase khác độc lập, dựa trên salon hiện tại và saved-purchase/provider authority; URL quay về không cấp entitlement.
2. Ad-credit expiry không bỏ qua lỗi ghi database. Webhook phải giữ retry khi chưa ghi nhận được kết quả, thay vì nhận là đã xử lý.

Acceptance bao gồm checkout/return, giá/tax/fees, portal/cancellation, credit fulfillment/cancel/card setup/refund-event và auto-topup theo phạm vi suite đã ghi. Ba browser fixtures được sửa đúng transport boundary; giữ scoped hook/context và UI assertions. **123/123 tests pass**, không charge, đổi giá/cờ, cấp credit thật hoặc gọi provider. [Báo cáo commerce](ios-commerce-implementation-20261118.md).

Chưa kết luận actual catalog, enabled/live-test hoặc deployed provider từ default source. Campaign unused-credit return là trả về balance, không phải cash refund về thẻ. Cash-refund policy/UI và vận hành provider vẫn cần xác định; không tự tạo refund/debit rule.

## Bước2 — lọc ảnh, report/block và gỡ nội dung

- Sửa public-comment helpers để bài `safety_hold` không lộ bình luận; block qua post ID không còn thành đường dò tác giả của bài riêng tư/đã xóa. Full Supabase cô lập434migrations và5/5 tests đạt, cùng36/36 kiểm tra liên quan. [Moderation operations](ios-moderation-operations-20261118.md).
- Có adapter thật cho OpenAI Moderations, normalized still WebP, fixed endpoint, timeout/byte budget, schema/model/category validation. Explicit flag từ chối; thiếu key/lỗi/timeout/unknown giữ fail-closed. **11/11 mocked tests**, TypeScript/lint và independent review đạt. Đây không phải bằng chứng API thật hoặc classifier accuracy/latency. [Adapter](openai-public-photo-verifier-20261118.md).
- Caller Beauty/Salon được nối với permission riêng từng submission, trước khi đọc private image hoặc gọi OpenAI. Completed-request recovery vẫn đi trước admission mới, không rescan/resubmit ảnh đã xác nhận. **11/11 wiring tests** và4/4 consent-helper tests đạt. Composers hiện chưa có controls đã được duyệt; không bật chỉ bằng việc thêm key. [Wiring và giới hạn](openai-photo-consented-wiring-20261118.md).
- Thêm queue/worker dọn **ảnh mới, đã attested, không còn dùng chung**, sau explicit terminal post delete. Shared cover/booking/Market/history/other post, legacy, erasure-owned và review evidence được giữ. Fence/lease chống tái attach/recreate, checkpoint chỉ sau Storage origin thực sự absent. Full Supabase435migrations với concurrency + Storage API thật cô lập: **10/10 pass**, source/worker hashes khớp receipt. [DB](public-post-media-deletion-20261118.md), [worker](public-post-media-deletion-worker-20261118.md).
- Worker dùng cron authenticated hiện có; auth/disable gate vẫn trước mọi worker, lỗi độc lập không bỏ account erasure, response chỉ counts. **18/18 route/staging/worker tests pass**. [Cron](public-post-media-deletion-cron-20261118.md).

Chưa thêm product UI Hide/Restore cho exact text: owner yêu cầu chỉnh minh họa; [r2 gọn hơn](../artifacts/ios-moderation-operations-20261118/exact-text-controls-preview-r2-desktop.png) đang chờ duyệt. [Thông báo/checkbox OpenAI](../artifacts/public-photo-processing-consent-20261118/photo-processing-consent-preview-desktop.png) cũng là proposal. Không thêm admin duyệt thường lệ trước từng ảnh.

Luồng gỡ origin của ảnh có review case nhưng bảo toàn bằng chứng private/khôi phục hợp lệ còn là gap riêng. Queue mới không purge ảnh đó. Gỡ mọi bản dùng chung vì copyright cần quyết định chính xác; không đồng nhất Delete post/Close case với thu hồi raw URL/CDN/browser copies. General omni image moderation không chứng minh full CSAM/PII/copyright coverage; không chuyển known/suspected CSAM vào endpoint đó.

## Kiểm tra kết hợp của coordinator

Production Next build + TypeScript + offline assets **pass** ở source-r2 cô lập, dependencies khớp lockfile, không kế thừa/copy credentials production và background dispatch tắt. **5.443 source input files** khớp source hiện tại và built input, zero differences tại readback. Chromium render thật12policy route/viewport combinations390/820/1280px đạt, không horizontal overflow; OpenAI disclosure mới xuất hiện và lời hứa xóa24giờ cũ không còn trong candidate. Đây không phải Safari/native/thiết bị thật hoặc hosted acceptance.

Sau thay đổi cuối, coordinator chạy lại29tests liên quan trực tiếp policy/wiring/maintenance:29/29, zero skip. Scoped ESLint và CRLF-aware whitespace check đạt. Các suite trên có overlap nên không cộng thành một tỷ lệ app readiness.

Evidence: [build](../artifacts/ios-steps-234-20261118/combined-build-result-r2.json), [source parity](../artifacts/ios-steps-234-20261118/build-source-verification-r2.json), [render](../artifacts/ios-steps-234-20261118/legal-r2-acceptance.json).

## Các điểm chưa thể đóng bằng source hoặc mocks

1. **Key:** owner đã chọn OpenAI + new key, tênCodex/project qua secure picker. Công cụ local destination trả not-approved cả hai lần; chưa gọi create-key, chưa ghi secret. Không có API thật hoặc ảnh thật gửi OpenAI. Không tự thay project, bypass hoặc yêu cầu paste key vào chat.
2. **UI:** cần duyệt minh họa r2 và explicit AI permission controls trước khi triển khai. Backend hiện chặn new photo calls thiếu current affirmative permission; chưa có luồng user hoàn chỉnh để phát hành.
3. **Runtime:** dashboard xác nhận production assignment vẫn `dpl_F5yYNDU4nXW2epT5pozciBmPfHhv`; reveal config yêu cầu account verification và đã hủy. Chưa đọc giá trị config/provider, applied environment, full source manifest, logs/backup/retention. [Readback](../artifacts/ios-steps-234-20261118/runtime-readback.json).
4. **Support/rights:** domain MX có Hostinger, không chứng minh mailbox support tồn tại/nhận mail/được theo dõi. Không gửi email/SMS. Còn quyền yêu cầu dữ liệu/child-data/GPC nếu áp dụng, vận hành appeal/copyright/private evidence và cash refunds. [Public policy/contact](../artifacts/ios-steps-234-20261118/public-policy-contact-readback.json).
5. **Release/Store:** phải refresh toàn bộ pending inventory và exact production baseline; ghép source chung, kiểm migration hosted/provider/consent và thiết bị; rebuild native bundle/binary theo actual Apple readback; chốt policy/Privacy labels/age/content rights/reviewer metadata trước Submit. Không dùng công việc local này làm bằng chứng đã live hoặc đủ điều kiện App Store.
