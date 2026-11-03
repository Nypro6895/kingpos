# Forum starter content: revised editorial direction

15 topics, 30 replies, 12 Vietnamese and 3 English. Each existing section has three topics. All earlier starter discussions are replaced through a new immutable content migration. The earlier schema migration remains unchanged.

## Editorial sources

Public discussions were consulted for recurring concerns, not copied or attributed to the new personas:
- https://www.nailsmag.com/articles/9-client-bad-habits-and-how-to-handle-them
- https://www.reddit.com/r/Nailtechs/comments/18pdsyv/client_advice/

Private Facebook group posts were not accessible and are not claimed as reviewed. No names, photographs or quotations from source members were reused.

## Topics

1. [Salon operations; vi] Đang chờ turn thì khách request quay lại, tính lượt sao cho đỡ mất lòng?
2. [Salon operations; vi] Khách nói chỉ sơn một màu, ngồi xuống lại đưa hình design — báo giá lúc nào?
3. [Salon operations; en] A regular is 20 minutes late and still wants the full design. What do you say?
4. [Team & hiring; vi] Thợ mới vào tiệm, làm chậm một chút là bị giục — vượt qua giai đoạn này sao?
5. [Team & hiring; vi] Một người làm tay, một người làm chân, khách để tip chung thì chia thế nào?
6. [Team & hiring; en] Starting at a new salon: what do you ask before your first shift?
7. [Marketing; vi] Khách khen bộ nails mà ngại xin review, mọi người mở lời thế nào?
8. [Marketing; vi] Khách quen lâu rồi không thấy quay lại, có nên nhắn hỏi thăm không?
9. [Marketing; en] An unhappy review mentions a tech by name. Should the owner reply?
10. [Reylumi Q&A; vi] Khách đang làm chân muốn làm thêm tay với thợ khác, nhập Reylumi sao?
11. [Reylumi Q&A; vi] Cuối kỳ muốn tự coi tiền dịch vụ và tip của mình trên Reylumi thì vào đâu?
12. [Reylumi Q&A; vi] Nhập xong dịch vụ mới thấy chọn nhầm tên thợ, chưa thu tiền thì sửa sao?
13. [Owner lounge; vi] Có ai ngồi ở tiệm cả ngày mà bữa cơm cứ ăn được hai miếng lại có khách?
14. [Owner lounge; vi] Khách muốn nói chuyện suốt mà tiếng Anh mình chưa lanh, làm sao đỡ ngại?
15. [Owner lounge; vi] Tan ca về rồi mà vẫn nghĩ tới câu nói khó nghe của khách, ai cũng vậy không?

## Reylumi verification

POS add line and per-line staff selection were checked in app/pos/owner-pos-client.tsx. Staff My Work / My Pay and period navigation were checked in app/staff/my-work/staff-my-work-view.tsx. No unverified ticket-group payment, SMS automation or completed-ticket editing is promised.

## Production status

NOT applied to production. Chrome SQL Editor control still fails with the same timeoutMs error; reconnecting previously did not resolve it. Neither the old nor the revised starter content is claimed live. The existing published forum UI remains unchanged.

Apply both 20261103190000 and 20261103200000 migrations in one transaction so no rejected filler posts become visible between migrations. The combined script is artifacts/forum-content-v2/production-apply.sql. Verify 15 topics, 30 replies, section counts and new titles before publication is recorded. Updates match only the known editorial UUIDs and preserve real owner content and moderation decisions.

Validation: 17 PostgreSQL/content tests passed; all 11 existing browser checks passed with the revised content, including the 44px header and mobile screenshots. No new application build is needed for a content-only SQL revision.
