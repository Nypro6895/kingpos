# App Store UGC privacy completion — 2026-11-09

Owner hold remains in effect. No deploy, production migration, real deletion/report/block, Apple upload/submission, payment change, new device permission, user invitation or agreement acceptance occurred. Source remains isolated in `C:/Reylumi/work/app-store-legal-20261109` on `codex/app-store-legal-audit-20261109`, based on build 97 source `acb17696eabeb49fc03a680b2610d4b6d1dc92bc` plus the preceding privacy-manifest preparation commit `ab051b98867d9ec8fcd5e843f95ffe718dc30824`.

## Implemented source changes

**Forum personal blocking.** Reused the existing authenticated `set_user_block` action, private `social_users_blocked` pair predicate, Settings unblock list and client invalidation event. Topics, reply/chat rows, reply/unread counts, searches, saved/following feeds, Today previews and deep links are filtered before aggregation/pagination. Blocked-topic reply/follow/bookmark/seen writes are rejected. Moderator report/audit permissions remain intact; personal block does not suspend salon access. Mutual topic follows are disabled, saved records are preserved, and only relevant Forum inbox previews are removed/suppressed. Other users' follows, saved records, content and notifications remain intact.

The Forum clears stale displayed content on local or cross-tab block changes, invalidates in-flight reads, remounts continuation feeds and guards chat polling against a changed privacy/navigation state. Draft fields are not cleared by these handlers. Browser acceptance covers failed-block retry, successful removal of the blocked author's content, preservation of another author's content and cross-tab unblock refresh.

**Due-account erasure.** The new private helper is called within the existing `erase_account_personal_content` transaction. It requires the existing due-account/job/transaction-marker predicate; it has no client or service-role execute grant. It scrubs the deleting author's Forum topic titles/bodies/location metadata, replies and chat, retaining contentless parent/reference rows. Other authors' replies and topics are not deleted. It removes the deleting account's bookmarks/subscriptions/rate state, detaches/scrubs its free-text report/audit entries, and clears relevant Forum notification previews. Moderation case/reference/timestamp skeletons remain.

The audit also found newer visit-experience replies/history added after the original erasure migration. The helper scrubs reply text authored by the deleting user and history text attributed to that user. It does not modify POS, booking, payroll, tax, receipt or business-ledger tables. Original erasure/Storage/Auth/retained-business-file behavior is retained.

**Individual text reports.** Added a shared report dialog and an authenticated/abuse-checked server action for comments, review/experience text and salon replies. Public review/reply targets are verified against the existing salon visibility/block-aware RPC, not a service-role lookup. Comments use the authenticated RLS-enforced published-row query. Reports in private customer history use the existing actor-scoped `get_my_visit_experiences` RPC, so an unpublished salon does not prevent its customer from reporting a salon reply. Caller-supplied author identity is not trusted or accepted.

Reports enter the existing private support/review-dispute queue using its request-ID deduplication, active-user check and rate limit. A failed request preserves the reason and the same request ID for retry; success links to the private report conversation. Reporting never automatically hides/removes someone else's content. No raw UGC body is copied into the new support context; it identifies the canonical content or the customer's own reply-parent reference.

Controls are connected to shared post comments, public salon experience/review cards, their replies and My experiences salon replies. Website positive-review highlights retain their existing **All experiences** path to the full review cards/actions. Guest users keep the existing support paths; this new private report action requires sign-in. The report process still needs an operational owner/moderator response policy; adding UI does not prove timely human handling.

**Native command boundary.** Added only `reportSocialText` to the explicit app-local command policy and regenerated its server registry. No generic remote command or service-role client was exposed. Existing native assets were not replaced or activated. Updated bundled UI requires a new native build after integration; verify-only compilation is not an archive/upload.

## Local validation

Evidence is in `artifacts/app-store-legal-20261109/`:

| Check | Result / evidence |
| --- | --- |
| Deletion, Storage/Auth failure/retry, social blocking, post/report/comment controls, Forum authority/pagination/notifications, individual report validation and browser flows | 78/78 passed, no skipped tests; `ugc-final-tests.log` |
| Visit feedback/reply/privacy, customer/owner scopes, one-shot/idempotent writes, preserved sentiment/Truth, browser UI and final Forum privacy migration | 21/21 passed, no skipped tests; `ugc-feedback-tests.log` (five Forum tests overlap the preceding suite) |
| Next production build, TypeScript and offline assets | Passed; `ugc-final-build.log`; background dispatch disabled, only approved public client configuration forwarded by the existing build wrapper |
| Installed JS boundary compilation | Safari 16, 349 pinned actions, 975 modules, zero unsupported actions, assetsWritten=false; `ugc-native-verify.log` |
| Scoped ESLint | Zero errors; one preexisting Forum `detail` dependency warning; `ugc-final-lint.log` |
| Required-reason manifest source inventory | Existing two categories still declared; `native-inventory-after-ugc.json` |
| Source whitespace | Passed with CRLF-aware `git -c core.whitespace=cr-at-eol diff --check` |

Restored the missing rollback-only SQL fixture `supabase/tests/account_deletion_flow.sql` and imported the previously untracked safety tests into this isolated source so the suite is reproducible without borrowing another checkout. The earlier report-browser mock now exports the real required navigation hook. The feedback-browser mock now exports the real portal-host hook required by the new report dialog. Existing behavior assertions were retained.

New migration tests exercise actual Forum migrations and the existing block function/predicate, including 28 blocked rows ahead of a visible result, notification isolation, idempotent replay and fail-closed rejection of an unexpected reader shape. The erasure test uses the actual due predicate and new scrub helper with a small entrypoint fixture to verify the hook. The original full erasure worker/finalization tests run separately; no complete hosted database or Xcode environment is simulated by these fixtures.

## Planned migration and remaining acceptance

`20261109220000_forum_privacy_completion.sql` is **source only**. Its DDL/function patches run in one transaction, check required table/API shapes and preserve existing function signatures/grants. Reapplication is idempotent; an unexpected reader/writer/notification/erasure definition aborts for review. It removes existing blocked Forum notification previews, but does not run bulk account erasure during installation.

Before any authorized release: capture the then-current production source and database function definitions/ACLs; reconcile this patch against them; verify the required Forum/visit tables and existing block/erasure helpers; run assembled checks and an isolated migration rehearsal; then follow the production alias guard and normal release coordination. No production baseline is claimed captured by this task. The earlier Vercel CLI cache issue remains separate from local implementation readiness.

An important remaining data task is inventorying accounts finalized **before** this fix: existing completed erasure jobs do not automatically rerun the new helper. No production data was queried to claim there are, or are not, affected records. Any historical cleanup needs a bounded, reviewed plan with the applicable retention/hold rules; this task does not silently weaken the due-job guard or launch a cleanup.

Still pending: current provider configuration/retention and SDK classification; macOS project generation/tests/archive, actual `.app`/IPA manifest resource and aggregated privacy report inspection; new bundled-assets build, signing and physical iPhone acceptance; authenticated hosted report/block/deletion checks with safe accounts; all legal-entity/territory/retention/payment/age/privacy declarations identified in the original audit. The historical workflow ZIP available locally contains receipts/logs, not an app archive, so it cannot establish the absence of third-party libraries in the actual binary.

Public Terms/Privacy policy text and App Store declarations were not changed. Draft factual wording remains in [the original audit](app-store-legal-audit-20261109.md). The source fixes do not establish App Store approval or whole-app legal compliance. Apple's [UGC guideline](https://developer.apple.com/app-store/review/guidelines/#user-generated-content), [account-deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/) and [required-reason API guidance](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api) remain the relevant acceptance references.
