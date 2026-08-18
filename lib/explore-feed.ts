import "server-only";

import { getExploreHomeContent } from "@/lib/explore-home";
import { getExploreInspirationPage } from "@/lib/explore-inspiration";
import { getExplorePersonalPostPage } from "@/lib/explore-personal";
import { Buffer } from "node:buffer";
import type {
  ExploreFeedCursor,
  ExploreFeedItem,
  ExploreFeedMedia,
  ExploreFeedPage,
  ExploreFeedRankingSignals,
  ExploreHomeContent,
  ExploreHomeSalon,
  ExploreInspirationCursor,
  ExploreInspirationItem,
  ExploreInspirationPage,
  ExplorePersonalPostCursor,
  ExplorePersonalPostPage,
} from "@/types/explore";

const EXPLORE_FEED_PAGE_SIZE = 12;
const EXPLORE_FEED_MAX_PAGE_SIZE = 18;
const EXPLORE_FEED_CURSOR_VERSION = 3;
const EXPLORE_FEED_RECOMMENDATION_LIMIT = 1;
const MS_PER_DAY = 86400000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORGANIC_RANKING_WEIGHTS = {
  engagementVelocity: 0,
  freshness: 0.42,
  locationAffinity: 0.1,
  quality: 0.28,
  relevance: 0.2,
} as const;

type ExploreFeedRecommendationCursor = {
  rank: number;
  salonId: string;
};

type ExploreFeedInternalSource = "personal" | "recommendation" | "salon";

type ExploreFeedSourceCursors = {
  personal: ExplorePersonalPostCursor | null;
  recommendation: ExploreFeedRecommendationCursor | null;
  salon: ExploreInspirationCursor | null;
};

type ExploreFeedSourceCompletion = {
  personal: boolean;
  recommendation: boolean;
  salon: boolean;
};

type ExploreFeedSourceState = ExploreFeedSourceCursors & {
  completed: ExploreFeedSourceCompletion;
};

type ExploreFeedCursorPayload = ExploreFeedSourceState & {
  version: typeof EXPLORE_FEED_CURSOR_VERSION;
};

type RecommendationSourcePage = {
  error: string | null;
  hasMore: boolean;
  items: ExploreHomeSalon[];
  nextCursor: ExploreFeedRecommendationCursor | null;
};

type FeedCandidate = {
  authorKey: string;
  cursor:
    | ExploreFeedRecommendationCursor
    | ExploreInspirationCursor
    | ExplorePersonalPostCursor;
  entityKey: string;
  item: ExploreFeedItem;
  rankingScore: number;
  source: ExploreFeedInternalSource;
};

type FeedCandidateSources = Record<ExploreFeedInternalSource, FeedCandidate[]>;
type FeedSourceCounts = Record<ExploreFeedInternalSource, number>;

const FEED_SOURCES: ExploreFeedInternalSource[] = [
  "personal",
  "salon",
  "recommendation",
];

function emptyFeedPage(error: string | null = null): ExploreFeedPage {
  return {
    error,
    hasMore: false,
    items: [],
    nextCursor: null,
  };
}

function emptyInspirationSourcePage(): ExploreInspirationPage {
  return {
    error: null,
    hasMore: false,
    items: [],
    nextCursor: null,
  };
}

function emptyPersonalSourcePage(): ExplorePersonalPostPage {
  return {
    error: null,
    hasMore: false,
    items: [],
    nextCursor: null,
  };
}

function emptyRecommendationSourcePage(): RecommendationSourcePage {
  return {
    error: null,
    hasMore: false,
    items: [],
    nextCursor: null,
  };
}

function emptySourceState(): ExploreFeedSourceState {
  return {
    completed: {
      personal: false,
      recommendation: false,
      salon: false,
    },
    personal: null,
    recommendation: null,
    salon: null,
  };
}

function normalizeLimit(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return EXPLORE_FEED_PAGE_SIZE;
  }

  return Math.min(EXPLORE_FEED_MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSalonCursor(value: unknown): ExploreInspirationCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const mediaId = payload.mediaId;
  const publishedAt = normalizeDate(payload.publishedAt);

  if (typeof mediaId !== "string" || !UUID_PATTERN.test(mediaId) || !publishedAt) {
    return null;
  }

  return {
    mediaId,
    publishedAt,
  };
}

