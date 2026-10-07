import "server-only";
import { getSalonIdentityById } from "@/lib/salon-identity-data";
import { EMPTY_SALON_IDENTITY,type SalonIdentity } from "@/lib/salon-identity";
import { getLumiTrustEvidenceBySalonId } from "@/lib/lumi-trust-data";
import type { LumiTrustCanonicalEvidence } from "@/lib/reylumi-trust";

import { normalizePublicBookingHref } from "@/lib/public-booking-routes";
import type { ExploreFeedTrustSignals } from "@/types/explore";

export type ExploreDecisionSignals = Partial<SalonIdentity> & {
  trustEvidence?: LumiTrustCanonicalEvidence | null;
  averageRating: number | null;
  bookableServiceId: string | null;
  bookableServiceName: string | null;
  bookableServicePrice?: number | null;
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
    identityVerified: decisionSignals.identityVerified ?? false,
    popularServiceName: decisionSignals.popularServiceName ?? null,
    popularServiceMinimumPrice: decisionSignals.popularServiceMinimumPrice ?? null,
    popularServiceMaximumPrice: decisionSignals.popularServiceMaximumPrice ?? null,
    completedBookingCount: decisionSignals.completedBookingCount ?? 0,
    trustEvidence: decisionSignals.trustEvidence ?? null,
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
  const availabilityLabel = cleanString(row.next_availability_label);

  return {
    averageRating: readRating(row.average_rating),
    bookableServiceId: cleanString(row.bookable_service_id),
    bookableServiceName: cleanString(row.bookable_service_name),
    bookingEnabled,
    bookingHref: bookingEnabled
      ? normalizePublicBookingHref(row.booking_href)
      : null,
    experienceCount: readCount(row.experience_count ?? row.review_count),
    nextAvailabilityLabel: bookingEnabled && !/^request\s+(?:a|the)\s+time$/i.test(availabilityLabel ?? "")
      ? availabilityLabel : null,
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

  const [{ data, error }, evidenceBySalon, identityBySalon] = await Promise.all([
    rpc("get_public_explore_decision_signals", { target_salon_ids: uniqueSalonIds }),
    getLumiTrustEvidenceBySalonId(rpc, uniqueSalonIds),
    getSalonIdentityById(rpc, uniqueSalonIds),
  ]);

  if (error) {
    console.warn("Explore decision signals unavailable", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });

  }

  const rows = !error && Array.isArray(data) ? (data as ExploreDecisionSignalsRow[]) : [];
  const signalsBySalon = new Map(
    rows.map((row) => [row.salon_id, mapDecisionSignalsRow(row)]),
  );

  // Price follows the specific bookable service, never the salon's global minimum.
  const serviceIds = [...new Set(rows.map(row=>row.bookable_service_id).filter((id):id is string=>Boolean(id)))];
  if(serviceIds.length) {
    const prices=await rpc('get_public_salon_service_prices',{target_service_ids:serviceIds});
    if(!prices.error && Array.isArray(prices.data))for(const row of prices.data) {
      const signal=signalsBySalon.get(row.salon_id);
      const price=Number(row.base_price);
      if(signal && signal.bookableServiceId===row.service_id && row.base_price!=null && Number.isFinite(price) && price>=0)
        signalsBySalon.set(row.salon_id,{...signal,bookableServiceName:row.service_name,bookableServicePrice:price});
    }
  }

  // Match the canonical evidence used by the salon profile, rather than
  // treating legacy reviews as the salon's entire trust history.
  await Promise.all(uniqueSalonIds.map(async (salonId) => {
    const { data: reputationData, error: reputationError } = await rpc(
      "get_public_salon_profile_reputation_summary",
      { target_salon_id: salonId },
    );
    const reputation = Array.isArray(reputationData)
      ? reputationData[0] as ExploreDecisionSignalsRow | undefined
      : undefined;
    if (reputationError || !reputation) {
      const current = signalsBySalon.get(salonId) ?? EMPTY_EXPLORE_DECISION_SIGNALS;
      signalsBySalon.set(salonId, { ...current, ...(identityBySalon.get(salonId) ?? EMPTY_SALON_IDENTITY), trustEvidence: evidenceBySalon.get(salonId) ?? null });
      return;
    }

    const current = signalsBySalon.get(salonId) ?? EMPTY_EXPLORE_DECISION_SIGNALS;
    signalsBySalon.set(salonId, {
      ...current,
      ...(identityBySalon.get(salonId) ?? EMPTY_SALON_IDENTITY),
      trustEvidence: evidenceBySalon.get(salonId) ?? null,
      averageRating: readRating(reputation.average_rating),
      experienceCount: readCount(reputation.experience_count),
      noIssueRate: readRatio(reputation.no_issue_rate),
      uniqueCustomerCount: readCount(reputation.unique_customer_count),
      verifiedVisitCount: readCount(reputation.verified_visit_count),
    });
  }));
  return signalsBySalon;
}
