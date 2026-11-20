# Tax workspace refinement — 2026-11-10

Implementation only; no deployment, remote push, production migration or native upload.
Depends on the frozen `tax-workspace-20261109` implementation. This follow-up has
its own incremental source receipt; neither working checkout is a production baseline.

## User-approved behavior

- Owner changes apply to whole payroll periods. The existing setting editor defaults
  to the next period relative to the displayed period. Picking a date aligns it to
  its salon-calendar period start. Applying the entire displayed period requires
  confirmation. Both the server action and SQL trigger reject mid-period starts;
  the trigger also rejects mid-period ends. Monthly, semi-monthly and anchored
  biweekly schedules use the existing salon calendar. No arbitrary biweekly anchor.
- Existing published statements and historic setting rows are not rewritten.
  Existing legacy mid-period rows are not silently relocated or erased. A new
  whole-period replacement conflicting with one is rejected with an explicit error.
  An existing legacy row may be closed at a valid boundary. Existing payroll math
  remains authoritative; only the setting scheduling boundary is restricted.
- Setting changes create a lightweight owner-visible/Tax-visible activity notice
  containing effective date, not draft amounts. Tax sees published statements;
  after an updated statement is published, refresh/focus polling selects the latest
  version of the same period and shows new numbers. No new email/push infrastructure.
- The main Windows sheet shows legal name, reported wages, reported tips, reported
  bonus, total reported, salon withholding, check amount and the paystub action.
  Tip and bonus are included in total, not additional payments. Check payout is
  separate from reported gross; it may include nonreported payout components and
  exclude cash already paid. Business/employee identity source documents stay in
  Documents; no new tax calculation or return preparation engine.
- Historical reported tip uses the canonical stored taxable gross less stored
  reported wages and reported bonus, preserving partial inclusion without showing
  all period tips. Historical mixed rates show no fabricated zero rate. Summary
  component totals add the reportable portions across periods where reporting was
  enabled/disabled. Raw sales and unshared cash/tips remain excluded.
- Manual employee status, row conversation and version buttons are removed. Current
  paystub means View; missing/obsolete means Upload needed. Replacement archives the
  old result. Updated amounts produce a lightweight alert while replacement is
  pending. Existing conversations/history remain in their tabs; old work records
  are preserved but no longer drive pending counts.
- Filters occupy a compact toolbar; custom dates expand on demand. The bottom of
  the sheet explains each value, inclusion, cash handling and a worked example.
- A scoped employee directory enables filing documents before the first published
  payroll. It contains staff names/IDs only, not hidden payroll data.
- Owner enters via Payroll → Tax Company → Open Tax plugin workspace, also linked
  from existing Tax settings. The owner/staff content uses the existing app chrome,
  avoiding a second account header. Staff enters through My Pay or Account →
  My documents · Current & Archive (`/account/tax-documents`), independent of employment.
- Phone priority is owner and staff: owner payroll uses compact cards with secondary
  wage/tip/bonus breakdown in Details; owner/staff documents use cards with View,
  Download and Current/Archive. Tax remains a desktop sheet, not a separate phone app.

## Validation boundary

Tests execute real SQL migrations with PGlite, including period guards, notices,
historical breakdown, cross-salon isolation, revocation and retained staff custody.
Browser QA uses actual Next routes/components/actions with the explicit loopback-only
seeded adapter. The setting editor test checks next-period default, date alignment
and cancelling current-period confirmation; SQL separately checks mutation guards.
Phone evidence is Chromium touch viewport at 390px and 320px, not Safari/native or
physical iPhone acceptance. Owner/staff screenshots show the actual content component,
not a production-authenticated enclosing shared shell. Supabase hosted Storage,
real sessions and Windows installation still require coordinated release acceptance.