function normalizePersonalCursor(value: unknown): ExplorePersonalPostCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const postId = payload.postId;
  const createdAt = normalizeDate(payload.createdAt);

  if (typeof postId !== "string" || !UUID_PATTERN.test(postId) || !createdAt) {
    return null;
  }

  return {
    createdAt,
    postId,
  };
}

function normalizeRecommendationCursor(
  value: unknown,
): ExploreFeedRecommendationCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const salonId = payload.salonId;
  const rank = payload.rank;

  if (
    typeof salonId !== "string" ||
    !UUID_PATTERN.test(salonId) ||
    typeof rank !== "number" ||
    !Number.isInteger(rank) ||
    rank < 1
  ) {
    return null;
  }

  return {
    rank,
    salonId,
  };
}

function normalizeCompletion(value: unknown): ExploreFeedSourceCompletion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      personal: false,
      recommendation: false,
      salon: false,
    };
  }

  const payload = value as Record<string, unknown>;

  return {
    personal: payload.personal === true,
    recommendation: payload.recommendation === true,
    salon: payload.salon === true,
  };
}

function normalizeFeedCursorPayload(value: unknown): ExploreFeedSourceState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;

  if (payload.version !== EXPLORE_FEED_CURSOR_VERSION && payload.version !== 2) {
    return null;
  }

  return {
    completed:
      payload.version === EXPLORE_FEED_CURSOR_VERSION
        ? normalizeCompletion(payload.completed)
        : {
            personal: false,
            recommendation: false,
            salon: false,
          },
    personal: normalizePersonalCursor(payload.personal),
    recommendation: normalizeRecommendationCursor(payload.recommendation),
    salon: normalizeSalonCursor(payload.salon),
  };
}

function normalizeSourceState(
  state: ExploreFeedSourceState | null | undefined,
): ExploreFeedSourceState {
  return {
    completed: {
      personal: state?.completed.personal === true,
      recommendation: state?.completed.recommendation === true,
      salon: state?.completed.salon === true,
    },
    personal: normalizePersonalCursor(state?.personal),
    recommendation: normalizeRecommendationCursor(state?.recommendation),
    salon: normalizeSalonCursor(state?.salon),
  };
}

function allSourcesCompleted(state: ExploreFeedSourceState) {
  return FEED_SOURCES.every((source) => state.completed[source]);
}

function hasAnyCursor(state: ExploreFeedSourceState) {
  return Boolean(state.personal || state.recommendation || state.salon);
}

function hasAnyCompletion(state: ExploreFeedSourceState) {
  return FEED_SOURCES.some((source) => state.completed[source]);
}

