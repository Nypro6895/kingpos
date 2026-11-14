# Approved Staff payment ledger and live Bonus

Implementation follows the approved collapsed/expanded mockup. Collapsed rows
show name, final Check, final Cash and a muted Details button. Expanded rows show
applied settings, service sales, canonical take-home, commission/fixed pay, the
Gross / Tax / Net / Paid via ledger, check number with Print check, and the daily
service/tip listing with pencil controls. Only one staff row opens in its list.

Bonus is the existing controlled, autosaved **gross** bonus input inside the ledger
cell, with a visible currency sign and border. There is no hardcoded $20 default.
Successful saves refresh the existing server calculation for the header, tax,
net and payment channels. Drafts/pending saves keep the existing navigation and
refresh guards. Enter submissions now capture the submitted signature just as
debounced/blur saves do. Source fields and compare-and-swap baselines remain intact.

## Financial authority

`staffPayrollPaymentRows` is a presentation of existing calculated amounts:

- Check gross is `check_gross`; Cash gross is total base wages less Check gross.
- Check/Cash net wages use `base_check_amount` / `base_cash_amount`.
- Net Tip uses the existing net tip channel fields. Net Bonus uses the existing
  final payout residual after subtracting base wages and net tips, in cents.
- Each Tax cell is that row's gross minus its calculated net. Rates/methods use
  applied historical settings; mixed settings remain labeled as mixed.
- Header Check/Cash and Take-home remain their canonical final values. Tip/Bonus
  are included once. No wage, tax, tip or bonus calculation was changed.

Legacy adjustment/history and recorded-payment controls are retained. Recorded
payments are an optional disclosure; printing or entering a reference never
marks Payroll paid. Daily pencil edits reuse the existing revision, reason and
unknown-result safeguards in `StaffDayFinancialEditor`.

## Check Writer references

The plugin already persists issued numbers. Payroll now reads their minimal
identifiers from `payroll_issued_check_references`, restricted to the active salon
Owner and exact period. No bank/snapshot payload is exposed and no issued number
is copied into Payroll source data. References load only for the Staff tab in
both web and app-local page reads.

The check-number field automatically displays a saved issued reference and is
read-only for plugin-owned numbers. Its hidden manual value remains unchanged
when saving Bonus. Leading zeros in manually entered references are preserved.
Conflicting manual/plugin references are visible rather than silently replaced.
Unavailable reference reads disable reference editing while preserving Bonus
editing and the original manual baseline. Voided checks are excluded.

Migration `20261113051000_payroll_check_references.sql` adds the read-only RPC
and two reference guards sharing Check Writer's salon advisory lock. They reject
conflicting manual edits after issuance and issuance after a conflicting manual
edit, including overlapping periods. Bonus-only saves and existing payroll
money are unchanged. Apply this migration with the coordinated release; it has
been applied only to the isolated QA database in this task, with zero financial
rows changed. No production migration or deployment was performed.

## Validation

Evidence: `artifacts/payroll-payment-ledger-live-20261112/`.

- 48 focused tests: canonical ledger reconciliation across the payout/tax
  matrix, fixed exemption, mixed/sliced periods, payment authority, permissions,
  concurrency and Check Writer read-only behaviour. Disposable PostgreSQL tests
  verify owner/period isolation, no snapshot exposure, void exclusion, leading
  zeros, both conflict orders and unchanged bonus-only saves.
- 50 responsive component cases, EN/VI, 320–1440px, including exclusive Details,
  retained drafts, long names/negative amounts and no overflow.
- Actual web and app-local pages plus the actual Payroll calculator pass a
  controlled local transport test: initial $20 bonus, live changes, Enter check
  reference, latest edit during a delayed save, taxed bonus moved to Check,
  issued reference display/read-only protection and retained state. Twelve
  intentional fixture saves, no duplicates; zero production writes.
- Actual authenticated Next route against isolated QA: Details opens/closes,
  no horizontal overflow, zero financial writes. Live Preview registered on
  loopback port 43291 for this exact source; viewer authentication is separate.
- TypeScript, scoped ESLint, full production build and app-local bundle
  verification (safari16 compile target, 403 pinned actions, zero unsupported
  actions). No physical Safari/iOS, printer, hosted/provider, TestFlight or App
  Store acceptance is claimed. The iOS bundle must be rebuilt by the release
  coordinator; verify-only does not update installed binaries.
