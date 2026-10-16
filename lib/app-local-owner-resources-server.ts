import "server-only";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { isSalonManageContext } from "@/lib/current-context";
import type { SalonManagePageContext } from "@/lib/route-context-guards";
import { hasPermission } from "@/lib/permissions";
import { getCurrentSalonBookingWorkspace, BOOKING_PERMISSIONS, localDateTimeToUtcIso } from "@/lib/bookings";
import { getCurrentSalonPosTickets, getCurrentSalonPosTicketOptions, POS_TICKET_PERMISSIONS } from "@/lib/pos-tickets";
import { canApplyFinancialCorrections, canEditDailyPosClosing, FINANCIAL_CORRECTION_PERMISSIONS, DAILY_POS_REPORT_PERMISSIONS, getDailyPosReport, getDefaultReportDate, isDailyClosingLocked, isDateInputValue, normalizeReportDate } from "@/lib/daily-pos-report";
import { getOperationalReport } from "@/lib/operational-report";
import { getCurrentSalonPosDeskData } from "@/lib/pos-desk";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeWorkspacePreferences } from "@/lib/pos-workspace-preferences";
import { getContextBusinessDate, getContextBusinessTimezone } from "@/lib/salon-business-clock";
import { loadOwnerCheckInData, ownerReadEtag, ownerStaffIds } from "@/lib/owner-pos-read-model";
import { ownerLocalHref, type OwnerLocalPanelData, type OwnerLocalReadName } from "@/lib/owner-local-workspace";
import type { AppLocalRead } from "@/lib/app-local-host";

const names = new Set<OwnerLocalReadName>(["owner.workspace", "owner.check-in", "owner.bookings", "owner.tickets", "owner.reports"]);
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
function filters(args: Record<string, unknown>) {
  if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 4096)) fail(400, "Invalid workspace filters");
  const query = new URLSearchParams(typeof args.query === "string" ? args.query : "");
  if (!ownerLocalHref("/pos/book?" + query.toString())) fail(400, "Invalid workspace filters");
  return Object.fromEntries(query);
}
function dayBounds(date: string, timezone: string) {
  const next = new Date(date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
  const openedFrom = localDateTimeToUtcIso(date + "T00:00", timezone);
  const nextStart = localDateTimeToUtcIso(next.toISOString().slice(0, 10) + "T00:00", timezone);
  if (!openedFrom || !nextStart) fail(400, "Invalid work log date");
  return { openedFrom, openedTo: new Date(Date.parse(nextStart) - 1).toISOString() };
}
function dateLabel(date: string, timezone: string, compact: boolean) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: timezone, ...(compact ? {} : { weekday: "short" }) }).format(new Date(date + "T12:00:00Z"));
}

