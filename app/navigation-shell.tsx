"use client";

import { LogoutButton } from "@/app/account/logout-button";
import { ActionDialog } from "@/app/action-dialog";
import {
  CustomerShellContextProvider,
  type CustomerNotificationSummary,
} from "@/app/customer-shell-context";
import { markAllAppNotificationsReadAction } from "@/app/notifications/actions";
import { NotificationFeedList } from "@/app/notifications/notification-list";
import { QuickWorkspacePanel } from "@/app/quick-workspace-panel";
import { safeAccountAvatarUrl } from "@/lib/account-avatar";
import {
  ROLE_NAVIGATION,
  ROLE_MORE_ITEMS,
  SHARED_CONTEXT_ROUTE_PREFIXES,
  type NavigationIcon,
  type NavigationLink,
  type NavigationSection,
  type RoleNavigationConfig,
  type RoleNavigationKind,
  type RoleMoreItem,
  roleNavigationKindForContext,
} from "@/app/role-navigation";
import {
  setCurrentWorkspace,
  switchWorkspaceDestination,
  switchWorkspaceLanding,
} from "@/app/salons/actions";
import Image from "next/image";
import Link from "next/link";
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
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { routes } from "@/lib/routes";

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
  currentStaffSalonId: string | null;
  currentStaffSalonName: string | null;
  currentWorkspace: CurrentWorkspaceOption | null;
  manageSalons: NavigationSalon[];
  notificationSummary: NotificationSummary;
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
  const safeAvatarUrl = safeAccountAvatarUrl(avatarUrl);

  return (
    <span className={["overflow-hidden", className].join(" ")}>
      {safeAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${label} avatar`}
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
  if (workspace?.type === "personal") {
    return (
      <AccountAvatar
        avatarUrl={accountAvatarUrl}
        className={className}
        label={accountLabel}
      />
    );
  }

  return (
    <span className={["overflow-hidden", className].join(" ")}>
      {workspace?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${label} avatar`}
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

function Icon({ name }: { name: NavigationIcon }) {
  const common = {
    "aria-hidden": true,
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  };
  const paths: Record<NavigationIcon, ReactNode> = {
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
      </>
    ),
    briefcase: (
      <>
        <path d="M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1" />
        <rect height="14" rx="2" width="18" x="3" y="6" />
      </>
    ),
    calendar: (
      <>
        <rect height="18" rx="2" width="18" x="3" y="4" />
        <path d="M8 2v4M16 2v4M3 10h18" />
      </>
    ),
    cash: (
      <>
        <rect height="12" rx="2" width="18" x="3" y="6" />
        <path d="M8 12h.01M16 12h.01M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4" />
      </>
    ),
    check: <path d="m20 6-11 11-5-5" />,
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    compass: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15 9-2 6-4 2 2-6z" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10" />
      </>
    ),
    grid: (
      <>
        <rect height="7" rx="1.5" width="7" x="3" y="3" />
        <rect height="7" rx="1.5" width="7" x="14" y="3" />
        <rect height="7" rx="1.5" width="7" x="3" y="14" />
        <rect height="7" rx="1.5" width="7" x="14" y="14" />
      </>
    ),
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    "log-out": (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5M21 12H9" />
      </>
    ),
    message: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="5" r="1" />
        <circle cx="12" cy="5" r="1" />
        <circle cx="19" cy="5" r="1" />
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
        <circle cx="5" cy="19" r="1" />
        <circle cx="12" cy="19" r="1" />
        <circle cx="19" cy="19" r="1" />
      </>
    ),
    people: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-8 0v2" />
        <circle cx="12" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    receipt: (
      <>
        <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2z" />
        <path d="M8 7h8M8 12h8M8 17h5" />
      </>
    ),
    scissors: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.1 15.9M8.1 8.1 20 20" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" />,
    store: (
      <>
        <path d="M4 10h16l-1-6H5z" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 22a8 8 0 0 1 16 0" />
      </>
    ),
    x: <path d="M18 6 6 18M6 6l12 12" />,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function ReylumiMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <Image
      aria-hidden="true"
      className={["shrink-0 object-contain", className].join(" ")}
      src="/brand/reylumi-favicon.png"
      alt=""
      height={364}
      width={364}
    />
  );
}

