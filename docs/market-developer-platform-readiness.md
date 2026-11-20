> Current developer contract: `docs/market-developer-platform.md`. The entries below are chronological implementation evidence, not one current capability list. The professional-completion tracker is `artifacts/market-professional-20261103/TRACKER.md`. New drafts/evidence migrations are local source only; old frozen QA bundles remain unchanged.

# Developer Market — local review status

Origin preparation30/10: exact-origin contract/config and an **unapplied** review
patch are now available, shipped false/empty. Current Owner guard stays byte-
unchanged and refuses QA HTTPS. Tests cover strict literal syntax, reviewed
project/mode/time and production isolation, no QA env fallback, and unchanged
legacy production/loopback behavior. Activation/resource approval remains a gate,
not missing validator code. A/B existing-account versus full signup/security
options: `docs/market-qa-origin-prep-20261030.md`.

Final local staging review30/10: fresh18SQL adds only canonical login-abuse
preflight (5tables/3helpers) and strict optional context Auth binding. Five cases
verify actual SQL admission/denial/ACL/rollback/binding and the still-closed
nonfinancial Owner QA HTTPS guard. Canonical login catches recording errors;
signin success is not session/security acceptance. See
`docs/market-staging-final-20261030.md` for bounded remaining decisions and
unapproved resources/credentials/72h cleanup/budget. No canonical Auth changes,
fake RPC success, real provider/resource/cloud/push/merge/deploy.

Latest context revision 2026-10-30: optional fresh15SQL now supplies canonical
USER/ACCOUNT/ROLE/LOCATION projections, context tables/RLS and personal-account/
lifecycle helpers. Eight tests run unchanged user/context/Owner-action modules
against actual PGlite SQL, including developer profile/review and Owner consent/
install/open/revoke. Only Auth/Next boundaries are injected. See
`examples/market-qa-bootstrap/CONTEXT.md`. The12/14 bundles keep their smaller
contracts; full Auth/recording/notification/abuse/app shell and profile phone/
avatar/deletion/transfer/provider acceptance remain pending. No real resources
or push/merge/deploy; finance remains loopback and staging unapproved.

Latest account-bootstrap inventory 2026-10-30:14 canonical route/action flows
mapped in `examples/market-qa-bootstrap/DEPENDENCIES.md`. Optional fresh14SQL
companion supplies seven canonical security tables/six self-read policies and
projection-only QA grants, with atomic rollback/reapply denial. It does not
supply security mutations, full users/context/Owner shell, recording/notification
or abuse bootstrap. Negative controls identify18/2/5/11 missing columns in full
user/account/role/location projections. No fake success helpers or canonical Auth
changes; no resource/provider/cloud/push/merge/deploy. Full hosted QA remains pending.

Latest finite revision 2026-10-30: QR enrolled-TOTP MFA challenge/verify is now
implemented, with encrypted pending state, revision fencing, bounded attempts
and authoritative AAL2 before access. 11 focused cases pass; aggregate329:
325pass/0fail/4 opt-in skips. EN/VI view/guide and38-entry download updated.
See `artifacts/market-qr-mfa-20261030/report-vi.md`. Earlier MFA-not-implemented
notes below are historical for this TOTP subset. Phone/passkey/recovery, complete
canonical account/security bootstrap and actual hosted/provider acceptance remain
separate. Target disabled; EXCLUDED shared release; no resources/push/merge/deploy.

Revision: 2026-10-28. Worktree: `C:\Reylumi\market-real-20261028`, branch `codex/market-real-20261028`. Previous local implementation commit: `9d2a93e`. No production deployment, push or migration has been performed.

## Current workflow

- Existing Owner account → existing `/market` → currently selected active salon → approved app/version → exact permissions consent → activate → automatic confidential app connection. No extra buyer account, salon creation or Owner token copying.
- The app backend checks state and uses PKCE plus its own client secret to exchange a 60-second single-use code. Runtime identity is installation/version/salon bound; 15-minute access, rotating 30-day absolute refresh grant. Updates, uninstall, credential rotation and app suspension/withdrawal permanently revoke existing grants. Account/salon/publisher eligibility changes and lost entitlement pause access while ineligible; use Remove or app suspension when permanent revocation is required. Restoration requires fresh Owner consent and connection after permanent revocation.
- Developer workspace tabs: apps and connections; publisher profile and existing personal-account/security links; measured test activity; test payments and payout accounting; separate independent review and financial administration where authorized.
- Version-specific progress separates setup/current eligibility from historical server observations. Missing evidence stays unverified. Hosted code, domain ownership, browser behavior and actual provider operation are not certified by this count.
- Guide: `/developer-platform/guide`; downloadable manifest; runnable confidential-backend reference implementation.
- Integer-cent reporting separates pending quotes, captured gross, refunds, disputed principal, quoted shares and account-level payouts. Service-only immutable observations support linked charge/refund/dispute/transfer/reversal/application-fee/fee-refund balance transactions. Missing facts never imply zero fees or available funds.

