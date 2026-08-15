import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const actions = read("app/explore/actions.ts");
const client = read("app/explore/explore-client.tsx");
const feedClient = read("app/explore/explore-feed.tsx");
const feedService = read("lib/explore-feed.ts");
const inspirationService = read("lib/explore-inspiration.ts");
const discoveryRail = read("app/explore/customer-explore-utility-panel.tsx");
const migration = read("supabase/migrations/202607240001_account_salon_baseline.sql");
const salonProfileRpcHardening = read(
  "supabase/migrations/202608110001_public_salon_profile_staff_rpc_hardening.sql",
);
const salonProfileReviewsRpcHardening = read(
  "supabase/migrations/202608110002_public_salon_profile_reviews_rpc_hardening.sql",
);
const publicExploreBeautyPosts = read(
  "supabase/migrations/202608110003_public_explore_beauty_posts.sql",
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
const page = read("app/explore/page.tsx");
const personalPostRoute = read(
  "app/explore/beauty/[profileId]/posts/[postId]/page.tsx",
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

  assert.ok(start >= 0, `${name} source function is present`);

  const end = nextMarker ? source.indexOf(nextMarker, start + 1) : source.length;

  assert.ok(end > start, `${name} source function has a readable boundary`);

  return source.slice(start, end);
}

test("explore feed service unifies Salon and Personal sources with one opaque cursor", () => {
  assert.match(feedService, /getExploreHomeContent/);
  assert.match(feedService, /getExploreInspirationPage/);
  assert.match(feedService, /getExplorePersonalPostPage/);
  assert.match(feedService, /diversify:\s*false/);
  assert.match(feedService, /toString\("base64url"\)/);
  assert.match(feedService, /Buffer\.from\(value,\s*"base64url"\)/);
  assert.match(feedService, /decodeExploreFeedCursor/);
  assert.match(feedService, /EXPLORE_FEED_CURSOR_VERSION\s*=\s*3/);
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
  assert.match(feedService, /payload\.version !== EXPLORE_FEED_CURSOR_VERSION && payload\.version !== 2/);
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
  assert.match(inspirationService, /diversifyInspirationItems\(itemsWithBooking\)/);
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
  assert.match(publicExploreBeautyPosts, /security definer/);
  assert.match(publicExploreBeautyPosts, /set search_path = public/);
  assert.match(publicExploreBeautyPosts, /from public\.beauty_posts posts/);
  assert.match(publicExploreBeautyPosts, /join public\.beauty_profiles profiles/);
  assert.match(publicExploreBeautyPosts, /join public\.users users/);
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
  assert.match(personalService, /safeHttpUrl\(row\.author_avatar_url\)/);
  assert.doesNotMatch(personalService, /email|phone|auth_user_id/);
});

test("Personal Explore service treats zero RPC rows as a valid empty page and logs safe diagnostics", () => {
  assert.match(personalService, /const rows = Array\.isArray\(data\) \? \(data as ExplorePersonalPostRow\[\]\) : \[\]/);
  assert.match(personalService, /const visibleRows = rows\.slice\(0, pageSize\)/);
  assert.match(personalService, /const hasMore = rows\.length > pageSize/);
  assert.match(personalService, /return \{\s*error:\s*null,\s*hasMore,\s*items,\s*nextCursor/s);
  assert.match(personalService, /if \(error\) \{/);
  assert.match(personalService, /supabaseErrorDiagnostics/);
  assert.match(personalService, /diagnosticJson/);
  assert.match(personalService, /status:\s*typeof status === "number" \? status : null/);
  assert.match(personalService, /statusText:\s*diagnosticString\(statusText\)/);
  assert.match(personalService, /args:\s*rpcArgs/);
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
  assert.match(feedService, /feedKey: `salon:\$\{item\.contentType\}:\$\{item\.contentId\}`/);
  assert.match(feedService, /feedKey: `salon:recommendation:\$\{salon\.id\}`/);
  assert.match(personalService, /feedKey:\s*`personal:\$\{postId\}`/);
  assert.match(feedService, /compareNaturalCandidateOrder/);
  assert.match(feedService, /right\.item\.sourceSortId\.localeCompare\(left\.item\.sourceSortId\)/);
});

test("explore page and action expose a reusable server feed contract", () => {
  assert.match(types, /export type ExploreFeedPage/);
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
  assert.match(feedService, /rankingSignalsForSalonContent/);
  assert.match(feedService, /rankingSignalsForPersonalContent/);
  assert.match(feedService, /rankingSignalsForRecommendation/);
  assert.match(feedService, /selectVisibleCandidates/);
  assert.match(feedService, /diversityAdjustedScore/);
  assert.match(feedService, /sourceRunLength/);
  assert.match(feedService, /entityRunLength/);
  assert.match(feedService, /authorRunLength/);
  assert.match(feedService, /if \(item\.salon\?\.id\)/);
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
  assert.match(feedClient, /window\.scrollTo\(0, stored\.scrollY\)/);
  assert.match(feedClient, /appendUniqueFeedItems/);
  assert.match(feedClient, /return item\.feedKey/);
  assert.match(feedClient, /EXPLORE_FEED_SESSION_VERSION\s*=\s*3/);
  assert.match(feedClient, /data-source-type=\{item\.sourceType\}/);
  assert.match(feedClient, /BeforeAfterMedia/);
  assert.match(feedClient, /salon_recommendation/);
  assert.doesNotMatch(feedClient, /Fresh inspiration/i);
  assert.doesNotMatch(feedClient, /Beauty stories/i);
  assert.match(feedClient, /loadExploreFeedAction\(cursor\)/);
  assert.doesNotMatch(
    feedClient,
    /storage\/v1\/object|supabase\.co|SALON_PROFILE_MEDIA_BUCKET|BEAUTY_MEDIA_BUCKET/,
  );
  assert.doesNotMatch(feedClient, />\s*(Like|Follow|Save|Comment)\s*</);
});

test("explore feed visual rhythm stays compact and image-led", () => {
  assert.match(client, /Featured now/);
  assert.match(client, /min-h-\[8rem\]/);
  assert.match(client, /heroHref/);
  assert.match(client, /max-w-\[44rem\] gap-3 px-4 pb-2 pt-3/);
  assert.match(feedClient, /Math\.min\(1\.45,\s*Math\.max\(0\.86,\s*media\.aspectRatio\)\)/);
  assert.match(feedClient, /rounded-\[1rem\] bg-white/);
  assert.match(feedClient, /line-clamp-3 text-sm leading-6/);
  assert.match(feedClient, /<div className="grid gap-4">/);
  assert.match(feedClient, /aspect-\[4\/3\] bg-surface-muted/);
  assert.doesNotMatch(feedClient, /grid gap-5/);
});

test("explore default home renders one centered feed and moves legacy sections behind shortcuts", () => {
  const homeBlock = sourceFunctionBlock(
    client,
    "ExploreHomeSections",
    "function ExploreNotice",
  );

  assert.match(homeBlock, /max-w-\[44rem\]/);
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
  assert.match(personalPostRoute, /View salon/);
  assert.match(personalPostRoute, /href="\/explore"/);
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
