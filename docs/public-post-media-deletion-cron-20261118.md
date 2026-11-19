# Terminal public-photo cleanup — maintenance integration, 18/11/2026

Local integration of `runPublicPostMediaDeletions` into the existing `/api/account/erase-due` route. No new schedule, production call, public activation or data deletion occurred.

The timing-safe CRON_SECRET check and `KINGPOS_DISABLE_BACKGROUND_DISPATCH` guard remain before every worker. Export expiry, private staging cleanup and the new exact terminal-photo queue run independently; account erasure still runs after those bounded tasks. A failed or deferred photo job keeps HTTP503/retry visibility without suppressing account erasure or the other cleanup workers. Responses contain aggregate counts only and retain `Cache-Control: no-store`.

The route's300-second maximum remains unchanged. The existing account worker starts a230-second budget after the bounded parallel jobs. The new worker has a10-second new-work budget and the existing service client caps in-flight requests at12seconds; a depleted budget or lease prevents further requests/checkpoints. This is a source budget, not production latency or completion evidence.

Source selection is the companion database claim, not a bucket sweep. Only fully pinned newly approved Beauty/Salon post objects after an explicit terminal delete can be considered. Shared covers, booking/Market/history/other-post references, review evidence and account-erasure ownership/retention are protected by the companion migration. Holds, archives, report receipts and ordinary support-case closure do not authorize a purge. Legacy/unpinned objects are excluded. No direct delete of Storage metadata is introduced.

`tests/account-maintenance-route.test.mjs` and the route-boundary fixture in `tests/public-image-staging-expiry.test.mjs` were updated to mock all current worker transports. Authorization, disabled maintenance, success and independent worker failures are asserted without loading a live service graph. Combined route/staging/worker run: **18/18 pass**, no skips; no actual provider requests.

Database/API/lease/reference-race acceptance and exact source freezes are separate evidence in [database notes](public-post-media-deletion-20261118.md) and [worker notes](public-post-media-deletion-worker-20261118.md). A source build or this route test does not prove a hosted cron ran. Browser/CDN copies and global copyright takedown of shared or appeal-evidence images are not claimed as recalled by this worker.