export function encodeExploreFeedCursor(
  state: ExploreFeedSourceState | null,
): ExploreFeedCursor | null {
  const normalizedState = normalizeSourceState(state);

  if (allSourcesCompleted(normalizedState)) {
    return null;
  }

  if (!hasAnyCursor(normalizedState) && !hasAnyCompletion(normalizedState)) {
    return null;
  }

  const payload: ExploreFeedCursorPayload = {
    completed: normalizedState.completed,
    personal: normalizedState.personal,
    recommendation: normalizedState.recommendation,
    salon: normalizedState.salon,
    version: EXPLORE_FEED_CURSOR_VERSION,
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeExploreFeedCursor(
  cursor: ExploreFeedCursor | null | undefined,
): ExploreFeedSourceState {
  const emptyCursor = emptySourceState();
  const value = cursor?.trim();

  if (!value) {
    return emptyCursor;
  }

  try {
    return (
      normalizeFeedCursorPayload(
        JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
      ) ?? emptyCursor
    );
  } catch {
    return emptyCursor;
  }
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function freshnessScore(value: string | null | undefined, horizonDays = 45) {
  const publishedAt = value ? new Date(value).getTime() : NaN;

  if (!Number.isFinite(publishedAt)) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - publishedAt) / MS_PER_DAY);

  return clampScore(1 - ageDays / horizonDays);
}

function normalizedCountScore(value: number, max: number) {
  return clampScore(value / max);
}

function weightedRankingScore(signals: ExploreFeedRankingSignals) {
  return (
    signals.freshnessScore * ORGANIC_RANKING_WEIGHTS.freshness +
    signals.qualityScore * ORGANIC_RANKING_WEIGHTS.quality +
    signals.relevanceScore * ORGANIC_RANKING_WEIGHTS.relevance +
    signals.locationAffinityScore * ORGANIC_RANKING_WEIGHTS.locationAffinity +
    signals.engagementVelocityScore *
      ORGANIC_RANKING_WEIGHTS.engagementVelocity
  );
}

function rankingSignalsForSalonContent(
  item: ExploreInspirationItem,
): ExploreFeedRankingSignals {
  return {
    engagementVelocityScore: 0,
    freshnessScore: freshnessScore(item.publishedAt),
    locationAffinityScore: item.salonCity || item.salonState ? 0.2 : 0,
    qualityScore: clampScore(
      0.42 +
        (item.aspectRatio ? 0.1 : 0) +
        (item.serviceName || item.serviceCategory ? 0.14 : 0) +
        (item.bookingEnabled ? 0.1 : 0),
    ),
    relevanceScore: clampScore(
      0.42 +
        (item.serviceName ? 0.14 : 0) +
        (item.serviceCategory ? 0.1 : 0) +
        (item.bookingEnabled ? 0.08 : 0),
    ),
  };
}

function rankingSignalsForPersonalContent(
  item: ExploreFeedItem,
): ExploreFeedRankingSignals {
  const mediaCount = item.media.length;
  const hasTransformationPair =
    item.personal?.postType === "before_after" &&
    item.media.some((media) => media.role === "before") &&
    item.media.some((media) => media.role === "after");

  return {
    engagementVelocityScore: 0,
    freshnessScore: freshnessScore(item.publishedAt),
    locationAffinityScore: item.salon ? 0.25 : 0,
    qualityScore: clampScore(
      0.36 +
        (hasTransformationPair ? 0.34 : 0) +
        (mediaCount > 1 ? 0.12 : 0) +
        (item.serviceName || item.serviceCategory ? 0.08 : 0),
    ),
    relevanceScore: clampScore(
      0.42 +
        (item.serviceName ? 0.14 : 0) +
        (item.serviceCategory ? 0.08 : 0),
    ),
  };
}

function rankingSignalsForRecommendation(
  salon: ExploreHomeSalon,
  publishedAt: string,
): ExploreFeedRankingSignals {
  const ratingScore =
    salon.averageRating !== null && salon.reviewCount > 0
      ? clampScore((salon.averageRating - 1) / 4)
      : 0;
  const reviewScore = normalizedCountScore(salon.reviewCount, 40);
  const distanceScore =
    salon.distanceMiles === null
      ? 0
      : clampScore(1 - Math.min(50, salon.distanceMiles) / 50);

  return {
    engagementVelocityScore: 0,
    freshnessScore: freshnessScore(publishedAt, 90),
    locationAffinityScore: distanceScore,
    qualityScore: clampScore(
      salon.profileCompleteness / 100 * 0.4 +
        ratingScore * 0.22 +
        reviewScore * 0.12 +
        (salon.coverImageUrl ? 0.16 : 0) +
        normalizedCountScore(salon.activeServiceCount, 12) * 0.1,
    ),
    relevanceScore: clampScore(
      normalizedCountScore(salon.relevanceScore, 100) * 0.45 +
        (salon.bookingEnabled ? 0.16 : 0) +
        (salon.bookableServiceName ||
        salon.featuredServiceName ||
        salon.featuredServiceCategory
          ? 0.16
          : 0) +
        (salon.hasPublicProfile ? 0.14 : 0),
    ),
  };
}

function salonPostHref(item: ExploreInspirationItem) {
  return item.salonHref
    ? `${item.salonHref}#${item.contentType}-${item.contentId}`
    : null;
}

function mapSalonMedia(item: ExploreInspirationItem): ExploreFeedMedia {
  return {
    aspectRatio: item.aspectRatio,
    height: item.imageHeight,
    id: item.mediaId,
    imageUrl: item.imageUrl,
    layoutVariant: item.layoutVariant,
    role: "image",
    width: item.imageWidth,
  };
}

function mapSalonFeedItem(item: ExploreInspirationItem): ExploreFeedItem {
  const authorName =
    item.authorIsAnonymous || !item.authorDisplayName
      ? item.salonName
      : item.authorDisplayName;

  return {
    author: {
      avatarUrl: null,
      id: item.salonId,
      kind: "salon",
      name: authorName,
    },
    booking: {
      bookedCount: 0,
      eligible: item.bookingEnabled === true && Boolean(item.bookingHref),
      href: item.bookingHref,
      label: item.bookingLabel,
      readiness: item.bookingReadiness,
      salonId: item.salonId,
      salonName: item.salonName,
      serviceId: item.bookableServiceId,
    },
    candidateClass: "organic",
    caption: item.captionExcerpt,
    contentId: item.contentId,
    contentType: item.contentType,
    destination: {
      href: salonPostHref(item),
      type: "salon-post",
    },
    feedKey: `salon:${item.contentType}:${item.contentId}`,
    id: item.contentId,
    media: [mapSalonMedia(item)],
    personal: null,
    publishedAt: item.publishedAt,
    rankingSignals: rankingSignalsForSalonContent(item),
    salon: {
      city: item.salonCity,
      href: item.salonHref,
      id: item.salonId,
      name: item.salonName,
      state: item.salonState,
    },
    serviceCategory: item.serviceCategory,
    serviceName: item.serviceName,
    sourceSortId: item.mediaId,
    sourceType: "salon",
    verification: null,
  };
}

function recommendationPublishedAt(salon: ExploreHomeSalon) {
  for (const value of [
    salon.latestMediaCreatedAt,
    salon.publicDiscoveryPublishedAt,
    salon.updatedAt,
    salon.createdAt,
  ]) {
    const normalized = normalizeDate(value);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function recommendationServiceName(salon: ExploreHomeSalon) {
  return (
    salon.bookableServiceName ??
    salon.featuredServiceName ??
    salon.serviceNames[0] ??
    null
  );
}

function recommendationServiceCategory(salon: ExploreHomeSalon) {
  return salon.featuredServiceCategory ?? salon.serviceCategories[0] ?? null;
}

function recommendationCaption(salon: ExploreHomeSalon) {
  const description = salon.description?.trim();

  if (!description) {
    return null;
  }

  return description.length > 180
    ? `${description.slice(0, 177).trimEnd()}...`
    : description;
}

function mapRecommendationFeedItem(
  salon: ExploreHomeSalon,
  rank: number,
): ExploreFeedItem | null {
  const publishedAt = recommendationPublishedAt(salon);
  const profileHref =
    UUID_PATTERN.test(salon.id) && salon.hasPublicProfile
      ? `/explore/salons/${encodeURIComponent(salon.id)}`
      : null;

  if (!publishedAt || !profileHref || !salon.coverImageUrl) {
    return null;
  }

  return {
    author: {
      avatarUrl: null,
      id: salon.id,
      kind: "salon",
      name: salon.name,
    },
    booking: {
      bookedCount: 0,
      eligible: salon.bookingEnabled === true && Boolean(salon.bookingHref),
      href: salon.bookingEnabled ? salon.bookingHref : null,
      label: "Book",
      readiness: null,
      salonId: salon.id,
      salonName: salon.name,
      serviceId: salon.bookableServiceId,
    },
    candidateClass: "organic",
    caption: recommendationCaption(salon),
    contentId: salon.id,
    contentType: "salon_recommendation",
    destination: {
      href: profileHref,
      type: "salon-profile",
    },
    feedKey: `salon:recommendation:${salon.id}`,
    id: salon.id,
    media: [
      {
        aspectRatio: null,
        height: null,
        id: `salon-cover:${salon.id}`,
        imageUrl: salon.coverImageUrl,
        layoutVariant: "landscape",
        role: "image",
        width: null,
      },
    ],
    personal: null,
    publishedAt,
    rankingSignals: rankingSignalsForRecommendation(salon, publishedAt),
    salon: {
      city: salon.city,
      href: profileHref,
      id: salon.id,
      name: salon.name,
      state: salon.state,
    },
    serviceCategory: recommendationServiceCategory(salon),
    serviceName: recommendationServiceName(salon),
    sourceSortId: `${String(rank).padStart(4, "0")}:${salon.id}`,
    sourceType: "salon",
    verification: null,
  };
}

function rankRecommendationSalons(content: ExploreHomeContent) {
  const byId = new Map<string, ExploreHomeSalon>();

  for (const salon of [...content.recommendedSalons, ...content.newSalons]) {
    if (!byId.has(salon.id)) {
      byId.set(salon.id, salon);
    }
  }

  return [...byId.values()]
    .filter((salon) => salon.hasPublicProfile && Boolean(salon.coverImageUrl))
    .sort((left, right) => {
      const leftPublishedAt = recommendationPublishedAt(left);
      const rightPublishedAt = recommendationPublishedAt(right);
      const leftScore = leftPublishedAt
        ? weightedRankingScore(rankingSignalsForRecommendation(left, leftPublishedAt))
        : -1;
      const rightScore = rightPublishedAt
        ? weightedRankingScore(rankingSignalsForRecommendation(right, rightPublishedAt))
        : -1;

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return left.id.localeCompare(right.id);
    })
    .slice(0, EXPLORE_FEED_RECOMMENDATION_LIMIT);
}

async function getRecommendationSourcePage(input: {
  cursor: ExploreFeedRecommendationCursor | null;
  homeContent?: ExploreHomeContent;
}): Promise<RecommendationSourcePage> {
  if (input.cursor) {
    return emptyRecommendationSourcePage();
  }

  const content = input.homeContent ?? (await getExploreHomeContent());

  if (content.error) {
    return emptyRecommendationSourcePage();
  }

  return {
    error: null,
    hasMore: false,
    items: rankRecommendationSalons(content),
    nextCursor: null,
  };
}

function feedEntityKey(item: ExploreFeedItem) {
  if (item.salon?.id) {
    return `salon:${item.salon.id}`;
  }

  if (item.sourceType === "personal") {
    return `personal:${item.personal?.profileId ?? item.author.id}`;
  }

  return `salon:${item.salon?.id ?? item.author.id}`;
}

function feedAuthorKey(item: ExploreFeedItem) {
  return `${item.author.kind}:${item.author.id}`;
}

function compareNaturalCandidateOrder(left: FeedCandidate, right: FeedCandidate) {
  const leftTime = new Date(left.item.publishedAt).getTime();
  const rightTime = new Date(right.item.publishedAt).getTime();

  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  if (left.item.sourceType !== right.item.sourceType) {
    return left.item.sourceType === "personal" ? -1 : 1;
  }

  return right.item.sourceSortId.localeCompare(left.item.sourceSortId);
}

function sourceRunLength(candidates: FeedCandidate[], sourceType: string) {
  let count = 0;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (candidates[index]?.item.sourceType !== sourceType) {
      break;
    }

    count += 1;
  }

  return count;
}

function entityRunLength(candidates: FeedCandidate[], entityKey: string) {
  let count = 0;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (candidates[index]?.entityKey !== entityKey) {
      break;
    }

    count += 1;
  }

  return count;
}

function authorRunLength(candidates: FeedCandidate[], authorKey: string) {
  let count = 0;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (candidates[index]?.authorKey !== authorKey) {
      break;
    }

    count += 1;
  }

  return count;
}

