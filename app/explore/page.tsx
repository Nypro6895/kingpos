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
import { getExploreHomeContent } from "@/lib/explore-home";
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
  ExploreLocationSource,
  ExploreNotificationItem,
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
        href: "/organizations",
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
      description: "Open the front desk checkout flow.",
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
    getCurrentAppNotifications(8),
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
  const query = clean(stringParam(params.q));
  const requestedLocation = clean(stringParam(params.location));
  const category = clean(stringParam(params.category));
  const page = parsePage(clean(stringParam(params.page)));
  const hasExplicitSearchParams = Boolean(
    query || requestedLocation || category || page > 1,
  );
  const context = await getCurrentBusinessContext();
  const [workspaceLocation, quickActions, homeContent, utilityContent] =
    await Promise.all([
      getExploreWorkspaceLocation(context),
      buildQuickActions(context),
      getExploreHomeContent(),
      getExploreUtilityContent(context),
    ]);
  const queryLocation = requestedLocation
    ? ""
    : locationFromGlobalSearchQuery(query, workspaceLocation.label);
  const effectiveLocation =
    requestedLocation || queryLocation || workspaceLocation.label;
  const locationSource: ExploreLocationSource = requestedLocation || queryLocation
    ? "manual"
    : workspaceLocation.source;
  const searchResponse = await searchExploreSalons({
    category,
    location: effectiveLocation,
    page,
    pageSize: EXPLORE_PAGE_SIZE,
    query,
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
      homeContent={homeContent}
      hasUrlLocation={Boolean(requestedLocation || queryLocation)}
      quickActions={quickActions}
      utilityContent={utilityContent}
      workspaceLocation={workspaceLocation}
    />
  );
}
