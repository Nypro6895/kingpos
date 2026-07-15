import "server-only";

import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ExploreHomeContent,
  ExploreHomeSalon,
  ExploreHomeSalonSection,
  ExplorePopularService,
} from "@/types/explore";

const HOME_RECOMMENDED_LIMIT = 6;
const HOME_NEW_LIMIT = 6;
const HOME_POPULAR_SERVICE_LIMIT = 8;

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

function mapHomeSalonRow(row: ExploreHomeSalonRow): ExploreHomeSalon {
  const homeSection = normalizeHomeSection(row.section);

  return {
    activeServiceCount: row.active_service_count ?? 0,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
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
    longitude: row.longitude,
    matchTier: 10,
    matchType: homeSection,
    name: row.salon_name,
    phone: row.phone,
    postalCode: row.postal_code,
    profileCompleteness: row.profile_completeness ?? 0,
    publicDiscoveryPublishedAt: row.public_discovery_published_at,
    relevanceScore: readCount(row.home_rank),
    resultGroup: "recommended",
    serviceCategories: toStringArray(row.service_categories),
    serviceNames: toStringArray(row.service_names),
    startingPrice: readMoney(row.starting_price),
    state: row.state,
    updatedAt: row.updated_at,
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

export async function getExploreHomeContent(): Promise<ExploreHomeContent> {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return emptyHomeContent("Explore home content is unavailable.");
  }

  try {
    const rpc = supabase.rpc.bind(supabase) as unknown as RpcRunner;
    const [salonsResponse, servicesResponse] = await Promise.all([
      rpc("get_public_explore_home_salons", {
        p_new_limit: HOME_NEW_LIMIT,
        p_recommended_limit: HOME_RECOMMENDED_LIMIT,
      }),
      rpc("get_public_explore_popular_services", {
        p_limit: HOME_POPULAR_SERVICE_LIMIT,
      }),
    ]);
    let error: string | null = null;

    if (salonsResponse.error) {
      console.error("Explore home salon content failed", {
        code: salonsResponse.error.code,
        details: salonsResponse.error.details,
        hint: salonsResponse.error.hint,
        message: salonsResponse.error.message,
      });
      error = "Explore home content could not be loaded.";
    }

    if (servicesResponse.error) {
      console.error("Explore popular service content failed", {
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
    const salons = salonsResponse.error ? [] : salonRows.map(mapHomeSalonRow);

    return {
      error,
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
    console.error("Explore home content crashed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return emptyHomeContent("Explore home content could not be loaded.");
  }
}
