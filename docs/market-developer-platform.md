# Reylumi Market developer guide

Current local source contract. Hosting, production integration and paid commerce require separate acceptance.

## 1. Start with your Reylumi account

Sign in to Developer workspace with your existing Reylumi account, or create one from the sign-in page. Register your publisher organization, then save its public support email and HTTPS website. Your private account security settings are separate. One account owns the organization; team invitations and ownership transfer are not available in this release.

## 2. Prepare your hosted app and manifest

Apps run on your own HTTPS backend, outside Reylumi. Download the manifest example and adapt it to your app. Use schemaVersion 1, type hosted-app, a stable version such as 1.0.0, name, description, launchUrl, privacyUrl, supportUrl, scopes and a USD one-time-version price. Prices are integer cents: zero for free. URLs must use lowercase public HTTPS hosts without ports, credentials, queries or fragments. Upload JSON only, at most 16 KiB. No code archive is executed by Market.

## 3. Request only the data you need

Supported reads are salon:identity:read plus four independent publication groups: salon:profile:read, salon:services:read, salon:media:read and salon:content:read. A QR Menu normally requests the four publication groups. Owners explicitly publish selected business data; installing an app does not publish data. Draft edits keep the live revision online until the Owner publishes changes or stops sharing. Customer, staff, payroll, POS, financial and write APIs are unavailable.

## 4. Create an app or update the correct app

In Apps & connections, explicitly choose Create a new app or an existing app before uploading. For a rejected or updated version, select the existing app to preserve its client ID and history. The local preflight shows requested permissions, address changes and version reuse. Upload and submit version currently sends the version to the review queue immediately. Submitted versions are immutable: changed content requires a new version. An identical retry can return the existing submission.

## 5. Configure credentials and test safely

The app ID is its client ID. Generate the client secret once and store it only on your backend. Rotation invalidates existing connections. The exact launchUrl is also the callback URL. Create a version-specific sandbox under Testing & readiness: its bearer token lasts at most 24 hours and permits 1,000 successful synthetic API calls. Reset replaces the token and current counters; recorded version observations are retained. After configuring the client, choose Prepare synthetic app connection and Open app with synthetic connection. The app forwards reylumi_sandbox=true as sandbox=true to the usual authorization endpoint and exchanges its code at the usual token endpoint. PKCE, client credentials, single-use codes and rotating refresh are enforced before approval, with fake salon data only. These grants expire with the 24-hour sandbox; reset, secret rotation, suspension and account erasure revoke them. Do not interpret its checks as hosted or security certification.

## 6. Implement the server connection

The Owner opens the app from Market for the selected salon. Validate the launch parameters against your configured Reylumi origin and client ID, then use state and PKCE S256. Exchange the 60-second single-use code at POST /api/market-platform/v1/token using your server-held client secret. Access tokens last 15 minutes; rotating refresh grants have a 30-day absolute lifetime. This is not third-party SSO. Never trust a posted user ID, copy an Owner token, expose secrets in browser URLs, or automatically replay a refresh whose result is unknown. Require reconnection when necessary.

## 7. Handle publication, errors and review

Read GET /api/market-platform/v1/published/profile, services, media and content with your server bearer token. Fetch selected images through the media/ASSET_UUID gateway; do not request original storage paths. A 404 means a group is not published; a 403 can mean missing scope, expiry or revocation; infrastructure failures must remain visibly unavailable. Do not serve stale private or revoked data. A reviewer independently approves the exact version/hash. Record negative tests for wrong salon, state/PKCE, replay, expiry, rotation, update and revoke. Rejection requires a new version; see the recovery guide.

## 8. Accept the release boundaries

Approval makes a version eligible for Owner installation, not a guarantee about independently hosted code. New versions never silently replace an installation; changed versions require fresh Owner consent. Withdrawal and suspension block runtime access. The downloadable QR serverless reference is a disabled, allowlisted QA profile, not a production-ready sign-up service. Real hosting, account recovery, TLS, durable storage, restore and device behavior need separate acceptance. Paid commerce remains isolated test mode pending approved terms, provider acceptance and entitlement integration; a manifest price or sandbox result does not enable real payments.

## Operational limits

Organizations may have at most 50 apps and 100 immutable versions per app. At most 30 new versions may be submitted in a rolling hour; exact immutable retries remain available. The reviewed publisher name is locked after any approved version; support details remain editable. Names and URLs are declarations, not domain-ownership verification or hosted-code certification. No first-party entitlement derives from a name or URL.

See docs/market-published-data-contract.md for publication and docs/market-developer-platform-history-20261103.md for chronology.

### Suspension and restoration
App suspension/withdrawal permanently revokes existing Owner and synthetic connections, pending codes and refresh retry receipts. Restoring availability does not restore consent: Owners must activate and reconnect; testers must reset their synthetic salon and reconnect. Other live eligibility conditions (salon/account status, Owner role and entitlement) currently pause access while ineligible; they are not a substitute for the app suspension or Owner Remove action when permanent revocation is intended.

Integration preflight: run `node scripts/verify-market-migration-checkpoint.mjs` before any shared migration apply. The ten new migrations are frozen in docs/market-migration-checkpoint-20261103.json (LF-normalized hashes). Earlier review drafts only ran in disposable fixtures; they must never be used as a shared baseline. Stop on mismatch; do not regenerate the checkpoint to bypass a mismatch. Future fixes must use new migration files. Re-run actual hosted acceptance after applying the verified set.

Receipt retention:120 seconds is replay validity, not a physical deletion deadline. Remove/reconsent/version change, credential rotation, synthetic reset and app suspension delete associated receipts immediately. Other expired rows are lazily pruned on that client's next refresh. A private DB-admin-only market_platform.prune_expired_refresh_receipts() maintenance function removes all expired rows; a hosted maintenance schedule and its monitored retention objective must be configured during authorized QA, not silently assumed here. If there is no lifecycle event, refresh or maintenance run, encrypted receipt metadata can remain after expiry; it is still unusable for replay.
