# Combined Tax, Ticket and native POS source integration

Status: **local integration validated; not published**. Coordinator candidate `C:\Reylumi-worktrees\combined-store-release-20261119`, starting commit `57c18befbc33add98d90cb9dffc1fd431e889c7b`. That candidate already contains the verified November 14 product baseline `830f0a6` plus the current Store aggregate and five iPhone/iPad QA packs. This integration does not replace those earlier inputs.

| Input | Exact frozen event | Original source base | Integration order |
| --- | --- | --- | --- |
| Owner Tax mirror20 | `850780e8-728c-4369-a43a-5f371ba9421f` | `23e66abd` (product parent830f) | 1 |
| Shared Tax figures43 | `77387343-3f01-4ddb-a518-e859492e7d6e` | `4d1e22d`, after Owner mirror | 2 |
| Android/Windows six fixes20 | `0608d5da-48de-4ef5-ba49-67e90d234dcf` | `23e66abd` | 3 |
| Portable POS/shared receipts108 | `6af73ca9-2db2-4c61-b78b-8a7bceba156a` | `1fd395c`, after six fixes; product `aeba8f8` | 4 |
| Professional Ticket19 | `341e4563-8c37-4117-aa17-4f6db0ad6d51` | Per-file original patch blobs; old canonical overlay was not a production baseline | 5 |

The three-way preparation exports base/incoming blobs, full-index patches and conflict files under the owning iOS worktree's `artifacts/combined-release-coordination-20261119/android-integration-r1/stage-candidate-57c18-r2`. It uses exact `git cat-file blob` reads. Earlier exploratory revisions are retained; revision2 is the corrected candidate staging input. Raw frozen source hashes were checked before normalization, and the four committed packs were compared to their exact product commits. Text line endings follow the candidate where practical; no formatter was applied to financial code.

Owner20, Shared43, six20 and the82 Portable source files merged cleanly. The26 Portable-generated `ios/Reylumi/LocalAppBundle/` paths were excluded: the final resource bundle must be regenerated from the complete combined source. Windows `desktop/package.json` remains byte-identical to the candidate at **0.7.6**. This does not create a new Windows distribution, signed Android binary or iOS archive.

## Ticket reconciliation

The professional snapshot supplies presentation and navigation intent. Its older financial and authorization bodies were not accepted wholesale. Eight conflict files were reconciled:

- `app/(app)/pos-tickets/[ticketId]/page.tsx`: owner membership still gates work/void/reopen; closed correction editing is owner-gated. The page keeps `ticketFinancialView(ticket, serviceTotals)` and passes service totals to `buildTicketReceipt`, so Gift is added once. Gift delivery, payment summary and prohibition on reopening Gift-sale tickets remain. The existing revision/request fields and revision-aware amount editor remain on mutations. The professional layout also keeps inline recorded history and the Portable canonical receipt preview/print controls.
- `app/(app)/pos-tickets/page.tsx`: retains both the shipped staff filter and focused ticket/date navigation.
- `app/pos-tickets/closed-ticket-correction-form.tsx`: retains financial history, Gift handling, transient-overlay dismissal, captured edit snapshot and correction payload fields. A detail editor starts with a captured ticket and nonempty request UUID. Locked detail editing still requires confirmation and its distinct request/apply paths. Ordinary list behavior remains unchanged.
- `app/pos-tickets/owner-live-tickets.tsx`: retains Gift search while adding focus and Edit navigation.
- `app/pos-tickets/ticket-filters.tsx`: keeps the shipped calendar; changing date clears the old focused ticket ID.
- `app/bookings/booking-workspace-client.tsx`: keeps current booking hints and `onClose`; adds ticket-list handoff without resurrecting the removed older agenda row.
- `lib/customers.ts`: retains attached canonical financial sources while adding ticket-list links.
- `lib/vietnamese-dictionary.ts`: retains current context/Check Writer copy while adding Ticket copy.

The already-shipped Reports → Ticket → Reports path also survives Edit/Cancel through a route-specific return sanitizer. Ticket-list sanitation remains limited to ticket lists; external, protocol-relative, control-character and unrelated destinations are rejected. Receipt readback includes the existing separate Reward amount.

