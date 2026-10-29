"use client";
import { handleExploreLogoClick } from "@/lib/explore-entry-navigation";
import { ExploreHeaderSearchSlot } from "@/app/explore/explore-header-search-slot";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { WorkspaceNavigationIcon as Icon } from "@/components/workspace-navigation-icon";
import { RoleMoreContent } from "@/components/role-more-content";

import { LogoutButton } from "@/app/account/logout-button";
import { ExploreAdSlot } from "@/components/explore-advertising";
import { ActionDialog } from "@/app/action-dialog";
import {
  CustomerShellContextProvider,
  type CustomerNotificationSummary,
} from "@/app/customer-shell-context";
import { NotificationFeedList } from "@/app/notifications/notification-list";
import { QuickWorkspacePanel } from "@/app/quick-workspace-panel";
import { safeAccountAvatarUrl } from "@/lib/account-avatar";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  ROLE_NAVIGATION,
  ROLE_MORE_ITEMS,
  SHARED_CONTEXT_ROUTE_PREFIXES,
  type NavigationLink,
  type NavigationSection,
  type RoleNavigationConfig,
  type RoleNavigationKind,
  type RoleMoreItem,
  roleNavigationKindForContext,
} from "@/app/role-navigation";
import { navigateToWorkspace } from "@/lib/workspace-navigation";
import Image from "next/image";
import Link, { NavigationProgress } from "@/components/feedback-link";
import { NavigationForm, NavigationSubmitButton } from "@/components/navigation-form";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  CurrentWorkspaceAction,
  CurrentWorkspaceOption,
  SalonMode,
  WorkspaceType,
} from "@/lib/current-context";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { routes } from "@/lib/routes";
import { markAllCenterViewed, NOTIFICATIONS_REFRESH, useNotificationSummary } from "@/lib/notification-client";

type NavigationSalon = {
  id: string;
  name: string;
};

type NotificationSummary = CustomerNotificationSummary;

type SearchParamsReader = {
  get(name: string): string | null;
};

type RouteWorkspaceKind =
  | "manage"
  | "personal"
  | "salon"
  | "shared"
  | "staff";

type NavigationShellProps = {
  accountAvatarUrl: string | null;
  accountEmail: string | null;
  accountLabel: string;
  canManageStaff: boolean;
  canSwitchManageSalon: boolean;
  children: ReactNode;
  currentManageSalonId: string | null;
  currentManageSalonName: string | null;
  currentAccountName: string | null;
  currentUserId: string | null;
  currentStaffSalonId: string | null;
  currentStaffSalonName: string | null;
  currentWorkspace: CurrentWorkspaceOption | null;
  manageSalons: NavigationSalon[];
  notificationSummary: NotificationSummary;
  passive?: boolean;
  salonMode: SalonMode | null;
  staffSalons: NavigationSalon[];
  workspaceOptions: CurrentWorkspaceOption[];
  workspaceSections: readonly NavigationSection[];
  workspaceType: WorkspaceType;
};

const PERSONAL_LINKS = ROLE_NAVIGATION.personal.links;

const WORKSPACE_PANEL_LINK: NavigationLink = {
  href: "/my-place",
  icon: "grid",
  id: "my-place",
  label: "My Place",
};

const CUSTOMER_MORE_ROUTE_PREFIXES = ["/more"];

const CUSTOMER_SHEET_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const CUSTOMER_CONTEXT_SHEET_ID = "customer-context-sheet";
const CUSTOMER_DESKTOP_ACCOUNT_MENU_ID = "customer-desktop-account-menu";

const WORKSPACE_SWITCH_ERROR =
  "Workspace context could not be updated. Try again.";

type RunWorkspaceAction = (
  workspace: CurrentWorkspaceOption,
  action: CurrentWorkspaceAction,
) => void;

type WorkspaceGroup = {
  id: string;
  label: string;
  options: CurrentWorkspaceOption[];
};

type CustomerContextSheetProps = {
  accountAvatarUrl: string | null;
  accountEmail: string | null;
  accountLabel: string;
  currentWorkspace: CurrentWorkspaceOption | null;
  isOpen: boolean;
  onClose: () => void;
  workspaceOptions: CurrentWorkspaceOption[];
};

type CustomerWorkspaceRowProps = {
  accountAvatarUrl: string | null;
  accountLabel: string;
  currentWorkspaceId: string | null;
  onRunAction: RunWorkspaceAction;
  pendingKey: string | null;
  workspace: CurrentWorkspaceOption;
};

function customerRouteMatches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isCustomerMoreRoute(pathname: string) {
  return CUSTOMER_MORE_ROUTE_PREFIXES.some((prefix) =>
    customerRouteMatches(pathname, prefix),
  );
}

function isRoleMoreActive(
  roleKind: RoleNavigationKind,
  pathname: string,
  searchParams: SearchParamsReader,
) {
  if (isCustomerMoreRoute(pathname)) {
    return true;
  }

  if (roleKind === "owner") {
    if (pathname === "/staff/today") {
      return false;
    }
  }

  return ROLE_NAVIGATION[roleKind].moreLinks.some((link) =>
    isLinkActive(link, pathname, searchParams),
  );
}

function customerWorkspaceLabel(
  workspace: CurrentWorkspaceOption | null,
  accountLabel: string,
) {
  if (!workspace) {
    return accountLabel;
  }

  if (workspace.type === "personal") {
    return accountLabel;
  }

  if (workspace.type === "salon") {
    if (workspace.salonMode === "staff") return workspace.staffDisplayName || "Staff";
    return workspace.salonName ?? workspace.businessName ?? workspace.label;
  }

  return workspace.label;
}

function customerWorkspaceSubtitle(workspace: CurrentWorkspaceOption | null) {
  if (!workspace || workspace.type === "personal") {
    return "Personal account";
  }

  if (workspace.type === "account") {
    return workspace.roleLabel || "Account";
  }

  if (workspace.type === "salon") {
    if (workspace.salonMode === "staff") {
      return `Staff - ${workspace.salonName ?? workspace.businessName ?? workspace.label}`;
    }
    return workspace.roleLabel || "Salon";
  }

  return workspace.roleLabel || workspace.label;
}

function workspaceAvatarClass(isSelected = false) {
  return [
    "grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold",
    isSelected
      ? "bg-brand-orange text-white"
      : "bg-brand-orange-soft text-brand-orange",
  ].join(" ");
}

function workspaceOpenAction(workspace: CurrentWorkspaceOption) {
  return (
    workspace.secondaryAction ??
    workspace.primaryAction ?? {
      href: workspace.defaultHref,
      id: "open",
      label: "Open",
    }
  );
}

function personalOpenAction(): CurrentWorkspaceAction {
  return {
    href: "/explore",
    id: "explore",
    label: "Explore",
  };
}

function isOwnerAccountWorkspace(workspace: CurrentWorkspaceOption) {
  return (
    workspace.type === "account" &&
    workspace.menuActions.some((action) => action.href === routes.salons.create())
  );
}

