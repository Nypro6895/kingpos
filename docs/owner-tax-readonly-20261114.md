# Owner Tax: read-only reporting figures

The Owner Today Tax shortcut now opens a read-only view of the same published
numeric records used by the tax professional's workspace. It supports period
and year selection, a per-employee summary, legal-name search, and viewing
additional reported figures. It has no upload, edit, save, payment, invitation,
or connection-management controls.

The authenticated `tax_workspace_data` RPC already allows the real salon owner
to read without a Tax Company subscription or salon credentials. The new loader
uses that existing rule and returns only salon, runs, and lines. Tax professional
entitlements and field sharing remain authoritative in the database. No migration
or payroll calculation changes are included. The Tax entry inside Payroll only
changes its owner-facing label/link presentation and no longer requests plugin
activation before opening the read-only figures.

Latest published revisions are counted once per period. Calendar-year filters
use overlapping-period semantics shared with Tax. Explicit ranges with no
published data stay empty. Null amounts remain distinct from zero; Tip/Bonus
remain included in the reported total. These figures do not establish filing.

The previous report is preserved exactly in `app/payroll/tax-company-live-report.tsx`
for authorized delegated payroll viewers. Current app-local pages use the additive
`owner.tax-report` resource. The existing `owner.payroll-tax-report` response shape
is unchanged for installed clients, with separate cache keys and ETags.

## Verification

- 62 relevant source, access, database, model, transport, and translation tests passed.
- Eight real Next/browser checks passed, including numeric parity with the actual
  Tax component, four widths (320/390/820/1440), requested ranges, no viewport
  overflow, no mutation requests, and no runtime errors.
- Production build and TypeScript passed. Scoped ESLint has no errors; seven
  pre-existing unused-symbol warnings remain in the two Payroll view files.
- Production local smoke, even with the QA opt-in environment variable set:
  QA entry returns 404 without cookies and anonymous reports reveal no sample data.
- No provider transactions, messages, production data changes, or deployment.

Baseline: commit `23e66abd5a197d66fd9d2e9fbb358b160af06307` (product source
`830f0a6ec3029177c94e88137a8165f784c47ae4`), verified current alias
`dpl_F5yYNDU4nXW2epT5pozciBmPfHhv`. Evidence is under
`artifacts/owner-tax-readonly-20261114/`.

The native client uses a signed bundled executable. A release coordinator must
regenerate its bundle/manifest and perform the normal native build/upload before
claiming this new interface is available in a shipped iPhone binary. Existing
installed clients remain compatible with their original resource. Web and native
publication are not performed by this implementation task.