function diversityAdjustedScore(input: {
  availableCount: number;
  candidate: FeedCandidate;
  selected: FeedCandidate[];
}) {
  if (input.availableCount <= 1 || input.selected.length === 0) {
    return input.candidate.rankingScore;
  }

  const sourceRun = sourceRunLength(
    input.selected,
    input.candidate.item.sourceType,
  );
  const entityRun = entityRunLength(input.selected, input.candidate.entityKey);
  const authorRun = authorRunLength(input.selected, input.candidate.authorKey);

  return (
    input.candidate.rankingScore -
    (sourceRun >= 1 ? 0.08 : 0) -
    (sourceRun >= 2 ? 0.58 : 0) -
    (entityRun >= 1 ? 1.05 : 0) -
    (entityRun >= 2 ? 0.6 : 0) -
    (authorRun >= 1 ? 0.36 : 0)
  );
}

function compareSelectableCandidates(input: {
  availableCount: number;
  left: FeedCandidate;
  right: FeedCandidate;
  selected: FeedCandidate[];
}) {
  const leftScore = diversityAdjustedScore({
    availableCount: input.availableCount,
    candidate: input.left,
    selected: input.selected,
  });
  const rightScore = diversityAdjustedScore({
    availableCount: input.availableCount,
    candidate: input.right,
    selected: input.selected,
  });

  if (Math.abs(leftScore - rightScore) > 0.00001) {
    return rightScore - leftScore;
  }

  if (Math.abs(input.left.rankingScore - input.right.rankingScore) > 0.00001) {
    return input.right.rankingScore - input.left.rankingScore;
  }

  return compareNaturalCandidateOrder(input.left, input.right);
}

