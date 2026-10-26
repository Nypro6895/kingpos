import "server-only";

import { createHash } from "node:crypto";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { isSalonManageContext } from "./current-context";
import { createAuthenticatedSupabaseServerClient } from "./supabase/server";
import { listCustomerBookings, getCustomerBookingDetail, type CustomerBookingListScope } from "./customer-bookings";
import { getAccountSavedPosts, getAccountFollowing } from "./account-social";
import { loadCustomerExperienceResource } from "./customer-experience-resource-server";
import { loadStaffExperienceResource } from "./staff-experience-resource-server";
import { getStaffPortalIdentity } from "./staff-portal-identity";
import { loadStaffMyWorkResource } from "./staff-my-work-resource-server";
import { getTodayDashboard } from "./today-dashboard";
import { isTodayDashboardSection } from "./today-dashboard-sections";
import { referenceFavoriteCursor, resolveReferenceFavorites, encodeReferenceFavoriteCursor } from "./explore-reference-favorites";
import { runReadWithDeadline } from "./bounded-get";
import { runWithReadAbortSignal, runWithReadContext } from "./read-context-scope";
import type { ReadRequestTiming } from "./read-request-timing";
import { APP_LOCAL_READ_RESOURCES, isAppLocalRoleResourceName, type AppLocalRoleResourceName } from "./app-local-role-resources";

export class AppLocalRoleReadError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "AppLocalRoleReadError"; }
}
export type AppLocalRoleReadResponse = {
  schemaVersion: 1; status: 200 | 304; scope: string; etag: string; updatedAt: number; data?: unknown;
};
type ReadOptions = { scope: string; etag?: string; signal?: AbortSignal; timing?: ReadRequestTiming };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cancelled(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
function parseArgs(name: AppLocalRoleResourceName, raw: unknown): URLSearchParams {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw new AppLocalRoleReadError(400, "Invalid read arguments");
  if (JSON.stringify(raw).length > 8192) throw new AppLocalRoleReadError(400, "Read arguments are too large");
  const allowed: readonly string[] = APP_LOCAL_READ_RESOURCES[name].params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.includes(key) || !(typeof value === "string" || typeof value === "number") || String(value).length > 512) throw new AppLocalRoleReadError(400, "Invalid read parameter");
    query.set(key, String(value));
  }
  for (const key of ["staffId", "bookingId", "ticketId", "details"]) if (query.has(key) && !uuid.test(query.get(key)!)) throw new AppLocalRoleReadError(400, "Invalid record");
  return query;
}
function oneOf(value: string | null, allowed: readonly string[], fallback: string) {
  if (value === null) return fallback;
  if (!allowed.includes(value)) throw new AppLocalRoleReadError(400, "Invalid filter");
  return value;
}
function pageValue(value: string | null, fallback = 1) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new AppLocalRoleReadError(400, "Invalid page");
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10000) throw new AppLocalRoleReadError(400, "Invalid page");
  return Math.max(fallback, parsed);
}
function envelope(name: string, scope: string, data: unknown, etag?: string): AppLocalRoleReadResponse {
  const stableData = data && typeof data === "object" && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== "generatedAt")) : data;
  const revision = '"' + createHash("sha256").update(JSON.stringify({ schemaVersion: 1, name, scope, data: stableData })).digest("hex") + '"';
  return { schemaVersion: 1, status: etag === revision ? 304 : 200, scope, etag: revision, updatedAt: Date.now(), ...(etag === revision ? {} : { data }) };
}

/** Named, read-only adapters reuse existing server identity and ownership checks. */
export async function readAppLocalRoleResource(name: string, args: unknown, options: ReadOptions): Promise<AppLocalRoleReadResponse | null> {
  return runWithReadContext(() => readAppLocalRoleResourceInContext(name, args, options));
}

