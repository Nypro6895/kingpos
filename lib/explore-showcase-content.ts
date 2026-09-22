import type {
  ExploreDiscoveryContent,
  ExploreDiscoveryShortcut,
  ExploreFeedItem,
  ExploreFeedPage,
  ExploreHomeContent,
  ExploreHomeSalon,
  ExploreInspirationItem,
  ExplorePopularService,
  ExploreSearchResponse,
  ExploreSearchResult,
} from "@/types/explore";
import type { SalonOperatingStatus } from "@/types/salon-operating-status";

const SHOWCASE_IMAGE = "/explore/mockup-look-softpink.webp";
const SHOWCASE_CHROME_IMAGE = "/explore/mockup-look-chrome.webp";
const SHOWCASE_FLORAL_IMAGE = "/explore/mockup-look-floral.webp";
const SHOWCASE_NUDE_IMAGE = "/explore/mockup-look-nude.webp";
const SHOWCASE_PINK_IMAGE = "/explore/mockup-look-pink.webp";
const SHOWCASE_RED_IMAGE = "/explore/mockup-look-red.webp";
const SHOWCASE_CITY = "Milwaukee";
const SHOWCASE_STATE = "WI";
const SHOWCASE_LOCATION = `${SHOWCASE_CITY}, ${SHOWCASE_STATE}`;
const FEED_TARGET_COUNT = 9;
const HOME_SALON_TARGET_COUNT = 7;
const SEARCH_TARGET_COUNT = 6;

type ShowcaseSalonSeed = {
  category: string;
  distanceMiles: number;
  durationMinutes: number;
  imageUrl: string;
  name: string;
  price: number;
  rank: number;
  rating: number;
  reviews: number;
  service: string;
  slot: string;
  tone: "available" | "new" | "top" | "trending" | "value";
};

export type ExploreShowcaseRelatedLook = {
  availability: string;
  distanceMiles: number;
  href: string;
  id: string;
  imageUrl: string;
  price: number;
  rating: number;
  reviews: number;
  salonName: string;
  service: string;
};

export type ExploreShowcaseLookPage = {
  availability: string;
  bookingHref: string;
  category: string;
  description: string;
  distanceMiles: number;
  durationMinutes: number;
  gallery: ExploreShowcaseRelatedLook[];
  heroTitle: string;
  id: string;
  imageUrl: string;
  price: number;
  rating: number;
  related: ExploreShowcaseRelatedLook[];
  reviews: number;
  salonName: string;
  searchHref: string;
  service: string;
  slots: string[];
  stats: {
    booked: number;
    photos: number;
    saves: number;
    videos: number;
  };
  tags: string[];
};

