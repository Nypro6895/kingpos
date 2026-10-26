# Claim and content-report communication

Ownership claims and signed-in content reports have a persistent support conversation linked by the private `review_support_links` table. Claim ownership and moderation remain authoritative in their original tables. A support conversation never grants ownership or reverses moderation.

## User experience

- Receipt: notification links to the request history.
- Claim approval: notification and claim page provide access to salon management, subject to the current membership check.
- Claim rejection: user-facing explanation, supporting evidence and explicit reconsideration remain available in the same conversation.
- More information: admin supplies an exact list of needed details/documents. Claim moves to `needs_info`; a reply returns it to `waiting` without granting access.
- Content report: safe public outcome is separated from the internal moderation reason. A reporter can submit additional evidence; an authorized reviewer explicitly reopens moderation.
- Multiple reporters: bulk content removal sends each reporter a safe outcome in their own conversation. One reporter's custom explanation is not shared with other reporters.
- Anonymous reports: no authenticated inbox is available. Receipt explains this and offers the existing guest contact-support workflow. We do not fabricate accounts or reveal reporter identities to authors.
- Submission clears the reply form while preserving messages, evidence and history. `/support` lists the user's requests.

`support_case`, `support_reply`, `review_receipt`, `review_decision` and `review_information` always enter the in-app inbox, regardless of optional social/team preferences. No email or SMS is sent by this feature. Existing guest-support email behavior is unchanged.

## Security and consistency

The database creates trusted links; user-supplied context does not confer permissions. Only the applicant/reporter and authorized reviewers can read/reply. Claim reviewers use locations permissions; moderation reviewers use reports permissions. Documents use the existing private evidence bucket and authenticated server uploads. Internal claim notes go to the restricted admin audit, not the public conversation. Moderation reasons remain private; decisions use separate public messages.

Status changes, public messages, notification creation and ownership changes commit together. Claim and reply operations follow account → location → claim → support-report locking. Notification event keys derive from message IDs. Browser retries reuse request IDs; changed content cannot reuse an existing ID. Competing claims expire without awarding access. Historical requests receive conversations without retroactive notification spam.

## Verification

`tests/review-communication.integration.sql` runs against the installed schema in a transaction and rolls back all fixtures. It covers mandatory delivery, receipt/decision counts, request privacy, nonadmin decisions, internal-note isolation, needs-info requeue, rejection/reconsideration, approval/replay, explicit moderation reopen, retry deduplication and safe bulk-report decisions.

`scripts/qa-review-communication.mjs` runs the actual Next.js app against the linked Supabase database with dedicated temporary accounts. Start the app at port 3105 (or set `REVIEW_QA_BASE_URL`), apply the migrations, then run the script. It uses password sessions, real server actions and the real notification feed. It creates no verification codes or email deliveries and removes authentication accounts, requests, evidence and temporary salons in `finally`. Minimal disabled public identities are retained where immutable admin audit entries reference them. Screenshots and results are saved under `artifacts/review-communication-qa`. Use a production build for the full browser test; dev server refreshes can interrupt automated page navigation.

The migrations are `20261008233001_review_case_communication.sql` and `20261008233002_review_communication_hardening.sql`. They preserve the installed ownership implementation while extending its open-request predicates, including entity-role upgrades already present in the database. An active competing `needs_info` claim also blocks automatic phone approval.

Validated on 2026-10-08: production build, TypeScript, targeted ESLint, the rollback database suite, and all 15 real-browser checks passed. Browser coverage includes actual admin decisions, mandatory notification navigation, private evidence upload and denied cross-user download, claim reconsideration and approval, report reconsideration and authorized reopening, and 320/390/1440-pixel layouts. Screenshots were inspected. The two migrations are installed on the linked backend; this validation does not publish the frontend.

Published to `https://reylumi.com` in deployment `dpl_7oUUr1pJvSaAuEQMU1rewVvassED`. All 15 browser checks subsequently passed against the production domain. The browser harness dismisses the separate Windows POS download reminder through its normal button and scopes claim controls to the main request list during refreshes.

Support notification navigation was optimized in deployment `dpl_BbssUoBZEmnDqK1qjmeuACRgHyHY`. Only workspace-independent UUID support destinations use direct Next links; workspace-switching notifications retain their validated server action. Read tracking runs through the existing authenticated API in the background. The conversation route has its own loading boundary. A production popover test held read-save requests pending while the conversation still opened and the popover closed, with zero navigation server actions. Sample timings were 102 ms to change route and 983 ms to show content; the preceding server-action path measured 2505/2569 ms. These are individual samples, not a latency guarantee. Run with `REVIEW_QA_NAV_ONLY=1 REVIEW_QA_POPOVER=1 REVIEW_QA_EXPECT_DIRECT=1` for this focused regression check.

