# Kiosk verification addendum — 2026-10-25 — NOT DEPLOYED

The kiosk application patch and SQL bytes are unchanged from the original frozen receipt. This adds verification to the earlier release note; retain both immutable journal events.

## Completed

- Full Next.js 16.2.9 webpack production build: exit 0, including full TypeScript, page-data collection and prerendering. Source was a local QA copy of canonical Drako containing the patch, not a production release assembly. No .env files or inherited cloud credentials were used. Only the QA instrumentation entry was replaced with a no-op to disable the notification worker; Next also adjusted the QA tsconfig include paths. Canonical instrumentation/configuration remained unchanged.
- Existing browser fixture: mounted tabs, offline edits, durable retry, reload and local display transport passed in Chrome.
- Existing Windows Electron fixture: encrypted ticket storage/DPAPI, logout, restart, abrupt exit and storage boundaries passed with a separate synthetic local profile.
- Paired-window Windows Electron fixture passed using the real desktop main process, preload scripts and local-display transport. It opened the customer window through the existing pair/open bridge, received a synthetic customer snapshot, received a new snapshot after reload, ignored another token, and verified the customer window had no desktop vault API. No native security settings or device permissions were changed.
- Migration guard from the existing source-only reconciliation accepted 282 unique versions for its 281-file baseline plus the kiosk migration. A separate union check includes other new canonical versions. The kiosk version is absent from that baseline and the recorded October 24 production ledger; this is not a fresh production-state claim. Required identity migration files are present in the reconciled source.

## Failed/limited checks

- Existing portable-ticket-live-sync browser test failed before interaction because its navigation mock lacks the useRouter export now imported by ticket-filters.tsx. No unrelated Ticket or test fixture source was changed to mask the failure.
- Initial sandbox browser invocation could not traverse local source directories. Normal-user execution resolved that environment issue; it was not an approval denial.
- Initial paired test used an incorrect synthetic transport payload and timed out; the corrected fixture passed. Application code did not change for this correction.
- The legacy full pos-customer-display-e2e/portable-desktop-e2e scripts invoke Supabase CLI with --linked and write fixture records. They were not run against the linked project. A complete customer-display UI + full-schema local backend acceptance and physical second-monitor/touch/printer acceptance remain not run. The paired fixture validates the native bridge/transport, not the complete deployed check-in experience.

## Combined-release constraints

Canonical migrations still contain the two pre-existing duplicate versions 202610080006 and 202610080007. Preserve the previous integration-source-only reconciliation (commit 0c7f12275c28a7d6ac4fa0f053f6480316594df5); do not blanket db push the canonical folder. The kiosk migration creates no additional collision. Broader historical source/production differences in the prior reconciliation remain to be handled by the release coordinator.

No production writes, migration application, push, deploy, new portable package or visual redesign occurred. Keep needs-integration until the later combined source is assembled and its remaining acceptance is complete. Rollback remains the exact kiosk patch reversal and restoration of function definitions/ACLs captured at deployment, never deletion/merging of customer data.
