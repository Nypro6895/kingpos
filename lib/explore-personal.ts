import "server-only";

import {
  beautyPostBookingPresentation,
} from "@/lib/beauty-booking-verification";
import { loadBeautyPostVerifiedBookingCounts } from "@/lib/beauty-post-booking-counts";
import { getBeautyMediaPublicUrl } from "@/lib/beauty-media";
import {
  createSupabaseServerClient,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import type {
  ExploreFeedMedia,
  ExploreFeedRankingSignals,
  ExploreFeedVerificationState,
  ExploreInspirationLayoutVariant,
  ExplorePersonalPostCursor,
  ExplorePersonalPostItem,
  ExplorePersonalPostPage,
} from "@/types/explore";

const EXPLORE_PERSONAL_PAGE_SIZE = 18;
const EXPLORE_PERSONAL_MAX_PAGE_SIZE = 24;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcError = {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
};

type RpcRunner = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: RpcError | null;
  status?: number;
  statusText?: string;
}>;

type ExplorePersonalMediaRow = {
  displayOrder?: number | string | null;
  height?: number | string | null;
  id?: string | null;
  mimeType?: string | null;
  objectPath?: string | null;
  role?: string | null;
  width?: number | string | null;
};

type ExplorePersonalPostRow = {
  author_avatar_url: string | null;
  author_display_name: string | null;
  caption_excerpt: string | null;
  created_at: string | null;
  media: unknown;
  post_id: string;
  post_type: string | null;
  profile_id: string;
  booking_enabled: boolean | null;
  salon_city: string | null;
  salon_href: string | null;
  salon_id: string | null;
  salon_name: string | null;
  salon_state: string | null;
  service_category: string | null;
  service_name: string | null;
  verification_state: string | null;
};

function emptyPersonalPostPage(error: string | null = null): ExplorePersonalPostPage {
  return {
    error,
    hasMore: false,
    items: [],
    nextCursor: null,
  };
}

