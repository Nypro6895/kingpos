# Beauty image publication transitions

The legacy-content upgrade rehearsal found that an owner could change a Beauty
profile from private to public and expose older attached images that had correctly
been excluded from the published-image legacy registration. The existing image
guard ran when attaching media, but did not run when changing its parent profile
or restoring publication flags on an existing post.

`20261119184500_beauty_image_publication_gate.sql` is one forward migration after
the existing 449 files. It adds a trigger function and a late BEFORE trigger to
Beauty profiles and posts. It does not rewrite existing content, register private
images as legacy, change ownership/publication permissions, or send image bytes
to any service.

The gate uses the existing `public_post_image_is_approved` predicate, including
object ID/version/eTag, media role, author and approved/legacy status. It checks:

- A profile becoming public, including an attempted profile identity change.
- A post becoming public/visible, a deleted post being restored, or a safety hold
  being released after the existing moderation triggers have decided its flags.
- A post moving to another public profile or changing author/identity while
  becoming publicly eligible. OLD and NEW IDs are checked before FK validation.

The eligibility conditions match `beauty_public_post_exists`: profile public,
post public/visible, not deleted and not held. Unchanged public eligibility and
private edits retain their existing behavior. A denied transition uses the
existing error path and asks the user to re-upload the photos and agree to the
photo safety check. It does not start a new consent flow or silently inspect
private photos.

## Concurrent writers

A profile UPDATE already owns its profile row. Its trigger reads eligible posts
without taking post row locks. A post transition takes SHARE locks on its old and
new profiles in UUID order, then uses the returned current visibility. SHARE
conflicts with a profile visibility UPDATE; KEY SHARE would not. There is no new
profile-to-post lock order.

If the profile commits first, a waiting post writer sees its public state and
checks the attachment. If the post commits first under a private profile, the
waiting profile writer sees that newly eligible post and checks its attachment.
Missing or in-flight target profiles fail closed rather than relying on a later
FK wait to make the parent visible.

New-publication checks require READ COMMITTED, including an apparently empty
profile scan. REPEATABLE READ or SERIALIZABLE may retain an earlier post snapshot
after waiting on an unchanged profile row. The function explicitly remains
VOLATILE for fresh SPI reads and refuses those new transitions with SQLSTATE
40001. It does not change the caller's isolation level. A newly nominally public
post is refused before looking up its parent, even if that parent is private;
this prevents a stale parent read from failing open. Unchanged-public eligibility
and private metadata edits remain possible at those isolation levels.

## Verification

Run the opt-in test using cached Docker images:

```powershell
$env:RUN_ISOLATED_SUPABASE='1'
$env:BOOKING_TEST_OUTPUT_DIR='<new owned evidence directory>'
node --test tests/beauty-image-publication-gate.integration.test.mjs
```

The fixture stages the unchanged 449 migration files before applying the new
migration. Only during one owned setup transaction, it disables the attachment
approval trigger to import synthetic historical media, then restores and verifies
the exact enabled trigger before committing. All transition and concurrency
probes run with all gates enabled. The shared fixture helper is unchanged.

Coverage includes the pre-fix ordinary owner regression; private/hidden/deleted/
held/moved posts; OLD IDs; service-role writes; existing table ownership/ACL/RLS;
exact legacy/approved pins; allowed edits; metadata mismatches; unchanged private
rows on rejected transactions; isolation guards; and four two-session schedules
for visibility and reassociation in both writer orders. Lock waits are observed
in the owned fixture, and SQL statement timeouts bound each session.

The earlier frozen old-schema-to-exact21 rehearsal separately establishes legacy
qualification and old-row preservation. This regression uses synthetic Storage
metadata only. It does not establish actual image-byte/API, provider, production,
native-device, or store acceptance. The combined 22-migration production wrapper
requires its own final rehearsal after source integration.

The frozen functional r4 run passed on 2026-11-19: one integration test, 25
focused checks, zero skips. All four schedule waits were observed, all inherited
449 files and the new migration stayed unchanged, and cleanup removed only the
four owned containers while preserving all prior containers. Its acceptance
receipt SHA256 is `485cfed251b84d7e92bf8ede0319011281a8065c12360ec1ff152dc18a6f24ad`.
