import type { BeautyPostBookingPresentation } from "@/lib/beauty-booking-verification";
import type { AccountSavedPostStateTarget } from "@/types/saved-post";

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
  logoImageUrl: string | null;
  longitude: number | null;
  matchType: string;
  matchTier: number;
  name: string;
  nextAvailabilityLabel: string | null;
  nextAvailableAt: string | null;
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
  saveTarget: AccountSavedPostStateTarget;
  salonCity: string | null;
  salonHref: string | null;
  salonId: string;
  salonLogoImageUrl: string | null;
  salonName: string;
  salonState: string | null;
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

export type ExploreFeedTrustSignals = {
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
  state: string | null;
  trust: ExploreFeedTrustSignals;
};

export type ExploreFeedBooking = BeautyPostBookingPresentation & {
  readiness: string | null;
  serviceId: string | null;
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
  author: ExploreFeedAuthor;
  booking: ExploreFeedBooking | null;
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
  | "near_you"
  | "recommended"
  | "top_rated"
  | "trending";

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
  | "booking"
  | "category"
  | "nearby"
  | "recommended"
  | "top_rated"
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
  coverImageUrl: string | null;
  distanceMiles: number | null;
  href: string | null;
  id: string;
  latitude: number;
  locationLabel: string | null;
  longitude: number;
  name: string;
  serviceLabel: string | null;
  trust: ExploreFeedTrustSignals;
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