## Validation

- Aggregate existing/new Market regression: **131 passed in the combined Market + fixture suite, zero failed/skipped**, `artifacts/market-owner-integration/aggregate-tests.log`.
- The combined total includes **16 isolated-fixture safety tests**. No generic destructive container cleanup; ownership checks remain mandatory.
- PostgreSQL-compatible integration exercises actual migrations, private ACLs, active Owner tenant binding, confidential client credentials, invalid PKCE, challenge-as-verifier rejection, stored-digest replay rejection, code replay/expiry, refresh rotation, retired manual token RPC denial, uninstall/rotation revocation, publisher profile erasure and immutable provider transaction arithmetic.
- Boundary tests execute real Server Actions/routes/provider adapter with framework/network fixtures. They include stale salon/duplicate field/missing consent rejection, no secrets in Owner launch URLs, provider-source mismatches and full refund fee accounting.
- TypeScript, scoped ESLint and sanitized production build passed. Build contains no live credentials.
- Real GoTrue/PostgREST + browser acceptance **passed**, including all 292 migrations, existing Market search/activation with no additional account or salon, automatic confidential backend connection, uninstall revocation and cross-tenant isolation. The final run required no manual upload reload and deliberately returned 503 for composite Market refresh. Result: `artifacts/market-owner-integration/browser-fullstack/market-owner-browser.json`. The HTTPS app origin is forwarded only in the test browser to a real loopback reference backend; this does not deploy a hosted app.

## Pending external acceptance and release integration

Dedicated Stripe test credentials are absent. Real provider onboarding, Checkout, account verification, webhook delivery, refunds/disputes, reversal and bank payout verification remain pending. Mocked provider tests prove boundaries and calculations, not actual provider behavior.

Owner chose Reylumi collection and seller sharing. Commission, tax/region policy, commercial refund/dispute liability, seller terms and live provider acceptance remain unapproved. Test database example rates are not business decisions. Live commerce has no enable switch in this implementation.

Only salon identity is supported. Native/archive execution, customer/staff/POS data scopes, organization teams, account ownership transfer, recurring licenses and automated domain/code attestation are not implemented. Expired/revoked payment-order recovery and more than 100 adjustments require support reconciliation rather than silently creating another charge or truncating totals. The reference backend needs encrypted durable storage and its own user binding for production hosting.

The existing Market integration has been implemented in this preserved local worktree. A future release must merge it against the then-current verified production source and preserve unrelated shipped changes; this local snapshot is not the release baseline. Physical-device acceptance and actual external hosted-app behavior remain separate.

Prior revision evidence and frozen source remain under `artifacts/market-real/`, unchanged. Its separate storefront/manual connection evidence is historical and does not validate this revised Owner journey.

## Review locally

Run `node scripts/market-platform-local.mjs` after a sanitized production build. Launcher: `http://127.0.0.1:4329`; Owner Market: `http://127.0.0.1:4328/market`; developer workspace: `/developer-platform`. Launcher accounts are explicitly synthetic, with real local GoTrue sessions. The review app is synthetic and hosted deployment is pending. Stripe commerce is disabled. Stop the process with Ctrl+C to remove its owned disposable containers.

## Preservation and fixture observations

The earlier public-card-batch container disappearance remains unresolved as to actor, owner and impact. Read `artifacts/market-owner-integration/container-preservation-audit.md`; later successful cleanup does not retroactively establish no impact. Only the conclusively identified debug group was subsequently cleaned with exact ID/label/isolation checks and a separate receipt; other groups were left unchanged.

The empty-media isolated fixture also emitted a pre-existing Next prerender-cache LRU size-zero error for /api/experience/offline-assets. Browser acceptance, when completed, establishes only its listed journey, not offline/native service-worker acceptance or production readiness. The test blocks service workers for deterministic HTTPS app aliasing, and relays actual server 303 locations as script-free meta navigation because Playwright does not re-route every redirected URL in an intercepted chain. BFF code, auth cookies, PKCE/code exchange, real Next handlers and database authorization remain in the test path.

Developer forms use a confirmed save response followed by document navigation to the selected panel; credential-reveal responses stay on the page until the developer saves the secret. Owner actions return a fresh, timestamped salon workspace snapshot. The UI binds that snapshot to the current experience scope/salon and prefers newer observations, so delayed composite Market refresh cannot silently overwrite a confirmed installation.

Frozen source includes a binary ZIP alongside per-file SHA-256 receipts, allowing exact original bytes to be restored across Git CRLF conversions. A local implementation completion remains needs-integration; no deployment is authorized.

## Four published-data groups and QR example — local source revision

