import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const actions = read("app/explore/actions.ts");
const client = read("app/explore/explore-client.tsx");
const feedClient = read("app/explore/explore-feed.tsx");
const feedService = read("lib/explore-feed.ts");
const homeService = read("lib/explore-home.ts");
const inspirationService = read("lib/explore-inspiration.ts");
const searchService = read("lib/explore-search.ts");
const salonLogoService = read("lib/explore-salon-logos.ts");
const decisionSignalsService = read("lib/explore-decision-signals.ts");
const trustComponent = read("components/reylumi-trust.tsx");
const contentBookingService = read("lib/content-booking.ts");
const beautyPostBookingCountsService = read("lib/beauty-post-booking-counts.ts");
const discoveryRail = read("app/explore/customer-explore-utility-panel.tsx");
const migration = read("supabase/migrations/202607240001_account_salon_baseline.sql");
const salonProfileRpcHardening = read(
  "supabase/migrations/202608110001_public_salon_profile_staff_rpc_hardening.sql",
);
const salonProfileReviewsRpcHardening = read(
  "supabase/migrations/202608110002_public_salon_profile_reviews_rpc_hardening.sql",
);
const publicExploreBeautyPosts = read(
  "supabase/migrations/202608180001_beauty_post_booking_public_surfaces.sql",
);
const exploreBeautyPostSalonLogo = read(
  "supabase/migrations/202608210002_explore_beauty_post_salon_logo.sql",
);
const salonProfileRpcHardeningSql = [
  salonProfileRpcHardening,
  salonProfileReviewsRpcHardening,
].join("\n\n");
const allMigrationSql = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => read(`supabase/migrations/${name}`))
  .join("\n\n");
const page = read("app/(app)/explore/page.tsx");
const personalPostRoute = read(
  "app/(app)/explore/beauty/[profileId]/posts/[postId]/page.tsx",
);
const personalService = read("lib/explore-personal.ts");
const types = read("types/explore.ts");

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

function sourceFunctionBlock(source, name, nextMarker) {
  const start = source.indexOf(`function ${name}`);
  const asyncStart = source.indexOf(`async function ${name}`);
  const functionStart =
    asyncStart >= 0 && (start < 0 || asyncStart < start) ? asyncStart : start;

  assert.ok(functionStart >= 0, `${name} source function is present`);

  const end = nextMarker
    ? source.indexOf(nextMarker, functionStart + 1)
    : source.length;

  assert.ok(end > functionStart, `${name} source function has a readable boundary`);

  return source.slice(functionStart, end);
}

test("explore feed service unifies Salon and Personal sources with one opaque cursor", () => {
  assert.match(feedService, /getExploreHomeContent/);
  assert.match(feedService, /getExploreInspirationPage/);
  assert.match(feedService, /getExplorePersonalPostPage/);
  assert.match(feedService, /diversify:\s*false/);
  assert.match(feedService, /toString\("base64url"\)/);
  assert.match(feedService, /Buffer\.from\(value,\s*"base64url"\)/);
  assert.match(feedService, /decodeExploreFeedCursor/);
  assert.match(feedService, /EXPLORE_FEED_CURSOR_VERSION\s*=\s*4/);
  assert.match(feedService, /EXPLORE_FEED_CANDIDATE_POOL_MULTIPLIER\s*=\s*2/);
  assert.match(feedService, /normalizeLimit/);
  assert.match(feedService, /EXPLORE_FEED_MAX_PAGE_SIZE\s*=\s*18/);
  assert.match(feedService, /personal:\s*ExplorePersonalPostCursor \| null/);
  assert.match(feedService, /recommendation:\s*ExploreFeedRecommendationCursor \| null/);
  assert.match(feedService, /salon:\s*ExploreInspirationCursor \| null/);
  assert.match(feedService, /completed:\s*ExploreFeedSourceCompletion/);
  assert.match(feedService, /sourceState\.salon/);
  assert.match(feedService, /sourceState\.personal/);
  assert.match(feedService, /sourceState\.recommendation/);
  assert.match(feedService, /buildNextCursor/);
  assert.doesNotMatch(feedService, /\boffset\b/i);
});

