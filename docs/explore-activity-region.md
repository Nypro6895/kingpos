# Explore activity area

`get_explore_activity_region()` returns the authenticated viewer's probable activity area:

```json
{"label":"Milwaukee, WI","source":"activity","confidence":1,"evidenceDays":3,"lastObservedAt":"2026-10-08T12:00:00Z"}
```

Insufficient or conflicting evidence returns an empty label, `source: "none"`, zero confidence and evidence days, and a null timestamp. There is no target-user argument. Anonymous callers have no execute grant. The function does not store GPS or claim a home address.

The first policy uses 90 days of history, at least three distinct observed days in the winning city/state, and at least 70% of all observed region-days. Ties return no area. Constants are declared at the start of the function so a later migration can adjust them after measurement.

Evidence comes from completed bookings whose user linkage was authenticated or claimed, actual check-in timestamps for active staff associated with the viewer, and closed POS tickets with a current verified customer identity claim. POS/booking references are deduplicated, and repeated events in the same region on the same UTC day count once. Membership alone, cancelled bookings, pending appointments, follows and raw contact matching are not evidence.

Legacy staff auth IDs are supported only when the stronger public-user link is absent. Customer POS evidence requires both the current `customers.customer_user_id` link and an identity claim proof for that user and salon. Evidence from inactive/deleted salons, future timestamps and dates outside the window is excluded.

Each source stops at 513 records. If a source exceeds 512 eligible records, inference returns no area rather than trusting a biased truncated sample. This favors a saved/manual choice for very high-volume histories and keeps aggregation bounded. City names are normalized for grouping and states are uppercased; labels preserve the latest recorded city spelling. UTC date buckets are deliberately consistent across sources; they can differ from local calendar-day buckets near midnight.

The resolver in the application should use manual area, current authorized GPS, this activity hint, saved area, then no area. An activity hint is an overrideable default. Its provenance must not be presented as a residence. Local saved preferences must not silently replace an active manual/GPS choice.

`tests/explore-activity-region.integration.test.mjs` executes the migration SQL in isolated PGlite with all source tables. It covers multi-day evidence, ties, dominance, authentication isolation, POS claim proof, booking deduplication, active staff/legacy identity, old/future/deleted data and bounded-history fallback. These tests establish evidence rules; they do not establish production response latency.
