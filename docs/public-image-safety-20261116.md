# Ảnh bài đăng: xem trước ngay, kiểm tra trước khi công khai

Ngày 16/11/2026. Chủ app đã duyệt luồng tự động, không duyệt admin trước từng bài. Bản này thay lựa chọn duyệt ảnh thủ công trong `ios-store-moderation-proposal-20261116.md`.

## Trạng thái phát hành

Đây là thay đổi local, chưa deploy, chưa thay database hosted, chưa upload native hoặc gửi App Store. **Cập nhật 18/11: chủ app đã chọn OpenAI, tự tạo/lưu key riêng ngoài Git; adapter đã qua một probe ảnh tổng hợp thật và checkbox đồng ý gửi ảnh đã được duyệt/triển khai.** Xem [provider acceptance](openai-photo-live-acceptance-20261118.md), [consent/admin UI acceptance](ios-approved-ui-implementation-20261118.md) và [đợt hoàn thiện hiện tại](ios-store-completion-20261118.md). Lý do blocked cũ về lựa chọn provider/key/UI đã được giải quyết; source vẫn cần tích hợp, cấu hình hosted, đánh giá vận hành và kiểm thử binary/thiết bị cuối. Probe riêng lẻ không chứng minh độ chính xác hoặc tốc độ cho mọi ảnh. Khi thiếu verifier, server vẫn giữ ảnh riêng và từ chối công khai.

## Luồng đã triển khai

- Beauty hiển thị ảnh cục bộ ngay khi chọn; cả xử lý và tải được giới hạn hai ảnh đồng thời, giữ thứ tự chọn. Salon giữ composer một ảnh hiện có. Bản xem trước không chứng minh đã tải hoặc đăng thành công.
- Bấm Post tạo thẻ đang đăng chỉ trong state của tác giả. Không chèn nó vào danh sách public, không phát sự kiện published trước xác nhận server. Trạng thái kiểm tra/lưu được diễn đạt chung vì server action không cung cấp tiến độ theo từng bước.
- Bytes mới vào bucket private `public-image-quarantine`; session có đường tải vật lý và `objectPath` cuối riêng. Server vẫn nhận đường có prefix do client cũ gửi, rồi kiểm tra lại chủ sở hữu và mục đích.
- Chỉ bytes WebP tĩnh cuối cùng đã chuẩn hóa, bỏ metadata và có kết quả kiểm tra hợp lệ mới được service upload sang bucket public. Hash SHA256, Storage object id/version/eTag, mục đích và salon được ghim trong manifest. Không phê duyệt dựa riêng vào thumbnail do client gửi.
- Database chặn attach/publish ảnh chưa đạt; client không được sửa/xóa/tạo lại public post bytes. Storage signed-upload bearer cũ phải bị chặn theo operation thực, kể cả khi provider thực thi bằng service context. Cover/avatar là luồng riêng và không được gắn vào bài mới để vượt gate.
- Beauty có RPC tạo một lần với raw intent bất biến. Salon social composer ghi bài nháp, asset, hashtag, booking config và chuyển published trong cùng transaction. Replay không khôi phục bài bị gỡ, archived hoặc safety hold.
- Trước khi gọi create, browser lưu receipt nhỏ trong sessionStorage theo tác giả/profile hoặc salon. Chỉ chứa requestId và input/path, không chứa File, Blob, URL preview, token hoặc credential. Lỗi chưa biết kết quả giữ nguyên request để kiểm tra/thử lại; reload phục hồi receipt đó. Storage hỏng/không ghi được sẽ ngăn gửi create mới.
- Từ chối xác định giữ bản nháp có thể sửa. Lỗi mạng sau gửi giữ nguyên payload/ảnh/mã yêu cầu. Cleanup của composer chỉ xóa vùng chờ riêng; không gỡ ảnh của một bài có thể đã đăng thành công.
- Nguồn private được dọn sau approval theo khả năng; phần bỏ dở có thời hạn bảy ngày và đi qua maintenance hiện có với retry. Không thêm cron. Đây là thời hạn vùng chờ mới, không phải cam kết xóa mọi bản sao hoặc dữ liệu nghiệp vụ trong bảy ngày.

## Phạm vi và giới hạn

Áp dụng ảnh của bài Beauty thường/before-after và bài Salon Looks/Updates/openings. Không đưa payroll, tax, POS, receipt, hồ sơ khách, support riêng hoặc export vào pipeline này. Không thay báo cáo/chặn người dùng, quyền quản trị, quy tắc spam monitor-only, hay quyết định giữ nội dung đã có.

