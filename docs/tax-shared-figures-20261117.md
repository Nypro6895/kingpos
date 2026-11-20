# Shared Owner and Tax Company figures

Implemented locally on the Owner Tax mirror source (`4d1e22d`). This change is
not a web deployment, hosted migration, native upload or physical-device acceptance.

## Behavior

- Each payroll item (Check wages, Cash wages, Tip, Bonus) has separate disclosure,
  withholding application and rate settings. A blank item rate uses the default
  rate. Nullable untouched overrides preserve previous rules.
- Disclosing an item never changes its withholding or take-home amount. For
  example, Check wages 1,000 at 20%, untaxed Tip 150 paid by Check, and untaxed
  Cash wages 300 plus Cash Bonus 50 yield Check 950 and Cash 350.
- New publications retain exact gross, withholding, net and payment-channel
  component values, together with the saved disclosure/application/rate choices.
  Partial custom ranges retain their source-day figures; Bonus settles once on
  its source period end. Mixed rates are not replaced with an average.
- No existing setting or published monetary row is rewritten. Older publications
  retain their original report figures and explicitly lack item detail. Current
  settings are never used to invent the old split.
- Owner and the authorized tax professional use the same SQL projection. Hidden
  component values, methods, rates and inferable totals are masked in the database.
  Owner access remains independent of Tax Company activation; professional
  connection/entitlement checks remain authoritative.

## UI and reads

The shared compact spreadsheet has grouped columns, pinned employee identity,
view-only cell inspection, a full-width expanded item table, a separate detail
sheet, column controls, and integer-cent totals. Professional paystub and
employee-document workflows remain available. Owner controls only affect views.

Owner uses one authenticated `tax_report_data` read and does not load documents,
messages, receipts or events. Filtering, selecting a cell and expanding a row use
the already scoped DTO without extra tax reads or mutation requests. Expanded
rows are created on demand. Professional version/paystub/line lookup indexes are
memoized. Loading fallbacks contain public chrome only, never a previous salon.

## Validation and evidence

The task evidence is in `artifacts/tax-shared-figures-20261117/`:

- `functional-tests.log`: 167/167 scoped tests across independent settings,
  financial calculations, SQL save/CAS/history, scoped reports, summaries,
  app-local compatibility, forms and Vietnamese copy.
- `legacy-daily-parity.json` and its reproducible audit script: 26,000 comparisons
  against the frozen prior daily implementation, including 12,000 signed-input
  cases, with zero differences in twelve financial/report fields when new
  overrides are absent.
- Actual Next-page browser QA: ten checks, 320/390/820/1440 widths, Owner/Tax
  equality, shared untaxed Cash/Tip, Check-only 20%, hidden values, legacy data,
  latest revisions, summaries, search, and preserved professional dialogs.
  No mutation requests or runtime errors. A six-employee expansion was observed
  at 136 ms; this is a local fixture observation, not a whole-app speed claim.
- `build.log`: optimized production build, TypeScript and app-local assets.
- `eslint.log`: 36 changed TS/TSX/MJS files, no errors or warnings.
- `production-isolation.json`: QA entry is 404 in production even with the opt-in
  environment flag; no sample figures or QA cookies are exposed. A streamed
  Next not-found page may retain HTTP 200 after its shell has streamed.
- `db-full/full-chain-result.json`: all 430 real migrations replayed in a
  disposable, network-isolated Supabase fixture; six schema/API/ACL checks passed.
  The four task-labelled containers were removed and existing containers remained.
- `browser/owner-tax-expanded.png`: actual local component with sample data.

The broad, older Vietnamese suite additionally has existing Profile wording and
application-wide missing-copy failures. The Profile result is identical to the
prior source, as recorded in `existing-translation-baseline.json`. New shared Tax
sheet/settings/loading copy has a separate passing coverage test.

## Release integration

Depends on `owner-tax-readonly-mirror-20261114`. Integrate with the exact current
production baseline; do not deploy this task checkout wholesale. Apply and verify
`20261117140000_tax_item_settings.sql` followed by
`20261117150000_tax_shared_report_projection.sql` before enabling the new source:
the new setting/line selects and numeric RPC require these additive definitions.
Do not backfill or republish historical payroll as part of release.

Installed older clients retain their resource contracts and saved item overrides
when omitted. The new Owner app-local UI and bundled settings require the ordinary
native bundle/build evaluation at release. Existing subscription, auth, workspace,
storage, publication and financial confirmation gates remain in force.