function selectVisibleCandidates(input: {
  pageSize: number;
  sources: FeedCandidateSources;
}) {
  const consumed: FeedSourceCounts = {
    personal: 0,
    recommendation: 0,
    salon: 0,
  };
  const selected: FeedCandidate[] = [];

  while (selected.length < input.pageSize) {
    const available = FEED_SOURCES.map(
      (source) => input.sources[source][consumed[source]],
    ).filter((candidate): candidate is FeedCandidate => Boolean(candidate));

    if (available.length === 0) {
      break;
    }

    const nextCandidate = available.reduce((best, candidate) =>
      compareSelectableCandidates({
        availableCount: available.length,
        left: candidate,
        right: best,
        selected,
      }) < 0
        ? candidate
        : best,
    );

    selected.push(nextCandidate);
    consumed[nextCandidate.source] += 1;
  }

  return {
    consumed,
    selected,
  };
}

function buildNextCursor(input: {
  completed: ExploreFeedSourceCompletion;
  current: ExploreFeedSourceState;
  visibleCandidates: FeedCandidate[];
}) {
  const next: ExploreFeedSourceState = {
    completed: input.completed,
    personal: input.current.personal,
    recommendation: input.current.recommendation,
    salon: input.current.salon,
  };

  for (const candidate of input.visibleCandidates) {
    if (candidate.source === "salon") {
      next.salon = candidate.cursor as ExploreInspirationCursor;
    } else if (candidate.source === "personal") {
      next.personal = candidate.cursor as ExplorePersonalPostCursor;
    } else {
      next.recommendation = candidate.cursor as ExploreFeedRecommendationCursor;
    }
  }

  return next;
}

