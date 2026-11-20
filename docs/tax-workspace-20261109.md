# Personal Tax workspace — implementation handoff

Scope: web implementation only. No production deployment, production migration,
payment, email/SMS dispatch, native archive or upload is authorized by this task.

## Final behavior

- Normal Reylumi signup/sign-in remains the identity system. `/tax` is the opt-in
  entrance, with dedicated login, signup, recovery, profile and install pages.
- A personal Tax profile adds a Tax workspace to the existing avatar switcher.
  Users without that profile do not see a Tax role. Activation grants no salon
  permissions. Existing owner-generated connection ID/password grants salon access.
- The primary sheet shows only sanitized published payroll values. Status,
  employee documents, conversations, version comparisons and paystub upload live
  on the employee row. Summary filters use the latest published run per period.
- Batch upload matches one file to one employee, blocks duplicate/unassigned
  recipients and reports success/failure per file. Retry skips successful files.
  Combined PDFs must be split before uploading; no automatic page extraction or
  tax calculation has been added.
- Records are salon-owned, not professional-owned. The replacement professional
  inherits documents, work status, receipts and conversations. Author identities
  and archived versions remain. Legacy private notes are migrated into the
  shared owner-visible salon conversation under the newly approved ownership model.
- Owner documents, archives, receipts, activity and connection controls are
  accessible in `/payroll/tax-company/workspace`, linked from the existing owner
  Tax settings/report. Existing payroll settings and pricing are preserved.
- Tax users have no download/export/delete product controls. They may archive
  tax-produced files; they cannot replace owner-uploaded source documents.
- Staff access `/account/tax-documents` without needing an active salon/employment
  link. A delivered recipient and document labels are snapshotted. Staff retain
  Current/Archive files when the tax connection ends or an owner removes its
  business-side record. An owner removal is a business-side tombstone, not erasure
  of a recipient's personal copy. Physical file cleanup cannot remove retained
  delivered versions, including through permissive legacy cleanup policies.
- Existing My Pay/current paystub pointers are updated by the same successful
  upload transaction. Older files are archived rather than cleaned up.
- Status writes use optimistic concurrency. Upload completion is idempotent;
  receipts have a request idempotency key. A newer payroll revision appearing
  during upload blocks stale completion. Payroll revisions are never silently
  treated as the old paystub's current financial version.
- Windows installation reuses an online-only PWA with `/tax` as its start URL.
  Old `/tax-company` links redirect to the new entrance.

## Verification and evidence boundary

`tests/tax-personal-workspace.integration.test.mjs` executes the migration and
authorization against PGlite/Postgres SQL, including cross-business isolation,
handover, revoked access, staff custody after unlink/removal, concurrent updates,
receipt replay, physical-file preservation and revised-payroll upload rejection.
The legacy billing/period/auth regression tests are also run.

`node scripts/qa-tax-workspace.mjs` uses real Next.js routes, the shipped React
components and real Next server actions. Its data adapter is explicitly enabled
only in development, on loopback, with an opt-in QA cookie. It cannot run in
production. Screenshots are actual local app captures, not AI mockups. They use
seeded identities/data, not authenticated production salons. The script hides
the Next development-tools indicator, not application warnings or errors.

The independent SQL and local UI checks do not establish hosted Supabase Storage,
production sessions/MFA/email delivery, physical Windows installation or native
iPhone acceptance. The migration has not been applied to production. No native
source was changed; hosted/native-shell compatibility should be accepted during
the later coordinated release, rather than inferred from these browser checks.

## Integration

The source was isolated under `C:/Reylumi-worktrees/tax-workspace-20261109` from
the current canonical working source, whose hashes are recorded in
`artifacts/tax-workspace-20261109/source-baseline.json`. This includes pre-existing
unreleased source; it is not a production release baseline. Integrate only the
task delta and dependencies over the then-current production baseline. Do not
deploy this working source wholesale.

Apply `20261109230000_tax_personal_workspace.sql` through the normal coordinated
release after integration. Re-run database, web build and authenticated
owner/Tax/staff acceptance against that assembled candidate. The small direct
Settings shortcut fix in `lib/today-quick-accesses.ts` is included because the
provided baseline otherwise failed page-data collection after the More catalog
removed `owner-setting`; it retains the existing permission gate.