Owner approved four separately scoped read groups: profile/hours, services/list prices, selected salon media and public content. See [contract](market-published-data-contract.md). Current source includes Owner opt-in publication UI at /market/data, strict snapshots/revisions, official grouped GET endpoints, a metadata-stripping media gateway and a self-hosted QR menu example with downloadable ZIP. Prior identity-only limitations above describe the older revision; customer/staff/POS/payroll/payment/write scopes remain unsupported. Current full GoTrue/Storage/browser QA for these groups is pending new temporary QA authorization; earlier identity-only acceptance cannot certify this new revision. No production migration or deployment has occurred.
## Current local acceptance update — 28 October 2026

The approved replacement run exercised seventeen actual GoTrue/PostgREST/Next/Storage checks for the four public groups and QR reference, including reduced-scope consent and revoke. Actual browser publication, developer counters and public menu/mobile images are recorded separately. The main Market composite render failed; a subsequent expected-read recovery correction has unit/build validation, not authenticated browser acceptance. Do not treat the earlier error as resolved without retest. The service-key probe returned403 at roughly`exp+1s`, inside the documented30second validator skew, so expiredHTTP401 remains unverified. Exact cleanup and REST128MiB-total/CPU1/stopped were completed. No additional credential was issued for the correction. See `artifacts/market-published-qa/replacement-1/report.md` and the acceptance checklist for exact source layers, skips, final tests and remaining gates. No deployment or production migration.

## Isolated branch checkpoint — evening of 28 October 2026, America/Chicago

Owner explicitly excludes Market from the shared Reylumi release. Continue local development and acceptance on this branch; integration and deployment remain deferred. See [current checkpoint](market-local-checkpoint-20261028.md).

A later zero-key authenticated diagnostic rendered the actual catalog and four-scope dialog, without activation. It did not reproduce or resolve the original render failure. Historical QA origins are synthetic harness aliases, not verified staging hosting. Existing Vercel previews are not assumed to contain an isolated QA backend; hosting/authority/cost and provider acceptance remain unresolved.

The current local correction resets form state when the selected immutable version/hash or operation changes. A credential-free browser fixture reproduced consent persisting from a one-scope version to a four-scope version before the correction, then verified unchecked consent in both directions afterward. The real component runs with synthetic props and denied actions; this is UI regression evidence, not grant issuance, authenticated lifecycle or HTTPS acceptance. Existing server consent checks remain authoritative.

The next local account revision groups public publisher details, personal profile and canonical account-security links. Malformed/missing profile reads cannot become editable blanks, while an explicit SQL null supports first setup. Organization identity resets form state; unavailable commerce has an explicit retry panel. Account-specific EN/VI controls now use a real developer locale context and preserve the selection in save/reload URLs; legacy portal text is not all translated. Owner activation also remains disabled until consent and resets on version changes. Twenty-seven focused tests, scoped lint and the sanitized production build passed. Desktop/phone synthetic component evidence and the standalone preview are under `artifacts/market-account-owner-polish/`; actual hosted/authenticated acceptance remains pending. Market stays excluded from the shared release.



### Checkpoint navigation/update/diagnostics — 29/10/2026

Developer navigation preserves panel/lang and in-document drafts; delayed saves do not force a different panel. Owner version review shows added/removed permissions and launch URL changes; malformed/foreign workspace observations fail closed, with explicit uncertain post-mutation recovery. 228 local tests:224pass/0fail/4opt-in skips; built unauthenticated private-route suite3pass, lint and sanitized production build pass. Actual PGlite RPC read-model compatibility and synthetic CUA desktop/390px were checked. Historical RSC root cause remains unattributed; current authenticated/HTTPS/provider gates are specific and pending. Team/ownership and staging proposals are prepared without new grants/resources. Market remains EXCLUDED from shared release, no push/merge/deploy. See `artifacts/market-milestone-20261029/report-vi.md` and `docs/market-current-acceptance-proposal-20261029.md`.


### Current local render/preflight checkpoint —29/10/2026

Updated: `artifacts/market-release-preflight-20261029/report-vi.md` and `artifacts/market-release-preflight-20261029/permission-and-hosting-vi.md`. Shared JSON preflight and declaration changes are implemented without new grants. Authenticated existing-fixture current query render completed4HTTP200 requests with ordinary session refresh,0newcredentials and verified cleanup. Queryless coverage, lifecycle/Open/HTTPS/provider acceptance remain separate pending cases; historical incident remains unattributed. Earlier requirement for a new REST approval was a coordination limit clarified by the latest relay, not an active action-time denial for bounded owned zero-key local render. Team/ownership and code-patch decisions are concrete proposals in `docs/market-release-team-decisions-20261029.md`. Exact4opt-in skips in `docs/market-opt-in-gates-20261029.md`. Market still EXCLUDED from shared release.


### Single-owner lifecycle / mutation confirmation — 29/10/2026

