import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migration = read("supabase/migrations/202608100005_beauty_profile_social_timeline.sql");
const beautyCoverForwardMigration = read(
  "supabase/migrations/202608100006_beauty_profile_cover_media_path_backfill.sql",
);
const beautyCreatePostForwardMigration = read(
  "supabase/migrations/202608110004_fix_beauty_create_post_verification_state_ambiguity.sql",
);
const beautySalonPublicationMigration = read(
  "supabase/migrations/202608110005_beauty_salon_publication_approval.sql",
);
const allMigrationSql = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => read(`supabase/migrations/${name}`))
  .join("\n\n");
const beautyService = read("lib/beauty.ts");
const beautyMedia = read("lib/beauty-media.ts");
const beautyActions = read("app/beauty/actions.ts");
const beautyClient = read("app/beauty/beauty-profile-client.tsx");
const beautyPage = read("app/beauty/page.tsx");
const beautySalonPublicationService = read("lib/beauty-salon-publications.ts");
const salonProfileService = read("lib/salon-profile.ts");
const salonProfileTypes = read("types/salon-profile.ts");
const salonProfileView = read("app/salon-profile/salon-profile-view.tsx");
const salonPublicationReviewPage = read(
  "app/salon-profile/client-transformations/page.tsx",
);
const salonPublicationReviewActions = read(
  "app/salon-profile/client-transformations/actions.ts",
);
const salonPublicationReviewActionButton = read(
  "app/salon-profile/client-transformations/review-action-button.tsx",
);
const workspacePending = read("lib/workspace-pending.ts");

function read(path) {
  return readFileSync(path, "utf8");
}

function functionBlock(name, nextMarker) {
  const start = migration.indexOf(`create or replace function public.${name}`);

  assert.ok(start >= 0, `${name} function is present`);

  const end = nextMarker ? migration.indexOf(nextMarker, start + 1) : migration.length;

  assert.ok(end > start, `${name} function has a readable boundary`);

  return migration.slice(start, end);
}

function latestMigrationFunctionBlock(name) {
  const start = allMigrationSql.lastIndexOf(
    `create or replace function public.${name}`,
  );

  assert.ok(start >= 0, `${name} latest function is present`);

  const end = allMigrationSql.indexOf("\n$$;", start);

  assert.ok(end > start, `${name} latest function has a readable boundary`);

  return allMigrationSql.slice(start, end + "\n$$;".length);
}

function sourceFunctionBlock(source, name, nextMarker) {
  const start = source.indexOf(`function ${name}`);
  const asyncStart = source.indexOf(`async function ${name}`);
  const functionStart =
    asyncStart >= 0 && (start < 0 || asyncStart < start) ? asyncStart : start;

  assert.ok(functionStart >= 0, `${name} source function is present`);

  const end = nextMarker ? source.indexOf(nextMarker, functionStart + 1) : source.length;

  assert.ok(end > functionStart, `${name} source function has a readable boundary`);

  return source.slice(functionStart, end);
}

function createBeautyPostSignature() {
  const createBlock = latestMigrationFunctionBlock("create_beauty_post");
  const start = createBlock.indexOf("create or replace function public.create_beauty_post(");
  const end = createBlock.indexOf(")\nreturns jsonb", start);

  assert.ok(start >= 0 && end > start, "create_beauty_post signature is readable");

  return createBlock.slice(start, end);
}

function profileColumnsCoveredByMigrations() {
  const columns = new Set();
  const createTableStart = allMigrationSql.indexOf("create table public.beauty_profiles (");
  const createTableEnd = allMigrationSql.indexOf("\n);", createTableStart);

  assert.ok(createTableStart >= 0 && createTableEnd > createTableStart);

  const createTableBlock = allMigrationSql.slice(createTableStart, createTableEnd);

  for (const line of createTableBlock.split("\n")) {
    const match = line.trim().match(/^([a-z_]+)\s+/);

    if (match && match[1] !== "constraint") {
      columns.add(match[1]);
    }
  }

  for (const match of allMigrationSql.matchAll(
    /alter table public\.beauty_profiles\s+add column if not exists\s+([a-z_]+)/g,
  )) {
    columns.add(match[1]);
  }

  return columns;
}

