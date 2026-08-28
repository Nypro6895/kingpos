import "server-only";

import {
  getCurrentBusinessContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import {
  EMPTY_EXPLORE_DECISION_SIGNALS,
  getExploreDecisionSignalsBySalonId,
  type ExploreDecisionSignals,
} from "@/lib/explore-decision-signals";
import { loadPublicSalonLogoPaths } from "@/lib/explore-salon-logos";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ExploreInitialLocation,
  ExploreResultGroup,
  ExploreSearchInput,
  ExploreSearchResponse,
  ExploreSearchResult,
} from "@/types/explore";

export const EXPLORE_PAGE_SIZE = 12;
const EXPLORE_MAX_PAGE_SIZE = 12;

type ExploreRpcRow = {
  active_service_count: number | null;
  address_line1: string | null;
  address_line2: string | null;
  best_match_count: number | string | null;
  city: string | null;
  country: string | null;
  cover_image_path?: string | null;
  description: string | null;
  distance_miles: number | null;
  featured_service_category?: string | null;
  featured_service_name?: string | null;
  group_total_count: number | string | null;
  has_public_profile?: boolean | null;
  is_new: boolean | null;
  latitude: number | null;
  latest_media_created_at?: string | null;
  logo_image_path?: string | null;
  logo_path?: string | null;
  longitude: number | null;
  match_type: string | null;
  match_tier: number | null;
  nearby_count: number | string | null;
  phone: string | null;
  postal_code: string | null;
  profile_completeness: number | null;
  recommended_count: number | string | null;
  relevance_score: number | null;
  result_group: string | null;
  salon_id: string;
  salon_name: string;
  service_categories: string[] | null;
  service_names: string[] | null;
  starting_price?: number | string | null;
  state: string | null;
  total_count: number | string | null;
};

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

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function normalizeCategory(value: string | null | undefined) {
  const category = clean(value);
  return category.toLowerCase() === "all" ? "" : category;
}

function normalizePage(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value ?? 1));
}

function normalizePageSize(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return EXPLORE_PAGE_SIZE;
  }

  return Math.min(EXPLORE_MAX_PAGE_SIZE, Math.max(1, Math.floor(value ?? EXPLORE_PAGE_SIZE)));
}

function normalizeCoordinate(value: number | null | undefined, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value >= min && value <= max ? value : null;
}

