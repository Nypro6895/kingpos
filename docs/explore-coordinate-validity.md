# Current coordinates for Explore distance

Migration `20261009127031_explore_coordinate_validity.sql` preserves every original location pin. The existing Explore source view retains its column names and types, but projects a null latitude/longitude pair when a pin is incomplete, out of range, `(0,0)`, marked stale/address-required/pending/failed, or its recorded address fingerprint disagrees with the current effective public address. Complete legacy coordinate pairs without fingerprints remain usable even when the mailing address lacks a street/ZIP, unless explicitly invalidated; no wholesale legacy backfill or pin deletion occurs.

Public address inserts/changes compare a normalized positional address signature separately from the provider-complete fingerprint. Changing one incomplete address to another therefore still marks a previous pin stale (or address-required) atomically and refreshes the existing projections through their existing triggers. The old pin values and address fingerprint remain intact for review. A pure server helper applies the same validity rule to the owner map display. Public search by city/state/ZIP remains available without coordinates.

Text city/ZIP inputs no longer synthesize a center from up to 32 salon pins. Only a real supplied point establishes distance or a mileage expansion ring. The ranking/UI changes separately choose the supported sort and explain missing location; this migration does not claim a user lives at the selected address region.

## Safe refresh

The nullable `locations.geocoding_pin_origin` records `auto_census`, `auto_maptiler` or `owner_confirmed`; existing rows remain null. An explicit owner-confirmed pin cannot be overwritten by either automatic directory maintenance or the owner geocoder refresh RPC. Confirming a pin must set this field even if its coordinates do not change.

Directory maintenance retains its one-tick five-address maximum, indexed source seek, provider delay/timeout, public/unclaimed/suppression gates and NOWAIT locking. It can additionally select an obsolete **Census** automatic pin only when a prior successful private maintenance job proves the exact original fingerprint and coordinates. Unproven legacy, partial, owner-confirmed and MapTiler pins are excluded. Owner MapTiler refresh has a separate permission-bound path.

Claim stores the immutable source pin snapshot with the new lease. Finish compares the current public address and complete original pin snapshot (including provenance and geocoded time), then rechecks claim/suppression/publication under protected-row locks before writing. Changing the address, replacing/confirming a pin, claiming/hiding/deleting the salon or suppressing its imported identity makes the result stale. A busy source yields immediately without changing the lease or attempt. Pre-migration leases may complete only if their source still has no coordinates.

Returning to a formerly successful address is a new source-refresh cycle when the current pin is proven automatic and obsolete. A source-stale job may be claimed again after eligibility is restored. Each current cycle has at most three transient-error attempts; quality-rejected fingerprints remain held. This does not install a scheduler or global provider-rate governor.

The owner geocoder uses `set_current_salon_geocoding_state` instead of an unguarded location update. It verifies an authenticated management permission, active source account/location, current address fingerprint and original pin. Pending/error transitions retain original pin metadata; completion cannot attach a previously requested result to a new address. A stale/busy preparation does not call the provider. No geocoding is performed during Explore/search.

## Verification and limits

`tests/explore-coordinate-validity-sql.test.mjs` loads the actual original canonical view and synchronization triggers, the real search/geocode migrations and this correction. It checks unchanged output shape, migration repair of an already-stale projection, retained source pins, address changes/reverts, automatic re-enrichment, owner/claim/suppression protection, null/partial/legacy pin handling, permission restrictions, manual no-point null mileage and actual city+GPS distance.

`tests/explore-coordinate-validity-runtime.test.mjs` executes the actual owner module with controlled server dependencies. It checks suppression of a stale map display, protected owner/legacy pins, current automatic backfill avoidance, original metadata through pending/error and provider avoidance on stale/busy preparation. Existing Census parsing and worker regression suites remain required.

These are correctness gates. Native concurrent-source tests and latest-stack city+GPS/Closest profiling must be recorded separately before claiming load capacity. Source pin preservation is not a rooftop accuracy guarantee: Census still records address-range interpolation. This change makes no production coordinate writes, installs no bulk backfill, and does not broaden US geographic coverage.
