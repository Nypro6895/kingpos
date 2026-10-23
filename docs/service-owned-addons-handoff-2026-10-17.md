# Service details and owned add-on groups — deploy together

Owner authorization: implement and test only, 2026-10-17 (America/Chicago).
**Not deployed. Do not treat this note, local checks or an event as publication.**

## Scope

- Compact, inline Service details; separate staff and booking-extra blocks; remove repeated Active/Online switches from details (the existing summary controls remain).
- Visible per-service Save changes/Cancel, plus batch actions above mobile navigation. Saving one service preserves other unsaved service drafts. Refresh after a successful standalone save.
- Add and edit service-owned extras with name, extra time and extra price. Two independent optional groups: choose at most one; choose multiple. Keep the existing six-extras-per-booking limit.
- Booking keeps its current steps, service/category picker, staff modes, availability engine, confirmation, payment/deposit and management flow. Only the existing service Options contents change.
- Category remains `services.category`. Existing category suggestions and save-time case-insensitive spelling reuse avoid introducing a category-management table or another booking step.

## Storage and compatibility

Migration: `supabase/migrations/20261017194500_service_owned_addon_groups.sql`.

This adds `services.booking_parent_service_id` and `booking_add_on_group`, a salon-scoped parent foreign key, an atomic permission-checked save RPC, and a booking-line group/snapshot guard. It preserves the service-backed scheduler and existing booking/POS references. The public profile menu and main booking picker exclude owned children; the workspace loads them within their parent.

Existing main services and legacy add-on links are not rewritten by the migration. Legacy links are shown in the multiple-choice group; saving their parent copies them to owned children. The original main services and historical booking IDs/snapshots remain. Removed owned extras are retired, not deleted. New children inherit the parent's booking staff and assignment date limits. Existing staff-specific price/time overrides and assignment date limits are preserved when saving; actual staff price/time values are used in booking-line snapshots for owned extras and their parents.

**Apply this migration before the new web source** because the service loader selects the new columns. Validate it against the production baseline in the ordinary coordinated release; this task has not run it against production. No native/iOS source, bundled assets, permissions or bridge contracts changed; no new native binary is required by this patch alone.

## Time and pricing guarantees checked

- Base $40/45 min + Gel $15/15 min + Massage $10/10 min = $65/70 service minutes.
- Group selection: French replaces Gel; multiple extras remain selected independently. Base + French + Massage + Paraffin = $72/75 service minutes in the real booking UI fixture.
- Use actual staff overrides for slot price/time and saved booking-line snapshots.
- Preserve the existing cleanup buffer per scheduled line. Displayed service duration excludes buffers; occupied end time includes them. No buffer-policy change is included.
- Both runtime slot generation and the real SQL availability function reject a new booking before the staff's last occupied line ends and permit an adjacent booking at that end, subject to existing slot grid, working hours, breaks, other bookings and buffers.
- Adding extras invalidates a slot that would cross a subsequent appointment, break or closing time. The existing final slot lookup and database concurrency guards remain in place.

## Verification and integration evidence

Evidence directory: `artifacts/service-addon-groups-20261017/`.

Validation completed against synthetic fixtures (no production writes):

- TypeScript: passed (`typecheck-final.log`).
- Core regression run: 18 passed; its four tooling-dependent skips were then run with tooling enabled against the isolated source: all four passed (`regression-core.log`, `regression-browser-clean.log`).
- Existing complete booking wizard: passed against isolated source (`wizard-clean.log`). The initial dirty-checkout run timed out while preparing its fixture; it is not counted as a pass.
- Actual mobile service editor Save/Cancel, independent extra groups and bottom-navigation clearance: passed (`editor-ui.log`, mobile/desktop screenshots).
- Actual booking radio/checkbox groups and displayed price/time: passed after extracting the add-on component (`booking-ui-final-component.log`).
- Five timing scenarios, including per-staff split-booking end times, plus ephemeral SQL integration: passed (`timing-final-passed.log`). The final SQL revision additionally preserves assignment effective-date limits and passed (`sql-final-with-dates.log`).
- Lint: no errors; three existing hook dependency warnings and the retained, unused legacy `addOnKey` helper warning are recorded in `lint-final.log`.
- Full production build: passed from the isolated runtime source (`build-clean.log`): compilation, TypeScript and 222/222 generated pages completed, exit 0. All ten changed runtime files were hash-compared with that build's copied source and match. Production service credentials were disabled for this build. The first dirty-checkout build was blocked by generated-directory permissions; superseded slow build attempts were stopped and are not counted as passes.

Frozen source: `artifacts/service-addon-groups-20261017/frozen/`.
Task-only overlay: `artifacts/service-addon-groups-20261017/task-only.patch`.
Per-file before/after hashes and source/overlay SHA-256: `artifacts/service-addon-groups-20261017/source-manifest.json`.
Completion manifest: `artifacts/service-addon-groups-20261017/complete.json`.
Release journal change ID: `service-owned-addon-groups` (web, ready, unpublished).

The checkout already contains extensive unrelated changes. The task's `before/` source and task-only overlay distinguish this patch from them. Integrate the overlay into the exact current live source; **do not deploy this dirty checkout or copy frozen files wholesale over a newer production baseline**. Preserve all required Explore/location and unrelated shipped changes under `AGENTS.md` and `docs/release-policy.txt`.