function findCreateSalonTarget(input: {
  currentWorkspace: CurrentWorkspaceOption | null;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const accounts = input.workspaceOptions.filter(isOwnerAccountWorkspace);
  const workspace =
    accounts.find(
      (option) => option.accountId === input.currentWorkspace?.accountId,
    ) ??
    accounts[0] ??
    null;
  const action =
    workspace?.menuActions.find((item) => item.href === routes.salons.create()) ??
    null;

  return workspace && action ? { action, workspace } : null;
}

function customerWorkspaceGroups(
  workspaceOptions: CurrentWorkspaceOption[],
): WorkspaceGroup[] {
  const staffOptions = workspaceOptions.filter(
    (workspace) => workspace.salonMode === "staff",
  );
  const ownerOptions = workspaceOptions.filter(
    (workspace) => workspace.salonMode === "manage",
  );

  return [
    { id: "staff", label: "Staff", options: staffOptions },
    { id: "owner", label: "Owner", options: ownerOptions },
  ].filter((group) => group.options.length > 0);
}

function actionKey(
  workspace: CurrentWorkspaceOption,
  action: CurrentWorkspaceAction,
) {
  return `${workspace.id}:${action.id}:${action.href}`;
}

function notificationBadgeLabel(total: number) {
  return total > 9
    ? "9 or more unread notifications"
    : `${total} unread notification${total === 1 ? "" : "s"}`;
}

function AppNotificationInvalidation({ userId }: { userId: string | null }) {
  const hasNewItemsRef = useRef(false);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) {
      return;
    }

    function refreshSoon(delay = 250, newItems = false) {
      hasNewItemsRef.current ||= newItems;
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        window.dispatchEvent(new CustomEvent(NOTIFICATIONS_REFRESH,{detail:{force:true,newItems:hasNewItemsRef.current}}));
        hasNewItemsRef.current=false;
      }, delay);
    }

    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      ?.channel(`app-notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          filter: `recipient_user_id=eq.${userId}`,
          schema: "public",
          table: "app_notifications",
        },
        (payload) => refreshSoon(250,payload.eventType === "INSERT"),
      )
      .subscribe((status) => { if (status === "SUBSCRIBED") refreshSoon(250); });

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      if (supabase && channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [userId]);

  return null;
}

function isMoreLink(link: NavigationLink) {
  return link.href === "/more";
}

function roleKindForMoreLink(link: NavigationLink): RoleNavigationKind {
  if (link.id.startsWith("owner-")) {
    return "owner";
  }

  if (link.id.startsWith("staff-")) {
    return "staff";
  }

  return "personal";
}

function moreItemAsNavigationLink(item: RoleMoreItem): NavigationLink {
  return {
    href: item.href,
    icon: item.navigationIcon,
    id: item.id,
    label: item.label,
  };
}

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isShelllessPath(pathname: string) {
  return (
    pathname === "/forgot-password" ||
    pathname === "/account-recovery" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/login" ||
    pathname === "/reset-password" ||
    pathname === "/signup" ||
    pathname.startsWith("/book/") ||
    pathname.startsWith("/booking/manage/") ||
    pathname.startsWith("/pos/portable") ||
    pathname.startsWith("/pos/customer-display")
  );
}

function isSharedContextRoute(pathname: string) {
  return SHARED_CONTEXT_ROUTE_PREFIXES.some((prefix) =>
    matchesPath(pathname, prefix),
  );
}

function getRouteWorkspaceKind(pathname: string): RouteWorkspaceKind | null {
  if (pathname === "/" || isSharedContextRoute(pathname)) {
    return "shared";
  }

  if (matchesPath(pathname, "/salon-profile")) {
    return "salon";
  }

  if (
    ROLE_NAVIGATION.personal.routePrefixes.some((prefix) =>
      matchesPath(pathname, prefix),
    )
  ) {
    return "personal";
  }

  if (
    ROLE_NAVIGATION.staff.routePrefixes.some((prefix) =>
      matchesPath(pathname, prefix),
    )
  ) {
    return "staff";
  }

  if (
    ROLE_NAVIGATION.owner.routePrefixes.some((prefix) =>
      matchesPath(pathname, prefix),
    )
  ) {
    return "manage";
  }

  return null;
}

function routeNavigationForWorkspaceKind(input: {
  routeWorkspaceKind: RouteWorkspaceKind | null;
  salonMode: SalonMode | null;
  workspaceType: WorkspaceType;
}): RoleNavigationConfig | null {
  if (input.routeWorkspaceKind === "personal") {
    return ROLE_NAVIGATION.personal;
  }

  if (input.routeWorkspaceKind === "shared") {
    return ROLE_NAVIGATION[
      roleNavigationKindForContext({
        salonMode: input.salonMode,
        workspaceType: input.workspaceType,
      })
    ];
  }

  if (input.routeWorkspaceKind === "staff") {
    return ROLE_NAVIGATION.staff;
  }

  if (input.routeWorkspaceKind === "manage") {
    return ROLE_NAVIGATION.owner;
  }

  if (input.routeWorkspaceKind === "salon" && input.workspaceType === "salon") {
    return input.salonMode === "staff"
      ? ROLE_NAVIGATION.staff
      : ROLE_NAVIGATION.owner;
  }

  return null;
}

function currentWorkspaceForRoute(input: {
  currentWorkspace: CurrentWorkspaceOption | null;
  routeWorkspaceKind: RouteWorkspaceKind | null;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  if (input.routeWorkspaceKind !== "personal") {
    return input.currentWorkspace;
  }

  return (
    input.workspaceOptions.find((workspace) => workspace.type === "personal") ??
    input.currentWorkspace
  );
}

function sidebarLinkClass(isActive: boolean) {
  return [
    "flex min-h-9 items-center gap-2 rounded-md px-2.5 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
    isActive
      ? "bg-zinc-950 text-white"
      : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950",
  ].join(" ");
}

function railLinkClass(isActive: boolean, isOpen = false) {
  return [
    "relative grid h-11 w-11 place-items-center rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
    isActive
      ? "bg-zinc-950 text-white"
      : isOpen
        ? "bg-zinc-100 text-zinc-950 ring-1 ring-inset ring-zinc-300"
        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950",
  ].join(" ");
}

function isLinkActive(
  link: NavigationLink,
  pathname: string,
  searchParams: SearchParamsReader,
) {
  const [linkPath, linkQuery = ""] = link.href.split("?");

  if (linkPath === "/staff") {
    return pathname === "/staff";
  }

  const pathMatches =
    pathname === linkPath || pathname.startsWith(`${linkPath}/`);

  if (!pathMatches) {
    return false;
  }

  if (!linkQuery) {
    if (link.id === "staff-day" || link.id === "staff-today") {
      return searchParams.get("tab") === null;
    }

    return true;
  }

  const expectedParams = new URLSearchParams(linkQuery);

  for (const [key, value] of expectedParams.entries()) {
    if (searchParams.get(key) !== value) {
      return false;
    }
  }

  return true;
}

function initialsFor(label: string) {
  const parts = label
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "K";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function AccountAvatar({
  avatarUrl,
  className,
  label,
}: {
  avatarUrl: string | null;
  className: string;
  label: string;
}) {
  const __vt = useWorkspaceTranslation();

  const safeAvatarUrl = safeAccountAvatarUrl(avatarUrl);

  return (
    <span className={["overflow-hidden", className].join(" ")}>
      {safeAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={__vt(`${label} avatar`)}
          className="h-full w-full object-cover"
          src={safeAvatarUrl}
        />
      ) : (
        initialsFor(label)
      )}
    </span>
  );
}

function WorkspaceAvatar({
  accountAvatarUrl,
  accountLabel,
  className,
  label,
  workspace,
}: {
  accountAvatarUrl: string | null;
  accountLabel: string;
  className: string;
  label: string;
  workspace: CurrentWorkspaceOption | null;
}) {
  const __vt = useWorkspaceTranslation();

  if (workspace?.type === "personal" || (workspace?.type === "salon" && workspace.salonMode === "staff")) {
    return (
      <AccountAvatar
        avatarUrl={workspace?.salonMode === "staff" ? workspace.staffAvatarUrl ?? null : accountAvatarUrl}
        className={className}
        label={__vt(workspace?.salonMode === "staff" ? workspace.staffDisplayName || "Staff" : accountLabel)}
      />
    );
  }

  return (
    <span className={["overflow-hidden", className].join(" ")}>
      {workspace?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={__vt(`${label} avatar`)}
          className="h-full w-full object-cover"
          src={workspace.avatarUrl}
        />
      ) : (
        initialsFor(label)
      )}
    </span>
  );
}

function Badge({ value }: { value: number }) {
  if (value <= 0) {
    return null;
  }

  return (
    <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
      {value > 9 ? "9+" : value}
    </span>
  );
}

function ReylumiMark({ className = "h-8 w-8" }: { className?: string }) {
  const __vt = useWorkspaceTranslation();

  return (
    <Image
      aria-hidden="true"
      className={["shrink-0 object-contain", className].join(" ")}
      src="/brand/reylumi-favicon.png"
      alt={__vt("")}
      height={364}
      width={364}
    />
  );
}

function ReylumiLogo() {
  const __vt = useWorkspaceTranslation();

  return (
    <Link
      aria-label={__vt("Reylumi Explore")}
      className="inline-flex min-h-11 shrink-0 items-center rounded-full px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href="/explore"
      onClick={handleExploreLogoClick}
    >
      <Image
        aria-hidden="true"
        alt={__vt("")}
        className="h-auto w-[7.25rem] max-w-[32vw] object-contain min-[390px]:w-[8rem]"
        height={419}
        priority
        src="/brand/reylumi-logo-horizontal.png"
        width={1527}
      />
    </Link>
  );
}

function CustomerWorkspaceRow({
  accountAvatarUrl,
  accountLabel,
  currentWorkspaceId,
  onRunAction,
  pendingKey,
  workspace,
}: CustomerWorkspaceRowProps) {
  const __vt = useWorkspaceTranslation();

  const isSelected = workspace.id === currentWorkspaceId;
  const label = customerWorkspaceLabel(workspace, accountLabel);
  const subtitle = customerWorkspaceSubtitle(workspace);
  const action = workspace.type === "personal"
    ? personalOpenAction()
    : workspaceOpenAction(workspace);
  const isPending = pendingKey === actionKey(workspace, action);

  return (
    <button
      aria-current={isSelected ? "true" : undefined}
      aria-label={__vt(`Switch to ${label}`)}
      className={[
        "grid min-h-[64px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-default",
        isSelected
          ? "bg-brand-orange-soft text-text-primary"
          : "text-text-primary hover:bg-surface-muted",
      ].join(" ")}
      disabled={isSelected || Boolean(pendingKey)}
      onClick={() => onRunAction(workspace, action)}
      type="button"
    >
      <WorkspaceAvatar
        accountAvatarUrl={accountAvatarUrl}
        accountLabel={accountLabel}
        className={workspaceAvatarClass(isSelected)}
        label={__vt(label)}
        workspace={workspace}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold"><WorkspaceText text={label} /></span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-text-secondary">
          <WorkspaceText text={isPending ? "Opening..." : subtitle} />
        </span>
      </span>
      {isSelected ? (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-brand-orange">
          <Icon name="check" />
        </span>
      ) : null}
    </button>
  );
}

function useWorkspaceNavigationFeedback() {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [documentPending, setDocumentPending] = useState(false);
  const [routePending, startTransition] = useTransition();
  const pendingKind = useRef<"document" | "route" | null>(null);
  const active = useRef(false);
  const reset = useCallback(() => {
    pendingKind.current = null;
    setPendingKey(null);
    setDocumentPending(false);
  }, []);

  useLayoutEffect(() => {
    active.current = true;
    window.addEventListener("pageshow", reset);
    return () => {
      active.current = false;
      window.removeEventListener("pageshow", reset);
      reset();
    };
  }, [reset]);

  useEffect(() => {
    if (!routePending && pendingKind.current === "route") reset();
  }, [reset, routePending]);

  function run(key: string, documentNavigation: boolean, navigate: () => void, onError: () => void) {
    if (!active.current || pendingKind.current) return;
    pendingKind.current = documentNavigation ? "document" : "route";
    setPendingKey(key);
    setDocumentPending(documentNavigation);
    startTransition(() => {
      try { navigate(); }
      catch { reset(); onError(); }
    });
  }

  return { pendingKey, pending: pendingKey !== null && (routePending || documentPending), run };
}

function CustomerContextSheet({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
  currentWorkspace,
  isOpen,
  onClose,
  workspaceOptions,
}: CustomerContextSheetProps) {
  const __vt = useWorkspaceTranslation();

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const navigation = useWorkspaceNavigationFeedback();
  const { pendingKey } = navigation;
  const sheetRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const personalWorkspace =
    workspaceOptions.find((workspace) => workspace.type === "personal") ?? null;
  const groups = customerWorkspaceGroups(workspaceOptions);
  const createSalonTarget = findCreateSalonTarget({
    currentWorkspace,
    workspaceOptions,
  });

  const closeAndFocus = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timeout = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);
    const previousBodyOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    function focusableElements() {
      return Array.from(
        sheetRef.current?.querySelectorAll<HTMLElement>(
          CUSTOMER_SHEET_FOCUSABLE,
        ) ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndFocus();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = focusableElements();

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.clearTimeout(timeout);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeAndFocus, isOpen]);

  if (!isOpen) {
    return <NavigationProgress pending={navigation.pending} />;
  }

  const runAction: RunWorkspaceAction = (workspace, action) => {
    navigation.run(actionKey(workspace, action), workspace.id !== currentWorkspaceId, () => {
      setError(null);
      if (workspace.id === currentWorkspaceId) {
        closeAndFocus();
        router.push(action.href);
        router.refresh();
        return;
      }
      navigateToWorkspace(workspace.id, action.href);
      closeAndFocus();
    }, () => setError(WORKSPACE_SWITCH_ERROR));
  };

  const runWorkspaceSwitch: RunWorkspaceAction = (workspace, action) => {
    navigation.run(actionKey(workspace, action), workspace.id !== currentWorkspaceId, () => {
      setError(null);
      if (workspace.id === currentWorkspaceId) {
        closeAndFocus();
        router.push(action.href);
        router.refresh();
        return;
      }
      navigateToWorkspace(workspace.id);
      closeAndFocus();
    }, () => setError(WORKSPACE_SWITCH_ERROR));
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-zinc-950/25 backdrop-blur-[2px] lg:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeAndFocus();
        }
      }}
    >
      <NavigationProgress pending={navigation.pending} />
      <aside
        aria-describedby="customer-context-description"
        aria-labelledby="customer-context-title"
        aria-modal="true"
        className="fixed inset-y-0 left-0 flex h-[100dvh] w-[min(25rem,100vw)] flex-col overflow-hidden rounded-r-2xl bg-surface text-text-primary shadow-2xl"
        id={CUSTOMER_CONTEXT_SHEET_ID}
        ref={sheetRef}
        role="dialog"
      >
        <div className="shrink-0 border-b border-border-subtle px-4 pb-3 pt-[calc(0.9rem+env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-lg font-extrabold"
                id="customer-context-title"
              >
                <WorkspaceText text="Switch account" />
              </p>
              <p
                className="mt-0.5 truncate text-xs font-semibold text-text-secondary"
                id="customer-context-description"
              >
                <WorkspaceText text={accountEmail ?? "Reylumi account"} />
              </p>
            </div>
            <button
              aria-label={__vt("Close account switcher")}
              data-app-local-dismiss="account-switcher"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-secondary transition hover:bg-surface-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              onClick={closeAndFocus}
              ref={closeButtonRef}
              type="button"
            >
              <Icon name="x" />
            </button>
          </div>
        </div>

        <div className="grid flex-1 content-start gap-4 overflow-y-auto px-4 py-4">
          <section className="grid gap-2" aria-label={__vt("Personal account")}>
            {personalWorkspace ? (
              <CustomerWorkspaceRow
                accountAvatarUrl={accountAvatarUrl}
                accountLabel={accountLabel}
                currentWorkspaceId={currentWorkspaceId}
                onRunAction={runWorkspaceSwitch}
                pendingKey={pendingKey}
                workspace={personalWorkspace}
              />
            ) : (
              <div className="grid min-h-[64px] grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl bg-brand-orange-soft px-3">
                <AccountAvatar
                  avatarUrl={accountAvatarUrl}
                  className={workspaceAvatarClass(true)}
                  label={__vt(accountLabel)}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">
                    {accountLabel}
                  </span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-text-secondary">
                    <WorkspaceText text="Personal account" />
                  </span>
                </span>
              </div>
            )}
          </section>

          {groups.map((group) => (
            <section className="grid gap-1" key={group.id}>
              <p className="px-2 text-[11px] font-bold uppercase text-text-secondary">
                <WorkspaceText text={group.label} />
              </p>
              <div className="grid gap-1">
                {group.options.map((workspace) => (
                  <CustomerWorkspaceRow
                    accountAvatarUrl={accountAvatarUrl}
                    accountLabel={accountLabel}
                    currentWorkspaceId={currentWorkspaceId}
                    key={workspace.id}
                    onRunAction={runWorkspaceSwitch}
                    pendingKey={pendingKey}
                    workspace={workspace}
                  />
                ))}
              </div>
            </section>
          ))}

        </div>

        <div className="shrink-0 border-t border-border-subtle bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="grid gap-1">
            {createSalonTarget ? (
              <button
                className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-bold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
                disabled={Boolean(pendingKey)}
                onClick={() =>
                  runAction(createSalonTarget.workspace, createSalonTarget.action)
                }
                type="button"
              >
                <Icon name="plus" />
                <span><WorkspaceText text="Create Salon" /></span>
              </button>
            ) : null}
            <Link
              className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-bold text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/settings"
              onClick={closeAndFocus}
            >
              <Icon name="gear" />
              <span><WorkspaceText text="All Settings" /></span>
            </Link>
            <Link href="/support" onClick={closeAndFocus} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm hover:bg-zinc-100"><Icon name="message" /><span><WorkspaceText text="Report / Contact" /></span></Link>
        <Link href="/help" onClick={closeAndFocus} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm hover:bg-zinc-100"><Icon name="book" /><span><WorkspaceText text="Help" /></span></Link>
            <LogoutButton className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-bold text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60">
              <Icon name="log-out" />
              <span><WorkspaceText text="Log out" /></span>
            </LogoutButton>
          </div>
        </div>
      </aside>
      <ActionDialog
        description={__vt(error ?? "")}
        onClose={() => setError(null)}
        open={Boolean(error)}
        primaryAction={{
          label: "Review workspaces",
          onClick: () => setError(null),
        }}
        secondaryAction={{ href: "/explore", label: "Explore" }}
        title={__vt("Workspace action needed")}
      />
    </div>
  );
}

function customerDesktopNavClass(isActive: boolean) {
  return [
    "group grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
    isActive
      ? "bg-brand-orange-soft text-brand-orange shadow-[0_12px_28px_rgba(255,107,53,0.11)]"
      : "text-text-primary hover:bg-white hover:shadow-[0_10px_24px_rgba(23,19,22,0.045)]",
  ].join(" ");
}

function customerDesktopSoftButtonClass() {
  return "grid h-11 w-11 place-items-center rounded-full bg-surface-elevated text-text-secondary shadow-[0_10px_28px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/85 transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
}

function useDismissibleDetails() {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    function closeDetails(
      detailsElement: HTMLDetailsElement,
      restoreFocus = false,
    ) {
      if (!detailsElement.open) {
        return;
      }

      detailsElement.open = false;

      if (restoreFocus) {
        detailsElement
          .querySelector<HTMLElement>("summary")
          ?.focus({ preventScroll: true });
      }
    }

    function onPointerDown(event: PointerEvent) {
      const detailsElement = detailsRef.current;
      const target = event.target;

      if (!detailsElement || !(target instanceof Node) || !detailsElement.open) {
        return;
      }

      if (!detailsElement.contains(target)) {
        closeDetails(detailsElement);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      const detailsElement = detailsRef.current;

      if (event.key !== "Escape" || !detailsElement || !detailsElement.open) {
        return;
      }

      event.preventDefault();
      closeDetails(detailsElement, true);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return detailsRef;
}

function RoleMorePanel({
  pathname,
  roleKind,
  searchParams,
  variant,
}: {
  pathname: string;
  roleKind: RoleNavigationKind;
  searchParams: SearchParamsReader;
  variant: "desktop" | "mobile" | "rail" | "sidebar";
}) {
  const activeItemIds = ROLE_MORE_ITEMS[roleKind].filter(item => isLinkActive(moreItemAsNavigationLink(item), pathname, searchParams)).map(item => item.id);
  const isMobile = variant === "mobile";
  const isRail = variant === "rail";
  const panelRef = useRef<HTMLDivElement | null>(null);

  function closeMoreMenu() {
    const detailsElement = panelRef.current?.closest("details");
    if (detailsElement) {
      detailsElement.open = false;
    }
  }

  return (
    <div
      ref={panelRef}
      className={[
        "z-[75] overflow-hidden rounded-2xl border border-border-subtle bg-surface-elevated text-text-primary shadow-[0_22px_60px_rgba(35,25,22,0.16)]",
        isMobile
          ? "workspace-mobile-panel fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))]"
          : isRail
            ? "absolute left-[calc(100%+0.75rem)] top-0 w-80"
          : "absolute left-0 top-[calc(100%+0.5rem)] w-full",
      ].join(" ")}
    >
      <RoleMoreContent
        roleKind={roleKind}
        activeItemIds={activeItemIds}
        onNavigate={closeMoreMenu}
        listClassName={isMobile ? "max-h-[min(24rem,55vh)]" : "max-h-[min(28rem,64vh)]"}
      />
    </div>
  );
}

function CustomerDesktopMoreMenu({
  navigation,
  pathname,
  searchParams,
}: {
  navigation: RoleNavigationConfig;
  pathname: string;
  searchParams: SearchParamsReader;
}) {
  const detailsRef = useDismissibleDetails();
  const isActive = isRoleMoreActive(navigation.kind, pathname, searchParams);

  return (
    <details data-dismissible-popover className="group/more relative z-30" ref={detailsRef}>
      <summary
        aria-current={isActive ? "page" : undefined}
        className={[
          customerDesktopNavClass(isActive),
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        ].join(" ")}
        data-more-menu-target="true"
      >
        <span
          className={[
            "grid h-9 w-9 place-items-center rounded-full",
            isActive ? "bg-white" : "bg-brand-orange-soft text-brand-orange",
          ].join(" ")}
        >
          <Icon name="more" />
        </span>
        <span className="truncate"><WorkspaceText text="More" /></span>
        <span className="grid h-7 w-7 place-items-center rounded-full text-text-secondary transition group-open/more:rotate-180">
          <Icon name="chevron-down" />
        </span>
      </summary>
      <RoleMorePanel
        pathname={pathname}
        roleKind={navigation.kind}
        searchParams={searchParams}
        variant="desktop"
      />
    </details>
  );
}

function SidebarMoreMenu({
  link,
  pathname,
  searchParams,
}: {
  link: NavigationLink;
  pathname: string;
  searchParams: SearchParamsReader;
}) {
  const __vt = useWorkspaceTranslation();

  const detailsRef = useDismissibleDetails();
  const roleKind = roleKindForMoreLink(link);
  const isActive = isRoleMoreActive(roleKind, pathname, searchParams);

  return (
    <details data-dismissible-popover className="relative z-30" ref={detailsRef}>
      <summary
        aria-current={isActive ? "page" : undefined}
        className={[
          sidebarLinkClass(isActive),
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        ].join(" ")}
        data-more-menu-target="true"
        title={__vt(link.label)}
      >
        <Icon name={link.icon} />
        <span className="truncate"><WorkspaceText text={link.label} /></span>
      </summary>
      <RoleMorePanel
        pathname={pathname}
        roleKind={roleKind}
        searchParams={searchParams}
        variant="sidebar"
      />
    </details>
  );
}

function RailMoreMenu({
  link,
  pathname,
  searchParams,
}: {
  link: NavigationLink;
  pathname: string;
  searchParams: SearchParamsReader;
}) {
  const __vt = useWorkspaceTranslation();

  const detailsRef = useDismissibleDetails();
  const isActive = isRoleMoreActive("personal", pathname, searchParams);

  return (
    <details data-dismissible-popover className="relative" ref={detailsRef}>
      <summary
        aria-current={matchesPath(pathname, link.href) ? "page" : undefined}
        aria-label={__vt(link.label)}
        className={[
          railLinkClass(isActive),
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        ].join(" ")}
        data-more-menu-target="true"
        title={__vt(link.label)}
      >
        <Icon name={link.icon} />
      </summary>
      <RoleMorePanel
        pathname={pathname}
        roleKind="personal"
        searchParams={searchParams}
        variant="rail"
      />
    </details>
  );
}

function CustomerDesktopLogo({ href }: { href: string }) {
  const __vt = useWorkspaceTranslation();

  return (
    <Link
      aria-label={__vt("Reylumi")}
      className="inline-flex min-h-[4.75rem] w-full items-center rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href={href}
      onClick={href === "/explore" ? handleExploreLogoClick : undefined}
    >
      <Image
        aria-hidden="true"
        alt={__vt("")}
        className="h-auto w-[13.25rem] max-w-full object-contain"
        height={452}
        priority
        src="/brand/reylumi-logo-tagline.png"
        width={1313}
      />
    </Link>
  );
}

function CustomerDesktopWorkspaceSwitcher({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
  currentWorkspace,
  workspaceOptions,
}: {
  accountAvatarUrl: string | null;
  accountEmail: string | null;
  accountLabel: string;
  currentWorkspace: CurrentWorkspaceOption | null;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const __vt = useWorkspaceTranslation();

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  const navigation = useWorkspaceNavigationFeedback();
  const { pendingKey } = navigation;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const personalWorkspace =
    workspaceOptions.find((workspace) => workspace.type === "personal") ??
    currentWorkspace;
  const staffWorkspaces = workspaceOptions.filter(
    (workspace) => workspace.salonMode === "staff",
  );
  const ownerWorkspaces = workspaceOptions.filter(
    (workspace) => workspace.salonMode === "manage",
  );
  const createSalonTarget = findCreateSalonTarget({
    currentWorkspace,
    workspaceOptions,
  });

  const closeMenu = useCallback(() => {
    shouldRestoreFocusRef.current = true;
    setOpen(false);
  }, []);

  useEffect(() => {
    if (isOpen || !shouldRestoreFocusRef.current) {
      return;
    }

    shouldRestoreFocusRef.current = false;
    const timeout = window.setTimeout(() => {
      triggerRef.current?.focus({ preventScroll: true });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (
        panelRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }

      closeMenu();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closeMenu, isOpen]);

  const runAction: RunWorkspaceAction = (workspace, action) => {
    navigation.run(actionKey(workspace, action), workspace.id !== currentWorkspaceId, () => {
      setError(null);
      if (workspace.id === currentWorkspaceId) {
        router.push(action.href);
        router.refresh();
        setOpen(false);
        return;
      }
      navigateToWorkspace(workspace.id, action.href);
      setOpen(false);
    }, () => setError(WORKSPACE_SWITCH_ERROR));
  };

  const runWorkspaceSwitch: RunWorkspaceAction = (workspace, action) => {
    navigation.run(actionKey(workspace, action), workspace.id !== currentWorkspaceId, () => {
      setError(null);
      if (workspace.id === currentWorkspaceId) {
        router.push(action.href);
        router.refresh();
        setOpen(false);
        return;
      }
      navigateToWorkspace(workspace.id);
      setOpen(false);
    }, () => setError(WORKSPACE_SWITCH_ERROR));
  };

  const workspaceRows = [
    ...(personalWorkspace ? [personalWorkspace] : []),
    ...staffWorkspaces,
    ...ownerWorkspaces,
  ];
  const currentLabel = customerWorkspaceLabel(currentWorkspace, accountLabel);
  const currentSubtitle = customerWorkspaceSubtitle(currentWorkspace);

  return (
    <section className="relative" aria-label={__vt("Account switcher")}>
      <NavigationProgress pending={navigation.pending} />
      <button
        aria-controls={CUSTOMER_DESKTOP_ACCOUNT_MENU_ID}
        aria-expanded={isOpen}
        aria-label={__vt("Open account menu")}
        className="grid min-h-[72px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-surface-elevated px-3 text-left shadow-[var(--shadow-soft)] ring-1 ring-divider-subtle/80 transition hover:ring-brand-orange/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        data-testid="customer-desktop-account-trigger"
        onClick={() => {
          shouldRestoreFocusRef.current = isOpen;
          setOpen((open) => !open);
        }}
        ref={triggerRef}
        type="button"
      >
        <WorkspaceAvatar
          accountAvatarUrl={accountAvatarUrl}
          accountLabel={accountLabel}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-orange-soft text-xs font-semibold text-brand-orange"
          label={__vt(currentLabel)}
          workspace={currentWorkspace}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-text-primary">
            {currentLabel}
          </span>
          {accountEmail ? (
            <span className="mt-0.5 block truncate text-[11px] font-normal text-text-secondary">
              {accountEmail}
            </span>
          ) : null}
          <span className="mt-1 block truncate text-xs font-medium text-brand-orange">
            {currentSubtitle}
          </span>
        </span>
        <span
          className={[
            "grid h-8 w-8 place-items-center rounded-full bg-brand-orange-soft text-brand-orange transition-transform",
            isOpen ? "rotate-180" : "",
          ].join(" ")}
        >
          <Icon name="chevron-down" />
        </span>
      </button>

      {isOpen ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl bg-surface-elevated p-2 shadow-[0_24px_60px_rgba(80,47,36,0.14)] ring-1 ring-divider-subtle"
          data-testid="customer-desktop-account-menu"
          id={CUSTOMER_DESKTOP_ACCOUNT_MENU_ID}
          ref={panelRef}
        >
          <div className="grid max-h-[16rem] gap-1 overflow-y-auto pr-1">
            {workspaceRows.map((workspace) => {
              const action =
                workspace.type === "personal"
                  ? personalOpenAction()
                  : workspaceOpenAction(workspace);
              const isSelected = workspace.id === currentWorkspaceId;
              const label = customerWorkspaceLabel(workspace, accountLabel);
              const subtitle = customerWorkspaceSubtitle(workspace);
              const isPending = pendingKey === actionKey(workspace, action);

              return (
                <button
                  aria-current={isSelected ? "true" : undefined}
                  aria-label={__vt(`Switch to ${label}`)}
                  className={[
                    "grid min-h-12 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-default",
                    isSelected
                      ? "bg-brand-orange-soft text-text-primary"
                      : "hover:bg-surface-muted",
                  ].join(" ")}
                  disabled={isSelected || Boolean(pendingKey)}
                  key={workspace.id}
                  onClick={() => runWorkspaceSwitch(workspace, action)}
                  type="button"
                >
                  <WorkspaceAvatar
                    accountAvatarUrl={accountAvatarUrl}
                    accountLabel={accountLabel}
                    className={workspaceAvatarClass(isSelected)}
                    label={__vt(label)}
                    workspace={workspace}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">
                      <WorkspaceText text={label} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-normal text-text-secondary">
                      <WorkspaceText text={isPending ? "Opening..." : subtitle} />
                    </span>
                  </span>
                  {isSelected ? (
                    <span className="grid h-7 w-7 place-items-center rounded-full text-brand-orange">
                      <Icon name="check" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-2 grid gap-1 border-t border-border-subtle pt-2">
            {createSalonTarget ? (
              <button
                className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-2.5 text-left text-sm font-medium text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
                disabled={Boolean(pendingKey)}
                onClick={() =>
                  runAction(createSalonTarget.workspace, createSalonTarget.action)
                }
                type="button"
              >
                <Icon name="plus" />
                <span><WorkspaceText text="Create Salon" /></span>
              </button>
            ) : null}
            <Link
              className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/settings"
            >
              <Icon name="gear" />
              <span><WorkspaceText text="All Settings" /></span>
            </Link>
            <Link href="/support" onClick={closeMenu} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm hover:bg-zinc-100"><Icon name="message" /><span><WorkspaceText text="Report / Contact" /></span></Link>
        <Link href="/help" onClick={closeMenu} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm hover:bg-zinc-100"><Icon name="book" /><span><WorkspaceText text="Help" /></span></Link>
            <LogoutButton className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60">
              <Icon name="log-out" />
              <span><WorkspaceText text="Log out" /></span>
            </LogoutButton>
          </div>
        </div>
      ) : null}
      <ActionDialog
        description={__vt(error ?? "")}
        onClose={() => setError(null)}
        open={Boolean(error)}
        primaryAction={{
          label: "Review workspaces",
          onClick: () => setError(null),
        }}
        secondaryAction={{ href: "/my-place", label: "My Place" }}
        title={__vt("Workspace action needed")}
      />
    </section>
  );
}

function CustomerDesktopNavigation({
  navigation,
  notificationSummary,
  pathname,
  searchParams,
}: {
  navigation: RoleNavigationConfig;
  notificationSummary: NotificationSummary;
  pathname: string;
  searchParams: SearchParamsReader;
}) {
  const __vt = useWorkspaceTranslation();

  return (
    <nav aria-label={__vt(navigation.desktopAriaLabel)} className="grid gap-1">
      <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary">
        <WorkspaceText text="Navigation" />
      </p>
      {navigation.links.map((link) => {
        const isActive =
          isMoreLink(link)
            ? isRoleMoreActive(navigation.kind, pathname, searchParams)
            : isLinkActive(link, pathname, searchParams);

        if (isMoreLink(link)) {
          return (
            <CustomerDesktopMoreMenu
              key={link.id}
              navigation={navigation}
              pathname={pathname}
              searchParams={searchParams}
            />
          );
        }

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={customerDesktopNavClass(isActive)}
            href={link.href}
            key={link.id}
          >
            <span
              className={[
                "grid h-9 w-9 place-items-center rounded-full",
                isActive ? "bg-white" : "bg-brand-orange-soft text-brand-orange",
              ].join(" ")}
            >
              <Icon name={link.icon} />
            </span>
            <span className="truncate"><WorkspaceText text={link.label} /></span>
            {link.id === "notifications" && notificationSummary.total > 0 ? (
              <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white">
                {notificationSummary.total > 9 ? "9+" : notificationSummary.total}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function CustomerDesktopMembershipCard() {
  return (
    <section className="min-w-0 border-t border-divider-subtle bg-surface-elevated py-3">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-brand-orange-soft text-brand-orange">
          <Icon name="star" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">
            <WorkspaceText text="Become a Member" />
          </h2>
          <p className="mt-1 line-clamp-2 text-xs font-normal leading-5 text-text-secondary">
            <WorkspaceText text="Unlock customer perks, saved favorites, and special offers." />
          </p>
        </div>
      </div>
      <Link
        className="mt-2 inline-flex min-h-8 items-center justify-center rounded-full bg-brand-orange px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href="/more/memberships"
      >
        <WorkspaceText text="View Memberships" />
      </Link>
    </section>
  );
}

function CustomerDesktopSidebar({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
  currentWorkspace,
  navigation,
  notificationSummary,
  pathname,
  searchParams,
  workspaceOptions,
}: {
  accountAvatarUrl: string | null;
  accountEmail: string | null;
  accountLabel: string;
  currentWorkspace: CurrentWorkspaceOption | null;
  navigation: RoleNavigationConfig;
  notificationSummary: NotificationSummary;
  pathname: string;
  searchParams: SearchParamsReader;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const __vt = useWorkspaceTranslation();

  return (
    <aside
      aria-label={__vt(`${navigation.ariaLabel} account`)}
      className="sticky top-0 flex h-screen min-w-0 flex-col gap-3 overflow-y-auto border-r border-divider-subtle/70 bg-surface-elevated px-4 py-4 shadow-[10px_0_34px_rgba(35,25,22,0.035)]"
      data-testid="customer-desktop-sidebar"
    >
      <CustomerDesktopLogo href={navigation.homeHref} />
      <CustomerDesktopWorkspaceSwitcher
        accountAvatarUrl={accountAvatarUrl}
        accountEmail={accountEmail}
        accountLabel={accountLabel}
        currentWorkspace={currentWorkspace}
        workspaceOptions={workspaceOptions}
      />
      <CustomerDesktopNavigation
        navigation={navigation}
        notificationSummary={notificationSummary}
        pathname={pathname}
        searchParams={searchParams}
      />
      <ExploreAdSlot desktop />
      <div className="mt-auto">
        {currentWorkspace?.salonMode !== "staff" && <CustomerDesktopMembershipCard />}
      </div>
    </aside>
  );
}

function NotificationDropdown({
  notificationSummary,
  triggerClassName,
  bottom = false,
  isActive = false,
}: {
  notificationSummary: NotificationSummary;
  triggerClassName: string;
  bottom?: boolean;
  isActive?: boolean;
}) {
  const __vt = useWorkspaceTranslation();

  const [error,setError]=useState("");
  const [marking,setMarking]=useState(false);
  useEffect(()=>{const show=(event:Event)=>setError((event as CustomEvent<string>).detail); window.addEventListener("kingpos:notifications-error",show); return ()=>window.removeEventListener("kingpos:notifications-error",show);},[]);
  const detailsRef = useDismissibleDetails();
  const displaySummary = notificationSummary;
  const previewItems = displaySummary.previewItems;
  const hasUnreadAppNotifications = displaySummary.bookingNotifications > 0;

  return (
    <details data-dismissible-popover
      className={bottom ? "relative min-w-0" : "relative"}
      onToggle={event => { if (event.currentTarget.open) window.dispatchEvent(new CustomEvent(NOTIFICATIONS_REFRESH,{detail:{force:false}})); }}
      ref={detailsRef}
    >
      <summary
        aria-current={isActive ? "page" : undefined}
        aria-label={__vt("Notifications")}
        data-app-notification-trigger="true"
        className={[triggerClassName, "cursor-pointer list-none"].join(" ")}
      >
        <span className={bottom ? "relative grid h-7 w-7 shrink-0 place-items-center" : "relative"}>
          <Icon name="bell" />
          {displaySummary.total > 0 ? (
            <span className="absolute -right-2 -top-2 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-black leading-none text-white">
              {displaySummary.total > 9 ? "9+" : displaySummary.total}
            </span>
          ) : null}
        </span>
        {bottom ? <span className="max-w-full truncate"><WorkspaceText text="Notifications" /></span> : null}
      </summary>
      <div className={`fixed right-2 ${bottom ? "workspace-mobile-panel bottom-[calc(5rem+env(safe-area-inset-bottom))]" : "top-[calc(4.75rem+env(safe-area-inset-top))]"} z-[70] flex max-h-[calc(100dvh-7rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-950 shadow-2xl sm:right-4`}>
        <header className="px-4 pb-3 pt-4">
          <div className="flex items-center gap-3">
            <h2 className="min-w-0 flex-1 text-xl font-bold"><WorkspaceText text="Notifications" /></h2>
            <Link aria-label={__vt("Notification settings")} prefetch={false} href="/settings?section=notifications" className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100"><Icon name="gear" /></Link>
            {hasUnreadAppNotifications ? (
                <button
                  disabled={marking}
                  onClick={()=>{setMarking(true);void markAllCenterViewed().catch(e=>setError(e.message)).finally(()=>setMarking(false));}}
                  className="inline-flex min-h-8 items-center justify-center rounded-full px-2.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  type="button"
                >
                  <WorkspaceText text="Mark all viewed" />
                </button>
            ) : null}
          </div>
        </header>
        {error && <p role="alert" className="mx-3 rounded-md bg-red-50 p-2 text-xs text-red-700"><WorkspaceText text={error} /> <button type="button" className="font-semibold underline" onClick={()=>{setError("");window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH));}}><WorkspaceText text="Retry" /></button></p>}
        <div className="flex items-center gap-3 px-4 pb-1">
          <p className="min-w-0 flex-1 text-base font-bold"><WorkspaceText text="Recent updates" /></p>
          <Link
            className="text-sm font-semibold text-blue-700 transition hover:text-blue-800"
            href="/notifications"
          >
            <WorkspaceText text="See all" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NotificationFeedList
            compact
            emptyLabel="No notifications yet."
            items={previewItems.filter(item=>item.source === "app").slice(0,5)}
          />
        </div>
        {previewItems.some(item=>item.source !== "app") && <section className="max-h-40 overflow-y-auto border-t border-zinc-100 p-3"><h3 className="mb-2 text-sm font-bold"><WorkspaceText text="Needs action" /></h3><NotificationFeedList compact items={previewItems.filter(item=>item.source !== "app")} /></section>}
        <footer className="border-t border-zinc-100 p-3">
          <Link
            className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-zinc-200 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
            href="/notifications"
            prefetch={false}
          >
            <WorkspaceText text="View notification center" />
          </Link>
        </footer>
      </div>
    </details>
  );
}

function CustomerDesktopHeader({
  accountAvatarUrl,
  accountLabel,
  currentWorkspace,
  notificationSummary,
  pathname,
  searchParams,
}: {
  accountAvatarUrl: string | null;
  accountLabel: string;
  currentWorkspace: CurrentWorkspaceOption | null;
  notificationSummary: NotificationSummary;
  pathname: string;
  searchParams: SearchParamsReader;
}) {
  const __vt = useWorkspaceTranslation();

  const staffWorkspace = currentWorkspace?.salonMode === "staff";
  const compactStaffHeader = staffWorkspace && pathname !== "/explore";
  const exploreHeader = pathname === "/explore";
  const [nearYouEnabled, setNearYouEnabled] = useState(false);
  const [nearYouPending, setNearYouPending] = useState(false);
  useEffect(() => {
    function updateLocationState(event: Event) {
      const state = (event as CustomEvent<{ enabled: boolean; pending: boolean }>).detail;
      setNearYouEnabled(state.enabled);
      setNearYouPending(state.pending);
    }
    window.addEventListener("kingpos:explore-location-state", updateLocationState);
    window.dispatchEvent(new Event("kingpos:explore-request-location-state"));
    return () => window.removeEventListener("kingpos:explore-location-state", updateLocationState);
  }, [pathname]);
  const exploreQuery =
    pathname === "/explore"
      ? searchParams.get("q") ?? ""
      : "";
  const router = useRouter();
  const accountSubtitle =
    currentWorkspace?.type === "personal"
      ? "Personal Account"
      : customerWorkspaceLabel(currentWorkspace, accountLabel);

  function requestExploreLocation() {
    if (pathname !== "/explore") {
      router.push("/explore");
      return;
    }

    window.dispatchEvent(new CustomEvent(nearYouEnabled || nearYouPending
      ? "kingpos:explore-clear-current-location"
      : "kingpos:explore-use-current-location"));
  }

  return (
    <header
      className={compactStaffHeader || exploreHeader ? "sticky top-0 z-30 border-b border-zinc-100 bg-white/95 px-6 py-3 backdrop-blur-sm" : "sticky top-0 z-30 bg-white/92 px-7 py-4 backdrop-blur-sm"}
      data-testid="customer-desktop-header"
    >
      <div className={exploreHeader ? "flex items-center justify-end gap-4" : compactStaffHeader ? "flex items-center justify-between gap-4" : "grid grid-cols-[minmax(24rem,1fr)_auto] items-center gap-5"}>
        {exploreHeader ? <ExploreHeaderSearchSlot /> : null}
        {compactStaffHeader ? <span className="text-sm text-zinc-500"><WorkspaceText text="Staff workspace" /></span> : null}
        {!compactStaffHeader && !exploreHeader && <NavigationForm action="/explore" className="relative" role="search"
          onSubmit={(event) => {
            if (!nearYouEnabled || pathname !== "/explore") return;
            event.preventDefault();
            const query = String(new FormData(event.currentTarget).get("q") ?? "");
            window.dispatchEvent(new CustomEvent("kingpos:explore-search-current-location", { detail: { query } }));
          }}>
          <input name="location" type="hidden" value="" />
          <label className="sr-only" htmlFor="customer-desktop-search">
            <WorkspaceText text="Search salons, services, or locations" />
          </label>
          <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-text-secondary">
            <Icon name="search" />
          </span>
          <input
            className="h-14 w-full rounded-full bg-surface-elevated pl-12 pr-64 text-sm font-normal text-text-primary shadow-[0_12px_30px_rgba(35,25,22,0.045)] outline-none ring-1 ring-divider-subtle/85 transition placeholder:font-normal placeholder:text-text-secondary/80 focus:ring-4 focus:ring-brand-orange/15"
            defaultValue={exploreQuery}
            id="customer-desktop-search"
            key={exploreQuery}
            name="q"
            placeholder={__vt("Search salons, services, designs, city, or ZIP...")}
            type="search"
          />
          <button
            aria-label={__vt(nearYouEnabled || nearYouPending ? "Turn off nearby search" : "Turn on nearby search")}
            aria-pressed={nearYouEnabled}
            title={__vt(nearYouEnabled || nearYouPending ? "Click to search any location" : "Click to search near your current location")}
            className="absolute right-24 top-1/2 inline-flex min-h-10 -translate-y-1/2 items-center gap-1.5 rounded-full bg-brand-teal-soft px-3 text-xs font-semibold text-brand-teal transition hover:bg-white hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
            onClick={requestExploreLocation}
            type="button"
          >
            <Icon name="compass" />
            <span><WorkspaceText text={nearYouPending ? "Locating… ×" : nearYouEnabled ? "Near you · On ×" : "Any location"} /></span>
          </button>
          <NavigationSubmitButton
            className="absolute right-2 top-1/2 inline-flex min-h-10 -translate-y-1/2 items-center justify-center rounded-full bg-brand-orange px-5 text-xs font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            pendingLabel="Searching…"
            type="submit"
          >
            <WorkspaceText text="Search" />
          </NavigationSubmitButton>
        </NavigationForm>}
        <div className="flex items-center gap-3">
          {compactStaffHeader && <Link href="/explore" aria-label={__vt("Search salons and services")} className={customerDesktopSoftButtonClass()}><Icon name="search" /></Link>}
          <NotificationDropdown
            notificationSummary={notificationSummary}
            triggerClassName={customerDesktopSoftButtonClass()}
          />
          <Link
            aria-label={__vt("Messages")}
            className={customerDesktopSoftButtonClass()}
            href="/notifications"
          >
            <Icon name="message" />
          </Link>
          <Link
            aria-label={__vt(staffWorkspace ? "Open Staff Profile" : "All settings")}
            className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-full bg-surface-elevated py-1 pl-1.5 pr-4 text-left shadow-[0_10px_28px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/85 transition hover:ring-brand-orange/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={staffWorkspace ? "/staff/my-work?profile=1" : "/settings"}
          >
            <AccountAvatar
              avatarUrl={staffWorkspace ? currentWorkspace?.staffAvatarUrl ?? null : accountAvatarUrl}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-orange-soft text-xs font-semibold text-brand-orange"
              label={__vt(staffWorkspace ? currentWorkspace?.staffDisplayName || "Staff" : accountLabel)}
            />
            <span className="min-w-0">
              <span className="block max-w-32 truncate text-sm font-semibold text-text-primary">
                {staffWorkspace ? currentWorkspace?.staffDisplayName || "Staff" : accountLabel}
              </span>
              <span className="block text-xs font-normal text-text-secondary">
                {accountSubtitle}
              </span>
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function CustomerMobileHeader({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
  currentWorkspace,
  notificationSummary,
  workspaceOptions,
}: {
  accountAvatarUrl: string | null;
  accountEmail: string | null;
  accountLabel: string;
  currentWorkspace: CurrentWorkspaceOption | null;
  notificationSummary: NotificationSummary;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const __vt = useWorkspaceTranslation();

  const [isContextOpen, setContextOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const shouldRestoreContextFocusRef = useRef(false);
  const label = customerWorkspaceLabel(currentWorkspace, accountLabel);

  const closeContext = useCallback(() => {
    shouldRestoreContextFocusRef.current = true;
    setContextOpen(false);
  }, []);

  useEffect(() => {
    if (isContextOpen || !shouldRestoreContextFocusRef.current) {
      return;
    }

    shouldRestoreContextFocusRef.current = false;
    triggerRef.current?.focus({ preventScroll: true });
  }, [isContextOpen]);

  return (
    <>
      <header className="sticky top-0 z-50 bg-surface/90 px-3 pb-2 pt-[calc(0.6rem+env(safe-area-inset-top))] shadow-[0_10px_30px_rgba(80,47,36,0.055)] backdrop-blur lg:hidden">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
          <button
            aria-controls={CUSTOMER_CONTEXT_SHEET_ID}
            aria-expanded={isContextOpen}
            aria-label={__vt("Open account switcher")}
            className="grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1 text-left transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={() => setContextOpen(true)}
            ref={triggerRef}
            type="button"
          >
            <WorkspaceAvatar
              accountAvatarUrl={accountAvatarUrl}
              accountLabel={accountLabel}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-orange-soft text-xs font-semibold text-brand-orange"
              label={__vt(label)}
              workspace={currentWorkspace}
            />
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold text-text-primary min-[430px]:text-sm">
                <WorkspaceText text={label} />
              </span>
              {currentWorkspace?.type === "salon" && (
                <span className="mt-0.5 block truncate text-[10px] font-normal leading-tight text-text-secondary min-[430px]:text-xs">
                  <WorkspaceText text={customerWorkspaceSubtitle(currentWorkspace)} />
                </span>
              )}
            </span>
            <span className="grid h-6 w-6 self-center place-items-center rounded-full bg-brand-orange-soft text-text-secondary ring-1 ring-brand-orange/15">
              <Icon name="chevron-down" />
            </span>
          </button>
          <NotificationDropdown
            notificationSummary={notificationSummary}
            triggerClassName="grid h-11 w-11 place-items-center rounded-full bg-surface-elevated text-text-secondary shadow-[var(--shadow-soft)] ring-1 ring-divider-subtle/80 transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          />
          <span className="shrink-0 [&_img]:w-[104px] [&_img]:max-w-[26vw]"><ReylumiLogo /></span>
        </div>
      </header>
      <CustomerContextSheet
        accountAvatarUrl={accountAvatarUrl}
        accountEmail={accountEmail}
        accountLabel={accountLabel}
        currentWorkspace={currentWorkspace}
        isOpen={isContextOpen}
        onClose={closeContext}
        workspaceOptions={workspaceOptions}
      />
    </>
  );
}

function WorkspaceOptionButton({
  accountAvatarUrl,
  accountLabel,
  currentWorkspaceId,
  workspace,
}: {
  accountAvatarUrl: string | null;
  accountLabel: string;
  currentWorkspaceId: string | null;
  workspace: CurrentWorkspaceOption;
}) {
  const __vt = useWorkspaceTranslation();

  const isCurrent = workspace.id === currentWorkspaceId;
  const label = customerWorkspaceLabel(workspace, accountLabel);
  const subtitle = customerWorkspaceSubtitle(workspace);

  return (
    <NavigationForm action="/workspace/open" method="get">
      <input name="workspace_id" type="hidden" value={workspace.id} />
      <NavigationSubmitButton
        className={[
          "grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-default",
          isCurrent
            ? "bg-zinc-950 text-white"
            : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950",
        ].join(" ")}
        disabled={isCurrent}
        type="submit"
      >
        <WorkspaceAvatar
          accountAvatarUrl={accountAvatarUrl}
          accountLabel={accountLabel}
          className={[
            "grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold",
            isCurrent
              ? "bg-white/15 text-white"
              : "bg-brand-orange-soft text-brand-orange",
          ].join(" ")}
          label={__vt(label)}
          workspace={workspace}
        />
        <span className="min-w-0">
          <span className="block truncate font-semibold"><WorkspaceText text={label} /></span>
          <span
            className={[
              "block truncate text-xs",
              isCurrent ? "text-zinc-200" : "text-zinc-500",
            ].join(" ")}
          >
            <WorkspaceText text={subtitle} />
          </span>
        </span>
      </NavigationSubmitButton>
    </NavigationForm>
  );
}

function groupWorkspaceOptions(workspaceOptions: CurrentWorkspaceOption[]) {
  return [
    {
      id: "personal",
      label: "Personal",
      options: workspaceOptions.filter((workspace) => workspace.type === "personal"),
    },
    {
      id: "staff",
      label: "Staff",
      options: workspaceOptions.filter(
        (workspace) => workspace.salonMode === "staff",
      ),
    },
    {
      id: "owner",
      label: "Owner",
      options: workspaceOptions.filter(
        (workspace) => workspace.salonMode === "manage",
      ),
    },
  ].filter((group) => group.options.length > 0);
}

function ModeSwitch({
  currentWorkspace,
  workspaceOptions,
}: {
  currentWorkspace: CurrentWorkspaceOption | null;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  if (!currentWorkspace?.salonId) {
    return null;
  }

  const modeOptions = workspaceOptions.filter(
    (workspace) =>
      workspace.type === "salon" && workspace.salonId === currentWorkspace.salonId,
  );

  if (modeOptions.length <= 1) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1">
      {(["staff", "manage"] as const).map((mode) => {
        const option = modeOptions.find((workspace) => workspace.salonMode === mode);
        const isActive = currentWorkspace.salonMode === mode;

        if (!option) {
          return (
            <span
              className="rounded-md px-3 py-1.5 text-center text-sm font-semibold text-zinc-400"
              key={mode}
            >
              {mode === "staff" ? <WorkspaceText text="Staff" /> : <WorkspaceText text="Owner" />}
            </span>
          );
        }

        return (
          <NavigationForm action="/workspace/open" method="get" key={mode}>
            <input name="workspace_id" type="hidden" value={option.id} />
            <NavigationSubmitButton
              aria-pressed={isActive}
              className={[
                "w-full rounded-md px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
                isActive
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-600 hover:text-zinc-950",
              ].join(" ")}
              disabled={isActive}
              type="submit"
            >
              {mode === "staff" ? <WorkspaceText text="Staff" /> : <WorkspaceText text="Owner" />}
            </NavigationSubmitButton>
          </NavigationForm>
        );
      })}
    </div>
  );
}

function WorkspaceSwitcher({
  accountAvatarUrl,
  accountLabel,
  currentWorkspace,
  workspaceOptions,
}: {
  accountAvatarUrl: string | null;
  accountLabel: string;
  currentWorkspace: CurrentWorkspaceOption | null;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const __vt = useWorkspaceTranslation();

  const detailsRef = useDismissibleDetails();
  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const currentLabel = customerWorkspaceLabel(currentWorkspace, accountLabel);

  return (
    <details data-dismissible-popover className="relative" ref={detailsRef}>
      <summary className="flex min-h-[3.25rem] cursor-pointer list-none items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm transition hover:border-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950">
        <WorkspaceAvatar
          accountAvatarUrl={accountAvatarUrl}
          accountLabel={accountLabel}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-orange-soft text-xs font-semibold text-brand-orange"
          label={__vt(currentLabel)}
          workspace={currentWorkspace}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-zinc-950">
            {currentLabel}
          </span>
          <span className="block truncate text-xs text-zinc-500">
            {customerWorkspaceSubtitle(currentWorkspace)}
          </span>
        </span>
        <span aria-hidden="true" className="ml-auto text-xs text-zinc-500">
          v
        </span>
      </summary>
      <div className="absolute left-0 z-50 mt-2 grid max-h-[min(42rem,calc(100vh-6rem))] w-[min(24rem,calc(100vw-2rem))] gap-4 overflow-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-xl">
        {groupWorkspaceOptions(workspaceOptions).map((group) => (
          <section className="grid gap-1" key={group.id}>
            <p className="px-2 text-xs font-semibold uppercase text-zinc-500">
              <WorkspaceText text={group.label} />
            </p>
            {group.options.map((workspace) => (
              <WorkspaceOptionButton
                accountAvatarUrl={accountAvatarUrl}
                accountLabel={accountLabel}
                currentWorkspaceId={currentWorkspaceId}
                key={workspace.id}
                workspace={workspace}
              />
            ))}
          </section>
        ))}
      </div>
    </details>
  );
}

function AppRail({
  accountAvatarUrl,
  accountLabel,
  isWorkspacePanelOpen,
  notificationSummary,
  onOpenWorkspacePanel,
  pathname,
  searchParams,
}: {
  accountAvatarUrl: string | null;
  accountLabel: string;
  isWorkspacePanelOpen: boolean;
  notificationSummary: NotificationSummary;
  onOpenWorkspacePanel: (button: HTMLButtonElement) => void;
  pathname: string;
  searchParams: SearchParamsReader;
}) {
  const __vt = useWorkspaceTranslation();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-16 flex-col border-r border-zinc-200 bg-white lg:flex">
      <Link
        aria-label={__vt("Reylumi Explore")}
        className="mx-auto mt-3 grid h-10 w-10 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href="/explore"
        title={__vt("Reylumi")}
      >
        <ReylumiMark className="h-10 w-10 text-lg" />
      </Link>
      <nav aria-label={__vt("Personal app")} className="mt-6 grid justify-center gap-2">
        {PERSONAL_LINKS.map((link) => {
          const isActive = isLinkActive(link, pathname, searchParams);

          if (isMoreLink(link)) {
            return (
              <RailMoreMenu
                key={link.id}
                link={link}
                pathname={pathname}
                searchParams={searchParams}
              />
            );
          }

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              aria-label={__vt(link.label)}
              className={railLinkClass(isActive)}
              href={link.href}
              key={link.id}
              title={__vt(link.label)}
            >
              <Icon name={link.icon} />
              {link.id === "notifications" ? (
                <Badge value={notificationSummary.total} />
              ) : null}
            </Link>
          );
        })}
        <button
          aria-current={matchesPath(pathname, WORKSPACE_PANEL_LINK.href) ? "page" : undefined}
          aria-expanded={isWorkspacePanelOpen}
          aria-label={__vt(WORKSPACE_PANEL_LINK.label)}
          className={railLinkClass(
            matchesPath(pathname, WORKSPACE_PANEL_LINK.href),
            isWorkspacePanelOpen && !matchesPath(pathname, WORKSPACE_PANEL_LINK.href),
          )}
          onClick={(event) => onOpenWorkspacePanel(event.currentTarget)}
          title={__vt(WORKSPACE_PANEL_LINK.label)}
          type="button"
        >
          <Icon name={WORKSPACE_PANEL_LINK.icon} />
        </button>
      </nav>
      <Link
        aria-label={__vt("All Settings")}
        className="mx-auto mb-3 mt-auto grid h-10 w-10 place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href="/settings"
        title={__vt("All Settings")}
      >
        <AccountAvatar
          avatarUrl={accountAvatarUrl}
          className="grid h-full w-full place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange"
          label={__vt(accountLabel)}
        />
      </Link>
    </aside>
  );
}

function WorkspaceNavigation({
  pathname,
  searchParams,
  workspaceSections,
}: {
  pathname: string;
  searchParams: SearchParamsReader;
  workspaceSections: readonly NavigationSection[];
}) {
  const __vt = useWorkspaceTranslation();

  if (workspaceSections.length === 0) {
    return null;
  }

  return (
    <nav aria-label={__vt("Workspace")} className="grid gap-4">
      {workspaceSections.map((section) => (
        <section className="grid gap-1" key={section.id}>
          <p className="px-2 text-[11px] font-semibold uppercase text-zinc-500">
            <WorkspaceText text={section.label} />
          </p>
          <div className="grid gap-0.5">
            {section.links.map((link) => {
              const isActive = isLinkActive(link, pathname, searchParams);

              if (isMoreLink(link)) {
                return (
                  <SidebarMoreMenu
                    key={link.id}
                    link={link}
                    pathname={pathname}
                    searchParams={searchParams}
                  />
                );
              }

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={sidebarLinkClass(isActive)}
                  href={link.href}
                  key={link.id}
                  title={__vt(link.label)}
                >
                  <Icon name={link.icon} />
                  <span className="truncate"><WorkspaceText text={link.label} /></span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}

function ProfileMenu({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
}: {
  accountAvatarUrl: string | null;
  accountEmail: string | null;
  accountLabel: string;
}) {
  const __vt = useWorkspaceTranslation();

  const detailsRef = useDismissibleDetails();

  return (
    <details data-dismissible-popover className="relative" ref={detailsRef}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950">
        <AccountAvatar
          avatarUrl={accountAvatarUrl}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange"
          label={__vt(accountLabel)}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-zinc-950">
            {accountLabel}
          </span>
          <span className="block truncate text-xs text-zinc-500">
            <WorkspaceText text={accountEmail ?? "Reylumi account"} />
          </span>
        </span>
      </summary>
      <div className="absolute bottom-full left-0 z-50 mb-2 grid w-full gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl">
        <Link className={sidebarLinkClass(false)} href="/settings">
          <Icon name="user" />
          <WorkspaceText text="All Settings" />
        </Link>
        <Link href="/support" className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm hover:bg-zinc-100"><Icon name="message" /><span><WorkspaceText text="Report / Contact" /></span></Link>
        <Link href="/help" className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm hover:bg-zinc-100"><Icon name="book" /><span><WorkspaceText text="Help" /></span></Link>
            <LogoutButton />
      </div>
    </details>
  );
}

function WorkspaceSidebar({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
  currentAccountName,
  currentWorkspace,
  pathname,
  searchParams,
  workspaceOptions,
  workspaceSections,
}: {
  accountAvatarUrl: string | null;
  accountEmail: string | null;
  accountLabel: string;
  currentAccountName: string | null;
  currentWorkspace: CurrentWorkspaceOption | null;
  pathname: string;
  searchParams: SearchParamsReader;
  workspaceOptions: CurrentWorkspaceOption[];
  workspaceSections: readonly NavigationSection[];
}) {
  return (
    <aside className="fixed inset-y-0 left-16 z-40 hidden w-60 flex-col border-r border-zinc-200 bg-white lg:flex">
      <div className="grid gap-3 border-b border-zinc-200 p-3">
        <WorkspaceSwitcher
          accountAvatarUrl={accountAvatarUrl}
          accountLabel={accountLabel}
          currentWorkspace={currentWorkspace}
          workspaceOptions={workspaceOptions}
        />
        <ModeSwitch
          currentWorkspace={currentWorkspace}
          workspaceOptions={workspaceOptions}
        />
        {currentAccountName ? (
          <p className="truncate px-1 text-xs text-zinc-500">
            {currentAccountName}
          </p>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <WorkspaceNavigation
          pathname={pathname}
          searchParams={searchParams}
          workspaceSections={workspaceSections}
        />
      </div>
      <div className="border-t border-zinc-200 p-2">
        <ProfileMenu
          accountAvatarUrl={accountAvatarUrl}
          accountEmail={accountEmail}
          accountLabel={accountLabel}
        />
      </div>
    </aside>
  );
}

function MobileHeader({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
  currentWorkspace,
  isCustomerShell,
  notificationSummary,
  workspaceOptions,
  workspaceSections,
  pathname,
  searchParams,
}: {
  accountAvatarUrl: string | null;
  accountEmail: string | null;
  accountLabel: string;
  currentWorkspace: CurrentWorkspaceOption | null;
  isCustomerShell: boolean;
  notificationSummary: NotificationSummary;
  pathname: string;
  searchParams: SearchParamsReader;
  workspaceOptions: CurrentWorkspaceOption[];
  workspaceSections: readonly NavigationSection[];
}) {
  const __vt = useWorkspaceTranslation();

  const workspaceNavigationDetailsRef = useDismissibleDetails();

  if (isCustomerShell) {
    return (
      <CustomerMobileHeader
        accountAvatarUrl={accountAvatarUrl}
        accountEmail={accountEmail}
        accountLabel={accountLabel}
        currentWorkspace={currentWorkspace}
        notificationSummary={notificationSummary}
        workspaceOptions={workspaceOptions}
      />
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 px-3 py-3 backdrop-blur lg:hidden">
      <div className="flex items-center gap-3">
        <WorkspaceSwitcher
          accountAvatarUrl={accountAvatarUrl}
          accountLabel={accountLabel}
          currentWorkspace={currentWorkspace}
          workspaceOptions={workspaceOptions}
        />
        <details data-dismissible-popover className="relative ml-auto" ref={workspaceNavigationDetailsRef}>
          <summary
            aria-label={__vt("Open workspace navigation")}
            className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-md border border-zinc-200 text-zinc-700"
          >
            <Icon name="list" />
          </summary>
          <div className="absolute right-0 z-50 mt-2 grid max-h-[75vh] w-[min(22rem,calc(100vw-2rem))] gap-4 overflow-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-xl">
            <WorkspaceNavigation
              pathname={pathname}
              searchParams={searchParams}
              workspaceSections={workspaceSections}
            />
            <Link className={sidebarLinkClass(false)} href="/settings">
              <Icon name="user" />
              <WorkspaceText text="All Settings" />
            </Link>
          </div>
        </details>
        <Link
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange"
          href="/settings"
        >
          <AccountAvatar
            avatarUrl={accountAvatarUrl}
            className="grid h-full w-full place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange"
            label={__vt(accountLabel)}
          />
        </Link>
      </div>
    </header>
  );
}

function MobileMoreMenu({
  isActive,
  link,
  pathname,
  roleKind,
  searchParams,
}: {
  isActive: boolean;
  link: NavigationLink;
  pathname: string;
  roleKind: RoleNavigationKind;
  searchParams: SearchParamsReader;
}) {
  const detailsRef = useDismissibleDetails();

  return (
    <details data-dismissible-popover className="relative min-w-0" ref={detailsRef}>
      <summary
        aria-current={isActive ? "page" : undefined}
        className={[
          "group relative flex min-h-[58px] min-w-0 cursor-pointer list-none flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[9px] font-bold leading-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange min-[360px]:text-[10px] min-[390px]:text-[11px] [&::-webkit-details-marker]:hidden",
          isActive
            ? "bg-brand-orange-soft text-brand-orange"
            : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
        ].join(" ")}
        data-more-menu-target="true"
      >
        <span
          className="relative grid h-7 w-7 shrink-0 place-items-center"
        >
          <Icon name={link.icon} />
        </span>
        <span className="max-w-full truncate"><WorkspaceText text={link.label} /></span>
      </summary>
      <RoleMorePanel
        pathname={pathname}
        roleKind={roleKind}
        searchParams={searchParams}
        variant="mobile"
      />
    </details>
  );
}

function MobileBottomNav({
  ariaLabel,
  links,
  notificationSummary,
  pathname,
  roleKind,
  searchParams,
}: {
  ariaLabel: string;
  links: readonly NavigationLink[];
  notificationSummary: NotificationSummary;
  pathname: string;
  roleKind: RoleNavigationKind;
  searchParams: SearchParamsReader;
}) {
  const __vt = useWorkspaceTranslation();

  return (
    <nav
      aria-label={__vt(ariaLabel)}
      className="workspace-mobile-nav fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-border-subtle bg-surface px-1 pb-[env(safe-area-inset-bottom)] pt-2.5 shadow-[0_-10px_30px_rgba(23,19,22,0.08)] lg:hidden"
    >
      {links.map((originalLink) => {
        const link: NavigationLink = roleKind === "owner" && originalLink.href === "/notifications"
          ? { href: "/reports", icon: "list", id: "owner-reports", label: "Reports" }
          : originalLink;
        const isOwnerReportsActive = roleKind === "owner" && customerRouteMatches(pathname, "/reports");
        const isActive =
          isMoreLink(link)
            ? !isOwnerReportsActive && isRoleMoreActive(roleKind, pathname, searchParams)
            : isLinkActive(link, pathname, searchParams);

        if (isMoreLink(link)) {
          return (
            <MobileMoreMenu
              isActive={isActive}
              key={link.id}
              link={link}
              pathname={pathname}
              roleKind={roleKind}
              searchParams={searchParams}
            />
          );
        }

        if (link.href === "/notifications") {
          return (
            <NotificationDropdown
              key={link.id}
              bottom
              isActive={isActive}
              notificationSummary={notificationSummary}
              triggerClassName={[
                "flex min-h-[58px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[9px] font-bold leading-none transition focus-visible:outline-2 focus-visible:outline-brand-orange min-[360px]:text-[10px] min-[390px]:text-[11px] [&::-webkit-details-marker]:hidden",
                isActive ? "bg-brand-orange-soft text-brand-orange" : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
              ].join(" ")}
            />
          );
        }

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={[
              "group relative flex min-h-[58px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[9px] font-bold leading-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange min-[360px]:text-[10px] min-[390px]:text-[11px]",
              isActive
                ? "bg-brand-orange-soft text-brand-orange"
                : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
            ].join(" ")}
            href={link.href}
            key={link.id}
          >
            <span
              className="relative grid h-7 w-7 shrink-0 place-items-center"
            >
              <Icon name={link.icon} />
              {link.id === "notifications" && notificationSummary.total > 0 ? (
                <span
                  aria-label={__vt(notificationBadgeLabel(notificationSummary.total))}
                  className="absolute -right-2 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white"
                >
                  {notificationSummary.total > 9 ? "9+" : notificationSummary.total}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">
              <WorkspaceText text={link.label} />
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function NavigationShell({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
  children,
  currentAccountName,
  currentUserId,
  currentWorkspace,
  notificationSummary: initialNotificationSummary,
  passive = false,
  salonMode,
  workspaceOptions,
  workspaceSections,
  workspaceType,
}: NavigationShellProps) {
  const notificationSummary = useNotificationSummary(initialNotificationSummary, `${currentUserId}:${currentWorkspace?.id ?? "personal"}`, !passive);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isWorkspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const workspacePanelReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const openWorkspacePanel = useCallback((button: HTMLButtonElement) => {
    workspacePanelReturnFocusRef.current = button;
    setWorkspacePanelOpen(true);
  }, []);
  const closeWorkspacePanel = useCallback(() => {
    setWorkspacePanelOpen(false);
  }, []);

  if (isShelllessPath(pathname)) {
    return <><ExploreAdSlot position="page-top" />{children}<ExploreAdSlot position="page-bottom" /></>;
  }

  const isOwnerPosRoute = pathname === "/pos" || /^\/pos\/(ticket|book|check-in|report|settings|more)(\/|$)/.test(pathname);
  const routeWorkspaceKind = getRouteWorkspaceKind(pathname);
  const routeNavigation = routeNavigationForWorkspaceKind({
    routeWorkspaceKind,
    salonMode,
    workspaceType,
  });
  const routeCurrentWorkspace = currentWorkspaceForRoute({
    currentWorkspace,
    routeWorkspaceKind,
    workspaceOptions,
  });
  const showRoleMobileShell = Boolean(routeNavigation);
  const routeUsesPersonalShell = routeNavigation?.kind === "personal";
  const desktopShellBreakpoint = routeUsesPersonalShell ? "lg" : "xl";
  const isSalonManageRoute =
    workspaceType === "salon" &&
    salonMode === "manage" &&
    routeWorkspaceKind === "manage";
  const isSalonStaffRoute =
    workspaceType === "salon" &&
    salonMode === "staff" &&
    routeWorkspaceKind === "staff";
  const isSharedSalonRoute =
    workspaceType === "salon" && routeWorkspaceKind === "salon";
  const isSharedContextWorkspaceRoute =
    workspaceType === "salon" &&
    (salonMode === "manage" || salonMode === "staff") &&
    routeWorkspaceKind === "shared";
  const showWorkspaceContextSidebar =
    !routeUsesPersonalShell &&
    (isSalonManageRoute ||
      isSalonStaffRoute ||
      isSharedSalonRoute ||
      isSharedContextWorkspaceRoute);
  const showWorkspaceSidebar = showWorkspaceContextSidebar;
  const baseShellPaddingClass = showWorkspaceSidebar
    ? "lg:pl-[19rem]"
    : routeUsesPersonalShell
      ? ""
      : "lg:pl-16";
  const contentPaddingClass = showRoleMobileShell
    ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0"
    : "pb-0";

  if (routeNavigation) {
    const desktopDisplay = desktopShellBreakpoint === "lg" ? "hidden lg:block" : "hidden xl:block";
    const mobileDisplay = desktopShellBreakpoint === "lg" ? "lg:hidden" : "xl:hidden";
    const gridClass = desktopShellBreakpoint === "lg"
      ? "lg:grid lg:grid-cols-[16.25rem_minmax(0,1fr)] 2xl:grid-cols-[18rem_minmax(0,1fr)]"
      : routeCurrentWorkspace?.salonMode === "staff"
        ? "xl:grid xl:grid-cols-[14rem_minmax(0,1fr)] 2xl:grid-cols-[15rem_minmax(0,1fr)]"
        : "xl:grid xl:grid-cols-[16.25rem_minmax(0,1fr)] 2xl:grid-cols-[18rem_minmax(0,1fr)]";
    return <>
      {!passive ? <AppNotificationInvalidation userId={currentUserId} /> : null}
      <CustomerShellContextProvider isCustomerShell notificationSummary={notificationSummary}>
        <div className={`min-h-screen bg-white text-text-primary ${gridClass}`} data-testid="customer-desktop-shell" data-owner-pos-shell={isOwnerPosRoute ? "true" : undefined}>
          <div className={desktopDisplay} data-desktop-sidebar-slot>
            <CustomerDesktopSidebar accountAvatarUrl={accountAvatarUrl} accountEmail={accountEmail}
              accountLabel={accountLabel} currentWorkspace={routeCurrentWorkspace} navigation={routeNavigation}
              notificationSummary={notificationSummary} pathname={pathname} searchParams={searchParams} workspaceOptions={workspaceOptions} />
          </div>
          <div className="min-w-0" data-owner-pos-shell={isOwnerPosRoute ? "true" : undefined}>
            <div className={desktopDisplay}>
              <CustomerDesktopHeader accountAvatarUrl={accountAvatarUrl} accountLabel={accountLabel}
                currentWorkspace={routeCurrentWorkspace} notificationSummary={notificationSummary} pathname={pathname} searchParams={searchParams} />
            </div>
            <div className={`${mobileDisplay} [&>header]:!block ${pathname === "/pos/settings" ? "sticky top-0 z-50" : ""}`}>
              <MobileHeader accountAvatarUrl={accountAvatarUrl} accountEmail={accountEmail} accountLabel={accountLabel}
                currentWorkspace={routeCurrentWorkspace} isCustomerShell notificationSummary={notificationSummary}
                pathname={pathname} searchParams={searchParams} workspaceOptions={workspaceOptions} workspaceSections={[]} />
            </div>
            <div className={`customer-desktop-content min-w-0 ${isSalonManageRoute && !pathname.startsWith("/pos") ? "max-md:px-[max(16px,env(safe-area-inset-left))] max-md:pr-[max(16px,env(safe-area-inset-right))]" : ""} ${desktopShellBreakpoint === "lg" ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0" : "pb-[calc(5.5rem+env(safe-area-inset-bottom))] xl:pb-0"}`}>
              <ExploreAdSlot position="page-top" />{children}<ExploreAdSlot position="page-bottom" />
            </div>
            <div className={`${mobileDisplay} [&>nav]:!grid`}>
              <MobileBottomNav ariaLabel={routeNavigation.ariaLabel} links={routeNavigation.links}
                notificationSummary={notificationSummary} pathname={pathname} roleKind={routeNavigation.kind} searchParams={searchParams} />
            </div>
          </div>
        </div>
      </CustomerShellContextProvider>
    </>;
  }

  return (
    <>
      {!passive ? <AppNotificationInvalidation userId={currentUserId} /> : null}
      <CustomerShellContextProvider
        isCustomerShell={false}
        notificationSummary={notificationSummary}
      >
        <div
          data-owner-pos-shell={isOwnerPosRoute ? "true" : undefined}
          className={[
            "min-h-screen bg-white",
            baseShellPaddingClass,
          ].join(" ")}
        >
          <AppRail
            accountAvatarUrl={accountAvatarUrl}
            accountLabel={accountLabel}
            isWorkspacePanelOpen={isWorkspacePanelOpen}
            notificationSummary={notificationSummary}
            onOpenWorkspacePanel={openWorkspacePanel}
            pathname={pathname}
            searchParams={searchParams}
          />
          <QuickWorkspacePanel
            accountLabel={accountLabel}
            currentWorkspace={routeCurrentWorkspace}
            isOpen={isWorkspacePanelOpen}
            notificationSummary={notificationSummary}
            onClose={closeWorkspacePanel}
            returnFocusRef={workspacePanelReturnFocusRef}
            workspaceOptions={workspaceOptions}
          />
          {showWorkspaceSidebar ? (
            <WorkspaceSidebar
              accountAvatarUrl={accountAvatarUrl}
              accountEmail={accountEmail}
              accountLabel={accountLabel}
              currentAccountName={currentAccountName}
              currentWorkspace={routeCurrentWorkspace}
              pathname={pathname}
              searchParams={searchParams}
              workspaceOptions={workspaceOptions}
              workspaceSections={workspaceSections}
            />
          ) : null}
          <MobileHeader
            accountAvatarUrl={accountAvatarUrl}
            accountEmail={accountEmail}
            accountLabel={accountLabel}
            currentWorkspace={routeCurrentWorkspace}
            isCustomerShell={showRoleMobileShell}
            notificationSummary={notificationSummary}
            pathname={pathname}
            searchParams={searchParams}
            workspaceOptions={workspaceOptions}
            workspaceSections={showWorkspaceContextSidebar ? workspaceSections : []}
          />
          <div className={["min-h-screen", contentPaddingClass].join(" ")}>
            <ExploreAdSlot position="page-top" />{children}<ExploreAdSlot position="page-bottom" />
          </div>

        </div>
      </CustomerShellContextProvider>


    </>
  );
}


