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
  averageRating: number | null;
  bookableServiceId: string | null;
  bookableServiceName: string | null;
  bookingEnabled: boolean;
  bookingHref: string | null;
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
  nextAvailabilityLabel: string | null;
  nextAvailableAt: string | null;
  phone: string | null;
  postalCode: string | null;
  profileCompleteness: number;
  relevanceScore: number;
  resultGroup: ExploreResultGroup;
  reviewCount: number;
  serviceCategories: string[];
  serviceNames: string[];
  startingPrice: number | null;
  state: string | null;
};

export type ExploreHomeSalonSection = "near_you" | "new" | "recommended";

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

export type ExploreInspirationCursor = {
  mediaId: string;
  publishedAt: string;
};

export type ExploreInspirationLayoutVariant =
  | "landscape"
  | "portrait"
  | "square";

export type ExploreInspirationItem = {
  aspectRatio: number | null;
  authorDisplayName: string | null;
  authorIsAnonymous: boolean;
  bookableServiceId: string | null;
  bookingEnabled: boolean;
  bookingHref: string | null;
  bookingLabel: string;
  bookingReadiness: string | null;
  captionExcerpt: string | null;
  contentId: string;
  contentType: "look" | "update";
  imageHeight: number | null;
  imageUrl: string;
  imageWidth: number | null;
  layoutVariant: ExploreInspirationLayoutVariant;
  mediaId: string;
  phoneHref: string | null;
  publishedAt: string;
  salonCity: string | null;
  salonHref: string | null;
  salonId: string;
  salonName: string;
  salonState: string | null;
  serviceCategory: string | null;
  serviceName: string | null;
};

export type ExploreInspirationPage = {
  error: string | null;
  hasMore: boolean;
  items: ExploreInspirationItem[];
  nextCursor: ExploreInspirationCursor | null;
};

export type ExploreHomeContent = {
  error: string | null;
  inspiration: ExploreInspirationPage;
  newSalons: ExploreHomeSalon[];
  popularServices: ExplorePopularService[];
  recommendedSalons: ExploreHomeSalon[];
};

export type ExploreNearYouResponse = {
  error: string | null;
  salons: ExploreHomeSalon[];
};

export type ExploreMapSalon = {
  coverImageUrl: string | null;
  distanceMiles: number | null;
  href: string | null;
  id: string;
  latitude: number;
  locationLabel: string | null;
  longitude: number;
  name: string;
  serviceLabel: string | null;
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
