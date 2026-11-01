# Combined financial release and Payroll load audit

Web is live at reylumi.com, deployment dpl_Dkt56igv5fjsTWHpiJFEcqfRRLki. Exactly one production promotion was performed. iOS 1.0.0 build 82, source 7fea54bb5c6f071de03d70fabb33e17d421f15f8, is processed VALID and available to 2 existing internal TestFlight groups. This is not App Store publication or proof of installation on a particular phone.

## Included behavior

- Today shows today only, with compact + Expense, and no expense-list action or date filter.
- Owner financial Attention covers unreviewed previous-day figures, actual ticket edits with saved before/after values, discounts and check-in/payment matching. Detail/Ignore actions stay compact; Ignore persists for that exact item. Creating an ordinary ticket does not by itself require owner attention.
- Owner review stores a fingerprint and review metadata. Financial figures remain live and editable with history; deployment does not restore a frozen closing-total model.
- Groups use flat shadow bands; child notifications remain list rows. Payroll uses the shared mobile gutter once.
- Shared Payroll reads are reused; independent data loads run concurrently. Shop data is preloaded and does not reread on mount or refresh itself twice after saving. Reads are distinct from financial writes and confirmed-save/failed-refresh messages are precise.
- Native Payroll retains its visible tab through read normalization. Default and explicit Shop share one key. Opening Expense reads GET context instead of triggering command invalidation. Retained older Today DTOs without salonId no longer crash Attention/Today.
- Previously omitted Ticket calendar/date toolbar, retained Portable date guard and large/small staff-turn summary were integrated without replacing newer correction/history behavior.

## Baseline and audit

The captured web baseline was dpl_FnWRb4DLB2terinVzD6ZxrJxmGZd, source 577e062fddcaacd37165841f8510d2818c0e0b09, also the actually uploaded iOS build81 baseline. Its 3,750 deployed entries were matched against Vercel source metadata and raw samples. The assembled 3,760-entry web source and scoped 32-file overlay were independently verified from Vercel's downloaded source archive. The baseline guard passed immediately before the single promotion. Web source remains 3a12b876f57feacbbc1be5546a5dca119ac46004; later native-only corrections use the already-compatible deployed read endpoints.

111 pending events and 167 worktrees were inventoried. 123 worktrees were dirty; three Git inventories were blocked by pre-existing ownership checks. No worktree was moved, reset, cleaned or stashed. Four completed product changes were selected, with validated ready revisions for the omitted Ticket work. Historical overlap preserves newer live behavior. Unfinished work, separate Sites/QA evidence and the independent Market platform chain remain excluded from this release. Existing first-party Check Writer code and its closed-sales gates were already shipped and were preserved; no provider transaction, activation or physical print acceptance occurred. The per-event decisions are in pending-decisions.json, not inferred from event dates.

## Validation and data safety

The additive Attention migration passed isolated PostgreSQL owner/salon/Ignore tests before production application. Executed SQL tokens match the tested migration plus its ledger marker. Helpers are private; owner RPCs enforce salon ownership. No financial record, recorded payment, user Ignore or closing-review confirmation was created by live verification.

Production build, 31 financial/load/API regressions, 64 actual-component Payroll responsive views, five Today/Attention widths and the Portable runtime check passed. Scoped lint and financial TypeScript checks passed. Current/legacy Today compatibility tests load the real activated app bundle and verify Expense opening makes one read and zero commands. Candidate and live each passed 38 HTTP checks; authenticated Owner Today, closing detail, Payroll, Ticket calendar and turn display were separately checked read-only. Desktop screenshots are explicitly labelled desktop.

The signed native candidate's 3034 Git inputs match its source-bound provenance. All 239 source tests started and passed exactly once across the required isolated hosts; no failures, skips, omissions or duplicates. Unsigned/signed/exported bundle parity and production pilot-OFF preparation were verified before upload; Apple processing and exact existing-group association were checked read-only. Earlier failed attempts were blocked before upload. Viewport fixtures now require a foreground key window and report loading/process failures; no existing viewport, auth, freshness or frame assertions were weakened. Independent local Mac testing also passed all 239 cases across 14 hosts on iOS27.

## Payroll performance findings

Confirmed causes addressed: sequential/duplicate backend reads, Shop mount/save waterfalls, native tab normalization bypassing preload/entitlement choices, and metadata POST reads causing command-complete invalidation. Shop arithmetic was already bundled locally; moving arithmetic alone does not remove authorization/data waits. Staff live payroll calculation remains canonical on the server.

Installed WKWebView measurements on the CI iPhone simulator use synthetic HTTP with controlled 100/700ms delays. Results: 100ms read delay: initial primary data 1308ms, retained return 38ms; 700ms read delay: initial primary data 1651ms, retained return 27ms. Each scenario issued one Payroll read, requested Shop, retained the DOM and issued zero commands. These runs have different boot/cache conditions; do not compare them to infer a causal network-delay effect or a physical-device speedup. The local Mac corroborates the same read/retention behavior; its screenshot uses synthetic salon figures.

Authenticated desktop completed-navigation samples were 236/417/391ms. Earlier samples that did not explicitly await navigation are excluded from before/after claims. Common eager financial/history/legacy-statement/tax reads on Tools/Settings and the visible-page 20-second refresh remain source-confirmed profiling candidates; their physical cost has not been measured.

## Physical-device limit

The Mac was rediscovered through Desktop Commander at 192.168.1.253 and the existing SSH key worked. A connected iPhone12 Pro Max was observed running build74. Xcode timed out while enabling UI automation before any route test ran. The owner was asked asynchronously to unlock/keep awake and accept the test prompt; no response was available during this release. Therefore no physical Payroll timing, installation of this new TestFlight build, or physical-device acceptance is claimed. The dedicated simulator and physical-test artifacts were kept separately.

Evidence: artifacts/combined-financial-release-20261101/ contains the frozen sources, manifests, audit decisions, source/archive verification, test logs, measurements and screenshots. Compact publication proof is retained under releases/evidence/combined-financial-release-20261101/. Unrelated working/generated files were left untouched.
