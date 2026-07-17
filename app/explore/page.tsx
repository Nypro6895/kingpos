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
import { hasPermission } from "@/lib/permissions";
import type { ExploreLocationSource } from "@/types/explore";

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
        description: "Sign in to open your KingPOS workspace.",
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
  const [workspaceLocation, quickActions, homeContent] = await Promise.all([
    getExploreWorkspaceLocation(context),
    buildQuickActions(context),
    getExploreHomeContent(),
  ]);
  const effectiveLocation = requestedLocation || workspaceLocation.label;
  const locationSource: ExploreLocationSource = requestedLocation
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
      hasUrlLocation={Boolean(requestedLocation)}
      quickActions={quickActions}
      workspaceLocation={workspaceLocation}
    />
  );
}
