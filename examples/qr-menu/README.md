# Salon QR Menu — self-hosted reference plugin

The hosted QA reference supports existing verified TOTP factors with a bilingual
challenge screen, encrypted pending sessions and bounded retry/cancel recovery.
Read `MFA.md` before testing. No accounts or factors are provisioned; real hosted
Auth acceptance remains separate and the reviewed target stays disabled.

This example consumes only the official four published-data APIs. It has no Reylumi database/service-role access. The optional PostgreSQL adapter uses only the plugin developer’s own database. QR generation is local via node-qrcode; no image or secret is sent to a QR provider. The platform's service key, if configured, stays inside Reylumi's image gateway.

## Prepare

1. Use your existing Reylumi developer account/organization. Copy `manifest.json` and replace the exact HTTPS launch/privacy/support URLs with your own origins. Launch/callback path is `/connect`. Submit a version, not an executable package.
2. The manifest requests exactly `salon:profile:read`, `salon:services:read`, `salon:media:read`, `salon:content:read`. No customer/staff/POS/payment/write scope is requested. API schema/fields are documented in `../../docs/market-published-data-contract.md` (also included as CONTRACT.md in the downloadable archive).
3. In this folder run `npm install` (or use the workspace installation). Configure `REYLUMI_MARKET_API_ORIGIN`, `REYLUMI_MARKET_CLIENT_ID`, `REYLUMI_MARKET_CLIENT_SECRET` and `QR_MENU_PUBLIC_ORIGIN` in the backend process environment/secret manager. Never put raw values in a manifest, frontend, URL, command transcript or committed env file.
4. `npm start` binds only127.0.0.1:4344. This is a local reference, not a hosted deployment/tunnel. For hosted use, inject the PostgreSQL adapter and your authenticated app Owner resolver as described in `STORAGE.md`. HTTPS/production startup rejects a missing adapter, insecure cookie or missing resolver. The CLI remains a loopback demo: its bounded in-memory state and QR IDs reset on exit.

## Developer sandbox before review

Create a version-specific sandbox in Developer Testing (token24h/1000successful requests), provide it only as backend `QR_MENU_SANDBOX_TOKEN`, then open `/sandbox`. No client secret is needed in this mode. Sandbox preview is allowed only with a loopback public origin; it refuses responses with synthetic=false. Each render fetches four groups, so requests consume the quota. Media starts empty; this is not evidence of a real photo-storage pipeline.

No token is embedded in the resulting QR or menu URL. This mode intentionally cannot publish a synthetic fixture on a public host. Stop the process and remove the sandbox token afterward.

Preapproval OAuth is also supported: configure the client, create the synthetic salon and choose Prepare synthetic app connection in Developer Market. The reference carries reylumi_sandbox=true through login and sandbox=true to the authorization endpoint, then uses the usual token endpoint. Hosted synthetic connections have an authenticated private preview only; no public QR/menu/image is issued. Loopback synthetic previews may generate a local QR. Reset, secret rotation, suspend and erasure revoke synthetic access.

## Owner activation / actual menu

After independent review, Owner selects the existing salon in Market, opens Manage data shared with plugins and explicitly publishes chosen fields in each group. Profile/services must be published for the menu. Media/content can be published empty; if later unpublished those sections disappear rather than serving stale data. Apps with missing required permissions fail closed.

Owner consents/installs the approved version and chooses Open. `/connect` validates the launch identifiers, creates a state/PKCE session, follows the official authorization endpoint, then exchanges the single-use code on the backend. Callback moves immediately to `/manage`; credentials are not shown in the UI. `/manage` previews a QR and offers responsive menu, PNG and SVG downloads.

QR contains only `QR_MENU_PUBLIC_ORIGIN/menu/PUBLIC_MENU_ID`. Public menu ID is a routing identifier for already-published business content, not an API credential. No salon/customer phone, secret, token, authorization code or PII is encoded in the QR. A127.0.0.1 URL will not work from another device; no Internet reachability is claimed until you supply actual approved hosting. Changing public origin/callback requires a newly reviewed manifest version.

Every menu/image/QR request rechecks official API authorization/publication. It does not serve cached old salon content after unpublished/scope denial/uninstall. Same menu URL reflects Owner-published revisions. After version update old grants stop; Owner must consent/open the reviewed update before the app can replace its grant. Reconnect for the same installation reuses the existing public menu ID (durable across restarts when PostgreSQL is configured). Uninstall/revoke returns unavailable/410; image unshare returns404. No booking, checkout, writes, email/SMS or AI calls occur.

Images are proxied from the official metadata-stripping image endpoint only. It verifies current selection; no Supabase storage paths or original EXIF are requested by the plugin. An unavailable image gateway returns an error instead of fetching originals as fallback.

## Current tests and gaps

Run from repo root: `node --test tests/qr-menu-example.test.mjs tests/qr-menu-sandbox.test.mjs tests/market-public-price.test.mjs`. Tests execute the real HTTP example/QR generator, decode PNG back to the exact URL and exercise updated/unpublished/wrong-tenant/removed-photo/revoke states with a clearly synthetic API fixture. Separate PGlite tests execute the platform migration/security logic. The local authenticated browser suite now covers developer registration, exact publisher review, synthetic preapproval PKCE and fixed generated image, Owner activation, draft/live continuity, revoke and tenant isolation. Real selected-image storage, hosted TLS/Auth and physical-device acceptance remain separate.

The PostgreSQL adapter is implemented and tested locally; deployed PostgreSQL, HTTPS, host authentication, backup/restore, key management and provider acceptance remain separate checks. See `STORAGE.md` for the concurrency limit and recovery procedure. `HOSTED.md` covers the implemented Node22 serverless entrypoint, verified QA app login and private SQL bootstrap. The reviewed QA target is disabled by default. This is not a billing or product-quality certification.

## Limits and transient refresh failures

The current reference uses an encrypted exact-attempt refresh receipt to recover a lost response for up to 90 seconds. Revoke/rotation still deny access; expired/legacy uncertainty requires reconnect. See STORAGE.md. Market responds with 429 and Retry-After when the per-installation data/media/code/token budget is reached. These local defaults are resource guards, not a hosted throughput guarantee or a subscription allowance.
