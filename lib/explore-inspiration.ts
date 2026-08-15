import "server-only";

import {
  contentBookingOptionKey,
  loadPublicContentBookingOptions,
} from "@/lib/content-booking";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ExploreInspirationCursor,
  ExploreInspirationItem,
  ExploreInspirationLayoutVariant,
  ExploreInspirationPage,
} from "@/types/explore";

const EXPLORE_INSPIRATION_PAGE_SIZE = 18;
const EXPLORE_INSPIRATION_MAX_PAGE_SIZE = 24;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcError = {
  code?: string;
  details?: string;
  hint?: string;
  message: string;
};

type RpcRunner = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

type ExploreInspirationRow = {
  aspect_ratio: number | string | null;
  author_display_name: string | null;
  author_is_anonymous: boolean | null;
  bookable_service_id: string | null;
  booking_enabled: boolean | null;
  booking_href: string | null;
  caption_excerpt: string | null;
  content_id: string;
  content_type: string;
  image_height: number | string | null;
  image_width: number | string | null;
  media_id: string;
  media_path: string | null;
  published_at: string | null;
  salon_city: string | null;
  salon_id: string;
  salon_name: string | null;
  salon_phone: string | null;
  salon_state: string | null;
  service_category: string | null;
  service_name: string | null;
};

function emptyInspirationPage(error: string | null = null): ExploreInspirationPage {
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
    return EXPLORE_INSPIRATION_PAGE_SIZE;
  }

  return Math.min(
    EXPLORE_INSPIRATION_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(value)),
  );
}

function normalizeCursor(
  cursor: ExploreInspirationCursor | null | undefined,
) {
  if (!cursor || !UUID_PATTERN.test(cursor.mediaId)) {
    return null;
  }

  const date = new Date(cursor.publishedAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    mediaId: cursor.mediaId,
    publishedAt: date.toISOString(),
  };
}

function phoneHref(phone: string | null | undefined) {
  const normalized = phone?.replace(/[^\d+]/g, "") ?? "";
  return normalized ? `tel:${normalized}` : null;
}

