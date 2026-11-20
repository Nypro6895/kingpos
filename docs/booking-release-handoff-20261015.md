# Reylumi booking bàn giao triển khai

## Release candidate đã kiểm thử — 2026-10-15T19:46:52.166Z

Cập nhật này thay thế checkpoint chưa đủ build bên dưới. Full Next.js production build và TypeScript exit 0; regression 84/84; Auth/RLS 94/94 (57 privacy + 35 notification cases và 2 parent); lint 0 lỗi, 80 cảnh báo có sẵn. Không có executor trình duyệt local được hỗ trợ nên chưa chạy UI đăng nhập thật.

Production baseline dpl_9ytGDqrS31MBusy9SgnRWpvNFbzQ, commit 444ab04e0e4d291d929133e5d71346fcf6df4f6e, đã xác minh lại source dưới khóa release. Delta sản phẩm chỉ 4 file: blocked-users panel, social identity migration 20261015200000, helper và test. Booking V5, Market JSX, signup, workspace/reload và dữ liệu 9 bang đã nằm trong live và được giữ nguyên. Không đưa 464 test QA lịch sử, phone claim, Help hoặc Reward vào release.

Người dùng đã yêu cầu deploy lúc 19:13:28 UTC và xác nhận riêng migration social lúc 19:35:37 UTC ngày 2026-10-15. Chỉ thay 3 hàm và Auth trigger để email/phone đã xác minh không bị hold nhầm. Giữ nguyên ACL/RLS, quota, restriction, trạng thái tài khoản; không cập nhật hay công khai dữ liệu cũ. Không db push toàn bộ, không sửa ledger lịch sử. Rollback schema đã kiểm thử; backup physical gần nhất 08:18 UTC, PITR tắt. Không cần binary iOS mới vì delta tương thích web.

Trạng thái tại lúc đóng gói: candidate đã đủ kiểm thử, chưa tuyên bố live. Receipt hoàn tất được ghi riêng tại releases/history và artifacts/booking-social-release-20261015 sau khi xác minh migration, source và alias.


## Checkpoint deploy và phone claim — 2026-10-15T19:33:26.598Z

Người dùng đã yêu cầu deploy các sửa trong đợt này, đồng thời bảo toàn thay đổi từ các chat Codex khác. Kết luận cập nhật này thay thế các trạng thái trước đó bên dưới; chưa có production mutation, commit hoặc push trong task.

- Live vừa đọc: `dpl_9ytGDqrS31MBusy9SgnRWpvNFbzQ`, commit `444ab04e0e4d291d929133e5d71346fcf6df4f6e`. Candidate mới `TASK/booking-social-integration/candidate-current` giữ đúng 1.863 file release, gồm dữ liệu 9 bang và About sau claim. 464 test cũ chỉ được phục hồi trong môi trường QA, không thuộc delta phải commit.
- Booking V5 đã có trong release: 19 file exact, hai reader chỉ khác EOL. Market JSX đã có bản sửa riêng và được giữ. Diagnostics cũng đã có, chỉ khác EOL/thứ tự import. Delta vẫn chỉ 4 file: blocked-users panel, migration social `20261015200000`, helper và test social. Patch `candidate-against-444ab04.patch`, SHA256 `a3457ee5cd1b0d8fc0a61ee56810ca86ecb91cf030c197b3fe8fe6335f9c01de`; manifest `candidate-current-manifest.json`, source SHA256 `28e018ac9937a2b7ecaf86f1ae3bf4086308f183a94a74134b5a788dd913938c`.
- Candidate mới: regression **84/84**, lint **0 lỗi/80 cảnh báo**. Build compile thành công, nhưng dừng ở TypeScript mà không có receipt exit; process không còn. **Phải chạy lại full build trước phát hành.** Candidate cũ trên bd9fe462 có build/TypeScript pass, không dùng nó để tuyên bố candidate mới pass. Auth/RLS **94/94 nodes (57 privacy +35 notification cases)** trên 267 SQL được giữ bằng chứng vì toàn bộ migration/test/helper giống byte. UI thật chưa chạy; không có local executor được hỗ trợ.
- Đã đọc ledger target chỉ bằng metadata SELECT: 260 version; booking concurrency/access/privacy/notification, lookup index và signup retry đều có. Hai version trùng hiện map tới Vietnamese plugin và check-in plugin. Bốn version lịch sử `202610090001/0002/0003`, `202610100002` vắng ledger; chưa kết luận schema tương ứng chưa có. **Không chạy db push toàn bộ, không sửa ledger cũ.** Social `20261015200000` chưa áp dụng.
- Phạm vi security cần parent xác nhận cụ thể: chỉ social migration thay ba hàm `abuse_guard_actor`, `get_abuse_notice`, `abuse_track_identity` và trigger Auth để email/phone đã xác minh không bị hold tự động. Không grants/RLS mới, không thay quota/restriction/status, không cập nhật/unban identity, không public nội dung cũ. Hash ba định nghĩa và trigger hiện tại khớp chính xác baseline đã test.
- Rollback schema ba hàm + trigger đã thử apply/rollback và giữ dữ liệu/ACL. File `social-schema-rollback.sql`; không thực thi production. Backup physical gần nhất COMPLETED lúc **2026-10-15 08:18:29Z**, PITR tắt. Không restore cả DB cho lỗi này vì mất dữ liệu sau backup; ưu tiên forward fix hoặc rollback schema được duyệt và ghi migration mới. Chưa tạo snapshot data mới.
- Đã đọc các chat signup, dữ liệu, Explore Book, search audit, claim/workspace và reload. Dữ liệu mới, signup, reload và workspace được giữ qua source live. Search audit chưa sửa sản phẩm. Pending ngoài phạm vi còn tài liệu Explore; không tự gom vào release. Vercel Git link trỏ `Nypro6895/kingpos`, production branch `main`: coi push main có nguy cơ auto-deploy; chưa push. Khóa preflight đã trả.

