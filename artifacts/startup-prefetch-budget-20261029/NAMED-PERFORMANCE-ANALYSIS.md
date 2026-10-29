# Named native67 startup analysis, 2026-10-29

Method: join native-UA CDN request IDs to runtime observation IDs in memory, then discard identifiers. Owner window 49CDN records/50runtime observations/49matched; complete pagination and no excluded intervals. Native-UA/time attribution is not cryptographic single-device attribution. Sanitized exact observations: ../startup-read-observation-20261029/named-owner326-metrics.json and named-staff-beauty326-metrics.json.

| Owner sample | Today full server wall time | Other Today observations | Today backend calls | Header-sized coverage |
| --- | --- | --- | --- | --- |
| cold1, retained cache |1321.5ms|staff256.8/bookings282.7/waiting299.1/extras222.6/financials377.8ms|6auth/48REST/20RPC|REST16/48 responses146bytes; RPC14/20 responses178bytes|
| cold2, retained cache |787.1ms|staff281.3/bookings323.3/waiting269/extras211.6/financials407ms|6auth/48REST/20RPC|same partial coverage|
| warm1 |477.7ms|no phase observations in exact window|1auth/16REST/4RPC|REST6/16 responses31bytes;RPC3/4 responses31bytes|

Bytes are only existing header-reported Content-Length measurements; their tiny values reflect covered upstream responses, NOT total DTO/body or wire bytes. Do not add overlapping stage/context/backend durations as wall time. Cold samples display old cached primary data first, then revalidate. No first-uncached, subsecond, full-image/full-app or matched improvement percentage claim.

Warm Owner Today also completes10 distinct off-route resources: bookings,salon-profile,notifications,POSworkspace,tickets,reports,customers,staff,services,Payroll. This matches defaultJobs in app-local-prefetch-plan.ts; unlike repeated generic HTTP endpoint names it establishes actual broad background page warming. Payroll alone775.5ms,26REST+3RPC+1auth (only8/26REST responses72header-bytes,1/3RPC17header-bytes). Salon-profile477.7ms,14REST+19RPC+1auth. These are background costs, not proven direct startup critical-path contributions.

Today full+five phases are distinct observations when initial full cache is older than15s; no claim six identical duplicate requests. context.root/route may be nested within one HTTP request. Existing background ownerCampaignPromptAction was separately identified from safe pinned command tracing; its later completion is not proof of primary-paint causality. Advertising remains eligible on enabled non-admin routes because campaigns may target '/' and owner audience; no unsupported Explore-only exclusion.

Bounded correction in7ccb53a: at most2off-route speculative DTO reads per accepted identity, current route remains eligible, pending jobs promoted by actual navigation. Normal authority,scope,revocation,lease,binding,cache freshness/invalidation/retained visited DTOs and canonical financial readers unchanged. Unwarmed pages perform their ordinary initial read when selected. Browser regression before patch drains12hidden reads; after23/23 runtime/plan tests and14/14 Today/scheduler checks pass, zero skipped. Physical next-build proof still pending.

Staff-switch window: notificationsfeed273.5ms,staff.relay358.8,auxiliary322.9,advertising265.2,context.route385.6. Beauty warm window: advertising250.4ms observed. Absent page observations do not mean zero work; retained cache and window/coverage limits apply. Role command between Staff and Beauty windows excluded from Beauty attribution.

Finite observer expires11:30UTC, not extended. Source cleanup in same candidate restores both API routes byte-for-byte to b9682b0 and deletes owned helper/privacy test. Frozen sanitized evidence retained. Live cleanup probe/source/readback receipt pending, not yet complete.

Final: physical68 finite8windows verified separately, cached primary1.689/1.682s and warm1.085s include harness; first-uncachedNOTRUN, under1sNOTPASSED, no causal speedup. Padded CDN Reports window contains pre-tap304 work, so not all15 requests belong to click/Reports; namedidentity unobserved. Cleanup before/afterTTL source/live verified, finalreceipt34d1847f-953b-4f68-bc6f-caa8af50f3bf, ownedlockreleased2026-10-29T11:40:15.720Z.
