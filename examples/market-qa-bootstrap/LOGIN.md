# Final login admission contract — source review only

The fresh18-file `login-bundle/` extends the selected15-file canonical context
graph with five exact abuse table definitions and three exact canonical helpers.
It is an alternative fresh bootstrap, not an upgrade after12/14/15 bundles.
`node examples/market-qa-bootstrap/login-build.mjs` only generates source files.

Login cannot skip `assertAbuseRequest("login", email)`: it runs before GoTrue
password sign-in. HMAC configuration and Market-server QA service_role are required,
then a real `abuse_preflight` decision. SQL/transport/malformed/denied/challenge
responses fail closed. A public anon key is not enough for the server abuse RPC.
The earlier proposal's service-role-only-for-images assumption is superseded.

Canonical fragments come only from `202610070008_abuse_prevention.sql` (settings,
counters, restrictions, events, verification passes, abuse_take/matching helper)
and the updated `abuse_preflight` in `20261015190000_signup_admission_retries.sql`.
No locks/backfill/Auth trigger from that migration are copied. Canonical bodies
and defaults are unchanged. Only service_role can call preflight; browser/QR
roles cannot call it or read the private counters. Tables have RLS, no direct
runtime table grant. Manifest records anchors/raw/slice/executed hashes.

This is **not** complete abuse/signup/security bootstrap: no signing key, admission
ticket function, signup trigger, CAPTCHA/challenge solution, content moderation,
notification, booking or session-recording RPC is supplied. Signup cannot be
marked accepted. Do not disable challenges, signup guards or production controls.
Any limited future QA needs reviewed private/precreated identities and explicitly
closed public signup, not a public signup surface with incomplete admission.

`recordAccountLoginForSession` is different: login/MFA canonical routes catch its
failure, and the helper tolerates missing schema. A login success therefore does
not prove a session/activity/notification row was written or that revoke/recovery
works. That is a security acceptance blocker, not permission to bypass it. Its
real notification FK/index and booking dependency graph remains a separate scope.

Several legacy Market subscriptions/billing reads return unavailable on errors;
they are not a reason to copy all production history. This is source analysis,
not full `(app)` browser acceptance. Exact required child/layout/provider behavior
must still be observed in the separately approved environment.

The existing `platformPublicOrigin()` also refuses the proposed nonfinancial
Market QA HTTPS origin. No wildcard, production fallback, localhost alias or
disabled guard is introduced. A reviewed exact-origin source change is required
before a real Owner Open→authorize QA round trip. Financial HTTPS stays loopback.

The18-file source uses the two context markers plus
`reylumi.qa_login_bootstrap=canonical-login-gate-reviewed`, provider-managed Auth
uid/role prerequisites and an empty/unbound application DB. ON_ERROR_STOP and one
transaction enforce rollback and reapply rejection. No Auth account, password,
key, installation or token is seeded. QR role remains NOLOGIN and needs separately
approved QA-only credential setup before network acceptance.

Five tests in `tests/market-login-readiness.test.mjs` exercise real canonical
abuse-server/context/signals code against actual PGlite SQL. The SDK/provider and
Next request boundary is injected; dummy offline fixture configuration is not a
real credential. Tests verify rate limits, restriction/challenge denial, absent
config/RPC, role denials, rollback and the still-closed HTTPS origin guard. They
do not call password Auth, solve a challenge or claim a hosted browser login.

The optional `bind-context-auth.sql` is separate from apply.psql. Unlike the
older contract-fixture binding, it requires the canonical-context marker and an
explicit session JSON of four reviewed profileId/authId pairs. It checks exact
confirmed synthetic emails, uniqueness and no reassignment; it creates no Auth
identity. The fifth test uses TEST prerequisite rows only. A real binding needs
separate provisioning/ID approval and equality with the reviewed QR allowlist.

`staging-readiness.mjs` is an offline source/metadata audit. It reads no environment
or credential, connects nowhere and cannot authorize execution by toggling JSON.
It records hashes and runtime versus acceptance classification, with a BLOCKED
provision/deploy verdict. `staging-plan.json` remains unapproved. Read STAGING.md
for the concrete72h proposal, resources, credentials, cleanup, budget and decisions.

## Tiếng Việt

Gate chống lạm dụng là bắt buộc trước Auth; thiếu cấu hình, SQL hoặc bị challenge/
từ chối đều phải đóng. Bộ18SQL chỉ bổ sung phần login preflight canonical đã kiểm
thử, không giả thành công cho signup, notification/booking hoặc record-login.

Ghi nhận phiên hiện không chặn đăng nhập trong canonical code, nhưng vẫn là gate
nghiệm thu bảo mật. Không lấy việc đăng nhập được để tuyên bố session/recovery đã
đạt. Guard HTTPS Owner QA cũng còn chặn và chưa được nới. Chỉ chuẩn bị source,
manifest và proposal; chưa tạo account/key/resource, apply SQL hay deploy.
