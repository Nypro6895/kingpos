# QR QA serverless quickstart — source only

Latest staging review: `../market-qa-bootstrap/LOGIN.md` and STAGING.md separate
mandatory login admission from incomplete session/security acceptance and the
still-closed nonfinancial QA HTTPS Owner-origin guard. The18SQL alternative and
strict optional Auth binding are source-only. QR runtime role remains NOLOGIN;
reviewed target stays false. No resources/credentials/deploy are supplied.

The download also includes `../market-qa-bootstrap/CONTEXT.md`: an alternative
fresh15SQL context contract supports full profile projections and canonical
current-salon/Owner action tests locally. It does not finish canonical login,
all profile/security actions or the whole hosted app shell. No real resources,
accounts or credentials are supplied; choose one reviewed fresh bundle.

For canonical Reylumi account/security/Owner dependencies, read
`../market-qa-bootstrap/DEPENDENCIES.md`. The optional14-file companion supplies
read-only security SQL contracts; it does not finish canonical signup/login,
profile/security mutations or the Owner app shell. QR app MFA remains separate.

The deployable Node22 entrypoint is `api/index.mjs`; `vercel.json` routes all paths
to it with maxDuration60s. The project root is **examples/qr-menu**, not the whole
Reylumi repository. Dependencies are pinned in package-lock.json (`pg`8.16.3,
qrcode1.5.4). No Vercel project, build/deployment, credential or resource has been
created by this example. Real Vercel execution is a separate acceptance gate.

## Reviewed configuration, disabled by default

`qa-targets.json` deliberately has approved=false and empty targets/users. The
entrypoint returns503 before importing a driver/constructing a pool when the
reviewed configuration is absent. Environment variables cannot turn that file
on. After separate approval/provisioning, the developer must review/freeze the
exact QA Market/QR HTTPS origins, Supabase project origin, matching database
host/port/runtime user, QA app client ID and allowed Auth user UUIDs. Do not put
passwords or keys in that file. The runtime rejects production Reylumi domains,
non-Vercel app origins, mismatched project DB identity, admin DB usernames,
URL TLS overrides, sandbox tokens, missing/duplicate identity allowlists and
missing/shared grant/session keys. The operator still verifies the resource IDs;
source validation alone cannot prove an arbitrary allowlisted project is QA.

Server environment required (never raw values in commands/artifacts):

- QR_MENU_QA_ONLY=true; REYLUMI_MARKET_API_ORIGIN and QR_MENU_PUBLIC_ORIGIN match
  the reviewed exact origins; QR_MENU_AUTH_ORIGIN matches reviewed QA Supabase.
- REYLUMI_MARKET_CLIENT_ID / REYLUMI_MARKET_CLIENT_SECRET: exact approved QA app,
  backend confidential credentials. Requested API scopes stay the four public
  published-data reads; the Auth login does not add a Reylumi data scope.
- QR_MENU_DATABASE_URL: exact restricted QA user/host/port, `/postgres`, password
  via secret channel. No query options. Driver config forces TLS verification;
  no fallback to a local/default database, plaintext TLS or service_role.
- QR_MENU_AUTH_ANON_KEY: QA public anon JWT/publishable key; a service-role JWT or
  secret key is rejected. It is never a replacement for user authentication.
- QR_MENU_GRANT_KEY / QR_MENU_GRANT_KEY_ID and QR_MENU_SESSION_KEY: distinct
  server-only32byte keys encoded canonical base64url. No runtime key generation
  or file persistence. Optional previous grant key and ID are supplied together
  with QR_MENU_PREVIOUS_GRANT_KEY / QR_MENU_PREVIOUS_GRANT_KEY_ID for rotation.
  Session-key rotation invalidates app sessions; grant-key rotation must retain
  the old key until snapshots/backups have been reconciled.

No secret above is provided/generated here. Existing production credentials are
not suitable substitutes. Unsupported or missing config fails closed.

## App login and automatic salon connection

The QR app has its own sign-in session, separate from Reylumi's salon grant.
`/login` accepts an approved synthetic `@qa.example.invalid` account through
server-side Supabase password sign-in, then verifies the returned token through
`GET /auth/v1/user`. Issuer/audience/role/subject/expiry, the reviewed Auth UUID
allowlist and non-anonymous QA email are checked. User metadata, posted actor
IDs, Authorization headers and forwarded user headers do not establish identity.

An enrolled verified TOTP factor requires the bilingual `/mfa` challenge UI
before full access. Pending AAL1 sessions are encrypted, expire within ten
minutes and cannot access protected routes. Atomic revision checks, bounded
attempts and cancellation fence replay and late responses. Phone/passkey factors
remain unsupported and fail closed. See MFA.md for limits and interrupted-request
recovery. Never disable account MFA to make a test pass. Full Reylumi account
recovery/bootstrap and real GoTrue acceptance remain separate. No signup,
password reset, email invite, financial identity or provider account is created.

