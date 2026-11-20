# Canonical profile / Owner context QA contract

## What this adds

`context-build.mjs` creates a fresh **15-file alternative** in `context-bundle/`.
The default12-file Market fixture and14-file read-only security companion remain
unchanged. Choose one fresh reviewed bundle; do not run these in succession or
use fragments as an upgrade of existing data. No database/provider is contacted
by the builder. Regeneration requires the Reylumi source checkout.

This bundle supplies actual canonical profile/current-context SQL dependencies:
ten table definitions, current lifecycle columns, deleted-identity tombstone,
nine canonical helpers, selected RLS and narrow grants. It uses the existing
canonical TypeScript resolvers and Owner actions; it adds no alternative login,
Owner header, resolver override or RPC that fabricates success.

| Route / contract | Added dependency / artifact | Local proof | Remaining gate |
|---|---|---|---|
| `getCurrentKingUser`, profile projection | Full users table + lifecycle columns + canonical self read/update policy | Exact USER_SELECT executes; canonical resolver reads own profile; five safe columns update under self RLS | Full profile action includes phone proof; avatar/Storage, deletion and transfer not supplied |
| `getCurrentBusinessContext` | Full account/role/location/membership projections; permissions, linked staff and salon-settings read contracts | Actual resolver, SQL-backed adapter, selected-salon cookie and foreign-tenant denial | Real GoTrue/PostgREST/cookies, nonempty media and whole app layout |
| Personal account bootstrap | Canonical `ensure_personal_account_for_current_user` and `seed_default_roles_for_account` | Real account/role/membership SQL once for a synthetic developer; no salon or foreign ownership manufactured | Real account creation remains unapproved; no new team/invitation/ownership policy |
| Lifecycle identity / Owner predicates | Latest selected phase3 owner/manage helpers and `auth_identity_is_deleted` | Suspended/deleted user and inactive salon rejected; tombstone prevents missing-profile fallback | Deletion scheduling/finalization, exports, support and ownership transfer |
| Developer publisher profile/version/review | Existing Market RPCs on canonical current-user foundation | Real register/profile_save/submit/independent review SQL through canonical platformRpc | Provider-backed signed-in browser workflow |
| Owner activate/open/remove | Existing Owner action + current salon resolver + Market RPCs | Consent required; actual installation acknowledged; open denied until backend configuration; token-free launch redirect; foreign revoke denied | HTTP server-action/CSRF, external HTTPS callback/code exchange and hosted lifecycle |
| Account security reads | Previous seven-table/six-policy read-only fragment | Existing security SQL tests continue; all mutation grants remain absent | Password/MFA/session/recovery mutations and provider state |

## Exact graph and provenance

The source list is explicit, not a scan/copy of production migration history:

- `202607240001_account_salon_baseline.sql`: ten named table definitions,
  update triggers, `set_updated_at`, subject/account/permission helpers,
  role seeder and selected canonical RLS. No customer/booking/POS tables copied.
- `202608210001_account_salon_lifecycle_foundation.sql`: users lifecycle columns.
- `202608210003_account_deletion_flow.sql`: personal-account bootstrap helper only.
- `202608210006_account_lifecycle_phase3.sql`: finalization columns, tombstone,
  current owner/manage/permission helpers and salon-membership read policies.
- The same seven selected Market migrations, QR private schema/NOLOGIN role and
  canonical read-only security fragment used by earlier contracts.

`manifest.json` records raw source SHA, statement anchors/line ranges/slice hashes
and executed hashes. `dependency-graph.json` records selected public references
and resolver source hashes. Its context graph has no unresolved public reference;
this is not a whole-application dependency closure. SQL statements are extracted
unchanged except declared LF normalization and the already documented outer
transaction-wrapper removal for the seven Market files.

The isolated Market reviewer list, deny-by-default financial-admin gate and
empty media-asset fixture remain explicitly labeled QA fixtures. They are not
production admin/media implementations. No login-recording, notification,
booking, abuse, recovery or support RPC is replaced with a permissive stand-in.

## Access boundary

Authenticated users get canonical self/profile and membership-scoped reads.
The only direct profile writes granted here are `display_name`, `first_name`,
`last_name`, `language`, `timezone`. Auth identity, status, phone, ownership,
membership, account/role administration and all security mutations are denied.
The canonical personal-account RPC can perform its existing internal provisioning
within synthetic SQL; direct role seeding and arbitrary account creation are not
granted. This does not decide a new production team/ownership policy.

