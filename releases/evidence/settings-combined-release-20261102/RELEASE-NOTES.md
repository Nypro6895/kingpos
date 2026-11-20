# Combined Settings web release — 2026-11-02

Authorization: user requested Deploy after queuing Salon Settings and All Settings for a combined release.

Baseline: `dpl_HqmigxW39vxi2SRAoYM1y4KjzB6G`. Independently checked 3,776 live source files against Vercel content SHA-1 identifiers; no source download was necessary because every local baseline file matched. The release upload retains every baseline file and adds five scoped source/documentation files. Only 20 uploaded source files differ from live.

Selected queue: compact Salon/All Settings, compact Staff hours with inline online-booking controls, compact salon profile header/Experiences tab, and Payroll/Today group dividers. `pending-decisions.json` carries forward the previous release's explicit holds for unfinished or separate-platform changes; their pending state remains intact.

Integration preserves newer shipped Settings navigation, Activity retention, permission targeting, custom controls, read/edit sections, map-provider guards, public-profile preferences, and existing save/conflict/confirmation behavior. The older task's entire files were not copied over newer production features. Settings fixtures were adapted to real radio controls and Save appearing only after an edit.

Validation before candidate publication:

- Fresh production build including full TypeScript passed (`build-final.log`). Earlier inherited image-route runtime error is absent from the current live baseline.
- All 21 assembled tests passed, none skipped (`regression-final.log`). Actual ten-panel Settings browser fixtures include responsive rendering, draft retention, save/cancel, targeted salon writes and closure confirmations. Profile-header and staff-hours suites include error paths and permission handling. Transports are mocked; no real financial changes, invitations or destructive writes were performed.
- Scoped ESLint: zero errors; one inherited `__vt` dependency warning in the shared booking editor.
- Upload dry-run excludes environment files and all test artifacts. Exact uploaded-file hashes are in `web-source.json`.

Native assessment: all four changes are web UI/server-action changes using the current bridge contract and existing schema. No Swift, bundled JS/assets, signing, permission, native configuration, or bridge changes are selected. A new native binary is not required. Real-iPhone physical acceptance remains separate from responsive Chrome/Windows and authenticated browser checks.

Candidate and live acceptance are recorded separately in `candidate-source-verified.json`, `http-candidate.json`, `live-source-verified.json`, `authenticated-live.json` and the immutable release receipt. Production writes are not used for acceptance. The fallback is the exact captured baseline deployment; never roll back over an unrelated external release.

Final role review: the staff online-booking switch now uses a dedicated salon_settings.manage capability from the selected-salon DTO, matching its server mutation. Booking-rule editing retains booking.manage. The two permissions are tested independently. The first candidate was not promoted; the final candidate includes this correction.

Final authenticated Owner review at 1920px and 375px: compact Settings shell and one visible editor, no overflow or visible alerts, retained full description in Edit, working local edit/cancel without saving production data. Standalone Business info and Opening hours and Booking Staff hours were checked on the immediately preceding deployment; the final refinement changes only the salon summary description preview. Physical iPhone acceptance is not claimed.
