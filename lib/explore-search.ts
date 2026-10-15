import "server-only";
import { classifyExploreSearchError, exploreSearchErrorMessage, runExploreSearchRpc } from "@/lib/explore-search-rpc";
import { resolveExploreQueryRouting, type ExploreQueryRouting } from "@/lib/explore-query-routing";
import { resolveNailCoverImage } from "@/lib/default-nail-images";

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
import {
  getPublicSalonOperatingStatusesBySalonId,
  operatingStatusFromMap,
} from "@/lib/salon-operating-status";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { createSupabaseServerClient, createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ExploreInitialLocation,
  ExploreResultGroup,
  ExploreSearchInput,
  ExploreSearchResponse,
  ExploreSearchResult,
  ExploreSearchErrorKind,
  ExploreSearchScope,
} from "@/types/explore";

export const EXPLORE_PAGE_SIZE = 12;
const EXPLORE_MAX_PAGE_SIZE = 20;

type ExploreRpcRow = {
  search_scope?: "exact" | "A" | "B" | "C";
  scope_label?: string;
  pagination_cursor?: Record<string, unknown>;
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
  errorKind?: ExploreSearchErrorKind;
  location: string;
  page: number;
  pageSize: number;
  query: string;
}): ExploreSearchResponse {
  return {
    category: input.category,
    error: input.error ?? null,
    errorKind: input.errorKind ?? null,
    hasMore: false,
    nextCursor: null,
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
  operatingStatus: ExploreSearchResult["operatingStatus"],
  fallbackLogoPath?: string | null,
): ExploreSearchResult {
  const decisionSignals = signals ?? EMPTY_EXPLORE_DECISION_SIGNALS;

  return {
    activeServiceCount: row.active_service_count ?? 0,
    searchScope: row.search_scope,
    scopeLabel: row.scope_label,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    averageRating: decisionSignals.averageRating,
    bookableServiceId: decisionSignals.bookableServiceId,
    bookableServiceName: decisionSignals.bookableServiceName,
    bookableServicePrice: decisionSignals.bookableServicePrice ?? null,
    bookingEnabled: decisionSignals.bookingEnabled,
    bookingHref: decisionSignals.bookingHref,
    city: row.city,
    country: row.country,
    coverImageUrl: resolveNailCoverImage({ id: row.salon_id, name: row.salon_name, categories: toStringArray(row.service_categories), coverImageUrl: getSalonProfileMediaUrl(row.cover_image_path) }),
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
    operatingStatus,
    phone: row.phone,
    postalCode: row.postal_code,
    profileCompleteness: row.profile_completeness ?? 0,
          identityVerified: decisionSignals.identityVerified,
      popularServiceName: decisionSignals.popularServiceName,
      popularServiceMinimumPrice: decisionSignals.popularServiceMinimumPrice,
      popularServiceMaximumPrice: decisionSignals.popularServiceMaximumPrice,
      completedBookingCount: decisionSignals.completedBookingCount,
      trustEvidence: decisionSignals.trustEvidence ?? null,
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

function groupResults(results: ExploreSearchResult[]) {
  return {
    bestMatches: results.filter((result) => result.resultGroup === "best_match"),
    nearby: results.filter((result) => result.resultGroup === "nearby"),
    recommended: results.filter((result) => result.resultGroup === "recommended"),
  };
}

export async function searchExploreSalons(
  input: ExploreSearchInput = {},
  options: { signal?: AbortSignal; routing?: ExploreQueryRouting } = {},
): Promise<ExploreSearchResponse> {
  let query = clean(input.query);
  let location = clean(input.location);
  let category = normalizeCategory(input.category);
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  let latitude = normalizeCoordinate(input.latitude, -90, 90);
  let longitude = normalizeCoordinate(input.longitude, -180, 180);
  let routing = options.routing;
  let scopePolicy = input.scopePolicy ?? (location && (!input.locationSource || input.locationSource === "manual") ? "fixed" : "expandable");
  const metadata = () => routing ? {
    target: routing.target, contentQuery: routing.contentQuery, displayQuery: routing.displayQuery,
    locationOrigin: routing.locationOrigin, locationSource: routing.locationSource,
    requiresGps: routing.requiresGps, areaCandidates: routing.areaCandidates,
    areaAmbiguous: routing.areaAmbiguous, locationConflict: routing.locationConflict, queryLocationHint: routing.queryLocationHint, lookupFailed: routing.lookupFailed,
  } : {
    target: input.target === "posts" ? "posts" as const : "salons" as const,
    contentQuery: (input as ExploreSearchInput & { contentQuery?: string }).contentQuery ?? "",
    displayQuery: (input as ExploreSearchInput & { displayQuery?: string }).displayQuery ?? query,
    locationOrigin: location ? input.locationSource && input.locationSource !== "manual" ? "context" as const : "manual" as const : "none" as const,
    locationSource: input.locationSource ?? (location ? "manual" as const : "none" as const),
  };
  const supabase = (await createAuthenticatedSupabaseServerClient()) ?? createSupabaseServerClient();

  if (!supabase) {
    return { ...emptyResponse({
      category,
      error: "Salon search is temporarily unavailable. Please try again later.",
      location,
      page,
      pageSize,
      query,
    }), ...metadata() };
  }

  try {
    const rpc: RpcRunner = async (name, args) => {
      const request = supabase.rpc(name, args);
      return await (options.signal ? request.abortSignal(options.signal) : request) as unknown as Awaited<ReturnType<RpcRunner>>;
    };
    // A continuation already carries canonical filters from its frozen session.
    // Re-interpreting it could change region/category after data or GPS changes.
    if (!routing && !input.cursor) routing = await resolveExploreQueryRouting(input, { rpc, signal: options.signal });
    if (routing) {
      query = routing.query; location = routing.location; category = routing.category;
      latitude = routing.latitude; longitude = routing.longitude; scopePolicy = routing.scopePolicy;
      if (routing.lookupFailed) return { ...emptyResponse({ category, location, query, page, pageSize,
        error: "Search is temporarily unavailable. Please try again.", errorKind: "query" }), ...metadata() };
    }
    if (routing?.target === "posts" || input.target === "posts" || routing?.requiresGps) {
      return { ...emptyResponse({ category, location, query, page, pageSize }), ...metadata(), countKind: "loaded",
        scope: { policy: scopePolicy, stage: location ? "A" : "C", label: location || (routing?.requiresGps ? "Choose an area or allow location" : "Matching public posts"), expanded: false } };
    }
    // Numbered links restart from the indexed cursor path; they never trigger OFFSET work.
    const { data: rawData, error } = await runExploreSearchRpc(() => rpc("search_public_explore_session", {
      p_category: category || null,
      p_latitude: latitude,
      p_location: location || null,
      p_longitude: longitude,
      p_cursor: input.cursor ?? null,
      p_limit: pageSize,
      p_query: query || null,
      p_scope_policy: scopePolicy,
      p_sort: input.sort ?? "relevance",
      p_intent: input.intent ?? "search",
    }), options.signal);

    if (error) {
      console.warn("Explore public salon search unavailable", {
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
      });

      return { ...emptyResponse({
        category,
        error: exploreSearchErrorMessage(classifyExploreSearchError(error)),
        errorKind: classifyExploreSearchError(error),
        location,
        page,
        pageSize,
        query,
      }), ...metadata() };
    }

    const envelope = rawData && typeof rawData === "object" ? rawData as {
      rows?: unknown; cursor?: Record<string, unknown>; nextCursor?: Record<string, unknown>;
      hasMore?: boolean; totalCount?: number; countKind?: "loaded"; scope?: ExploreSearchScope;
      appliedSort?: string;
      supportedSorts?: string[]; sortFallbackReason?: string | null;
      rankVersion?: number | null; rankAsOf?: string | null; rankingBasis?: "indexed_scope" | "candidate_pool";
    } : null;
    const data = envelope?.rows ?? rawData;
    const rows = Array.isArray(data) ? (data as ExploreRpcRow[]) : [];

    const salonIds = rows.map((row) => row.salon_id);
    const [signalMap, logoPathMap, operatingStatusMap] = await Promise.all([
      getExploreDecisionSignalsBySalonId(rpc, salonIds),
      loadPublicSalonLogoPaths({
        rpc,
        salonIds: rows
          .filter((row) => !(row.logo_image_path ?? row.logo_path))
          .map((row) => row.salon_id),
      }),
      getPublicSalonOperatingStatusesBySalonId(salonIds),
    ]);
    const results = rows.map((row) =>
      ({ ...mapExploreRow(
        row,
        signalMap.get(row.salon_id),
        operatingStatusFromMap(operatingStatusMap, row.salon_id),
        logoPathMap.get(row.salon_id),
      ), continuationCursor: row.pagination_cursor }),
    );
    const sections = groupResults(results);
    const groupCounts = {
      bestMatches: sections.bestMatches.length,
      nearby: sections.nearby.length,
      recommended: sections.recommended.length,
    };
    const totalCount = readCount(envelope?.totalCount ?? rows[0]?.total_count ?? results.length);

    return {
      ...metadata(),
      nextCursor: envelope?.hasMore ? envelope.nextCursor ?? envelope.cursor ?? null : null,
      hasMore: envelope ? Boolean(envelope.hasMore) : page < Math.ceil(totalCount / pageSize),
      category,
      error: null,
      errorKind: null,
      countKind: "loaded",
      scope: envelope?.scope,
      sort: input.sort ?? "relevance",
      appliedSort: envelope?.appliedSort,
      supportedSorts: envelope?.supportedSorts,
      sortFallbackReason: envelope?.sortFallbackReason,
      rankVersion: envelope?.rankVersion,
      rankAsOf: envelope?.rankAsOf,
      rankingBasis: envelope?.rankingBasis,
      groupCounts,
      location,
      page,
      pageSize,
      query,
      results,
      sections,
      totalCount,
      totalPages: envelope?.hasMore ? page + 1 : page,
    };
  } catch (error) {
    console.warn("Explore public salon search unavailable", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return { ...emptyResponse({
      category,
      error: exploreSearchErrorMessage(classifyExploreSearchError(error)),
      errorKind: classifyExploreSearchError(error),
      location,
      page,
      pageSize,
      query,
    }), ...metadata() };
  }
}

export async function getExploreWorkspaceLocation(
  context?: CurrentBusinessContext,
): Promise<ExploreInitialLocation> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  if (resolvedContext.user) {
    const client = await createAuthenticatedSupabaseServerClient();
    const [activity, saved] = client ? await Promise.all([
      client.rpc("get_explore_activity_region"),
      client.rpc("get_my_explore_preferences"),
    ]) : [null, null];
    const region = !activity?.error && activity?.data && typeof activity.data === "object" ? activity.data as Record<string, unknown> : null;
    if (region?.source === "activity" && typeof region.label === "string" && region.label.trim()) {
      return {
        label: region.label.trim(), source: "activity",
        confidence: typeof region.confidence === "number" ? region.confidence : undefined,
        evidenceDays: typeof region.evidenceDays === "number" ? region.evidenceDays : undefined,
        lastObservedAt: typeof region.lastObservedAt === "string" ? region.lastObservedAt : null,
      };
    }
    const location = !saved?.error && typeof saved?.data?.location === "string" ? saved.data.location.trim() : "";
    if (location) return { label: location, source: "saved" };
  }
  return { label: "", source: "none" };
}
