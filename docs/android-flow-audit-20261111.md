# Android flow audit — November 11, 2026 (America/Chicago)

Overall status: **incomplete acceptance**. This is an evidence inventory, not a
claim that every application flow or iOS parity has passed. Source is the isolated
`android-ipad-store-20261105` worktree, based on `fb8a12f` before this revision.
Canonical checkout and hosted web can contain newer changes; these fixture results
do not establish deployed-source equivalence. No web/store deployment occurred.

## Changes confirmed in this audit

- Staff Requests: synchronize the pending flag before paint, preventing the sheet
  from closing during an asynchronous save. Existing browser regression failed
  reproducibly before the fix and passed after it.
- Android Back: use the native dialog cancel contract, respecting pending/dirty
  cancellation guards. Close the foreground dialog before a background More menu.
  Recognize additional existing close labels on non-native dialogs.
- Repair financial schema test portability when `rg` is not installed. Its schema
  assertions remain intact; the failure was a tooling dependency, not a proven
  financial payload defect.
- History close and notification preference tests now wait for React's observable
  completion. History scroll unlock passed with original product code; no scroll
  implementation change was retained. Notification failure was not reproduced as
  a persistent product defect.

## Validation

Initial repository suite: 644 cases, 632 passed, 11 failed, 1 skipped.
Local rerun excluding three environment-dependent files: 637 cases, 636 passed,
zero failed, one skipped. After local CSS compilation, that skipped profile
header test passed independently. New native bridge regression also passed.
The final changed-area run passed all seven cases. Repeated cases are not added
to the broad suite total. TypeScript noEmit and scoped ESLint passed.
Android testDebugUnitTest/lintDebug/assembleDebug passed: four Java tests,
zero lint errors and two existing warnings. New APK installed on emulator.
Actual Android Back dispatched cancel while the diagnostic dialog was busy:
it stayed open, then closed on Back after busy=false; route remained /explore.
The diagnostic was removed. This confirms the packaged bridge on emulator,
not the business Staff sheet on a logged-in Galaxy.

Excluded files: customer-visits-runtime (missing backend environment),
pos-live-draft-rpc-contract (Supabase project not linked), portable-desktop
(Windows Electron binary unavailable). Do not link a production database to run
fixture creation/deletion tests. Initial attempts stopped at missing configuration.
No live financial fixture was created by this audit.

Detailed logs are local in artifacts/android-flow-audit-20261111.

## Flow coverage matrix

| Area | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Login, recovery, MFA, session expiry | Local routing/security/keyboard/expiry tests pass; emulator native email input, missing-password validation, IME resize, Back-to-hide, background draft and rotation pass | Real provider return, expiry/logout and multiple real accounts on Android |
| Workspace and authorization | Local cross-account/salon/staff isolation and route-context tests pass; physical switching was checked in earlier audit | Full real-session transitions and stale browser/process recovery |
| Explore/search/feed | Local search, pagination, refresh, cache, follow/save rollback, guest gates, comment and booking intent tests pass | All live content variants, slow network on Galaxy, first-load iOS comparison |
| Booking | Local public/quick booking selection, time/DST, availability, reschedule/cancel, no-show, permissions and notifications pass | Production end-to-end booking on an isolated test salon/account |
| Personal history and receipts | Local merge, details, receipt, review and responsive tests pass; earlier physical route layout checks | Linked runtime RPC tests and live history fixture acceptance |
| Beauty/profile/library | Local profile/media/relationship and layout tests; earlier physical read-only screens | Actual picker, upload failure, edit/save and account-media isolation on Android |
| Staff | Local requests, schedules, payroll access, earnings snapshots, appointment actions, check-in rules and filters pass | Authenticated emulator/device workflow with safe data |
| Owner/settings/team/services | Local target isolation, save feedback, duplicate protection, hours, service rules and settings dialogs pass | Complete authenticated form workflows and installed native regression |
| POS/tickets/offline | Local owner/portable fixture UI, draft recovery, writer isolation, retry, adjustments and resource synchronization pass | Linked live-draft RPC contract, real Android customer display/printers and payment-provider returns |
| Payroll/reports | Local historical snapshot, earnings, dates and report contracts pass | Reconcile controlled accounting fixtures and verify physical exports |
| Notifications/support | Local read visibility, return from hidden tab, preferences rollback, pagination and support validation/durable delivery stubs pass | Real-session Android deep links and delivery acceptance without sending test messages to users |
| Gift Cards/Rewards/Memberships | Earlier physical read-only route/empty-state checks | Purchase, redemption, balances, expiry, mixed settlement and authorization using isolated financial fixtures |
| Campaigns/Forum | Earlier physical read-only route checks only | Draft/edit/media/error/permission flows using isolated fixtures; posting/sending not exercised |
| Camera/QR/photo | Earlier physical diagnostic QR passed; emulator allowed/denied/capture/cancel/background tests | Production Staff Scan disabled by salon; actual business scan/check-in not accepted |
| GPS/location | Emulator synthetic fix and permission branches passed; manual fallback present in source | Physical GPS requests timed out; must obtain usable real fix |
| Native lifecycle/navigation | Emulator IME, draft after background/rotation; earlier physical More Back and share/print previews | New Back APK on Galaxy, long background/process death and all external links |
| Exports/share/print | Earlier emulator saved harmless text; physical share/print UI opened and cancelled | All actual financial export formats and hardware printer output |
| Store/legal | Existing navigation gate tests and local policy contracts pass | Android billing recognition across SPA/fetch, app links/signing, provider policy and Play acceptance |

## Local preview

Actual source dev server: http://127.0.0.1:51652/staff, registered to this chat.
Development instrumentation does not dispatch the production notification worker.
No backend credentials were copied into this worktree. Preview can show the
guest/loading gate; it does not establish authenticated Staff screen acceptance.
Browser fixture tests use explicit stubs and are not substituted into Live Preview.

## Next required evidence

Complete authenticated Personal/Staff/Owner interactions on emulator with isolated
test data, then repeat the native changes on Galaxy. Financial write acceptance
needs a dedicated test backend/salon and must preserve production records. Keep
GPS, production Scan, Gift/Rewards settlement, Campaign/Forum mutations, provider
returns and store gates open until those exact flows have evidence.