Phone claim là patch riêng **working, chưa test**, không nằm trong candidate deploy. Nguyên nhân đã xác minh tại `202610050006_business_claims.sql:166`: chỉ tự duyệt khi source website mới dưới 90 ngày, phone duy nhất và không request khác; do đó một OTP đúng của directory vẫn chờ. Staging tại `TASK/phone-claim-local/source` bỏ nguồn/tuổi/số dùng chung khỏi tín hiệu tranh chấp; giữ quản lý có sẵn, account chứa nhiều salon, claimant khác đã xác minh, và quyết định admin chưa giải quyết. Request cũ bị hold tự động chỉ được retry bằng mã mới, không bulk approve. Cần chạy SQL/provider/UI-state regression và race PostgreSQL thật, review, rồi xin xác nhận production policy claim riêng. Không gọi số thật, phát sinh phí hay đổi owner production.

Bằng chứng tổng hợp: `TASK/booking-social-integration/deploy-checkpoint.json`; ledger `target-ledger-metadata.json`; backup `physical-backup-metadata.json`; rollback `social-rollback-verification.json`; phối hợp `parallel-codex-checkpoint.json`. Chốt còn lại cho release booking/social: rerun build mới, UI acceptance, xác nhận cụ thể social migration, chụp lại alias dưới khóa ngay trước publish. Quyền deploy chung đã có; không hỏi lại quyền chung.


Tài liệu này bao quát toàn bộ task từ 14–15/10/2026: chẩn đoán tạo salon, booking/concurrency/privacy/thông báo, hai sửa build/lint được duyệt và lỗi chờ duyệt post/comment của tài khoản đã xác minh. **Kết quả cuối local: full build đạt; full lint 0 lỗi, 77 cảnh báo; booking regression 40/40; migration post/comment đạt kiểm thử SQL trên cả baseline local và commit signup đã phát hành.** Chưa có commit, push hoặc deploy do task này thực hiện. Vẫn cần tích hợp với source live đúng phiên bản, kiểm thử UI và đối chiếu migration ledger trước phát hành. Các kết quả lỗi ở lượt cũ được giữ làm lịch sử.

Repository: `C:\Users\giuse\kingpos`, remote đã xác minh `Nypro6895/kingpos`, nhánh `codex/admin-dashboard-workspace`, HEAD `252612d9d522a622a6ce8d8d8041e38581bae968`. Checkout có nhiều thay đổi của người dùng và các chat khác. Không dùng toàn bộ checkout này làm nguồn release.

Thư mục bằng chứng của task, viết tắt là `TASK` dưới đây: `C:\Users\giuse\Documents\Codex\2026-10-14\task`. Các đường dẫn artifact trong tài liệu là tương đối với `TASK`, trừ các đường dẫn source trong bảng.

## Nguồn bàn giao và phạm vi đã duyệt

Nguồn booking chính thức là `booking-final-v5-source/`, manifest `booking-final-v5-manifest.json` và patch **`booking-final-v5-exact.patch`**, gồm 21 file. SHA-256 của patch: `dac0b65168b8edadeac8901413e4aec58e034608b6cbfb5edc832d717dad24bd`. Áp dụng thuận, ngược và tái dựng đủ 21 file đều khớp byte/hash khi dùng `git -c core.autocrlf=false`. V5 ghi lại ý định booking của task, nhưng không phải baseline live hiện tại. Chat signup đã tích hợp một phần booking vào release `bd9fe462`; phải đối chiếu phần đã ship và các thay đổi mới trong `lib/beauty.ts`, `lib/customer-bookings.ts` trước khi lấy phần còn thiếu. Không áp dụng nguyên patch v5 lên release mới hoặc cộng chồng các patch tổng.

`booking-final-v5.patch` là bản đóng gói trung gian chịu chuyển đổi xuống dòng của Git, không phải artifact chính thức. Các bản phase2, v2, v3, v4-wip và audit thông báo có test thất bại được giữ làm lịch sử; không phát hành chúng. Riêng migration phase2 từng dùng thứ tự khóa không phù hợp đã được thay bằng bản phase3/v5.