function cleanString(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function readNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readInteger(value: number | string | null | undefined) {
  const parsed = readNumber(value);

  return parsed === null ? null : Math.max(1, Math.round(parsed));
}

function normalizePageSize(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return EXPLORE_PERSONAL_PAGE_SIZE;
  }

  return Math.min(EXPLORE_PERSONAL_MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

function normalizeCursor(
  cursor: ExplorePersonalPostCursor | null | undefined,
): ExplorePersonalPostCursor | null {
  if (!cursor || !UUID_PATTERN.test(cursor.postId)) {
    return null;
  }

  const date = new Date(cursor.createdAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    createdAt: date.toISOString(),
    postId: cursor.postId,
  };
}

function layoutVariantFromRatio(
  ratio: number | null,
): ExploreInspirationLayoutVariant {
  if (ratio === null) {
    return "portrait";
  }

  if (ratio >= 1.2) {
    return "landscape";
  }

  if (ratio <= 0.82) {
    return "portrait";
  }

  return "square";
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function freshnessScore(value: string) {
  const publishedAt = new Date(value).getTime();

  if (!Number.isFinite(publishedAt)) {
    return 0;
  }

  const ageDays = Math.max(0, (Date.now() - publishedAt) / 86400000);

  return Math.max(0, Math.min(1, 1 - ageDays / 45));
}

function rankingSignalsForPersonalPost(input: {
  mediaCount: number;
  postType: "before_after" | "regular";
  publishedAt: string;
  salonId: string | null;
  serviceName: string | null;
}): ExploreFeedRankingSignals {
  const hasTransformationPair = input.postType === "before_after" && input.mediaCount >= 2;

  return {
    engagementVelocityScore: 0,
    freshnessScore: freshnessScore(input.publishedAt),
    locationAffinityScore: input.salonId ? 0.25 : 0,
    qualityScore: Math.min(
      1,
      0.36 +
        (hasTransformationPair ? 0.34 : 0) +
        (input.mediaCount > 1 ? 0.12 : 0) +
        (input.serviceName ? 0.1 : 0),
    ),
    relevanceScore: Math.min(1, 0.42 + (input.serviceName ? 0.16 : 0)),
  };
}

function diagnosticString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function supabaseErrorDiagnostics(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};

  return {
    code: diagnosticString(record.code),
    details: diagnosticString(record.details),
    hint: diagnosticString(record.hint),
    message:
      diagnosticString(record.message) ??
      (error instanceof Error ? error.message : null),
  };
}

function diagnosticJson(value: Record<string, unknown>) {
  return JSON.stringify(value);
}

function verificationState(
  value: string | null | undefined,
): ExploreFeedVerificationState | null {
  if (
    value === "pending" ||
    value === "rejected" ||
    value === "unverified" ||
    value === "verified"
  ) {
    return value;
  }

  return null;
}

async function attachExploreBookingCounts(
  input: {
    items: ExplorePersonalPostItem[];
    rpc: RpcRunner;
  },
) {
  const countsByPostId = await loadBeautyPostVerifiedBookingCounts({
    postIds: input.items
      .map((item) => (item.booking?.eligible ? item.id : null))
      .filter((postId): postId is string => Boolean(postId)),
    rpc: input.rpc,
  });

  return input.items.map((item) => {
    if (!item.booking) {
      return item;
    }

    return {
      ...item,
      booking: {
        ...item.booking,
        bookedCount: countsByPostId.get(item.id) ?? 0,
      },
    };
  });
}

function asMediaRows(value: unknown): ExplorePersonalMediaRow[] {
  return Array.isArray(value) ? (value as ExplorePersonalMediaRow[]) : [];
}

function mapPersonalMedia(
  media: ExplorePersonalMediaRow,
  supabaseUrl: string,
): ExploreFeedMedia | null {
  const id = cleanString(media.id);
  const objectPath = cleanString(media.objectPath);
  const imageUrl = getBeautyMediaPublicUrl({
    path: objectPath,
    supabaseUrl,
  });
  const width = readInteger(media.width);
  const height = readInteger(media.height);
  const aspectRatio = width && height ? width / height : null;

  if (
    !id ||
    !imageUrl ||
    (media.role !== "image" && media.role !== "before" && media.role !== "after")
  ) {
    return null;
  }

  return {
    aspectRatio,
    height,
    id,
    imageUrl,
    layoutVariant: layoutVariantFromRatio(aspectRatio),
    role: media.role,
    width,
  };
}

function personalPostHref(input: { postId: string; profileId: string }) {
  return `/explore/beauty/${encodeURIComponent(
    input.profileId,
  )}/posts/${encodeURIComponent(input.postId)}`;
}

function mapPersonalPostRow(
  row: ExplorePersonalPostRow,
  supabaseUrl: string,
): ExplorePersonalPostItem | null {
  const postId = cleanString(row.post_id);
  const profileId = cleanString(row.profile_id);
  const publishedAt = cleanString(row.created_at);
  const authorName = cleanString(row.author_display_name);

  if (
    !postId ||
    !profileId ||
    !publishedAt ||
    !authorName ||
    !UUID_PATTERN.test(postId) ||
    !UUID_PATTERN.test(profileId)
  ) {
    return null;
  }

  const media = asMediaRows(row.media)
    .map((item) => mapPersonalMedia(item, supabaseUrl))
    .filter((item): item is ExploreFeedMedia => Boolean(item));

  if (media.length === 0) {
    return null;
  }

  const postType = row.post_type === "before_after" ? "before_after" : "regular";
  const salonId = cleanString(row.salon_id);
  const salonName = cleanString(row.salon_name);
  const verification = verificationState(row.verification_state);
  const booking = beautyPostBookingPresentation({
    bookedCount: 0,
    bookingEnabled: row.booking_enabled === true,
    postId,
    salonId,
    salonName,
    source: "explore",
    verificationState: verification,
  });

  return {
    author: {
      avatarUrl: safeHttpUrl(row.author_avatar_url),
      id: profileId,
      kind: "person",
      name: authorName,
    },
    booking: booking.eligible
      ? {
          ...booking,
          readiness: null,
          serviceId: null,
        }
      : null,
    caption: cleanString(row.caption_excerpt),
    candidateClass: "organic",
    contentId: postId,
    contentType: "beauty_post",
    destination: {
      href: personalPostHref({ postId, profileId }),
      type: "personal-post",
    },
    feedKey: `personal:${postId}`,
    id: postId,
    media,
    personal: {
      postType,
      profileId,
    },
    publishedAt,
    rankingSignals: rankingSignalsForPersonalPost({
      mediaCount: media.length,
      postType,
      publishedAt,
      salonId,
      serviceName: cleanString(row.service_name),
    }),
    salon:
      salonId && salonName
        ? {
            city: cleanString(row.salon_city),
            href: cleanString(row.salon_href),
            id: salonId,
            name: salonName,
            state: cleanString(row.salon_state),
          }
        : null,
    serviceCategory: cleanString(row.service_category),
    serviceName: cleanString(row.service_name),
    sourceSortId: postId,
    sourceType: "personal",
    verification: verification ? { state: verification } : null,
  };
}

export async function getExplorePersonalPostPage(input: {
  cursor?: ExplorePersonalPostCursor | null;
  pageSize?: number;
  postId?: string | null;
  profileId?: string | null;
} = {}): Promise<ExplorePersonalPostPage> {
  const supabase = createSupabaseServerClient();
  const config = getSupabaseConfig();

  if (!supabase || !config) {
    return emptyPersonalPostPage("Personal beauty posts are unavailable.");
  }

  const pageSize = normalizePageSize(input.pageSize);
  const cursor = normalizeCursor(input.cursor);
  const postId = cleanString(input.postId);
  const profileId = cleanString(input.profileId);

  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as RpcRunner;
    const rpcArgs = {
      p_cursor_created_at: cursor?.createdAt ?? null,
      p_cursor_post_id: cursor?.postId ?? null,
      p_page_size: pageSize,
      p_post_id: postId && UUID_PATTERN.test(postId) ? postId : null,
      p_profile_id: profileId && UUID_PATTERN.test(profileId) ? profileId : null,
    };
    const { data, error, status, statusText } = await rpc(
      "get_public_explore_beauty_posts",
      rpcArgs,
    );

    if (error) {
      const diagnostics = supabaseErrorDiagnostics(error);

      console.error(
        "Explore personal beauty posts failed",
        diagnosticJson(
          process.env.NODE_ENV === "production"
            ? diagnostics
            : {
                ...diagnostics,
                args: rpcArgs,
                status: typeof status === "number" ? status : null,
                statusText: diagnosticString(statusText),
              },
        ),
      );

      return emptyPersonalPostPage("Personal beauty posts could not be loaded.");
    }

    const rows = Array.isArray(data) ? (data as ExplorePersonalPostRow[]) : [];
    const visibleRows = rows.slice(0, pageSize);
    const hasMore = rows.length > pageSize;
    const cursorRow = visibleRows[visibleRows.length - 1];
    const nextCursor =
      hasMore && cursorRow?.created_at && cursorRow.post_id
        ? {
            createdAt: cursorRow.created_at,
            postId: cursorRow.post_id,
          }
        : null;
    const seenPostIds = new Set<string>();
    const items = visibleRows
      .map((row) => mapPersonalPostRow(row, config.supabaseUrl))
      .filter((item): item is ExplorePersonalPostItem => Boolean(item))
      .filter((item) => {
        if (seenPostIds.has(item.id)) {
          return false;
        }

        seenPostIds.add(item.id);
        return true;
      });

    const itemsWithBookingCounts = await attachExploreBookingCounts({
      items,
      rpc,
    });

    return {
      error: null,
      hasMore,
      items: itemsWithBookingCounts,
      nextCursor,
    };
  } catch (error) {
    console.error(
      "Explore personal beauty posts crashed",
      diagnosticJson(supabaseErrorDiagnostics(error)),
    );

    return emptyPersonalPostPage("Personal beauty posts could not be loaded.");
  }
}

export async function getPublicExploreBeautyPost(input: {
  postId: string;
  profileId: string;
}) {
  const page = await getExplorePersonalPostPage({
    pageSize: 1,
    postId: input.postId,
    profileId: input.profileId,
  });

  if (page.error) {
    return null;
  }

  return page.items[0] ?? null;
}
