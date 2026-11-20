# Public post photo deletion candidate — 18 November 2026

This is source preparation only. No hosted schema, customer object, provider credential, deployment or store declaration was changed. The source patch is limited to `supabase/migrations/20261118220000_public_post_media_deletion.sql`, its integration test and this document; the Storage worker and maintenance-route integration are owned separately. This task did not edit the previously frozen Privacy/Terms files. The coordinator must reconcile any concurrent legal-source delta separately.

The existing canonical terminal delete sets Beauty `deleted_at` and deletes Salon look/update rows (`20261017194500_post_actions_canonical_caption.sql:41`). The admin content decision does the same (`202610070007_post_safety.sql:169`). Before this candidate, the cron workers removed private upload staging, expired exports and account-erasure objects, but no public photo cleanup queue was found in the source. Public final uploads set `cacheControl: "31536000"` in `lib/public-image-safety.ts`; public bucket declarations and a hidden/deleted post row do not establish raw URL revocation.

## Deliberately narrow eligibility

Only a terminal Beauty `deleted_at: null → timestamp` or an actual Salon post row deletion enqueues a candidate, inside that same database transaction. Beauty transitions already owned by an account-erasure job are skipped. Capture requires a **new `approved` manifest**, the exact expected post path, nonempty pinned Storage object ID/version/eTag, matching SHA-256, image/webp and 1–512000 bytes. Legacy and unpinned objects are excluded; there is no historical sweep or bucket-prefix purge. Capture uses plain reads, no source/user foreign keys and no user/manifest row locks after the existing source-post lock.

Claim retains bytes when any of these exists:

- Another nondeleted Beauty post or any Salon post row, including draft, archived and held content.
- Beauty cover, Salon cover/logo, staff public photo or an independent booking-inspiration reference to the exact bucket/path.
- A saved or published Market `media.images[].assetId` selection resolving to the same Salon object. This preserves owner-curated drafts as well as current public groups.
- **Any** post safety case, including resolved cases that can be reopened. Salon content snapshots and Beauty media rows are checked, not just the queue's first source ID.
- An inactive uploader, any `retain_business` account-erasure task (including a completed retained record), or unfinished erasure object work.
- A changed manifest or current Storage object identity/hash/size/MIME.

`salon_profile_media_assets.attached_entity_id` and `orphaned` status alone are not a reference count. Salon update feature reuses its image as a cover (`20261017194500_post_actions_canonical_caption.sql:45`), booking inspirations store independent media paths (baseline SQL:1566), and Market allows look/update asset selections (`20261104230500_market_published_data.sql:62`). Beauty feature instead makes a separate cover COPY (`app/post-moderation/actions.ts:38`). Actual Beauty media has a unique `(bucket,object_path)` constraint, so its concurrency regression tests resurrection of the existing soft-deleted row rather than inventing duplicate media attachments.

## Worker contract and authority

`public_post_media_deletions` is RLS protected with no direct anon/authenticated/service table grants. Only the two RPCs below grant execution to `service_role`, and both also require a service-role request context. Full rows and paths are never public UI receipts.

`claim_public_post_media_deletions({p_limit: 5})` returns at most five processing rows:

```text
id, bucket, object_path, uploaded_by_user_id,
object_id, object_version, object_etag, sha256, bytes,
lease_token, leased_until
```

Additional queue columns are internal diagnostics. IDs and lease tokens are UUIDs. Version and eTag are nonempty strings. SHA-256 is lowercase 64 hex. `bytes` is an integer 1–512000. Paths match the newly reserved Beauty image/before/after or Salon look/update shapes. Salon ownership is a database authority, not inferred from an uploader prefix. Lease duration is two minutes.

The worker calls Storage API removal for that one exact bucket/path. It then calls:

```text
finish_public_post_media_deletion({p_id, p_lease, p_error: null}) → boolean
```

`true` requires the current lease and actual absence from `storage.objects`. A Storage response alone is insufficient. Known failure can pass `storage_remove_failed` or `time_budget`; failure clears the lease for a later bounded retry and returns false. Confirmed completion is idempotent for the same final token. Failed, expired or uncertain work stays unconfirmed. Removed Salon asset registrations are marked deleted only after the absence checkpoint.