Chẩn đoán tạo salon là nhóm riêng gồm 4 file trong `diagnostics-source/`, hash tại `diagnostics-completion.json`. Nhóm này chưa xác minh được nguyên nhân lookup trên production và không nằm trong patch tổng booking. Cả 4 file hiện tại vẫn khớp snapshot chẩn đoán khi kiểm tra validation. Không dùng snapshot nguyên file để ghi đè các chỉnh sửa mới của chat khác; phải đối chiếu phần thay đổi của task với baseline trước sửa trong `diagnostics-edit-state.json` và các bản sao trước sửa.

Người dùng đã duyệt các sửa privacy/thông báo local, sau đó duyệt hai sửa tối thiểu ở Market và blocked-users. Hai sửa đã áp dụng và kiểm tra đạt. Tiếp theo, người dùng yêu cầu trao đổi với chat tài khoản và sửa lỗi chặn nhầm post/comment; phạm vi được thực hiện là nhận đúng trạng thái xác minh do Auth lưu. Không đổi ngưỡng, không gỡ restriction thật, không tự mở lại bài cũ. Signup/onboarding và các file vừa được chat khác phát hành được giữ nguyên.

Hai patch bổ sung có thể review riêng: `release-unblock-final.patch` (2 file, SHA-256 `2fa06a3cb51606d810c6ef8465e2a3e6b62bd635e97a1051d9397326ab9ffe37`) và `post-comment-confirmed-final.patch` (3 file mới, SHA-256 `323f26b2d8a6f03e1e61fefd3f85e3bab48a9593305f414f41be205d7a4db813`). Cả hai đã kiểm tra áp dụng thuận/ngược và tái dựng byte/hash chính xác. Tài liệu này nằm trong snapshot bàn giao, không ghép vào hai patch code. Manifest và source lần lượt ở `release-unblock-final-manifest.json`, `release-unblock-final-package/after/`, `post-comment-confirmed-final-manifest.json`, `post-comment-confirmed-final-package/after/`.

## Các file của toàn bộ task

### Chẩn đoán tạo salon

| File | Thay đổi và lý do |
| --- | --- |
| `lib/business-claim-diagnostics.ts` | Ghi nhận lỗi lookup RPC theo cách không xuất dữ liệu nhạy cảm, giúp phân biệt timeout/lỗi transport; không coi thông báo chung là nguyên nhân thực tế. |
| `app/claim/actions.ts` | Bọc điểm gọi lookup bằng chẩn đoán; giữ nguyên các thay đổi có sẵn trong file. |
| `app/salons/actions.ts` | Áp dụng cùng chẩn đoán ở đường tạo salon; không tự thay quy tắc claim/onboarding. |
| `tests/business-claim-diagnostics.test.mjs` | Sáu ca giả lập về lỗi, lọc thông tin nhạy cảm, thành công và hai call site. |

### Booking và dữ liệu lịch hẹn

| File | Thay đổi và lý do |
| --- | --- |
| `app/book/[salonId]/public-booking-client.tsx` | Sửa phạm vi cache availability và xử lý ngày/giờ theo salon để không dùng dữ liệu của lựa chọn hoặc timezone cũ. |
| `app/booking/manage/[token]/guest-manage-client.tsx` | Giữ luồng đổi lịch guest nhất quán với ngày/giờ salon và dữ liệu hiện tại. |
| `lib/customer-bookings.ts` | Đọc danh sách/chi tiết khách qua RPC chiếu dữ liệu an toàn, không đọc trực tiếp hàng chứa ghi chú nội bộ. |
| `lib/beauty.ts` | Dùng RPC tổng hợp số booking đã xác minh của đúng khách, tránh đọc bảng booking chứa dữ liệu riêng. |
| `supabase/migrations/202609230009_portable_custom_service_snapshot.sql` | Dùng `to_regprocedure` để kiểm tra helper tùy chọn, tránh ép `regprocedure` gây lỗi khi helper chưa tồn tại trong fresh replay. Giữ wrapper/core đã vá và snapshot tên dịch vụ. |
| `supabase/migrations/20261015010000_booking_concurrency_guards.sql` | Khóa theo salon và idempotency key, khóa hàng guest khi đổi lịch, giữ thứ tự rank trước schedule cho POS và kiểm tra lại contact sau khóa. Chặn booking trùng và tránh deadlock/duplicate contact đã tái hiện. |
| `supabase/migrations/20261015050000_booking_access_guards.sql` | Không cho người khác lấy lại capability của booking đã liên kết tài khoản chỉ bằng retry key. |
| `supabase/migrations/20261015163000_customer_booking_privacy.sql` | Thêm projection/aggregate RPC an toàn và helper ownership; hạn chế SELECT bảng booking/lines/customer; giữ quyền owner, staff được phân công, history và inspiration của khách. |
| `supabase/migrations/20261015173000_booking_notification_access_guards.sql` | Kiểm tra actor thực có `booking.manage` hoặc assignment đúng booking; chặn anonymous ở helper thay đổi; thu hồi quyền gọi trực tiếp helper thông báo booking mới, vẫn cho luồng tạo booking nội bộ gọi. |

### Hai sửa được duyệt để thông build/lint