Staff/settings tables support the internal authenticated context query only;
their grants expose only the context columns needed. The plugin API still has
exactly four public published-data groups, no staff/customer/POS/payment scope.
All feature/finance settings remain OFF, commission unset, finance admins empty.
No Auth account, password, key, client credential, installation or grant is seeded.

## Fresh QA prerequisites

`context-preflight.sql` requires both reviewed session markers:
`reylumi.qa_bootstrap=synthetic-only-reviewed` and
`reylumi.qa_context_bootstrap=canonical-context-reviewed`.
It requires provider-managed `auth.users`, `auth.uid()` and `auth.role()`, with no
Auth users, no application relations/schemas/runtime role or pre-existing
non-extension public functions. Reapply and unrelated data/helper targets are
rejected. Markers do not prove project ownership or authorize applying real SQL.
An approved operator would still verify the exact disposable QA project first.

`apply.psql` sets ON_ERROR_STOP and one transaction for all15 files. Missing
dependencies or preflight failure roll back the fresh schema. It supplies no
connection, credential, cloud executor or Auth provisioning step. Four public
synthetic profiles stay unbound; later Auth binding would require separate
approval and `bind-context-auth.sql` with four explicit reviewed ID pairs. The
older `bind-approved-auth.sql` belongs only to the12/14 contract-fixture marker;
do not use it for this canonical-context alternative.

## Tests and remaining acceptance

`node --test tests/market-profile-context.test.mjs` runs eight tests. The harness
compiles the existing current-user/current-context, permission, Market Owner and
Owner-action modules unchanged. Only verified Auth-client, Next headers/cookies
and cache invalidation are injected. All supported PostgREST-style reads/RPCs
execute actual SQL in PGlite; no context/Owner result is supplied as a fake value.
The adapter is not a real PostgREST server or multi-connection PostgreSQL.

The open test first confirms rejection before backend configuration. It then
uses the canonical credential-configuration RPC with an ephemeral all-zero
placeholder digest that does not correspond to a generated secret; no key or
credential is created/exchanged and no live grant minted. The actual Owner
action produces the launch redirect with identifiers only. External callback,
PKCE/code exchange and hosted cookies remain separate acceptance gates.

Negative controls remove a canonical dependency, use unrelated data/helper/Auth
rows, replay bootstrap, submit a stale salon selection, target another tenant,
or suspend/delete the profile. They must fail rather than fabricate context.
The original12/14 suites still test their intentionally smaller contracts.

Canonical login still needs `record_account_login_session` and real notification/
booking dependencies, abuse/signup tickets, provider Auth and workspace HTTP
acceptance. Full `(app)` layout still needs subscription/payment, queue,
advertising and other subsystem contracts. Phone/avatar/deletion/transfer are
not complete merely because profile projections now exist. No hosted readiness,
staging72h, provider/resource/key, financial HTTPS or deployment approval is
established. Finance remains loopback-only.

## Tiếng Việt

Bundle15file bổ sung schema và helper canonical cho profile/context/Owner, không
chỉ dừng ở đọc bảo mật. Kiểm thử chạy resolver và Owner action hiện có với SQL
thật trong PGlite: chọn salon, kiểm tra quyền, lưu profile publisher, submit/duyệt,
consent kích hoạt, mở và gỡ plugin. Owner không copy token. Phần đăng nhập được
giả lập ở ranh giới Auth nên chưa phải bằng chứng browser/provider thật.

Chỉ năm cột profile an toàn được ghi trực tiếp; quyền/status/điện thoại/membership
và bảo mật không được nới. Tài khoản cá nhân/role được tạo trong test bằng helper
canonical hiện hữu; không tạo Auth account hoặc cấp quyền cho người thật.
Không đổi chính sách team/ownership, Auth route hoặc semantics token production.

Đây là phương án khởi tạo mới thay cho bundle12/14, không chạy nối tiếp. Có marker,
kiểm tra DB trống, chống chạy lại và rollback giao dịch. Chưa apply database thật,
dựng staging, cấp khóa, enroll MFA, push/gộp/deploy. Notification/booking/abuse,
toàn bộ app shell và nghiệm thu HTTPS/provider vẫn là các cổng rõ ràng còn lại.
