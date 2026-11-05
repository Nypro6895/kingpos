# Developer marketplace: local implementation and integration contract

This work integrates approved hosted developer apps into the existing `/market` for the Owner’s currently selected salon. `/developer-platform` is the publisher workspace, with separate tabs for apps/connections, profile/security, test activity, payments and independent review. Existing first-party Market billing and the earlier private metadata registry remain independent. It is not invitation-only. Any active authenticated Reylumi account can register its developer organization; ownership comes from `current_public_user_id()`, not a role selector or submitted user ID. One account owns one organization in this version. Organization teams and ownership transfer are not supported yet.

Owner decision in this chat: Reylumi collects payments and shares proceeds with sellers. The first payment adapter implements Stripe destination charges in **test mode only**. The commission remains unset. This is not approval of commission, Stripe financial terms, regions, tax policy, liability, or live payment activation.

## Supported application type and immutable boundary

The initial supported package is a JSON **hosted-app connection manifest**, uploaded through a real multipart Server Action and validated independently in PostgreSQL. The hosted application runs on developer infrastructure, outside the POS and Reylumi server. There is no ZIP extraction, uploaded JavaScript execution, native DLL/plugin loading, iframe bridge, or injection into POS. The runnable reference app is `examples/market-hosted-app/server.mjs`; developers host their own app behind public HTTPS and submit its connection manifest.

An artifact is limited to 16 KiB, requires a `.json` filename in the web form, and has an exact field allowlist. No uploaded path is used as a filesystem path. Archives, binaries, scripts, unknown fields, privileged scopes, HTTP origins, IP literals, credentials, ports, URL query strings and fragments are rejected. URLs are not fetched or executed by the submission server. Reviewers must verify publisher domain ownership and inspect the hosted app manually before approving; automated DNS ownership verification and remote-code attestation are not implemented.

```json
{
  "schemaVersion": 1,
  "type": "hosted-app",
  "version": "1.0.0",
  "name": "Your salon app",
  "description": "Describe what your hosted app does for salon owners.",
  "launchUrl": "https://your-company.com/app",
  "privacyUrl": "https://your-company.com/privacy",
  "supportUrl": "https://your-company.com/support",
  "scopes": ["salon:identity:read"],
  "price": { "currency": "usd", "amountCents": 0, "billing": "one-time-version" }
}
```

Stable numeric SemVer is supported; prerelease/build labels are not. Price is USD, zero for free, or 50–999999 cents for a one-time license to that exact version. Subscriptions, trials, coupons, cross-currency conversion and bundled licenses are not supported. These are capabilities of the local adapter, not a decision to launch this pricing model. A new paid version needs its own purchase and new consent; an update never silently changes permissions or price.

The server retains PostgreSQL `jsonb::text` canonical JSON and SHA-256 of its UTF-8 bytes. The hash covers the admitted connection manifest including price and scopes; it does not hash the original whitespace of the uploaded file or developer-hosted application code. Version/name/hash, review decision and reviewer reason are immutable apart from narrowly guarded account-erasure tombstones. Changes require a new version. Review binds the exact version ID/hash, rejects self-review and conflicting decisions, and supports an exact replay. Metadata approvals from the old private registry grant no installation or payment entitlement here.

Hosted application code can change at its origin independently. Approval is therefore approval of the connection manifest and reviewed behavior, **not** attestation of permanently immutable remote executable code. Reviewers can suspend an app immediately; catalog, install and runtime checks then fail closed. Developers may withdraw their own app; only an independent reviewer may restore availability.

## Developer, reviewer and salon journey