| File | Thay đổi và lý do |
| --- | --- |
| `app/market/booking-deposit-panel.tsx` | Bọc đúng hai đoạn mô tả hiện có trong fragment dưới điều kiện `!settingsOnly`; không đổi nội dung, giá, checkout hay nghiệp vụ thanh toán. |
| `app/settings/blocked-users-panel.tsx` | Cập nhật state trong callback sau khi tải xong; chuyển xóa lỗi sang nút thử lại. Giữ thông báo lỗi, tải lại và thao tác bỏ chặn. |

### Sửa post/comment cho tài khoản đã xác minh

| File | Thay đổi và lý do |
| --- | --- |
| `supabase/migrations/20261015200000_confirmed_social_identity.sql` | Nhận trạng thái email/phone đã xác minh của Auth trong guard và notice, ghi nhận xác minh lúc insert/update identity; giữ restriction có lý do, quota, fingerprint và ACL. Không sửa dữ liệu cũ. |
| `tests/helpers/post-comment-identity-fixture.mjs` | Fixture SQL độc lập với dữ liệu giả; chạy được baseline lịch sử local và baseline có migration signup mới. Auth/session helpers được mô phỏng, không phải JWT/browser thật. |
| `tests/post-comment-confirmed-identity.integration.test.mjs` | Tái hiện trước sửa, kiểm tra tài khoản mới/xác minh email-phone, metadata giả, retry, bulk, restriction thật, ACL/idempotence và rollback khi schema không khớp. |

### Kiểm thử và fixture

| File | Mục đích |
| --- | --- |
| `tests/public-booking-cache-scope-ui.test.mjs` | Fixture component kiểm tra cache theo dịch vụ, staff và timezone. |
| `tests/public-booking-wizard-ui.test.mjs` | Cập nhật fixture wizard để kiểm tra luồng booking tương ứng. |
| `tests/guest-manage-ui.test.mjs` | Cập nhật fixture quản lý booking guest. |
| `tests/quick-booking-selection.test.mjs` | Mock/cấu hình lựa chọn booking phù hợp với thay đổi hiện tại. |
| `tests/booking-scheduler-guards.integration.test.mjs` | Thực thi SQL scheduler trên PGlite tạm, kiểm tra overlap, time off, đổi lịch nguyên tử và slot sau hủy. |
| `tests/booking-concurrency.integration.test.mjs` | Các phiên PostgreSQL độc lập kiểm tra race, idempotency, khóa POS/rank, contact và rollback nguyên tử. |
| `tests/portable-custom-service-migration.integration.test.mjs` | Kiểm tra fresh helper thiếu, upgrade core đã vá và trường hợp cấu trúc lạ phải dừng an toàn. |
| `tests/helpers/isolated-supabase-fixture.mjs` | Auth/PostgREST/Storage/PostgreSQL thật trên container tạm, ảnh có sẵn, tmpfs, không mở host port hay outbound network; credential sinh trong bộ nhớ; chỉ dọn container đúng tên/nhãn sở hữu. |
| `tests/booking-access.integration.test.mjs` | 57 ca JWT/RLS thật: ranh giới khách/salon/staff, token guest, private fields, dual role, account claim, history và inspiration. |
| `tests/customer-booking-projection.test.mjs` | Mock loader/RPC để kiểm tra projection, cursor/filter, lỗi và Beauty counts. |
| `tests/booking-notification-outbox.integration.test.mjs` | 25 ca gốc cùng 10 ca bổ sung cho hàng đợi, người nhận, quyền RPC, owner/staff/guest/POS, ACL và chạy migration lặp lại. |
| `tests/booking-notification-dispatch.test.mjs` | Mười ca capture provider/worker: recipient/body, idempotency, fail/unknown/unconfigured, allowance, xác thực worker và cập nhật state; không gửi thật. |

Các script kiểm tra, log, bản sao trước sửa và snapshot trung gian ở `TASK` là công cụ/bằng chứng, không phải source sản phẩm cần phát hành. Tài liệu bàn giao này là file tài liệu bổ sung, ngoài 30 file source/test ở trên. Hai file UI có nội dung có sẵn của người dùng; chỉ delta nhỏ được ghi trong patch mới, không nhận toàn bộ file làm thay đổi của task.

## Thứ tự migration và đường nâng cấp

Fresh replay booking trước lượt sửa post/comment đã chạy đủ **263 file SQL thực tế**, không overlay, trên fixture Supabase cô lập. Có **261 mã version duy nhất**. Hai cặp trùng version đã có trong phần lịch sử, không thuộc bốn guard mới:

| Version | File trùng |
| --- | --- |
| `202610080006` | `202610080006_explore_state_boundaries.sql`; `202610080006_vietnamese_market_plugin.sql` |
| `202610080007` | `202610080007_checkin_receipt_plugin.sql`; `202610080007_explore_large_directory_search.sql` |

Không đổi tên lịch sử hoặc tự đánh dấu applied. Trước deploy phải đối chiếu ledger migration của đúng database đích và nguồn release để quyết định cách xử lý. Các fixture thực thi SQL theo tên file, không chứng minh Supabase migration CLI/history sẽ chấp nhận bộ version hiện tại.

