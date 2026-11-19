# Admin exact-text Hide/Restore backend — 18 November 2026

Candidate implementation on `40b1b6e7909f6e50e3372dbf873b814ab4eb1f66`. Owner approved admin r2 and exact-text decisions. This patch adds the backend, authenticated server bindings and SSR state; the case UI/CSS and its browser tests are owned by the companion UI change. No commit, push, hosted migration, provider/key operation, production data action or store submission is performed here.

## Resulting behavior and boundaries

Supported canonical targets are comments, reviews, review replies, verified-visit experiences and experience replies. Existing `own_review_reply` / `own_experience_reply` report aliases resolve to the same exact reply as the reporter's authorized history. The server accepts only a report ID; it derives the target from the case and reuses the existing case access boundary and source eligibility. Client-selected Support context is not independent permission to read a private row.

Hide removes the whole item from public projections and visible-item counts. Hiding a reply leaves its eligible parent present with null reply ID/body/date fields. Hiding a comment root or an experience/review parent also removes the corresponding descendants/reply from public results. Existing authorized private business/participant/own-history reads remain separate. It does not change `feedback_state`, `issue_status`, `counts_toward_reputation`, POS receipts, payment amounts or canonical Truth/reputation facts.

Each case owns an independent hold. Restore releases only that case's hold; if another case still holds the same target, the result remains hidden and reports the other-hold count. It never clears another hold or restores a withdrawn/deleted/private/blocked/held parent. Reporter-owned private-history evidence can remain readable in the case while public controls are disabled. Closing or reopening Support does not change any hold.

The patch does not implement private image evidence, image-origin takedown, legal counter-notice handling, account suspension or copyright removal of all independent copies. The conservative photo queue's `review_evidence` exclusion is unchanged. Decision history stores action/reason/actor/revision/fingerprints, not a new immutable archive of every historical text body.

## Contract and authority

`types/admin-exact-text-moderation.ts` defines the shared state. It includes availability, exact quote/target, opaque evidence version, revision, current public visibility, `canHide`, `canRestore`, reason, per-case history and optional `heldByThisCase` / `otherHoldCount`. UI must not display opaque IDs/version as product copy.

`loadExactTextModerationAction(reportId)` returns current case-authorized state. `setExactTextVisibilityAction({reportId,requestId,expectedVersion,action,reason})` returns either `{ok:true,state}` or a typed `stale`, `unavailable`, `permission`, `conflict` or `unknown` result. Reasons are trimmed and limited to 3–2000 characters. Server bindings forward no caller-selected target kind/content ID. They use the authenticated client, not a service-role impersonation.

The database RPCs are `get_admin_exact_text_moderation(uuid)` and `set_admin_exact_text_visibility(uuid,uuid,text,text,text)`, granted only to authenticated users and internally requiring platform case-read authority; mutations additionally require `admin.reports.update`. This does not grant account-block or salon/financial permissions. Private ledgers and filtered views have no direct anon/authenticated/service-role table grants.

A failed read/transport fallback has `availabilityVerified:false`, no actions and no current quote. A verified unavailable result has `availabilityVerified:true` and must suppress an older SSR quote. This prevents a prior lookup from being displayed as current after the source becomes private/withdrawn. The original quote-only renderer remains a read-only compatibility fallback when the new service is unavailable.

## Evidence, replay and race handling

The first eligible lookup binds the case to a canonical target and a hash of the authoritative case context. Bindings do not silently retarget when a legacy alias later selects another reply or the client changes context. A new unbound public report cannot use an already platform-hidden ID as authority to reveal its current body; previously bound cases and properly reporter-owned history aliases retain their limited evidence access.

The evidence version covers context, current source revision, independent holds, parent eligibility and author state. Source/parent/context locks freeze the quote before it is paired with its version. The mutation rechecks the current version under the target's decision lock before changing a hold. Author edits do not release the independent hold. Fresh review of a changed revision is required before a new decision; old versions fail stale.

Request UUIDs are actor-bound. A successful receipt is replayed before checking the old expected version, so a lost success does not create another decision. Reusing the UUID for another report/intent/reason conflicts. Permission is rechecked even on replay. Unconfirmed transport or lock outcomes retain the same immutable request for retry; the server does not infer a failed commit from a lost response.

User locks precede source work; later source, ancestor, salon and case row locks use `NOWAIT`. Same-target decisions use a bounded advisory lock; same-request replay serialization has the migration's lock timeout. Waiting on an author/parent edit returns unconfirmed and must retry/revalidate. Ancestry walking has a defensive depth cap of eight and cycle detection: unresolved ancestry at the cap fails closed. Canonical comment writers normally normalize shallow threads; adversarial/historical depth does not become permission to expose a partially checked chain.

