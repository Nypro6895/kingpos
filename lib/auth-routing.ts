export const PERSONAL_HOME_PATH = "/explore";

export type AuthRouteWorkspaceKind =
  | "account"
  | "manage"
  | "neutral"
  | "personal"
  | "salon"
  | "shared"
  | "staff";

export type AuthWorkspaceSummary = {
  id: string;
  salonMode: "manage" | "staff" | null;
  type: "account" | "personal" | "salon";
};

export type PostAuthRouteDecision = {
  redirectTo: string;
  routeKind: AuthRouteWorkspaceKind;
  workspaceId: string | null;
};

const INTERNAL_URL_ORIGIN = "https://reylumi.local";

const AUTH_FORM_PATHS = [
  "/forgot-password",
  "/login",
  "/reset-password",
  "/signup",
] as const;
const SHELLLESS_NEUTRAL_PREFIXES = [
  "/book",
  "/booking/manage",
  "/pos/customer-display",
  "/pos/portable",
  "/staff/invite",
] as const;
const SHARED_CONTEXT_PREFIXES = [
  "/account",
  "/explore",
  "/more",
  "/my-place",
  "/notifications",
  "/settings",
] as const;
const ACCOUNT_CONTEXT_PREFIXES = [
  "/permissions",
  "/roles",
  "/salons",
] as const;
const PERSONAL_CONTEXT_PREFIXES = [
  "/activity",
  "/beauty",
  "/businesses",
  "/claim",
  "/my-bookings",
  "/staff/connections",
] as const;
const STAFF_CONTEXT_PREFIXES = [
  "/staff/appointments",
  "/staff/my-work",
  "/staff/workday",
] as const;
const MANAGE_CONTEXT_PREFIXES = [
  "/bookings",
  "/customers",
  "/payroll",
  "/pos",
  "/pos-tickets",
  "/reports",
  "/salon-settings",
  "/services",
  "/staff",
  "/tickets",
] as const;

export function matchesAuthPath(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function pathMatchesAny(pathname: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => matchesAuthPath(pathname, prefix));
}

function pathnameFromInternalPath(path: string) {
  return new URL(path, INTERNAL_URL_ORIGIN).pathname;
}

export function sanitizeAuthReturnPath(
  value: string | null | undefined,
  fallback = PERSONAL_HOME_PATH,
) {
  const path = value?.trim() ?? "";

  if (
    !path ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return fallback;
  }

  try {
    const url = new URL(path, INTERNAL_URL_ORIGIN);

    if (url.origin !== INTERNAL_URL_ORIGIN) {
      return fallback;
    }

    if (pathMatchesAny(url.pathname, AUTH_FORM_PATHS)) {
      return fallback;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function loginHrefForReturnPath(path: string) {
  return `/login?next=${encodeURIComponent(sanitizeAuthReturnPath(path))}`;
}

export function getAuthRouteWorkspaceKind(path: string): AuthRouteWorkspaceKind {
  const pathname = pathnameFromInternalPath(sanitizeAuthReturnPath(path));

  if (pathname === "/" || pathMatchesAny(pathname, SHARED_CONTEXT_PREFIXES)) {
    return "shared";
  }

  if (pathMatchesAny(pathname, SHELLLESS_NEUTRAL_PREFIXES)) {
    return "neutral";
  }

  if (matchesAuthPath(pathname, "/salon-profile")) {
    return "salon";
  }

  if (pathMatchesAny(pathname, STAFF_CONTEXT_PREFIXES)) {
    return "staff";
  }

  if (pathMatchesAny(pathname, ACCOUNT_CONTEXT_PREFIXES)) {
    return "account";
  }

  if (pathMatchesAny(pathname, PERSONAL_CONTEXT_PREFIXES)) {
    return "personal";
  }

  if (pathMatchesAny(pathname, MANAGE_CONTEXT_PREFIXES)) {
    return "manage";
  }

  return "neutral";
}

function personalWorkspace(workspaces: AuthWorkspaceSummary[]) {
  return workspaces.find((workspace) => workspace.type === "personal") ?? null;
}

function preferredWorkspaces(
  workspaces: AuthWorkspaceSummary[],
  preferredWorkspaceId: string | null | undefined,
) {
  const preferred = preferredWorkspaceId
    ? workspaces.find((workspace) => workspace.id === preferredWorkspaceId)
    : null;

  return [
    ...(preferred ? [preferred] : []),
    ...workspaces.filter((workspace) => workspace.id !== preferred?.id),
  ];
}

function workspaceCanRestoreRoute(
  workspace: AuthWorkspaceSummary,
  routeKind: AuthRouteWorkspaceKind,
) {
  if (routeKind === "manage") {
    return workspace.type === "salon" && workspace.salonMode === "manage";
  }

  if (routeKind === "staff") {
    return workspace.type === "salon" && workspace.salonMode === "staff";
  }

  if (routeKind === "salon") {
    return workspace.type === "salon" && Boolean(workspace.salonMode);
  }

  if (routeKind === "account") {
    return (
      workspace.type === "account" ||
      (workspace.type === "salon" && workspace.salonMode === "manage")
    );
  }

  return workspace.type === "personal";
}

function findWorkspaceForRoute(input: {
  preferredWorkspaceId?: string | null;
  routeKind: AuthRouteWorkspaceKind;
  workspaces: AuthWorkspaceSummary[];
}) {
  return (
    preferredWorkspaces(input.workspaces, input.preferredWorkspaceId).find(
      (workspace) => workspaceCanRestoreRoute(workspace, input.routeKind),
    ) ?? null
  );
}

export function resolvePostAuthRoute(input: {
  preferredWorkspaceId?: string | null;
  requestedPath?: string | null;
  workspaces: AuthWorkspaceSummary[];
}): PostAuthRouteDecision {
  const redirectTo = sanitizeAuthReturnPath(input.requestedPath);
  const routeKind = getAuthRouteWorkspaceKind(redirectTo);
  const personal = personalWorkspace(input.workspaces);

  if (redirectTo === "/" || routeKind === "shared") {
    return {
      redirectTo: redirectTo === "/" ? PERSONAL_HOME_PATH : redirectTo,
      routeKind,
      workspaceId: personal?.id ?? null,
    };
  }

  const workspace = findWorkspaceForRoute({
    preferredWorkspaceId: input.preferredWorkspaceId,
    routeKind,
    workspaces: input.workspaces,
  });

  if (workspace) {
    return {
      redirectTo,
      routeKind,
      workspaceId: workspace.id,
    };
  }

  return {
    redirectTo: routeKind === "neutral" ? redirectTo : PERSONAL_HOME_PATH,
    routeKind,
    workspaceId: personal?.id ?? null,
  };
}