No POS mutation action implementation, canonical ticket calculation/financial/receipt helper, price or billing authority was edited. All13 Store/privacy migrations remain byte-identical to the starting candidate.

## Validation

- **151/151** scoped Node checks passed, zero skips. This includes Owner/shared Tax models and disclosure, payroll formula regressions, native adapter/storage/outbox boundaries, Android six-fix behavior, shared receipts, ticket navigation and the real Ticket page with synthetic authorization/data/action boundaries. Evidence: `artifacts/combined-tax-ticket-android-integration-20261119/scoped-node-tests-freeze.log` and its command JSON.
- **5/5** actual component browser checks passed using the production page, editor, receipt renderer and print dispatch. They cover a manager with permissive mocked reads receiving no Owner mutations; canonical Gift$105 preview/print with zero financial dispatch; Reward$5 and grand total$100; revision7/nonempty UUID and two identical captured correction dispatches; locked confirmation/request/apply guards. Data, actions and native print acknowledgement are synthetic; no database or provider is called. Evidence: `browser/result.json`, `browser/gift-canonical-receipt-390.png`, `browser/closed-editor-same-uuid-390.png` in the same artifact folder.
- Manual merge files and focused tests pass ESLint with zero errors. The broader initial Ticket lint also observed the existing unused `staff` parameter warning in `owner-live-tickets.tsx`. Whitespace check passes with CR treated as the existing line ending.
- Protected baseline comparison checks all13 Store SQL files, the three canonical ticket helpers, POS action implementation and Windows package metadata. Evidence: `integration-receipt-r1.json`.

The repeat-form test verifies dispatch from the same mounted/captured form. It does not assert a new browser reload recovery protocol. Existing backend revision/idempotency remains the financial authority. The older historical-pixel fixture was not represented as a new combined-source pass; these are fresh source-bound component checks, not a full Next/Safari/native-device acceptance.

## Coordinator gates remaining

1. Run full combined TypeScript/Next build and required browser QA when the active Search benchmark permits it. This task ran no full build.
2. Replay the complete combined schema with the two Tax and two six-fix migrations plus all Store migrations. Static inspection found no direct or guarded function-target overlap: Tax patches `audit_payroll_live_change` and optional `financial_input_notice_summary`; Store Tax erasure patches personal erasure/batch/completion and `tax_save_profile`. Static inspection is not a schema acceptance. Personal `tax_profiles` erasure must still complete; shared documents, published financial snapshots and recipient custody retain their existing rules. No migration was applied here.
3. Regenerate and validate the final native resource manifest; preserve both current Store/QA and Portable/native printing glue. Mac compile/archive/device AirPrint, signed production Android/Play path, physical Windows install/upgrade and thermal printer acceptance remain separate.
   Peer source review also confirms a presentation boundary: `lib/app-local-daily-registry.tsx` admits only `error` on a native ticket URL. New professional Edit/return-context links therefore take the existing `host.openOnline(destination)` fallback in `app/local-app/entry.tsx`; a plain ticket UUID still renders the older native `AppLocalTicketDetail` plus the new receipt print controls. Ticket19 was a web-channel input. The approved integration keeps this existing secure hosted path and strict query gate; a fresh test of the real registry plus native hosted-transport method proves Edit and the exact safe return query survive unchanged, while external destinations are rejected before bridge dispatch. Native professional presentation parity is not claimed. Physical combined QA must test both plain native overview and hosted editing; no additional native renderer/query admission was introduced.
4. Preserve the original physical Samsung receipt for its exact earlier QA APK (pending$50 synced once, canonical T00003 offline/PDF and separate12.34 draft preserved). It does not prove the newly assembled binary. PAX remains a proposal with no SDK/provider/device acceptance or activation.
5. Other chat integration packs, Search readiness, production alias/source guard, publication, provider configuration, TestFlight and store submission remain coordinator work. No push, deploy, signing, purchase, account or provider mutation occurred here.

The input event records and their original frozen snapshots remain intact. Completion evidence is a new local integration event, not publication of those inputs.