test("explore feed cursor records exhausted sources so empty sources are not restarted", () => {
  assert.match(feedService, /type ExploreFeedSourceCompletion/);
  assert.match(feedService, /completed:\s*\{\s*personal:\s*false,\s*recommendation:\s*false,\s*salon:\s*false/s);
  assert.match(feedService, /normalizeCompletion/);
  assert.match(feedService, /payload\.version !== EXPLORE_FEED_CURSOR_VERSION &&\s*payload\.version !== 3 &&\s*payload\.version !== 2/s);
  assert.match(feedService, /sourceState\.completed\.salon\s*\?\s*Promise\.resolve\(emptyInspirationSourcePage\(\)\)/s);
  assert.match(feedService, /sourceState\.completed\.personal\s*\?\s*Promise\.resolve\(emptyPersonalSourcePage\(\)\)/s);
  assert.match(feedService, /sourceState\.completed\.recommendation\s*\?\s*Promise\.resolve\(emptyRecommendationSourcePage\(\)\)/s);
  assert.match(feedService, /consumed\.salon < salonCandidates\.length/);
  assert.match(feedService, /consumed\.personal < personalCandidates\.length/);
  assert.match(feedService, /consumed\.recommendation < recommendationCandidates\.length/);
  assert.match(feedService, /sourceCompleted\(\{/);
  assert.match(feedService, /FEED_SOURCES\.some\(\(source\) => !completed\[source\]\)/);
});

test("explore feed keeps empty source responses distinct from source errors", () => {
  assert.match(feedService, /if \(salonPage\.error \|\| personalPage\.error\)/);
  assert.match(feedService, /emptyInspirationSourcePage\(\): ExploreInspirationPage/);
  assert.match(feedService, /emptyPersonalSourcePage\(\): ExplorePersonalPostPage/);
  assert.match(feedService, /emptyRecommendationSourcePage\(\): RecommendationSourcePage/);
  assert.match(feedService, /items:\s*\[\]/);
  assert.match(feedService, /error:\s*null/);
  assert.match(feedService, /selected\.length > 0/);
});

test("explore inspiration keeps carousel diversification out of deterministic feed calls", () => {
  assert.match(inspirationService, /diversify\?: boolean/);
  assert.match(inspirationService, /input\.diversify === false/);
  assert.match(inspirationService, /diversifyInspirationItems\(itemsWithSaveStates\)/);
  assert.match(read("lib/explore-home.ts"), /getExploreInspirationPage\(\{ diversify: false \}\)/);
});

test("public explore inspiration RPC uses published public salon content with keyset order", () => {
  const block = functionBlock(
    "get_public_explore_inspiration",
    "create or replace function public.get_public_content_booking_options",
  );

  assert.match(block, /security definer/);
  assert.match(block, /set search_path = public/);
  assert.match(block, /from public\.salon_profile_looks looks/);
  assert.match(block, /from public\.salon_profile_updates updates/);
  assert.match(block, /looks\.status = 'published'/);
  assert.match(block, /updates\.status = 'published'/);
  assert.match(block, /settings\.public_discovery_enabled = true/);
  assert.match(block, /salons\.status = 'active'/);
  assert.match(block, /published_at < p_cursor_published_at/);
  assert.match(block, /media_id < p_cursor_media_id/);
  assert.match(block, /order by published_at desc, media_id desc/);
  assert.match(block, /limit \(select page_size_value \+ 1 from normalized\)/);
  assert.doesNotMatch(block, /\boffset\b/i);
});

test("public explore Beauty RPC exposes eligible public Personal posts only", () => {
  assert.match(
    publicExploreBeautyPosts,
    /create or replace function public\.get_public_explore_beauty_posts/,
  );
  assert.match(publicExploreBeautyPosts, /drop function if exists public\.get_public_explore_beauty_posts/);
  assert.match(publicExploreBeautyPosts, /security definer/);
  assert.match(publicExploreBeautyPosts, /set search_path = public/);
  assert.match(publicExploreBeautyPosts, /from public\.beauty_posts posts/);
  assert.match(publicExploreBeautyPosts, /join public\.beauty_profiles profiles/);
  assert.match(publicExploreBeautyPosts, /join public\.users users/);
  assert.match(publicExploreBeautyPosts, /left join public\.beauty_post_verifications verifications/);
  assert.match(publicExploreBeautyPosts, /left join public\.booking_settings booking_settings/);
  assert.match(publicExploreBeautyPosts, /verification_state text/);
  assert.match(publicExploreBeautyPosts, /booking_enabled boolean/);
  assert.match(publicExploreBeautyPosts, /verifications\.state as verification_state/);
  assert.match(publicExploreBeautyPosts, /booking_settings\.online_booking_visible/);
  assert.match(publicExploreBeautyPosts, /booking_settings\.guest_booking_enabled/);
  assert.match(exploreBeautyPostSalonLogo, /drop function if exists public\.get_public_explore_beauty_posts/);
  assert.match(exploreBeautyPostSalonLogo, /salon_logo_path text/);
  assert.match(exploreBeautyPostSalonLogo, /settings\.public_profile_logo_path as salon_logo_path/);
  assert.match(exploreBeautyPostSalonLogo, /eligible_posts\.salon_logo_path/);
  assert.match(exploreBeautyPostSalonLogo, /grant execute on function public\.get_public_explore_beauty_posts/);
  assert.match(publicExploreBeautyPosts, /posts\.deleted_at is null/);
  assert.match(publicExploreBeautyPosts, /posts\.visibility = 'public'/);
  assert.match(publicExploreBeautyPosts, /posts\.moderation_status = 'visible'/);
  assert.match(publicExploreBeautyPosts, /profiles\.visibility = 'public'/);
  assert.match(publicExploreBeautyPosts, /exists \(\s*select 1\s*from public\.beauty_post_media/s);
  assert.match(publicExploreBeautyPosts, /posts\.created_at < p_cursor_created_at/);
  assert.match(publicExploreBeautyPosts, /posts\.id < p_cursor_post_id/);
  assert.match(publicExploreBeautyPosts, /order by posts\.created_at desc, posts\.id desc/);
  assert.match(publicExploreBeautyPosts, /limit \(select page_size_value \+ 1 from normalized\)/);
  assert.match(publicExploreBeautyPosts, /beauty_posts_public_explore_idx/);
  assert.match(publicExploreBeautyPosts, /grant execute on function public\.get_public_explore_beauty_posts/);
  const returnColumns = publicExploreBeautyPosts.slice(
    publicExploreBeautyPosts.indexOf("returns table ("),
    publicExploreBeautyPosts.indexOf(")\nlanguage sql"),
  );
  assert.doesNotMatch(returnColumns, /\bemail\b|\bphone\b|author_user_id|auth_user_id/);
  assert.doesNotMatch(publicExploreBeautyPosts, /users\.(email|phone|auth_user_id)/);
  assert.doesNotMatch(publicExploreBeautyPosts, /grant select on table public\.beauty_posts to anon/i);
});

test("Personal Explore service normalizes Beauty posts without leaking raw storage paths to React", () => {
  assert.match(personalService, /get_public_explore_beauty_posts/);
  assert.match(personalService, /getBeautyMediaPublicUrl/);
  assert.match(personalService, /sourceType:\s*"personal"/);
  assert.match(personalService, /feedKey:\s*`personal:\$\{postId\}`/);
  assert.match(personalService, /contentType:\s*"beauty_post"/);
  assert.match(personalService, /candidateClass:\s*"organic"/);
  assert.match(personalService, /rankingSignalsForPersonalPost/);
  assert.match(personalService, /personalPostHref/);
  assert.match(personalService, /verificationState/);
  assert.match(personalService, /beautyPostBookingPresentation/);
  assert.match(personalService, /source:\s*"explore"/);
  assert.match(personalService, /bookingEnabled:\s*row\.booking_enabled === true/);
  assert.match(personalService, /booking:\s*booking\.eligible\s*\?/);
  assert.match(personalService, /attachExploreBookingCounts/);
  assert.match(personalService, /loadBeautyPostVerifiedBookingCounts/);
  assert.match(personalService, /bookedCount/);
  assert.match(personalService, /getSalonProfileMediaUrl/);
  assert.match(personalService, /salon_logo_path/);
  assert.match(personalService, /loadPublicSalonLogoPaths/);
  assert.match(personalService, /logoPathMap/);
  assert.match(personalService, /row\.salon_logo_path \?\? fallbackSalonLogoPath/);
  assert.match(salonLogoService, /get_public_salon_profile/);
  assert.match(salonLogoService, /target_salon_id: salonId/);
  assert.doesNotMatch(personalService, /verifiedBookingCount/);
  assert.match(personalService, /safeHttpUrl\(row\.author_avatar_url\)/);
  assert.doesNotMatch(personalService, /email|phone|auth_user_id/);
});

test("Personal Explore service treats zero RPC rows as a valid empty page and logs safe diagnostics", () => {
  assert.match(personalService, /const rows = Array\.isArray\(data\) \? \(data as ExplorePersonalPostRow\[\]\) : \[\]/);
  assert.match(personalService, /const visibleRows = rows\.slice\(0, pageSize\)/);
  assert.match(personalService, /const hasMore = rows\.length > pageSize/);
  assert.match(personalService, /const itemsWithBookingCounts = await attachExploreBookingCounts\(\{\s*items,\s*rpc,\s*\}\)/s);
  assert.match(personalService, /const itemsWithSaveStates = await attachPersonalPostSaveStates\(\s*itemsWithBookingCounts,\s*\)/s);
  assert.match(personalService, /return \{\s*error:\s*null,\s*hasMore,\s*items:\s*itemsWithSaveStates,\s*nextCursor/s);
  assert.match(personalService, /if \(error\) \{/);
  assert.match(personalService, /supabaseErrorDiagnostics/);
  assert.match(personalService, /diagnosticJson/);
  assert.match(personalService, /status:\s*typeof status === "number" \? status : null/);
  assert.match(personalService, /statusText:\s*diagnosticString\(statusText\)/);
  assert.match(personalService, /args:\s*rpcArgs/);
});

test("Explore salon logos are normalized across every public source", () => {
  assert.match(types, /logoImageUrl: string \| null/);
  assert.match(types, /salonLogoImageUrl: string \| null/);
  assert.match(salonLogoService, /export async function loadPublicSalonLogoPaths/);
  assert.match(salonLogoService, /get_public_salon_profile/);
  assert.match(salonLogoService, /logo_path/);

  assert.match(inspirationService, /salon_logo_path/);
  assert.match(inspirationService, /salonLogoImageUrl: getSalonProfileMediaUrl/);
  assert.match(inspirationService, /loadPublicSalonLogoPaths/);
  assert.match(inspirationService, /itemsWithLogos/);

  assert.match(homeService, /logo_image_path/);
  assert.match(homeService, /logoImageUrl: getSalonProfileMediaUrl/);
  assert.match(homeService, /loadPublicSalonLogoPaths/);
  assert.match(homeService, /logoPathMap\.get\(row\.salon_id\)/);

  assert.match(searchService, /logo_image_path/);
  assert.match(searchService, /logoImageUrl: getSalonProfileMediaUrl/);
  assert.match(searchService, /loadPublicSalonLogoPaths/);
  assert.match(searchService, /logoPathMap\.get\(row\.salon_id\)/);

  assert.match(feedService, /avatarUrl: item\.salonLogoImageUrl/);
  assert.match(feedService, /logoImageUrl: item\.salonLogoImageUrl/);
  assert.match(feedService, /avatarUrl: salon\.logoImageUrl/);
  assert.match(feedService, /logoImageUrl: salon\.logoImageUrl/);
  assert.doesNotMatch(feedService, /logoImageUrl:\s*null/);
});

test("Beauty post booking count and inspiration attribution stay server-owned", () => {
  assert.match(
    publicExploreBeautyPosts,
    /create or replace function public\.get_public_beauty_post_booking_counts/,
  );
  assert.match(publicExploreBeautyPosts, /bookings\.source_reference_type = 'beauty_post'/);
  assert.match(publicExploreBeautyPosts, /bookings\.confirmation_status = 'confirmed'/);
  assert.match(
    publicExploreBeautyPosts,
    /bookings\.status in \('confirmed', 'checked_in', 'in_service', 'completed'\)/,
  );
  assert.match(publicExploreBeautyPosts, /profiles\.visibility = 'public'/);
  assert.match(publicExploreBeautyPosts, /verifications\.state = 'verified'/);
  assert.match(publicExploreBeautyPosts, /create or replace function public\.get_public_content_booking_options/);
  assert.match(publicExploreBeautyPosts, /media_bucket text/);
  assert.match(publicExploreBeautyPosts, /'beauty_post'::text as source_type/);
  assert.match(publicExploreBeautyPosts, /'beauty-profile-media'::text as media_bucket/);
  assert.match(publicExploreBeautyPosts, /'Book this transformation'::text as cta_label/);
  assert.match(publicExploreBeautyPosts, /'\?inspiration=' \|\| posts\.id::text \|\| '&source=public_profile'/);
  assert.match(personalService, /loadBeautyPostVerifiedBookingCounts/);
  assert.match(personalPostRoute, /bookingCountLabel/);
  assert.match(feedClient, /bookingCountLabel/);
});

test("Beauty booking CTA does not depend on booking-count RPC success", () => {
  const attachBlock = sourceFunctionBlock(
    personalService,
    "attachExploreBookingCounts",
    "function asMediaRows",
  );
  const mapBlock = sourceFunctionBlock(
    personalService,
    "mapPersonalPostRow",
    "export async function getExplorePersonalPostPage",
  );

  assert.match(mapBlock, /const booking = beautyPostBookingPresentation\(\{/);
  assert.match(mapBlock, /bookingEnabled:\s*row\.booking_enabled === true/);
  assert.match(mapBlock, /booking:\s*booking\.eligible\s*\?/);
  assert.match(attachBlock, /loadBeautyPostVerifiedBookingCounts/);
  assert.match(attachBlock, /if \(!item\.booking\) \{\s*return item;\s*\}/);
  assert.match(attachBlock, /bookedCount: countsByPostId\.get\(item\.id\) \?\? 0/);
  assert.doesNotMatch(attachBlock, /bookedCount: countsByPostId\.get\(item\.id\) \|\| undefined/);
});

test("Explore optional data fallbacks do not use dev-overlay console errors", () => {
  const optionalExploreSources = [
    homeService,
    inspirationService,
    searchService,
    decisionSignalsService,
    personalService,
    contentBookingService,
    beautyPostBookingCountsService,
  ].join("\n\n");

  assert.doesNotMatch(optionalExploreSources, /console\.error\(\s*"Explore/);
  assert.doesNotMatch(optionalExploreSources, /Public content booking options RPC failed/);
  assert.doesNotMatch(optionalExploreSources, /Beauty post booking counts failed/);
  assert.match(optionalExploreSources, /console\.warn\(\s*"Explore inspiration unavailable"/);
  assert.match(optionalExploreSources, /console\.warn\(\s*"Explore public salon search unavailable"/);
  assert.match(optionalExploreSources, /console\.warn\(\s*"Explore personal beauty posts unavailable"/);
});

test("Explore DTO restore keeps fresh Beauty booking presentation over stale session copies", () => {
  assert.match(feedClient, /EXPLORE_FEED_SESSION_VERSION\s*=\s*9/);
  assert.match(feedClient, /function mergeStoredFeedItems/);
  assert.match(feedClient, /const freshByKey = new Map/);
  assert.match(feedClient, /freshByKey\.get\(feedItemKey\(item\)\) \?\? item/);
  assert.match(feedClient, /setItems\(\(current\) => mergeStoredFeedItems\(stored\.items, current\)\)/);
  assert.doesNotMatch(
    feedClient,
    /setItems\(\(current\) => appendUniqueFeedItems\(stored\.items, current\)\)/,
  );
});

test("unified feed contract uses source-qualified identity and normalized media", () => {
  assert.match(types, /export type ExploreFeedSourceType = "personal" \| "salon"/);
  assert.match(types, /export type ExploreFeedCandidateClass = "organic" \| "sponsored"/);
  assert.match(types, /export type ExploreFeedRankingSignals/);
  assert.match(types, /feedKey: string/);
  assert.match(types, /sourceType: ExploreFeedSourceType/);
  assert.match(types, /contentType: "beauty_post" \| "look" \| "salon_recommendation" \| "update"/);
  assert.match(types, /rankingSignals: ExploreFeedRankingSignals/);
  assert.match(types, /candidateClass: ExploreFeedCandidateClass/);
  assert.match(types, /export type ExploreFeedMedia/);
  assert.match(types, /export type ExplorePersonalPostPage/);
  assert.match(types, /logoImageUrl: string \| null/);
  assert.match(feedService, /feedKey: `salon:\$\{item\.contentType\}:\$\{item\.contentId\}`/);
  assert.match(feedService, /feedKey: `salon:recommendation:\$\{salon\.id\}`/);
  assert.match(feedService, /logoImageUrl: item\.salonLogoImageUrl/);
  assert.match(feedService, /logoImageUrl: salon\.logoImageUrl/);
  assert.match(feedService, /recommendationPostPreviewsBySalonId/);
  assert.match(feedService, /recommendationPostBySalonId\.get\(salon\.id\)/);
  assert.match(feedService, /featuredPost\?\.media \?\? coverMedia/);
  assert.match(personalService, /feedKey:\s*`personal:\$\{postId\}`/);
  assert.match(feedService, /compareNaturalCandidateOrder/);
  assert.match(feedService, /right\.item\.sourceSortId\.localeCompare\(left\.item\.sourceSortId\)/);
});

test("explore page and action expose a reusable server feed contract", () => {
  assert.match(types, /export type ExploreFeedPage/);
  assert.match(types, /export type ExploreFeedVerification/);
  assert.match(types, /verification:\s*ExploreFeedVerification \| null/);
  assert.match(types, /BeautyPostBookingPresentation/);
  assert.match(types, /export type ExploreFeedBooking = BeautyPostBookingPresentation/);
  assert.match(actions, /export async function loadExploreFeedAction/);
  assert.match(actions, /return getExploreFeedPage\(\{ cursor \}\)/);
  assert.match(page, /getExploreFeedPage\(\{ homeContent \}\)/);
  assert.match(page, /buildExploreDiscoveryContent/);
  assert.match(page, /discoveryContent=\{discoveryContent\}/);
  assert.match(page, /initialFeed=\{initialFeed\}/);
  assert.match(client, /<ExploreFeed initialPage=\{initialFeed\}/);
});

test("explore feed ranking and diversity live in the server feed layer", () => {
  assert.match(feedService, /ORGANIC_RANKING_WEIGHTS/);
  assert.match(feedService, /engagementVelocity:\s*0/);
  assert.match(feedService, /weightedRankingScore/);
  assert.match(feedService, /createExploreFeedSessionSeed/);
  assert.match(feedService, /sessionSeed/);
  assert.match(feedService, /stableHashScore/);
  assert.match(feedService, /recentPriorityScore/);
  assert.match(feedService, /sessionVariationScore/);
  assert.match(feedService, /freshnessBucket/);
  assert.match(feedService, /arrangeSourceCandidates/);
  assert.match(feedService, /sourceCandidatePoolSize\(pageSize\)/);
  assert.match(feedService, /rankingSignalsForSalonContent/);
  assert.match(feedService, /rankingSignalsForPersonalContent/);
  assert.match(feedService, /rankingSignalsForRecommendation/);
  assert.match(feedService, /selectVisibleCandidates/);
  assert.match(feedService, /diversityAdjustedScore/);
  assert.match(feedService, /sourceRunLength/);
  assert.match(feedService, /entityRunLength/);
  assert.match(feedService, /authorRunLength/);
  assert.match(feedService, /if \(item\.salon\?\.id\)/);
  assert.match(feedService, /compareNaturalCandidateOrder\(boundary,\s*candidate\) < 0/);
  assert.match(feedService, /sourceRun >= 1/);
  assert.match(feedService, /authorRun >= 1/);
  assert.match(feedService, /FEED_SOURCES\.map/);
  assert.doesNotMatch(feedService, /love_count|comment_count|view_count/i);
});

test("explore feed client guards infinite scroll requests and restores route state", () => {
  assert.match(feedClient, /IntersectionObserver/);
  assert.match(feedClient, /rootMargin:\s*"900px 0px"/);
  assert.match(feedClient, /loadingMoreRef/);
  assert.match(feedClient, /requestedCursorsRef/);
  assert.match(feedClient, /mountedRef/);
  assert.match(feedClient, /paginationError && !options\.retry/);
  assert.match(feedClient, /sessionStorage/);
  assert.match(feedClient, /shouldRestoreStoredFeedState/);
  assert.match(feedClient, /navigation\?\.type !== "reload"/);
  assert.match(feedClient, /sessionStorage\.removeItem\(EXPLORE_FEED_SESSION_KEY\)/);
  assert.match(feedClient, /window\.scrollTo\(0, stored\.scrollY\)/);
  assert.match(feedClient, /appendUniqueFeedItems/);
  assert.match(feedClient, /return item\.feedKey/);
  assert.match(feedClient, /EXPLORE_FEED_SESSION_VERSION\s*=\s*9/);
  assert.match(feedClient, /data-source-type=\{item\.sourceType\}/);
  assert.match(feedClient, /BeforeAfterMedia/);
  assert.match(feedClient, /BeforeAfterCompare/);
  assert.match(feedClient, /beforeAfterMediaPair/);
  assert.match(feedClient, /FeedMediaFrame/);
  assert.match(feedClient, /FeedSalonIdentityLine/);
  assert.match(feedClient, /FeedHeaderTitle/);
  assert.match(feedClient, /FeedSalonLogo/);
  assert.match(feedClient, /item\.author\.kind === "salon" \? item\.salon\?\.logoImageUrl : null/);
  assert.match(feedClient, /logoImageUrl/);
  assert.match(feedClient, /item\.sourceType === "personal" && Boolean\(salon\)/);
  assert.match(feedClient, /LumiTrustPopover/);
  assert.match(feedClient, /presentation="spark"/);
  assert.match(feedClient, /entityName=\{item\.salon\.name\}/);
  assert.match(feedClient, /actionHref=\{trustHref\}/);
  assert.match(feedClient, /authorHref/);
  assert.match(feedClient, /\/explore\/beauty\/\$\{encodeURIComponent\(item\.personal\.profileId\)\}/);
  assert.match(feedClient, /bookedCount > 0/);
  assert.match(feedClient, /router\.push\(href\)/);
  assert.match(feedClient, /pointerMovedRef/);
  assert.match(feedClient, /isComparatorControl/);
  assert.doesNotMatch(feedClient, /FeedTrustOverlay/);
  assert.doesNotMatch(feedClient, /LinkedShopTrustRow/);
  assert.doesNotMatch(feedClient, /Linked salon/);
  assert.match(feedClient, /salon_recommendation/);
  assert.doesNotMatch(feedClient, /function verificationLabel/);
  assert.match(feedClient, /bookingCountLabel/);
  assert.match(feedClient, /bookedCountText/);
  assert.match(feedClient, /bookingHref/);
  assert.match(feedClient, /booking\?\.label \?\? "Book"/);
  assert.match(feedClient, /FeedShareButton/);
  assert.match(feedClient, /navigator\.share/);
  assert.doesNotMatch(feedClient, />\s*View post\s*</);
  assert.doesNotMatch(feedClient, />\s*View salon\s*</);
  assert.doesNotMatch(feedClient, /TrustFactPill/);
  assert.doesNotMatch(feedClient, /Fresh inspiration/i);
  assert.doesNotMatch(feedClient, /Beauty stories/i);
  assert.match(feedClient, /loadExploreFeedAction\(cursor\)/);
  assert.doesNotMatch(
    feedClient,
    /storage\/v1\/object|supabase\.co|SALON_PROFILE_MEDIA_BUCKET|BEAUTY_MEDIA_BUCKET/,
  );
  assert.doesNotMatch(feedClient, />\s*(Like|Follow|Save|Comment)\s*</);
});

test("LUMI trust UI is shared, interactive, and keeps signals separated", () => {
  assert.match(trustComponent, /export function LumiTrustPopover/);
  assert.match(trustComponent, /aria-haspopup="dialog"/);
  assert.match(trustComponent, /aria-expanded=\{open\}/);
  assert.match(trustComponent, /onMouseEnter=\{openPopover\}/);
  assert.match(trustComponent, /onClick=\{togglePopover\}/);
  assert.match(trustComponent, /export function LumiTrustSpark/);
  assert.match(trustComponent, /viewBox="0 0 20 20"/);
  assert.match(trustComponent, /data-lumi-trust-level=\{level\}/);
  assert.match(trustComponent, /LUMI_TRUST_FILL_RATIO/);
  assert.match(trustComponent, /presentation\?: "label" \| "spark"/);
  assert.match(trustComponent, /actionHref\?: string \| null/);
  assert.match(trustComponent, /actionLabel = "View trust details"/);
  assert.match(trustComponent, /summary\.evidenceRows/);
  assert.match(trustComponent, /entityName\?: string \| null/);
  assert.doesNotMatch(trustComponent, /Verification, stars, ranking, and linked state are separate signals/);
  assert.doesNotMatch(trustComponent, /Ranking appears only when/);
  assert.match(client, /LumiTrustPopover/);
  assert.match(feedClient, /LumiTrustPopover/);
  assert.match(client, /presentation="spark"/);
  assert.doesNotMatch(client, /cardTrustLabel/);
  assert.doesNotMatch(client, /cardTrustAriaLabel/);
});

test("explore feed visual rhythm stays compact and image-led", () => {
  assert.match(client, /Featured now/);
  assert.match(client, /min-h-\[7\.25rem\]/);
  assert.match(client, /heroHref/);
  assert.match(client, /max-w-\[40rem\] gap-2\.5 px-4 pb-2 pt-3/);
  assert.match(feedClient, /Math\.min\(1\.55,\s*Math\.max\(1\.06,\s*media\.aspectRatio\)\)/);
  assert.match(feedClient, /isRecommendationCoverMedia/);
  assert.match(feedClient, /h-\[13rem\] sm:h-\[16rem\] lg:h-\[17rem\]/);
  assert.match(feedClient, /rounded-\[0\.95rem\] bg-white/);
  assert.match(feedClient, /line-clamp-2 text-sm leading-5/);
  assert.match(feedClient, /<div className="grid gap-3">/);
  assert.match(feedClient, /aspect-\[4\/3\] bg-surface-muted/);
  assert.doesNotMatch(feedClient, /grid gap-5/);
});

test("explore default home renders one centered feed and moves legacy sections behind shortcuts", () => {
  const homeBlock = sourceFunctionBlock(
    client,
    "ExploreHomeSections",
    "function ExploreNotice",
  );

  assert.match(homeBlock, /max-w-\[40rem\]/);
  assert.match(homeBlock, /<ExploreFeed initialPage=\{initialFeed\}/);
  assert.doesNotMatch(homeBlock, /TopRatedSalonsSection/);
  assert.doesNotMatch(homeBlock, /TrendingDesignsSection/);
  assert.doesNotMatch(homeBlock, /RecommendedForYouSection/);
  assert.doesNotMatch(homeBlock, /NearYouHomeSection/);
  assert.match(client, /ExploreDiscoveryResults/);
  assert.match(client, /MobileDiscoveryShortcuts/);
  assert.match(client, /ExploreDiscoveryRail/);
  assert.match(client, /showSecondaryViewAction/);
});

test("discovery rail and mobile shortcuts only render server-provided data-backed modules", () => {
  assert.match(types, /export type ExploreDiscoveryContent/);
  assert.match(types, /export type ExploreDiscoveryPreview/);
  assert.match(types, /previews:\s*ExploreDiscoveryPreview\[\]/);
  assert.match(page, /initialFeed:\s*ExploreFeedPage/);
  assert.match(page, /searchResponse:\s*ExploreSearchResponse/);
  assert.match(page, /discoveryAvoidSignals\(input\.initialFeed\)/);
  assert.match(page, /selectDiscoveryPreviewCandidates/);
  assert.match(page, /discoveryShortcutPriority/);
  assert.match(page, /\.slice\(0,\s*5\)/);
  assert.match(page, /if \(input\.utilityContent\.upcomingBooking\)/);
  assert.match(page, /if \(trendingCount > 0\)/);
  assert.match(page, /if \(topRatedCount > 0\)/);
  assert.match(page, /label:\s*"Fresh looks"/);
  assert.match(page, /actionLabel:\s*"Open booking"/);
  assert.match(discoveryRail, /ExploreDiscoveryRail/);
  assert.match(discoveryRail, /MobileDiscoveryShortcuts/);
  assert.match(discoveryRail, /if \(shortcuts\.length === 0\)/);
  assert.match(discoveryRail, /FeaturedPreviewMosaic/);
  assert.match(discoveryRail, /CompactPreviewStrip/);
  assert.match(discoveryRail, /Image/);
  assert.doesNotMatch(discoveryRail, /Refer & Earn|View perks|Rewards|offers available/i);
});

test("public Beauty post route is read-only and backed by the Personal Explore service", () => {
  assert.match(personalPostRoute, /getPublicExploreBeautyPost/);
  assert.match(personalPostRoute, /notFound\(\)/);
  assert.match(personalPostRoute, /BeforeAfterCompare/);
  assert.match(personalPostRoute, /<PostMedia item=\{item\} \/>/);
  assert.match(personalPostRoute, /View salon/);
  assert.match(personalPostRoute, /Verified visit/);
  assert.match(personalPostRoute, /bookingHref/);
  assert.match(personalPostRoute, /item\.booking\?\.eligible/);
  assert.match(personalPostRoute, /booking\?\.label \?\? "Book"/);
  assert.match(personalPostRoute, /booking\?\.bookedCount/);
  assert.match(personalPostRoute, /bookingCountLabel/);
  assert.match(personalPostRoute, /PostHeaderTitle/);
  assert.match(personalPostRoute, /SalonLogo/);
  assert.match(personalPostRoute, /logoImageUrl/);
  assert.match(personalPostRoute, /const showPostTypeBadge = item\.personal\?\.postType !== "before_after"/);
  assert.doesNotMatch(personalPostRoute, /href="\/explore"/);
  assert.doesNotMatch(
    personalPostRoute,
    /createBeautyPostAction|updateBeautyPostCaptionAction|deleteBeautyPostAction|Edit|Delete/,
  );
});

test("public salon profile RPCs used from Explore are definer hardened without table grants", () => {
  for (const functionName of [
    "get_public_salon_profile_staff",
    "get_public_salon_profile_looks",
    "get_public_salon_profile_updates",
    "get_public_salon_profile_reviews",
  ]) {
    assert.ok(
      salonProfileRpcHardeningSql.includes(`'public.${functionName}(uuid)'`),
    );
  }

  assert.match(salonProfileRpcHardeningSql, /alter function %s security definer/);
  assert.match(salonProfileRpcHardeningSql, /alter function %s set search_path = public/);
  assert.match(salonProfileRpcHardeningSql, /revoke all on function %s from public/);
  assert.match(salonProfileRpcHardeningSql, /grant execute on function %s to anon, authenticated/);
  assert.doesNotMatch(
    allMigrationSql,
    /grant select on table public\.staff to anon/i,
  );
});
