# Synthetic QA bootstrap bundle — review only

Final local readiness: `LOGIN.md` describes the fresh18SQL login-abuse alternative,
strict optional `bind-context-auth.sql`, and the offline `staging-readiness.mjs`
audit. STAGING.md contains the unapproved72h proposal. Login admission is mandatory;
record-login errors are nonblocking in canonical code but remain a security
acceptance gate. QA HTTPS Owner origin is still blocked. No execution is authorized.

Latest bounded context alternative: `CONTEXT.md` and `context-build.mjs` describe
a fresh15-file bundle with canonical profile/current-context/lifecycle dependencies
and real Owner-action SQL tests. It resolves the four full projection gaps for
that alternative only; Auth/recording/notification/abuse/full app-shell acceptance
remain separate. Do not apply the12/14/15-file bundles in succession.

New optional bounded companion: `DEPENDENCIES.md` inventories14 canonical
account/security/Owner flows and their remaining gaps. `security-build.mjs`
generates an alternative fresh14-file bundle with canonical security schema and
self-read projections only. It is not a full Auth/app-shell bootstrap or an
upgrade after this12-file bundle. No security mutation is enabled or executed.

`node examples/market-qa-bootstrap/build.mjs` writes a deterministic `bundle/`
with12 explicitly selected SQL files (LF and one final newline), raw/executed hashes and `apply.psql`.
The builder only reads/writes source files: no database connection, account,
password, key, resource or cloud migration. No entire production migration history
is scanned or included. The selected seven Market migrations remain unchanged.

## Exact scope

1. Preflight requires an explicit reviewed synthetic marker, provider-managed
   `auth.users`/`auth.uid()` prerequisites and an **empty application DB**. Existing
   public application tables/views, Market/QR/bootstrap schemas or runtime role are rejected. It is not a project
   ownership proof: an authorized operator must check exact QA project IDs first.
2. Foundation is a **minimal Market RPC contract fixture**, with Auth→public profile
   mapping through auth.uid(), self-only profile read RLS, two salon accounts and
   membership-based Owner authority. It is not a replacement for KingPOS's full
   canonical schema or an approved production ownership policy change.
3. Seven explicit Market migrations implement developer/review/consent, OAuth,
   four published groups and test-only financial request bookkeeping. Feature
   and test commerce remain OFF; commission is unset and financial admins empty.
4. QR private store creates four schema-qualified tables; a dedicated NOLOGIN,
   NOINHERIT, non-superuser/non-bypass role receives only schema USAGE plus
   SELECT/INSERT/UPDATE on those tables. No login/password/credential is enabled.
5. Four fixed synthetic public profile IDs, two accounts/salons and one reviewer
   are seeded. All auth_user_id remain NULL. **No Auth accounts, passwords,
   app client/sandbox/OAuth tokens, installations or financial data are created.**

The 12 files must be reviewed/frozen as a sequence. `apply.psql` sets
ON_ERROR_STOP; it does not set a connection or the explicit marker. Do not run
later fragments after a failed preflight, point it at production or turn this
artifact into an automatic cloud executor. Partial QA bootstrap failure is
reconciled only within the separately authorized disposable QA project.

## Auth binding is a separate approved step

After resource/account creation is explicitly approved, provision the four QA
Auth users via the official provider channel with signup/invites/email side effects
controlled by that approval. Record their nonsecret UUIDs in the reviewed target
allowlist. `bind-approved-auth.sql` is optional and **not in apply.psql**: it can
bind four confirmed QA Auth IDs to their fixed synthetic email/profile rows and
refuses reassignment. It never creates Auth accounts or passwords. It has not
been executed on a provider. No credentials are included or requested here.

Only after that setup may an approved QA operator enable the Market feature for
non-financial lifecycle testing. App submission, review and Owner consent must
still be exercised; do not seed an approved install or mint a token to skip them.
Financial configuration, provider test keys and HTTPS financial transport remain
separately reviewed/approved. Current commerce loopback guards are unchanged.

## What this bundle does NOT finish

It is sufficient for the selected Market RPC/QR SQL contract tests in ephemeral
PGlite. It is **not** sufficient to claim the whole signed-in Reylumi Next app and
account-security UI will run on a fresh Supabase project. The actual application
also references account_login_sessions, account_security_preferences,
account_login_activity, account_trusted_devices, account_recovery_codes,
account_recovery_requests and record_account_login_session (see
lib/supabase/server.ts and lib/account-security.ts), plus broader business-context
and app-shell dependencies. Those canonical schema/RLS/functions require their
own bounded dependency bundle and integration review; copying the full production
baseline or writing permissive stand-ins to make UI tests pass is not approved.
Storage bucket/policies and actual media gateway execution are also not supplied.

Hosted Auth/HTTP/PostgREST/storage, MFA/recovery, real multi-connection PostgreSQL,
TLS/pooler permissions/failover and current Owner browser lifecycle remain separate
acceptance gates. QR QA login now supports existing verified TOTP challenges;
pending aal1 never grants full access. Phone/passkey and account recovery remain
separate. See ../qr-menu/MFA.md for limits and source-only upgrade. No resource should be
created just to turn these unverified gates green without separate authorization.

## Local verification

`node --test tests/market-qa-bootstrap.test.mjs` applies all12 artifacts to an
in-memory PostgreSQL engine with TEST Auth prerequisite tables (not GoTrue users),
then checks disabled defaults, zero Auth provisioning, authenticated-sub/profile
mapping, independent review, wrong-salon rejection, consent install and QR role
denials for Market/Auth/other data/DDL/DELETE. Synthetic test Auth-table rows are
not provider accounts or credentials. Same input files produce identical hashes.

The output manifest records raw and normalized executed SQL hashes. It does not
establish that any cloud project exists or has those migrations installed.

`build.mjs` runs in the Reylumi source checkout. A downloaded sample already ships
the frozen bundle; it does not contain the whole source checkout required to
regenerate canonical migration copies. Review the shipped manifest/SQL instead
of running the builder from an extracted standalone example.