Bốn migration booking mới có version riêng và đứng cuối thứ tự:

1. `20261015010000_booking_concurrency_guards.sql`
2. `20261015050000_booking_access_guards.sql`
3. `20261015163000_customer_booking_privacy.sql`
4. `20261015173000_booking_notification_access_guards.sql`

Chúng giả định các wrapper booking/deposit, permission/assignment helpers và notification schema trong baseline đã tồn tại. Migration concurrency/access/notification kiểm tra cấu trúc hàm mong đợi; nếu cấu trúc live khác phải dừng để review, không ép chạy.

Đường nâng cấp đã đạt **11/11 ca thực tế**: replay 259 migration lịch sử, tạo dữ liệu giả có sẵn rồi áp dụng bốn migration trên theo thứ tự. Các hàng booking, lines, customer, notices và outbox giữ nguyên qua bước nâng cấp; JWT/RLS, retry key, token guest và hành động owner/staff vẫn hoạt động đúng. So sánh **12 hàm và 11 policy** với fresh replay cho kết quả khớp; chạy lặp lại cả bốn migration không đổi dữ liệu hoặc ACL. Fixture đã dọn xong, các container có trước vẫn hiện diện. Đây là baseline local có dữ liệu giả, không phải bản sao production. Bằng chứng: `booking-release-upgrade-run1/booking-upgrade-results.json` và `booking-upgrade-fixture.json` cùng thư mục.

Sửa file lịch sử `202609230009` giúp fresh replay. Database đã chạy version đó không tự nhận thay đổi chỉ vì file local đổi. Nếu đích đã có core được vá thì kiểm thử riêng xác nhận nhánh nâng cấp không thay wrapper/core/ACL; nếu đích khác phải chuẩn bị forward migration sau khi đọc đúng schema, không chạy lại lịch sử mù.

Lượt post/comment thêm `20261015200000_confirmed_social_identity.sql`. Checkout local hiện có 264 file migration; commit signup `bd9fe462` có 266 file (bao gồm `20261015190000_signup_admission_retries.sql`). Thứ tự mục tiêu sau release signup là `20261015190000` rồi `20261015200000`. Migration mới tương thích cả baseline trước và sau sửa signup vì không sửa preflight/admission. Nó kiểm tra hình dạng ba hàm và trigger rồi sửa trong transaction; hình dạng khác sẽ dừng và rollback. Chưa chạy full fresh replay toàn bộ các migration sau khi thêm bản post/comment; kiểm thử mới thực thi SQL liên quan bằng PGlite trên hai baseline. Không đồng nhất kết quả đó với 263-file Supabase/JWT run trước.

Migration privacy thêm safe RPC đồng thời siết RLS. App cũ đọc bảng trực tiếp có thể mất dữ liệu hiển thị khi RLS được áp dụng trước app mới. Coordinator phải chốt rollout tương thích giữa schema và code; nếu cần tách bước thêm RPC trước rồi siết RLS sau, thay đổi đó phải được review và kiểm thử lại. Không xem deploy web và transaction database là một thao tác nguyên tử.

## Bằng chứng kiểm thử

| Kiểm tra | Kết quả và mức độ thực tế |
| --- | --- |
| Diagnostics tạo salon | 6/6 ca mocked errors; routing/static checks và TypeScript helper đạt. Chưa tái hiện authenticated UI để xác định lỗi production. `diagnostics-completion.json`. |
| Concurrency phase3 | 16 test node được báo đạt trên PostgreSQL phiên độc lập, socket-only; bao gồm parent. Có bằng chứng deadlock và duplicate-contact trước sửa. `booking-phase3-verification.json`. |
| Backend giai đoạn trước | 21 ca Auth/PostgREST cùng 4 tình huống HTTP đồng thời đạt. Lượt cũ dùng một overlay sửa optional helper; các lượt fresh sau đã đưa sửa vào source thật. `booking-auth-e2e-journal-completion.json`. |
| Privacy v5 | 57/57 ca dữ liệu JWT/RLS thật đạt với 263 file SQL. Vòng cuối exit 0, dọn fixture đạt. `booking-notification-guards-privacy2/booking-access-results.json`. |
| Thông báo v5 | 35/35 ca dữ liệu thật đạt. Sáu ca trước sửa trả 204 và sửa notice trái phép; sau sửa trả 401/403, số notice thêm/reset bằng 0. `booking-final-v5-verification.json`. |
| Delivery | 10/10 ca capture/mock provider đạt, không dùng secret hoặc gửi email/SMS thật. |
| Regression validation hiện tại | 40 test node do Node báo đạt, không skip, trên bản sao source local với cấu hình giả và chặn outbound network. `release-validation-regressions.log`. |
| Upgrade validation hiện tại | 11/11 ca trên PostgreSQL/Auth/PostgREST thật, dữ liệu giả có trước nâng cấp; 12 hàm và 11 policy khớp fresh. Không chạy migration CLI. `booking-release-upgrade-run1/booking-upgrade-results.json`. |
| Full lint lượt đầu (lịch sử) | 1569 file được lint; 2 lỗi, 77 cảnh báo. Không có lỗi trong 21 file patch booking. Hai cảnh báo cache-ref trong public booking đã tồn tại trước patch, đối chiếu lint trước/sau giống nhau. `release-validation-classification.json`, `release-validation-booking-lint-baseline.json`. |
| Full build lượt đầu (lịch sử) | Next 16.2.9, `next build --webpack` thất bại vì JSX Market. Lượt sandbox đầu còn gặp EPERM output; chạy lại được cấp quyền thực thi đã tới lỗi source. `release-validation-build-elevated.log`. |
| Full build/lint cuối sau hai sửa | `release-unblock-r2-source`: Next build + TypeScript đạt; full lint 1569 file, 0 lỗi/77 cảnh báo; booking regression 40/40 không skip. Source 2348 file được chụp, chỉ hai file sản phẩm thay đổi so với lượt cũ; các khác biệt khác là tài liệu/journal. `release-unblock-current-status.json`. |
| Post/comment trên release signup | 31 test node đạt, không skip: 14 node của bộ mới cộng 17 node regression signup/abuse lịch sử. SQL thực thi trong PGlite, auth/session helpers giả; không có browser hay request production. `post-comment-released-regressions-run2.log`. |
| Post/comment trên checkout local | 14/14 test node đạt; 12 tình huống nghiệp vụ + parent và 1 ca schema lạ rollback. Hai file test mới lint 0 lỗi/0 cảnh báo. `post-comment-local-regressions-run2.log`, `post-comment-new-files-lint.json`. |
| UI | Công cụ local browser/CUA vẫn không có trong kiểm tra khả năng một lần của lượt này. Không dùng Playwright/CDP để vòng qua. Chưa xác nhận browser cookies, Server Actions, session renewal, iPhone/Safari hay native E2E với source kết hợp. |

