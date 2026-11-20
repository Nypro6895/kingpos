# Review flow implementation — 2026-10-29

Scope: customer verified-visit feedback, salon responses, My Reviews, mobile keyboard layout and truthful LUMI Truth explanations. Branch `codex/review-experience-flow-20261029`, base `f4e5109`. No production migration, deployment or TestFlight upload performed.

## Intent and behavior preserved

- Good remains a one-tap choice; issue details remain optional. Only the original customer can edit feedback. Both UI and SQL enforce 1,000 characters.
- Salon reply and handled status never replace the customer's sentiment. Resolving an issue does not turn it into a good review, grant Truth eligibility, or change Truth scoring.
- Existing independent-customer eligibility, verification, social blocks, moderation and legacy reviews remain authoritative. Customer edits/status changes retain history; replies are immutable and retries idempotent.
- Salon actions require the current salon and content-management permission, with fresh server and SQL guards. Notifications are in-app only, honor preferences and social blocks, and target eligible salon members/customer.
- The Experiences total and My Reviews total can differ from Truth's eligible customer sample. The UI explains this without claiming that every verified visit counts.

## Changes

Customer: saved-state/edit/cancel/error handling; drafts survive network errors; My Reviews now lists own verified and legacy experiences, replies, receipt/profile links and pagination. The Activity dialog follows the visual viewport so the keyboard does not cover the text field/send controls.

Salon: reply to verified experiences, acknowledge/mark handled/continue handling, timestamps and clear issue/status separation. Existing legacy reply behavior remains. An explicit Experiences link improves discovery without moving existing tabs.

Native: registered the shared review view, actor-scoped named read and pinned salon commands. Command aliases were appended so existing aliases remain stable. The installed app uses bundled UI, so these additions require a new signed iOS build; hosted web deployment alone is insufficient.

Evidence files below are under `artifacts/review-experience-flow-20261029/` in the task worktree.

## Evidence

- 46/46 focused Node/PGlite tests passed, including seven new flow/authorization/history/Truth scenarios: `tests-final.log`.
- All 326 migrations replayed in disposable Supabase. Full-schema flow and original Truth SQL suites passed: `full-schema-flow.log`, `full-schema-truth.log`.
- Browser flow and width checks: `browser/results.json`. Bundled-client pinned save, server refresh and reload also passed: `browser/bundled-client-results.json`. Network-failure checks: `browser/resilience-results.json`.
- Changed-file ESLint, TypeScript and production build passed: `eslint*.log`, `typecheck.log`, `build-final-verified.log`.
- Bundled UI compiled with 96 routes / 330 commands and zero missing commands: `native-bundle.log`. QA bundle is deliberately not production-activated.
- Physical iPhone 12 Pro Max: customer typed and sent with keyboard open; salon typed/replied with keyboard open, marked handled; customer read the reply/status. See `iphone-keyboard.png`, `iphone-owner-keyboard.png`, `iphone-owner-handled.png`, `iphone-customer-reply.png`. Actual new bundled JavaScript also rendered on the phone in the isolated HTTPS test entry: `iphone-bundled-client.png`.

Physical tests used Safari and the generated bundled client against synthetic isolated accounts. Installed build 71 was not replaced, and its Swift bridge/new signed-binary lifecycle is not claimed as validated. A fresh archive/install/device check is required during release integration.

## Release handoff

Apply migration `20261030002000_visit_experience_replies.sql` before exposing the new controls, integrate with the exact current release source, build web and a properly configured native bundle, then archive/sign/install and test the new iOS binary. Preserve the latest unpublished native work when integrating; do not ship the QA-generated bundle in this worktree.

No new persistent linked-environment customer/review data was written in this implementation. The prior audit's labeled QA review remains as documented in that audit. This task's data lives only in disposable isolated Docker services.

Cleanup: stopped the test tunnel, servers and phone controller; removed only the four label-verified task containers with tmpfs data, and removed the temporary fixture env file. Evidence: `cleanup.json`.