function salonProfileHref(salonId: string) {
  return UUID_PATTERN.test(salonId)
    ? `/explore/salons/${encodeURIComponent(salonId)}`
    : null;
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

function mapInspirationRow(
  row: ExploreInspirationRow,
): ExploreInspirationItem | null {
  const imageUrl = getSalonProfileMediaUrl(row.media_path);
  const salonName = cleanString(row.salon_name);
  const publishedAt = cleanString(row.published_at);
  const aspectRatio = readNumber(row.aspect_ratio);

  if (
    !imageUrl ||
    !salonName ||
    !publishedAt ||
    !UUID_PATTERN.test(row.content_id) ||
    !UUID_PATTERN.test(row.media_id) ||
    !UUID_PATTERN.test(row.salon_id) ||
    (row.content_type !== "look" && row.content_type !== "update")
  ) {
    return null;
  }

  return {
    aspectRatio,
    authorDisplayName: cleanString(row.author_display_name),
    authorIsAnonymous: row.author_is_anonymous === true,
    bookableServiceId: UUID_PATTERN.test(row.bookable_service_id ?? "")
      ? row.bookable_service_id
      : null,
    bookingEnabled: row.booking_enabled === true,
    bookingHref: row.booking_enabled === true ? cleanString(row.booking_href) : null,
    bookingLabel: "Book this look",
    bookingReadiness: null,
    captionExcerpt: cleanString(row.caption_excerpt),
    contentId: row.content_id,
    contentType: row.content_type,
    imageHeight: readInteger(row.image_height),
    imageUrl,
    imageWidth: readInteger(row.image_width),
    layoutVariant: layoutVariantFromRatio(aspectRatio),
    mediaId: row.media_id,
    phoneHref: phoneHref(row.salon_phone),
    publishedAt,
    salonCity: cleanString(row.salon_city),
    salonHref: salonProfileHref(row.salon_id),
    salonId: row.salon_id,
    salonName,
    salonState: cleanString(row.salon_state),
    serviceCategory: cleanString(row.service_category),
    serviceName: cleanString(row.service_name),
  };
}

function diversifyInspirationItems(items: ExploreInspirationItem[]) {
  const remaining = [...items];
  const output: ExploreInspirationItem[] = [];
  let lastSalonId: string | null = null;
  let consecutiveSalonCount = 0;

  while (remaining.length > 0) {
    const nextIndex =
      consecutiveSalonCount >= 2
        ? remaining.findIndex((item) => item.salonId !== lastSalonId)
        : 0;
    const selectedIndex = nextIndex >= 0 ? nextIndex : 0;
    const [nextItem] = remaining.splice(selectedIndex, 1);

    if (!nextItem) {
      break;
    }

    if (nextItem.salonId === lastSalonId) {
      consecutiveSalonCount += 1;
    } else {
      lastSalonId = nextItem.salonId;
      consecutiveSalonCount = 1;
    }

    output.push(nextItem);
  }

  return output;
}

export async function getExploreInspirationPage(input: {
  cursor?: ExploreInspirationCursor | null;
  diversify?: boolean;
  pageSize?: number;
} = {}): Promise<ExploreInspirationPage> {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return emptyInspirationPage("Fresh inspiration is unavailable.");
  }

  const pageSize = normalizePageSize(input.pageSize);
  const cursor = normalizeCursor(input.cursor);

  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as RpcRunner;
    const { data, error } = await rpc("get_public_explore_inspiration", {
      p_cursor_media_id: cursor?.mediaId ?? null,
      p_cursor_published_at: cursor?.publishedAt ?? null,
      p_page_size: pageSize,
    });

    if (error) {
      console.error("Explore inspiration failed", {
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
      });

      return emptyInspirationPage("Fresh inspiration could not be loaded.");
    }

    const rows = Array.isArray(data) ? (data as ExploreInspirationRow[]) : [];
    const visibleRows = rows.slice(0, pageSize);
    const hasMore = rows.length > pageSize;
    const cursorRow = visibleRows[visibleRows.length - 1];
    const nextCursor =
      hasMore && cursorRow?.published_at && cursorRow.media_id
        ? {
            mediaId: cursorRow.media_id,
            publishedAt: cursorRow.published_at,
          }
        : null;
    const seenMediaIds = new Set<string>();
    const items = visibleRows
      .map(mapInspirationRow)
      .filter((item): item is ExploreInspirationItem => Boolean(item))
      .filter((item) => {
        if (seenMediaIds.has(item.mediaId)) {
          return false;
        }

        seenMediaIds.add(item.mediaId);
        return true;
      });
    const contentOptions = await loadPublicContentBookingOptions(
      items.map((item) => item.salonId),
    );
    const optionsByContent = new Map(
      contentOptions.map((option) => [
        contentBookingOptionKey({
          contentId: option.contentId,
          sourceType: option.sourceType,
        }),
        option,
      ]),
    );
    const itemsWithBooking = items.map((item) => {
      const option = optionsByContent.get(
        contentBookingOptionKey({
          contentId: item.contentId,
          sourceType:
            item.contentType === "update"
              ? "salon_profile_update"
              : "salon_profile_look",
        }),
      );

      if (!option) {
        return item;
      }

      return {
        ...item,
        bookableServiceId: option.primaryServiceId,
        bookingEnabled: option.bookingEnabled,
        bookingHref: option.bookingHref,
        bookingLabel: option.ctaLabel,
        bookingReadiness: option.readinessState,
        serviceName: option.primaryServiceName ?? item.serviceName,
      };
    });

    return {
      error: null,
      hasMore,
      items:
        input.diversify === false
          ? itemsWithBooking
          : diversifyInspirationItems(itemsWithBooking),
      nextCursor,
    };
  } catch (error) {
    console.error("Explore inspiration crashed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return emptyInspirationPage("Fresh inspiration could not be loaded.");
  }
}
