import "server-only";

import {
  EMPTY_EXPLORE_DECISION_SIGNALS,
  getExploreDecisionSignalsBySalonId,
  type ExploreDecisionSignals,
} from "@/lib/explore-decision-signals";
import { loadPublicSalonLogoPaths } from "@/lib/explore-salon-logos";
import { getExploreInspirationPage } from "@/lib/explore-inspiration";
import { searchExploreSalons } from "@/lib/explore-search";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ExploreHomeContent,
  ExploreHomeSalon,
  ExploreHomeSalonSection,
  ExploreNearYouResponse,
  ExplorePopularService,
  ExploreSearchResult,
} from "@/types/explore";

const HOME_RECOMMENDED_LIMIT = 6;
const HOME_NEW_LIMIT = 6;
const HOME_POPULAR_SERVICE_LIMIT = 8;
const HOME_NEAR_YOU_LIMIT = 8;

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

type ExploreHomeSalonRow = {
  active_service_count: number | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  country: string | null;
  cover_image_path?: string | null;
  created_at: string | null;
  description: string | null;
  featured_service_category?: string | null;
  featured_service_name?: string | null;
  has_public_profile?: boolean | null;
  home_rank: number | string | null;
  is_new: boolean | null;
  latitude: number | null;
  latest_media_created_at?: string | null;
  logo_image_path?: string | null;
  logo_path?: string | null;
  longitude: number | null;
  phone: string | null;
  postal_code: string | null;
  profile_completeness: number | null;
  public_discovery_published_at: string | null;
  salon_id: string;
  salon_name: string;
  section: string | null;
  service_categories: string[] | null;
  service_names: string[] | null;
  starting_price?: number | string | null;
  state: string | null;
  updated_at: string | null;
};

type ExplorePopularServiceRow = {
  active_service_count: number | string | null;
  category: string | null;
  salon_count: number | string | null;
};

function emptyHomeContent(error: string | null = null): ExploreHomeContent {
  return {
    error,
    inspiration: {
      error: null,
      hasMore: false,
      items: [],
      nextCursor: null,
    },
    newSalons: [],
    popularServices: [],
    recommendedSalons: [],
  };
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
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

function normalizeHomeSection(
  value: string | null | undefined,
): ExploreHomeSalonSection {
  return value === "new" ? "new" : "recommended";
}

function mapHomeSalonRow(
  row: ExploreHomeSalonRow,
  signals: ExploreDecisionSignals | undefined,
  fallbackLogoPath?: string | null,
): ExploreHomeSalon {
  const homeSection = normalizeHomeSection(row.section);
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
    createdAt: row.created_at,
    description: row.description,
    distanceMiles: null,
    featuredServiceCategory: row.featured_service_category ?? null,
    featuredServiceName: row.featured_service_name ?? null,
    hasPublicProfile: row.has_public_profile === true,
    homeRank: readCount(row.home_rank),
    homeSection,
    id: row.salon_id,
    isNew: row.is_new ?? false,
    latitude: row.latitude,
    latestMediaCreatedAt: row.latest_media_created_at ?? null,
    logoImageUrl: getSalonProfileMediaUrl(
      row.logo_image_path ?? row.logo_path ?? fallbackLogoPath,
    ),
    longitude: row.longitude,
    matchTier: 10,
    matchType: homeSection,
    name: row.salon_name,
    nextAvailabilityLabel: decisionSignals.nextAvailabilityLabel,
    nextAvailableAt: decisionSignals.nextAvailableAt,
    phone: row.phone,
    postalCode: row.postal_code,
    profileCompleteness: row.profile_completeness ?? 0,
    publicDiscoveryPublishedAt: row.public_discovery_published_at,
    reputationNoIssueRate: decisionSignals.noIssueRate,
    relevanceScore: readCount(row.home_rank),
    resultGroup: "recommended",
    sharedExperienceCount: decisionSignals.experienceCount,
    reviewCount: decisionSignals.reviewCount,
    serviceCategories: toStringArray(row.service_categories),
    serviceNames: toStringArray(row.service_names),
    startingPrice: readMoney(row.starting_price),
    state: row.state,
    uniqueCustomerCount: decisionSignals.uniqueCustomerCount,
    updatedAt: row.updated_at,
    verifiedVisitCount: decisionSignals.verifiedVisitCount,
  };
}

