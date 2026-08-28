import {
  ExploreClient,
  type ExploreQuickAction,
} from "@/app/explore/explore-client";
import { getCurrentBusinessContext } from "@/lib/current-context";
import {
  EXPLORE_PAGE_SIZE,
  getExploreWorkspaceLocation,
  searchExploreSalons,
} from "@/lib/explore-search";
import { getExploreFeedPage } from "@/lib/explore-feed";
import { getExploreHomeContent } from "@/lib/explore-home";
import { compareReylumiTopRatedSalons } from "@/lib/reylumi-trust";
import { routes } from "@/lib/routes";
import {
  listCustomerBookings,
  type CustomerBookingLine,
  type CustomerBookingSummary,
} from "@/lib/customer-bookings";
import {
  getCurrentAppNotifications,
  type AppNotification,
} from "@/lib/app-notifications";
import { hasPermission } from "@/lib/permissions";
import type {
  ExploreDiscoveryContent,
  ExploreDiscoveryPreview,
  ExploreFeedPage,
  ExploreHomeContent,
  ExploreHomeSalon,
  ExploreInspirationItem,
  ExploreLocationSource,
  ExploreNotificationItem,
  ExploreSearchResponse,
  ExploreSearchResult,
  ExploreUpcomingBooking,
  ExploreUtilityContent,
} from "@/types/explore";

type ExplorePageProps = {
  searchParams?: Promise<{
    category?: string | string[];
    location?: string | string[];
    page?: string | string[];
    q?: string | string[];
  }>;
};

type ExploreContext = Awaited<ReturnType<typeof getCurrentBusinessContext>>;

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function addAction(
  actions: ExploreQuickAction[],
  action: ExploreQuickAction,
  maxActions = 4,
) {
  if (actions.length >= maxActions) {
    return;
  }

  if (actions.some((existingAction) => existingAction.href === action.href)) {
    return;
  }

  actions.push(action);
}

async function buildQuickActions(
  context: ExploreContext,
): Promise<ExploreQuickAction[]> {
  if (!context.user) {
    return [
      {
        description: "Create an account to connect with salons.",
        href: "/signup?next=/explore",
        label: "Create account",
        tone: "dark",
      },
      {
        description: "Sign in to open your Reylumi workspace.",
        href: "/login?next=/explore",
        label: "Sign in",
        tone: "light",
      },
      {
        description: "Preview your future account hub.",
        href: "/my-place",
        label: "Open My Place",
        tone: "light",
      },
    ];
  }

  const actions: ExploreQuickAction[] = [];
  const hasStaffWorkspace = context.availableStaffSalons.length > 0;
  const hasManageWorkspace = context.availableManageSalons.length > 0;
  const manageWorkspace =
    context.currentWorkspace?.type === "salon" &&
    context.currentWorkspace.salonMode === "manage";
  const managementPermissions = manageWorkspace
    ? await Promise.all([
        hasPermission("staff.view", context),
        hasPermission("services.view", context),
        hasPermission("booking.view", context),
        hasPermission("customers.view", context),
        hasPermission("tickets.manage", context),
        hasPermission("tickets.view", context),
        hasPermission("reports.view", context),
        hasPermission("payroll.view", context),
        hasPermission("salon_settings.view", context),
      ])
    : [];
  const canManageWorkspace = managementPermissions.some(Boolean);
  const canOpenPos = manageWorkspace
    ? await hasPermission("tickets.manage", context)
    : false;

  if (!hasStaffWorkspace && !hasManageWorkspace) {
    return [
      {
        description: "Start an owner or manager workspace.",
        href: routes.salons.create(),
        label: "Create a Salon",
        tone: "dark",
      },
      {
        description: "Find salons that accept staff applications.",
        href: "/staff/connections",
        label: "Apply to a Salon",
        tone: "light",
      },
      {
        description: "Review your account workspace context.",
        href: "/my-place",
        label: "Open My Place",
        tone: "light",
      },
    ];
  }

  if (hasStaffWorkspace) {
    addAction(actions, {
      description: "Open your staff daily workspace.",
      href: "/staff/my-work",
      label: "Continue My Work",
      tone: "dark",
    });
    addAction(actions, {
      description: "View personal payroll periods.",
      href: "/staff/my-work?tab=payroll",
      label: "My Payroll",
      tone: "light",
    });
  }

  if (hasManageWorkspace && canOpenPos) {
    addAction(actions, {
      description: "Open the POS workspace for the current salon.",
      href: "/pos",
      label: "Open POS",
      tone: hasStaffWorkspace ? "light" : "dark",
    });
  }

  if (hasManageWorkspace && !manageWorkspace) {
    addAction(actions, {
      description: "Switch to one of your salon management workspaces.",
      href: "/my-place",
      label: "Manage Salon",
      tone: actions.length === 0 ? "dark" : "light",
    });
  }

  if (manageWorkspace && canManageWorkspace) {
    addAction(actions, {
      description: "Open salon tools and settings.",
      href: context.defaultRouteForCurrentContext,
      label: "Manage Salon",
      tone: actions.length === 0 ? "dark" : "light",
    });
  }

  addAction(actions, {
    description:
      hasStaffWorkspace && hasManageWorkspace
        ? "Switch between your connected workspaces."
        : "Review your selected workspace.",
    href: "/my-place",
    label: hasStaffWorkspace && hasManageWorkspace ? "Switch Workspace" : "My Place",
    tone: actions.length === 0 ? "dark" : "light",
  });

  return actions;
}

