# Staff My Pay: take-home first

Approved scope: Staff My Pay only, following the approved revised mockup.
Take-home is first, followed by Check and Cash. Services is inside the compact
Pay breakdown. Details is muted, defaults closed, and is keyboard accessible.
Daily breakdown remains read-only. Documents, bonus changes, settings history,
payment evidence, manual check reference and owner note are retained.

The shared Owner payment table and display projection now serve Staff too.
An optional total footer is enabled only for Staff; Owner's default stays the
same. All amounts come from the existing calculated payroll line. No calculator,
loader, authorization, persistence, server action or database schema changed.
Tip/Bonus appear once in the ledger, with gross, tax, net and payout method.
Mixed/historical settings use their existing snapshots and provenance. An old
statement without a bonus tax rate does not borrow today's rate. Staff cannot
input Bonus, edit a check number, print checks or query the Owner Check Writer
reference RPC. Current calculation is not represented as payment received.

Verification evidence: `artifacts/staff-my-pay-ledger-20261113/`.

- 80 actual-component browser cases: EN/VI, 320/390/430/768/1440px; normal,
  taxed extras/check payouts, cash tax, fixed exemption, mixed settings, legacy
  unknown settings, zero, large amounts and empty data. Ledger cells match the
  actual payroll calculator's display projection. Default closed/open, read-only
  controls and horizontal overflow checked. Synthetic fixture data, zero writes.
- 22 existing financial/access tests pass, including the 32-combination tax and
  payout-method matrix, rounding and mixed/sliced periods.
- Authenticated Staff route with isolated QA backend: 4 ledger rows, Details
  opens, read-only, no horizontal overflow at 390px. No financial writes. QA
  services $200 and take-home $120 differ intentionally from the sample mockup.
- TypeScript, scoped ESLint, production build and app bundle verify-only pass.
  Bundle verifies safari16 compile target, 403 pinned actions, 0 unsupported
  actions; no installed iOS bundle changed or physical-device testing claimed.
- An exploratory unrelated legacy history test (`payroll-compact-income`)
  cannot compile its existing CSS import because its esbuild harness only mocks
  one named stylesheet. It is not counted as passed; that harness was unchanged.

Local Preview points to this worktree's guarded QA server at
`http://127.0.0.1:43291/staff/my-work?tab=payroll` (viewer has its own login).
No deployment or native upload. Integration depends on the earlier shared Owner
ledger change `payroll-payment-ledger-live-20261112`.
