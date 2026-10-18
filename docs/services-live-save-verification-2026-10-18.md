# Services live Save correction — 2026-10-18

Status: validated; awaiting coordinated migration publication. Existing Services UI and both earlier migrations were already live. This follow-up does not change the booking structure or its pricing/scheduling rules.

## Reproduced failure

An owner-permission-checked call to the installed `save_owned_service_config_batch` against King Nails Spa LLC timed out in `refresh_explore_unified_search` while retiring content history. The previous batching migration removed repeated projection refreshes but the remaining content anti-join still expanded the global content view. The database contained 107,420 content-history rows. The failing transaction rolled back; no QA catalog entry persisted.

## Correction

`20261018234500_service_save_scoped_search_refresh.sql` materializes content for the affected salon IDs before the three correlated anti-joins (no-op check, incarnation retirement and history retirement). It retains source visibility, fingerprints, source tokens, revision clock, retired history and atomic rollback. Custom plans and JIT off avoid generic full-view plans. No timeout, authorization, booking function, table data, price or staff schedule is changed.

## Evidence

- `artifacts/services-live-20261018/live-save-rollback.log`: original installed Save reproduced the statement timeout; whole transaction rolled back.
- `candidate-rollback.log`: corrected Save + three owned add-ons completed in 382 ms.
- `candidate-full-rollback.log`: corrected Save completed in 159 ms; actual booking-line triggers snapshot $65 / 70 minutes; Choose one rejects a second selection; staff is unavailable one minute before occupied end and available exactly at occupied end. Salon cleanup buffer was zero. All synthetic services, customer, booking, reservations and messages rolled back; test customer had no contact information.
- `regression.log`: six tests passed, including staff overrides, per-line buffers, closing/break/next-booking overlap and split-staff occupancy.
- `scoped-search-test.log`: original/corrected refresh equivalence for add/edit/retire/recreate, multiple salons, no-op revision and rollback; unrelated salons remain unchanged.
- Live browser: +Add focuses Name; zero can be cleared; decimal 15.50 renders correctly; Cancel discards all QA drafts. No real salon service was edited for this UI check.

Only a database-function migration is needed for this follow-up; the verified Services web UI is already published. No native build is required. Publication receipt must record the exact current production baseline, migration hash and post-application live rollback/UI checks; do not treat the candidate rollback test as publication evidence.
