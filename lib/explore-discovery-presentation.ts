import type { getExploreWorkspaceLocation } from "@/lib/explore-search";
import { buildReylumiTrustSummary, compareReylumiTrustedSalons } from "@/lib/reylumi-trust";
import { searchTextMatches } from "@/lib/search-normalization";
import type { ExploreDiscoveryContent, ExploreDiscoveryPreview, ExploreFeedPage, ExploreHomeContent, ExploreHomeSalon, ExploreInspirationItem, ExploreSearchResponse, ExploreSearchResult, ExploreUpcomingBooking, ExploreUtilityContent } from "@/types/explore";

// The existing server presentation is also safe over authorized client DTOs.
function dedupeHomeSalons(...groups: ExploreHomeSalon[][]) {
  const byId = new Map<string, ExploreHomeSalon>();

  for (const group of groups) {
    for (const salon of group) {
      if (!byId.has(salon.id)) {
        byId.set(salon.id, salon);
      }
    }
  }

  return [...byId.values()];
}

function topRatedDiscoverySalons(content: ExploreHomeContent) {
  return dedupeHomeSalons(content.recommendedSalons, content.newSalons)
    .filter(
      (salon) =>
        buildReylumiTrustSummary(salon).qualityScore !== null,
    )
    .sort(compareReylumiTrustedSalons);
}

function availableTodayDiscoverySalons(...groups: ExploreSearchResult[][]) {
  return dedupeSearchResults(...groups)
    .filter(
      (salon) =>
        salon.bookingEnabled && Boolean(salon.bookableServiceId),
    )
    .sort((left, right) => {
      const leftTime = left.nextAvailableAt
        ? new Date(left.nextAvailableAt).getTime()
        : Number.POSITIVE_INFINITY;
      const rightTime = right.nextAvailableAt
        ? new Date(right.nextAvailableAt).getTime()
        : Number.POSITIVE_INFINITY;

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return (
        Number(right.operatingStatus.isOpen) -
        Number(left.operatingStatus.isOpen)
      );
    });
}

function underBudgetDiscoverySalons(
  budget: number,
  ...groups: ExploreSearchResult[][]
) {
  return dedupeSearchResults(...groups)
    .filter(
      (salon) =>
        typeof salon.startingPrice === "number" &&
        salon.startingPrice > 0 &&
        salon.startingPrice <= budget,
    )
    .sort(
      (left, right) =>
        (left.startingPrice ?? budget) - (right.startingPrice ?? budget),
    );
}

function exploreSearchHref(input: { category?: string; location?: string }) {
  const params = new URLSearchParams();

  if (input.category?.trim()) {
    params.set("category", input.category.trim());
  }

  if (input.location?.trim()) {
    params.set("location", input.location.trim());
  }

  const queryString = params.toString();

  return queryString ? `/explore?${queryString}` : "/explore";
}

type DiscoveryPreviewCandidate = ExploreDiscoveryPreview & {
  entityId: string | null;
};

type DiscoveryAvoidSignals = {
  entityIds: Set<string>;
  imageUrls: Set<string>;
};

function compactText(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, " ");

  return trimmed || null;
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function shortLocationName(location: string) {
  return compactText(location.split(",")[0]) ?? compactText(location);
}

function dedupeSearchResults(...groups: ExploreSearchResult[][]) {
  const byId = new Map<string, ExploreSearchResult>();

  for (const group of groups) {
    for (const salon of group) {
      if (!byId.has(salon.id)) {
        byId.set(salon.id, salon);
      }
    }
  }

  return [...byId.values()];
}

function salonLocationPreview(salon: ExploreSearchResult) {
  return compactText([salon.city, salon.state].filter(Boolean).join(", "));
}

function salonServicePreview(salon: ExploreSearchResult) {
  return (
    compactText(salon.featuredServiceName) ??
    compactText(salon.bookableServiceName) ??
    compactText(salon.featuredServiceCategory) ??
    compactText(salon.serviceNames[0]) ??
    compactText(salon.serviceCategories[0])
  );
}