## Platform Admin conversations and team activity

`20261009023001_admin_support_activity.sql` adds private, durable team events and individual reviewer read receipts. New support requests, claims, reports, customer replies and attachments are captured transactionally; automatic content holds, business verification and recovery requests also enter the permission-scoped feed. This is distinct from the existing outgoing notification delivery history. Customers cannot access the team feed. Report-only reviewers cannot see ownership activity. Revoked memberships lose access. Message retries do not duplicate activity.

The topbar team bell remains visible on mobile and sticky while scrolling. It shows the latest 50 events and a count of unread events. While the admin tab is visible, the feed polls every five seconds; focus resumes checks. An incoming user reply or attachment opens a right-side conversation when none is active. Updates to the active case refresh that chat. Other cases show an alert without replacing the active conversation or its unsent draft. Historical activity is never automatically replayed as a chat popup on initial load. Claim and report conversation buttons stay inside Platform Admin.

Post review and communication states remain separate: `action_required` shows “Waiting for reporter”; a customer reply or uploaded evidence returns the conversation to team review without changing moderation. Ordinary support replies preserve the request status; only an explicit information request creates a waiting state. Embedded chat uses the same authorization, private attachments and idempotent messages as the user's support page. It refreshes locally and keeps its draft across background updates.

The browser suite with `REVIEW_QA_ADMIN_CHAT=1` covers automatic claim/report chat, explicit open without navigation, waiting/responded status, evidence delivery, admin replies, another case arriving during a draft and mobile layout. Add `REVIEW_QA_ADMIN_NOTIFICATIONS=1` to verify the topbar feed and its authenticated read-receipt API while a chat is open.

Validated on 2026-10-09 in production deployment `dpl_2sdXSGJGspXLw3PzLUEovTEMPpa2`: all 24 browser checks passed, including image-only chat reopening and the real team read-receipt API. Build/TypeScript, targeted lint, 10 support regression tests and the expanded rollback database suite passed. Evidence paths are constrained to a single object inside the matching case, rejecting traversal/encoded separators before privileged URL signing; existing evidence paths were checked and the constraint validated. Fixtures and their reviewer read receipts are cleaned without modifying real reviewers' state.

### Compact Platform Admin messenger (2026-10-09)
The conversation popup now uses a separate compact messenger with sender bubbles, subtle timestamps, private image previews, a fixed composer, minimize/restore, and Enter-to-send (Shift+Enter for a newline, IME composition respected). Scrolling follows new messages only when the reviewer is already near the bottom. Sending displays a pending bubble immediately; uncertain delivery retains the original request UUID for safe retries. The existing permission-checked, idempotent message action and evidence validation remain authoritative.

The mounted admin hub keeps up to ten conversations in memory, displays cached conversations immediately on reopening, and deduplicates concurrent fetches. Each server request still checks admin and case access. Authorized unchanged responses use ETag/304 before storage signing; changed responses sign all attachment URLs in one storage request. Signed URLs renew after eight minutes, before their ten-minute expiry. Data is never persisted to browser storage. The user support page remains separate from the compact admin popup.

Final production validation: deployment `dpl_3VFVbVPY3dqigSkLrVh75sDFCGjh` is Ready and aliased to https://reylumi.com. The post review workspace includes the permission-checked support report ID, so opening an existing conversation no longer requires a server action just to look up its ID; requests without a linked conversation retain the guarded fallback. On the final deployment, all 16 real-browser report/messenger checks passed, including private evidence, customer and admin replies, drafts across another incoming conversation, minimize/restore, keyboard behavior, conditional 304, public/internal explanation separation, explicit moderation reopening, and widths 320/390/1440. A cached conversation appeared in 57 ms while its network response was deliberately delayed 1,200 ms (one observed sample, not a latency guarantee). Targeted lint, production build/type checking, the transactional review communication security suite, ten support tests, and three notification UI tests passed.

The browser harness supports `REVIEW_QA_REPORT_ONLY=1` to validate the final messenger without repeating the ownership workflow. Delayed routes are removed with `unrouteAll({behavior:'wait'})` to avoid racing pending route handlers. Each directory fixture now uses a unique synthetic address so the import suppression ledger cannot collide with an earlier run.
