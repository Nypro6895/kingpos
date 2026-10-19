import "server-only";

import { createHash } from "node:crypto";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { loadMarketExperienceData } from "./market-experience-data";
import { loadSettingsHub } from "@/app/settings/settings-hub-actions";
import { getCustomerActivity, getCustomerActivityReceipt } from "./customer-activity";
import { getStaffPortalIdentity } from "./staff-portal-identity";
import { getTodaysStaffWorkday } from "./staff-workdays";
import { marketPluginContext } from "./market-plugins";
import { bookingDepositPurchaseState } from "./booking-deposit-market";
import { isOwnerMembership } from "./current-context";
import { listMyOwnerTransferInvites } from "./owner-transfer";
import { getPlaceRequests } from "@/app/my-place/actions";
import { inspectProfilePhoneClaim } from "./customer-identity-claims";
import { hasPermission } from "./permissions";
import { isSalonManageContext } from "./current-context";
import { getCurrentSalonServicesWorkspace, SERVICE_PERMISSIONS } from "./services";
import { supportRpc, type SupportCaseItem, type SupportConversation } from "./support-cases";
import { roleNavigationKindForContext } from "@/app/role-navigation";
import { campaignWalletAction } from "@/app/campaigns/credit-actions";
import { getCustomerBookingDetail } from "./customer-bookings";
import { runReadWithDeadline } from "./bounded-get";
import { runWithReadContext } from "./read-context-scope";
import type { ReadRequestTiming } from "./read-request-timing";
import { APP_LOCAL_PLATFORM_READS, type AppLocalBookingsData, type AppLocalSettingsData } from "./app-local-platform-types";
import { readAppLocalRoleResource, AppLocalRoleReadError, type AppLocalRoleReadResponse } from "./app-local-role-resources-server";

type Options = { scope: string; etag?: string; signal?: AbortSignal; timing?: ReadRequestTiming };
function cancelled(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
function parse(name: keyof typeof APP_LOCAL_PLATFORM_READS, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype || JSON.stringify(input).length > 8192) throw new AppLocalRoleReadError(400, "Invalid page arguments");
  const allowed: readonly string[] = APP_LOCAL_PLATFORM_READS[name].argumentKeys;
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key) || typeof value !== "string" || value.length > 512) throw new AppLocalRoleReadError(400, "Invalid page parameter");
    args[key] = value;
  }
  for (const field of ["ticketId", "details", "bookingId", "caseId"]) if (args[field] && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[field])) throw new AppLocalRoleReadError(400, "Invalid record");
  return args;
}
function reply(name: string, scope: string, data: unknown, etag?: string): AppLocalRoleReadResponse {
  // The Today wrapper keeps the original timestamp for display, but a fresh
  // clock stamp alone must not invalidate unchanged authorized section data.
  let stableData = data;
  if (name === "page.owner-today" && data && typeof data === "object" && !Array.isArray(data)) {
    const wrapper = data as Record<string, unknown>;
    const dashboard = wrapper.dashboard;
    if (dashboard && typeof dashboard === "object" && !Array.isArray(dashboard)) {
      stableData = { ...wrapper, dashboard: Object.fromEntries(Object.entries(dashboard).filter(([key]) => key !== "generatedAt")) };
    }
  }
  const revision = '"' + createHash("sha256").update(JSON.stringify({ schemaVersion: 1, name, scope, data: stableData })).digest("hex") + '"';
  return { schemaVersion: 1, status: etag === revision ? 304 : 200, scope, etag: revision, updatedAt: Date.now(), ...(etag === revision ? {} : { data }) };
}

/** Exact existing page props; no commands, payment confirmation or security credentials are read here. */
export async function readAppLocalPlatformResource(name: string, input: unknown, options: Options): Promise<AppLocalRoleReadResponse | null> {
  return runWithReadContext(() => readAppLocalPlatformResourceInContext(name, input, options));
}