function salonPreviewCandidate(
  salon: ExploreSearchResult,
  sourcePrefix: string,
): DiscoveryPreviewCandidate | null {
  if (!salon.coverImageUrl) {
    return null;
  }

  const service = salonServicePreview(salon);

  return {
    alt: `${salon.name} salon photo`,
    entityId: salon.id,
    imageUrl: salon.coverImageUrl,
    label: salon.name,
    meta: service ?? salonLocationPreview(salon),
    sourceId: `${sourcePrefix}:${salon.id}`,
  };
}

function inspirationPreviewCandidate(
  item: ExploreInspirationItem,
): DiscoveryPreviewCandidate {
  const service =
    compactText(item.serviceName) ?? compactText(item.serviceCategory);
  const salonName = compactText(item.salonName) ?? "Reylumi salon";

  return {
    alt: service
      ? `${service} inspiration from ${salonName}`
      : `Beauty inspiration from ${salonName}`,
    entityId: item.salonId,
    imageUrl: item.imageUrl,
    label: service,
    meta: salonName,
    sourceId: `inspiration:${item.mediaId}`,
  };
}

function bookingPreviewCandidate(
  booking: ExploreUpcomingBooking,
): DiscoveryPreviewCandidate | null {
  if (!booking.salonImageUrl) {
    return null;
  }

  return {
    alt: `${booking.salonName} booking preview`,
    entityId: booking.id,
    imageUrl: booking.salonImageUrl,
    label: booking.salonName,
    meta: booking.serviceSummary,
    sourceId: `booking:${booking.id}`,
  };
}

function discoveryAvoidSignals(feed: ExploreFeedPage): DiscoveryAvoidSignals {
  const signals: DiscoveryAvoidSignals = {
    entityIds: new Set<string>(),
    imageUrls: new Set<string>(),
  };

  for (const item of feed.items.slice(0, 5)) {
    if (item.salon?.id) {
      signals.entityIds.add(item.salon.id);
    }

    for (const media of item.media) {
      signals.imageUrls.add(media.imageUrl);
    }
  }

  return signals;
}

function emptyDiscoveryAvoidSignals(): DiscoveryAvoidSignals {
  return {
    entityIds: new Set<string>(),
    imageUrls: new Set<string>(),
  };
}

function previewCandidateConflicts(
  candidate: DiscoveryPreviewCandidate,
  avoid: DiscoveryAvoidSignals,
) {
  return (
    avoid.imageUrls.has(candidate.imageUrl) ||
    (candidate.entityId ? avoid.entityIds.has(candidate.entityId) : false)
  );
}

function selectDiscoveryPreviewCandidates(input: {
  avoid: DiscoveryAvoidSignals;
  candidates: DiscoveryPreviewCandidate[];
  hardAvoid?: DiscoveryAvoidSignals;
  max: number;
}) {
  const selected: DiscoveryPreviewCandidate[] = [];
  const usedEntityIds = new Set<string>();
  const usedImageUrls = new Set<string>();

  function addCandidate(
    candidate: DiscoveryPreviewCandidate,
    respectAvoidSignals: boolean,
  ) {
    if (selected.length >= input.max || usedImageUrls.has(candidate.imageUrl)) {
      return;
    }

    if (candidate.entityId && usedEntityIds.has(candidate.entityId)) {
      return;
    }

    if (
      input.hardAvoid &&
      previewCandidateConflicts(candidate, input.hardAvoid)
    ) {
      return;
    }

    if (
      respectAvoidSignals &&
      previewCandidateConflicts(candidate, input.avoid)
    ) {
      return;
    }

    selected.push(candidate);
    usedImageUrls.add(candidate.imageUrl);

    if (candidate.entityId) {
      usedEntityIds.add(candidate.entityId);
    }
  }

  for (const candidate of input.candidates) {
    addCandidate(candidate, true);
  }

  for (const candidate of input.candidates) {
    addCandidate(candidate, false);
  }

  return selected;
}