function emptyResponse(input: {
  category: string;
  error?: string | null;
  location: string;
  page: number;
  pageSize: number;
  query: string;
}): ExploreSearchResponse {
  return {
    category: input.category,
    error: input.error ?? null,
    groupCounts: {
      bestMatches: 0,
      nearby: 0,
      recommended: 0,
    },
    location: input.location,
    page: input.page,
    pageSize: input.pageSize,
    query: input.query,
    results: [],
    sections: {
      bestMatches: [],
      nearby: [],
      recommended: [],
    },
    totalCount: 0,
    totalPages: 1,
  };
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function normalizeResultGroup(value: string | null | undefined): ExploreResultGroup {
  if (value === "best_match" || value === "nearby" || value === "recommended") {
    return value;
  }

  return "recommended";
}

function mapExploreRow(
  row: ExploreRpcRow,
  signals: ExploreDecisionSignals | undefined,
  fallbackLogoPath?: string | null,
): ExploreSearchResult {
  const decisionSignals = signals ?? EMPTY_EXPLORE_DECISION_SIGNALS;

  return {
    activeServiceCount: row.active_service_count ?? 0,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    averageRating: decisionSignals.averageRating,
    bookableServiceId: decisionSignals.bookableServiceId,
    bookableServiceName: decisionSignals.bookableServiceName,
    bookingEnabled: decisionSignals.bookingEnabled,
    bookingHref: decisionSignals.bookingHref,
    city: row.city,
    country: row.country,
    coverImageUrl: getSalonProfileMediaUrl(row.cover_image_path),
    description: row.description,
    distanceMiles: row.distance_miles,
    featuredServiceCategory: row.featured_service_category ?? null,
    featuredServiceName: row.featured_service_name ?? null,
    hasPublicProfile: row.has_public_profile === true,
    id: row.salon_id,
    isNew: row.is_new ?? false,
    latitude: row.latitude,
    latestMediaCreatedAt: row.latest_media_created_at ?? null,
    logoImageUrl: getSalonProfileMediaUrl(
      row.logo_image_path ?? row.logo_path ?? fallbackLogoPath,
    ),
    longitude: row.longitude,
    matchType: row.match_type ?? "recommended",
    matchTier: row.match_tier ?? 99,
    name: row.salon_name,
    nextAvailabilityLabel: decisionSignals.nextAvailabilityLabel,
    nextAvailableAt: decisionSignals.nextAvailableAt,
    phone: row.phone,
    postalCode: row.postal_code,
    profileCompleteness: row.profile_completeness ?? 0,
    reputationNoIssueRate: decisionSignals.noIssueRate,
    relevanceScore: row.relevance_score ?? 0,
    resultGroup: normalizeResultGroup(row.result_group),
    sharedExperienceCount: decisionSignals.experienceCount,
    reviewCount: decisionSignals.reviewCount,
    serviceCategories: toStringArray(row.service_categories),
    serviceNames: toStringArray(row.service_names),
    startingPrice: readMoney(row.starting_price),
    state: row.state,
    uniqueCustomerCount: decisionSignals.uniqueCustomerCount,
    verifiedVisitCount: decisionSignals.verifiedVisitCount,
  };
}

function readCount(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function readMoney(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readGroupCounts(rows: ExploreRpcRow[]) {
  const firstRow = rows[0];

  if (firstRow) {
    return {
      bestMatches: readCount(firstRow.best_match_count),
      nearby: readCount(firstRow.nearby_count),
      recommended: readCount(firstRow.recommended_count),
    };
  }

  return {
    bestMatches: 0,
    nearby: 0,
    recommended: 0,
  };
}

function groupResults(results: ExploreSearchResult[]) {
  return {
    bestMatches: results.filter((result) => result.resultGroup === "best_match"),
    nearby: results.filter((result) => result.resultGroup === "nearby"),
    recommended: results.filter((result) => result.resultGroup === "recommended"),
  };
}

export async function searchExploreSalons(
  input: ExploreSearchInput = {},
): Promise<ExploreSearchResponse> {
  const query = clean(input.query);
  const location = clean(input.location);
  const category = normalizeCategory(input.category);
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const latitude = normalizeCoordinate(input.latitude, -90, 90);
  const longitude = normalizeCoordinate(input.longitude, -180, 180);
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return emptyResponse({
      category,
      error: "Explore search is unavailable because Supabase is not configured.",
      location,
      page,
      pageSize,
      query,
    });
  }

  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as RpcRunner;
    const { data, error } = await rpc("search_public_explore_salons", {
      p_category: category || null,
      p_latitude: latitude,
      p_location: location || null,
      p_longitude: longitude,
      p_page: page,
      p_page_size: pageSize,
      p_query: query || null,
    });

    if (error) {
      console.warn("Explore public salon search unavailable", {
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
      });

      return emptyResponse({
        category,
        error: "Explore search is not ready yet. Apply the public discovery migration and try again.",
        location,
        page,
        pageSize,
        query,
      });
    }

    const rows = Array.isArray(data) ? (data as ExploreRpcRow[]) : [];
    const signalMap = await getExploreDecisionSignalsBySalonId(
      rpc,
      rows.map((row) => row.salon_id),
    );
    const logoPathMap = await loadPublicSalonLogoPaths({
      rpc,
      salonIds: rows
        .filter((row) => !(row.logo_image_path ?? row.logo_path))
        .map((row) => row.salon_id),
    });
    const results = rows.map((row) =>
      mapExploreRow(
        row,
        signalMap.get(row.salon_id),
        logoPathMap.get(row.salon_id),
      ),
    );
    const sections = groupResults(results);
    const groupCounts = readGroupCounts(rows);
    const totalCount = readCount(rows[0]?.total_count);

    return {
      category,
      error: null,
      groupCounts,
      location,
      page,
      pageSize,
      query,
      results,
      sections,
      totalCount,
      totalPages: Math.max(1, Math.ceil(groupCounts.bestMatches / pageSize)),
    };
  } catch (error) {
    console.warn("Explore public salon search unavailable", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return emptyResponse({
      category,
      error: "Explore search could not be loaded.",
      location,
      page,
      pageSize,
      query,
    });
  }
}

export async function getExploreWorkspaceLocation(
  context?: CurrentBusinessContext,
): Promise<ExploreInitialLocation> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const salon = resolvedContext.currentSalon;

  if (!salon) {
    return { label: "", source: "none" };
  }

  const cityState = [salon.city, salon.state].filter(Boolean).join(", ");
  const label = cityState || salon.postal_code || "";

  return {
    label,
    source: label ? "workspace" : "none",
  };
}
