import type { AppLocalContext } from "./app-local-host";
import { isExperienceOfflineGrant } from "./experience-offline-policy";
import { isTrustedStaffOfflineBinding } from "./staff-offline-binding";
import { ownerLocalReadArgs, ownerLocalReadName } from "./owner-local-workspace";
import { payrollReadArgs } from "./payroll-read-args";
import { APP_LOCAL_EXPLORE_QUERY_KEYS } from "./app-local-explore-metadata";
import { getTodayDashboardSections } from "./today-dashboard-sections";
import type { TodayDashboard } from "./today-dashboard";

export type AppLocalPrefetchJob = { path: string; name: string; args: Record<string, unknown>; rank: number };
type Job = Omit<AppLocalPrefetchJob, "rank">;
type Audience = "owner" | "staff" | "personal" | "guest";
const origin = "https://reylumi.com";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Descriptors never grant access. Entry must first accept this exact context;
 * every scheduled read still goes through the existing scoped read transport. */
function audience(value: AppLocalContext, now: number): Audience | null {
  if (!value || value.schemaVersion !== 1 || !value.context || value.offline
    || value.offlineState === "unconfirmed" || value.offlineState === "online-only"
    || [401, 403, 409].includes(value.grantStatus ?? 0)) return null;
  const context = value.context, grant = value.grant;
  if (!/^v3:[a-f0-9]{64}$/.test(context.scope)) return null;
  if (grant) {
    if (!isExperienceOfflineGrant(grant, { scope: context.scope }, now)
      || grant.viewerId !== context.viewerId || grant.workspaceId !== context.workspaceId || grant.salonId !== context.salonId) return null;
  } else if (!context.authenticated || !Number.isFinite(value.onlineValidatedAt)
    || value.onlineValidatedAt <= 0 || value.onlineValidatedAt > now || now - value.onlineValidatedAt >= 30_000) return null;
  if (!context.authenticated || !context.viewerId) return grant?.kind === "public" && context.viewerId === null ? "guest" : null;
  if (context.salonId && value.access?.ownerWorkspace && (!grant || grant.kind === "owner")) return "owner";
  if (context.salonId && value.access?.staffWorkspace && grant?.kind === "staff") return "staff";
  if (!context.salonId && !value.access?.ownerWorkspace && !value.access?.staffWorkspace && (!grant || grant.kind === "customer")) return "personal";
  return null;
}