Actual developer action regression reproduces false Saved for null profile RPC acknowledgement before correction. Profile/moderation now require true, organization registration requires UUID; invalid acknowledgements return explicit uncertain outcome and never auto retry. Six current Market SQL migrations were exercised in ephemeral PGlite for reject/resubmit/review separation/tenant-preserving update/withdraw/authority loss/repeat revoke/paid-entitlement denial. No SQL/grant/team policy change or new authenticated fixture/credential. Aggregate271 tests:267pass/0fail/4named opt-in skips. Evidence and exact limits: `artifacts/market-lifecycle-confirmation-20261029/report-vi.md`. Market remains EXCLUDED from shared release; no push/merge/deploy.


### Mutation contracts and recovery —29/10/2026

Submit/review acknowledgements now bind exact version/artifact; Owner install/update/revoke require matching post-observation, and unsafe/foreign connection details never redirect. Unknown outcomes block same-form retry until explicit reload; consent resets with each action response. Provider persistence helpers require boolean true, without changing economic/provider idempotency rules. Current SQL response contracts checked in ephemeral PGlite; CUA fault preview is synthetic, not authenticated lifecycle. Operation matrix: `docs/market-mutation-contracts-matrix-20261029.md`; evidence/proposal: `artifacts/market-mutation-contracts-20261029/`. Team/domain/ownership policy not chosen, no new grants/resources/credentials. Financial quote/seller read-model validation remains an independent local next gap; hosted/provider acceptance remains separate. Market EXCLUDED, no push/merge/deploy.


### Purchase quote/seller contracts and recovery guide —29/10/2026

Purchase guards now bind seller org/provider identity, exact approved manifest/hash/price, current salon/version and independently saved order fields before exposing Checkout/onboarding URLs. Malformed timestamps no longer bypass reconciliation. No pricing/commission/terms/schema/grant changes; provider mocked only. Recovery route `/developer-platform/guide/recovery` adds EN/VI reject/resubmit/recovery/evidence/support steps with locale-preserving links. Aggregate294 tests:290pass/0fail/4named opt-in skips; local SQL/adapter/UI proof remains separate from hosted/provider acceptance. Evidence/status matrix: `artifacts/market-commerce-read-models-20261029/report-vi.md`. Refund quote/pending refund intent reconciliation remains a local next gap; team/transfer/domain/staging decisions stay pending. Market EXCLUDED; no push/merge/deploy.

### Test-refund request reconciliation and staging proposal —29/10/2026

The previous local refund quote/pending-intent item is implemented and tested: immutable SQL request intent, independent financial read model, authoritative test-charge/refund matching, existing-refund recovery/stale-POST block, provider status persistence and verified charge-event catch-up. Pending/terminal/unavailable financial UI is explicit and bilingual. This does not complete real provider acceptance or choose commercial refund/dispute liability. New source migration has only run in ephemeral PGlite; no hosted schema change. Current seven-migration lifecycle and310 tests:306pass/0fail/4 opt-in skips, scoped lint/build pass. Proposal-only QA plan includes two Vercel projects/one Supabase Micro,72h window, unknown usage, cleanup and minimum credential boundaries; paid Supabase cannot pause, Vercel team budget is not a QA hard cap. Hosted app session/entrypoint/private SQL schema configuration, QA bootstrap and HTTPS financial allowlist are still software preparations, not just unavailable infrastructure. See `docs/market-staging-proposal-20261029.md` and `artifacts/market-refund-reconciliation-20261029/report-vi.md`. Market EXCLUDED; no provider/cloud/key/schema action or push/merge/deploy.

### QR serverless/QA Auth implementation update —30/10/2026

Earlier QR entrypoint/Auth-session/private-schema preparation gaps now have local implementation: Node22 raw handler/factory, inert target file, validated exact QA config, bounded per-request pool disposal, verified Auth user/opaque encrypted session/CSRF/rate/expiry/revoke and private3-table role contract. Owner authorization remains Market's responsibility; no SSO/team mapping policy invented. Source-only bootstrap12SQL is deterministic and tested, defaults disabled/Auth accounts0/QR role NOLOGIN. **Still unbuilt:** full canonical Market Auth/security/app-shell/storage dependency bundle, QR MFA challenge, HTTPS financial runtime allowlist. **Still unaccepted:** actual managed PG multi-connection/TLS/failover/restore, GoTrue/MFA, Vercel lifecycle and signed-in hosted current Owner flow. Final318 tests314pass/0fail/4skips plus23focused, lint/build/Node22 inert entrypoint and35-entry ZIP hashes pass; not a product/security certification. Detailed matrix and preview: `artifacts/market-qr-serverless-20261029/report-vi.md`. Market EXCLUDED; no resources/keys/provider/cloud migration or push/merge/deploy, no authority for QA72h yet.
