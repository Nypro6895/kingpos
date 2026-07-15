export const EXPLORE_CATEGORY_OPTIONS = [
  "All",
  "Manicure",
  "Pedicure",
  "Gel",
  "Acrylic",
  "Nail Art",
  "Waxing",
  "Spa",
] as const;

export type ExploreCategoryOption = (typeof EXPLORE_CATEGORY_OPTIONS)[number];

export type ExploreLocationSource =
  | "gps"
  | "manual"
  | "none"
  | "saved"
  | "workspace";

export type ExploreResultGroup = "best_match" | "nearby" | "recommended";

export type ExploreSearchInput = {
  category?: string;
  latitude?: number | null;
  location?: string;
  longitude?: number | null;
  page?: number;
  pageSize?: number;
  query?: string;
};

export type ExploreSearchResult = {
  activeServiceCount: number;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string | null;
  description: string | null;
  distanceMiles: number | null;
  coverImageUrl: string | null;
  featuredServiceCategory: string | null;
  featuredServiceName: string | null;
  hasPublicProfile: boolean;
  id: string;
  isNew: boolean;
  latitude: number | null;
  latestMediaCreatedAt: string | null;
  longitude: number | null;
  matchType: string;
  matchTier: number;
  name: string;
  phone: string | null;
  postalCode: string | null;
  profileCompleteness: number;
  relevanceScore: number;
  resultGroup: ExploreResultGroup;
  serviceCategories: string[];
  serviceNames: string[];
  startingPrice: number | null;
  state: string | null;
};

export type ExploreHomeSalonSection = "new" | "recommended";

export type ExploreHomeSalon = ExploreSearchResult & {
  createdAt: string | null;
  homeRank: number;
  homeSection: ExploreHomeSalonSection;
  publicDiscoveryPublishedAt: string | null;
  updatedAt: string | null;
};

export type ExplorePopularService = {
  activeServiceCount: number;
  category: string;
  salonCount: number;
};

export type ExploreHomeContent = {
  error: string | null;
  newSalons: ExploreHomeSalon[];
  popularServices: ExplorePopularService[];
  recommendedSalons: ExploreHomeSalon[];
};

export type ExploreSearchSections = {
  bestMatches: ExploreSearchResult[];
  nearby: ExploreSearchResult[];
  recommended: ExploreSearchResult[];
};

export type ExploreSearchGroupCounts = {
  bestMatches: number;
  nearby: number;
  recommended: number;
};

export type ExploreSearchResponse = {
  category: string;
  error: string | null;
  groupCounts: ExploreSearchGroupCounts;
  location: string;
  page: number;
  pageSize: number;
  query: string;
  results: ExploreSearchResult[];
  sections: ExploreSearchSections;
  totalCount: number;
  totalPages: number;
};

export type ExploreInitialLocation = {
  label: string;
  source: ExploreLocationSource;
};