Only an opaque random app-session cookie reaches the browser. Auth access tokens
are encrypted in `qr_menu_private.qr_auth_sessions`; refresh tokens returned by
Auth are not retained or exposed. A session lasts at most1hour and is verified
with Auth again on each protected request. Sign-out uses same-origin CSRF-protected
POST and revokes that SQL session, so a captured old app cookie cannot be reused.
It is QR-app sign-out, not global provider sign-out or plugin uninstall: the public
menu remains active until salon permission/publication is revoked in Market.

Login/logout forms check Origin, duplicate/unknown fields, bounded request body,
signed short-lived CSRF cookie/form pair and explicit redirect allowlist. Login
attempts are limited by a shared atomic SQL counter to20 per60s per app context;
no claimed IP/user header is trusted. Only initial approved Market launch params
may be preserved through sign-in. A stale OAuth callback is never forwarded to a
login URL; Owner signs in and opens the app again from Market.

After login, Owner uses the **current salon's existing Market**, consents to the
approved version and opens it. The handler performs the same state/PKCE single-use
code flow and rotating grant logic as the reference, with no token copy/paste.
Cookies are Secure/HttpOnly with `__Host-` names and Path=/, no Domain. Login CSRF
uses SameSite=Strict; app/OAuth session uses Lax for top-level redirects.

## SQL and bounded lifecycle

Apply the separately reviewed private schema only to an authorized empty QA DB.
`storage.sql` now qualifies all four tables in **qr_menu_private**; there is no
search_path dependency. The runtime role needs USAGE on that schema and only
SELECT/INSERT/UPDATE on qr_menu_state, qr_auth_sessions, qr_auth_limits and
qr_mfa_pending. It does
not need DDL, DELETE, Market/Auth/Storage table access or service_role. See the
review-only bootstrap bundle `../market-qa-bootstrap` and its permission tests.

Every function invocation creates a **max1/min0** pool and awaits pool.end in
finally. Config sets connect3s, query/statement4s, lock1s and idle1s timeouts,
allowExitOnIdle and TLS rejectUnauthorized=true. Requests have a45s fetch/query
start deadline within the function's60s budget; body read is bounded to4KiB/5s.
A request can return503 during contention/outage and must not auto-repeat writes.
Per-request connection disposal is intentionally conservative; these settings
are not a global cap across many Vercel instances. Real pool/TLS/network/failover,
load/concurrency and runtime cancellation still require provider acceptance.

The OAuth grant store retains a60s fenced app/origin lease. A timeout may leave
it until expiry; an uncertainty marker prevents replaying a possibly rotated
refresh token. Cookies/QR output flush only after the final fenced write. Auth
session writes separately require an exact acknowledgement before issuing a
cookie. Database outages never fall back to Map. Each public menu request still
fetches current published API data and checks installation/salon/version.

If an earlier local reference used public.qr_menu_state, this is a private-schema
upgrade, not an automatic migration. Never silently discard, copy or reconnect
valuable grants. A reviewed state-copy/rotation/reconnect runbook must preserve
AAD context/key/routing identity and be tested separately. No hosted old store
has been accepted or migrated by this work.

## Local proof and limits

From repository root:
`node --test tests/qr-menu-serverless.test.mjs tests/qr-menu-durable.test.mjs tests/qr-menu-mfa.test.mjs tests/market-qa-bootstrap.test.mjs`.

Tests use actual Node HTTP handler and PostgreSQL SQL in PGlite, with injected
pool/official-API boundaries. They verify exact config, CSRF, caller-ID rejection,
Auth identity mismatch/MFA denial, SQL expiry/tampering/revocation, lost session
write, callback replay and account isolation, private role permissions and pool
cleanup across requests/instances. PGlite is not real multi-connection PostgreSQL;
no network DB/TLS, actual GoTrue password/MFA or hosted cookie execution is claimed.

References: [Vercel Node](https://vercel.com/docs/functions/runtimes/node-js),
[node-postgres Pool](https://node-postgres.com/apis/pool),
[Supabase verified user](https://supabase.com/docs/reference/javascript/auth-getuser).

App-session identity is not a new salon-ownership claim or SSO contract. The
published API intentionally does not expose a Reylumi Owner user ID. This resolver
binds the verified QR app account to its pending callback/manage session; the
Market authorization endpoint independently verifies the signed-in salon Owner.
It does not prove that two separately signed-in app accounts are the same human,
and does not add team/transfer/account-association policy or another API scope.