Queue statuses distinguish `queued`, `referenced`, `review_evidence`, `erasure_owned`, `identity_mismatch`, `processing`, and `deleted`. Blocked work is rechecked after five minutes; each check moves it behind older due work, and a removed reference can therefore become eligible later. Receipts whose manifests were already consumed by account erasure are excluded before the bounded candidate limit, preventing stale receipts from starving subsequent jobs. They do not falsely claim this worker completed the erasure. No claim means no deletion. A deleted/fenced path is never recycled.

## Locking and the permanent fence

Claim order is **uploader user SHARE → manifest UPDATE → queue UPDATE**, all `SKIP LOCKED`; finish uses the same order with `NOWAIT`. Reference scans run after locking as VOLATILE queries with fresh READ COMMITTED snapshots. Claim never row-locks a source post or Storage object, so it does not wait back on a post already locked by a writer. The queue intentionally has no hidden user/post FK lock.

Relevant reference writers acquire user SHARE `NOWAIT` then manifest SHARE before accepting the path. `NOWAIT` prevents a post-row-first trigger from waiting behind the existing user-first account-erasure transaction. The manifest's deletion fence is installed atomically with claim and is permanent across failures and lease expiry. New attachment, soft-delete resurrection, cover/history/Market reference creation, asset redirection/reactivation, and Storage recreation or move then fail. An actual Storage DELETE also checks retention under the user/manifest locks during its own transaction. This is not a preflight check followed by an unguarded API race.

The separately verified same-path `retain_business` service COPY exception is unchanged and still subject to the existing operation, lease, task and byte checks. This queue never edits erasure tasks or transfers their leases. Existing account purge may remove the same object; absence remains a safe idempotent result.

Market group writers also take a row SHARE `NOWAIT` lock on selected asset registrations so the `assetId → path` mapping cannot change after the old manifest was checked. The final checkpoint takes matching asset rows UPDATE `NOWAIT` before marking registrations deleted. It never waits back on an asset writer while holding the manifest; lock contention returns false with rollback, leaving Storage absence unconfirmed until retry.

## Remaining boundary and acceptance

Hold, hide, archive and report are not deletion events. Existing review cases remain preserved and reopenable; a new case cannot attach an already terminally deleted and fenced photo, while general Support remains available. **Admin deleted/reported photos are retained as review evidence by this minimum patch.** Removing their public origin while retaining appealable bytes needs a separately reviewed private-evidence copy/access/lifecycle workflow. This patch is not a complete copyright takedown of every independent cover, booking snapshot, third-party copy or cache.

Origin removal does not promise recall from browser caches, CDN caches, downloaded files, screenshots or third-party copies. The candidate does not change existing cache-control values or claim physical-provider backup deletion timings.

Scoped command:

```powershell
node --test tests/public-post-media-deletion.integration.test.mjs
$env:RUN_ISOLATED_SUPABASE='1'
$env:BOOKING_TEST_OUTPUT_DIR='artifacts/public-post-media-deletion-20261118/full-schema'
node --test tests/public-post-media-deletion.integration.test.mjs
```

The default run deliberately skips real services. The opt-in run uses cached Supabase Docker images, network-isolated ephemeral storage, no host ports or mounted customer files, random disposable fixture identities/credentials and all source migrations. Tests cover rollback, authorization, exclusions, independent references, review evidence, failure/lease recovery, no recreation, concurrent user locks and concurrent soft-delete resurrection, and actual worker Storage removal followed by SQL absence verification. Evidence status and source hashes are recorded under the artifact directory; a local fixture is not production/provider or device acceptance. Runtime deployment and combined release review remain pending.

Final scoped result: **10/10 tests passed, zero skips**, including the opt-in real PostgreSQL/Storage run with all **435 migrations**. Migration SHA-256: `0892e6467d5a2b0b5837ad4bd10401fa43d969b789a27e1a2f5031ba13a61c93`. Injected actual worker SHA-256: `c6dbc94779054a4b929afd500a60c265833f2425fb43e66efe404316cab8c5df`. The acceptance receipt is `artifacts/public-post-media-deletion-20261118/full-schema/post-media-deletion-acceptance.json`; the sibling fixture receipt records cleanup, network isolation and the exact executed migration hashes, finishing at `2026-11-18T21:40:22Z`. The test asserts the migration and bundled worker hashes still match the files used. ESLint passed for the owned integration test. The contested-asset test confirms successful Storage removal can still produce an unconfirmed worker result when the asset row is locked; only retry after lock release completes the receipt. A 40-stale-receipt regression proves account-erasure-consumed manifests cannot starve the bounded queue.