function mapPopularServiceRow(
  row: ExplorePopularServiceRow,
): ExplorePopularService | null {
  const category = row.category?.trim();

  if (!category) {
    return null;
  }

  return {
    activeServiceCount: readCount(row.active_service_count),
    category,
    salonCount: readCount(row.salon_count),
  };
}

function mapSearchResultToNearYouSalon(
  result: ExploreSearchResult,
  index: number,
): ExploreHomeSalon {
  return {
    ...result,
    createdAt: null,
    homeRank: index + 1,
    homeSection: "near_you",
    publicDiscoveryPublishedAt: null,
    updatedAt: null,
  };
}

export async function getExploreNearYouSalons(input: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  limit?: number;
}): Promise<ExploreNearYouResponse> {
  const response = await searchExploreSalons({
    latitude: input.latitude,
    longitude: input.longitude,
    page: 1,
    pageSize: Math.min(HOME_NEAR_YOU_LIMIT, Math.max(1, input.limit ?? HOME_NEAR_YOU_LIMIT)),
  });

  if (response.error) {
    return {
      error: response.error,
      salons: [],
    };
  }

  const salons = response.results
    .filter((salon) => salon.distanceMiles !== null)
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
    .slice(0, input.limit ?? HOME_NEAR_YOU_LIMIT)
    .map(mapSearchResultToNearYouSalon);

  return {
    error: null,
    salons,
  };
}

export async function getExploreHomeContent(): Promise<ExploreHomeContent> {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return emptyHomeContent("Explore home content is unavailable.");
  }

  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as RpcRunner;
    const [salonsResponse, servicesResponse, inspiration] = await Promise.all([
      rpc("get_public_explore_home_salons", {
        p_new_limit: HOME_NEW_LIMIT,
        p_recommended_limit: HOME_RECOMMENDED_LIMIT,
      }),
      rpc("get_public_explore_popular_services", {
        p_limit: HOME_POPULAR_SERVICE_LIMIT,
      }),
      getExploreInspirationPage({ diversify: false }),
    ]);
    let error: string | null = null;

    if (salonsResponse.error) {
      console.warn("Explore home salon content unavailable", {
        code: salonsResponse.error.code,
        details: salonsResponse.error.details,
        hint: salonsResponse.error.hint,
        message: salonsResponse.error.message,
      });
      error = "Explore home content could not be loaded.";
    }

    if (servicesResponse.error) {
      console.warn("Explore popular service content unavailable", {
        code: servicesResponse.error.code,
        details: servicesResponse.error.details,
        hint: servicesResponse.error.hint,
        message: servicesResponse.error.message,
      });
      error = "Explore home content could not be loaded.";
    }

    const salonRows = Array.isArray(salonsResponse.data)
      ? (salonsResponse.data as ExploreHomeSalonRow[])
      : [];
    const serviceRows = Array.isArray(servicesResponse.data)
      ? (servicesResponse.data as ExplorePopularServiceRow[])
      : [];
    const signalMap = salonsResponse.error
      ? new Map<string, ExploreDecisionSignals>()
      : await getExploreDecisionSignalsBySalonId(
          rpc,
          salonRows.map((row) => row.salon_id),
        );
    const logoPathMap = salonsResponse.error
      ? new Map<string, string>()
      : await loadPublicSalonLogoPaths({
          rpc,
          salonIds: salonRows
            .filter((row) => !(row.logo_image_path ?? row.logo_path))
            .map((row) => row.salon_id),
        });
    const salons = salonsResponse.error
      ? []
      : salonRows.map((row) =>
          mapHomeSalonRow(
            row,
            signalMap.get(row.salon_id),
            logoPathMap.get(row.salon_id),
          ),
        );

    return {
      error,
      inspiration,
      newSalons: salons.filter((salon) => salon.homeSection === "new"),
      popularServices: servicesResponse.error
        ? []
        : serviceRows
            .map(mapPopularServiceRow)
            .filter((service): service is ExplorePopularService =>
              Boolean(service),
            ),
      recommendedSalons: salons.filter(
        (salon) => salon.homeSection === "recommended",
      ),
    };
  } catch (error) {
    console.warn("Explore home content unavailable", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return emptyHomeContent("Explore home content could not be loaded.");
  }
}
