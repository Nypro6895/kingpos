# Shop money, operating expenses and reconciliation

Owner authorization: implement the reviewed Shop/Expenses/Gift/Reward/Discount scope and publish after validation. Unentered receipts count as zero and shortage, remain in period totals, and late entries have an append-only before/after audit. Opening balances and all financial reservations are explicit; no staff compensation formula changes.

Baseline: reylumi.com deployment dpl_GEzx4DxiqsR1NnBuut4FjrkHLuKf, source c0d0ed32d95ea03dfd53509604f4971341ab56e3. All 3738 deployed source records restored from their verified byte manifest before editing. Shared dirty canonical checkout was not used as a release snapshot. Gift/Reward was already shipped on this baseline; preserve that implementation rather than importing an obsolete working snapshot. Unrelated pending Market/Check Writer/provider work is not activated by this release.

## Money model

- Inclusive Cash/Card/Other collection records are a distinct successor to legacy service-only inputs plus separately counted tips. Historical input facts are never rewritten or guessed into a tip tender. Legacy tips without tender remain explicitly unallocated. A saved legacy financial snapshot detects later service-input edits without mistaking lock/metadata updates for new collection amounts.
- Payroll projections use inclusive receipt inputs when available. Null receipts count zero. Staff daily earnings, commission, tax and payout rules remain canonical and unchanged. Calculated staff payout is labelled as calculated; it is not evidence that a bank/cash payment occurred.
- Remaining estimate = opening money + receipts - calculated staff net payout - paid operating expenses - recorded tax remittances. Available estimate = remaining - nonnegative tax reserve - unused gift balance as of period end - fee estimate when no actual fee entry exists. Remitting reserved tax reduces both remaining money and reserve once. Payments beyond the recorded tax reserve reduce available money and are shown separately.
- Prior gift liabilities require corresponding opening cash/bank money. Opening money includes tax/gift funds, and opening tax is not added again. Gift sales/redemptions, rewards and discounts are not added/deducted a second time. No accounting profit or verified bank balance is claimed.
- Recorded actual card fees replace the estimate. Estimates use configured rate and count of canonical card payment records, not proof of processor captures. Gross card collection input is required if fees are recorded separately.

## UI and persistence

Payroll retains one horizontally scrolling tab rail; owner Gift Cards, Rewards and Discounts are siblings of Shop. Shop breakdown/day editor is exclusive: opening one closes the other. Historical edit history remains available on each day. Reports has a monthly Expenses tab. Today has an inline amount/note/source/category quick entry. Expenses retain business date, paid timestamp, amount, note, category, source, revision and audit. Rent configuration offers one confirmed paid row per month, enforced by a unique month key; configuration itself does not invent payment. Optimistic revisions and a stable expense ID prevent silent overwrite and duplicate retries.

Gift reporting reads the existing authoritative ledger; rewards report points credited/debited/opening/closing, customer/bill references and actual discount data. Points are not converted into imaginary dollar balances. Activity lists cap at 500 and label the cap. Source business time zone is used for dates.

Owner-only RPCs, RLS without direct authenticated table writes, scoped application context, JSON/origin validation and a native scope-checked non-replayed command adapter protect new writes. No real customer/test transactions, notification sends, paid activation or external payments are part of verification.

## Verification and release evidence

Evidence is under artifacts/shop-money-20261031: regression-final.log, lint-final.log, build.log, acceptance-final.log, exact migration fixture hashes, browser screenshots/SQL readbacks, source inventories and deployment/native receipts. Local database/browser evidence is separate from hosted read-only checks, TestFlight processing and physical-device acceptance. A fresh iOS bundle is required for the changed packaged Payroll/Today/Reports and command mapping. No physical iPhone or printer acceptance is inferred from simulator tests.
