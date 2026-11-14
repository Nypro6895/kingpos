# Compact Staff payroll rows

## Details follow-up

The row now shows name, final Check/Cash and a real `Details` button. Formulas,
Tip/Bonus, applied settings and the original expanded content are hidden by
default on every viewport. Clicking Details toggles that row. Each web/app-local
staff list owns one selected row; opening another closes the previous row.
Separate payroll lists/retained pages do not affect one another. All child forms
remain mounted, preserving drafts and existing autosave behavior. Payroll math
and settings were not changed in this follow-up.

Validated with 50 Chromium cases (both languages, five widths, five data states):
default closure, Enter activation, same-row closure, exclusive opening,
independent list isolation, hidden content, retained drafts and no overflow.
Evidence: `artifacts/payroll-compact-settings-20261112/browser-details/results.json`.
The same 46 financial/access tests and TypeScript pass. Scoped ESLint has zero
errors and seven pre-existing unused-declaration warnings in the two page files.
App-local bundle verification passes (1,006 modules, 403 pinned actions, no
unsupported actions); no installed/signed bundle was changed. This follow-up
uses targeted validation; the full production build below belongs to the prior
compact-row implementation.

## Original implementation

Implemented from `ec2c292bb574d5db53a5bd4ea3c85dbfea376e9c` in the isolated
`payroll-compact-settings-20261112` worktree. No deployment or financial data migration.

The collapsed shared `StaffIncomeCard` starts with name, final Check, final Cash,
and the existing disclosure. Applied wage formulas sit below their channels;
net Tip/Bonus and tax status follow, then commission/fixed pay, Cash%, Check%,
and Tax%. Bonus remains visible at zero. Legal-name and negative-check warnings,
the original adjustment forms, payment/history controls, and daily breakdown remain.

Money comes from the existing canonical calculated or saved amounts:

- Check/Cash already include net extras. Never add displayed Tip/Bonus again.
- Tip is the sum of the engine's net tip channel amounts.
- Bonus channel fields are gross. Its displayed net is the residual of final
  channel payouts minus base wages and net tips, calculated in integer cents.
- Tax cash, fixed-pay exemption, tax tip, and tax bonus remain independent.
- The existing wage/tip/bonus arithmetic and authorization paths were not changed.

The UI reads historical applied snapshots rather than current owner settings.
Bonus uses the period-end setting, which can differ from every worked day.
That setting is retained as additive JSON metadata in the existing period input
snapshot. No schema change is required. Custom ranges collect only worked-day
rules and bonus settlements belonging to their selected dates. Mixed/unknown
rules show `Mixed settings`; old saved statements without a bonus rate say
`Tax` rather than borrowing a wage rate. Old money is never recomputed.

Validation evidence is under `artifacts/payroll-compact-settings-20261112/`:

- 46 focused tests: tax/payout matrix (32 combinations), rounding, fixed-pay
  exemption, period-end changes, mixed/sliced ranges, two-period bonuses,
  immutable saved values, payment evidence, access and concurrency.
- 50 Chromium component views: 320/390/430/768/1440px, English/Vietnamese,
  ordinary/taxed/long-name/negative/mixed/legacy states; no overflow or browser
  errors; disclosure retained an input draft while collapsed/reopened.
- TypeScript and scoped ESLint passed; full production build passed.
- App-local bundle verification: safari16 target, 403 pinned actions, 1,005
  modules, zero unsupported actions; no signed/bundled assets overwritten.
- Actual Next development server for this source on loopback port 43291;
  actual `/payroll?tab=staff` route authenticated against isolated local QA
  backend, one real QA row, no horizontal overflow, zero financial writes.
  Background dispatch disabled; outbound fetch blocked. Live Preview registered
  for the owning chat. Viewer authentication is separate from the QA browser.

One broader pre-existing history test (`payroll-compact-income.test.mjs`) cannot
start because its esbuild harness does not handle the imported
`inline-financial-history.module.css`. That harness/file was not changed; the
46-test result above excludes it. No live-account, provider, physical iOS,
TestFlight, or App Store acceptance is claimed.

Release integration must preserve both channels: web uses the shared component;
app-local iOS embeds the same component and needs a rebuilt bundle/native release
through the normal coordinator. A successful web build or bundle verification
does not mean an installed binary has changed.