Build/lint chạy trên bản sao 2331 file source/config hiện tại trong `release-validation-source/`; bỏ `.env`, credential files, artifacts và output. Dependency đã cài được dùng qua junction. Child process chỉ nhận biến hệ điều hành và cấu hình giả, networking Node bị chặn. Đây là validation source local, không phải production environment build hay xác minh alias đang live.

Vòng privacy đầu có 57 ca đạt nhưng bước kiểm tra inventory thất bại vì bốn container `workspace-qa-*` ngoài fixture biến mất giữa lượt chạy. Guard cleanup không bị nới lỏng. Vòng chạy lại đạt hoàn toàn; các container project được đối chiếu vẫn giữ ID. Chi tiết ở `booking-privacy-cleanup-investigation.json`.

## Các blocker còn lại

- Hai blocker JSX Market và lint blocked-users đã sửa theo phê duyệt; full build/lint cuối đạt. Các log/proposal cũ được giữ, không còn là trạng thái hiện tại.
- Hai cặp migration version lịch sử bị trùng; chưa đọc ledger database đích hoặc chạy migration CLI trên đích.
- Full build local đã đạt; UI E2E và build nguồn release tích hợp mới nhất vẫn chưa được task này kiểm chứng. Source signup/live mới khác checkout hiện tại.
- Lỗi tạo salon ban đầu trên `reylumi.com` vẫn chưa được task này xác minh nguyên nhân thực tế. Trường tùy chọn trống được code hỗ trợ; không kết luận lỗi do nhập thiếu điện thoại/địa chỉ.
- Khách đổi/hủy lịch hiện có email queue nhưng không tạo notice mới trong app ở fixture. Guard không thay người nhận hoặc quy tắc nghiệp vụ này.

## Đối chiếu chat tài khoản

Đã đọc bằng `list_threads` và `read_thread` được hỗ trợ, không đọc raw session store. Chat đúng là **Kiểm tra quy trình tạo tài khoản**, ID `01a140aa-657e-7ce3-a41e-dba6c10fc823`, host local. Trong turn `01a140b1-97fe-75f2-b7f6-95838b5b9da9`, người dùng đã duyệt xác minh ngay trong form, CAPTCHA dễ đọc, sửa iPhone và cách tính lượt thử, vẫn giữ chống spam, rồi kiểm thử và deploy.

Lần đọc đầu chat còn đang làm. Sau khi người dùng yêu cầu trao đổi, task đã gửi thông tin và đọc kết quả bằng công cụ được hỗ trợ. Chat xác nhận hoàn tất signup/iPhone và **không sửa luồng review post/comment**. Final receipt `artifacts/signup-inline-security-20261015/final-receipt.json` ghi commit `bd9fe4623684acbd234a763f25c7e5b3862a7632`, deployment `dpl_2k29B84fDFLMg5rv9cj2S1JoUzXT`, live verified lúc 18:32:18 UTC và completed lúc 18:33:19 UTC ngày 15/10; đây là bằng chứng receipt đã đọc, task không tự gọi lại production. Native được receipt ghi TestFlight 1.0.1 (16.1), không phải App Store.

