import type { SalonIdentity } from "@/lib/salon-identity";
import type { LumiTrustCanonicalEvidence } from "@/lib/reylumi-trust";
import type { BeautyPostBookingPresentation } from "@/lib/beauty-booking-verification";
import type { SalonOperatingStatus } from "@/types/salon-operating-status";
import type { AccountSavedPostStateTarget } from "@/types/saved-post";

export const EXPLORE_CATEGORY_OPTIONS = [
  "All",
  "Nails",
  "Hair",
  "Massage",
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
  | "activity"
  | "saved"
  | "workspace";

export type ExploreResultGroup = "best_match" | "nearby" | "recommended" | "reference";
export type ExploreSearchQueryKind = "service" | "style" | "name";
export type ExploreSearchFilters = {
  shape?: string; length?: string; color?: string; finish?: string; tone?: string; season?: string;
  maxPrice?: number; bookableOnly?: boolean; newOnly?: boolean; trendingOnly?: boolean;
};
export type ExploreImageProvenance = "salon_post" | "customer_post" | "salon_cover" | "suggested" | "none";
export type ExploreRecommendationReason = "related_in_area" | "matching_in_broader_area" | "related_in_broader_area" | "matching_in_other_areas" | "related_in_other_areas";

export type ExploreSearchInput = {
  target?: "auto" | "salons" | "posts";
  contentQuery?: string;
  displayQuery?: string;
  queryKind?: ExploreSearchQueryKind;
  locationPriority?: boolean;
  locationOrigin?: "manual" | "query" | "context" | "none";
  filters?: ExploreSearchFilters;
  locationSource?: ExploreLocationSource;
  cursor?: Record<string, unknown> | null;
  hydrateIds?: string[];
  category?: string;
  latitude?: number | null;
  location?: string;
  longitude?: number | null;
  page?: number;
  pageSize?: number;
  query?: string;
  scopePolicy?: "fixed" | "expandable";
  sort?: "relevance" | "trusted" | "bookable" | "closest";
  intent?: "search" | "discover" | "latest";
};

export type ExploreSearchErrorKind = "query" | "timeout" | "network" | "cursor";

export type ExploreSearchScope = {
  policy: "fixed" | "expandable";
  stage: string;
  label: string;
  expanded: boolean;
};

export type ExploreSearchResult = Partial<SalonIdentity> & {
  continuationCursor?: Record<string, unknown>;
  searchScope?: "exact" | "A" | "B" | "C";
  scopeLabel?: string;
  trustEvidence?: LumiTrustCanonicalEvidence | null;
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
  bookableServicePrice?: number | null;
  bookingEnabled: boolean;
  bookingHref: string | null;
  coverImageUrl: string | null;
  imageProvenance?: ExploreImageProvenance;
  imageSourceSalonId?: string | null;
  selectedContentKey?: string | null;
  selectedContentId?: string | null;
  selectedContentType?: string | null;
  selectedMediaPath?: string | null;
  selectedMediaBucket?: string | null;
  mediaRevision?: string | null;
  matchSource?: string;
  isReferenceMatch?: boolean;
  isPrimaryMatch?: boolean;
  recommendationReason?: ExploreRecommendationReason | null;
  recommendationAreaLabel?: string | null;
  featuredServiceCategory: string | null;
  featuredServiceName: string | null;
  hasPublicProfile: boolean;
  id: string;
  isNew: boolean;
  latitude: number | null;
  latestMediaCreatedAt: string | null;
  logoImageUrl: string | null;
  longitude: number | null;
  matchType: string;
  matchTier: number;
  name: string;
  nextAvailabilityLabel: string | null;
  nextAvailableAt: string | null;
  operatingStatus: SalonOperatingStatus;
  phone: string | null;
  postalCode: string | null;
  profileCompleteness: number;
  reputationNoIssueRate: number | null;
  relevanceScore: number;
  resultGroup: ExploreResultGroup;
  sharedExperienceCount: number;
  reviewCount: number;
  serviceCategories: string[];
  serviceNames: string[];
  startingPrice: number | null;
  state: string | null;
  uniqueCustomerCount: number;
  verifiedVisitCount: number;
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
  authorRole?: import("@/lib/post-identity").SalonPostAuthorRole;
  authorStaffId?: string | null;
  commentCount?: number;
  aspectRatio: number | null;
  authorDisplayName: string | null;
  authorIsAnonymous: boolean;
  bookableServiceId: string | null;
  bookingMeta: ExploreBookingDecisionMeta;
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
  saveTarget: AccountSavedPostStateTarget;
  salonCity: string | null;
  salonHref: string | null;
  salonId: string;
  salonLogoImageUrl: string | null;
  salonName: string;
  salonState: string | null;
  operatingStatus: SalonOperatingStatus;
  serviceCategory: string | null;
  serviceName: string | null;
  trust: ExploreFeedTrustSignals;
};

export type ExploreInspirationPage = {
  error: string | null;
  hasMore: boolean;
  items: ExploreInspirationItem[];
  nextCursor: ExploreInspirationCursor | null;
};

export type ExploreFeedCursor = string;

export type ExplorePersonalPostCursor = {
  createdAt: string;
  postId: string;
};

export type ExploreFeedSourceType = "personal" | "salon";

export type ExploreFeedCandidateClass = "organic" | "sponsored";

export type ExploreFeedRankingSignals = {
  engagementVelocityScore: number;
  freshnessScore: number;
  locationAffinityScore: number;
  qualityScore: number;
  relevanceScore: number;
};

export type ExploreFeedAuthor = {
  avatarUrl: string | null;
  id: string;
  kind: "person" | "salon";
  name: string;
};

export type ExploreFeedMedia = {
  aspectRatio: number | null;
  height: number | null;
  id: string;
  imageUrl: string;
  layoutVariant: ExploreInspirationLayoutVariant;
  role: "after" | "before" | "image";
  width: number | null;
};

export type ExploreFeedDestination = {
  href: string | null;
  type: "personal-post" | "salon-post" | "salon-profile";
};

export type ExploreFeedTrustSignals = Partial<SalonIdentity> & {
  trustEvidence?: LumiTrustCanonicalEvidence | null;
  averageRating: number | null;
  noIssueRate: number | null;
  sharedExperienceCount: number;
  uniqueCustomerCount: number;
  verifiedVisitCount: number;
};

export type ExploreFeedSalonContext = {
  city: string | null;
  href: string | null;
  id: string;
  logoImageUrl: string | null;
  name: string;
  operatingStatus: SalonOperatingStatus;
  state: string | null;
  trust: ExploreFeedTrustSignals;
};

export type ExploreFeedBooking = BeautyPostBookingPresentation & {
  readiness: string | null;
  serviceId: string | null;
};

export type ExploreBookingDecisionMeta = {
  availabilityLabel: string | null;
  distanceMiles: number | null;
  durationMinutes: number | null;
  price: number | null;
};

export type ExploreFeedPersonalContext = {
  postType: "before_after" | "regular";
  profileId: string;
};

export type ExploreFeedVerificationState =
  | "pending"
  | "rejected"
  | "unverified"
  | "verified";

export type ExploreFeedVerification = {
  state: ExploreFeedVerificationState;
};

export type ExploreFeedItem = {
  platformIntroduction?: boolean;
  contentKey?: string;
  salonAuthorRole?: import("@/lib/post-identity").SalonPostAuthorRole;
  salonAuthorName?: string | null;
  salonAuthorStaffId?: string | null;
  publishedAtKnown?: boolean;
  discoverySalon?: ExploreHomeSalon;
  discoveryScope?: "local" | "wider";
  author: ExploreFeedAuthor;
  booking: ExploreFeedBooking | null;
  bookingMeta: ExploreBookingDecisionMeta;
  caption: string | null;
  candidateClass: ExploreFeedCandidateClass;
  contentId: string;
  contentType: "beauty_post" | "look" | "salon_recommendation" | "update";
  commentCount: number;
  destination: ExploreFeedDestination;
  feedKey: string;
  id: string;
  media: ExploreFeedMedia[];
  personal: ExploreFeedPersonalContext | null;
  publishedAt: string;
  rankingSignals: ExploreFeedRankingSignals;
  saveTarget: AccountSavedPostStateTarget | null;
  salon: ExploreFeedSalonContext | null;
  serviceCategory: string | null;
  serviceName: string | null;
  sourceSortId: string;
  sourceType: ExploreFeedSourceType;
  verification: ExploreFeedVerification | null;
};

export type ExplorePersonalPostItem = ExploreFeedItem & {
  contentType: "beauty_post";
  personal: ExploreFeedPersonalContext;
  sourceType: "personal";
};

export type ExplorePersonalPostPage = {
  error: string | null;
  hasMore: boolean;
  items: ExplorePersonalPostItem[];
  nextCursor: ExplorePersonalPostCursor | null;
};

export type ExploreFeedPage = {
  sessionCursor?: string | null;
  asOf?: string;
  newestPublishedAt?: string | null;
  scope?: "local" | "wider" | "mixed";
  error: string | null;
  hasMore: boolean;
  items: ExploreFeedItem[];
  nextCursor: ExploreFeedCursor | null;
};

export type ExploreHomeContent = {
  error: string | null;
  inspiration: ExploreInspirationPage;
  newSalons: ExploreHomeSalon[];
  popularServices: ExplorePopularService[];
  recommendedSalons: ExploreHomeSalon[];
};

export type ExploreUpcomingBooking = {
  bookingHref: string;
  endAt: string;
  id: string;
  professionalCount: number;
  salonImageUrl: string | null;
  salonLocation: string | null;
  salonName: string;
  salonTimezone: string;
  serviceSummary: string;
  staffSummary: string;
  startAt: string;
  status: string;
  totalAmount: number;
};

export type ExploreNotificationItem = {
  body: string | null;
  createdAt: string;
  href: string;
  id: string;
  kind: "account" | "booking" | "message" | "offer" | "review";
  read: boolean;
  title: string;
};

export type ExploreUtilityContent = {
  bookingLoadError: boolean;
  notificationLoadError: boolean;
  notifications: ExploreNotificationItem[];
  unreadNotificationCount: number;
  upcomingBooking: ExploreUpcomingBooking | null;
};

export type ExploreDiscoveryResultKind =
  | "available_today"
  | "near_you"
  | "recommended"
  | "top_rated"
  | "trending"
  | "under_60";

export type ExploreDiscoveryShortcutAction =
  | {
      href: string;
      type: "href";
    }
  | {
      category: string;
      type: "category";
    }
  | {
      resultKind: ExploreDiscoveryResultKind;
      type: "result";
    };

export type ExploreDiscoveryPreview = {
  alt: string;
  imageUrl: string;
  label: string | null;
  meta: string | null;
  sourceId: string;
};

export type ExploreDiscoveryModuleKind =
  | "availability"
  | "booking"
  | "category"
  | "nearby"
  | "recommended"
  | "top_rated"
  | "value"
  | "visual";

export type ExploreDiscoveryShortcut = {
  action: ExploreDiscoveryShortcutAction;
  actionLabel: string;
  context: string | null;
  detail: string | null;
  id: string;
  label: string;
  moduleKind: ExploreDiscoveryModuleKind;
  previews: ExploreDiscoveryPreview[];
};

export type ExploreDiscoveryContent = {
  shortcuts: ExploreDiscoveryShortcut[];
};

export type ExploreNearYouResponse = {
  error: string | null;
  salons: ExploreHomeSalon[];
};

export type ExploreMapSalon = {
  bookingHref?:string|null;
  phoneHref?:string|null;
  coverImageUrl: string | null;
  distanceMiles: number | null;
  href: string | null;
  id: string;
  latitude: number;
  locationLabel: string | null;
  longitude: number;
  name: string;
  operatingStatus: SalonOperatingStatus;
  serviceLabel: string | null;
  trust: ExploreFeedTrustSignals;
};

export type ExploreSearchSections = {
  bestMatches: ExploreSearchResult[];
  nearby: ExploreSearchResult[];
  recommended: ExploreSearchResult[];
  reference?: ExploreSearchResult[];
};

export type ExploreSearchGroupCounts = {
  bestMatches: number;
  nearby: number;
  recommended: number;
  reference?: number;
};

export type ExploreSearchResponse = {
  target?: "salons" | "posts";
  intent?: ExploreSearchInput["intent"];
  searchVersion?: 3;
  queryKind?: ExploreSearchQueryKind;
  locationPriority?: boolean;
  filters?: ExploreSearchFilters;
  contentQuery?: string;
  displayQuery?: string;
  locationOrigin?: "manual" | "query" | "context" | "none";
  locationSource?: ExploreLocationSource;
  requiresGps?: boolean;
  areaAmbiguous?: boolean;
  locationConflict?: boolean;
  queryLocationHint?: string;
  addressStatus?: "resolved" | "ambiguous" | "unmatched";
  addressQuery?: string;
  lookupFailed?: boolean;
  areaCandidates?: Array<{ kind: "city"; label: string; city: string; stateCode: string | null }>;
  appliedSort?: string;
  supportedSorts?: string[];
  sortFallbackReason?: string | null;
  rankVersion?: number | null;
  rankAsOf?: string | null;
  rankingBasis?: "indexed_scope" | "candidate_pool" | "unified_indexed_scope";
  sort?: ExploreSearchInput["sort"];
  errorKind?: ExploreSearchErrorKind | null;
  countKind?: "exact" | "loaded";
  scope?: ExploreSearchScope;
  nextCursor?: Record<string, unknown> | null;
  sessionCursor?: Record<string, unknown> | null;
  hasMore?: boolean;
  category: string;
  error: string | null;
  groupCounts: ExploreSearchGroupCounts;
  /** Unique hydrated rows on this page, not an exact total of all matches. */
  primaryCount?: number;
  referenceCount?: number;
  /** Server-derived suggestion category; never replaces the canonical category filter. */
  recommendationCategory?: string | null;
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
  confidence?: number;
  evidenceDays?: number;
  lastObservedAt?: string | null;
  label: string;
  source: ExploreLocationSource;
};