function ReylumiLogo() {
  return (
    <Link
      aria-label="Reylumi Explore"
      className="inline-flex min-h-11 shrink-0 items-center rounded-full px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href="/explore"
    >
      <Image
        aria-hidden="true"
        alt=""
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
      aria-label={`Switch to ${label}`}
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
        label={label}
        workspace={workspace}
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{label}</span>
        <span className="mt-0.5 block truncate text-xs font-semibold text-text-secondary">
          {isPending ? "Opening..." : subtitle}
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

function CustomerContextSheet({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
  currentWorkspace,
  isOpen,
  onClose,
  workspaceOptions,
}: CustomerContextSheetProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();
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
    return null;
  }

  const runAction: RunWorkspaceAction = (workspace, action) => {
    const key = actionKey(workspace, action);

    if (pendingKey) {
      return;
    }

    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      try {
        if (workspace.id === currentWorkspaceId) {
          closeAndFocus();
          router.push(action.href);
          router.refresh();
          setPendingKey(null);
          return;
        }

        const result = await switchWorkspaceDestination({
          destinationHref: action.href,
          workspaceId: workspace.id,
        });

        if (!result.ok) {
          setError(result.message);
          setPendingKey(null);
          return;
        }

        closeAndFocus();
        router.push(result.href);
        router.refresh();
        setPendingKey(null);
      } catch {
        setError(WORKSPACE_SWITCH_ERROR);
        setPendingKey(null);
      }
    });
  };

  const runWorkspaceSwitch: RunWorkspaceAction = (workspace, action) => {
    const key = actionKey(workspace, action);

    if (pendingKey) {
      return;
    }

    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      try {
        if (workspace.id === currentWorkspaceId) {
          closeAndFocus();
          router.push(action.href);
          router.refresh();
          setPendingKey(null);
          return;
        }

        const result = await switchWorkspaceLanding({
          workspaceId: workspace.id,
        });

        if (!result.ok) {
          setError(result.message);
          setPendingKey(null);
          return;
        }

        closeAndFocus();
        router.push(result.href);
        router.refresh();
        setPendingKey(null);
      } catch {
        setError(WORKSPACE_SWITCH_ERROR);
        setPendingKey(null);
      }
    });
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
                Switch account
              </p>
              <p
                className="mt-0.5 truncate text-xs font-semibold text-text-secondary"
                id="customer-context-description"
              >
                {accountEmail ?? "Reylumi account"}
              </p>
            </div>
            <button
              aria-label="Close account switcher"
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
          <section className="grid gap-2" aria-label="Personal account">
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
                  label={accountLabel}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">
                    {accountLabel}
                  </span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-text-secondary">
                    Personal account
                  </span>
                </span>
              </div>
            )}
          </section>

          {groups.map((group) => (
            <section className="grid gap-1" key={group.id}>
              <p className="px-2 text-[11px] font-bold uppercase text-text-secondary">
                {group.label}
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
                <span>Create Salon</span>
              </button>
            ) : null}
            <Link
              className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-bold text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/settings"
              onClick={closeAndFocus}
            >
              <Icon name="gear" />
              <span>Settings</span>
            </Link>
            <LogoutButton className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-bold text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60">
              <Icon name="log-out" />
              <span>Log out</span>
            </LogoutButton>
          </div>
        </div>
      </aside>
      <ActionDialog
        description={error ?? ""}
        onClose={() => setError(null)}
        open={Boolean(error)}
        primaryAction={{
          label: "Review workspaces",
          onClick: () => setError(null),
        }}
        secondaryAction={{ href: "/explore", label: "Explore" }}
        title="Workspace action needed"
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
  const items = ROLE_MORE_ITEMS[roleKind];
  const isMobile = variant === "mobile";
  const isRail = variant === "rail";

  return (
    <div
      className={[
        "z-[75] overflow-hidden rounded-2xl border border-border-subtle bg-surface-elevated text-text-primary shadow-[0_22px_60px_rgba(35,25,22,0.16)]",
        isMobile
          ? "fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))]"
          : isRail
            ? "absolute left-[calc(100%+0.75rem)] top-0 w-80"
          : "absolute left-0 top-[calc(100%+0.5rem)] w-full",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2.5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-text-secondary">
          More
        </p>
        <Link
          className="inline-flex min-h-8 items-center justify-center rounded-full bg-brand-orange-soft px-3 text-xs font-bold text-brand-orange transition hover:bg-brand-orange hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href="/more"
        >
          All
        </Link>
      </div>
      <div
        className={[
          "grid gap-1 overflow-y-auto p-2",
          isMobile ? "max-h-[min(24rem,55vh)]" : "max-h-[min(28rem,64vh)]",
        ].join(" ")}
      >
        {items.map((item) => {
          const isActive = isLinkActive(
            moreItemAsNavigationLink(item),
            pathname,
            searchParams,
          );
          const isSavedPostItem = item.href === "/more/saved-post";

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={[
                "grid min-h-12 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-2.5 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
                isActive
                  ? "bg-brand-orange-soft text-brand-orange"
                : "text-text-primary hover:bg-surface-muted",
              ].join(" ")}
              data-saved-post-target={isSavedPostItem ? "true" : undefined}
              href={item.href}
              key={item.id}
            >
              <span
                className={[
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                  isActive ? "bg-white" : "bg-brand-orange-soft text-brand-orange",
                ].join(" ")}
              >
                <Icon name={item.navigationIcon} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">
                  {item.label}
                </span>
                <span className="mt-0.5 block truncate text-xs font-medium text-text-secondary">
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
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
    <details className="group/more relative z-30" ref={detailsRef}>
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
        <span className="truncate">More</span>
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
  const detailsRef = useDismissibleDetails();
  const roleKind = roleKindForMoreLink(link);
  const isActive = isRoleMoreActive(roleKind, pathname, searchParams);

  return (
    <details className="relative z-30" ref={detailsRef}>
      <summary
        aria-current={isActive ? "page" : undefined}
        className={[
          sidebarLinkClass(isActive),
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        ].join(" ")}
        data-more-menu-target="true"
        title={link.label}
      >
        <Icon name={link.icon} />
        <span className="truncate">{link.label}</span>
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
  const detailsRef = useDismissibleDetails();
  const isActive = isRoleMoreActive("personal", pathname, searchParams);

  return (
    <details className="relative" ref={detailsRef}>
      <summary
        aria-current={matchesPath(pathname, link.href) ? "page" : undefined}
        aria-label={link.label}
        className={[
          railLinkClass(isActive),
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        ].join(" ")}
        data-more-menu-target="true"
        title={link.label}
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
  return (
    <Link
      aria-label="Reylumi"
      className="inline-flex min-h-[4.75rem] w-full items-center rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href={href}
    >
      <Image
        aria-hidden="true"
        alt=""
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
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();
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
    const key = actionKey(workspace, action);

    if (pendingKey) {
      return;
    }

    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      try {
        if (workspace.id === currentWorkspaceId) {
          router.push(action.href);
          router.refresh();
          setOpen(false);
          setPendingKey(null);
          return;
        }

        const result = await switchWorkspaceDestination({
          destinationHref: action.href,
          workspaceId: workspace.id,
        });

        if (!result.ok) {
          setError(result.message);
          setPendingKey(null);
          return;
        }

        router.push(result.href);
        router.refresh();
        setOpen(false);
        setPendingKey(null);
      } catch {
        setError(WORKSPACE_SWITCH_ERROR);
        setPendingKey(null);
      }
    });
  };

  const runWorkspaceSwitch: RunWorkspaceAction = (workspace, action) => {
    const key = actionKey(workspace, action);

    if (pendingKey) {
      return;
    }

    setError(null);
    setPendingKey(key);
    startTransition(async () => {
      try {
        if (workspace.id === currentWorkspaceId) {
          router.push(action.href);
          router.refresh();
          setOpen(false);
          setPendingKey(null);
          return;
        }

        const result = await switchWorkspaceLanding({
          workspaceId: workspace.id,
        });

        if (!result.ok) {
          setError(result.message);
          setPendingKey(null);
          return;
        }

        router.push(result.href);
        router.refresh();
        setOpen(false);
        setPendingKey(null);
      } catch {
        setError(WORKSPACE_SWITCH_ERROR);
        setPendingKey(null);
      }
    });
  };

  const workspaceRows = [
    ...(personalWorkspace ? [personalWorkspace] : []),
    ...staffWorkspaces,
    ...ownerWorkspaces,
  ];
  const currentLabel = customerWorkspaceLabel(currentWorkspace, accountLabel);
  const currentSubtitle = customerWorkspaceSubtitle(currentWorkspace);

  return (
    <section className="relative" aria-label="Account switcher">
      <button
        aria-controls={CUSTOMER_DESKTOP_ACCOUNT_MENU_ID}
        aria-expanded={isOpen}
        aria-label="Open account menu"
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
          label={currentLabel}
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
                  aria-label={`Switch to ${label}`}
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
                    label={label}
                    workspace={workspace}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">
                      {label}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-normal text-text-secondary">
                      {isPending ? "Opening..." : subtitle}
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
                <span>Create Salon</span>
              </button>
            ) : null}
            <Link
              className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href="/settings"
            >
              <Icon name="gear" />
              <span>Settings</span>
            </Link>
            <LogoutButton className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl px-2.5 text-sm font-medium text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60">
              <Icon name="log-out" />
              <span>Log out</span>
            </LogoutButton>
          </div>
        </div>
      ) : null}
      <ActionDialog
        description={error ?? ""}
        onClose={() => setError(null)}
        open={Boolean(error)}
        primaryAction={{
          label: "Review workspaces",
          onClick: () => setError(null),
        }}
        secondaryAction={{ href: "/my-place", label: "My Place" }}
        title="Workspace action needed"
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
  return (
    <nav aria-label={navigation.desktopAriaLabel} className="grid gap-1">
      <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-secondary">
        Navigation
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
            <span className="truncate">{link.label}</span>
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
    <section className="overflow-hidden rounded-2xl bg-surface-elevated p-3 shadow-[var(--shadow-soft)] ring-1 ring-divider-subtle/80">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-brand-orange-soft text-brand-orange">
          <Icon name="star" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">
            Become a Member
          </h2>
          <p className="mt-1 line-clamp-2 text-xs font-normal leading-5 text-text-secondary">
            Unlock customer perks, saved favorites, and special offers.
          </p>
        </div>
      </div>
      <Link
        className="mt-2 inline-flex min-h-8 items-center justify-center rounded-full bg-brand-orange px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href="/more/memberships"
      >
        View Memberships
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
  return (
    <aside
      aria-label={`${navigation.ariaLabel} account`}
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
      <div className="mt-auto">
        <CustomerDesktopMembershipCard />
      </div>
    </aside>
  );
}

function NotificationDropdown({
  notificationSummary,
  triggerClassName,
}: {
  notificationSummary: NotificationSummary;
  triggerClassName: string;
}) {
  const detailsRef = useDismissibleDetails();
  const previewItems = notificationSummary.previewItems;
  const hasUnreadAppNotifications = notificationSummary.bookingNotifications > 0;

  return (
    <details className="relative" ref={detailsRef}>
      <summary
        aria-label="Notifications"
        className={[triggerClassName, "cursor-pointer list-none"].join(" ")}
      >
        <span className="relative">
          <Icon name="bell" />
          {notificationSummary.total > 0 ? (
            <span className="absolute -right-2 -top-2 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-black leading-none text-white">
              {notificationSummary.total > 9 ? "9+" : notificationSummary.total}
            </span>
          ) : null}
        </span>
      </summary>
      <div className="fixed right-2 top-[calc(4.75rem+env(safe-area-inset-top))] z-[70] w-[min(24rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-zinc-200 bg-white text-zinc-950 shadow-2xl sm:right-4">
        <header className="px-4 pb-3 pt-4">
          <div className="flex items-center gap-3">
            <h2 className="min-w-0 flex-1 text-2xl font-bold">
              Notifications
            </h2>
            {hasUnreadAppNotifications ? (
              <form action={markAllAppNotificationsReadAction}>
                <button
                  className="inline-flex min-h-8 items-center justify-center rounded-full px-2.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                  type="submit"
                >
                  Mark all read
                </button>
              </form>
            ) : null}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Link
              className="inline-flex min-h-8 items-center rounded-full bg-blue-50 px-3 text-sm font-semibold text-blue-700"
              href="/notifications"
            >
              All
            </Link>
            <Link
              className="inline-flex min-h-8 items-center rounded-full px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950"
              href="/notifications?filter=unread"
            >
              Unread
            </Link>
          </div>
        </header>
        <div className="flex items-center gap-3 px-4 pb-1">
          <p className="min-w-0 flex-1 text-base font-bold">New</p>
          <Link
            className="text-sm font-semibold text-blue-700 transition hover:text-blue-800"
            href="/notifications"
          >
            See all
          </Link>
        </div>
        <div className="max-h-[min(28rem,calc(100vh-12rem))] overflow-y-auto">
          <NotificationFeedList
            compact
            emptyLabel="No notifications yet."
            items={previewItems}
          />
        </div>
        <footer className="border-t border-zinc-100 p-3">
          <Link
            className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-zinc-200 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
            href="/notifications"
          >
            See previous notifications
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

    window.dispatchEvent(new CustomEvent("kingpos:explore-use-current-location"));
  }

  return (
    <header
      className="sticky top-0 z-30 bg-white/92 px-7 py-4 backdrop-blur-sm"
      data-testid="customer-desktop-header"
    >
      <div className="grid grid-cols-[minmax(24rem,1fr)_auto] items-center gap-5">
        <form action="/explore" className="relative" role="search">
          <label className="sr-only" htmlFor="customer-desktop-search">
            Search salons, services, or locations
          </label>
          <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-text-secondary">
            <Icon name="search" />
          </span>
          <input
            className="h-14 w-full rounded-full bg-surface-elevated pl-12 pr-56 text-sm font-normal text-text-primary shadow-[0_12px_30px_rgba(35,25,22,0.045)] outline-none ring-1 ring-divider-subtle/85 transition placeholder:font-normal placeholder:text-text-secondary/80 focus:ring-4 focus:ring-brand-orange/15"
            defaultValue={exploreQuery}
            id="customer-desktop-search"
            name="q"
            placeholder="Search salons, services, designs, city, or ZIP..."
            type="search"
          />
          <button
            aria-label="Use current location"
            className="absolute right-24 top-1/2 inline-flex min-h-10 -translate-y-1/2 items-center gap-1.5 rounded-full bg-brand-teal-soft px-3 text-xs font-semibold text-brand-teal transition hover:bg-white hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
            onClick={requestExploreLocation}
            type="button"
          >
            <Icon name="compass" />
            <span>Near you</span>
          </button>
          <button
            className="absolute right-2 top-1/2 inline-flex min-h-10 -translate-y-1/2 items-center justify-center rounded-full bg-brand-orange px-5 text-xs font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            type="submit"
          >
            Search
          </button>
        </form>
        <div className="flex items-center gap-3">
          <NotificationDropdown
            notificationSummary={notificationSummary}
            triggerClassName={customerDesktopSoftButtonClass()}
          />
          <Link
            aria-label="Messages"
            className={customerDesktopSoftButtonClass()}
            href="/notifications"
          >
            <Icon name="message" />
          </Link>
          <Link
            aria-label="Account settings"
            className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-full bg-surface-elevated py-1 pl-1.5 pr-4 text-left shadow-[0_10px_28px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/85 transition hover:ring-brand-orange/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href="/account"
          >
            <AccountAvatar
              avatarUrl={accountAvatarUrl}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-orange-soft text-xs font-semibold text-brand-orange"
              label={accountLabel}
            />
            <span className="min-w-0">
              <span className="block max-w-32 truncate text-sm font-semibold text-text-primary">
                {accountLabel}
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

function CustomerDesktopShell({
  accountAvatarUrl,
  accountEmail,
  accountLabel,
  children,
  currentWorkspace,
  desktopBreakpoint,
  navigation,
  notificationSummary,
  pathname,
  searchParams,
  workspaceOptions,
}: {
  accountAvatarUrl: string | null;
  accountEmail: string | null;
  accountLabel: string;
  children: ReactNode;
  currentWorkspace: CurrentWorkspaceOption | null;
  desktopBreakpoint: "lg" | "xl";
  navigation: RoleNavigationConfig;
  notificationSummary: NotificationSummary;
  pathname: string;
  searchParams: SearchParamsReader;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const displayClass = desktopBreakpoint === "lg" ? "lg:grid" : "xl:grid";

  return (
    <div
      className={[
        "hidden min-h-screen grid-cols-[16.25rem_minmax(0,1fr)] bg-white text-text-primary 2xl:grid-cols-[18rem_minmax(0,1fr)]",
        displayClass,
      ].join(" ")}
      data-testid="customer-desktop-shell"
    >
      <CustomerDesktopSidebar
        accountAvatarUrl={accountAvatarUrl}
        accountEmail={accountEmail}
        accountLabel={accountLabel}
        currentWorkspace={currentWorkspace}
        navigation={navigation}
        notificationSummary={notificationSummary}
        pathname={pathname}
        searchParams={searchParams}
        workspaceOptions={workspaceOptions}
      />
      <div className="min-w-0">
        <CustomerDesktopHeader
          accountAvatarUrl={accountAvatarUrl}
          accountLabel={accountLabel}
          currentWorkspace={currentWorkspace}
          notificationSummary={notificationSummary}
          pathname={pathname}
          searchParams={searchParams}
        />
        <div className="customer-desktop-content min-w-0">{children}</div>
      </div>
    </div>
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
  const [isContextOpen, setContextOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const shouldRestoreContextFocusRef = useRef(false);
  const label = customerWorkspaceLabel(currentWorkspace, accountLabel);
  const subtitle = customerWorkspaceSubtitle(currentWorkspace);
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
            aria-label="Open account switcher"
            className="grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-full bg-surface-elevated px-2.5 py-1 text-left shadow-[var(--shadow-soft)] ring-1 ring-divider-subtle/80 transition hover:ring-brand-orange/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={() => setContextOpen(true)}
            ref={triggerRef}
            type="button"
          >
            <WorkspaceAvatar
              accountAvatarUrl={accountAvatarUrl}
              accountLabel={accountLabel}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-orange-soft text-xs font-semibold text-brand-orange"
              label={label}
              workspace={currentWorkspace}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-extrabold text-text-primary">
                {label}
              </span>
              <span className="block truncate text-[11px] font-semibold text-text-secondary">
                {subtitle}
              </span>
            </span>
            <span className="grid h-7 w-7 place-items-center rounded-full text-text-secondary">
              <Icon name="chevron-down" />
            </span>
          </button>
          <NotificationDropdown
            notificationSummary={notificationSummary}
            triggerClassName="grid h-11 w-11 place-items-center rounded-full bg-surface-elevated text-text-secondary shadow-[var(--shadow-soft)] ring-1 ring-divider-subtle/80 transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          />
          <ReylumiLogo />
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
  const isCurrent = workspace.id === currentWorkspaceId;
  const label = customerWorkspaceLabel(workspace, accountLabel);
  const subtitle = customerWorkspaceSubtitle(workspace);

  return (
    <form action={setCurrentWorkspace}>
      <input name="workspace_id" type="hidden" value={workspace.id} />
      <button
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
          label={label}
          workspace={workspace}
        />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{label}</span>
          <span
            className={[
              "block truncate text-xs",
              isCurrent ? "text-zinc-200" : "text-zinc-500",
            ].join(" ")}
          >
            {subtitle}
          </span>
        </span>
      </button>
    </form>
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
              {mode === "staff" ? "Staff" : "Owner"}
            </span>
          );
        }

        return (
          <form action={setCurrentWorkspace} key={mode}>
            <input name="workspace_id" type="hidden" value={option.id} />
            <button
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
              {mode === "staff" ? "Staff" : "Owner"}
            </button>
          </form>
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
  const detailsRef = useDismissibleDetails();
  const currentWorkspaceId = currentWorkspace?.id ?? null;
  const currentLabel = customerWorkspaceLabel(currentWorkspace, accountLabel);

  return (
    <details className="relative" ref={detailsRef}>
      <summary className="flex min-h-[3.25rem] cursor-pointer list-none items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm transition hover:border-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950">
        <WorkspaceAvatar
          accountAvatarUrl={accountAvatarUrl}
          accountLabel={accountLabel}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-orange-soft text-xs font-semibold text-brand-orange"
          label={currentLabel}
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
              {group.label}
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
  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-16 flex-col border-r border-zinc-200 bg-white lg:flex">
      <Link
        aria-label="Reylumi Explore"
        className="mx-auto mt-3 grid h-10 w-10 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href="/explore"
        title="Reylumi"
      >
        <ReylumiMark className="h-10 w-10 text-lg" />
      </Link>
      <nav aria-label="Personal app" className="mt-6 grid justify-center gap-2">
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
              aria-label={link.label}
              className={railLinkClass(isActive)}
              href={link.href}
              key={link.id}
              title={link.label}
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
          aria-label={WORKSPACE_PANEL_LINK.label}
          className={railLinkClass(
            matchesPath(pathname, WORKSPACE_PANEL_LINK.href),
            isWorkspacePanelOpen && !matchesPath(pathname, WORKSPACE_PANEL_LINK.href),
          )}
          onClick={(event) => onOpenWorkspacePanel(event.currentTarget)}
          title={WORKSPACE_PANEL_LINK.label}
          type="button"
        >
          <Icon name={WORKSPACE_PANEL_LINK.icon} />
        </button>
      </nav>
      <Link
        aria-label="Account Settings"
        className="mx-auto mb-3 mt-auto grid h-10 w-10 place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href="/account"
        title="Account Settings"
      >
        <AccountAvatar
          avatarUrl={accountAvatarUrl}
          className="grid h-full w-full place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange"
          label={accountLabel}
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
  if (workspaceSections.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Workspace" className="grid gap-4">
      {workspaceSections.map((section) => (
        <section className="grid gap-1" key={section.id}>
          <p className="px-2 text-[11px] font-semibold uppercase text-zinc-500">
            {section.label}
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
                  title={link.label}
                >
                  <Icon name={link.icon} />
                  <span className="truncate">{link.label}</span>
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
  const detailsRef = useDismissibleDetails();

  return (
    <details className="relative" ref={detailsRef}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950">
        <AccountAvatar
          avatarUrl={accountAvatarUrl}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange"
          label={accountLabel}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-zinc-950">
            {accountLabel}
          </span>
          <span className="block truncate text-xs text-zinc-500">
            {accountEmail ?? "Reylumi account"}
          </span>
        </span>
      </summary>
      <div className="absolute bottom-full left-0 z-50 mb-2 grid w-full gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl">
        <Link className={sidebarLinkClass(false)} href="/account">
          <Icon name="user" />
          Account Settings
        </Link>
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
        <details className="relative ml-auto" ref={workspaceNavigationDetailsRef}>
          <summary
            aria-label="Open workspace navigation"
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
            <Link className={sidebarLinkClass(false)} href="/account">
              <Icon name="user" />
              Account Settings
            </Link>
          </div>
        </details>
        <Link
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange"
          href="/account"
        >
          <AccountAvatar
            avatarUrl={accountAvatarUrl}
            className="grid h-full w-full place-items-center rounded-full bg-brand-black text-xs font-semibold text-brand-orange"
            label={accountLabel}
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
    <details className="relative min-w-0" ref={detailsRef}>
      <summary
        aria-current={isActive ? "page" : undefined}
        className={[
          "group relative grid min-h-[58px] min-w-0 cursor-pointer list-none place-items-center gap-0.5 rounded-xl px-1 text-center text-[9px] font-bold leading-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange min-[360px]:text-[10px] min-[390px]:text-[11px] [&::-webkit-details-marker]:hidden",
          isActive
            ? "bg-brand-orange-soft text-brand-orange"
            : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
        ].join(" ")}
        data-more-menu-target="true"
      >
        {isActive ? (
          <span
            aria-hidden="true"
            className="absolute top-1 h-1 w-5 rounded-full bg-brand-orange"
          />
        ) : null}
        <span
          className={[
            "relative grid h-7 w-7 place-items-center rounded-full",
            isActive ? "bg-white shadow-sm" : "",
          ].join(" ")}
        >
          <Icon name={link.icon} />
        </span>
        <span className="max-w-full truncate">{link.label}</span>
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
  return (
    <nav
      aria-label={ariaLabel}
      className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-border-subtle bg-surface/95 px-1 pb-[calc(0.35rem+env(safe-area-inset-bottom))] pt-1 shadow-[0_-10px_30px_rgba(23,19,22,0.08)] backdrop-blur lg:hidden"
    >
      {links.map((link) => {
        const isActive =
          isMoreLink(link)
            ? isRoleMoreActive(roleKind, pathname, searchParams)
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

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={[
              "group relative grid min-h-[58px] min-w-0 place-items-center gap-0.5 rounded-xl px-1 text-center text-[9px] font-bold leading-none transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange min-[360px]:text-[10px] min-[390px]:text-[11px]",
              isActive
                ? "bg-brand-orange-soft text-brand-orange"
                : "text-text-secondary hover:bg-surface-muted hover:text-text-primary",
            ].join(" ")}
            href={link.href}
            key={link.id}
          >
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute top-1 h-1 w-5 rounded-full bg-brand-orange"
              />
            ) : null}
            <span
              className={[
                "relative grid h-7 w-7 place-items-center rounded-full",
                isActive ? "bg-white shadow-sm" : "",
              ].join(" ")}
            >
              <Icon name={link.icon} />
              {link.id === "notifications" && notificationSummary.total > 0 ? (
                <span
                  aria-label={notificationBadgeLabel(notificationSummary.total)}
                  className="absolute -right-2 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white"
                >
                  {notificationSummary.total > 9 ? "9+" : notificationSummary.total}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">
              {link.label}
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
  currentWorkspace,
  notificationSummary,
  salonMode,
  workspaceOptions,
  workspaceSections,
  workspaceType,
}: NavigationShellProps) {
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
    return <>{children}</>;
  }

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
  const showRoleDesktopShell = Boolean(routeNavigation);
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
  const baseShellHiddenClass = showRoleDesktopShell
    ? desktopShellBreakpoint === "lg"
      ? "lg:hidden"
      : "xl:hidden"
    : "";
  const baseShellPaddingClass = showWorkspaceSidebar
    ? "lg:pl-[19rem]"
    : routeUsesPersonalShell
      ? ""
      : "lg:pl-16";
  const contentPaddingClass = showRoleMobileShell
    ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-0"
    : "pb-0";

  return (
    <>
      <CustomerShellContextProvider
        isCustomerShell={false}
        notificationSummary={notificationSummary}
      >
        <div
          className={[
            "min-h-screen bg-white",
            baseShellPaddingClass,
            baseShellHiddenClass,
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
            {children}
          </div>
          {routeNavigation ? (
            <MobileBottomNav
              ariaLabel={routeNavigation.ariaLabel}
              links={routeNavigation.links}
              notificationSummary={notificationSummary}
              pathname={pathname}
              roleKind={routeNavigation.kind}
              searchParams={searchParams}
            />
          ) : null}
        </div>
      </CustomerShellContextProvider>

      {routeNavigation ? (
        <CustomerShellContextProvider
          isCustomerShell
          notificationSummary={notificationSummary}
        >
          <CustomerDesktopShell
            accountAvatarUrl={accountAvatarUrl}
            accountEmail={accountEmail}
            accountLabel={accountLabel}
            currentWorkspace={routeCurrentWorkspace}
            desktopBreakpoint={desktopShellBreakpoint}
            navigation={routeNavigation}
            notificationSummary={notificationSummary}
            pathname={pathname}
            searchParams={searchParams}
            workspaceOptions={workspaceOptions}
          >
            {children}
          </CustomerDesktopShell>
        </CustomerShellContextProvider>
      ) : null}
    </>
  );
}