function parsePage(value: string) {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) ? Math.max(1, page) : 1;
}

function locationFromGlobalSearchQuery(
  query: string,
  workspaceLocationLabel: string,
) {
  const value = query.trim();

  if (!value) {
    return "";
  }

  if (/^\d{5}(?:-\d{4})?$/.test(value)) {
    return value;
  }

  if (/^[a-z][a-z .'-]+,\s*[a-z]{2}$/i.test(value)) {
    return value;
  }

  const workspaceCity = workspaceLocationLabel.split(",")[0]?.trim();

  if (workspaceCity && value.toLowerCase() === workspaceCity.toLowerCase()) {
    return workspaceLocationLabel;
  }

  return "";
}

function isLikelyLocationPhrase(
  value: string,
  workspaceLocationLabel: string,
) {
  const location = value.trim();

  if (!location) {
    return false;
  }

  if (locationFromGlobalSearchQuery(location, workspaceLocationLabel)) {
    return true;
  }

  const workspaceCity = workspaceLocationLabel.split(",")[0]?.trim();

  if (workspaceCity && location.toLowerCase() === workspaceCity.toLowerCase()) {
    return true;
  }

  return /^[a-z][a-z .'-]{2,},\s*[a-z]{2}$/i.test(location);
}

function searchIntentFromGlobalQuery(
  query: string,
  workspaceLocationLabel: string,
) {
  const value = query.trim().replace(/\s+/g, " ");

  if (!value) {
    return { location: "", query: "" };
  }

  const directLocation = locationFromGlobalSearchQuery(
    value,
    workspaceLocationLabel,
  );

  if (directLocation) {
    return { location: directLocation, query: "" };
  }

  const nearMatch = value.match(/\s+(?:near|nearby|around)\s+(.+)$/i);

  if (nearMatch?.index && nearMatch[1]) {
    const nextQuery = value.slice(0, nearMatch.index).trim();
    const location = nearMatch[1].replace(/[,.!?]+$/g, "").trim();

    if (nextQuery && location) {
      return { location, query: nextQuery };
    }
  }

  const inMatch = value.match(/\s+in\s+(.+)$/i);

  if (inMatch?.index && inMatch[1]) {
    const nextQuery = value.slice(0, inMatch.index).trim();
    const location = inMatch[1].replace(/[,.!?]+$/g, "").trim();

    if (
      nextQuery &&
      isLikelyLocationPhrase(location, workspaceLocationLabel)
    ) {
      return { location, query: nextQuery };
    }
  }

  return { location: "", query: value };
}

function bookingLocationLabel(booking: CustomerBookingSummary) {
  return [booking.salon?.city, booking.salon?.state]
    .filter(Boolean)
    .join(", ") || null;
}

function bookingServiceSummary(lines: CustomerBookingLine[] | undefined) {
  const bookingLines = lines ?? [];
  const serviceLines = bookingLines.filter((line) => line.line_type === "service");
  const addOnCount = bookingLines.filter((line) => line.line_type === "add_on").length;
  const serviceNames = serviceLines
    .map((line) => line.service_name_snapshot)
    .filter(Boolean);
  const primary =
    serviceNames.length === 0
      ? "Appointment"
      : serviceNames.length <= 2
        ? serviceNames.join(", ")
        : `${serviceNames.slice(0, 2).join(", ")} +${serviceNames.length - 2}`;

  return addOnCount > 0
    ? `${primary} with ${addOnCount} add-on${addOnCount === 1 ? "" : "s"}`
    : primary;
}

function bookingStaffSummary(lines: CustomerBookingLine[] | undefined) {
  const staff = (lines ?? [])
    .map((line) => line.assignedStaff)
    .filter(
      (member, index, all) =>
        member && all.findIndex((item) => item?.id === member.id) === index,
    );

  if (staff.length === 0) {
    return {
      label: "Salon professional",
      professionalCount: 1,
    };
  }

  if (staff.length === 1) {
    return {
      label: staff[0]?.displayName ?? "Salon professional",
      professionalCount: 1,
    };
  }

  return {
    label: `${staff.length} professionals`,
    professionalCount: staff.length,
  };
}

function bookingTotalAmount(lines: CustomerBookingLine[] | undefined) {
  return (lines ?? []).reduce(
    (total, line) => total + Number(line.line_total ?? 0),
    0,
  );
}

function mapUpcomingBooking(
  booking: CustomerBookingSummary,
): ExploreUpcomingBooking {
  const staff = bookingStaffSummary(booking.lines);
  const salonName = booking.salon?.displayName ?? booking.salon?.name ?? "Reylumi salon";

  return {
    bookingHref: `/my-bookings/${booking.id}`,
    endAt: booking.end_at,
    id: booking.id,
    professionalCount: staff.professionalCount,
    salonImageUrl:
      booking.inspiration?.imageUrl ??
      booking.salon?.coverUrl ??
      booking.salon?.logoUrl ??
      null,
    salonLocation: bookingLocationLabel(booking),
    salonName,
    salonTimezone: booking.salon_timezone_snapshot || "America/Chicago",
    serviceSummary: bookingServiceSummary(booking.lines),
    staffSummary: staff.label,
    startAt: booking.start_at,
    status: booking.confirmation_status || booking.status,
    totalAmount: bookingTotalAmount(booking.lines),
  };
}

function notificationDestination(notification: AppNotification) {
  if (notification.recipient_kind === "customer" && notification.booking_id) {
    return `/my-bookings/${notification.booking_id}`;
  }

  return notification.href.startsWith("/") ? notification.href : "/notifications";
}

function notificationKind(
  notification: AppNotification,
): ExploreNotificationItem["kind"] {
  const text = `${notification.notification_type} ${notification.title}`.toLowerCase();

  if (text.includes("booking") || text.includes("appointment")) {
    return "booking";
  }

  if (text.includes("message") || text.includes("chat")) {
    return "message";
  }

  if (
    text.includes("offer") ||
    text.includes("promo") ||
    text.includes("discount") ||
    text.includes("reward")
  ) {
    return "offer";
  }

  if (text.includes("review") || text.includes("rating")) {
    return "review";
  }

  return "account";
}

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
        salon.averageRating !== null && salon.sharedExperienceCount > 0,
    )
    .sort(compareReylumiTopRatedSalons);
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
  const target = category.trim().toLowerCase();

  if (!target) {
    return false;
  }

  return [
    salon.featuredServiceCategory,
    salon.featuredServiceName,
    salon.bookableServiceName,
    ...salon.serviceCategories,
    ...salon.serviceNames,
  ].some((value) => value?.toLowerCase().includes(target));
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
  if (shortcut.id === "trending") {
    return 0;
  }

  if (shortcut.id === "upcoming-booking") {
    return 1;
  }

  if (shortcut.id === "near-you") {
    return 2;
  }

  if (shortcut.id === "top-rated") {
    return 3;
  }

  if (shortcut.id === "recommended") {
    return 4;
  }

  return 5;
}

