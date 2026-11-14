# Gift Ticket QA and seller attribution

Owner-requested QA follow-up, November 13, 2026 (America/Chicago).
Branch `fix/gift-ticket-unified-20261113`, based on `b676bc6`.
Depends on `gift-ticket-unified-20261113`; this is an isolated source revision,
not a deployment, schema publication or installed Windows update.

## Corrections

- A Gift row has no assigned staff or seller. Kim performing Full Set does not
  establish that Kim sold the Gift. The authenticated recording operator also
  does not establish the seller. Owner detail, the shared app detail, compact
  Ticket, service editor and printable receipt all follow this rule.
- Existing `actor_id`/`actorName` values remain recording-operator audit facts.
  No audit history, staff work, turn, commission or payroll value is rewritten.
- A Gift-only Ticket with a named customer no longer says `Walk-in sale`.
  Anonymous Gift-only still supports a real closed Ticket without customer,
  service work, Reward enrollment or an invented visit.
- Owner and Portable Ticket search include the Gift label, masked four-character
  suffix and retail amount. Owner search also includes the original Ticket
  number. Recording-operator names are not indexed as Gift staff or sellers.
- At widths below 360px, the existing date button uses its calendar icon and
  retains its full accessible date. This leaves usable space for Ticket search
  and actions. Date selection, history, search, midnight and live synchronization
  remain governed by the existing logic.
- The approved presentation also removes its three hard-coded `Sold by Kim`
  labels. This is a proposal correction, separate from product acceptance.

## QA evidence

Evidence directory: `artifacts/gift-ticket-qa-seller`.

- `seller-before.log` reproduces the original receipt attribution failure.
  `seller-after.log`: 11/11 calculation/receipt checks passed, including Kim
  performing a service and recording a sale, a different operator, and no
  operator name. The Gift staff field stays blank in every case.
- `sql.log`: 28/28 tests passed on the actual complete schema in network-disabled
  Supabase fixtures. Includes mixed/Gift-only sale, operator-vs-performer audit,
  payment classification/replay, spent-card void rejection, legacy linking,
  Reward consent/reversal, permissions, and service/tip reconciliation.
- `checkout-sql.log`: 7/7 further complete-schema checkout checks passed. Covers
  read-only pending-point estimates, late/foreign tip saves, idempotency,
  matching Reward receipt facts, partial Gift funding, paused earning and an
  in-flight request arriving after the customer changed.
- `ui-flows.log`: 32/32 component/calculation/authority checks passed.
  Actual product components cover 13 screens/states at 320/390/768/1440px
  (52 layout cases): named/anonymous Gift-only, mixed payment, Gift used,
  ordinary Discount + Reward, voided sale, service-only, customer receipt,
  Report, closing, Attention and completion.
- `checkin-design.log`: 12/12 check-in lifecycle, owner artwork and default-art
  checks passed. Saved owner designs still win over shared defaults.
- `toolbar-before.log` reproduces the prior narrow-search failure.
  `toolbar-after.log` passes the unchanged Portable/Owner synchronization and
  calendar regression at five widths. `editor.log` passes six existing service,
  custom-service, independent tip and reason/revision editing cases.
- `search-before.log` and `search-after.log` run the actual Owner/Portable filter
  functions against a Gift-only Ticket. Gift and masked suffix now match;
  `Kim` still does not match merely because she recorded the sale.
- `ui-final.log`: all 20 affected component/search-toolbar/receipt/authority
  regression checks passed after the final search changes. Scoped ESLint has
  no errors and one pre-existing unused `staff` warning in `owner-live-tickets`.
- `actual-app.log` and `actual-app/results.json`: the actual Next Portable and
  Owner routes, API and complete isolated database passed ten journeys. Includes
  anonymous Gift-only, mixed Full Set by Kim + Gift, both detail views, Gift/card
  suffix/Ticket-number search, edit/cancel and Report reconciliation. Services
  remain $50, Gift sold $200 and expected collection $250. No browser errors.
- `build.log`: production webpack compilation and TypeScript passed.
  `offline.log`: 572 assets, 12,330,175 bytes. Background dispatch was disabled.
  Browser fixture screenshots use synthetic data; they do not establish
  acceptance of an installed executable. The fixture has no Realtime provider:
  API/polling and separate two-screen lifecycle tests are the evidence for this
  source QA.

## Windows and release boundary

Computer Use inspected the existing KingPOS 0.7.5 window, Settings, Tickets and
paired customer display. That window serves hosted `reylumi.com` and does not
contain this local source revision. No hosted transaction or installed binary
was changed by this QA task. Its existing pending Gift selection was preserved.

The optional Live Preview is registered to the actual source server on
`http://localhost:6137/pos-tickets`; it was not opened automatically. Local
authentication still applies. The actual-app fixture uses `localhost` to match
Next's local request origin; product origin/security checks are not bypassed.

Integrate the frozen patch with its dependency and the current production
baseline before release. No Electron host, Swift or native bridge change is
included. Shared web/offline assets still need the normal Windows packaging and
native-release assessment; source tests are not installed-device acceptance.
