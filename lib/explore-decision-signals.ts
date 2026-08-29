import "server-only";

import { normalizePublicBookingHref } from "@/lib/public-booking-routes";
import type { ExploreFeedTrustSignals } from "@/types/explore";

export type ExploreDecisionSignals = {
  averageRating: number | null;
  bookableServiceId: string | null;
  bookableServiceName: string | null;
  bookingEnabled: boolean;
  bookingHref: string | null;
  experienceCount: number;
  nextAvailabilityLabel: string | null;
  nextAvailableAt: string | null;
  noIssueRate: number | null;
  reviewCount: number;
  uniqueCustomerCount: number;
  verifiedVisitCount: number;
};

export const EMPTY_EXPLORE_DECISION_SIGNALS: ExploreDecisionSignals = {
  averageRating: null,
  bookableServiceId: null,
  bookableServiceName: null,
  bookingEnabled: false,
  bookingHref: null,
  experienceCount: 0,
  nextAvailabilityLabel: null,
  nextAvailableAt: null,
  noIssueRate: null,
  reviewCount: 0,
  uniqueCustomerCount: 0,
  verifiedVisitCount: 0,
};

export function exploreFeedTrustFromDecisionSignals(
  signals: ExploreDecisionSignals | null | undefined,
): ExploreFeedTrustSignals {
  const decisionSignals = signals ?? EMPTY_EXPLORE_DECISION_SIGNALS;

  return {
    averageRating: decisionSignals.averageRating,
    noIssueRate: decisionSignals.noIssueRate,
    sharedExperienceCount: decisionSignals.experienceCount,
    uniqueCustomerCount: decisionSignals.uniqueCustomerCount,
    verifiedVisitCount: decisionSignals.verifiedVisitCount,
  };
}

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

type ExploreDecisionSignalsRow = {
  average_rating: number | string | null;
  bookable_service_id: string | null;
  bookable_service_name: string | null;
  booking_enabled: boolean | null;
  booking_href: string | null;
  experience_count?: number | string | null;
  next_availability_label: string | null;
  next_available_at: string | null;
  no_issue_rate?: number | string | null;
  review_count: number | string | null;
  salon_id: string;
  unique_customer_count?: number | string | null;
  verified_visit_count?: number | string | null;
};

function readCount(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}

function readRating(value: number | string | null | undefined) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : null;

  if (parsed === null || !Number.isFinite(parsed)) {
    return null;
  }

  return parsed >= 1 && parsed <= 5 ? parsed : null;
}

function readRatio(value: number | string | null | undefined) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : null;

  if (parsed === null || !Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.min(1, parsed));
}

function cleanString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapDecisionSignalsRow(
  row: ExploreDecisionSignalsRow,
): ExploreDecisionSignals {
  const bookingEnabled = row.booking_enabled === true;

  return {
    averageRating: readRating(row.average_rating),
    bookableServiceId: cleanString(row.bookable_service_id),
    bookableServiceName: cleanString(row.bookable_service_name),
    bookingEnabled,
    bookingHref: bookingEnabled
      ? normalizePublicBookingHref(row.booking_href)
      : null,
    experienceCount: readCount(row.experience_count ?? row.review_count),
    nextAvailabilityLabel: bookingEnabled
      ? cleanString(row.next_availability_label)
      : null,
    nextAvailableAt: bookingEnabled ? cleanString(row.next_available_at) : null,
    noIssueRate: readRatio(row.no_issue_rate),
    reviewCount: readCount(row.review_count),
    uniqueCustomerCount: readCount(row.unique_customer_count),
    verifiedVisitCount: readCount(row.verified_visit_count),
  };
}

export async function getExploreDecisionSignalsBySalonId(
  rpc: RpcRunner,
  salonIds: string[],
) {
  const uniqueSalonIds = Array.from(
    new Set(salonIds.map((salonId) => salonId.trim()).filter(Boolean)),
  );

  if (uniqueSalonIds.length === 0) {
    return new Map<string, ExploreDecisionSignals>();
  }

  const { data, error } = await rpc("get_public_explore_decision_signals", {
    target_salon_ids: uniqueSalonIds,
  });

  if (error) {
    console.warn("Explore decision signals unavailable", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });

    return new Map<string, ExploreDecisionSignals>();
  }

  const rows = Array.isArray(data) ? (data as ExploreDecisionSignalsRow[]) : [];
  return new Map(
    rows.map((row) => [row.salon_id, mapDecisionSignalsRow(row)]),
  );
}
