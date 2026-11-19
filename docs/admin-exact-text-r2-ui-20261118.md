# Approved exact-text moderation UI r2

Implemented locally on the owner-approved compact r2 design. This document records source and isolated acceptance; it does not claim a deployed migration, hosted operation, or App Store acceptance.

## Scope and behavior

`app/(app)/admin/reports/social-content-decision.tsx` presents one current report target: type/source and status together, the exact authorized quote, a required decision reason, and one content action. It supports comments, reviews, visit experiences, and their salon replies through the backend's canonical target. No caller-supplied content identity is accepted by the UI action contract.

Decision history and Case handling start collapsed. Existing Support assignment, notes, conversation, update, resolve and close controls remain in Case handling. Record resolution is a secondary text action with a 44px target. Resolving or closing a case does not call the visibility action. Ordinary non-social reports keep their existing expanded layout and workflow.

The server supplies the current target, evidence version, permissions, eligibility and action history. A current eligible target can offer Hide or Restore. Restore releases this case's hide only. When another case still holds the content, the action says **Release this hide**, the resulting status remains Hidden, and the success message does not promise public visibility. If another case alone holds the content and this case may add its own hold, the action says **Hide for this case**. Author withdrawal, private/deleted parents, other safety restrictions and unavailable evidence do not acquire a Restore button from client inference.

The reason is trimmed and must contain 3–2,000 characters. An unknown response locks the original reason, action, report, version and request UUID for confirmation with the same payload. Refresh does not create a replacement request. A confirmed failure preserves the reason and requires refreshed evidence before a new request. Duplicate pending submits are fenced locally. Confirmed success uses the returned state, clears the reason and refreshes the server view.

The report/actor key isolates drafts across cases and memberships. A committed source or capability change invalidates older in-flight action/refresh responses. A newer unavailable state cannot be overwritten by an older response; revoked read capability suppresses the quote and history. Only an explicitly unverified transport/schema fallback can reuse the older authorized quote, labelled **Recorded text · current availability not confirmed**. A verified unavailable result suppresses that fallback.

Unknown request identity and typed reason are kept within the mounted report/actor session. A hard page reload does not persist them. No decision notes are written to browser persistent storage. Server receipts, current holds and permissions remain authoritative after reload; the UI does not claim durable draft recovery.

## File ownership

- `app/(app)/admin/reports/report-case-view.tsx`
- `app/(app)/admin/reports/report-case-view.module.css`
- `app/(app)/admin/reports/social-content-decision.tsx`
- `tests/admin-exact-text-r2-ui.browser.test.mjs`
- `tests/fixtures/admin-exact-text-r2-entry.tsx`
- `tests/social-report-consumer.integration.test.mjs` — new exact-text server-action and loader transport stubs; existing consumer assertions preserved.
- This document.

The separate backend change owns `types/admin-exact-text-moderation.ts`, `lib/platform-admin/exact-text-moderation.ts`, `app/(app)/admin/reports/exact-text-actions.ts`, the report-context resolver and the migration. The UI does not grant moderation authority or clear unrelated holds.

## Validation

`node --test tests/admin-exact-text-r2-ui.browser.test.mjs tests/social-report-consumer.integration.test.mjs` passed: ten actual-component browser scenarios plus the existing producer → stored case → authenticated loader → actual SSR consumer regression (12 Node test records including the browser parent harness; zero skips). The existing consumer includes cross-tenant forgery rejection and exact private-reply evidence without exposing its parent or another customer's reply.

Browser coverage includes required reason; hide/restore; same UUID/payload on unknown and thrown transport; stale-version reason retention and refreshed new intent; duplicate-click fencing; case/actor switching and late response; newer private/unavailable source; revoked read/update capability; withdrawn/private/held target; verified-unavailable versus unverified historical fallback; multiple case holds; and Support-only resolution. The actual `ReportCaseView`, content component, CSS modules and `DashboardActionForm` are bundled. Only transport and unrelated operational boundaries are mocked. All network requests are restricted to in-memory fixture HTML. No customer, provider or Storage request is made.

ESLint passed for both owned product TSX files and the new browser fixture/test. Desktop 1080px and mobile 390px captures have no horizontal overflow and content controls/disclosure targets are at least 44px. Captures were visually reviewed:

- `artifacts/admin-exact-text-r2-ui-20261118/r2-visible-1080.png`
- `artifacts/admin-exact-text-r2-ui-20261118/r2-visible-390.png`
- `artifacts/admin-exact-text-r2-ui-20261118/r2-hidden-390.png`
- `artifacts/admin-exact-text-r2-ui-20261118/browser-acceptance.json`

These are isolated Chromium viewport results, not hosted Next Server Action, production RLS, Safari, native iOS or physical-device acceptance. The coordinator owns the combined Next build and assembled product preview. No product development server was started by this UI task, and its fixture was not registered as a working product Live Preview.

No photo routine approval, private image evidence escrow, rights/copyright workflow, consent UI, provider setup or secret configuration is included. No commit, push or deployment was performed.

## Revision 2: explicit nullable-state guard

The coordinator's combined R3 build found that TypeScript could not narrow the nullable local `state` through the separate `current` boolean. Revision 2 adds an explicit `state` check at action derivation. Runtime behavior is unchanged. The focused browser/SSR suite and ESLint passed again; a TypeScript Program diagnostic pass found no diagnostics in the two owned product TSX files or the new fixture. Diagnostics outside that scope remain the coordinator's combined-build responsibility. The earlier ready event `24a9dc59-a2ce-4c53-9b1a-950c4695c2be` and its frozen source remain intact; the new seven-file frozen revision supersedes it explicitly.

## Revision 3: isolate the consumer loader transport

The consumer fixture explicitly mocks `./exact-text-moderation`: the new lookup throws an isolated fixture error and its unavailable-state factory returns `availabilityVerified: false`. This keeps the existing authorized recorded-evidence fallback assertions while removing the real Supabase/cookies module from that loader's imported graph. The existing SQL, forgery and SSR assertions are unchanged. The affected 12 browser/consumer test records and lint passed again. All product/runtime files are byte-identical to revision 2; only this document and the consumer fixture changed. The new seven-file revision explicitly supersedes `6aa85e78-5c5c-4563-a730-7063a4de9c8a`; both earlier frozen snapshots remain intact.