1. Sign up/sign in using the existing Reylumi account flow. Open `/developer-platform`, register an organization, then choose a new or existing app and upload its manifest. A submission request ID and immutable version handle retry after interruption.
2. Create a synthetic test salon from any submitted version. The same runtime resource returns a test-only salon ID/name, never copied real salon/customer data. Its token lasts 24 hours with a 1000-call limit. Resetting invalidates the previous token. Activity retains request count and last successful call time, without bodies or credentials.
3. An independently allowlisted reviewer inspects the exact manifest/hash, hosted app, publisher ownership, policies, scopes and price. The reviewer can test with a separate synthetic salon, approve/reject, or suspend availability. Reviewer provisioning remains an administrative operation; self-service registration does not create reviewers.
4. Approved apps appear alongside existing features in `/market`, including search and My features. An active salon Owner explicitly accepts the exact version/scopes for their currently selected salon. Server Actions re-read the actual Owner workspace and reject a stale salon form before mutation. No extra buyer account or salon is created.
5. Paid versions require verified payment entitlement before installation. Returning from Checkout does not grant access. After payment reconciliation, the owner still accepts installation permissions. Installing/updating invalidates previous token generations; exact same-version consent retry preserves its generation.
6. Owner opens the app from Market. The app backend creates state and a PKCE verifier, redirects to Reylumi authorization, checks the returned state, and exchanges the single-use 60-second code with confidential client credentials. Owners never copy tokens. The callback is the exact approved version launch URL; arbitrary redirect URLs are not accepted.

Generate the app’s client secret once in the developer workspace and store it on your backend. Reylumi persists only its hash. Rotation disconnects existing sessions. Authorization checks current Owner/salon, exact installed version, app/publisher availability, paid entitlement and credential/installation generations. Access lasts 15 minutes; refresh rotates and has a 30-day absolute lifetime. Legacy manual salon-token issue and unauthenticated refresh RPCs are revoked. The developer-only synthetic sandbox token remains available for integration testing.

Profile uses the existing Reylumi personal account and Login Security functions, including password, 2FA, recovery and sessions. Publisher support profile is independently editable; erasure scrubs it. Test progress is six explicit server observations for each version, with observed/unverified counts. It does not certify arbitrary hosted code or substitute for browser, security or payment-provider acceptance.

## Runtime API

```http
GET /api/market-platform/v1/salon
Authorization: Bearer rmp_<opaque token>
```

The caller cannot submit a salon ID. The token fixes the installation, approved version and salon. The only scope is `salon:identity:read`; the response contains `id`, `name`, `installationId` and `versionId`. Synthetic responses additionally include `synthetic: true`. No customer, staff, ticket, payroll, financial or write API is supported. Responses use private/no-store caching and vary by Authorization. Keep tokens in the hosted app server environment; never append them to URLs or client analytics.

Refresh through `POST /api/market-platform/v1/token` with JSON `{ "grant_type": "refresh_token", "client_id": "APP_UUID", "client_secret": "rmc_...", "refresh_token": "rmr_..." }`. The response includes a replacement access token, replacement refresh token, `expires_in: 900` and the unchanged absolute refresh expiry. Refresh is single-use and serialized per installation; replay/concurrent reuse is denied. Persist the replacement refresh token atomically in the hosted app's encrypted secret store, with a single in-flight refresh. A lost refresh response requires owner reconnection; the platform does not recover clear tokens from hashes or silently grant access.

Run the reference app with backend-only REYLUMI_MARKET_CLIENT_ID, REYLUMI_MARKET_CLIENT_SECRET and REYLUMI_MARKET_API_ORIGIN. It listens on loopback 4340 and demonstrates state, PKCE, backend token exchange, HttpOnly browser sessions and serialized refresh. Its token store is ephemeral; production apps need encrypted durable storage and their own authenticated-user binding. Local browser tests intercept the approved HTTPS app origin and forward to this real loopback backend; no external app deployment is implied.

## Test commerce and provider boundaries

Both application `MARKET_PLATFORM_ENABLED=true` and database `market_platform.settings.enabled` are required. New migrations initialize everything off. Commerce additionally requires `commerce_test_enabled=true` and an explicitly reviewed `commission_bps` value in the disposable database. There is no live commerce flag or fallback to the existing first-party live Stripe configuration.

Dedicated server environment names:

```text
MARKET_PLATFORM_STRIPE_TEST_KEY
MARKET_PLATFORM_STRIPE_TEST_WEBHOOK_SECRET
MARKET_PLATFORM_STRIPE_TEST_CONNECT_WEBHOOK_SECRET
MARKET_PLATFORM_STRIPE_TEST_ACCOUNT
MARKET_PLATFORM_TEST_ORIGIN
MARKET_PLATFORM_TEST_SERVICE_ROLE_KEY
```

Only `sk_test_` keys, loopback application origins and a loopback Supabase database are accepted by the commerce adapter. The authenticated user client is still required for organization, quote, consent and finance operations. This module uses its separate service client only for the new provider-application RPCs; developer/browser requests receive no direct table access. The service-role credential itself remains privileged and must stay server-side in the isolated test database configuration. Never print or commit credential values.

