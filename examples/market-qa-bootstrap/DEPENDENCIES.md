# Account / security / Owner Market dependency review

## Review boundary

This is a finite source inventory and a **read-only SQL contract companion**.
It does not finish Reylumi signup, personal profile, security mutations or the
Owner app shell. No canonical Auth route, token semantics, production RLS or
business ownership resolver is changed. No fake RPC returns success.

The existing `bundle/` remains the12-file Market RPC/QR contract fixture. The
alternative `security-bundle/` has14 explicitly selected SQL files: those same
dependencies, a second preflight and canonical security read definitions. Choose
one reviewed fresh bootstrap; **do not apply the14-file bundle after the12-file
bundle**. This is not an upgrade/reconciliation executor.

`node examples/market-qa-bootstrap/security-build.mjs` only reads/writes source.
It does not connect to Auth, SQL, hosting or SMS. Regeneration requires the
Reylumi checkout; downloaded files are already generated for inspection.

## Supplied versus missing, route by route

| Canonical route or action | Dependency gap beyond original12 SQL | Supplied artifact / local test | Still unverified |
|---|---|---|---|
| `/signup`, `/api/auth/signup` | GoTrue, abuse/signup ticket RPCs, advertising attribution, full users creation, workspace routing | Source hashes/inventory only | Signup, mail, profile provisioning, navigation |
| `/login`, `/api/auth/login` | Abuse enforcement, `record_account_login_session`, notification→booking FK/index, full users fields, workspace | Session status projection in security companion; SQL self-read test | Password/provider login and session recording/cookies |
| Canonical `/api/auth/mfa/verify` | Provider challenge/verify, pending/full cookies, session recording, phone SMS and workspace | Canonical source inventory; QR TOTP tests remain separate | Canonical MFA enrollment, SMS and cookie transition |
| Auth callback/session/logout | Verified refresh, tombstones, session revoke, canonical cookie policy | Session status read/subject-isolation SQL | Real callback/refresh/global signout and revoke writes |
| `/developer-platform` register/profile/version/testing | Verified Auth client, prebound public subject, Market RPCs, optional session status read | Existing Market bundle and canonical `platformRpc`→actual SQL boundary tests | Full browser→GoTrue→PostgREST operations |
| `/account` and personal profile actions | Full `USER_SELECT`, defaults/self insert/update, avatar Storage, phone/customer claims, deletion/export/transfer/admin context | Missing-column negative control; no substitute helpers | Personal profile write/read and all lifecycle/Storage actions |
| `/settings/login-security` overview | Six overview projections/self RLS; full KingUser, provider factor list/AAL, SMS readiness, app shell | Canonical tables/policies + exact overview SELECT tests | Whole page and provider state |
| Security session/trusted/contact/password writes | Canonical self write policies/activity, reauthentication/updateUser/signOut | Intentionally denied by read-only grants; own/foreign writes tested | Every security mutation and provider effect |
| TOTP/phone enrollment/removal | GoTrue enroll/unenroll/verify, system SMS and activity | Inventory only; no factor/account/key created | Enrollment/removal/SMS and assurance policy |
| Recovery contacts/codes/cases | Digest rotation/revoke and request/preference/activity writes | Summary columns only; digest/events reads and all writes denied | Code creation, support workflow, contact proof |
| `/account-recovery`, forgot password | Redemption RPC, full user identity, event/activity/support-admin contracts, abuse and GoTrue reset mail | Missing RPC and anon/QR denials | Recovery matching, reset delivery and support resolution |
| `/market` and `(app)` layout | Full account/role/location/membership projections, salon memberships, permissions, staff/settings, personal-account RPC, subscriptions/payment/queue/advertising | Missing-column negative controls; no replacement context | Current-salon shell/navigation/composite reads |
| Owner consent/install/update/remove/open + authorize | Canonical current Owner resolver, reviewed version/hash/scopes, Market RPCs and state/PKCE | Existing Market/QR lifecycle tests; foreign-salon SQL denial | Real signed-in Owner→external HTTPS round trip |
| Published-data controls/four plugin APIs | Current Owner/grant/version, published revisions, media assets/gateway/Storage | Existing selected SQL/API contract tests | Real media/Storage/hosted revocation |

`dependency-plan.json` records these14 rows. Generated
`security-bundle/dependency-inventory.json` binds each explicitly listed source
file to SHA-256 and lists literal table/RPC calls. It is not a recursive closure:
dynamic calls, imported subsystems and provider behavior remain in the unverified
column. No whole-app readiness is inferred from a successful source scan.

## Exact SQL subset and provenance

- Canonical `set_updated_at()` is sliced unchanged from
  `202607240001_account_salon_baseline.sql`; no other baseline SQL is copied.
