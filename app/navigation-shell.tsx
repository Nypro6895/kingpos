"use client";

import { LogoutButton } from "@/app/account/logout-button";
import { QuickWorkspacePanel } from "@/app/quick-workspace-panel";
import { setCurrentWorkspace } from "@/app/salons/actions";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type {
  CurrentWorkspaceOption,
  SalonMode,
  WorkspaceType,
} from "@/lib/current-context";
import { useCallback, useRef, useState, type ReactNode } from "react";

type NavigationIcon =
  | "bell"
  | "book"
  | "briefcase"
  | "calendar"
  | "cash"
  | "compass"
  | "gear"
  | "home"
  | "list"
  | "people"
  | "receipt"
  | "scissors"
  | "store"
  | "user";

type NavigationLink = {
  href: string;
  icon: NavigationIcon;
  id: string;
  label: string;
};

type NavigationSection = {
  id: string;
  label: string;
  links: NavigationLink[];
};

type NavigationSalon = {
  id: string;
  name: string;
};

type NotificationSummary = {
  items: Array<{
    count: number;
    id: string;
    label: string;
  }>;
  bookingNotifications: number;
  managerApplications: number;
  reviewHref: string;
  staffApplications: number;
  staffInvites: number;
  total: number;
};

type SearchParamsReader = {
  get(name: string): string | null;
};

type RouteWorkspaceKind =
  | "manage"
  | "organization"
  | "personal"
  | "salon"
  | "staff";

type NavigationShellProps = {
  accountEmail: string | null;
  accountLabel: string;
  canManageStaff: boolean;
  canSwitchManageSalon: boolean;
  children: ReactNode;
  currentManageSalonId: string | null;
  currentManageSalonName: string | null;
  currentOrganizationName: string | null;
  currentStaffSalonId: string | null;
  currentStaffSalonName: string | null;
  currentWorkspace: CurrentWorkspaceOption | null;
  manageSalons: NavigationSalon[];
  notificationSummary: NotificationSummary;
  salonMode: SalonMode | null;
  staffSalons: NavigationSalon[];
  workspaceOptions: CurrentWorkspaceOption[];
  workspaceSections: NavigationSection[];
  workspaceType: WorkspaceType;
};

const PERSONAL_LINKS: NavigationLink[] = [
  { href: "/explore", icon: "compass", id: "explore", label: "Explore" },
  { href: "/my-place", icon: "home", id: "my-place", label: "My Place" },
  {
    href: "/notifications",
    icon: "bell",
    id: "notifications",
    label: "Notifications",
  },
];

const ACCOUNT_NAVIGATION_SECTION: NavigationSection = {
  id: "account",
  label: "Account",
  links: PERSONAL_LINKS,
};

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isShelllessPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname.startsWith("/book/") ||
    pathname.startsWith("/booking/manage/") ||
    pathname.startsWith("/pos/customer-display")
  );
}

function getRouteWorkspaceKind(pathname: string): RouteWorkspaceKind | null {
  if (
    pathname === "/" ||
    matchesPath(pathname, "/explore") ||
    matchesPath(pathname, "/my-place") ||
    matchesPath(pathname, "/notifications") ||
    matchesPath(pathname, "/account") ||
    matchesPath(pathname, "/settings")
  ) {
    return "personal";
  }

  if (
    matchesPath(pathname, "/staff/my-work") ||
    matchesPath(pathname, "/staff/appointments") ||
    matchesPath(pathname, "/staff/workday") ||
    matchesPath(pathname, "/staff/connections")
  ) {
    return "staff";
  }

  if (matchesPath(pathname, "/salon-profile")) {
    return "salon";
  }

  if (
    pathname === "/staff" ||
    matchesPath(pathname, "/staff/today") ||
    matchesPath(pathname, "/pos") ||
    matchesPath(pathname, "/bookings") ||
    matchesPath(pathname, "/customers") ||
    matchesPath(pathname, "/services") ||
    matchesPath(pathname, "/pos-tickets") ||
    matchesPath(pathname, "/tickets") ||
    matchesPath(pathname, "/payroll") ||
    matchesPath(pathname, "/reports") ||
    matchesPath(pathname, "/salon-settings")
  ) {
    return "manage";
  }

  if (
    matchesPath(pathname, "/organizations") ||
    matchesPath(pathname, "/salons") ||
    matchesPath(pathname, "/roles") ||
    matchesPath(pathname, "/permissions")
  ) {
    return "organization";
  }

  return null;
}

