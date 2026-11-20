# MFA at the application-data boundary

The login form already challenged verified MFA factors, but the shared session
decision did not inspect assurance. A provider-valid AAL1 JWT with a live session
could therefore pass that data decision independently of the login form.
Callback and refresh entry points also need to preserve the pending-MFA boundary.

The forward migration `20261119221000_mfa_access_enforcement.sql` replaces only
`reylumi_account_session_state()`. It preserves its signature, stable security
definer contract, empty search path, owner and EXECUTE ACL. All existing provider
SID, expiry, legacy-denial, account-status and recorded-revocation checks run
before MFA. No provider factor/session, business data, grant or persistent
relation is created, changed or deleted by this migration.

When the account currently has any verified Auth MFA factor, only a
provider-verified JWT with `aal = aal2` passes. No factor or only unverified
factors retains the existing AAL1 behavior. This matches Supabase's
[opt-in MFA enforcement guidance](https://supabase.com/docs/guides/auth/auth-mfa#enforce-only-for-users-that-have-opted-in).
It also catches AAL1 tokens issued before a factor became verified.

Allowed responses keep `{ allowed: true, session_id, registered }`. Existing
revoked/expired/invalid responses keep `{ allowed: false }`. An otherwise valid
session needing MFA returns `{ allowed: false, mfa_required: true }`, containing
no factor identifiers or secrets. The pre-request hook rejects that decision
before an ordinary HTTP RPC body runs; callers must not depend on receiving this
flag from a protected REST request to start their challenge.

Pending MFA may use only the independently verified Auth challenge/verify flow.
It does not receive a database or Storage exemption. Phone-number verification
(`phone_change`) and email OTP are separate from an MFA challenge. Password
recovery remains a separately scoped reset operation and must not grant general
AAL1 application access. Shared callback, refresh and enrollment continuations
must use the verified AAL2 result before promoting normal application cookies.

The opt-in real-provider test starts a new isolated Auth/PostgREST/Storage stack
on an unchanged 453-migration baseline. It verifies the owned pre-fix AAL1 gap,
then applies 454 and checks REST, a security-definer RPC, direct RLS and private
Storage, real TOTP elevation, pending verification, non-MFA/unverified controls,
and the retained revocation/status barriers. It sends no email/SMS, exposes no
host ports, and uses no production identities. TOTP secrets, codes and provider
tokens stay in fixture memory and are redacted from errors and receipts.

App-guard/proxy/callback tests, the final assembled source, migration rehearsal,
actual production provider configuration and physical/native acceptance remain
separate evidence. A local test does not establish production activation or
store publication. The prior 453/25-migration receipts retain their original
input scope; the final release must include and verify this forward migration.

## Auth continuation implementation

Callback and refreshed sessions use the Auth SDK's explicit-token assurance
read, which verifies the identity and reloads verified factors. A missing or
failed assurance result is unavailable, preserving existing cookies and drafts.
Verified-factor AAL1 sessions receive only short-lived HttpOnly pending MFA
credentials; private navigation, advertising signup and normal application
cookies wait until verification. Callback/refresh GETs never send SMS.

The existing login form resumes pending verification with the same phone/TOTP
controls. A cookie-only, private/no-store GET returns a noncredential correlation
fingerprint. The same-origin POST checks it against the current pending token
pair before calling Auth. Client in-flight sharing is keyed by that fingerprint,
so a new principal cannot consume an old principal's pending response. Pending
cookie operations reject a different or malformed explicit Bearer identity.

Same-worker challenge requests share a bounded attempt. A received success
receipt may be reused on another worker. Expired receipts return existing-form
restart guidance, including on a fresh worker, without automatically sending a
new code. This does not promise globally once-only SMS: separate workers without
a received receipt can send twice, and ambiguous sends are held only in the
current worker. No persistent coordination or automatic resend was introduced.
The receipt MAC uses the pending access token and is only duplicate-send
correlation/integrity, not independent server-authenticated MFA authorization.
Provider verification, fresh AAL2 and the existing application session gate
remain the access authority.

Verification promotes cookies only after fresh AAL2 and the shared app gate.
Enrollment promotes the new token before request-scoped audit reads and uses a
new token-scoped audit client. Ordinary protected reads keep their existing
provider identity/SQL checks with no additional MFA network read or global
permission cache. A missing identity result is unavailable for strict readers
and null for optional readers. Conclusive rejection keeps its original handling.
Unexpired old AAL1 sessions denied by the SQL gate may still need the existing
password form; automatic no-password continuation for every legacy session is
not claimed. Recovery remains an independently verified, reset-only Bearer
operation, without a general AAL1 exception.

Gift Card capabilities remain in the browser fragment/in-memory through the
same-window password/MFA form. Only the safe return path enters auth forms and
queries; the fragment is restored only on the exact Gift destination. This is
an auth-continuation restriction, not a claim that an explicit Gift claim API
never receives its capability. No OAuth initiation exists in the inspected app
source. Cross-document OAuth/sign-in-link/recovery preservation is unproven;
the existing form advises reopening the original Gift link. No popup, storage,
OAuth state or server cookie workaround was added.

The installed native app keeps its existing online-only login handoff; no
arbitrary auth HTTP bridge or native allowlist expansion was added. Final native
packaging still requires frozen consumed-graph/output comparison.

## Verification boundaries

Source-only mocked SDK/route/React rendering tests cover callback, refresh,
verification, enrollment ordering, principal correlation, challenge expiry,
Remember, Origin, recovery boundaries and unknown-versus-rejected auth. The
local full build uses synthetic public placeholders, dispatch disabled and the
reviewed Node HTTP loopback guard. It does not establish real provider, hosted,
physical-device, TestFlight or Store acceptance. Exact commands, source pins and
logs are retained in the coordinator's ignored `mfa-access-enforcement-r1`
artifact directory.

The earlier isolated real-provider 13-check receipt remains historical evidence
for its original SQL/provider fixture only. Expanded real-provider application
guard/private-access integration was not executed after automatic safety review
flagged possible cybersecurity risk. No alternate probe, credential QA server
or provider bridge was used. Final assembled integration, the 454-source/
26-migration rehearsal, production configuration and device/Store gates remain
pending; this implementation is not production-ready acceptance.