- The seven table definitions/indexes/triggers/constraints and six exact
  self-SELECT policies are sliced unchanged from
  `202608300001_account_login_security.sql`. Support-admin policies, write
  policies, recording, redemption and support RPCs are excluded.
- QA-only REVOKE/column grants restrict reads to fields used by the overview and
  session status lookup. `code_digest`, raw IP, support events and all security
  writes are denied. The QR NOLOGIN role retains access only to its private store.
- Manifest records source/raw hashes, slice anchors/line ranges/hashes and final
  executed hashes. Seven selected Market migration bodies are unchanged; their
  **exact outer `begin;`/`commit;` wrappers are removed only in this companion**,
  then the final newline is normalized, to permit one transaction. SQL statements
  remain unchanged. Unexpected wrapper structure fails generation.
  The original migrations and original12-file bundle are unchanged.

## Fresh QA prerequisites, still source only

An independently approved operator must first verify the exact disposable QA
resource. Neither marker proves project ownership. Provider-managed Auth
prerequisites must exist; this source never provisions them or an Auth user.
The operator would need both reviewed session markers:
`reylumi.qa_bootstrap=synthetic-only-reviewed` and
`reylumi.qa_security_bootstrap=read-only-contract-reviewed`.
No connection string, credential, key or cloud command is supplied here.

`security-bundle/apply.psql` uses ON_ERROR_STOP and one BEGIN/COMMIT. The first
gate rejects an existing application DB; the second rejects enabled features,
Auth bindings/accounts, non-synthetic or touched fixtures, existing security
objects/helpers or unrelated public relations. Reapply is rejected, never
silently merged. Failure rolls back the whole fresh companion transaction.
Features/finance stay OFF; no approved install or financial admin is seeded.

The bounded candidate entry is `/developer-platform`, which sits outside the
business `(app)` shell and already uses the canonical verified Auth-client/Market
RPC resolver. It requires separately approved, prebound synthetic identities.
No alternative login, spoofed Owner header or success stand-in is supplied.
Personal account/security links and Owner Market still lead to canonical routes;
their broader dependencies are explicitly not satisfied by this bundle.

## Local proof and next decision

`node --test tests/market-account-bootstrap.test.mjs` executes actual SQL in
PGlite, exact overview SELECT strings, role/subject isolation, denied writes,
clean rollback/reapply denial and missing-schema negative controls. The canonical
`platformRpc` module is bundled unchanged with only its verified Auth-client
boundary injected; its workspace/Owner results come from actual SQL, not fake
success values. This is not real GoTrue, PostgREST or a browser route test.

Before approving a full hosted QA environment, choose a separate bounded scope
for canonical profile/context/lifecycle, notification/booking and abuse bootstrap
or supply a reviewed complete schema from an approved source. Do not fill those
gaps with permissive tables/helpers. SMS/Storage/MFA/mail/HTTPS/managed PostgreSQL
and real Owner browser acceptance remain separate. No staging72h/resource/key/
financial approval is granted by this review; finance remains loopback-only.

## Tiếng Việt

Bộ mới chỉ bổ sung **hợp đồng đọc bảo mật**: schema bảy bảng, sáu policy đọc đúng
tài khoản, quyền SELECT theo cột và kiểm thử cách ly. Không cho ghi bảo mật,
không cấp quyền đọc digest khôi phục hoặc hồ sơ hỗ trợ; không tạo mã khôi phục,
đổi mật khẩu, đăng ký MFA hay tạo tài khoản. Các đoạn SQL có nguồn và hash rõ ràng.

Bundle14file là phương án khởi tạo mới thay cho bundle12file, không phải bản
nâng cấp chạy sau đó. Hai marker và các điều kiện dữ liệu phải cùng đạt; chạy
lại hoặc gặp dữ liệu ngoài phạm vi sẽ bị từ chối. Toàn bộ bundle mới chạy trong
một giao dịch; kiểm thử đã xác nhận lỗi điều kiện không để lại schema ứng dụng
dở dang. Đây là bằng chứng PGlite local, chưa phải migration database thật.

Bảng trên tách phần đã có, phần kiểm thử được và phần còn thiếu. Đặc biệt,
`record_account_login_session` còn kéo theo thông báo/booking; profile và Owner
shell cần nhiều cột, membership, quyền và RPC hơn bộ fixture hiện tại. Không
tạo RPC giả trả thành công hoặc đổi route Auth để che các khoảng trống này.
Chưa đủ cơ sở tuyên bố toàn bộ account/security/Owner UI chạy trên QA mới.

Chưa gộp, deploy, dựng staging72h hay chạm tài khoản/provider thật. Chủ project
có thể xem ma trận dependency và bằng chứng trước khi quyết định phạm vi QA tiếp.