Source signup mới khác local ở API signup, `lib/abuse-server.ts`, `lib/auth-response.ts`, fixture/test và migration `20261015190000`. Release còn tích hợp booking: ba migration access/privacy/notification khớp hash v5, nhưng `lib/beauty.ts` và `lib/customer-bookings.ts` khác hash local vì đã được tích hợp vào baseline khác. Không ghi đè chúng bằng v5. Task đã lấy đúng file từ commit cố định vào fixture riêng, không merge source hoặc deploy. `post-comment-release-baseline.json` lưu hash/đối chiếu; `post-comment-coordination-20261015.json` ghi phạm vi trao đổi.

Yêu cầu mới của người dùng: tạo tài khoản, comment và tạo salon phải dễ với người bình thường; chống hành vi hàng loạt, tăng xác minh theo dấu hiệu thay vì cản retry hợp lệ. Sửa hiện tại chỉ xử lý lỗi dữ liệu xác minh đã tái hiện, chưa điều chỉnh các quota theo tuổi tài khoản hoặc thiết kế lại policy.

## Lỗi post/comment đã tái hiện và giới hạn bản sửa

Thông báo chính xác là “Your posts and comments require review before they appear publicly.” kèm “Contact support” trong `components/abuse-notice.tsx:14–15`. `get_abuse_notice` trả `mode=review` khi có identity row chưa verified; `abuse_guard_actor` cũng dùng row đó để giữ nội dung. Trigger cũ tạo row pending cho mọi email signup dù Auth đã có `email_confirmed_at`; chỉ cập nhật khi xác minh sau đó và bật email delivery. Vì thế active user không có restriction, vừa signup hợp lệ, vẫn có post `visibility=self/safety_hold=true` và comment `status=reported`. Tái hiện được cả email delivery bật/tắt trên commit đã phát hành; không phải suy đoán dựa trên tuổi tài khoản. `post-comment-review-before.json`.

Migration mới bỏ riêng hold tự động này khi Auth đã xác minh email hoặc phone, áp dụng cả row pending cũ mà không backfill/unban. Account suspended/deleted/pending_deletion; restriction deny/cooldown/review/challenge theo account/device/IP/country; signed context; quota; nhận diện nội dung lặp; và ACL vẫn giữ. Client metadata giả không được coi là xác minh. Tài khoản thật sự chưa xác minh vẫn theo hành vi cũ; không có chính sách mới để bỏ qua bước đó. Nội dung đã bị hold vẫn được giữ để review, không tự công khai.

Đây là nguyên nhân đã chứng minh từ source và fixture, chưa phải xác nhận riêng dữ liệu/phiên production của người dùng. Nếu sau triển khai tài khoản vẫn bị chặn, cần đọc đúng trạng thái Auth/restriction của phiên đó qua công cụ được cấp quyền; không tự unban.

Đề xuất policy tiếp theo, chưa áp dụng hay chọn ngưỡng:

| Nhóm | Tiêu chí chấp nhận |
| --- | --- |
| Người dùng bình thường | Signup được chấp nhận và Auth đã xác minh, không có restriction thật: đăng/comment ngay, không banner support. Lỗi nhập liệu và retry hợp lệ không bị hiểu thành nhiều tài khoản/nội dung thành công. Giữ nội dung form khi cần xác minh. |
| Người dùng chung mạng | IP dùng chung không tự đủ để kết luận một người là spam; thiết kế cần kết hợp lịch sử tài khoản/thiết bị và hành vi, đồng thời vẫn có trần bảo vệ hệ thống. |
| Hành vi hàng loạt | Burst, nhiều identity và nội dung lặp phải bị giới hạn hoặc yêu cầu xác minh theo dấu hiệu; kiểm tra đồng thời, không vượt quota bằng nhiều request song song. |
| Hạn chế có lý do | Deny/cooldown/suspension/review được áp dụng đúng, challenge không mở khóa deny; hết hạn/thu hồi theo quy trình được phép. |

Nếu muốn thay quota hiện tại (ví dụ giới hạn theo tuổi tài khoản) hoặc bỏ review cho identity chưa xác minh khi không có email delivery, cần thiết kế cụ thể và quyết định riêng. Lượt này giữ nguyên toàn bộ giá trị policy.

## Nhật ký và thay đổi môi trường

Những change ID của task gồm `salon-claim-lookup-diagnostics-20261014`, các nhóm booking cache/concurrency/lock-order/schema bootstrap, `booking-access-review-20261015`, `booking-customer-privacy-20261015`, `booking-notification-review-20261015` và `booking-release-validation-20261015`. Nhật ký bất biến trong `releases/changes/` cùng các manifest completion tại `TASK` lưu phạm vi từng giai đoạn. Event hoàn tất guard v5 là `d5da863b-17a1-4b03-b0f5-f9236794868d`; trạng thái `needs-integration`, không phải published.

Docker Desktop được mở sau khi người dùng cho phép. Người dùng tự thực hiện reset; task không tự reset. Sau reset, task khôi phục runtime bằng cách giữ lại các thư mục socket zero-byte dưới tên backup, không đổi ACL hay xóa volume. Fixture PostgreSQL/Supabase sinh dữ liệu giả và credential tạm, dọn đúng tài nguyên do task sở hữu. Các backup runtime được giữ; chúng không phải phần của release. Inventory trước đó không chứng minh tính toàn vẹn dữ liệu bên trong volume và không được dùng để kết luận mất dữ liệu.