function sourceCompleted(input: {
  consumedCount: number;
  hasMore: boolean;
  hasUnconsumedCandidates: boolean;
  itemCount: number;
  wasCompleted: boolean;
}) {
  if (input.wasCompleted) {
    return true;
  }

  if (input.hasUnconsumedCandidates) {
    return false;
  }

  return !(
    input.hasMore &&
    input.itemCount > 0 &&
    input.consumedCount === input.itemCount
  );
}

function rankedFeedCandidate(input: {
  cursor:
    | ExploreFeedRecommendationCursor
    | ExploreInspirationCursor
    | ExplorePersonalPostCursor;
  item: ExploreFeedItem;
  source: ExploreFeedInternalSource;
}): FeedCandidate {
  const item =
    input.source === "personal"
      ? {
          ...input.item,
          rankingSignals: rankingSignalsForPersonalContent(input.item),
        }
      : input.item;

  return {
    authorKey: feedAuthorKey(item),
    cursor: input.cursor,
    entityKey: feedEntityKey(item),
    item,
    rankingScore: weightedRankingScore(item.rankingSignals),
    source: input.source,
  };
}

export async function getExploreFeedPage(input: {
  cursor?: ExploreFeedCursor | null;
  homeContent?: ExploreHomeContent;
  limit?: number;
} = {}): Promise<ExploreFeedPage> {
  const pageSize = normalizeLimit(input.limit);
  const sourceState = decodeExploreFeedCursor(input.cursor);
  const initialSalonPage =
    !sourceState.completed.salon && !sourceState.salon
      ? input.homeContent?.inspiration ?? null
      : null;
  const [salonPage, personalPage, recommendationPage] = await Promise.all([
    sourceState.completed.salon
      ? Promise.resolve(emptyInspirationSourcePage())
      : initialSalonPage
        ? Promise.resolve(initialSalonPage)
        : getExploreInspirationPage({
            cursor: sourceState.salon,
            diversify: false,
            pageSize,
          }),
    sourceState.completed.personal
      ? Promise.resolve(emptyPersonalSourcePage())
      : getExplorePersonalPostPage({
          cursor: sourceState.personal,
          pageSize,
        }),
    sourceState.completed.recommendation
      ? Promise.resolve(emptyRecommendationSourcePage())
      : getRecommendationSourcePage({
          cursor: sourceState.recommendation,
          homeContent: input.homeContent,
        }),
  ]);

  if (salonPage.error || personalPage.error) {
    return emptyFeedPage(salonPage.error ?? personalPage.error);
  }

  const salonCandidates = salonPage.items.map((item) =>
    rankedFeedCandidate({
      cursor: {
        mediaId: item.mediaId,
        publishedAt: item.publishedAt,
      },
      item: mapSalonFeedItem(item),
      source: "salon",
    }),
  );
  const personalCandidates = personalPage.items.map((item) =>
    rankedFeedCandidate({
      cursor: {
        createdAt: item.publishedAt,
        postId: item.id,
      },
      item,
      source: "personal",
    }),
  );
  const recommendationCandidates = recommendationPage.items
    .map((salon, index) => {
      const rank = index + 1;
      const item = mapRecommendationFeedItem(salon, rank);

      return item
        ? rankedFeedCandidate({
            cursor: {
              rank,
              salonId: salon.id,
            },
            item,
            source: "recommendation",
          })
        : null;
    })
    .filter((candidate): candidate is FeedCandidate => Boolean(candidate));
  const sources: FeedCandidateSources = {
    personal: personalCandidates,
    recommendation: recommendationCandidates,
    salon: salonCandidates,
  };
  const { consumed, selected } = selectVisibleCandidates({
    pageSize,
    sources,
  });
  const completed: ExploreFeedSourceCompletion = {
    personal: sourceCompleted({
      consumedCount: consumed.personal,
      hasMore: personalPage.hasMore,
      hasUnconsumedCandidates: consumed.personal < personalCandidates.length,
      itemCount: personalPage.items.length,
      wasCompleted: sourceState.completed.personal,
    }),
    recommendation: sourceCompleted({
      consumedCount: consumed.recommendation,
      hasMore: recommendationPage.hasMore,
      hasUnconsumedCandidates:
        consumed.recommendation < recommendationCandidates.length,
      itemCount: recommendationPage.items.length,
      wasCompleted: sourceState.completed.recommendation,
    }),
    salon: sourceCompleted({
      consumedCount: consumed.salon,
      hasMore: salonPage.hasMore,
      hasUnconsumedCandidates: consumed.salon < salonCandidates.length,
      itemCount: salonPage.items.length,
      wasCompleted: sourceState.completed.salon,
    }),
  };
  const hasUnconsumedCandidates = FEED_SOURCES.some(
    (source) => consumed[source] < sources[source].length,
  );
  const hasIncompleteSource = FEED_SOURCES.some((source) => !completed[source]);
  const hasMore =
    selected.length > 0 && (hasUnconsumedCandidates || hasIncompleteSource);
  const nextCursor = hasMore
    ? encodeExploreFeedCursor(
        buildNextCursor({
          completed,
          current: sourceState,
          visibleCandidates: selected,
        }),
      )
    : null;

  return {
    error: null,
    hasMore: Boolean(nextCursor),
    items: selected.map((candidate) => candidate.item),
    nextCursor,
  };
}