function buildExploreDiscoveryContent(input: {
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
  const trendingCount = input.homeContent.inspiration.items.length;
  const topRatedCount = topRatedDiscoverySalons(input.homeContent).length;
  const recommendedCount = input.homeContent.recommendedSalons.length;

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
          input.workspaceLocation.source === "workspace"
            ? `Using ${location}`
            : "Using your saved location",
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
        context: "Sorted by customer rating with ReyLUMI activity context",
        detail: countLabel(topRatedCount, "salon"),
        id: "top-rated",
        label: "Top rated salons",
        moduleKind: "top_rated",
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

async function getExploreUtilityContent(
  context: ExploreContext,
): Promise<ExploreUtilityContent> {
  if (!context.user) {
    return {
      bookingLoadError: false,
      notificationLoadError: false,
      notifications: [],
      unreadNotificationCount: 0,
      upcomingBooking: null,
    };
  }

  const [bookingResult, notifications] = await Promise.all([
    listCustomerBookings({ limit: 1, scope: "upcoming" }),
    getCurrentAppNotifications({ limit: 8, recipientKind: "customer" }),
  ]);
  const customerNotifications = notifications.filter(
    (notification) => notification.recipient_kind === "customer",
  );

  return {
    bookingLoadError: !bookingResult.ok && bookingResult.code !== "sign_in_required",
    notificationLoadError: false,
    notifications: customerNotifications.slice(0, 4).map((notification) => ({
      body: notification.body,
      createdAt: notification.created_at,
      href: notificationDestination(notification),
      id: notification.id,
      kind: notificationKind(notification),
      read: Boolean(notification.read_at),
      title: notification.title,
    })),
    unreadNotificationCount: customerNotifications.filter(
      (notification) => !notification.read_at,
    ).length,
    upcomingBooking:
      bookingResult.ok && bookingResult.data[0]
        ? mapUpcomingBooking(bookingResult.data[0])
        : null,
  };
}

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const params = (await searchParams) ?? {};
  const rawQuery = clean(stringParam(params.q));
  const requestedLocation = clean(stringParam(params.location));
  const category = clean(stringParam(params.category));
  const page = parsePage(clean(stringParam(params.page)));
  const hasExplicitSearchParams = Boolean(
    rawQuery || requestedLocation || category || page > 1,
  );
  const context = await getCurrentBusinessContext();
  const [workspaceLocation, quickActions, homeContent, utilityContent] =
    await Promise.all([
      getExploreWorkspaceLocation(context),
      buildQuickActions(context),
      getExploreHomeContent(),
      getExploreUtilityContent(context),
    ]);
  const searchIntent = requestedLocation
    ? { location: "", query: rawQuery }
    : searchIntentFromGlobalQuery(rawQuery, workspaceLocation.label);
  const queryLocation = searchIntent.location;
  const query = searchIntent.query;
  const effectiveLocation =
    requestedLocation || queryLocation || workspaceLocation.label;
  const locationSource: ExploreLocationSource = requestedLocation || queryLocation
    ? "manual"
    : workspaceLocation.source;
  const [searchResponse, initialFeed] = await Promise.all([
    searchExploreSalons({
      category,
      location: effectiveLocation,
      page,
      pageSize: EXPLORE_PAGE_SIZE,
      query,
    }),
    getExploreFeedPage({ homeContent }),
  ]);
  const discoveryContent = buildExploreDiscoveryContent({
    homeContent,
    initialFeed,
    searchResponse,
    utilityContent,
    workspaceLocation,
  });

  return (
    <ExploreClient
      key={[
        searchResponse.query,
        searchResponse.location,
        searchResponse.category,
        searchResponse.page,
        searchResponse.totalCount,
        locationSource,
        hasExplicitSearchParams ? "search" : "home",
      ].join(":")}
      initialSearchMode={hasExplicitSearchParams}
      initialLocationSource={locationSource}
      initialResponse={searchResponse}
      discoveryContent={discoveryContent}
      homeContent={homeContent}
      hasUrlLocation={Boolean(requestedLocation || queryLocation)}
      initialFeed={initialFeed}
      quickActions={quickActions}
      workspaceLocation={workspaceLocation}
    />
  );
}