Avatar, cover, logo, ảnh staff/review, nội dung Forum và kiểm tra văn bản cần kiểm kê/lọc riêng trước khi đánh dấu toàn bộ UGC sẵn sàng cho App Store. Kết quả an toàn ảnh không xác nhận quyền tác giả, quyền hình ảnh, sự đồng ý của người trong ảnh hoặc tính hợp pháp của mọi dữ liệu cá nhân có thể xuất hiện trong ảnh. Các cơ chế report, support, gỡ và khiếu nại vẫn cần vận hành.

Chưa có số đo latency của nhà cung cấp hoặc iPhone thật. Kiểm thử fixture/Chromium, SQL và Storage cô lập chỉ chứng minh các luồng đã kiểm tra; không chứng minh Apple chấp thuận hoặc nội dung nào cũng được nhận diện đúng.

## Kiểm chứng local

- 64 kiểm tra tập trung đạt, không skip: component Beauty/Salon với transport giả lập, receipt qua reload, giới hạn concurrency, cleanup/retry, RLS/PGlite và export maintenance liên quan.
- Production build, TypeScript và offline asset generation đạt trên bản sao đúng runtime source với bộ dependencies riêng đã có. Scoped ESLint và kiểm tra whitespace có tính CRLF đạt. Không sửa dependency dùng chung của chat khác.
- Ảnh chụp 390×844 và 820×1180 dùng component/dialog/CSS thật, ảnh tổng hợp và transport fixture; không tràn ngang, nút Retry cao 44px. Không phải Safari/native/thiết bị thật.
- Kiểm chứng 433 migration với Storage/PostgreSQL/Auth thật đã đạt: upload riêng, ký URL bị chặn, token upload cũ bị chặn, approval ghim đúng bytes, Beauty/Salon tạo một lần, rollback khi hold/config sai, expiry chỉ xóa nguồn private và tác vụ trễ không tạo lại ảnh sau xóa tài khoản. Fixture không mạng ngoài, không publish host ports, không credential/data production; bốn container của lượt chạy đã được dọn. Receipt chi tiết nằm dưới `artifacts/public-image-safety-20261116/` và ghi đúng hash migration được bàn giao.
- Live Preview không chạy khi kiểm tra; không tự mở viewer hoặc thay nó bằng trang mock. Không có server của chat khác bị sửa/dừng.

## Điều kiện trước khi phát hành

1. Chốt nhà cung cấp, tài khoản/key, chính sách xử lý/giữ dữ liệu và thông tin Privacy tương ứng. Chỉ gửi bytes ảnh chia sẻ cần kiểm tra; không gửi metadata tài khoản hoặc dữ liệu nghiệp vụ không cần thiết.
2. Nối verifier thật, xác định model/chính sách, timeout, tiêu chí chặn và lỗi; chạy bộ ảnh kiểm chứng phù hợp có quyền sử dụng, cả nhầm lẫn và nhiều ảnh. Không dùng fixture verifier để kích hoạt public.
3. Ghép source lên đúng live baseline, áp dụng migrations đã xác minh, giữ service credentials phía server và xác nhận maintenance hiện có hoạt động. Không đổi public buckets hiện hữu thành private để làm hỏng URL đã phát hành.
4. Kiểm thử iPhone/iPad thật: chọn/đăng nhiều ảnh, mạng yếu/ngắt kết nối, reload, đổi tài khoản/salon, quyền bị thu hồi, khiếu nại và bản native cũ. Beauty/Salon có trong `lib/app-local-route-inventory.generated.json`; trải nghiệm mới trên các trang được bundle trong app cần rebuild native bundle/binary và xác minh bản iOS mới, ngoài phần server/web.

Kiểm thử còn phát hiện lỗi COPY ownership sẵn có trong xóa tài khoản; correction độc lập nằm ở `retained-storage-ownership-20261116.md`. Checkpoint xóa danh tính không được nới chỉ để vượt qua lỗi provider.

Tài liệu đối chiếu: [Supabase public/private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage schema](https://supabase.com/docs/guides/storage/schema/design), [Apple UGC guideline 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content). Chỉ dùng Storage API để xóa blob; SQL quản lý quyền, manifest, lease/checkpoint và correction ownership đã giới hạn trong transaction COPY nói trên.
