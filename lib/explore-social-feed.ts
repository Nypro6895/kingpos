import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { serializeExploreFeedItem, type ExploreFeedRevision } from "@/lib/explore-feed-revisions";
import { createClient } from "@supabase/supabase-js";
import { getBeautyMediaPublicUrl } from "@/lib/beauty-media";
import { beautyPostBookingPresentation } from "@/lib/beauty-booking-verification";
import { mapContentBookingOptionRow } from "@/lib/content-booking";
import { resolveBusinessCoverImage } from "@/lib/default-nail-images";
import { EMPTY_EXPLORE_DECISION_SIGNALS, exploreFeedTrustFromDecisionSignals, getExploreDecisionSignalsBySalonId, type ExploreDecisionSignals } from "@/lib/explore-decision-signals";
import { normalizeExploreFeedDiscoveryOptions, type ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import { buildExploreSocialFeedQueue, type SocialFeedCandidate, type SocialFeedPool } from "@/lib/explore-social-feed-ranking";
import { normalizePublicBookingHref } from "@/lib/public-booking-routes";
import { getPublicSalonOperatingStatusesBySalonId, operatingStatusFromMap } from "@/lib/salon-operating-status";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import type { ExploreFeedItem, ExploreFeedMedia, ExploreFeedPage, ExploreHomeSalon } from "@/types/explore";
import type { SalonOperatingStatus } from "@/types/salon-operating-status";

type Cursor = { version: 1; session: string; after: number };
type FeedInput = { cursor?: string | null; discovery?: ExploreFeedDiscoveryOptions; visitorKey: string; signal?: AbortSignal; limit?: number };
type HydratedRow = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR = /^(user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|guest:[0-9a-f]{64})$/i;
const string = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function clientFor(input: { visitorKey: string }) {
  if (!ACTOR.test(input.visitorKey)) throw new Error("Invalid discovery session.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Discovery is temporarily unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
type FeedClient = ReturnType<typeof clientFor>;
type FeedTimings = {
  selectMs: number; queueMs: number; pageMs: number; hydrateMs: number; totalMs: number;
  candidateCount: number; returnedItems: number; canonicalRpcCount: number;
  selectedHydrationMs: number; decisionSignalsMs: number; operatingStatusMs: number;
  canonicalRpcMs: Record<string, number>;
};
type TimingStage = "selectMs" | "queueMs" | "pageMs" | "hydrateMs" | "selectedHydrationMs" | "decisionSignalsMs" | "operatingStatusMs";
async function measure<T>(timings: FeedTimings | undefined, stage: TimingStage, task: () => Promise<T>) {
  const startedAt = Date.now();
  try { return await task(); }
  finally { if (timings) timings[stage] += Date.now() - startedAt; }
}

async function rpc(client: FeedClient, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  const query = client.rpc(name, args);
  const result = await (signal ? query.abortSignal(signal) : query);
  if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  if (result.error) throw Object.assign(new Error(result.error.code === "22023" ? "Discovery session expired. Refresh to continue." : "Discovery could not be loaded. Please try again."), { code: result.error.code });
  return result.data as unknown;
}

export function decodeExploreSocialFeedCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  if (value.length > 4096) throw new Error("Invalid discovery cursor.");
  let cursor: Record<string, unknown>;
  try { cursor = record(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); }
  catch { throw new Error("Invalid discovery cursor."); }
  if (cursor.version !== 1 || typeof cursor.session !== "string" || !UUID.test(cursor.session) || !Number.isInteger(cursor.after) || Number(cursor.after) < 0 || Number(cursor.after) > 384) throw new Error("Invalid discovery cursor.");
  return { version: 1, session: cursor.session, after: Number(cursor.after) };
}
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
const filtersFor = (input: FeedInput) => normalizeExploreFeedDiscoveryOptions(input.discovery) ?? normalizeExploreFeedDiscoveryOptions({})!;

function safeHttpUrl(value: unknown) {
  const path = string(value);
  if (!path) return null;
  try { const url = new URL(path); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function mapMedia(value: unknown, personal: boolean, url: string): ExploreFeedMedia[] {
  return (Array.isArray(value) ? value : []).flatMap(raw => {
    const media = record(raw);
    const role = media.role === "before" || media.role === "after" ? media.role : "image";
    const path = string(media.objectPath);
    const imageUrl = personal ? getBeautyMediaPublicUrl({ path, supabaseUrl: url, bucket: string(media.bucket) ?? undefined }) : getSalonProfileMediaUrl(path);
    if (!imageUrl || !string(media.id)) return [];
    const width = number(media.width), height = number(media.height);
    const ratio = width && height && width > 0 && height > 0 ? width / height : null;
    return [{ aspectRatio: ratio, height, id: string(media.id)!, imageUrl, layoutVariant: ratio === null || ratio <= .82 ? "portrait" as const : ratio >= 1.2 ? "landscape" as const : "square" as const, role, width }];
  });
}

function directorySalon(row: HydratedRow, signals: ExploreDecisionSignals, status: SalonOperatingStatus): ExploreHomeSalon | null {
  const d = record(row.document), id = string(d.salon_id), name = string(d.salon_name);
  if (!id || !UUID.test(id) || !name || d.has_public_profile !== true) return null;
  const categories = strings(d.service_categories);
  return {
    ...signals, activeServiceCount: number(d.active_service_count) ?? 0,
    addressLine1: string(d.address_line1), addressLine2: string(d.address_line2), averageRating: signals.averageRating,
    bookableServiceId: signals.bookableServiceId, bookableServiceName: signals.bookableServiceName,
    bookableServicePrice: signals.bookableServicePrice ?? null, bookingEnabled: signals.bookingEnabled, bookingHref: normalizePublicBookingHref(signals.bookingHref),
    city: string(d.city), country: string(d.country), coverImageUrl: resolveBusinessCoverImage({ id, name, categories, coverImageUrl: getSalonProfileMediaUrl(string(d.cover_image_path)) }),
    description: string(d.description), distanceMiles: null, featuredServiceCategory: string(d.featured_service_category), featuredServiceName: string(d.featured_service_name),
    hasPublicProfile: true, id, isNew: typeof d.created_at === "string" && Date.parse(d.created_at) >= Date.now() - 30 * 86400000,
    latitude: number(d.latitude), longitude: number(d.longitude), latestMediaCreatedAt: string(d.latest_media_created_at), logoImageUrl: getSalonProfileMediaUrl(string(row.logoImagePath)),
    matchType: "recommended", matchTier: 99, name, nextAvailabilityLabel: signals.nextAvailabilityLabel, nextAvailableAt: signals.nextAvailableAt,
    operatingStatus: status, phone: string(d.phone), postalCode: string(d.postal_code), profileCompleteness: number(d.profile_completeness) ?? 0,
    reputationNoIssueRate: signals.noIssueRate, relevanceScore: 0, resultGroup: "recommended", sharedExperienceCount: signals.experienceCount, reviewCount: signals.reviewCount,
    serviceCategories: categories, serviceNames: strings(d.service_names), startingPrice: number(d.starting_price), state: string(d.state), uniqueCustomerCount: signals.uniqueCustomerCount,
    verifiedVisitCount: signals.verifiedVisitCount, createdAt: string(d.created_at), updatedAt: string(d.updated_at), publicDiscoveryPublishedAt: string(d.public_discovery_published_at), homeRank: 0, homeSection: "recommended",
  };
}

function mapItem(row: HydratedRow, candidate: SocialFeedCandidate, signals: ExploreDecisionSignals, status: SalonOperatingStatus, url: string): ExploreFeedItem | null {
  const d = record(row.document), post = record(row.post), personal = row.sourceType === "beauty_post", directory = row.sourceType === "directory";
  const reference = record(row.referencePost);
  const introduction = directory && UUID.test(string(reference.id) ?? "");
  const id = introduction ? string(reference.id) : string(row.contentId), salonId = string(d.salon_id), salonName = string(d.salon_name), profileId = string(row.profileId);
  if (!id || !UUID.test(id) || (personal && (!profileId || !UUID.test(profileId))) || (!personal && (!salonId || !salonName))) return null;
  const salon = salonId && salonName ? { city: string(d.city), href: `/explore/salons/${salonId}`, id: salonId, logoImageUrl: getSalonProfileMediaUrl(string(row.logoImagePath)), name: salonName, operatingStatus: status, state: string(d.state), trust: exploreFeedTrustFromDecisionSignals(signals) } : null;
  const publishedAt = (introduction ? string(reference.publishedAt) : string(row.publishedAt)) ?? "1970-01-01T00:00:00.000Z";
  const media = mapMedia(row.media, personal, url);
  const recommendation = directory ? directorySalon(row, signals, status) : null;
  if (directory) {
    if (!recommendation?.coverImageUrl) return null;
    media.push({ aspectRatio: 2.4, width: null, height: null, id: `salon-cover:${id}`, imageUrl: recommendation.coverImageUrl, layoutVariant: "landscape", role: "image" });
  }
  if (!media.length) return null;
  const contentType = personal ? "beauty_post" : directory ? introduction ? "update" : "salon_recommendation" : row.sourceType === "salon_profile_update" ? "update" : "look";
  const state = ["verified", "pending", "rejected", "unverified"].includes(String(post.verificationState)) ? post.verificationState as "verified" | "pending" | "rejected" | "unverified" : "unverified";
  const rawOption = record(row.booking);
  const option = Object.keys(rawOption).length ? mapContentBookingOptionRow(rawOption as Parameters<typeof mapContentBookingOptionRow>[0]) : null;
  const beauty = personal ? beautyPostBookingPresentation({ bookedCount: number(row.bookingCount) ?? 0, bookingEnabled: row.bookable === true, postId: id, salonId, salonName, verificationState: state, source: "explore" }) : null;
  const booking = personal ? beauty?.eligible ? { ...beauty, readiness: null, serviceId: null } : null : {
    bookedCount: 0, eligible: directory ? signals.bookingEnabled && Boolean(signals.bookingHref) : row.bookable === true && option?.bookingCtaEnabled === true && option.bookingEnabled === true && Boolean(option.bookingHref),
    href: directory ? normalizePublicBookingHref(signals.bookingHref) : option?.bookingHref ?? null, label: directory ? "Book" : option?.ctaLabel ?? "Book this look",
    readiness: directory ? null : option?.readinessState ?? null, salonId, salonName, serviceId: directory ? signals.bookableServiceId : option?.primaryServiceId ?? null,
  };
  if (booking && !booking.eligible) booking.href = null;
  const role = post.authorRole === "owner" || post.authorRole === "staff" ? post.authorRole : "salon";
  return {
    contentKey: candidate.contentKey, discoveryScope: candidate.scope, ...(recommendation ? { discoverySalon: recommendation } : {}), publishedAtKnown: !directory, platformIntroduction: introduction,
    salonAuthorRole: personal ? undefined : role, salonAuthorName: role === "staff" || role === "owner" ? string(post.authorName) : null, salonAuthorStaffId: role === "staff" ? string(post.authorStaffId) : null,
    author: personal ? { avatarUrl: safeHttpUrl(post.avatarUrl), id: profileId!, kind: "person", name: string(post.authorName) ?? "Reylumi customer" } : { avatarUrl: salon?.logoImageUrl ?? null, id: salonId!, kind: "salon", name: salonName! },
    booking, bookingMeta: { availabilityLabel: signals.nextAvailabilityLabel, distanceMiles: null, durationMinutes: option?.primaryServiceDurationMinutes ?? null, price: option?.primaryServiceBasePrice ?? recommendation?.startingPrice ?? null },
    caption: (introduction ? string(reference.caption) : string(post.caption)) ?? string(d.description), candidateClass: "organic", commentCount: number(introduction ? reference.commentCount : row.commentCount) ?? 0, contentId: id, contentType,
    destination: personal ? { href: `/explore/beauty/${profileId}/posts/${id}`, type: "personal-post" } : directory && !introduction ? { href: `/explore/salons/${id}`, type: "salon-profile" } : { href: `/explore/salons/${salonId}#${contentType}-${id}`, type: "salon-post" },
    feedKey: personal ? `personal:${id}` : directory && !introduction ? `salon:recommendation:${id}` : `salon:${contentType}:${id}`, id, media,
    personal: personal ? { postType: post.postType === "before_after" ? "before_after" : "regular", profileId: profileId! } : null, publishedAt,
    rankingSignals: { engagementVelocityScore: candidate.lane === "trending" ? Math.min(1, (candidate.score ?? 0) / 10) : 0, freshnessScore: directory ? 0 : 1 / (1 + Math.max(0, Date.now() - Date.parse(publishedAt)) / 86400000), locationAffinityScore: candidate.scope === "local" ? 1 : 0, qualityScore: 0, relevanceScore: candidate.lane === "personal" ? 1 : 0 },
    saveTarget: directory && !introduction ? null : { ...(salonId ? { salonId } : {}), saved: (introduction ? reference.saved : row.saved) === true, sourceId: id, sourceType: personal ? "beauty_post" : contentType === "update" ? "salon_profile_update" : "salon_profile_look" },
    salon, serviceCategory: string(post.serviceCategory) ?? strings(d.service_categories)[0] ?? null, serviceName: option?.primaryServiceName ?? string(post.serviceName) ?? recommendation?.featuredServiceName ?? null,
    sourceSortId: id, sourceType: personal ? "personal" : "salon", verification: personal ? { state } : null,
  };
}

async function hydrate(client: FeedClient, input: FeedInput, cursor: Cursor, candidates: SocialFeedCandidate[], timings?: FeedTimings) {
  if (!candidates.length) return [];
  const payload = await measure(timings, "selectedHydrationMs", () => rpc(client, "hydrate_explore_social_feed_items", { p_actor_key: input.visitorKey, p_cursor: cursor, p_keys: candidates.map(item => item.contentKey) }, input.signal));
  const rows = Array.isArray(payload) ? payload.map(record) : [];
  const salonIds = [...new Set(rows.flatMap(row => string(record(row.document).salon_id) ? [string(record(row.document).salon_id)!] : []))];
  const runner = async (name: string, args: Record<string, unknown>) => {
    if (input.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    const startedAt = Date.now();
    const query = client.rpc(name, args);
    try {
      const result = await (input.signal ? query.abortSignal(input.signal) : query);
      if (input.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
      return { data: result.data as unknown, error: result.error };
    } finally {
      if (timings) {
        timings.canonicalRpcCount += 1;
        // Function names are internal constants; arguments and identities are
        // deliberately absent from this performance telemetry.
        timings.canonicalRpcMs[name] = (timings.canonicalRpcMs[name] ?? 0) + Date.now() - startedAt;
      }
    }
  };
  const [signals, statuses] = await Promise.all([
    measure(timings, "decisionSignalsMs", () => getExploreDecisionSignalsBySalonId(runner, salonIds)),
    measure(timings, "operatingStatusMs", () => getPublicSalonOperatingStatusesBySalonId(salonIds, runner)),
  ]);
  const rowMap = new Map(rows.map(row => [string(row.contentKey), row]));
  return candidates.flatMap(candidate => {
    const row = rowMap.get(candidate.contentKey);
    if (!row) return [];
    const salonId = string(record(row.document).salon_id) ?? "";
    const currentCandidate = Object.keys(record(row.candidate)).length ? row.candidate as SocialFeedCandidate : candidate;
    const item = mapItem(row, currentCandidate, signals.get(salonId) ?? EMPTY_EXPLORE_DECISION_SIGNALS, operatingStatusFromMap(statuses, salonId), process.env.NEXT_PUBLIC_SUPABASE_URL!);
    return item ? [item] : [];
  });
}

export async function getExploreSocialFeedPage(input: FeedInput): Promise<ExploreFeedPage> {
  const startedAt = Date.now();
  const timings: FeedTimings = { selectMs: 0, queueMs: 0, pageMs: 0, hydrateMs: 0, totalMs: 0, candidateCount: 0, returnedItems: 0, canonicalRpcCount: 0, selectedHydrationMs: 0, decisionSignalsMs: 0, operatingStatusMs: 0, canonicalRpcMs: {} };
  try {
  const client = clientFor(input), filters = filtersFor(input);
  let cursor = decodeExploreSocialFeedCursor(input.cursor);
  if (!cursor) {
    const pool = await measure(timings, "selectMs", () => rpc(client, "get_explore_social_candidate_pool", { p_actor_key: input.visitorKey, p_filters: filters }, input.signal)) as SocialFeedPool;
    timings.candidateCount = Object.values(pool.lanes).reduce((count, lane) => count + lane.length, 0);
    const queueStartedAt = Date.now();
    const queue = buildExploreSocialFeedQueue(pool, filters.intent, 384, filters.query);
    timings.queueMs += Date.now() - queueStartedAt;
    const session = record(await measure(timings, "queueMs", () => rpc(client, "create_explore_social_feed_session", { p_actor_key: input.visitorKey, p_filters: filters, p_as_of: pool.asOf, p_region: pool.region, p_queue: queue }, input.signal)));
    const sessionId = string(session.id);
    if (!sessionId || !UUID.test(sessionId)) throw new Error("Discovery session could not be created.");
    cursor = { version: 1, session: sessionId, after: 0 };
  }
  const frozenCursor = cursor;
  const limit = Number.isFinite(input.limit) ? Math.min(12, Math.max(1, Math.floor(input.limit!))) : 12;
  const page = record(await measure(timings, "pageMs", () => rpc(client, "get_explore_social_feed_page", { p_actor_key: input.visitorKey, p_filters: filters, p_cursor: frozenCursor, p_limit: limit }, input.signal)));
  const persistent = record(page.cursor) as unknown as Cursor;
  const sessionCursor = encode(persistent);
  const candidates = (Array.isArray(page.keys) ? page.keys : []) as SocialFeedCandidate[];
  const items = await measure(timings, "hydrateMs", () => hydrate(client, input, persistent, candidates.slice(0, 20), timings));
  timings.returnedItems = items.length;
  const scopes = new Set(items.map(item => item.discoveryScope));
  return { error: null, items, hasMore: page.hasMore === true, nextCursor: page.hasMore === true ? sessionCursor : null, sessionCursor,
    asOf: string(page.asOf) ?? undefined, newestPublishedAt: string(page.newestPublishedAt), scope: scopes.size > 1 ? "mixed" : scopes.has("local") ? "local" : "wider" };
  } finally {
    timings.totalMs = Date.now() - startedAt;
    console.info?.("Explore social feed timing", timings);
  }
}

export async function getExploreSocialFeedUpdates(input: FeedInput) {
  const cursor = decodeExploreSocialFeedCursor(input.cursor);
  if (!cursor) return { error: null, hasNewPosts: false, newestPublishedAt: null };
  const result = record(await rpc(clientFor(input), "get_explore_social_feed_updates", { p_actor_key: input.visitorKey, p_filters: filtersFor(input), p_cursor: cursor }, input.signal));
  return { error: null, hasNewPosts: result.hasNewPosts === true, newestPublishedAt: string(result.newestPublishedAt) };
}

export async function recordExploreSocialEvents(input: Omit<FeedInput, "discovery"> & { events: unknown[] }) {
  const cursor = decodeExploreSocialFeedCursor(input.cursor);
  if (!cursor) return { error: null, accepted: 0 };
  const events = input.events.slice(0, 20).flatMap(raw => {
    const event = record(raw), contentKey = string(event.contentKey);
    if (!contentKey || contentKey.length > 160 || !["meaningful_view", "profile_view", "share"].includes(String(event.kind))) return [];
    const rawRatio = event.visibleRatio ?? event.ratio;
    const elapsed = typeof event.elapsedMs === "number" && Number.isFinite(event.elapsedMs) ? event.elapsedMs : null;
    const ratio = typeof rawRatio === "number" && Number.isFinite(rawRatio) ? rawRatio : null;
    if (event.kind === "meaningful_view" && (elapsed === null || elapsed < 2000 || ratio === null || ratio < .5 || ratio > 1)) return [];
    return [{ contentKey, kind: event.kind, elapsedMs: elapsed, ratio }];
  });
  const accepted = await rpc(clientFor(input), "record_explore_social_events", { p_actor_key: input.visitorKey, p_cursor: cursor, p_events: events }, input.signal);
  return { error: null, accepted: number(accepted) ?? 0 };
}

export async function validateExploreSocialFeedItems(input: Omit<FeedInput, "discovery"> & { contentKeys: string[]; revisions?: ExploreFeedRevision[] }) {
  const cursor = decodeExploreSocialFeedCursor(input.cursor);
  if (!cursor) return { error: null, contentKeys: [], items: [] };
  const client = clientFor(input), keys = [...new Set(input.contentKeys.filter(key => key.length <= 160))].slice(0, 120);
  const allowed = strings(await rpc(client, "validate_explore_social_feed_items", { p_actor_key: input.visitorKey, p_cursor: cursor, p_keys: keys }, input.signal));
  // Validation rehydrates cached public payloads so edits/removals cannot restore
  // old media, prices, booking CTAs or personal attribution from sessionStorage.
  const chunks = Array.from({ length: Math.ceil(allowed.length / 20) }, (_, index) => allowed.slice(index * 20, (index + 1) * 20));
  const items = (await Promise.all(chunks.map(chunk => hydrate(client, input, cursor, chunk.map(contentKey => ({ contentKey, contentId: contentKey.split(":")[1], sourceType: contentKey.split(":")[0] as SocialFeedCandidate["sourceType"], salonId: null, publishedAt: null, lane: "expanded", scope: "wider" })))))).flat();
  const known = new Map((input.revisions ?? []).slice(0, 120).filter(row => typeof row.contentKey === "string" && /^[0-9a-f]{64}$/.test(row.revision)).map(row => [row.contentKey, row.revision]));
  const unchangedKeys: string[] = [];
  const changedItems = items.filter(item => {
    const key = item.contentKey!;
    if (!known.has(key) || createHash("sha256").update(serializeExploreFeedItem(item)).digest("hex") !== known.get(key)) return true;
    unchangedKeys.push(key);
    return false;
  });
  // Visibility, ownership and mutable fields were checked above, even when the
  // response can reuse the exact payload already on this viewer's device.
  return { error: null, contentKeys: items.map(item => item.contentKey!), items: changedItems, unchangedKeys };
}