async function readAppLocalPlatformResourceInContext(name: string, input: unknown, options: Options): Promise<AppLocalRoleReadResponse | null> {
  if (!Object.hasOwn(APP_LOCAL_PLATFORM_READS, name)) return null;
  const args = parse(name as keyof typeof APP_LOCAL_PLATFORM_READS, input ?? {});
  if (!options.scope || options.scope.length > 8192) throw new AppLocalRoleReadError(400, "Invalid scope");
  cancelled(options.signal);
  const readContext = () => runReadWithDeadline(getRequestBusinessContext(), 12000);
  const context = await (options.timing?.measure("auth", readContext) ?? readContext());
  let resolvedIdentity: Awaited<ReturnType<typeof getStaffPortalIdentity>> | Awaited<ReturnType<typeof getTodaysStaffWorkday>> | undefined;
  if (getExperienceContext(context).scope !== options.scope) {
    if (name !== "page.staff-identity" || !context.user) throw new AppLocalRoleReadError(409, "Workspace changed");
    resolvedIdentity = args.view === "workday" ? await runReadWithDeadline(getTodaysStaffWorkday(), 12000) : await runReadWithDeadline(getStaffPortalIdentity(), 12000);
    if (!resolvedIdentity.staff || resolvedIdentity.context.user?.id !== context.user.id || getExperienceContext(resolvedIdentity.context).scope !== options.scope) throw new AppLocalRoleReadError(409, "Staff workspace changed");
  }
  if (!["page.market", "page.market-deposit"].includes(name) && !context.user) throw new AppLocalRoleReadError(401, "Sign in required");
  cancelled(options.signal);
  let data: unknown;
  if (name === "page.market") {
    data = await runReadWithDeadline(loadMarketExperienceData(context), 20000);
  } else if (name === "page.market-deposit") {
    let installed = false;
    if (context.currentSalon) {
      try {
        const { salonId } = await marketPluginContext();
        const state = await bookingDepositPurchaseState(salonId);
        installed = Boolean(state.installed && state.paid);
      } catch { /* Keep the original public product behavior; checkout rechecks its authority. */ }
    }
    data = { salonId: context.currentSalon?.id, installed };
  } else if (name === "page.settings") {
    const index = await runReadWithDeadline(loadSettingsHub(), 15000);
    // KingUser contains profile metadata only. Do not extend this with security/PIN/session DTOs.
    data = { user: context.user!, createdAtLabel: new Date(context.user!.created_at).toLocaleDateString("en-US"), index } satisfies AppLocalSettingsData;
  } else if (name === "page.owner-today") {
    const response = await readAppLocalRoleResource("owner.today", args, { ...options, etag: undefined });
    data = { dashboard: response!.data, isOwner: isOwnerMembership(context.currentMembership) };
  } else if (name === "page.customer-bookings") {
    const { bookingId, ...query } = args;
    if (bookingId) {
      const selected = await runReadWithDeadline(getCustomerBookingDetail(bookingId), 12000);
      if (!selected.ok || !selected.data) throw new AppLocalRoleReadError(!selected.ok && selected.code === "sign_in_required" ? 401 : 404, !selected.ok ? selected.message : "Booking unavailable.");
      const booking = selected.data;
      query.details = booking.id;
      query.tab = booking.status === "cancelled" ? "cancelled" : new Date(booking.start_at).getTime() <= Date.now() || booking.historyEvidence?.ticket ? "past" : "upcoming";
    }
    const response = await readAppLocalRoleResource("customer.bookings", query, { ...options, etag: undefined });
    const bookings = response!.data as Omit<AppLocalBookingsData, "historyRows">;
    let historyRows: AppLocalBookingsData["historyRows"] = null;
    if (bookings.tab === "past") {
      const activity = await runReadWithDeadline(getCustomerActivity({ limit: 50 }), 12000);
      if (!activity.ok) throw new AppLocalRoleReadError(activity.code === "sign_in_required" ? 401 : 503, activity.message);
      historyRows = activity.data.history.filter(item => {
        if (item.type === "booking") return bookings.bookings.some(booking => booking.id === item.bookingId);
        if (item.type === "purchase" && item.bookingId) return bookings.bookings.some(booking => booking.id === item.bookingId);
        return bookings.bookings.some(booking => booking.salon_id === item.salon.id &&
          new Intl.DateTimeFormat("en-CA", { timeZone: booking.salon_timezone_snapshot }).format(new Date(booking.start_at)) ===
          new Intl.DateTimeFormat("en-CA", { timeZone: booking.salon_timezone_snapshot }).format(new Date(item.occurredAt)));
      });
    }
    data = { ...bookings, historyRows };
  } else if (name === "page.customer-receipt") {
    if (!args.ticketId) throw new AppLocalRoleReadError(400, "A receipt is required");
    const result = await runReadWithDeadline(getCustomerActivityReceipt(args.ticketId), 12000);
    if (!result.ok || !result.data) throw new AppLocalRoleReadError(!result.ok && result.code === "sign_in_required" ? 401 : 404, !result.ok ? result.message : "Receipt not found");
    data = { receipt: result.data };
  } else if (name === "page.my-place") {
    const [requests, phoneClaim, owners] = await runReadWithDeadline(Promise.all([
      getPlaceRequests(), context.user!.phone ? inspectProfilePhoneClaim(context.user!.phone) : Promise.resolve(null),
      listMyOwnerTransferInvites().then(invites => ({ invites, error: undefined as string | undefined })).catch(() => ({ invites: [], error: "Owner invitations could not be loaded. Please retry." })),
    ]), 15000);
    data = { currentWorkspace: context.currentWorkspace, user: context.user!, phoneVerified: phoneClaim?.ok === true && phoneClaim.data.verifiedByCurrentUser,
      requests, ownerInvites: owners.invites, ownerInvitesError: owners.error,
      salons: [...context.availableManageSalons, ...context.availableStaffSalons], workspaceOptions: context.workspaceOptions };
  } else if (name === "page.services") {
    if (!isSalonManageContext(context) || !context.currentSalon || !context.currentAccount || !await hasPermission(SERVICE_PERMISSIONS.view, context)) throw new AppLocalRoleReadError(403, "You do not have permission to view services.");
    data = { data: await runReadWithDeadline(getCurrentSalonServicesWorkspace(context), 15000) };
  } else if (name === "page.more") {
    const roleKind = roleNavigationKindForContext({ salonMode: context.salonMode, workspaceType: context.workspaceType });
    const campaignInstalled = roleKind === "owner" ? await runReadWithDeadline(campaignWalletAction(), 12000).then(wallet => wallet.installed).catch(() => false) : false;
    data = { roleKind, campaignInstalled };
  } else if (name === "page.support") {
    const cases = await runReadWithDeadline(supportRpc<SupportCaseItem[]>("list_my_support_cases"), 12000);
    if (!cases) throw new AppLocalRoleReadError(401, "Sign in to view your requests.");
    data = { cases };
  } else if (name === "page.support-case") {
    if (!args.caseId) throw new AppLocalRoleReadError(400, "A conversation is required.");
    const conversation = await runReadWithDeadline(supportRpc<SupportConversation>("get_support_conversation", { p_report_id: args.caseId }), 12000);
    if (!conversation) throw new AppLocalRoleReadError(404, "Conversation unavailable.");
    data = { conversation };
  } else if (name === "page.staff-identity") {
    if (args.view && !["schedule", "workday", "my-work"].includes(args.view)) throw new AppLocalRoleReadError(400, "Invalid staff view");
    const identity = resolvedIdentity ?? (args.view === "workday" ? await runReadWithDeadline(getTodaysStaffWorkday(), 12000) : await runReadWithDeadline(getStaffPortalIdentity(), 12000));
    if (!identity.context.user || identity.context.user.id !== context.user!.id) throw new AppLocalRoleReadError(409, "Staff account changed");
    if (!identity.context.currentSalon || !identity.staff) throw new AppLocalRoleReadError(403, "No active staff profile is linked for this salon");
    data = { resourceScope: getExperienceContext(identity.context).scope, staffId: identity.staff.id, salonId: identity.context.currentSalon.id };
  }
  cancelled(options.signal);
  return reply(name, options.scope, data, options.etag);
}
