# Bước kế tiếp cho Today — thiết kế, chưa triển khai

Nguồn đối chiếu: candidate `345c5b8ad88227477ed121e0ad54d245e54cfe3e`. **Ưu tiên đo trên iPhone thật sau bản Auth; chưa chọn một cuộc thay đổi kiến trúc lớn.** Giữ mọi kiểm tra Auth, scope, quyền từng phần và điều kiện nghiệp vụ của server.

**Cách chọn:** cùng salon/ngày/quyền, đo cold mở app, quay lại, foreground và mạng yếu; ghi P50/P95 thời điểm shell/từng phần xuất hiện, Auth/backend logical reads, số request, byte, cache hit/miss và lượt bị hủy. Chưa có benchmark iPhone nên chưa hứa số giây. Bằng chứng hiện có chỉ xác nhận các loader chung bị gọi lặp; không phải số query DB hay nguyên nhân trực tiếp của lỗi iPhone.

| Phương án | Thay đổi tối thiểu | Giới hạn/rủi ro |
|---|---|---|
| **A — ưu tiên đánh giá trước:** shared Today reference/bootstrap | Tách DTO clock, hours, Staff base khỏi DTO tổng; các phase worker dùng chung reference đã được server xác thực, còn UI tiếp tục hiện từng phần | Mỗi API vẫn tự kiểm tra Auth/quyền. Không mặc định loại bỏ84 lời gọi Auth nêu trong audit tài chính; phải đo riêng. Cache RAM không bảo đảm chia sẻ giữa các instance Vercel |
| **B — chỉ xét sau nếu P95 cho thấy fan-out/Auth chi phối:** một lượt đọc progressive | Một request sở hữu clock/hours/Staff promises; gửi shell và từng phase ngay khi xong | Cần streaming/parser/bridge native thực sự, giới hạn byte/frame và tương thích app cũ. Native hiện chờ body hoàn chỉnh; gộp JSON rồi chờ đủ dữ liệu không đạt yêu cầu |

**Hợp đồng A cụ thể:** thêm `TodayReference` gồm `referenceId`, scope/salon, ngày chọn/ngày kinh doanh hiện hành, timezone/settings revision, permission revision, projection và `validUntil`. Chỉ chứa trường Staff base theo allowlist; không chứa context/Auth result, token, earnings hoặc tips. Clock của shell có thể seed cùng client reference. Hours và Staff reference tải độc lập; không làm shell/Bookings/Waiting chờ toàn bộ reference. Financial worker chỉ chờ dữ liệu nền thật sự cần cho phép tính, không chặn phần khác.

Mỗi phase API lấy context hiện hành trước, tự dựng khóa và kiểm tra quyền, rồi mới dùng reference/data cache; `referenceId` không phải quyền truy cập và client không được cung cấp row/query tùy ý. Ưu tiên reuse trong loader/response hiện có, không thêm request Auth chỉ để tải reference. Cache miss/khác revision thì đọc nguồn đúng phạm vi. Chia sẻ Promise trong một request; reuse qua API chỉ cache DTO theo khóa dưới đây. Đo hit rate trước; nếu đa instance làm cache RAM không hiệu quả, phải thiết kế cơ chế dùng chung hoặc projection phù hợp rồi duyệt riêng, không hứa loader chỉ chạy một lần.

- Khóa: `schemaVersion + scope + salon + permissionRevision + projection + selectedDate + currentDate + timezoneRevision + resource/revision`; client entity thêm `entityId`. Không chia sẻ một Staff projection với tài chính hoặc user khác.
- Expiry: không tăng freshness hiện tại ở bước đầu; `validUntil` clock theo ngày kinh doanh server, DST không cộng cứng24h. Workday/queue theo ngày, tách Staff base ít đổi; tài chính là resource riêng.
- Invalidation: Staff/service save → đúng entity/catalog; attendance → workday/Today Staff; booking/ticket/queue → đúng nhóm phụ thuộc; giờ/lịch/timezone → hours/clock. Đổi user/salon/quyền/lease → withdraw cache như hiện tại. Native chỉ lưu dữ liệu server đã xác thực; không mở quyền JS tự ghi snapshot riêng tư.
- Cùng một broker thay đổi cho web/native; khi mất realtime, foreground/quay lại vẫn GET/ETag.304 không chứng minh backend đã bỏ qua query. Không replay command hoặc POST nghiệp vụ.

**File dự kiến:** `lib/today-dashboard.ts`, thêm `lib/today-read-context.ts`/kiểu `TodayReference`; `app/api/experience/today/route.ts`, named-read adapters; `today-progressive-client.tsx`, `today-dashboard-sections.ts`; metadata/manifest nếu thêm reference argument. Entity reuse là bước riêng trong resource cache, mutation/invalidation và Owner read-model. Giữ endpoint cũ cho app đang cài. B cần thêm parser/transport Swift và web, chưa thuộc phương án A.

**Regression/điểm chấp nhận:** (1) financials bị giữ chậm nhưng shell và phần khác vẫn hiện; (2) đo và giảm loader chung thực tế, cache miss không tạo loop; (3) đổi user/salon/quyền,403/409, qua ngày/timezone/DST, frame/DTO đến muộn không ghép sai; (4) quay lại giữ DOM/draft/scroll, chỉ tải thiếu/thay đổi, mutation không kéo domain không liên quan; (5) kết quả/totals/permissions bằng luồng hiện tại; (6) kiểm chứng trên web và iPhone thật với cùng dữ liệu, không tăng timeout để che chậm. Chỉ chọn B khi số liệu chứng minh A không xử lý điểm nghẽn chính.