function beautyProfileSelectColumns() {
  const match = beautyService.match(/const BEAUTY_PROFILE_SELECT =\s+"([^"]+)"/);

  assert.ok(match, "Beauty profile select constant is present");

  return match[1].split(",").map((column) => column.trim());
}

test("beauty migration defines the public profile timeline surface", () => {
  for (const fragment of [
    "insert into storage.buckets",
    "allowed_mime_types",
    "'beauty-profile-media'",
    "create table public.beauty_profiles",
    "cover_media_path text",
    "beauty_profiles_cover_media_path_check",
    "create table public.beauty_posts",
    "create table public.beauty_post_media",
    "create table public.beauty_post_attributions",
    "create table public.beauty_post_verifications",
    "create table public.beauty_reward_policies",
    "create table public.beauty_reward_events",
    "create or replace function public.create_beauty_post",
    "create or replace function public.list_beauty_timeline",
    "create or replace function public.get_beauty_recent_visit_candidates",
    "create or replace function public.search_beauty_attribution_salons",
    "insert into public.beauty_reward_policies",
    "'verified_before_after_default'",
  ]) {
    assert.ok(migration.includes(fragment), `Missing Beauty migration fragment: ${fragment}`);
  }
});

test("beauty visit verification is derived from linked customer bookings and receipts", () => {
  const proofBlock = functionBlock(
    "find_beauty_visit_proof",
    "create or replace function public.create_beauty_post",
  );

  assert.match(proofBlock, /join public\.customers customers on customers\.id = tickets\.customer_id/);
  assert.match(proofBlock, /customers\.customer_user_id = p_user_id/);
  assert.match(proofBlock, /customers\.location_id = tickets\.salon_id/);
  assert.match(proofBlock, /tickets\.status = 'closed'/);
  assert.match(proofBlock, /items\.assigned_staff_id = p_staff_id/);
  assert.match(proofBlock, /coalesce\(items\.is_removed, false\) = false/);
  assert.match(proofBlock, /bookings\.customer_user_id = p_user_id/);
  assert.match(proofBlock, /bookings\.status = 'completed'/);
  assert.match(proofBlock, /bookings\.status in \('checked_in', 'in_service'\)/);
  assert.match(proofBlock, /lines\.line_status <> 'cancelled'/);
  assert.match(proofBlock, /public\.beauty_verification_window\(\)/);
});

test("creating a beauty post never trusts client proof or reward claims", () => {
  const signature = createBeautyPostSignature();
  const createBlock = latestMigrationFunctionBlock("create_beauty_post");

  assert.doesNotMatch(signature, /verified|verification_state|booking_id|pos_ticket_id|reward/i);
  assert.match(createBlock, /actor_user_id uuid := public\.current_public_user_id\(\)/);
  assert.match(createBlock, /clean_visibility text := 'public'/);
  assert.match(createBlock, /if actor_user_id is null then/);
  assert.match(createBlock, /not starts_with\(media_path, actor_user_id::text \|\| '\/beauty\/'\)/);
  assert.match(createBlock, /media_path not like '%\.webp'/);
  assert.match(createBlock, /public\.find_beauty_visit_proof\(actor_user_id, p_salon_id, p_staff_id\)/);
  assert.match(createBlock, /insert into public\.beauty_post_verifications/);
  assert.match(createBlock, /derived_verification_state := coalesce\(proof ->> 'state', 'pending'\)/);
  assert.match(createBlock, /case when derived_verification_state = 'verified' then now\(\) else null end/);
});

