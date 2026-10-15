# Explore GPS area lookup

The GPS area bridge converts a consenting user's point into a containing city/state (and a postal area when a configured provider supplies it). Explore can then use its existing indexed salon address fields even when imported salons have no coordinates. It never returns a salon coordinate, guessed residence, centroid distance or a claim that a salon lies within a particular mileage radius.

## API and integration contract

`POST /api/explore/area` accepts JSON `{ "latitude": 43.0389, "longitude": -87.9065 }`. Coordinates must be finite numbers within their valid ranges; strings and null are rejected. The request body is limited to 1 KiB. Responses use `Cache-Control: private, no-store` and never echo GPS.

Successful response:

```json
{
  "area": {
    "label": "Milwaukee, WI",
    "city": "Milwaukee",
    "state": "WI",
    "postalCode": null,
    "country": "US",
    "source": "gps",
    "provider": "us_census",
    "precision": "city",
    "attribution": { "label": "U.S. Census Bureau", "url": "https://www.census.gov/" }
  },
  "error": null,
  "errorKind": null
}
```

Pass the returned label to the normal address-region search, preserving source `gps` and the user's scope setting. Display an area label such as “In Milwaukee, WI”; this lookup does not establish “within 10 miles” or closest ordering. Explicitly selected locations take precedence. Keep a manual city/state/ZIP choice available when lookup fails. Do not overwrite the account's saved location with inferred GPS or activity location. The UI integration belongs to the Explore client; this document describes the server contract.

Invalid input returns HTTP 400, a busy resolver returns 429, and caller cancellation returns 499. Unresolved areas and timeout/network/provider failures return an explanatory JSON result with `area: null` and separate `errorKind`, allowing manual selection. Never convert them into an empty-salon success.

## Providers and containment

If `MAPTILER_API_KEY` is configured, the server first uses [MapTiler reverse geocoding](https://docs.maptiler.com/cloud/api/geocoding/). It deliberately does not set a nearest-N `limit` or a single feature-type override. It reads city/state/ZIP context from the reverse response, requires a recognized US state and US country, and rejects conflicting city/state contexts. Provider attribution is returned as trusted text/link, not provider-supplied HTML.

When no key exists, or the primary lookup cannot supply a usable area, the server uses [U.S. Census GeoLookup](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html). Its coordinate search returns geographic memberships. This implementation requests only States, Incorporated Places and Census Designated Places using named layers and the current benchmark/vintage. It uses the containing place's `BASENAME` and state, ignores all centroid coordinates, and does not treat a county as a city. An ambiguous membership remains unresolved. Unincorporated points without a place can resolve to a state with `precision: state`.

Census does not supply a USPS ZIP in this request, so `postalCode` stays null. A city boundary may differ from a business's postal mailing city; the result is a geographic area, with wider/manual search available when needed. Current normalization supports the 50 US states and DC. Other countries/territories require another supported provider/normalization contract rather than inferred names.

These are external services, with no application-controlled response-time or availability guarantee. GPS goes to the lookup provider after the browser's geolocation permission; no street address, name, user ID, session cookie or account history is sent. This bridge does not use device location before the user requests it. The key is server-only and failures never expose upstream URLs or keys.

## Bounds and privacy

- At most four distinct in-flight resolutions and 45 new exact-point resolutions per rolling minute per server instance; excess work is refused immediately.
- Identical in-flight requests coalesce. Cancellation of one caller does not cancel another viewer's shared lookup.
- At most 256 hashed exact-input cache keys, ten-minute success TTL and twenty-second failure TTL, held only in process memory. GPS is not rounded into a reusable spatial cell: cells can straddle city/state boundaries.
- No account, database, disk, Next fetch cache, edge cache or GPS analytics writes. There are no salon database queries in area lookup.
- A provider response is limited to 128 KiB. Primary timeout is 1.5 seconds and fallback timeout 3.5 seconds; there is no automatic retry loop.

The request budget is an application protection bound, not a claim about a published provider quota. It is per server instance, not a distributed global limit. High global GPS traffic needs monitored provider capacity or an indexed local polygon dataset/distributed controls. The current bridge does not establish worldwide location-lookup capacity.

## Verification

Run `node --test tests/explore-gps-area.test.mjs tests/explore-gps-area-api.test.mjs`. Eleven tests cover actual parser shapes, state/CDP fallback, ambiguous/out-of-coverage data, strict coordinate input, missing-key provider selection, exact cache reuse/TTL/eviction, coalescing/cancellation, concurrent/rolling limits, timeout/network/rate failures, oversized responses, and API statuses/cache headers.

`work/explore-read-model/gps-area-live-smoke.json` records a real Census lookup for a synthetic public Milwaukee point, followed by an exact cache hit. The measured resolver request was 315.86 ms and the cache hit 0.07 ms with one upstream request total. These two samples demonstrate operational behavior, not p95 or a provider SLA. No paid or bulk forward geocoding was performed.

## Incremental salon coordinates

The official Census service also accepts a single public street address, without a commercial key. The separate [directory address worker](directory-address-geocoding.md) now implements bounded off-request enrichment. A five-address live dry-run matched all five, accepted four under strict quality checks and held one Wisconsin grid number for review. It made zero production coordinate writes.

The worker defaults to dry-run, checks at most 256 raw candidate IDs, processes at most five addresses sequentially, and uses unique salon/fingerprint jobs, short leases and bounded retries. A service-only transaction rechecks the full address fingerprint, current publication, claim/suppression status and missing coordinates before applying a result, yielding immediately when source rows are busy. Owner pins and partial coordinates are preserved. Fifteen tests and two-connection native concurrency checks pass. One subsequent bounded production batch applied three strict interpolated matches and rejected two; no bulk loop or scheduler is installed. The GPS area bridge does not run this worker; city/state address grouping works before every salon has coordinates.
