# Services Save timeout and add-on input correction

Status: implemented and tested locally; **not deployed**. No production business data was modified. Keep this fix with the next coordinated release.

## Investigation

Read-only inspection of the linked database confirmed the installed service-save function matches the original owned-add-on implementation. Every intermediate `services` write runs both the Explore document and social-content statement triggers. Document refresh also invokes ranking/unified-search synchronization. The original save invokes that chain repeatedly while writing the parent, category, each child and retirement updates. No blocking service save was present at the time of inspection. Read-only source queries were fast in that sample; the isolated query timings do not establish the total trigger-chain runtime or exclude intermittent lock contention.

The earlier synthetic save fixture did not include these production statement-trigger paths. This correction adds them to the regression fixture and removes the proven write/refresh amplification. A successful Save on the live application remains to be verified after release; this task did not submit a production save merely to reproduce it.

## Changes

- New additive migration: `supabase/migrations/20261017235500_service_save_refresh_batch.sql`. Apply after `20261017194500_service_owned_addon_groups.sql`.
- Defer only the two service projection callbacks during the permission-checked atomic save, then fire their existing paths once over all saved parents, after all children are finalized. Other tables and ordinary service writes retain their normal trigger behavior. No triggers are disabled, no data is dropped, no work is silently queued, and projection failure rolls back the entire save.
- Acquire the existing ranking advisory lock before the source/catalog locks and use a custom query plan with JIT off for this small write RPC. No timeout limit, access control or booking rule is weakened.
- Clicking `+ Add` immediately focuses Name. Name, extra time and extra price have visible faint examples and a subtle underline, without boxed cards.
- Keep the numeric text draft while editing; empty price stays empty, `10.50` is preserved while typing, and existing numbers are selected on focus. Blank required numeric fields fail validation instead of silently becoming a free/zero-duration add-on. A genuine entered price of `0` remains valid.

## Validation

Evidence: `artifacts/service-save-input-fix-20261017/`.

- Ephemeral SQL integration and five booking-time regressions: all six passed (`sql-and-timing-complete.log`). Includes one final refresh per projection for Save all, final child visibility, preserved overrides/date limits, invalid-save rollback, projection-failure rollback, restored trigger mode and ordinary-write synchronization.
- Browser input regression: passed (`input-ui-final.log`). Covers focus, all placeholders, clearing zero, typing decimal price, blank-price validation, Save/Cancel and submitted numeric values.
- TypeScript: passed (`typecheck.log`).
- Lint for the changed input component: passed without warnings/errors (`lint.log`).
- Booking pricing, durations, buffers, staff assignment and next-slot algorithms are unchanged. No native build is required for this correction alone.

Read-only inspection files are diagnostic evidence, not production change scripts. The frozen source, hashes, task-only patch and ready completion event are under the same evidence directory. Integrate the patch into the exact then-current production baseline; do not copy this dirty checkout wholesale. Follow `docs/release-policy.txt` and preserve unrelated shipped changes.