/** Named, read-only DTO adapters. No caller can select a handler, table or authority. */
export async function readAppLocalOwnerResource(name: string, args: Record<string, unknown> = {}, options: { scope?: string; etag?: string; signal?: AbortSignal } = {}): Promise<AppLocalRead<OwnerLocalPanelData> | null> {
  if (!names.has(name as OwnerLocalReadName)) return null;
  if (options.signal?.aborted) throw options.signal.reason;
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const business = await getRequestBusinessContext();
  if (!business.user) fail(401, "Please sign in again.");
  if (!isSalonManageContext(business) || !business.currentSalon || !business.currentAccount || !business.currentBusiness) fail(403, "This workspace is unavailable.");
  const context = business as SalonManagePageContext, identity = getExperienceContext(context);
  if (!options.scope || identity.scope !== options.scope) fail(409, "The workspace has changed.");
  const query = filters(args), ownerScope = `owner:${context.currentSalon.id}:${context.user.id}`;
  const denied = (message: string): OwnerLocalPanelData => ({ view: "denied", message });
  let data: OwnerLocalPanelData;
  if (name === "owner.check-in") {
    if (!await hasPermission(POS_TICKET_PERMISSIONS.manage, context)) data = denied("You do not have permission to manage check-in.");
    else {
      const ids = ownerStaffIds(args.ids), roster = await loadOwnerCheckInData({ context, ids });
      data = { view: "check-in", props: { data: roster, ...(ids ? { ids, removedIds: ids.filter(id => !roster.staff.some(row => row.id === id)) } : {}) } };
    }
  } else if (name === "owner.workspace") {
    if (!await hasPermission(POS_TICKET_PERMISSIONS.manage, context)) data = denied("You do not have permission to use POS.");
    else {
      const [desk, timezone, db] = await Promise.all([getCurrentSalonPosDeskData({ context, includeCustomers: false, includeWaitingVisits: false }), getContextBusinessTimezone(context), createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true })]);
      if (!db) fail(503, "The workspace is temporarily unavailable.");
      const settings = await db.from("pos_settings").select("workspace_preferences").eq("salon_id", context.currentSalon.id).maybeSingle();
      if (settings.error) fail(503, "The workspace settings are temporarily unavailable.");
      data = { view: "workspace", props: { ownerScope, salonId: context.currentSalon.id, salonName: context.currentSalon.name, timezone, today: desk.today, staff: desk.staff, services: desk.services, defaults: desk.defaults, preferences: normalizeWorkspacePreferences(settings.data?.workspace_preferences) } };
    }
  } else if (name === "owner.bookings") {
    if (!await hasPermission(BOOKING_PERMISSIONS.view, context)) data = denied("You do not have permission to view bookings.");
    else {
      const workspace = await getCurrentSalonBookingWorkspace(query, context);
      data = { view: "bookings", props: { salonId: context.currentSalon.id, bookings: workspace.bookings, canManageBookings: workspace.canManageBookings, canViewBookings: workspace.canViewBookings, filters: workspace.filters, options: workspace.options, accountName: context.currentAccount.name, publicBookingHref: `/book/${context.currentSalon.id}`, range: workspace.range, requests: workspace.requests, salonName: context.currentSalon.name, setupPermissions: workspace.setupPermissions, settings: workspace.settings, timezone: workspace.timezone, warnings: workspace.warnings } };
    }
  } else if (name === "owner.reports") {
    if (!await hasPermission(DAILY_POS_REPORT_PERMISSIONS.view, context)) data = denied("You do not have permission to view reports.");
    else {
      const reportOverview = await getOperationalReport(query, context);
      const selectedDate = await normalizeReportDate(isDateInputValue(query.date) ? query.date : reportOverview.range.endDate, context);
      const [today, report, canEditPermission, canRequestCorrection, canApplyCorrection] = await Promise.all([getDefaultReportDate(context), getDailyPosReport(selectedDate, context), canEditDailyPosClosing(context), hasPermission(DAILY_POS_REPORT_PERMISSIONS.requestCorrection, context), canApplyFinancialCorrections(context)]);
      data = { view: "reports", props: { viewerId: context.user.id, salonId: context.currentSalon.id, salonName: context.currentSalon.name, today, report, reportOverview, canEdit: canEditPermission && !report.lock.isLocked, canApplyCorrection, canRequestCorrection } };
    }
  } else {
    if (!await hasPermission(POS_TICKET_PERMISSIONS.view, context)) data = denied("You do not have permission to view POS tickets.");
    else {
      const timezone = await getContextBusinessTimezone(context), today = await getContextBusinessDate(context);
      const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(query.date ?? "") && Number.isFinite(Date.parse(query.date)) ? query.date : today;
      const bounds = dayBounds(selectedDate, timezone), searchQuery = query.q?.trim() ?? "";
      const [canManage, canVoid, canRequest, canApplyFinancialCorrection, isBusinessDateLocked, result] = await Promise.all([hasPermission(POS_TICKET_PERMISSIONS.manage, context), hasPermission(POS_TICKET_PERMISSIONS.void, context), hasPermission(FINANCIAL_CORRECTION_PERMISSIONS.request, context), canApplyFinancialCorrections(context), isDailyClosingLocked(selectedDate, context), getCurrentSalonPosTickets(bounds)]);
      const canEdit = isBusinessDateLocked ? canManage || canVoid || canRequest || canApplyFinancialCorrection : canManage || canVoid;
      const ticketOptions = canEdit ? await getCurrentSalonPosTicketOptions(context) : { services: [], staff: [] };
      const returnTo = "/pos/ticket?" + new URLSearchParams({ date: selectedDate, ...(searchQuery ? { q: searchQuery } : {}) });
      data = { view: "tickets", props: { salonId: context.currentSalon.id, initialTickets: result.tickets, bounds, searchQuery, canApplyFinancialCorrection, canEdit, isBusinessDateLocked, returnTo, selectedDate, today, selectedDateLabel: dateLabel(selectedDate, timezone, false), selectedDateCompactLabel: dateLabel(selectedDate, timezone, true), services: ticketOptions.services, staff: ticketOptions.staff } };
    }
  }
  if (options.signal?.aborted) throw options.signal.reason;
  const etag = ownerReadEtag({ scope: identity.scope, name, query, ids: ownerStaffIds(args.ids), data });
  return { schemaVersion: 1, status: options.etag === etag ? 304 : 200, scope: identity.scope, etag, updatedAt: Date.now(), ...(options.etag === etag ? {} : { data }) };
}