const SHOWCASE_SALONS: ShowcaseSalonSeed[] = [
  {
    category: "Nails",
    distanceMiles: 2.3,
    durationMinutes: 90,
    imageUrl: SHOWCASE_CHROME_IMAGE,
    name: "King Nails",
    price: 55,
    rank: 1,
    rating: 4.9,
    reviews: 420,
    service: "Acrylic Full Set",
    slot: "Available today",
    tone: "trending",
  },
  {
    category: "Nails",
    distanceMiles: 0.8,
    durationMinutes: 105,
    imageUrl: SHOWCASE_IMAGE,
    name: "Luxe Nail Studio",
    price: 60,
    rank: 2,
    rating: 4.8,
    reviews: 318,
    service: "Gel X Full Set",
    slot: "Available today",
    tone: "available",
  },
  {
    category: "Nails",
    distanceMiles: 2.3,
    durationMinutes: 90,
    imageUrl: SHOWCASE_FLORAL_IMAGE,
    name: "Polish Palace",
    price: 50,
    rank: 3,
    rating: 4.9,
    reviews: 512,
    service: "Floral Set",
    slot: "Available tomorrow",
    tone: "top",
  },
  {
    category: "Nails",
    distanceMiles: 2.8,
    durationMinutes: 60,
    imageUrl: SHOWCASE_RED_IMAGE,
    name: "Nail Artistry",
    price: 45,
    rank: 4,
    rating: 4.7,
    reviews: 209,
    service: "French Tip",
    slot: "Available today",
    tone: "value",
  },
  {
    category: "Lashes",
    distanceMiles: 1.9,
    durationMinutes: 75,
    imageUrl: SHOWCASE_PINK_IMAGE,
    name: "Lash Room MKE",
    price: 58,
    rank: 5,
    rating: 4.8,
    reviews: 164,
    service: "Classic Lash Fill",
    slot: "3 spots today",
    tone: "available",
  },
  {
    category: "Brows",
    distanceMiles: 3.1,
    durationMinutes: 45,
    imageUrl: SHOWCASE_NUDE_IMAGE,
    name: "Brow Theory",
    price: 38,
    rank: 6,
    rating: 4.7,
    reviews: 96,
    service: "Brow Lamination",
    slot: "Available today",
    tone: "value",
  },
  {
    category: "Spa",
    distanceMiles: 3.6,
    durationMinutes: 60,
    imageUrl: SHOWCASE_IMAGE,
    name: "Glow Spa House",
    price: 59,
    rank: 7,
    rating: 4.8,
    reviews: 137,
    service: "Express Facial",
    slot: "Open this afternoon",
    tone: "new",
  },
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function recentIso(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

function showcaseStatus(seed: ShowcaseSalonSeed): SalonOperatingStatus {
  const today = todayIsoDate();
  const isOpen = seed.tone !== "new";

  return {
    checkedAt: recentIso(0),
    closesAtLocal: isOpen ? "7:00 PM" : null,
    detail: isOpen ? "Open booking times today" : "Publishing this week",
    isOpen,
    kind: isOpen ? "open" : "closed",
    label: isOpen ? "Open" : "New",
    localDate: today,
    nextOpensAtLocal: isOpen ? null : "10:00 AM",
    nextOpensLabel: isOpen ? null : "Opens tomorrow",
    reason: null,
    source: "weekly_hours",
    timeZone: "America/Chicago",
    tone: isOpen ? "open" : "muted",
  };
}

function cleanNeedle(value: string) {
  return value.trim().toLowerCase();
}

function showcaseNameKey(value: string) {
  return cleanNeedle(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function showcaseSeedForName(name: string) {
  const key = showcaseNameKey(name);

  return SHOWCASE_SALONS.find((seed) => showcaseNameKey(seed.name) === key) ?? null;
}

function isWeakAvailabilityLabel(label: string | null) {
  return !label || /request|call|contact|ask/i.test(label);
}

function showcaseLookId(seed: ShowcaseSalonSeed) {
  return `showcase-look-${seed.rank}`;
}

function showcaseLookSlug(seed: ShowcaseSalonSeed) {
  return seed.service.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function getExploreShowcaseLookHref(lookId: string) {
  return `/explore/looks/${encodeURIComponent(lookId)}`;
}

function showcaseLookHref(seed: ShowcaseSalonSeed) {
  return getExploreShowcaseLookHref(showcaseLookId(seed));
}

function sampleSearchHref(seed: ShowcaseSalonSeed) {
  const params = new URLSearchParams({
    category: seed.category,
    location: SHOWCASE_LOCATION,
    q: seed.service,
  });

  return `/explore?${params.toString()}`;
}

function showcaseDescription(seed: ShowcaseSalonSeed) {
  if (seed.tone === "trending") {
    return "Custom acrylic full set with hand-painted abstract swirl design. Glossy black, soft pink, and nude tones make it easy to compare this look across nearby artists.";
  }

  return `${seed.service} from ${seed.name}, prepared as a realistic Reylumi sample with visible pricing, appointment length, rating, distance, and open booking context.`;
}

function showcaseTags(seed: ShowcaseSalonSeed) {
  if (seed.category === "Nails") {
    return ["Acrylic", "Hand-painted", "Glossy", "Nail art"];
  }

  return [seed.category, "Verified", "Bookable", "Near you"];
}

function showcaseRelatedLook(seed: ShowcaseSalonSeed): ExploreShowcaseRelatedLook {
  return {
    availability: seed.slot,
    distanceMiles: seed.distanceMiles,
    href: showcaseLookHref(seed),
    id: showcaseLookId(seed),
    imageUrl: seed.imageUrl,
    price: seed.price,
    rating: seed.rating,
    reviews: seed.reviews,
    salonName: seed.name,
    service: seed.service,
  };
}

export function getExploreShowcaseLookPage(
  lookId: string,
): ExploreShowcaseLookPage | null {
  const seed = SHOWCASE_SALONS.find(
    (item) =>
      showcaseLookId(item) === lookId || showcaseLookSlug(item) === lookId,
  );

  if (!seed) {
    return null;
  }

  const related = SHOWCASE_SALONS.filter((item) => item.rank !== seed.rank).map(
    showcaseRelatedLook,
  );

  return {
    availability: seed.slot,
    bookingHref: sampleSearchHref(seed),
    category: seed.category,
    description: showcaseDescription(seed),
    distanceMiles: seed.distanceMiles,
    durationMinutes: seed.durationMinutes,
    gallery: [
      showcaseRelatedLook(seed),
      ...related,
    ].slice(0, 6),
    heroTitle: seed.tone === "trending" ? "Chrome Season" : seed.service,
    id: showcaseLookId(seed),
    imageUrl: seed.imageUrl,
    price: seed.price,
    rating: seed.rating,
    related,
    reviews: seed.reviews,
    salonName: seed.name,
    searchHref: sampleSearchHref(seed),
    service: seed.service,
    slots:
      seed.slot.toLowerCase().includes("today") ||
      seed.slot.toLowerCase().includes("spots")
        ? ["2:30 PM", "3:30 PM", "4:30 PM", "5:30 PM"]
        : ["Tomorrow", "11:00 AM", "1:30 PM", "4:00 PM"],
    stats: {
      booked: seed.tone === "trending" ? 128 : seed.rank * 7,
      photos: 56,
      saves: 32 + seed.reviews,
      videos: seed.rank % 3 === 0 ? 6 : 8,
    },
    tags: showcaseTags(seed),
  };
}

function showcaseTrust(seed: ShowcaseSalonSeed) {
  return {
    averageRating: seed.rating,
    noIssueRate: 98,
    sharedExperienceCount: seed.reviews,
    uniqueCustomerCount: Math.max(24, Math.round(seed.reviews * 0.62)),
    verifiedVisitCount: Math.max(12, Math.round(seed.reviews * 0.38)),
  };
}

function showcaseHomeSalon(seed: ShowcaseSalonSeed): ExploreHomeSalon {
  const href = showcaseLookHref(seed);
  const status = showcaseStatus(seed);

  return {
    activeServiceCount: 6,
    addressLine1: null,
    addressLine2: null,
    averageRating: seed.rating,
    bookableServiceId: `showcase-service-${seed.rank}`,
    bookableServiceName: seed.service,
    bookingEnabled: true,
    bookingHref: href,
    city: SHOWCASE_CITY,
    country: "US",
    coverImageUrl: seed.imageUrl,
    createdAt: recentIso(seed.rank + 1),
    description: `${seed.name} is a sample Reylumi discovery card for ${seed.service.toLowerCase()}, price context, availability, and quick booking intent.`,
    distanceMiles: seed.distanceMiles,
    featuredServiceCategory: seed.category,
    featuredServiceName: seed.service,
    hasPublicProfile: false,
    homeRank: seed.rank,
    homeSection: seed.tone === "new" ? "new" : "recommended",
    id: `showcase-${seed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    isNew: seed.tone === "new",
    latestMediaCreatedAt: recentIso(seed.rank),
    latitude: null,
    logoImageUrl: null,
    longitude: null,
    matchTier: 1,
    matchType: seed.tone,
    name: seed.name,
    nextAvailabilityLabel: seed.slot,
    nextAvailableAt: recentIso(0),
    operatingStatus: status,
    phone: null,
    postalCode: null,
    profileCompleteness: 92,
    publicDiscoveryPublishedAt: recentIso(seed.rank),
    relevanceScore: 86 - seed.rank,
    reputationNoIssueRate: 98,
    resultGroup: seed.tone === "available" ? "nearby" : "recommended",
    reviewCount: seed.reviews,
    serviceCategories: [seed.category, "Acrylic", "Gel", "Nail Art", "Chrome"],
    serviceNames: [seed.service],
    sharedExperienceCount: seed.reviews,
    startingPrice: seed.price,
    state: SHOWCASE_STATE,
    uniqueCustomerCount: Math.max(28, Math.round(seed.reviews * 0.58)),
    updatedAt: recentIso(seed.rank),
    verifiedVisitCount: Math.max(18, Math.round(seed.reviews * 0.42)),
  };
}

function showcaseInspiration(seed: ShowcaseSalonSeed): ExploreInspirationItem {
  return {
    aspectRatio: seed.rank % 2 === 0 ? 1.25 : 0.9,
    authorDisplayName: seed.name,
    authorIsAnonymous: false,
    bookableServiceId: `showcase-service-${seed.rank}`,
    bookingEnabled: true,
    bookingHref: showcaseLookHref(seed),
    bookingLabel: `Book this look - $${seed.price}+`,
    bookingMeta: {
      availabilityLabel: seed.slot,
      distanceMiles: seed.distanceMiles,
      durationMinutes: seed.durationMinutes,
      price: seed.price,
    },
    bookingReadiness: "sample",
    captionExcerpt: `${seed.service} with a polished Reylumi-ready look, availability, price, and service context.`,
    contentId: showcaseLookId(seed),
    contentType: "look",
    imageHeight: null,
    imageUrl: seed.imageUrl,
    imageWidth: null,
    layoutVariant: seed.rank % 2 === 0 ? "landscape" : "portrait",
    mediaId: `showcase-media-${seed.rank}`,
    operatingStatus: showcaseStatus(seed),
    phoneHref: null,
    publishedAt: recentIso(seed.rank),
    saveTarget: {
      salonId: `showcase-${seed.rank}`,
      saved: false,
      saveCount: 20 + seed.reviews,
      sourceId: showcaseLookId(seed),
      sourceType: "salon_profile_look",
    },
    salonCity: SHOWCASE_CITY,
    salonHref: showcaseLookHref(seed),
    salonId: `showcase-${seed.rank}`,
    salonLogoImageUrl: null,
    salonName: seed.name,
    salonState: SHOWCASE_STATE,
    serviceCategory: seed.category,
    serviceName: seed.service,
    trust: showcaseTrust(seed),
  };
}

function showcaseFeedItem(seed: ShowcaseSalonSeed): ExploreFeedItem {
  const salonId = `showcase-${seed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const href = showcaseLookHref(seed);
  const status = showcaseStatus(seed);

  return {
    author: {
      avatarUrl: null,
      id: salonId,
      kind: "salon",
      name: seed.name,
    },
    booking: {
      bookedCount: seed.tone === "trending" ? 128 : seed.rank * 7,
      eligible: true,
      href,
      label: "Book",
      readiness: "sample",
      salonId,
      salonName: seed.name,
      serviceId: `showcase-service-${seed.rank}`,
    },
    bookingMeta: {
      availabilityLabel: seed.slot,
      distanceMiles: seed.distanceMiles,
      durationMinutes: seed.durationMinutes,
      price: seed.price,
    },
    candidateClass: "organic",
    caption:
      seed.tone === "trending"
        ? "Chrome Season is trending locally. Compare artists, prices, and open times in one scroll."
        : `${seed.service} from ${seed.name}. Sample content keeps Explore feeling full until customer posts arrive.`,
    commentCount: seed.rank + 1,
    contentId: `showcase-feed-${seed.rank}`,
    contentType: "salon_recommendation",
    destination: {
      href,
      type: "salon-profile",
    },
    feedKey:
      seed.tone === "trending"
        ? "showcase:hero:chrome-season"
        : `showcase:salon:${salonId}`,
    id: `showcase-feed-${seed.rank}`,
    media: [
      {
        aspectRatio: seed.tone === "trending" ? 0.82 : 1.62,
        height: null,
        id:
          seed.tone === "trending"
            ? "showcase-media-chrome-hero"
            : `showcase-media-feed-${seed.rank}`,
        imageUrl: seed.imageUrl,
        layoutVariant: seed.tone === "trending" ? "portrait" : "landscape",
        role: "image",
        width: null,
      },
    ],
    personal: null,
    publishedAt: recentIso(seed.rank),
    rankingSignals: {
      engagementVelocityScore: 78 - seed.rank,
      freshnessScore: 90 - seed.rank,
      locationAffinityScore: Math.max(60, 92 - seed.distanceMiles * 8),
      qualityScore: 88 - seed.rank,
      relevanceScore: 86 - seed.rank,
    },
    saveTarget: {
      salonId,
      saved: false,
      saveCount: 32 + seed.reviews,
      sourceId: `showcase-feed-${seed.rank}`,
      sourceType: "salon_profile_look",
    },
    salon: {
      city: SHOWCASE_CITY,
      href,
      id: salonId,
      logoImageUrl: null,
      name: seed.name,
      operatingStatus: status,
      state: SHOWCASE_STATE,
      trust: showcaseTrust(seed),
    },
    serviceCategory: seed.category,
    serviceName: seed.service,
    sourceSortId: `showcase:${String(seed.rank).padStart(4, "0")}`,
    sourceType: "salon",
    verification: { state: "verified" },
  };
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

function dedupeByFeedKey(items: ExploreFeedItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.feedKey)) {
      return false;
    }

    seen.add(item.feedKey);
    return true;
  });
}

function dedupeInspiration(items: ExploreInspirationItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = item.mediaId || item.contentId;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function matchesSearchIntent(seed: ShowcaseSalonSeed, response: ExploreSearchResponse) {
  const category = cleanNeedle(response.category);
  const query = cleanNeedle(response.query);
  const haystack = cleanNeedle(
    [seed.name, seed.service, seed.category, seed.slot].join(" "),
  );

  if (category && category !== "all" && !haystack.includes(category)) {
    return false;
  }

  if (query && !haystack.includes(query)) {
    return false;
  }

  return true;
}

function ensurePopularServices(services: ExplorePopularService[]) {
  const merged = [...services];
  const seen = new Set(services.map((service) => cleanNeedle(service.category)));

  for (const service of [
    { activeServiceCount: 9, category: "Nails", salonCount: 5 },
    { activeServiceCount: 4, category: "Lashes", salonCount: 1 },
    { activeServiceCount: 3, category: "Brows", salonCount: 1 },
    { activeServiceCount: 4, category: "Spa", salonCount: 1 },
  ]) {
    if (!seen.has(cleanNeedle(service.category))) {
      merged.push(service);
      seen.add(cleanNeedle(service.category));
    }
  }

  return merged;
}

function mergeSearchResults(
  response: ExploreSearchResponse,
  samples: ExploreHomeSalon[],
): ExploreSearchResponse {
  function mergeShowcasePresentation(
    salon: ExploreSearchResult,
  ): ExploreSearchResult {
    const seed = showcaseSeedForName(salon.name);

    if (!seed) {
      return salon;
    }

    const sample = samples.find((item) => item.name === seed.name);

    if (!sample) {
      return salon;
    }

    const shouldUseSampleAvailability = isWeakAvailabilityLabel(
      salon.nextAvailabilityLabel,
    );
    const shouldUseSampleStatus =
      shouldUseSampleAvailability ||
      (!salon.operatingStatus.isOpen && sample.operatingStatus.isOpen);

    return {
      ...salon,
      averageRating: salon.averageRating ?? sample.averageRating,
      bookableServiceId: salon.bookableServiceId ?? sample.bookableServiceId,
      bookableServiceName:
        salon.bookableServiceName ?? sample.bookableServiceName,
      bookingEnabled: salon.bookingEnabled || sample.bookingEnabled,
      bookingHref: salon.bookingHref ?? sample.bookingHref,
      coverImageUrl: salon.coverImageUrl ?? sample.coverImageUrl,
      distanceMiles: salon.distanceMiles ?? sample.distanceMiles,
      featuredServiceCategory:
        salon.featuredServiceCategory ?? sample.featuredServiceCategory,
      featuredServiceName:
        salon.featuredServiceName ?? sample.featuredServiceName,
      latestMediaCreatedAt:
        salon.latestMediaCreatedAt ?? sample.latestMediaCreatedAt,
      nextAvailabilityLabel: shouldUseSampleAvailability
        ? sample.nextAvailabilityLabel
        : salon.nextAvailabilityLabel,
      nextAvailableAt: shouldUseSampleAvailability
        ? sample.nextAvailableAt
        : salon.nextAvailableAt ?? sample.nextAvailableAt,
      operatingStatus: shouldUseSampleStatus
        ? sample.operatingStatus
        : salon.operatingStatus,
      reviewCount: Math.max(salon.reviewCount, sample.reviewCount),
      sharedExperienceCount: Math.max(
        salon.sharedExperienceCount,
        sample.sharedExperienceCount,
      ),
      startingPrice: salon.startingPrice ?? sample.startingPrice,
      uniqueCustomerCount: Math.max(
        salon.uniqueCustomerCount,
        sample.uniqueCustomerCount,
      ),
      verifiedVisitCount: Math.max(
        salon.verifiedVisitCount,
        sample.verifiedVisitCount,
      ),
    };
  }

  function mergeShowcasePresentations(salons: ExploreSearchResult[]) {
    return salons.map(mergeShowcasePresentation);
  }

  const sampleResults = samples.filter((salon) =>
    matchesSearchIntent(
      SHOWCASE_SALONS.find((seed) => salon.id.includes(cleanNeedle(seed.name).replace(/\s+/g, "-"))) ??
        SHOWCASE_SALONS[0],
      response,
    ),
  );
  const responseBestMatches = mergeShowcasePresentations(
    response.sections.bestMatches,
  );
  const responseNearby = mergeShowcasePresentations(response.sections.nearby);
  const responseRecommended = mergeShowcasePresentations(
    response.sections.recommended,
  );
  const responseResults = mergeShowcasePresentations(response.results);
  const bestMatches = dedupeById([
    ...responseBestMatches,
    ...sampleResults.slice(0, SEARCH_TARGET_COUNT),
  ]);
  const nearby = dedupeById([
    ...responseNearby,
    ...sampleResults.filter((salon) => salon.distanceMiles !== null),
  ]);
  const recommended = dedupeById([
    ...responseRecommended,
    ...sampleResults,
  ]);
  const results = dedupeById([
    ...responseResults,
    ...bestMatches,
    ...nearby,
    ...recommended,
  ]);
  const totalCount = Math.max(response.totalCount, results.length);

  return {
    ...response,
    groupCounts: {
      bestMatches: bestMatches.length,
      nearby: nearby.length,
      recommended: recommended.length,
    },
    results,
    sections: {
      bestMatches,
      nearby,
      recommended,
    },
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / response.pageSize)),
  };
}

function ensureDiscoveryShortcuts(
  discoveryContent: ExploreDiscoveryContent,
  samples: ExploreHomeSalon[],
): ExploreDiscoveryContent {
  const existing = new Set(discoveryContent.shortcuts.map((shortcut) => shortcut.id));
  const samplePreviews = samples.slice(0, 3).map((salon) => ({
    alt: `${salon.name} sample preview`,
    imageUrl: salon.coverImageUrl ?? SHOWCASE_IMAGE,
    label: salon.name,
    meta: salon.nextAvailabilityLabel,
    sourceId: `showcase-preview-${salon.id}`,
  }));
  const additions: ExploreDiscoveryShortcut[] = [];

  function add(shortcut: ExploreDiscoveryShortcut) {
    if (!existing.has(shortcut.id)) {
      additions.push(shortcut);
      existing.add(shortcut.id);
    }
  }

  add({
    action: { resultKind: "near_you", type: "result" },
    actionLabel: "Book same-day",
    context: "Today",
    detail: "Open spots near you",
    id: "near-you",
    label: "Available near you",
    moduleKind: "nearby",
    previews: samplePreviews,
  });
  add({
    action: { resultKind: "top_rated", type: "result" },
    actionLabel: "Highly reviewed",
    context: "4.8+ stars",
    detail: "Top rated artists in your area",
    id: "top-rated",
    label: "Top rated artists",
    moduleKind: "top_rated",
    previews: samplePreviews,
  });
  add({
    action: { resultKind: "trending", type: "result" },
    actionLabel: "Popular styles",
    context: "Right now",
    detail: "Chrome, floral, and soft pink sets",
    id: "trending",
    label: "Trending looks",
    moduleKind: "visual",
    previews: samplePreviews,
  });
  add({
    action: { resultKind: "under_60", type: "result" },
    actionLabel: "Budget-friendly",
    context: "Beautiful & budget",
    detail: "Looks and services under $60",
    id: "under-60",
    label: "Under $60",
    moduleKind: "value",
    previews: samplePreviews,
  });
  add({
    action: { category: "Nails", type: "category" },
    actionLabel: "Discover talent",
    context: "New",
    detail: "New artists near you",
    id: "new-artists",
    label: "New artists near you",
    moduleKind: "category",
    previews: samplePreviews,
  });

  return {
    shortcuts: [...discoveryContent.shortcuts, ...additions].slice(0, 5),
  };
}

export function enrichExploreShowcaseContent(input: {
  discoveryContent: ExploreDiscoveryContent;
  homeContent: ExploreHomeContent;
  initialFeed: ExploreFeedPage;
  searchResponse: ExploreSearchResponse;
}) {
  const currentSalonCount =
    input.homeContent.recommendedSalons.length + input.homeContent.newSalons.length;
  const currentFeedSalons = new Set(
    input.initialFeed.items.map((item) => item.salon?.name).filter(Boolean),
  ).size;
  const shouldAddShowcase =
    currentSalonCount < HOME_SALON_TARGET_COUNT ||
    input.initialFeed.items.length < FEED_TARGET_COUNT ||
    currentFeedSalons < 4;
  const samples = shouldAddShowcase
    ? SHOWCASE_SALONS.map(showcaseHomeSalon)
    : [];
  const showcaseFeedItems = shouldAddShowcase
    ? SHOWCASE_SALONS.map(showcaseFeedItem)
    : [];
  const realFeedItems = input.initialFeed.items;
  const hasEditorialHero = realFeedItems.some((item) =>
    item.feedKey.startsWith("showcase:hero:"),
  );
  const hero = showcaseFeedItems.find((item) =>
    item.feedKey.startsWith("showcase:hero:"),
  );
  const remainingShowcase = showcaseFeedItems.filter(
    (item) => item.feedKey !== hero?.feedKey,
  );
  const items = shouldAddShowcase
    ? dedupeByFeedKey([
        ...(hero && !hasEditorialHero ? [hero] : []),
        ...remainingShowcase,
        ...realFeedItems,
      ]).slice(
        0,
        Math.max(
          FEED_TARGET_COUNT,
          realFeedItems.length + showcaseFeedItems.length,
        ),
      )
    : realFeedItems;
  const recommendedSalons = dedupeById([
    ...samples.filter((salon) => salon.homeSection === "recommended"),
    ...input.homeContent.recommendedSalons,
  ]).slice(0, HOME_SALON_TARGET_COUNT);
  const newSalons = dedupeById([
    ...samples.filter((salon) => salon.homeSection === "new"),
    ...input.homeContent.newSalons,
  ]).slice(0, 4);
  const inspiration = shouldAddShowcase
    ? {
        ...input.homeContent.inspiration,
        items: dedupeInspiration([
          ...SHOWCASE_SALONS.map(showcaseInspiration),
          ...input.homeContent.inspiration.items,
        ]).slice(0, 10),
      }
    : input.homeContent.inspiration;
  const homeContent: ExploreHomeContent = {
    ...input.homeContent,
    inspiration,
    newSalons,
    popularServices: ensurePopularServices(input.homeContent.popularServices),
    recommendedSalons,
  };

  return {
    discoveryContent: shouldAddShowcase
      ? ensureDiscoveryShortcuts(input.discoveryContent, samples)
      : input.discoveryContent,
    homeContent,
    initialFeed: {
      ...input.initialFeed,
      items,
    },
    searchResponse: shouldAddShowcase
      ? mergeSearchResults(input.searchResponse, samples)
      : input.searchResponse,
  };
}
