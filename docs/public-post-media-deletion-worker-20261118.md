# Public post photo deletion worker — 2026-11-18

Status: local candidate, 10/10 focused mock tests and scoped ESLint passed. No deployment, real Storage request, customer-data inspection or provider acceptance is represented by this document.

The worker removes a terminally deleted post's newly approved, fully pinned public photo through the Supabase Storage API. It processes at most five claimed objects per call. It does not scan buckets, delete legacy uploads, remove identity assets, or purge moderation/review evidence. Removing an origin object does not recall copies already downloaded or cached by third parties.

`claim_public_post_media_deletions({p_limit:5})` is service-only and is the database authority for terminal deletion, actor/tenant ownership, no live references or retention/review/erasure conflict, and exact object ID/version/eTag/hash/size. Its transaction installs a permanent manifest fence before returning a lease. Those database guards must be integrated with this worker; client path validation alone cannot establish those facts.

The worker independently requires UUID identifiers and lease token, nonempty bounded version/eTag, lowercase SHA-256, integer size 1–512000 bytes, an active lease, and complete canonical paths:

- Beauty: `<uploader UUID>/beauty/{image|before|after}/<UUID>.webp` in `beauty-profile-media`.
- Salon: `<salon UUID>/looks/<UUID>/<UUID>.webp` or `<salon UUID>/updates/<UUID>.webp` in `salon-profile-media`. The database proves salon ownership; the queue contract does not include a separate salon ID.

For each accepted job it calls `storage.from(bucket).remove([object_path])` with one exact path, then `finish_public_post_media_deletion({p_id,p_lease,p_error:null})`. A successful Storage response alone is insufficient: only `data === true` from finish counts as removed. Finish verifies the matching live lease and actual Storage metadata absence. Missing objects can be retried idempotently. A false, failed, thrown, expired or lost checkpoint stays unconfirmed.

The worker stops starting requests after a ten-second work budget and requires more than twelve seconds left on the lease before any request. Its default shared service client caps individual fetches at twelve seconds. It awaits in-flight removal rather than racing an unabortable Storage mutation against a timer; if budget or lease margin is spent, it starts no checkpoint/release call and the database lease allows retry. Thus the ten-second budget limits new work, rather than guaranteeing a ten-second wall-clock completion. Storage errors may release only the current lease using `p_error:'storage_remove_failed'` while time remains; no raw provider error is persisted or returned.

`runPublicPostMediaDeletions()` returns only `{claimed,removed,failed,deferred}`. `failed` includes every uncheckpointed claimed row; `deferred` is its budget/lease subset. One invalid/failing row does not stop subsequent rows while time remains. A malformed/oversized claim fails before removal. No paths, users, image contents or raw errors are logged or returned.

Coordinator integration uses the existing authenticated `/api/account/erase-due` route and its `KINGPOS_DISABLE_BACKGROUND_DISPATCH` guard. No new cron or permission is introduced. The coordinator owns route wiring and the final combined build; the database agent owns migration and actual local Storage API/concurrency acceptance. This worker's synthetic tests do not prove those separate integration results.

Validation command:

```powershell
node --test tests/public-post-media-deletion-worker.test.mjs
npx eslint lib/public-post-media-deletion.ts tests/public-post-media-deletion-worker.test.mjs
```

The ten synthetic tests cover all five accepted path forms, identity/legacy/quarantine/cross-author and missing-pin rejection, lease/deadline guards before each request, bounded failure release, failed/lost checkpoints, absent-object retry with the new lease, budget spent during removal/claim, continuing siblings, sanitized queue failure, oversized-batch rejection, and actual Supabase client RPC/Storage serialization over a fully injected transport. Every transport is injected and the default service factory is replaced by a throwing test stub.

Evidence: `artifacts/public-post-media-deletion-worker-20261118/mock-acceptance.log`, `eslint.log`, and the immutable source freeze/manifest in that directory. Combined route, database, actual local Storage API and final build acceptance remain separate coordinator checks.
