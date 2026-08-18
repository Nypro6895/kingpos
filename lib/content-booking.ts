import "server-only";

import {
  BEAUTY_MEDIA_BUCKET,
  getBeautyMediaPublicUrl,
} from "@/lib/beauty-media";
import { normalizePublicBookingHref } from "@/lib/public-booking-routes";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import {
  createSupabaseServerClient,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import type {
  ContentBookingMappedService,
  ContentBookingReadinessState,
  ContentBookingSourceType,
  PublicContentBookingOption,
} from "@/types/content-booking";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ContentBookingOptionRow = {
  add_ons: unknown;
  additional_services: unknown;
  booking_cta_enabled: boolean | null;
  booking_enabled: boolean | null;
  booking_href: string | null;
  booking_note: string | null;
  caption: string | null;
  content_id: string;
  content_type: string;
  credited_staff_id: string | null;
  credited_staff_name: string | null;
  cta_label: string | null;
  media_bucket: string | null;
  media_path: string | null;
  primary_service_base_price: number | string | null;
  primary_service_duration_minutes: number | null;
  primary_service_id: string | null;
  primary_service_name: string | null;
  readiness_message: string | null;
  readiness_state: string | null;
  salon_id: string;
  source_type: string;
  title: string | null;
};

function cleanUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function moneyValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function integerValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}

function booleanValue(value: unknown) {
  return value === true || value === "true";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseMappedServices(value: unknown): ContentBookingMappedService[] {
  let rows = value;

  if (typeof value === "string") {
    try {
      rows = JSON.parse(value) as unknown;
    } catch {
      rows = [];
    }
  }

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((item) => {
      const row = asRecord(item);
      const serviceId = cleanUuid(row.service_id);

      if (!serviceId) {
        return null;
      }

      const role =
        row.service_role === "add_on" ? "add_on" : "additional_service";

      return {
        basePrice: moneyValue(row.base_price) ?? 0,
        displayOrder: integerValue(row.display_order),
        durationMinutes: Math.max(1, integerValue(row.duration_minutes) || 30),
        eligible: booleanValue(row.eligible),
        parentServiceId: cleanUuid(row.parent_service_id),
        role,
        serviceId,
        serviceName: cleanText(row.service_name) ?? "Service",
      } satisfies ContentBookingMappedService;
    })
    .filter((item): item is ContentBookingMappedService => Boolean(item));
}

export function contentBookingOptionKey(input: {
  contentId: string;
  sourceType?: ContentBookingSourceType | string | null;
}) {
  return `${input.sourceType ?? "content"}:${input.contentId}`;
}

function publicContentImageUrl(input: {
  bucket: string | null | undefined;
  path: string | null | undefined;
}) {
  if (input.bucket === BEAUTY_MEDIA_BUCKET) {
    const config = getSupabaseConfig();

    return config
      ? getBeautyMediaPublicUrl({
          path: input.path,
          supabaseUrl: config.supabaseUrl,
        })
      : null;
  }

  return getSalonProfileMediaUrl(input.path);
}

export function mapContentBookingOptionRow(
  row: ContentBookingOptionRow,
): PublicContentBookingOption | null {
  const contentId = cleanUuid(row.content_id);
  const salonId = cleanUuid(row.salon_id);
  const sourceType =
    row.source_type === "beauty_post"
      ? "beauty_post"
      : row.source_type === "salon_profile_update"
      ? "salon_profile_update"
      : row.source_type === "salon_profile_look"
        ? "salon_profile_look"
        : null;
  const contentType =
    row.content_type === "beauty_post"
      ? "beauty_post"
      : row.content_type === "update"
        ? "update"
        : "look";

  if (!contentId || !salonId || !sourceType) {
    return null;
  }

  const readinessState = (
    [
      "quick_ready",
      "service_ready",
      "professional_ready",
      "inspiration_only",
      "invalid",
    ] as const
  ).includes(row.readiness_state as ContentBookingReadinessState)
    ? (row.readiness_state as ContentBookingReadinessState)
    : "inspiration_only";

  return {
    addOns: parseMappedServices(row.add_ons),
    additionalServices: parseMappedServices(row.additional_services),
    bookingCtaEnabled: row.booking_cta_enabled === true,
    bookingEnabled: row.booking_enabled === true,
    bookingHref: normalizePublicBookingHref(row.booking_href),
    bookingNote: cleanText(row.booking_note),
    caption: cleanText(row.caption),
    contentId,
    contentType,
    creditedStaffId: cleanUuid(row.credited_staff_id),
    creditedStaffName: cleanText(row.credited_staff_name),
    ctaLabel:
      cleanText(row.cta_label) ??
      (sourceType === "beauty_post"
        ? "Book this transformation"
        : readinessState === "inspiration_only"
          ? "Book with this inspiration"
          : "Book this look"),
    imageUrl: publicContentImageUrl({
      bucket: row.media_bucket,
      path: row.media_path,
    }),
    mediaPath: cleanText(row.media_path),
    primaryServiceBasePrice: moneyValue(row.primary_service_base_price),
    primaryServiceDurationMinutes:
      typeof row.primary_service_duration_minutes === "number"
        ? row.primary_service_duration_minutes
        : null,
    primaryServiceId: cleanUuid(row.primary_service_id),
    primaryServiceName: cleanText(row.primary_service_name),
    readinessMessage:
      cleanText(row.readiness_message) ??
      "Choose services and a professional. We will keep this inspiration attached.",
    readinessState,
    salonId,
    sourceType,
    title: cleanText(row.title) ?? "Salon inspiration",
  };
}

export async function loadPublicContentBookingOptions(salonIds: string[]) {
  const uniqueSalonIds = Array.from(
    new Set(
      salonIds
        .map((id) => cleanUuid(id))
        .filter((id): id is string => Boolean(id)),
    ),
  );

  if (uniqueSalonIds.length === 0) {
    return [];
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("get_public_content_booking_options", {
    target_salon_ids: uniqueSalonIds,
  });

  if (error) {
    console.error("Public content booking options RPC failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonIds: uniqueSalonIds,
    });
    return [];
  }

  return (Array.isArray(data) ? data : [])
    .map((row) => mapContentBookingOptionRow(row as ContentBookingOptionRow))
    .filter((item): item is PublicContentBookingOption => Boolean(item));
}