## Public read coverage from compiled PostgreSQL

The source inventory was taken from actual `pg_proc`, policies and grants after the full migration sequence, including DO-block rewrites. Source grep alone is not the coverage proof. The migration routes this explicit typed signature allowlist through `moderation_public` security-barrier views:

- `count_public_post_comments(text,uuid)`
- `get_post_comment_identities(uuid[])`
- `get_public_post_comments(text,uuid,integer,integer)`
- `get_public_salon_profile_comments_before_blocks(uuid)`
- `get_public_salon_profile_experiences_before_blocks(uuid)`
- `get_public_salon_profile_reviews_before_blocks(uuid)`
- `get_public_salon_profile_review_summary(uuid)`
- `get_public_salon_website_featured_look(uuid)`
- `hydrate_explore_social_feed_items_before_blocks(text,jsonb,text[])`
- `_explore_core_get_public_explore_decision_signals(uuid[])`

Existing public block wrappers continue to call their filtered inner implementations. The migration asserts every typed signature exists and is routed; it does not rewrite arbitrary functions from a source scan. Reapplying does not add another schema prefix. Five restrictive SELECT policies close direct outsider reads while retaining author/authorized participant/business access where the original policies already allowed it. Those exceptions grant no access by themselves and are not used by public filtered views.

The legacy review-summary RPC was SECURITY INVOKER. It is explicitly redefined as a narrow public-only definer rather than granting callers access to the private views. Its native compiled review SELECT conditions were `moderation_status='visible'`, public/active salon and authenticated social-block restrictions. The new summary preserves those and adds the overlay. There was no active-author/profile predicate in that table's native RLS; this patch does not invent a global suspended-author takedown. Restoration separately requires an active author.

`_explore_core_get_public_lumi_trust_signals(uuid[])` and `get_public_salon_profile_reputation_summary(uuid)` remain canonical numeric business/reputation aggregates, not visible-item counters. Their compiled return types contain no text body, reply fields or content IDs. They are intentionally not routed through text-removal views. Public list/comment/review item counters are filtered separately; a canonical reputation count can therefore differ from the currently visible text-item count. Private `get_my_visit_experiences` and verified-visit/POS/customer payload routines retain their existing actor/business authority and data. Derived discovery-pool ranking work remains separate; public hydration reads fresh filtered comment counts.

## Validation and pending integration

Scoped default command: `node --test tests/admin-exact-text-moderation.integration.test.mjs`. Its reduced PostgreSQL state-machine tests run actual migration resolver/ledger/action code with explicit fixture transport/permission/digest stubs; they do not claim full-schema or cryptographic acceptance. The server-binding test bundles the actual helper with a mocked authenticated client and cannot construct a live provider.

Full acceptance uses `RUN_ISOLATED_SUPABASE=1` and `BOOKING_TEST_OUTPUT_DIR=artifacts/admin-exact-text-moderation-20261118/acceptance`. It replays all source migrations against cached ephemeral, network-isolated Supabase images with random disposable identities/credentials, no host ports or customer files. It records compiled function definitions, policies, role grants and migration hashes; then exercises actual authenticated RPCs, anonymous projections, direct outsider RLS, reply envelopes, private-history aliases, canonical business snapshots and two-session parent/author-edit races. Real case admission limits remain intact; synthetic reports are backdated to represent historical cases rather than bypassing the five-per-hour guard.

The acceptance JSON and frozen source manifest are the authoritative final status/hash receipts. Local evidence does not establish hosted schema activation, moderator staffing, physical-device acceptance or App Store readiness. Root's combined Next build/native-impact assessment and the companion UI/browser evidence remain separate integration inputs. A combined release must preserve the latest production baseline, regenerate the bundled native app when required and follow the release journal gates.

Final backend acceptance: **7/7 tests passed, zero skips**, including the actual full **436-migration** Supabase run, compiled routing/grants/RLS inventory, all five target mutations, current returned state/history, private-history/forged-case checks, native summary-RLS parity and strict two-session parent/edit races. The final SQL SHA-256 is `ebe4e2970a3e0a1a99ea6eca86b59ab7fe1af516d40eb47ff151a7428b108572`; actual executed bytes match. Receipt: `artifacts/admin-exact-text-moderation-20261118/acceptance/admin-exact-text-acceptance.json`; compiled inventory is alongside it. An independent final SQL critic found no further concrete blocker on this source. Scoped ESLint passed for the types, server helper/actions, loader and integration test. The coordinator separately reported combined Next R4 success; no runtime source changed after its input snapshot. SQL/test acceptance remains a separate proof from that build.
