# Campaigns: owner fixes and configuration audit

Scope: local implementation; no publication, production configuration, real charge or permission change. Calculations below use repository defaults, not a verified live configuration.

## Implemented

- Center both Campaign modal families in the native dialog top layer, restoring margin after the shared CSS reset. Keep tall dialogs scrollable inside the viewport.
- Start creative preparation when advancing from photo/message; allow audience and credit-limit entry while it uploads. Reuse the same pending promise at final save. A failed upload can retry with the retained file and choices. Success requires the saved creative and successful campaign action; no invented percentage.
- Fix salon post selection: original looks/updates tables have no deleted_at column. Read the salon's published rows, exclude optional held/deleted rows before returning only picker fields. Final creation still checks source eligibility server-side.
- Put current status beside the result heading; remove its duplicate in the location line.
- Correct admin Advertising and Market credit denomination to 12 credits per dollar. Show welcome grants, daily limits and campaign usage in the same credits as owner. Preserve underlying balances and agreed rates.
- Add a pending-review count/link on the admin dashboard for existing advertising managers. Fetch pending reviews separately, oldest first, so recent completed campaigns do not hide the first 100 waiting ads. Refresh after a decision. Market links to the existing shared configuration/review screen.

## Rules currently connected

Both the owner quote and creation use owner_campaign_settings. The server validates the quote; saved campaigns retain their agreed view rate and price. Default settings:

| Rule | Default | Meaning |
| --- | --- | --- |
| Denomination | $1 = 12 displayed credits | Presentation of existing integer ledger units; not an admin-editable exchange rate |
| City minimum/day | 12 credits | Applies before location adjustment |
| Daily views per 12 credits | 500 | Maximum delivery, never a promised result |
| Duration | 1–30 days | Owner chooses; maximum is adjustable |
| Daily view selection | 100–10,000 | Owner chooses a maximum |
| Open campaigns/salon | 5 | Adjustable |
| Welcome grant | 36 credits | Once only; existing balances do not reset |
| Frequency | 2 views/person/campaign/day | Adjustable |
| All ads frequency | 6 views/person/day | Adjustable |

Quote in existing integer units: ceil(max(minimumDailyUnits, ceil(dailyViews * 100 / viewsPerDollar)) * locationPercent / 100), multiplied by days, then displayed at 0.12 credits/unit. The credit ceiling can stop the campaign sooner. Spending follows admitted views; days are the delivery window, not a separate charge on top. Partial-unit spending rounds cumulatively to the ledger unit. Unused reserved credits return on ending/cancellation/rejection.

At 500 maximum views/day:

| Location | Adjustment | Credits/day | 3-day ceiling | 7-day ceiling |
| --- | ---: | ---: | ---: | ---: |
| Neighborhood | 80% | 9.6 | 28.8 | 67.2 |
| ZIP | 80% | 9.6 | 28.8 | 67.2 |
| City | 100% | 12 | 36 | 84 |
| State | 150% | 18 | 54 | 126 |
| Country | 200% | 24 | 72 | 168 |

At 1,000 city views/day the ceiling is 24 credits/day. At 100 city views/day it remains 12 credits/day because of the minimum. Therefore reducing the selected view limit below 500 currently worsens the maximum cost per delivered view. Recommendation for a future pricing decision: either remove low-view presets below the minimum-covered volume, or approve a proportional minimum policy; do not silently change existing campaigns.

Likes, comments and bookings have no separate charge or guarantee. Example rates (69 likes, 10 comments, 3 bookings per 1,000 views) only drive a clearly labeled illustration; actual reporting uses events/conversions. Do not describe these as purchased engagement.

## Review and Market gaps / placement

- Existing state flow: credits needed → pending review → running → paused/finished/cancelled; rejection returns unused credits. An image saved in the background is only a creative draft and does not itself submit or fund an ad.
- Review already exists at /admin/advertising and requires admin.advertising.manage. Defaults grant it to platform_owner and operations_admin, not support_agent. Dashboard reminder uses exactly that existing permission. It is a live queue count, not a newly created notification-inbox message.
- Recommended support workflow: a separate ad-review permission and queue (preview, approve, decline, reason, assignment, audit), without access to change credits, pricing, payment configuration or general ad settings. This permission change needs a separate reviewed authorization under release policy; no broad grant was made here.
- Market Campaigns is a distinct credit product, not a recurring plugin subscription. Installation entitlement, welcome grant, wallet, checkout fulfillment, webhook handling, automatic purchases and campaign funding already connect through the Campaigns ledger. Generic Market subscription invoices are not the Campaign credit purchase ledger.
- Market is the entry point and payment connection; Advertising is the one place for delivery rules and review. Avoid duplicating editable pricing controls. The Market card now points there.
- Existing auto-buy controls: opt-in, threshold, pack size, monthly purchase ceiling, saved payment method and blocking. Failed/blocked purchases do not authorize delivery without reserved credits; already-funded ads retain their existing reservation. An in-flight provider payment can still finish after opting out; this is disclosed in the existing payment UI.
- Still separate work: a dedicated support review permission/queue and notification-inbox event, campaign-credit purchase/failed-payment operations visible inside admin Market, and an editable/versioned exchange-rate policy if desired. These are not implied by the repaired links or the queue count.
- Live database, deployed migrations, provider delivery and actual salon posts were not verified against production in this local change. The earlier workspace migration remains a release dependency.

## Verification

See artifacts/campaign-followup-20261017 for typecheck, lint, browser and rule tests. Browser tests simulate delayed image readiness and verify that final campaign submission waits, with one upload. No test sends a real payment or notification.
