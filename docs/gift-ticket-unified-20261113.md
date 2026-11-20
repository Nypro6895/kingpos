# Gift in the shared Ticket and Daily Report

Owner-approved implementation, November 13, 2026 (America/Chicago).

Source: branch `fix/gift-ticket-unified-20261113`, based on
`3bdbb17c682656d0b65627a8000ecdee6ef4bfb2` in
`C:\Reylumi-worktrees\gift-ticket-unified-20261113`.
This is an implementation handoff. No hosted schema, production transactions,
web deployment, installed Windows application or native binary was changed.

## Result

- A mixed sale lists services and Gift in one Ticket, one receipt and the same
  Reports list. Gift rows show value and masked card suffix. The Gift staff
  column stays blank: a recording operator or service performer is not proof
  of the Gift seller. The recording-operator audit remains unchanged.
- Gift-only has a numbered closed Ticket with an optional customer. It creates
  no service item, staff earning, turn or invented check-in.
- Cash/Card/Other selection classifies new Gift sale collection. A completed
  retry keeps the original classification and receipt identity. Older clients
  without a payment method retain `Other`; no processor charge is claimed.
- Gift sold/used and Reward used appear in Attention, directly linked to the
  real Ticket. Ignore stays per owner and source revision. Reward-only
  reductions are not announced again as ordinary Discount.
- The customer receipt, POS cart, Ticket, account receipt and Report share the
  Gift value. Issued Gift artwork and the owner's saved design remain intact.
- Gift delivery retains its paired dismissal, expiry, collection and next-customer
  controls. Success totals are bound to the exact closed draft revision or to
  the submitted local cart. The next draft cannot inherit settled Gift amounts.

## Accounting boundaries

`gift_card_counter_sales` remains the authoritative retail source. It is linked
to `pos_tickets`, including historical Gift-only sales. The added Ticket row
retains the original sale timestamps. Gift is projected as a typed receipt item;
it is never injected into performed-service rows to make the UI display it.

| Amount | Rule |
| --- | --- |
| Shop sale | Service receipt total + Gift sold, once |
| Discount and Reward | Performed services only; Reward is already part of canonical ticket discount |
| Suggested tip | Service base only |
| Gift used | Existing-value payment, not a discount or another sale |
| Staff production, commission, turns | Existing service inputs only |
| Expected item collection | Effective service inputs - total discount - Gift-paid services + Gift sold |
| Expected tip collection | Earned staff tip - Gift-paid tip, floored at zero |
| Staff tip obligation | Original effective staff tip, including the Gift-funded portion |

Example: service $50 + Gift $100, 10% service discount and $9 tip gives a
$154 receipt. Staff production stays $50. Daily collection is $145 plus $9
tip. Service $50 + tip $10 paid entirely with Gift gives zero new collection
while staff still earns the $10 tip.

No payroll formula or `final_staff_income` implementation was changed.
`loadPayrollReportExpected` continues to supply shop collection comparison,
not staff commission. Manual staff inputs and locked closing/payroll snapshots
are preserved. Historical linking does not reissue a card, debit it, rewrite a
locked closing or invent payment-provider evidence.

## Cross-flow protections

- Unspent sold value can be reversed through Ticket void, with its existing
  ledger trail. A spent card blocks the void atomically. Gift sale Tickets
  cannot be reopened; the UI omits that unavailable action.
- Creating a Gift-only Ticket for a known account bypasses automatic Reward
  enrollment/welcome credit. Wallet ownership and customer linkage still work.
  Receipts with service history, visits or Reward entries retain the original
  Reward reconciliation and reversal logic.
- `ticket_financial_sources` requires Ticket permission, signed Portable
  POS/Today capability, or ownership of every requested customer receipt.
  Report-only capability does not gain Ticket details. Foreign/missing receipt
  IDs reject the entire read. No card credentials or PIN are exposed.
- Booking/customer views add sources only for existing Ticket readers. Their
  write routes, account verification, customer matching and booking lifecycle
  are unchanged. Gift-only does not complete an active service visit.
- The original Gift/Reward settlement adapter still owns consent, quote,
  revision, expiry, atomic settlement, cancellation and idempotency.

## Verification

- `sql-source-final.log`: 27/27 tests passed against the actual complete schema
  in isolated network-disabled Supabase/PostgreSQL fixtures. Includes anonymous
  and known-account Gift-only, legacy linking with locked snapshots, payment
  replay, spent-card void rejection, source permissions, Reward consent and
  reversal, Staff/Holding and Portable settlement.
- `tests-accepted.log`: 26/26 component, calculation and regression tests passed.
  The UI suite checks seven actual product components at 320/390/768/1440px
  (28 layout cases); input editing also passed six existing browser scenarios.
- `ui-source-final.log`: final component captures passed after the test harness
  was updated to accept the configured browser path.
- `build-source-final.log`: production webpack build and TypeScript passed.
  Background dispatch was disabled. `offline-source-final.log`: 572 assets,
  12,329,344 bytes. No Windows executable was built or installed.
- Scoped ESLint: zero errors; two pre-existing unused-variable warnings in
  `owner-live-reports.tsx`. Windows CRLF-aware `git diff --check` passed.

At the original handoff, `portable-ticket-live-sync.test.mjs` failed its
`searchWidth > 140` toolbar assertion on both this branch and the unchanged
parent worktree. Evidence: `regressions.log` and `portable-baseline.log`. The
toolbar test and its production layout were not modified by this task. This is
recorded as an existing baseline failure, not a passing acceptance check.
The subsequent QA revision fixes the 320px toolbar and passes this unchanged
test; see `docs/gift-ticket-qa-seller-20261113.md` for that separate revision.

All logs/captures are under `artifacts/gift-ticket-unified`. These are real
components with synthetic boundary data and isolated database tests, not hosted
or physical Windows/iPhone acceptance. The optional Live Preview viewer was not
running; no mock or production page was registered as a source preview.

## Integration and release

The completion journal is `needs-integration`. Integrate the frozen scoped
patch and dependencies onto the exact current production baseline; do not
replace that baseline with this older worktree. Apply the validated migration
and shared web code as one release and rerun integration checks.

No Swift, Electron host, entitlement, updater or native bridge ABI changed.
The local receipt message adds optional fields compatible with existing
readers. Publication still needs the normal native assessment against the
actually uploaded iOS bundle and a Windows Portable package refresh for its
bundled/offline assets. This handoff is not proof of an installed update.