function safeUrl(path: string): URL | null {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || path.length > 4096 || /\\|%2f|%5c|%00|[\u0000-\u001f]/i.test(path)) return null;
    const url = new URL(path, origin);
    if (url.origin !== origin || url.hash || /(?:^|\/)(?:new|edit|create|delete|checkout|payment|recovery|account-recovery|login|signup|auth)(?:\/|$)/i.test(url.pathname)) return null;
    for (const [key, item] of url.searchParams) if (/token|secret|password|pin|signature|authorization|cookie|^code$|payment|stripe|checkout|^next$|return_to/i.test(key)
      || item.length > 512 || url.searchParams.getAll(key).length !== 1) return null;
    return url;
  } catch { return null; }
}
const read = (path: string, name: string, args: Record<string, unknown> = {}): Job => ({ path, name, args });
const query = (url: URL, keys: readonly string[]) => Object.fromEntries(keys.flatMap(key => url.searchParams.has(key) ? [[key, url.searchParams.get(key)!]] : []));
function ownerPanel(path: string): Job {
  return read(path, ownerLocalReadName(path.split("?")[0]), ownerLocalReadArgs(path));
}
function staffId(value: AppLocalContext): string | null {
  const grant = value.grant, binding = grant?.staffBinding, context = value.context;
  return grant?.kind === "staff" && grant.scopes.includes(context.scope) && context.viewerId && context.salonId
    && isTrustedStaffOfflineBinding(binding, { viewerId: context.viewerId, salonId: context.salonId }) ? binding.staffId : null;
}
function exploreJobs(url = new URL("/explore", origin)): Job[] {
  const params = new URLSearchParams(url.search); params.delete("page"); params.sort();
  const args = { query: params.toString() }, path = "/explore" + (params.size ? "?" + params : "");
  return [read(path, "page.explore", args), read(path, "page.explore-extras", args), read(path, "page.explore-feed", args)];
}
function defaultJobs(role: Audience, value: AppLocalContext): Job[] {
  const common = [read("/notifications", "page.notifications", { filter: "all" }), read("/more", "page.more"), read("/my-place", "page.my-place")];
  if (role === "guest") return exploreJobs();
  if (role === "owner") return [
    read("/staff/today", "page.owner-today", { phase: "shell" }), ownerPanel("/pos/book"), read("/salon-profile", "owner.salon-profile"), common[0],
    ownerPanel("/pos"), ownerPanel("/pos/ticket"), ownerPanel("/pos/report"), read("/customers", "page.owner-customers"),
    read("/staff", "page.owner-staff"), read("/services", "page.services"), read("/payroll", "page.owner-payroll", payrollReadArgs("/payroll")), ...common.slice(1),
  ];
  if (role === "staff") {
    const id = staffId(value);
    // Online-only Staff presentation is deliberately not background authority.
    // Staff's Post tab is the ordinary salon-profile read, never a relay command.
    return id ? [read("/staff/my-work", "staff.my-work", { staffId: id }), read("/staff/appointments", "staff.schedule", { staffId: id }),
      read("/salon-profile", "owner.salon-profile"), read("/staff/workday", "staff.workday", { staffId: id }),
      read("/staff/my-work?tab=payroll", "staff.my-work", { tab: "payroll", staffId: id }),
      read("/staff/my-work?tab=analysis", "staff.my-work", { tab: "analysis", staffId: id }), ...common] : [];
  }
  return [exploreJobs()[0], read("/my-bookings", "page.customer-bookings"), read("/beauty", "page.beauty"), read("/activity", "customer.activity"),
    read("/my-place", "page.my-place"), read("/more/saved-post", "customer.saved-posts"), read("/more/following", "customer.following"),
    read("/explore/favorites", "customer.favorites"), ...common.filter(job => job.name !== "page.my-place"), ...exploreJobs().slice(1)];
}
function currentJobs(role: Audience, value: AppLocalContext, url: URL): Job[] {
  const path = url.pathname + url.search, pathname = url.pathname;
  if (pathname === "/notifications" && role !== "guest") return [read(path, "page.notifications", { filter: url.searchParams.get("filter") === "unread" ? "unread" : "all" })];
  if (["/more", "/my-place"].includes(pathname) && role !== "guest") return [read(path, pathname === "/more" ? "page.more" : "page.my-place")];
  if (role === "owner") {
    if (pathname === "/staff/today") return [read(path, "page.owner-today", { ...query(url, ["date"]), phase: "shell" })];
    const alias: Record<string, string> = { "/bookings": "/pos/book", "/pos-tickets": "/pos/ticket", "/reports": "/pos/report" };
    if (alias[pathname]) return [{ ...ownerPanel(alias[pathname] + url.search), path }];
    if (["/pos", "/pos/book", "/pos/ticket", "/pos/report", "/pos/check-in"].includes(pathname)) return [pathname === "/pos" ? ownerPanel("/pos") : ownerPanel(path)];
    if (pathname === "/salon-profile") return [read(path, "owner.salon-profile")];
    if (pathname === "/services") return [read(path, "page.services")];
    if (pathname === "/customers") return [read(path, "page.owner-customers", query(url, ["page", "q"]))];
    const detail = pathname.match(/^\/customers\/([^/]+)$/);
    if (detail && uuid.test(detail[1])) return [read(path, "page.owner-customer-detail", { customerId: detail[1], ...query(url, ["group"]) })];
    if (pathname === "/staff") return [read(path, "page.owner-staff", query(url, ["connection_error", "connection_notice", "error", "filter", "q"]))];
    if (pathname === "/payroll") return [read(path, "page.owner-payroll", payrollReadArgs(path))];
  }
  if (role === "staff") {
    const id = staffId(value); if (!id) return [];
    if (pathname === "/salon-profile") return [read(path, "owner.salon-profile")];
    if (pathname === "/staff/my-work") return [read(path, "staff.my-work", { ...query(url, ["tab", "payPeriodStart"]), staffId: id })];
    if (pathname === "/staff/appointments") return [read(path, "staff.schedule", { ...query(url, ["range", "status", "bookingId", "date", "quickId", "view"]), staffId: id })];
    if (pathname === "/staff/workday") return [read(path, "staff.workday", { staffId: id })];
  }
  if (role === "personal" || role === "guest") {
    if (pathname === "/explore" && [...url.searchParams.keys()].every(key => (APP_LOCAL_EXPLORE_QUERY_KEYS as readonly string[]).includes(key))) return exploreJobs(url);
    if (role === "guest") return [];
    if (pathname === "/my-bookings" || /^\/my-bookings\/[^/]+$/.test(pathname)) {
      const bookingId = pathname.split("/")[2];
      if (!bookingId || uuid.test(bookingId)) return [read(path, "page.customer-bookings", { ...query(url, ["tab", "details"]), ...(bookingId ? { bookingId } : {}) })];
    }
    if (pathname === "/beauty" || pathname === "/activity") return [read(path, pathname === "/beauty" ? "page.beauty" : "customer.activity")];
    if (["/more/saved-post", "/more/saved-posts", "/more/saved-designs"].includes(pathname)) return [read(path, "customer.saved-posts", query(url, ["filter", "page", "q"]))];
    if (["/more/following", "/more/favorite-shop", "/more/favorite-customer"].includes(pathname)) return [read(path, "customer.following", { ...query(url, ["filter", "page", "q"]), ...(pathname === "/more/favorite-shop" ? { filter: "shop" } : pathname === "/more/favorite-customer" ? { filter: "beauty" } : {}) })];
    if (pathname === "/explore/favorites") return [read(path, "customer.favorites", query(url, ["salons", "after"]))];
  }
  return [];
}
function ranked(jobs: Job[]): AppLocalPrefetchJob[] {
  const seen = new Set<string>();
  return jobs.filter(job => {
    const key = JSON.stringify([job.name, Object.entries(job.args).sort(([a], [b]) => a.localeCompare(b))]);
    if (seen.has(key)) return false; seen.add(key); return true;
  }).map((job, rank) => ({ ...job, rank }));
}