function trackDiscoveryPreviewCandidates(
  candidates: DiscoveryPreviewCandidate[],
  avoid: DiscoveryAvoidSignals,
) {
  for (const candidate of candidates) {
    avoid.imageUrls.add(candidate.imageUrl);

    if (candidate.entityId) {
      avoid.entityIds.add(candidate.entityId);
    }
  }
}

function discoveryPreviews(
  candidates: DiscoveryPreviewCandidate[],
): ExploreDiscoveryPreview[] {
  return candidates.map((candidate) => ({
    alt: candidate.alt,
    imageUrl: candidate.imageUrl,
    label: candidate.label,
    meta: candidate.meta,
    sourceId: candidate.sourceId,
  }));
}

function salonMatchesServiceCategory(
  salon: ExploreSearchResult,
  category: string,
) {
  if (!category.trim()) {
    return false;
  }

  return searchTextMatches([
    salon.featuredServiceCategory,
    salon.featuredServiceName,
    salon.bookableServiceName,
    ...salon.serviceCategories,
    ...salon.serviceNames,
  ], category);
}

function bookingStartLabel(booking: ExploreUpcomingBooking) {
  const date = new Date(booking.startAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: booking.salonTimezone,
  }).format(date);
}

function discoveryShortcutPriority(
  shortcut: ExploreDiscoveryContent["shortcuts"][number],
) {
  if (shortcut.id === "available-today") {
    return 0;
  }

  if (shortcut.id === "trending") {
    return 1;
  }

  if (shortcut.id === "near-you") {
    return 2;
  }

  if (shortcut.id === "top-rated") {
    return 3;
  }

  if (shortcut.id === "under-60") {
    return 4;
  }

  if (shortcut.id === "recommended") {
    return 5;
  }

  if (shortcut.id === "upcoming-booking") {
    return 6;
  }

  return 7;
}

