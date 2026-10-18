# Campaign admin operations — 2026-10-17

This is an implementation overlay, not a production publication. It depends on the Campaign workspace and follow-up overlays and their migrations.

## Entry points

- **Ad reviews**: `/admin/advertising/reviews`. Dedicated `admin.advertising.review` permission, granted to platform owner, operations admin and support agent. It does not grant pricing, billing or team management. Preview, approval and decline run under the review permission; a decline requires a reason. Decisions and reasons are audited. The salon can see the decline reason in campaign results.
- **Review alerts**: the admin top bar shows persistent review notices, unread counts, dates and direct links. Notices are created in the funding transaction when an ad actually reaches pending review, including automatic funding. Retries do not duplicate notices. Existing waiting ads are backfilled. Read state belongs to each reviewer; resolved notices remain in recent history. No email, SMS or push to external recipients is added.
- **Campaigns plugin operations**: `/admin/market/credits`, linked from Market & System. It retains the existing Market restriction to the platform owner. Separate paginated views for purchases, credit activity and balances; salon-name search and purchase status filters. Rows link across views with salon context.
- **Plugin settings**: editable within Market → Campaigns, grouped into credit/view rules, location adjustments, duration/display caps, welcome credits/suggestions and illustrative engagement. Advertising uses the same panel and configuration. Permission remains `admin.advertising.manage`.

## Credit denomination

The owner explicitly selected **$1 = 120 displayed credits**, replacing the earlier 12-credit denomination. All displays, input steps, wallet thresholds, per-campaign caps, monthly limits, packages and payment consent use the new denomination together. Underlying integer ledger units, balances, money amounts, agreed rates and card authorizations are unchanged. Existing displayed balances/caps/usage become ten times the earlier display to preserve their value. No account receives a new financial grant from this change.

One stored unit displays as 1.2 credits. Round trips preserve every integer unit; input steps are 1.2 credits. Currency appears in payment confirmation and admin billing, rather than throughout the owner campaign UI.

Default maximum 500 views/day:

| Location | Credits/day | 3-day ceiling | 7-day ceiling |
| --- | ---: | ---: | ---: |
| Neighborhood / ZIP | 96 | 288 | 672 |
| City | 120 | 360 | 840 |
| State | 180 | 540 | 1,260 |
| Country | 240 | 720 | 1,680 |

Welcome grant: 360 credits, once only. Existing packs display as 600 / 1,800 / 6,000 credits for their unchanged purchase amounts. The previous minimum-price rule and formula are preserved. Likes, comments and bookings are measured outcomes, not separately purchased or guaranteed engagement.

## Prospective configuration

Each new campaign stores a configuration revision and immutable-at-creation snapshot in addition to its existing agreed daily price, selected views, duration, location and credit ceiling. Saving a configuration uses an expected revision, database validation, history and an audit record. Two admin windows cannot silently overwrite each other.

Owner creation checks the revision visible in the form while holding the settings row lock through insertion. An old form receives a refresh/review message; it cannot silently submit against a newly changed view rate. A retry of an already-created campaign remains idempotent.

Delivery frequency and person/day caps now use the campaign snapshot. Old campaigns and their continued periods retain agreed prices and caps. Running again creates a new campaign and uses current defaults. For ads predating this migration, existing monetary terms stay intact; only the formerly shared delivery caps are backfilled from the currently installed configuration because their historic values were never stored. The existing emergency global delivery switch, source safety, active ownership and installation checks remain global safeguards.

## Payment operations

- **Check payment & sync credits** reads the existing checkout/payment reference and verifies matching order metadata, completion, currency and amount before replaying idempotent fulfillment. It never sends a new charge. For an unknown automatic outcome, the operator can supply a provider payment reference; absence of a reference does not trigger another charge.
- **Cancel unpaid checkout** first expires the provider checkout and preserves a completed payment. It is not a refund tool.
- **Stop future automatic purchases** locks the wallet, cancels only unclaimed pending automatic orders, disables future automatic funding and records actor/reason. A payment already processing may still complete; funded ads retain reserved credits. It never impersonates fresh owner consent or enables automatic purchases for a salon.
- Financial operations require the existing platform-owner Market access. Requests and completed operations have audit records. There is no manual “mark paid,” unverified credit grant, new debit or automatic retry charge in these tools.

## Release and validation

Required new migration: `20261017235000_campaign_admin_operations.sql`, after `20261017210000_owner_campaign_workspace.sql` and the existing platform-admin migrations. Publish the new owner creation action, settings revision reads and migration together. New routes use existing web/native contracts; no new native bridge or permissions are introduced.

Evidence is under `artifacts/campaign-admin-20261017`: database integration checks for permissions, notices, versions, immutable old terms and continued periods; payment-provider mocks that reject new charge attempts; owner and admin browser checks; TypeScript, ESLint and isolated production build. No production migration, payment, notification send, role grant or deployment was executed during implementation.