test("verified Before & After rewards use an immutable idempotent ledger", () => {
  const rewardTableBlock = migration.slice(
    migration.indexOf("create table public.beauty_reward_events"),
    migration.indexOf("create index beauty_posts_profile_timeline_idx"),
  );
  const createBlock = latestMigrationFunctionBlock("create_beauty_post");
  const timelineBlock = functionBlock(
    "list_beauty_timeline",
    "create or replace function public.get_beauty_recent_visit_candidates",
  );
  const deleteBlock = functionBlock(
    "delete_beauty_post",
    "create or replace function public.list_beauty_timeline",
  );

  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(rewardTableBlock, /post_id uuid not null references public\.beauty_posts\(id\),/);
  assert.doesNotMatch(
    rewardTableBlock,
    /post_id uuid not null references public\.beauty_posts\(id\) on delete cascade/,
  );
  assert.match(migration, /insert into public\.beauty_reward_policies \([\s\S]*post_type[\s\S]*verification_state[\s\S]*reward_type[\s\S]*points_amount[\s\S]*status/);
  assert.match(createBlock, /if derived_verification_state = 'verified' then/);
  assert.match(createBlock, /policies\.post_type = clean_post_type/);
  assert.match(createBlock, /policies\.verification_state = derived_verification_state/);
  assert.match(createBlock, /active_policy\.code/);
  assert.match(createBlock, /actor_user_id::text/);
  assert.match(createBlock, /derived_verification_method/);
  assert.match(createBlock, /coalesce\(proof_ticket_id::text, proof_booking_id::text, created_post_id::text\)/);
  assert.match(createBlock, /insert into public\.beauty_reward_events/);
  assert.match(createBlock, /on conflict \(idempotency_key\) do nothing/);
  assert.match(timelineBlock, /rewards\.status = 'issued'/);
  assert.match(deleteBlock, /set deleted_at = now\(\)/);
  assert.doesNotMatch(deleteBlock, /delete from public\.beauty_reward_events/);
  assert.match(deleteBlock, /'mediaPaths'/);
});

test("beauty create post forward migration disambiguates verification state", () => {
  const createBlock = latestMigrationFunctionBlock("create_beauty_post");

  assert.match(
    beautyCreatePostForwardMigration,
    /create or replace function public\.create_beauty_post/,
  );
  assert.match(createBlock, /derived_verification_state text := 'pending'/);
  assert.match(createBlock, /derived_verification_method text := 'none'/);
  assert.match(createBlock, /select policies\.\*/);
  assert.match(createBlock, /policies\.verification_state = derived_verification_state/);
  assert.match(createBlock, /'verificationState', derived_verification_state/);
  assert.match(createBlock, /'rewardIssued', issued_reward_id is not null/);
  assert.doesNotMatch(createBlock, /\n\s*verification_state text :=/);
  assert.doesNotMatch(createBlock, /policies\.verification_state\s*=\s*verification_state\b/);
  assert.doesNotMatch(createBlock, /case when verification_state = 'verified'/);
  assert.doesNotMatch(createBlock, /'verificationState', verification_state/);
});

test("beauty salon publication approval is normalized and independent", () => {
  const signature = createBeautyPostSignature();
  const createBlock = latestMigrationFunctionBlock("create_beauty_post");
  const attributionInsert = createBlock.indexOf(
    "insert into public.beauty_post_attributions",
  );
  const verificationInsert = createBlock.indexOf(
    "insert into public.beauty_post_verifications",
  );
  const rewardInsert = createBlock.indexOf(
    "insert into public.beauty_reward_events",
  );
  const publicationInsert = createBlock.indexOf(
    "insert into public.beauty_post_salon_publications",
  );
  const notificationCall = createBlock.indexOf(
    "public.notify_beauty_salon_publication_request",
  );

  assert.match(
    beautySalonPublicationMigration,
    /create table if not exists public\.beauty_post_salon_publications/,
  );
  assert.match(
    beautySalonPublicationMigration,
    /unique \(post_id, salon_id\)/,
  );
  assert.match(
    beautySalonPublicationMigration,
    /status text not null default 'pending'/,
  );
  assert.match(
    beautySalonPublicationMigration,
    /status in \('pending', 'approved', 'declined'\)/,
  );
  assert.match(
    beautySalonPublicationMigration,
    /alter table public\.beauty_post_salon_publications enable row level security/,
  );
  assert.ok(attributionInsert >= 0, "Attribution insert is present.");
  assert.ok(verificationInsert > attributionInsert, "Verification follows attribution.");
  assert.ok(rewardInsert > verificationInsert, "Reward issuance follows verification.");
  assert.ok(publicationInsert > rewardInsert, "Salon publication request follows rewards.");
  assert.ok(notificationCall > publicationInsert, "Salon notification follows request insert.");
  assert.doesNotMatch(signature, /publication|approval|approved|declined/i);
  assert.match(createBlock, /derived_verification_state text := 'pending'/);
  assert.match(createBlock, /salon_publication_status text := null/);
  assert.match(createBlock, /'salonPublicationStatus', salon_publication_status/);
  assert.match(createBlock, /policies\.verification_state = derived_verification_state/);
});

test("pending salon publications are not public salon profile posts", () => {
  const publicSalonPostsBlock = latestMigrationFunctionBlock(
    "get_public_salon_profile_beauty_posts",
  );
  const exploreBeautyPostsBlock = latestMigrationFunctionBlock(
    "get_public_explore_beauty_posts",
  );

  assert.match(
    publicSalonPostsBlock,
    /from public\.beauty_post_salon_publications publications/,
  );
  assert.match(publicSalonPostsBlock, /publications\.status = 'approved'/);
  assert.match(publicSalonPostsBlock, /posts\.post_type = 'before_after'/);
  assert.match(
    publicSalonPostsBlock,
    /public\.salon_profile_public_salon_exists\(target_salon_id\)/,
  );
  assert.match(publicSalonPostsBlock, /left join public\.staff staff/);
  assert.match(publicSalonPostsBlock, /staff\.display_name as staff_name/);
  assert.doesNotMatch(publicSalonPostsBlock, /status = 'pending'/);
  assert.doesNotMatch(
    exploreBeautyPostsBlock,
    /beauty_post_salon_publications/,
    "Explore attribution should remain independent from salon profile approval.",
  );
  assert.match(salonProfileService, /get_public_salon_profile_beauty_posts/);
  assert.match(salonProfileTypes, /beautyPosts: PublicSalonProfileBeautyPost\[\]/);
  assert.match(salonProfileView, /BeautyTransformationsSection/);
  assert.match(salonProfileView, /posts=\{data\.beautyPosts\}/);
});

test("salon publication requests notify owners and require authorized idempotent review", () => {
  const notifyBlock = latestMigrationFunctionBlock(
    "notify_beauty_salon_publication_request",
  );
  const listBlock = latestMigrationFunctionBlock(
    "list_my_beauty_salon_publication_requests",
  );
  const respondBlock = latestMigrationFunctionBlock(
    "respond_to_beauty_salon_publication_request",
  );

  assert.match(notifyBlock, /insert into public\.app_notifications/);
  assert.match(notifyBlock, /'beauty_salon_publication_request'/);
  assert.match(notifyBlock, /request_row\.salon_id/);
  assert.match(notifyBlock, /'\/salon-profile\/client-transformations'/);
  assert.match(notifyBlock, /event_key/);
  assert.match(notifyBlock, /salon_profile\.content\.manage/);
  assert.match(notifyBlock, /on conflict \(recipient_user_id, event_key\)/);
  assert.match(
    beautySalonPublicationMigration,
    /create unique index if not exists app_notifications_beauty_publication_event_key_idx/,
  );
  assert.match(listBlock, /public\.user_has_salon_permission\(/);
  assert.match(listBlock, /array\['salon_profile\.content\.manage'\]::text\[\]/);
  assert.match(listBlock, /publications\.status = 'pending'/);
  assert.match(respondBlock, /actor_user_id uuid := public\.current_public_user_id\(\)/);
  assert.match(respondBlock, /select \*[\s\S]*for update/);
  assert.match(respondBlock, /clean_response text := case/);
  assert.match(respondBlock, /public\.user_has_salon_permission\(/);
  assert.match(respondBlock, /array\['salon_profile\.content\.manage'\]::text\[\]/);
  assert.match(respondBlock, /if request_row\.status <> 'pending' then/);
  assert.match(respondBlock, /'idempotent', true/);
  assert.match(respondBlock, /responded_by_user_id = actor_user_id/);
  assert.match(respondBlock, /notification_type = 'beauty_salon_publication_request'/);
  assert.match(beautySalonPublicationService, /respond_to_beauty_salon_publication_request/);
  assert.match(beautySalonPublicationService, /BEAUTY_SALON_PUBLICATION_PERMISSION = "salon_profile\.content\.manage"/);
  assert.match(beautySalonPublicationService, /hasPermission\(/);
});

test("salon publication review actions do not serialize framework redirects", () => {
  const actionTryBlock = salonPublicationReviewActions.match(
    /try \{([\s\S]*?)\n\s*\} catch \(error\) \{/,
  );
  const actionCatchBlock = salonPublicationReviewActions.match(
    /\} catch \(error\) \{([\s\S]*?)\n\s*\}\n\n  revalidateBeautySalonPublicationPaths/,
  );

  assert.ok(actionTryBlock, "Review action should isolate mutation errors.");
  assert.ok(actionCatchBlock, "Review action should handle mutation errors.");
  assert.match(
    salonPublicationReviewActions,
    /let result: Awaited<[\s\S]*respondToBeautySalonPublicationRequest/,
  );
  assert.match(
    actionTryBlock[1],
    /result = await respondToBeautySalonPublicationRequest/,
  );
  assert.doesNotMatch(
    actionTryBlock[1],
    /redirectWithMessage|redirect\(/,
    "Next redirect must not be thrown inside the mutation try block.",
  );
  assert.match(
    salonPublicationReviewActions,
    /safeTransformationActionErrorMessage/,
  );
  assert.doesNotMatch(
    actionCatchBlock[1],
    /error instanceof Error\s*\?\s*error\.message/,
    "Raw framework or database error messages must not be rendered to users.",
  );
  assert.match(
    salonPublicationReviewActions,
    /"Added to your salon profile\."/,
  );
  assert.match(
    salonPublicationReviewActions,
    /"This transformation will stay on the customer's Beauty profile only\."/,
  );
  assert.match(
    salonPublicationReviewActions,
    /"Could not update this transformation\. Please try again\."/,
  );
  assert.match(salonPublicationReviewPage, /safeFeedbackMessage/);
  assert.match(salonPublicationReviewPage, /You&apos;re all caught up/);
});

test("beauty salon publication UI stays customer-owned and review-only", () => {
  assert.match(beautyClient, /salonPublicationLabel/);
  assert.match(beautyClient, /Waiting for salon approval/);
  assert.match(beautyClient, /Approved on salon profile/);
  assert.match(beautyClient, /Salon profile share declined/);
  assert.match(beautyClient, /canManage\s*\?\s*salonPublicationLabel/);
  assert.match(salonPublicationReviewPage, /listBeautySalonPublicationRequests/);
  assert.match(salonPublicationReviewPage, /Add to salon profile/);
  assert.match(salonPublicationReviewPage, /Keep off profile/);
  assert.match(salonPublicationReviewPage, /Feature request/);
  assert.match(salonPublicationReviewPage, /Before/);
  assert.match(salonPublicationReviewPage, /After/);
  assert.match(salonPublicationReviewPage, /For \{salonName\}/);
  assert.match(salonPublicationReviewPage, /with \{request\.staffName\}/);
  assert.match(salonPublicationReviewPage, /Verified visit/);
  assert.match(salonPublicationReviewPage, /Visit verification pending/);
  assert.match(salonPublicationReviewPage, /Not verified/);
  assert.match(salonPublicationReviewActionButton, /useFormStatus/);
  assert.match(salonPublicationReviewActionButton, /pending \? pendingLabel : idleLabel/);
  assert.match(salonPublicationReviewActions, /acceptBeautySalonPublicationRequestAction/);
  assert.match(salonPublicationReviewActions, /declineBeautySalonPublicationRequestAction/);
  assert.match(salonPublicationReviewActions, /respondToBeautySalonPublicationRequest/);
  assert.match(salonPublicationReviewActions, /revalidateBeautySalonPublicationPaths/);
  assert.match(workspacePending, /countPendingBeautySalonPublicationRequests/);
  assert.match(workspacePending, /Client transformations/);
  assert.doesNotMatch(salonPublicationReviewPage, /createBeautyPostAction/);
  assert.doesNotMatch(salonPublicationReviewPage, /Verification \$\{request\.verificationState\}/);
});

test("beauty indexes cover timeline and visit verification lookups", () => {
  for (const fragment of [
    "beauty_posts_profile_timeline_idx",
    "beauty_profiles_public_cover_idx",
    "beauty_post_media_post_idx",
    "beauty_reward_events_post_issued_idx",
    "beauty_pos_tickets_customer_closed_idx",
    "beauty_pos_ticket_items_staff_lookup_idx",
    "beauty_bookings_customer_visit_idx",
    "beauty_booking_lines_staff_lookup_idx",
  ]) {
    assert.ok(migration.includes(fragment), `Missing index fragment: ${fragment}`);
  }
});

test("beauty RLS keeps post mutation and reward issuance behind RPCs", () => {
  for (const table of [
    "beauty_profiles",
    "beauty_posts",
    "beauty_post_media",
    "beauty_post_attributions",
    "beauty_post_verifications",
    "beauty_reward_policies",
    "beauty_reward_events",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table}\\s+enable row level security;`),
      `${table} has RLS enabled`,
    );
  }

  const mutationPolicyMatches = [
    ...migration.matchAll(
      /create policy "[^"]+" on public\.(beauty_posts|beauty_post_media|beauty_post_attributions|beauty_post_verifications|beauty_reward_events)[\s\S]*?;/g,
    ),
  ].filter((match) => /for\s+(insert|update|delete|all)\s+/i.test(match[0]));

  assert.deepEqual(
    mutationPolicyMatches.map((match) => match[0]),
    [],
    "Posts, media rows, verifications, attributions, and reward events should not have direct mutation policies.",
  );

  assert.match(migration, /grant execute on function public\.create_beauty_post/);
  assert.match(migration, /grant execute on function public\.update_beauty_post_caption/);
  assert.match(migration, /grant execute on function public\.delete_beauty_post/);
  assert.match(migration, /revoke all on function public\.find_beauty_visit_proof\(uuid, uuid, uuid\) from public/);
  assert.doesNotMatch(migration, /grant execute on function public\.find_beauty_visit_proof/);
  assert.doesNotMatch(migration, /grant select on table public\.beauty_post_verifications/);
  assert.doesNotMatch(migration, /grant select on table public\.beauty_reward_events/);
  assert.doesNotMatch(migration, /beauty_reward_events_public_post_read/);
  assert.match(migration, /create policy "beauty_users_insert_own_media_objects" on storage\.objects/);
  assert.match(migration, /\(storage\.foldername\(name\)\)\[1\] = public\.current_public_user_id\(\)::text/);
  assert.match(migration, /\(storage\.foldername\(name\)\)\[2\] = 'beauty'/);
  assert.match(migration, /\(storage\.foldername\(name\)\)\[3\] in \('image', 'before', 'after', 'cover'\)/);
  assert.match(migration, /array_length\(storage\.foldername\(name\), 1\) = 3/);
  assert.match(migration, /profiles\.cover_media_path = storage\.objects\.name/);
});

test("recent visit suggestions expose only public attribution hints", () => {
  const candidatesBlock = functionBlock(
    "get_beauty_recent_visit_candidates",
    "create or replace function public.search_beauty_attribution_salons",
  );
  const outputFields = candidatesBlock.slice(candidatesBlock.indexOf("jsonb_build_object("));

  assert.match(candidatesBlock, /join public\.customers customers on customers\.customer_user_id = actor\.user_id/);
  assert.match(candidatesBlock, /join public\.bookings bookings on bookings\.customer_user_id = actor\.user_id/);
  assert.match(outputFields, /'visitKey'/);
  assert.match(outputFields, /'salonName'/);
  assert.match(outputFields, /'staffName'/);
  assert.doesNotMatch(outputFields, /'bookingId'|'posTicketId'|'customerId'|'sourceId'/);
});

test("app code validates media ownership and keeps uploads session-scoped", () => {
  assert.match(beautyMedia, /export const BEAUTY_MEDIA_BUCKET = "beauty-profile-media"/);
  assert.match(beautyMedia, /"cover"/);
  assert.match(beautyMedia, /export const BEAUTY_POST_MEDIA_ROLES = \["image", "before", "after"\]/);
  assert.match(beautyMedia, /export const BEAUTY_IMAGE_LIMIT = 15 \* 1024 \* 1024/);
  assert.match(beautyMedia, /export function buildBeautyMediaPath/);
  assert.match(beautyMedia, /return `\$\{input\.userId\}\/beauty\/\$\{input\.role\}\/\$\{crypto\.randomUUID\(\)\}\.webp`/);
  assert.match(beautyService, /async function assertTrustedBeautyMedia/);
  assert.match(beautyService, /async function assertTrustedBeautyCoverPath/);
  assert.match(beautyService, /async function assertTrustedAccountAvatarPath/);
  assert.match(beautyService, /ACCOUNT_AVATAR_BUCKET/);
  assert.match(beautyService, /getAccountAvatarPublicUrl/);
  assert.match(beautyService, /avatar_url: nextAvatarUrl/);
  assert.match(beautyActions, /getBeautyAvatarUploadSessionAction/);
  assert.match(beautyActions, /buildAccountAvatarPath\(user\.id\)/);
  assert.match(beautyService, /isBeautyMediaPathForUser/);
  assert.match(beautyService, /from\(BEAUTY_MEDIA_BUCKET\)/);
  assert.match(beautyService, /acceptedMimeTypes\.has\(mimeType\)/);
  assert.match(beautyService, /bytes > BEAUTY_IMAGE_LIMIT/);
  assert.match(beautyService, /cleanupBeautyMedia/);
  assert.match(beautyService, /asArray\(payload\.mediaPaths\)/);
  assert.match(beautyActions, /getAccessTokenFromRequest\(\)/);
  assert.match(beautyActions, /buildBeautyMediaPath\(\{\s*role,\s*userId: user\.id,\s*\}\)/);
  assert.doesNotMatch(beautyActions, /getBeautyMediaPublicUrl/);
  assert.doesNotMatch(beautyClient, /visibility: "public"/);
  assert.match(beautyService, /p_visibility: "public"/);
  assert.match(beautyActions, /revalidatePath\("\/beauty"\)/);
  assert.doesNotMatch(beautyService.toLowerCase(), /service_role/);
  assert.doesNotMatch(beautyActions.toLowerCase(), /service_role/);
});

test("beauty profile app select is covered by forward-safe migrations", () => {
  const migrationColumns = profileColumnsCoveredByMigrations();

  for (const column of beautyProfileSelectColumns()) {
    assert.ok(
      migrationColumns.has(column),
      `Beauty profile selected column ${column} must exist in migration history`,
    );
  }

  assert.match(
    beautyCoverForwardMigration,
    /alter table public\.beauty_profiles\s+add column if not exists cover_media_path text;/,
  );
  assert.match(
    beautyCoverForwardMigration,
    /beauty_profiles_cover_media_path_check check \(\s*cover_media_path is null\s+or cover_media_path ~\*/,
  );
  assert.match(
    beautyCoverForwardMigration,
    /create index if not exists beauty_profiles_public_cover_idx/,
  );
});

test("beauty cover rollout keeps storage policies owner-scoped", () => {
  for (const policyName of [
    "public_read_active_beauty_media_objects",
    "beauty_users_insert_own_media_objects",
    "beauty_users_update_own_media_objects",
    "beauty_users_delete_own_media_objects",
  ]) {
    assert.match(
      beautyCoverForwardMigration,
      new RegExp(`drop policy if exists "${policyName}" on storage\\.objects;[\\s\\S]*create policy "${policyName}" on storage\\.objects`),
    );
  }

  assert.match(beautyCoverForwardMigration, /profiles\.cover_media_path = storage\.objects\.name/);
  assert.match(beautyCoverForwardMigration, /\(storage\.foldername\(name\)\)\[1\] = public\.current_public_user_id\(\)::text/);
  assert.match(beautyCoverForwardMigration, /\(storage\.foldername\(name\)\)\[2\] = 'beauty'/);
  assert.match(beautyCoverForwardMigration, /\(storage\.foldername\(name\)\)\[3\] in \('image', 'before', 'after', 'cover'\)/);
  assert.match(beautyCoverForwardMigration, /array_length\(storage\.foldername\(name\), 1\) = 3/);
  assert.doesNotMatch(beautyCoverForwardMigration.toLowerCase(), /service_role/);
});

test("beauty profile get-or-create uses deterministic select insert conflict recovery", () => {
  const selectBlock = sourceFunctionBlock(
    beautyService,
    "selectOwnBeautyProfile",
    "async function getOrCreateBeautyProfile",
  );
  const getOrCreateBlock = sourceFunctionBlock(
    beautyService,
    "getOrCreateBeautyProfile",
    "function emptyTimelinePage",
  );
  const conflictBlock = sourceFunctionBlock(
    beautyService,
    "isExpectedBeautyProfileUserConflict",
    "async function getAuthenticatedBeautyContext",
  );

  assert.match(beautyService, /const BEAUTY_PROFILE_SELECT =\s+"id, user_id, bio, cover_media_path, visibility, created_at, updated_at"/);
  assert.match(selectBlock, /\.from\("beauty_profiles"\)/);
  assert.match(selectBlock, /\.select\(BEAUTY_PROFILE_SELECT\)/);
  assert.match(selectBlock, /\.eq\("user_id", input\.user\.id\)/);
  assert.match(selectBlock, /\.maybeSingle<BeautyProfileRow>\(\)/);
  assert.doesNotMatch(getOrCreateBlock, /\.upsert\(/);
  assert.match(getOrCreateBlock, /const selectResponse = await selectOwnBeautyProfile\(input\);/);
  assert.match(getOrCreateBlock, /if \(selectResponse\.error\) \{[\s\S]*Beauty profile SELECT failed[\s\S]*return null;/);
  assert.match(getOrCreateBlock, /if \(selectResponse\.data\) \{[\s\S]*return selectResponse\.data;/);
  assert.match(getOrCreateBlock, /\.insert\(\{\s*user_id: input\.user\.id,\s*\}\)/);
  assert.doesNotMatch(getOrCreateBlock, /bio:|cover_media_path:|visibility:|created_at|updated_at/);
  assert.match(getOrCreateBlock, /\.select\(BEAUTY_PROFILE_SELECT\)[\s\S]*\.single<BeautyProfileRow>\(\)/);
  assert.match(getOrCreateBlock, /isExpectedBeautyProfileUserConflict\(insertResponse\.error\)/);
  assert.match(getOrCreateBlock, /const recoveryResponse = await selectOwnBeautyProfile\(input\);/);
  assert.match(getOrCreateBlock, /Beauty profile conflict recovery SELECT failed/);
  assert.match(getOrCreateBlock, /Beauty profile INSERT failed/);
  assert.match(getOrCreateBlock, /Beauty profile INSERT returned no representation/);
  assert.match(conflictBlock, /error\?\.code !== "23505"/);
  assert.match(conflictBlock, /beauty_profiles_user_id_key/);
  assert.match(conflictBlock, /Key \(user_id\)=/);
});

test("beauty profile diagnostics expose safe response shape without identity payloads", () => {
  const diagnosticBlock = sourceFunctionBlock(
    beautyService,
    "supabaseResponseDiagnostic",
    "function logBeautyProfileDatabaseIssue",
  );
  const logBlock = sourceFunctionBlock(
    beautyService,
    "logBeautyProfileDatabaseIssue",
    "function isExpectedBeautyProfileUserConflict",
  );

  assert.match(diagnosticBlock, /hasError: Boolean\(response\.error\)/);
  assert.match(diagnosticBlock, /hasData: Boolean\(response\.data\)/);
  assert.match(diagnosticBlock, /code: response\.error\?\.code/);
  assert.match(diagnosticBlock, /message: redactDiagnosticText\(response\.error\?\.message\)/);
  assert.match(diagnosticBlock, /details: redactDiagnosticText\(response\.error\?\.details\)/);
  assert.match(diagnosticBlock, /hint: redactDiagnosticText\(response\.error\?\.hint\)/);
  assert.match(diagnosticBlock, /status: response\.status/);
  assert.match(diagnosticBlock, /statusText: response\.statusText/);
  assert.match(beautyService, /redactDiagnosticText/);
  assert.doesNotMatch(logBlock, /userId|email|phone|cookie|token|session|payload|storage/i);
});

test("beauty page renders the social timeline client with cursor loading", () => {
  const timelineBlock = functionBlock(
    "list_beauty_timeline",
    "create or replace function public.get_beauty_recent_visit_candidates",
  );

  assert.match(beautyPage, /getSelfBeautyProfilePage/);
  assert.match(beautyPage, /redirect\("\/login\?next=\/beauty"\)/);
  assert.match(beautyPage, /<BeautyProfileClient/);
  assert.match(beautyClient, /IntersectionObserver/);
  assert.match(beautyClient, /loadBeautyTimelineAction\(profile\.id, cursor\)/);
  assert.match(beautyClient, /createBeautyPostAction/);
  assert.match(beautyClient, /searchBeautyAttributionSalonsAction/);
  assert.match(beautyClient, /composerMode === "before_after"/);
  assert.match(beautyClient, /VerificationBadge/);
  assert.match(timelineBlock, /if p_cursor_created_at is not null and p_cursor_post_id is null then/);
  assert.match(timelineBlock, /with page_posts as/);
  assert.match(timelineBlock, /media_by_post as/);
  assert.match(timelineBlock, /reward_by_post as/);
  assert.doesNotMatch(timelineBlock, /select jsonb_agg\([\s\S]*from public\.beauty_post_media media[\s\S]*where media\.post_id = posts\.id/);
});