export function buildExploreDiscoveryContent(input: {
  homeContent: ExploreHomeContent;
  initialFeed: ExploreFeedPage;
  searchResponse: ExploreSearchResponse;
  utilityContent: ExploreUtilityContent;
  workspaceLocation: Awaited<ReturnType<typeof getExploreWorkspaceLocation>>;
}): ExploreDiscoveryContent {
  const shortcuts: ExploreDiscoveryContent["shortcuts"] = [];
  const feedAvoid = discoveryAvoidSignals(input.initialFeed);
  const railAvoid = emptyDiscoveryAvoidSignals();
  const location = input.workspaceLocation.label.trim();
  const locationName = shortLocationName(location);
  const searchSalons = dedupeSearchResults(
    input.searchResponse.sections.nearby,
    input.searchResponse.sections.bestMatches,
    input.searchResponse.sections.recommended,
    input.searchResponse.results,
  );
  const allHomeSalons = dedupeHomeSalons(
    input.homeContent.recommendedSalons,
    input.homeContent.newSalons,
  );
  const availableTodaySalons = availableTodayDiscoverySalons(
    searchSalons,
    allHomeSalons,
  );
  const under60Salons = underBudgetDiscoverySalons(
    60,
    searchSalons,
    allHomeSalons,
  );
  const trendingCount = input.homeContent.inspiration.items.length;
  const topRatedCount = topRatedDiscoverySalons(input.homeContent).length;
  const recommendedCount = input.homeContent.recommendedSalons.length;

  if (availableTodaySalons.length > 0) {
    const selectedPreviews = selectDiscoveryPreviewCandidates({
      avoid: feedAvoid,
      candidates: availableTodaySalons
        .map((salon) => salonPreviewCandidate(salon, "available-today"))
        .filter(
          (candidate): candidate is DiscoveryPreviewCandidate =>
            Boolean(candidate),
        ),
      hardAvoid: railAvoid,
      max: 3,
    });

    if (selectedPreviews.length > 0) {
      shortcuts.push({
        action: {
          resultKind: "available_today",
          type: "result",
        },
        actionLabel: "Check times",
        context: locationName
          ? `Booking options near ${locationName}`
          : "Online booking options",
        detail: countLabel(availableTodaySalons.length, "bookable option"),
        id: "available-today",
        label: "Booking options",
        moduleKind: "availability",
        previews: discoveryPreviews(selectedPreviews),
      });
      trackDiscoveryPreviewCandidates(selectedPreviews, railAvoid);
    }
  }

  if (trendingCount > 0) {
    const selectedPreviews = selectDiscoveryPreviewCandidates({
      avoid: feedAvoid,
      candidates: input.homeContent.inspiration.items.map(
        inspirationPreviewCandidate,
      ),
      hardAvoid: railAvoid,
      max: 3,
    });

    if (selectedPreviews.length > 0) {
      shortcuts.push({
        action: {
          resultKind: "trending",
          type: "result",
        },
        actionLabel: "View looks",
        context: "Latest public inspiration",
        detail: countLabel(trendingCount, "public look"),
        id: "trending",
        label: "Fresh looks",
        moduleKind: "visual",
        previews: discoveryPreviews(selectedPreviews),
      });
      trackDiscoveryPreviewCandidates(selectedPreviews, railAvoid);
    }
  }

  if (location && input.searchResponse.totalCount > 0) {
    const selectedPreviews = selectDiscoveryPreviewCandidates({
      avoid: feedAvoid,
      candidates: searchSalons
        .map((salon) => salonPreviewCandidate(salon, "nearby"))
        .filter(
          (candidate): candidate is DiscoveryPreviewCandidate =>
            Boolean(candidate),
        ),
      hardAvoid: railAvoid,
      max: 3,
    });

    if (selectedPreviews.length > 0) {
      shortcuts.push({
        action: {
          href: exploreSearchHref({ location }),
          type: "href",
        },
        actionLabel: "Search this area",
        context: `${countLabel(input.searchResponse.totalCount, "salon")} in this area`,
        detail:
          input.workspaceLocation.source === "activity"
            ? "Using your recent activity area"
            : input.workspaceLocation.source === "manual" ? "Using your selected area" : "Using your saved location",
        id: "near-you",
        label: locationName ? `Near ${locationName}` : "Nearby salons",
        moduleKind: "nearby",
        previews: discoveryPreviews(selectedPreviews),
      });
      trackDiscoveryPreviewCandidates(selectedPreviews, railAvoid);
    }
  }

  if (topRatedCount > 0) {
    const selectedPreviews = selectDiscoveryPreviewCandidates({
      avoid: feedAvoid,
      candidates: topRatedDiscoverySalons(input.homeContent)
        .map((salon) => salonPreviewCandidate(salon, "top-rated"))
        .filter(
          (candidate): candidate is DiscoveryPreviewCandidate =>
            Boolean(candidate),
        ),
      hardAvoid: railAvoid,
      max: 3,
    });

    if (selectedPreviews.length > 0) {
      shortcuts.push({
        action: {
          resultKind: "top_rated",
          type: "result",
        },
        actionLabel: "View salons",
        context: "Based on LUMI Truth, customer feedback and repeat visits",
        detail: countLabel(topRatedCount, "salon"),
        id: "top-rated",
        label: "Top artists",
        moduleKind: "top_rated",
        previews: discoveryPreviews(selectedPreviews),
      });
      trackDiscoveryPreviewCandidates(selectedPreviews, railAvoid);
    }
  }

  if (under60Salons.length > 0) {
    const selectedPreviews = selectDiscoveryPreviewCandidates({
      avoid: feedAvoid,
      candidates: under60Salons
        .map((salon) => salonPreviewCandidate(salon, "under-60"))
        .filter(
          (candidate): candidate is DiscoveryPreviewCandidate =>
            Boolean(candidate),
        ),
      hardAvoid: railAvoid,
      max: 3,
    });

    if (selectedPreviews.length > 0) {
      shortcuts.push({
        action: {
          resultKind: "under_60",
          type: "result",
        },
        actionLabel: "See value picks",
        context: "Value-friendly services",
        detail: countLabel(under60Salons.length, "option"),
        id: "under-60",
        label: "Under $60",
        moduleKind: "value",
        previews: discoveryPreviews(selectedPreviews),
      });
      trackDiscoveryPreviewCandidates(selectedPreviews, railAvoid);
    }
  }

  if (recommendedCount > 0) {
    const selectedPreviews = selectDiscoveryPreviewCandidates({
      avoid: feedAvoid,
      candidates: input.homeContent.recommendedSalons
        .map((salon) => salonPreviewCandidate(salon, "recommended"))
        .filter(
          (candidate): candidate is DiscoveryPreviewCandidate =>
            Boolean(candidate),
        ),
      hardAvoid: railAvoid,
      max: 2,
    });

    if (selectedPreviews.length > 0) {
      shortcuts.push({
        action: {
          resultKind: "recommended",
          type: "result",
        },
        actionLabel: "View recommendations",
        context: "Public salon details and availability context",
        detail: countLabel(recommendedCount, "salon"),
        id: "recommended",
        label: "Recommended for you",
        moduleKind: "recommended",
        previews: discoveryPreviews(selectedPreviews),
      });
      trackDiscoveryPreviewCandidates(selectedPreviews, railAvoid);
    }
  }

  let addedCategoryModule = false;

  for (const service of input.homeContent.popularServices) {
    if (addedCategoryModule) {
      break;
    }

    const selectedPreviews = selectDiscoveryPreviewCandidates({
      avoid: feedAvoid,
      candidates: allHomeSalons
        .filter((salon) => salonMatchesServiceCategory(salon, service.category))
        .map((salon) => salonPreviewCandidate(salon, `service-${service.category}`))
        .filter(
          (candidate): candidate is DiscoveryPreviewCandidate =>
            Boolean(candidate),
        ),
      hardAvoid: railAvoid,
      max: 3,
    });

    if (selectedPreviews.length > 0) {
      shortcuts.push({
        action: {
          category: service.category,
          type: "category",
        },
        actionLabel: `Explore ${service.category}`,
        context: countLabel(service.salonCount, "salon"),
        detail: countLabel(service.activeServiceCount, "active service"),
        id: `service-${service.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        label: service.category,
        moduleKind: "category",
        previews: discoveryPreviews(selectedPreviews),
      });
      addedCategoryModule = true;
      trackDiscoveryPreviewCandidates(selectedPreviews, railAvoid);
    }
  }

  if (input.utilityContent.upcomingBooking) {
    const booking = input.utilityContent.upcomingBooking;
    const bookingPreview = bookingPreviewCandidate(booking);
    const selectedPreviews = bookingPreview ? [bookingPreview] : [];
    const bookingTime = bookingStartLabel(booking);

    shortcuts.push({
      action: {
        href: booking.bookingHref,
        type: "href",
      },
      actionLabel: "Open booking",
      context: booking.salonName,
      detail: [bookingTime, booking.staffSummary, booking.serviceSummary]
        .filter(Boolean)
        .join(" / "),
      id: "upcoming-booking",
      label: "Upcoming",
      moduleKind: "booking",
      previews: discoveryPreviews(selectedPreviews),
    });
    trackDiscoveryPreviewCandidates(selectedPreviews, railAvoid);
  }

  return {
    shortcuts: shortcuts
      .slice()
      .sort(
        (left, right) =>
          discoveryShortcutPriority(left) - discoveryShortcutPriority(right),
      )
      .slice(0, 5),
  };
}