async function readAppLocalRoleResourceInContext(name: string, args: unknown, options: ReadOptions): Promise<AppLocalRoleReadResponse | null> {
  if (!isAppLocalRoleResourceName(name) || name === "market.catalog") return null;
  if (!options.scope || options.scope.length > 8192) throw new AppLocalRoleReadError(400, "Invalid scope");
  const query = parseArgs(name, args ?? {}); cancelled(options.signal);
  let data: unknown;
  if (name === "staff.schedule" || name === "staff.workday") {
    query.set("kind", APP_LOCAL_READ_RESOURCES[name].kind); query.set("scope", options.scope);
    data = await runReadWithDeadline(loadStaffExperienceResource(query), 12000);
  } else if (name === "staff.my-work") {
    const readIdentity = () => runReadWithDeadline(getStaffPortalIdentity(), 12000);
    const identity = await (options.timing?.measure("staff_identity", readIdentity) ?? readIdentity());
    if (!identity.context.user) throw new AppLocalRoleReadError(401, "Sign in required");
    if (!identity.context.currentSalon || !identity.context.currentAccount || !identity.staff) throw new AppLocalRoleReadError(403, "Staff access changed");
    if (getExperienceContext(identity.context).scope !== options.scope || query.get("staffId") !== identity.staff.id) throw new AppLocalRoleReadError(409, "Staff workspace changed");
    const tab = oneOf(query.get("tab"), ["daily", "payroll", "analysis"], "daily");
    const payPeriodStart = query.get("payPeriodStart") ?? undefined;
    if (payPeriodStart && !/^\d{4}-\d{2}-\d{2}(?::\d{4}-\d{2}-\d{2})?$/.test(payPeriodStart)) throw new AppLocalRoleReadError(400, "Invalid pay period");
    const result = await runReadWithDeadline(loadStaffMyWorkResource(identity, { tab, payPeriodStart }, options.timing), 12000);
    if (tab === "payroll" && !result.payrollData || tab === "analysis" && !result.analysisData) throw new AppLocalRoleReadError(503, "Please try again");
    data = result;
  } else {
    const readContext = () => runReadWithDeadline(getRequestBusinessContext(), 12000);
    const context = await (options.timing?.measure("auth", readContext) ?? readContext());
    if (!context.user) throw new AppLocalRoleReadError(401, "Sign in required");
    if (getExperienceContext(context).scope !== options.scope) throw new AppLocalRoleReadError(409, "Workspace changed");
    cancelled(options.signal);
    if (name === "owner.today") {
      if (!isSalonManageContext(context) || !context.currentBusiness || !context.currentAccount || !context.currentSalon) throw new AppLocalRoleReadError(403, "Owner access required");
      const date = query.get("date") ?? undefined;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppLocalRoleReadError(400, "Invalid date");
      const phase = query.get("phase") ?? undefined;
      if (phase !== undefined && phase !== "shell" && !isTodayDashboardSection(phase)) throw new AppLocalRoleReadError(400, "Invalid Today phase");
      const readToday = () => runReadWithDeadline(signal => runWithReadAbortSignal(signal, () => getTodayDashboard(context, { date, ...(phase === undefined ? {} : { phase }) })), 12000);
      const result = await (options.timing?.measureToday(phase, readToday) ?? readToday());
      if (result.noAccess) throw new AppLocalRoleReadError(403, "Owner access changed");
      if (result.loadErrors.length) throw new AppLocalRoleReadError(503, "Please try again");
      data = result;
    } else if (name === "customer.activity" || name === "customer.history") {
      query.set("kind", APP_LOCAL_READ_RESOURCES[name].kind);
      data = await runReadWithDeadline(loadCustomerExperienceResource(query), 12000);
    } else if (name === "customer.bookings") {
      const tab = oneOf(query.get("tab"), ["upcoming", "past", "cancelled"], "upcoming") as CustomerBookingListScope;
      const result = await runReadWithDeadline(listCustomerBookings({ scope: tab }), 12000);
      if (!result.ok) throw new AppLocalRoleReadError(result.code === "sign_in_required" ? 401 : 503, result.message);
      const bookings = [...result.data], details = query.get("details");
      if (details && !bookings.some(item => item.id === details)) {
        const selected = await runReadWithDeadline(getCustomerBookingDetail(details), 12000);
        if (!selected.ok) throw new AppLocalRoleReadError(selected.code === "sign_in_required" ? 401 : 404, selected.message);
        if (selected.data) bookings.push(selected.data);
      }
      data = { tab, bookings, details };
    } else if (name === "customer.saved-posts") {
      const filter = oneOf(query.get("filter"), ["all", "beauty_post", "salon_profile_look", "salon_profile_update"], "all"), page = pageValue(query.get("page")), q = query.get("q")?.trim() ?? "";
      const rows = await runReadWithDeadline(getAccountSavedPosts({ filter, limit: 11, offset: (page - 1) * 10, query: q }), 12000);
      data = { filter, page, query: q, posts: rows.slice(0, 10), hasNext: rows.length > 10 };
    } else if (name === "customer.following") {
      const filter = oneOf(query.get("filter"), ["all", "shop", "beauty"], "all"), page = pageValue(query.get("page")), q = query.get("q")?.trim() ?? "";
      data = await runReadWithDeadline(getAccountFollowing({ filter, page, pageSize: 10, query: q }), 12000);
    } else if (name === "customer.favorites") {
      const client = await createAuthenticatedSupabaseServerClient();
      if (!client) throw new AppLocalRoleReadError(401, "Sign in required");
      const salons = pageValue(query.get("salons"), 0), after = query.get("after") ?? undefined, cursor = referenceFavoriteCursor(after);
      if (after && !cursor) throw new AppLocalRoleReadError(400, "Invalid favorites cursor");
      const [salonPreferences, references] = await runReadWithDeadline(Promise.all([
        Promise.resolve(client.rpc("get_my_explore_salon_preferences", { p_offset: salons })),
        Promise.resolve(client.rpc("get_my_explore_reference_favorites", { p_before_created_at: cursor?.createdAt ?? null, p_before_item_key: cursor?.itemKey ?? null, p_limit: 20 })),
      ]), 12000);
      if (salonPreferences.error || references.error) throw new AppLocalRoleReadError(503, "Favorites could not be loaded");
      const rows = Array.isArray(references.data) ? references.data as Array<{ item_key: string; created_at: string }> : [], shown = rows.slice(0, 20), last = shown.at(-1);
      const resolved = await runReadWithDeadline(resolveReferenceFavorites(shown.map(item => item.item_key)), 12000);
      if (resolved.error) throw new AppLocalRoleReadError(503, resolved.error);
      const salonRows = Array.isArray(salonPreferences.data) ? salonPreferences.data : [];
      data = { salons: salonRows.slice(0, 20), hasMoreSalons: salonRows.length > 20, salonOffset: salons, favorites: resolved.items, next: rows.length > 20 && last ? encodeReferenceFavoriteCursor({ createdAt: last.created_at, itemKey: last.item_key }) : null };
    }
  }
  cancelled(options.signal);
  return envelope(name, options.scope, data, options.etag);
}