/** Match the component's exact named-read arguments; equivalent server defaults
 * alone are not enough because omitted arguments have distinct cache keys. */
export function appLocalPrefetchPlan(context: AppLocalContext, path: string, now = Date.now()): AppLocalPrefetchJob[] {
  const role = audience(context, now), url = safeUrl(path);
  if (!role || !url || url.searchParams.has("profile") || url.searchParams.has("editStaff")
    || url.pathname === "/staff" && [...url.searchParams.keys()].some(key => ["add", "setup", "invite_email", "invite_phone", "invite_request", "staff"].includes(key))
    || url.pathname === "/payroll" && ["settings", "tools", "download", "tax"].includes(url.searchParams.get("tab") ?? "")) return [];
  try { return ranked([...currentJobs(role, context, url), ...defaultJobs(role, context)]); } catch { return []; }
}

/** The server's accepted Today shell supplies its business date and permitted
 * sections. Never derive the salon's business day from the device clock. */
export function appLocalTodayPrefetchJobs(context: AppLocalContext, shellData: unknown, now = Date.now()): AppLocalPrefetchJob[] {
  if (audience(context, now) !== "owner" || !shellData || typeof shellData !== "object") return [];
  const dashboard = (shellData as { dashboard?: TodayDashboard }).dashboard;
  if (!dashboard || !/^\d{4}-\d{2}-\d{2}$/.test(dashboard.date) || !Number.isFinite(Date.parse(dashboard.date))
    || dashboard.noAccess !== false || !dashboard.permissions || !dashboard.dayView
    || typeof dashboard.dayView.isCurrentDate !== "boolean"
    || ["canViewBookings", "canViewReports", "canViewStaffFinancials"].some(key => typeof dashboard.permissions[key as keyof TodayDashboard["permissions"]] !== "boolean")) return [];
  return ranked(getTodayDashboardSections(dashboard).map(phase => read("/staff/today", "page.owner-today", { date: dashboard.date, phase })));
}
