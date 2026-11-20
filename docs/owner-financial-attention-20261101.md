# Owner financial attention

Implementation worktree: `C:\Reylumi-worktrees\owner-financial-attention-20261101`.
Baseline: `88246c1` (verified Shop Money release source). This is an implementation handoff, not a release receipt.

Today always uses the salon's current business date, including legacy date URLs and native named reads. Financial attention is separate: unresolved prior business days and unreviewed historical financial events remain actionable today. Routine booking/queue updates and unread notification records are excluded.

## Rules

- Closing: past dates with tickets, non-cancelled visits, entered reports or Shop Money collections. An auto-lock/snapshot alone never proves a review. A separate owner review stores the fingerprint of recorded ticket facts, collections, report inputs and visits. Changed figures require review again. Existing explicit closed/approved days are respected unless subsequent financial history exists. New confirmations require entered collections and no open receipts. Confirmation only records review; it does not post payments, alter financial totals or approve payroll.
- Changes: committed `financial_input_events` for ticket updates, using existing lifecycle classification to exclude initial receipt creation and draft editing. A discount change is represented once as a discount item rather than duplicated as a generic edit. Snapshot comparisons preserve the exact event, operator label and note. Existing Portable correction instrumentation remains the audit authority.
- Discounts: captured discounted receipt creation, changes/removals of a previously positive discount, plus a current-state fallback for older discounted closed receipts without captured history. Reward discounts are visible too; no assumption of misconduct. Unknown earlier facts are labelled, never reconstructed.
- Check-in: past-day non-cancelled visits, completed visits, or checkout handoffs older than 15 minutes without a settled, closed linked receipt. Active same-day waiting/service and a normal recent checkout are excluded. Match each visit through its actual ticket link, not aggregate counts. Show other same-customer/day receipts for manual comparison; never auto-link or collect again based on the warning.

Ignore persists on the server per owner, salon and exact item key. It removes that item from future Attention lists without changing the source or audit history. A new event or changed unresolved figures has a new key and may appear. Opening an item does not ignore it. Ignored immutable events remain accessible through their exact detail URL. There is no automatic Ignore or automatic financial mutation.

## Transport and release dependencies

Apply `supabase/migrations/20261101070000_owner_financial_attention.sql` after the baseline migrations (including financial input history/lifecycle/context and Shop Money). It adds only owner review/ignore metadata and private owner-scoped RPCs. No production migration has been run by this task.

The endpoint is authenticated and owner-only in both the web handler and SQL. Writes bind the selected salon and public viewer ID; the native adapter additionally validates its workspace lease. Reads are GET/named reads with no retention; writes are pinned POST commands with no replay. Lists paginate 50 rows and report the full non-ignored count. Failures/timeouts never report an empty successful check.

iOS requires a new bundled client/manifest: the source adds the `/staff/today/attention` renderer, pinned HTTP read/command and named page read. `build-app-local-bundle.mjs --verify-only` passes Safari 16 compilation with zero unsupported actions. No generated QA bundle, signing, archive, upload or device acceptance is claimed. Rebuild/activate against the combined release baseline, not an earlier task's full snapshot.

## Validation

- Dedicated local PostgreSQL fixture database `owner_attention_qa_20261101_r3` in existing local Docker container; migration compiles and assertions cover role/salon isolation, private helper/table privileges, idempotent per-owner Ignore, exact ignored-event detail, removed discount, draft suppression, active/settled visit exclusions, underpaid linked receipt, unentered closing rejection, review persistence, stale/new fingerprints, status-only visit transitions and pagination beyond 50 items. These use minimal dependency fixtures, not a production-schema rehearsal.
- Presentation/native unit tests and Shop Money/financial-concurrency regressions.
- Browser fixture uses real Today, QuickExpense, Attention panel/actions and detail components with simulated shell/API; five widths 320/390/430/768/1280, no page overflow, modal Escape, no date/list buttons, Ignore/reload, new event, exact discount details and failed-read state.
- TypeScript source check and scoped ESLint. Local check config maps two existing missing canonical dependency packages (`pdf-lib`, `@pdf-lib/fontkit`) to the already installed baseline dependency tree; no shared dependencies were changed.

Full production build, deployed RPC/endpoint acceptance, full-schema staging rehearsal and authenticated physical iPhone/Windows POS acceptance remain release checks. Existing history cannot recover edits never captured before its cutover, and missing visit/ticket identity links cannot establish non-payment.