Seller onboarding creates/reuses a provider account using a stable idempotency key and sends the owner to a single-use Stripe-hosted onboarding link. Reylumi stores provider account ID and verification booleans, not bank/routing/card/identity documents. Returning to Reylumi is not verification; a provider refresh or verified account event reads current status. Interrupted account creation older than 23 hours requires reconciliation before another account can be created.

Checkout uses an immutable database quote: salon, buyer, version, seller account, amount and commission snapshot. The browser cannot supply the charged amount, fee or destination. One order per salon/version prevents a second purchase. Interrupted session creation retries with the same provider idempotency key; an unknown outcome older than 23 hours stops for reconciliation. Expired/revoked orders currently require support reconciliation; automatic creation of a replacement paid order is not implemented.

The webhook endpoint `/api/market-platform/stripe-test-webhook` accepts separately signed platform and Connect event destinations, using their separate signing secrets. Configure both scopes against this URL; connected events must verify against the Connect secret. It bounds the raw body, verifies HMAC over original bytes with a five-minute timestamp tolerance, rejects live events, retrieves the event in its account context, checks the configured platform account and fetches current payment objects. Amount/currency, order metadata, charge, destination account, application fee and test mode must agree. Only successful paid charges grant entitlement. The event and entitlement state commit atomically. Duplicate events are idempotent; older observations cannot undo later state, and refunded amounts never decrease. See [Connect webhook account context](https://docs.stripe.com/connect/webhooks).

Full test refunds require existing platform financial-owner authority through `market_billing_require_admin()`, separately from reviewer access. The provider request reverses the destination transfer and application fee; entitlement changes only when verified charge state is reconciled. Partial refunds revoke access conservatively. Disputes revoke access while unresolved/lost; evidence submission and dispute management remain in Stripe's test Dashboard. Payout observations are stored separately by connected account/payout ID. Seller-share figures are gross split estimates before processing fees, transfer reversals, reserves and tax; they are not a reconciled bank balance or a complete double-entry general ledger.

Provider documentation consulted: [hosted onboarding](https://docs.stripe.com/connect/hosted-onboarding), [destination charges](https://docs.stripe.com/connect/destination-charges?platform=web&ui=stripe-hosted), [refund/dispute responsibilities](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes), [webhook verification](https://docs.stripe.com/webhooks). Destination-charge fees/refunds/chargebacks debit the platform balance; owner review of those responsibilities, supported countries, taxes, fees and contracts remains required. No financial account, live grant, payout, transfer or charge was created by this task.

## Local review

Use the preserved worktree `C:\Reylumi\market-real-20261028`. Do not run this from the unrelated dirty main checkout. Build with sanitized environment credentials, then run:

```text
node scripts/market-platform-local.mjs
```

The harness uses the exact Supabase images already cached on Drako: Postgres 17.11.0.006, GoTrue 2.197.0, Storage 1.84.19 and PostgREST 16.5. It applies every migration to disposable tmpfs storage with cron dispatch disabled, network-none DB namespace, no Docker host ports, and per-container CPU/memory bounds. Two Node servers listen on loopback only: Next at 4328, test transport/session launcher at 4329. The test transport forwards requests to real GoTrue/PostgREST; it does not implement marketplace persistence or authorization.

Open `http://127.0.0.1:4329` to select a synthetic test account. Each identity has a genuine GoTrue session and database role assignment; the launcher is a test harness, not a product role dropdown. Use developer → register/upload → reviewer → approve → Owner of test salon A → existing Market → activate/open/revoke. A second Owner owns test salon B; these are disposable test identities, not new product roles. The review launcher seeds one clearly marked synthetic approved app; connection remains unavailable until the developer configures and hosts its backend. Stripe is disabled in this harness. Stop with Ctrl+C to remove only owned test containers. Do not expose these loopback services or reuse their synthetic sessions outside local tests.

Focused checks:

```text
node --test tests/market-platform.integration.test.mjs tests/market-platform-payments.test.mjs tests/market-platform-commerce-boundary.test.mjs
node --test tests/market-registry-boundary.test.mjs tests/market-registry.integration.test.mjs tests/isolated-supabase-fixture.test.mjs
node node_modules/eslint/bin/eslint.js "app/(market-platform)/developer-platform" app/api/market-platform lib/market-platform
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Opt-in real Supabase/API test: set `RUN_MARKET_PLATFORM_FULLSTACK=1`, then run `node --test tests/market-platform.fullstack.test.mjs`. Opt-in real browser test after build: set `RUN_MARKET_PLATFORM_BROWSER=1`, then run `node --test tests/market-platform-browser.test.mjs`. Both clean their owned containers and record evidence under the configured `BOOKING_TEST_OUTPUT_DIR`. Browser test blocks external requests, forwarding only its approved example HTTPS app origin to a local reference backend. None of these tests establishes live Stripe onboarding/payments or production readiness.

## Release boundary and remaining requirements

The implementation starts from accepted private-registry commit `d4d0cc5e5f64d5c781e56a5b6709827b993f831c`. The current main checkout has different auth/registry source and unrelated work. This baseline is not a complete current release source. Before any later release, capture current live source, integrate only frozen authorized files, preserve shipped Explore/native/billing work, and rerun aggregate checks according to release policy. No deployment/push/publication or production migration is authorized here.

The full requested production marketplace is **not complete**. Before production, review automatic domain ownership proof, storefront integration with the current first-party catalog, pagination/rate limiting and abuse quotas across accounts, reviewer operations, a durable refund/support recovery queue, fully reconciled transfer/reversal/fee accounting, retention policy and the expanded security scope. External prerequisites include owner-approved commission, refund/dispute/tax/region terms, dedicated test provider configuration and provider sandbox verification. Organization teams/ownership transfer and browser OAuth are future extensions beyond the initial owner-provisioned hosted-app connection type. Production credentials, security migrations and live financial actions require separate explicit owner approval.


## Provider accounting observations

The balance observer follows a verified charge to its refunds, disputes, transfer/reversals and application-fee/refunds, then retrieves each linked balance transaction. Account/source/currency/integer amount-fee=net checks precede a service-only immutable observation. Duplicate observations are idempotent; conflicting contents fail closed. More than 100 adjustments stops for paginated reconciliation rather than truncating totals. The publisher sees only orders belonging to its apps. Pending quotes, gross capture, refunds, disputed unrefunded principal, quoted shares and account-level payout statuses are totaled separately in integer cents. An empty or partial observation list does not prove zero provider fees or final bank settlement.

Design references: [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html), [Shopify app lifecycle](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices), [Slack manifests](https://docs.slack.dev/app-manifests/), [Stripe balance transactions](https://docs.stripe.com/api/balance_transactions/object), [application fees](https://docs.stripe.com/api/application_fees/object). These inform the design; they are not evidence of actual provider execution.
Public credential RPC boundaries now accept the actual token/client secret/code/verifier and compute their hashes or PKCE challenge inside PostgreSQL. Digest-only runtime helpers are private and revoked from API roles. Tests explicitly reject replay of stored digests and substitution of the public PKCE challenge for its verifier. Requests use JSON bodies, never secret query parameters; credentials remain absent from stored manifests, workspace reads and logs.

## Four published-data groups and QR example — local source revision

Owner approved four separately scoped read groups: profile/hours, services/list prices, selected salon media and public content. See [contract](market-published-data-contract.md). Current source includes Owner opt-in publication UI at /market/data, strict snapshots/revisions, official grouped GET endpoints, a metadata-stripping media gateway and a self-hosted QR menu example with downloadable ZIP. Prior identity-only limitations above describe the older revision; customer/staff/POS/payroll/payment/write scopes remain unsupported. Current full GoTrue/Storage/browser QA for these groups is pending new temporary QA authorization; earlier identity-only acceptance cannot certify this new revision. No production migration or deployment has occurred.
## Local verification receipt — 28 October 2026

Four-group and QR actual local HTTP acceptance is recorded at `artifacts/market-published-qa/replacement-1/report.md`. It is distinct from hosted production/provider acceptance and from the post-QA Market read-recovery source correction. Current Market browser activation/update/uninstall remains a gate; the original opaque render failure is not declared fixed. Use `docs/market-acceptance-checklist-20261028.md` for the final evidence matrix, cleanup and remaining account/security/commercial requirements.