function workspaceKindLabel(workspace: CurrentWorkspaceOption | null) {
  if (!workspace) {
    return "No workspace";
  }

  if (workspace.type === "personal") {
    return "Personal app";
  }

  if (workspace.type === "organization") {
    return "Organization workspace";
  }

  return workspace.salonMode === "staff"
    ? "Salon workspace / Staff"
    : "Salon workspace / Manage";
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

function mobileLinkClass(isActive: boolean, isOpen = false) {
  return [
    "grid min-w-0 flex-1 place-items-center gap-1 px-2 py-2 text-center text-[11px] font-semibold transition",
    isActive
      ? "text-zinc-950"
      : isOpen
        ? "bg-zinc-100 text-zinc-950 ring-1 ring-inset ring-zinc-200"
        : "text-zinc-500",
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
    if (link.id === "staff-day") {
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
    return "KP";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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
    list: (
      <>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </>
    ),
    people: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-8 0v2" />
        <circle cx="12" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
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
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function WorkspaceOptionButton({
  currentWorkspaceId,
  workspace,
}: {
  currentWorkspaceId: string | null;
  workspace: CurrentWorkspaceOption;
}) {
  const isCurrent = workspace.id === currentWorkspaceId;

  return (
    <form action={setCurrentWorkspace}>
      <input name="workspace_id" type="hidden" value={workspace.id} />
      <button
        className={[
          "grid w-full gap-0.5 rounded-md px-3 py-2 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-default",
          isCurrent
            ? "bg-zinc-950 text-white"
            : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950",
        ].join(" ")}
        disabled={isCurrent}
        type="submit"
      >
        <span className="truncate font-semibold">{workspace.label}</span>
        <span
          className={[
            "truncate text-xs",
            isCurrent ? "text-zinc-200" : "text-zinc-500",
          ].join(" ")}
        >
          {workspaceKindLabel(workspace)}
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
      id: "organization",
      label: "Organization",
      options: workspaceOptions.filter(
        (workspace) => workspace.type === "organization",
      ),
    },
    {
      id: "manage",
      label: "Salon Manage",
      options: workspaceOptions.filter(
        (workspace) => workspace.salonMode === "manage",
      ),
    },
    {
      id: "staff",
      label: "Salon Staff",
      options: workspaceOptions.filter(
        (workspace) => workspace.salonMode === "staff",
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
              {mode === "staff" ? "Staff" : "Manage"}
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
              {mode === "staff" ? "Staff" : "Manage"}
            </button>
          </form>
        );
      })}
    </div>
  );
}

function WorkspaceSwitcher({
  currentWorkspace,
  workspaceOptions,
}: {
  currentWorkspace: CurrentWorkspaceOption | null;
  workspaceOptions: CurrentWorkspaceOption[];
}) {
  const currentWorkspaceId = currentWorkspace?.id ?? null;

  return (
    <details className="relative">
      <summary className="flex min-h-[3.25rem] cursor-pointer list-none items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm transition hover:border-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-zinc-950 text-xs font-semibold text-white">
          KP
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-zinc-950">
            {currentWorkspace?.label ?? "No workspace"}
          </span>
          <span className="block truncate text-xs text-zinc-500">
            {workspaceKindLabel(currentWorkspace)}
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
  accountLabel,
  isWorkspacePanelOpen,
  notificationSummary,
  onOpenWorkspacePanel,
  pathname,
  searchParams,
}: {
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
        aria-label="KingPOS My Place"
        className="mx-auto mt-3 grid h-10 w-10 place-items-center rounded-lg bg-zinc-950 text-sm font-semibold text-white"
        href="/my-place"
        title="KingPOS"
      >
        KP
      </Link>
      <nav aria-label="Personal app" className="mt-6 grid justify-center gap-2">
        {PERSONAL_LINKS.map((link) => {
          const isActive = isLinkActive(link, pathname, searchParams);

          if (link.id === "my-place") {
            return (
              <button
                aria-current={isActive ? "page" : undefined}
                aria-expanded={isWorkspacePanelOpen}
                aria-label={link.label}
                className={railLinkClass(
                  isActive,
                  isWorkspacePanelOpen && !isActive,
                )}
                key={link.id}
                onClick={(event) => onOpenWorkspacePanel(event.currentTarget)}
                title={link.label}
                type="button"
              >
                <Icon name={link.icon} />
              </button>
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
      </nav>
      <Link
        aria-label="Account Settings"
        className="mx-auto mb-3 mt-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-700 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
        href="/account"
        title="Account Settings"
      >
        {initialsFor(accountLabel)}
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
  workspaceSections: NavigationSection[];
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
  accountEmail,
  accountLabel,
}: {
  accountEmail: string | null;
  accountLabel: string;
}) {
  return (
    <details className="relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-700 text-xs font-semibold text-white">
          {initialsFor(accountLabel)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-zinc-950">
            {accountLabel}
          </span>
          <span className="block truncate text-xs text-zinc-500">
            {accountEmail ?? "KingPOS account"}
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
  accountEmail,
  accountLabel,
  currentOrganizationName,
  currentWorkspace,
  pathname,
  searchParams,
  workspaceOptions,
  workspaceSections,
}: {
  accountEmail: string | null;
  accountLabel: string;
  currentOrganizationName: string | null;
  currentWorkspace: CurrentWorkspaceOption | null;
  pathname: string;
  searchParams: SearchParamsReader;
  workspaceOptions: CurrentWorkspaceOption[];
  workspaceSections: NavigationSection[];
}) {
  return (
    <aside className="fixed inset-y-0 left-16 z-40 hidden w-60 flex-col border-r border-zinc-200 bg-white lg:flex">
      <div className="grid gap-3 border-b border-zinc-200 p-3">
        <WorkspaceSwitcher
          currentWorkspace={currentWorkspace}
          workspaceOptions={workspaceOptions}
        />
        <ModeSwitch
          currentWorkspace={currentWorkspace}
          workspaceOptions={workspaceOptions}
        />
        {currentOrganizationName ? (
          <p className="truncate px-1 text-xs text-zinc-500">
            {currentOrganizationName}
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
        <ProfileMenu accountEmail={accountEmail} accountLabel={accountLabel} />
      </div>
    </aside>
  );
}

function MobileHeader({
  accountLabel,
  currentWorkspace,
  workspaceOptions,
  workspaceSections,
  pathname,
  searchParams,
}: {
  accountLabel: string;
  currentWorkspace: CurrentWorkspaceOption | null;
  pathname: string;
  searchParams: SearchParamsReader;
  workspaceOptions: CurrentWorkspaceOption[];
  workspaceSections: NavigationSection[];
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 px-3 py-3 backdrop-blur lg:hidden">
      <div className="flex items-center gap-3">
        <WorkspaceSwitcher
          currentWorkspace={currentWorkspace}
          workspaceOptions={workspaceOptions}
        />
        <details className="relative ml-auto">
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
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-700 text-xs font-semibold text-white"
          href="/account"
        >
          {initialsFor(accountLabel)}
        </Link>
      </div>
    </header>
  );
}

function MobileBottomNav({
  isWorkspacePanelOpen,
  notificationSummary,
  onOpenWorkspacePanel,
  pathname,
  searchParams,
}: {
  isWorkspacePanelOpen: boolean;
  notificationSummary: NotificationSummary;
  onOpenWorkspacePanel: (button: HTMLButtonElement) => void;
  pathname: string;
  searchParams: SearchParamsReader;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(24,24,27,0.08)] backdrop-blur lg:hidden">
      {PERSONAL_LINKS.map((link) => {
        const isActive = isLinkActive(link, pathname, searchParams);

        if (link.id === "my-place") {
          return (
            <button
              aria-current={isActive ? "page" : undefined}
              aria-expanded={isWorkspacePanelOpen}
              className={mobileLinkClass(
                isActive,
                isWorkspacePanelOpen && !isActive,
              )}
              key={link.id}
              onClick={(event) => onOpenWorkspacePanel(event.currentTarget)}
              type="button"
            >
              <Icon name={link.icon} />
              <span className="relative">{link.label}</span>
            </button>
          );
        }

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={mobileLinkClass(isActive)}
            href={link.href}
            key={link.id}
          >
            <Icon name={link.icon} />
            <span className="relative">
              {link.label}
              {link.id === "notifications" && notificationSummary.total > 0 ? (
                <span className="absolute -right-5 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                  {notificationSummary.total > 9 ? "9+" : notificationSummary.total}
                </span>
              ) : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function NavigationShell({
  accountEmail,
  accountLabel,
  children,
  currentOrganizationName,
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
  const showWorkspaceContextSidebar =
    (workspaceType === "organization" &&
      routeWorkspaceKind === "organization") ||
    (workspaceType === "salon" &&
      salonMode === "manage" &&
      routeWorkspaceKind === "manage") ||
    (workspaceType === "salon" &&
      salonMode === "staff" &&
      routeWorkspaceKind === "staff") ||
    (workspaceType === "salon" && routeWorkspaceKind === "salon");
  const showAccountSidebar = routeWorkspaceKind === "personal";
  const showWorkspaceSidebar =
    showAccountSidebar || showWorkspaceContextSidebar;
  const sidebarSections = showAccountSidebar
    ? [ACCOUNT_NAVIGATION_SECTION, ...workspaceSections]
    : workspaceSections;

  return (
    <div
      className={[
        "min-h-screen bg-zinc-50",
        showWorkspaceSidebar ? "lg:pl-[19rem]" : "lg:pl-16",
      ].join(" ")}
    >
      <AppRail
        accountLabel={accountLabel}
        isWorkspacePanelOpen={isWorkspacePanelOpen}
        notificationSummary={notificationSummary}
        onOpenWorkspacePanel={openWorkspacePanel}
        pathname={pathname}
        searchParams={searchParams}
      />
      <QuickWorkspacePanel
        accountLabel={accountLabel}
        currentWorkspace={currentWorkspace}
        isOpen={isWorkspacePanelOpen}
        notificationSummary={notificationSummary}
        onClose={closeWorkspacePanel}
        returnFocusRef={workspacePanelReturnFocusRef}
        workspaceOptions={workspaceOptions}
      />
      {showWorkspaceSidebar ? (
        <WorkspaceSidebar
          accountEmail={accountEmail}
          accountLabel={accountLabel}
          currentOrganizationName={currentOrganizationName}
          currentWorkspace={currentWorkspace}
          pathname={pathname}
          searchParams={searchParams}
          workspaceOptions={workspaceOptions}
          workspaceSections={sidebarSections}
        />
      ) : null}
      <MobileHeader
        accountLabel={accountLabel}
        currentWorkspace={currentWorkspace}
        pathname={pathname}
        searchParams={searchParams}
        workspaceOptions={workspaceOptions}
        workspaceSections={showWorkspaceContextSidebar ? workspaceSections : []}
      />
      <div className="min-h-screen pb-20 lg:pb-0">{children}</div>
      <MobileBottomNav
        isWorkspacePanelOpen={isWorkspacePanelOpen}
        notificationSummary={notificationSummary}
        onOpenWorkspacePanel={openWorkspacePanel}
        pathname={pathname}
        searchParams={searchParams}
      />
    </div>
  );
}