## Các bước triển khai khi được cho phép

1. Đọc `AGENTS.md` và `docs/release-policy.txt`, lấy khóa release coordinator. Chụp deployment ID của alias `reylumi.com` và source đúng deployment đó. Chạy release journal pending, kiểm tra worktree và các thay đổi chưa phát hành, bao gồm chat tài khoản. Không deploy checkout dirty hoặc snapshot cũ nguyên khối.
2. Chọn các event hoàn tất thực sự cần phát hành. Kiểm tra hash snapshot/patch v5 và diagnostics riêng. Giữ mọi code đã ship về Explore/location, admin/support, Safari checkout, privacy và native; giải quyết xung đột bằng nội dung source, không dựa vào thời gian chat kết thúc.
3. Đọc ledger/schema đích ở chế độ chỉ đọc để giải quyết version trùng và xác minh prerequisites. Chốt kế hoạch backup/khôi phục phù hợp. Chốt thứ tự schema/app tương thích, đặc biệt privacy RPC và RLS. Không dùng service-role để giả quyền người dùng trong acceptance tests.
4. Xử lý blocker đã được duyệt; chạy full build/lint và regression trên nguồn đã tích hợp. Chạy fresh/upgrade đúng migration ledger đã chuẩn hóa, cùng Auth/RLS và concurrency. Tắt background dispatch của preview; không phát sinh thanh toán, email/SMS hoặc thông báo cho người thật.
5. Kiểm thử UI bằng công cụ được hỗ trợ với dữ liệu giả được phép trong Drayko: tài khoản/guest, tạo–đổi–hủy lịch, owner/staff/POS, cache/timezone, session hết hạn và đổi account. Không tạo lịch ở salon thật khác. Kiểm tra iPhone/native riêng khi source tích hợp có thay đổi native.
6. Tạo candidate từ source đã đóng băng. Ngay trước promotion chạy `node scripts/verify-production-base.mjs <captured deployment ID>`; alias đổi thì lấy baseline mới và tích hợp lại. Đánh giá native iOS theo source đã upload thực tế; task booking này không tự sửa native.
7. Sau phát hành được phép, xác minh alias/source/hash, migration thực tế, các smoke test được cho phép và trạng thái native nếu có. Ghi release receipt chỉ cho đúng event/channel thực sự phát hành. Không coi kết quả local là bằng chứng production đã nhận thay đổi.

## Kế hoạch khôi phục

- Ghi baseline deployment/source và schema/function/ACL trước lượt release. Nếu candidate chưa promote thì bỏ candidate, không sửa live.
- Nếu cần rollback web, chỉ dùng bản app tương thích với safe customer RPC đã triển khai. Không rollback mù về app đọc bảng cũ sau khi RLS đã siết.
- Giữ các guard privacy và notification trong khi xử lý lỗi bằng forward fix. Không tự mở lại EXECUTE cho anonymous hay mở SELECT ghi chú để chữa lỗi giao diện; đó sẽ khôi phục lỗ hổng đã tái hiện.
- Bốn migration guard không có down migration được kiểm thử trong task này. Không xóa hàng, rollback database wholesale hoặc thay ledger để đạt trạng thái giả. Nếu phải thay schema/ACL, chuẩn bị diff dựa trên snapshot thực tế, kiểm thử và lấy quyết định phù hợp.
- Giữ lịch sử notices/outbox và trạng thái `accepted`/`unknown`; không tự reset/retry hàng đợi vì có thể gửi trùng. Không bật worker trong quá trình rollback thử nghiệm.
- Không ghi đè release của coordinator khác. Giữ khóa đúng lượt và kiểm tra alias trước mọi promotion/rollback; ghi receipt trạng thái partial/failed nếu chưa xác minh xong.

## Phần chưa phát hành bởi task này

Task này chưa phát hành bất cứ patch, migration hay tài liệu nào lên production, chưa commit/push và chưa gửi thông báo hoặc thu tiền thật. Việc một chat khác có thể đã phát hành thay đổi tương tự phải được xác minh bằng receipt, exact source và migration ledger của họ; không suy ra từ journal local hoặc kết quả kiểm thử này.

Bản tổng hợp kiểm chứng cuối: `booking-release-validation-final.json`. Danh mục 25 file của toàn task, lý do và hash kiểm tra lại: `booking-task-file-inventory-20261015.json`. Ghi nhận khả năng browser của lượt validation: `release-validation-browser-capability.json`.

Bằng chứng cuối của lượt mở rộng: `reylumi-local-final-20261015.json`, `booking-task-file-inventory-v2-20261015.json` và hai manifest patch bổ sung. Các báo cáo v1 giữ nguyên để truy lịch sử. Rollback bản post/comment bằng định nghĩa cũ sẽ khôi phục lỗi chặn nhầm; ưu tiên forward fix đã review. Không có down migration được kiểm thử, không sửa restriction/identity/content rows để giả lập rollback.
