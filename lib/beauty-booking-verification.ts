export const BEAUTY_BOOK_VERIFIED_BOOKING_STATUSES = [
  "confirmed",
  "checked_in",
  "in_service",
  "completed",
] as const;

export const BEAUTY_POST_BOOKING_SOURCE_TYPE = "beauty_post" as const;

export type BeautyPostBookingSource = "explore" | "public_profile";

export type BeautyPostBookingPresentation = {
  bookedCount: number;
  eligible: boolean;
  href: string | null;
  label: string;
  salonId: string | null;
  salonName: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const beautyBookVerifiedStatusSet = new Set<string>(
  BEAUTY_BOOK_VERIFIED_BOOKING_STATUSES,
);

export function isBeautyBookVerifiedBooking(input: {
  confirmationStatus: string | null | undefined;
  status: string | null | undefined;
}) {
  return (
    input.confirmationStatus === "confirmed" &&
    beautyBookVerifiedStatusSet.has(input.status ?? "")
  );
}

export function beautyBookingHrefForSalon(salonId: string) {
  const trimmed = salonId.trim();

  return UUID_PATTERN.test(trimmed) ? `/book/${trimmed}` : null;
}

function cleanUuid(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function cleanText(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function readBookedCount(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}

export function beautyBookingHrefForPost(input: {
  postId: string;
  salonId: string;
  source: BeautyPostBookingSource;
}) {
  const baseHref = beautyBookingHrefForSalon(input.salonId);
  const postId = input.postId.trim();

  if (!baseHref || !UUID_PATTERN.test(postId)) {
    return null;
  }

  const params = new URLSearchParams({
    inspiration: postId,
    source: input.source,
  });

  return `${baseHref}?${params.toString()}`;
}

export function beautyPostBookingPresentation(input: {
  bookedCount?: number | string | null;
  bookingEnabled: boolean | null | undefined;
  labelStyle?: "full" | "short";
  postId: string | null | undefined;
  salonId: string | null | undefined;
  salonName?: string | null;
  source: BeautyPostBookingSource;
  verificationState: string | null | undefined;
}): BeautyPostBookingPresentation {
  const postId = cleanUuid(input.postId);
  const salonId = cleanUuid(input.salonId);
  const salonName = cleanText(input.salonName);
  const canBuildHref =
    input.bookingEnabled === true &&
    Boolean(postId && salonId);
  const href =
    canBuildHref && postId && salonId
      ? beautyBookingHrefForPost({
          postId,
          salonId,
          source: input.source,
        })
      : null;

  return {
    bookedCount: readBookedCount(input.bookedCount),
    eligible: Boolean(href),
    href,
    label:
      input.labelStyle === "short"
        ? "Book"
        : salonName
          ? `Book at ${salonName}`
          : "Book",
    salonId,
    salonName,
  };
}
