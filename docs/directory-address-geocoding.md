# Incremental public directory address geocoding

This maintenance worker enriches existing public, unclaimed US directory salons that have **neither latitude nor longitude**. It does not alter addresses, create salons, restore removed listings, geocode during Explore/search, install a scheduler, or launch a bulk operation. The default command is a read-only dry-run.

## Actual quality gate

On 2026-10-09, five live salons were selected using public search and their public directory-listing RPC. All five were publicly discoverable and unclaimed at selection. Five real [official Census single-address requests](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html), using `Public_AR_Current`, each returned one address match:

| Public salon | Matched address | Automatic gate | Request time |
| --- | --- | --- | --- |
| Nail Candy | 420 6TH ST, RACINE, WI 53403 | Accepted | 271 ms |
| Nails & Hair By Zuly | 2271 S NYE SCHOOL RD, BELOIT, WI 53511 | Accepted | 133 ms |
| Nail Lounge | N112W16510 MEQUON RD, GERMANTOWN, WI 53022 | Review required: grid street number | 128 ms |
| Nails 2000 | 1626 S 84TH ST, WEST ALLIS, WI 53214 | Accepted | 259 ms |
| Nails U Luv | 17800 W BLUEMOUND RD, BROOKFIELD, WI 53045 | Accepted | 139 ms |

These are five quality samples, not a coverage estimate or response-time SLA. This initial audit made **zero production coordinate writes and zero paid calls**. Full public responses are in `work/explore-read-model/census-address-dry-run.json`; a reproducible public-response fixture is in `tests/fixtures/census-directory-address-matches.json`.

After that gate, the reviewed migration was applied and one deliberately bounded five-address production batch ran. Three strict matches were applied and two were rejected (`unsupported_address` and `street_name_mismatch`); all writes passed the same current-source CAS. Artifact: `work/explore-read-model/directory-geocode-first-production-batch.json`. These **three** interpolated salon positions are the extent of this production enrichment; no bulk run or schedule was installed.

Census derives coordinates using street address ranges and interpolation. The match proves agreement with the supplied address; it does **not** verify the business exists, prove its rooftop/entrance, or replace an owner-confirmed pin. Stored provenance explicitly says `address_range_interpolated`. Suite/unit text remains in the address and CAS fingerprint even though coordinates identify the building's street range. No ZIP/city centroid is assigned as a salon position.

## Bounds and quality rules

`get_directory_geocode_candidates(after, limit, scan_limit)` performs an indexed UUID seek over at most 257 active location IDs missing both coordinates; 256 are inspected and the extra ID is only a continuation probe. It returns at most five eligible addresses. The cursor advances to the last selected eligible ID, or the last inspected ID when none qualify, so a sixth eligible salon is not skipped. The aggregate counts are restricted to this tiny page; no global count is performed.

Eligibility requires an active account/location, enabled and currently published discovery settings, an existing unclaimed directory ledger, a complete US address, and no matching suppression by listing ID or original import identity. Partial coordinates are preserved rather than repaired automatically.

The provider accepts one address per request. Each invocation processes at most five sequential addresses with at least one second between calls, a five-second request timeout, a 128 KiB response cap and no immediate retry loop. No key is required for Census. These are application limits, not a claim about a published Census quota. Run one maintenance instance at a time; this CLI does not implement a distributed provider-rate governor or establish bulk-provider capacity.

Automatic acceptance requires exactly one match, finite nonzero coordinates in range, matching city/state/5-digit ZIP, exact conventional house number within the returned range/parity, a matching normalized street name/direction/type, and a TIGER line ID/side. Only documented street-type/direction abbreviations are normalized. Ambiguous/unmatched results, differing regions/names/numbers, PO boxes, grid/fraction/range street numbers and missing provenance are held for review. No fuzzy fallback silently supplies a pin.

## Write safety and retries

Migration `20261009122031_directory_geocode_worker.sql` provides four service-role-only functions and a private job ledger. Anonymous and authenticated application users cannot select jobs, acquire leases or write coordinates. Jobs are unique by salon ID plus normalized full-address fingerprint, with a two-minute lease and at most three attempts.

The claim and finish transactions lock the account, location, directory ledger, discovery settings and job. Follow-up migration `20261009124031_directory_geocode_yield_locks.sql` uses `NOWAIT` and catches lock contention, immediately skipping a busy claim or returning `source_busy` on completion. Completion leaves the original lease/token/attempt intact; it makes no provider retry or partial coordinate write. The worker counts a yielded result as skipped, not applied or a provider-quality rejection.

Finishing rechecks active/public/current publication, unclaimed status, suppression, the exact current effective-address fingerprint, the lease and the absence of both coordinates. Owner pin changes, address edits, claims, hides or deletes therefore discard the pending result. The actual location update repeats the fingerprint/missing-coordinate check; existing synchronization triggers propagate the accepted update to the Explore projections. No address or owner permission is updated. Suppressions are read and never cleared. Application claim/hide/delete workflows lock the protected source rows; direct privileged concurrent maintenance must observe those workflows too.

Timeout/network/rate/provider failures back off for 15 minutes, then one hour. The third failed attempt is rejected; expired leases can be reacquired only within the same three-attempt cap. Permanent quality failures stay rejected for that fingerprint. A genuinely changed address gets a distinct job. `stale` or `lease_lost` outcomes are never counted as applied. Deleted salons cascade-delete their job; the independent suppression ledger remains intact.

## Running one batch

Apply the reviewed migration before using the maintenance command. The runtime needs the existing server-side Supabase service configuration and project development dependencies; never expose the service key in browser code.

```powershell
# Default: inspect up to five addresses and call Census; no coordinate/job writes.
node scripts/geocode-directory-addresses.mjs --limit=5

# Explicit write mode: the same strict matching and transactional CAS apply.
node scripts/geocode-directory-addresses.mjs --apply --limit=5

# Resume from the UUID returned as nextAfter. One invocation remains bounded.
node scripts/geocode-directory-addresses.mjs --apply --limit=5 --after=<returned-UUID>
```

The command prints only counts, public salon IDs, outcome/reason and the resume cursor; it excludes credentials, raw user GPS and provider URLs. It does not loop across the directory. When `hasMore` is false, a later deliberate run can restart without a cursor to discover later eligible/retry entries. The initial production batch applied three matches; the remaining directory has not been automatically geocoded or scheduled.

## Verification

`node --test tests/directory-census-geocode.test.mjs tests/directory-geocode-worker-sql.test.mjs` passes 15 tests: actual provider shapes, strict rejection, dry-run no writes, five-address cap, delay/lease order, fingerprint checks, service permissions, bounded scan/cursor, current-source mutation cases, existing/partial pins, deletion, malformed/expired tokens, source projection propagation, retry caps and source-busy accounting. TypeScript and scoped ESLint also pass.

An additional native PostgreSQL 17.11 test with two real connections proves that a duplicate concurrent claim obtains only one lease, busy owner/claim rows yield immediately (1.45 ms in the measured owner-pin sample), the original lease/attempt is retained, a concurrent owner pin is preserved, and a concurrent address edit makes completion stale. Artifact: `work/explore-read-model/directory-geocode-native-smoke.json`.

A separate raw-source query on the retained one-million-location fixture returned only 257 rows using `directory_geocode_missing_id_idx` in an Index Only Scan, with a UUID index condition and no Sort/Seq Scan (0.214 ms for that plan). Fixture columns/index existed only inside `BEGIN/ROLLBACK`; no fixture row or production changes were made. Artifact: `work/explore-read-model/directory-geocode-index-1m.json`. This proves the candidate index shape, not whole-worker or provider throughput at one million addresses.
