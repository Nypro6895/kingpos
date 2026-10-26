import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { isSalonManageContext } from "./current-context";
import { requireSalonManagePageContext } from "./route-context-guards";
import { hasPermission } from "./permissions";
import { getCurrentSalonPosTicket, getCurrentSalonPosTicketOptions, POS_TICKET_PERMISSIONS } from "./pos-tickets";
import { taxCompanySalons, taxCompanyReport } from "./tax-company";
import { runReadWithDeadline } from "./bounded-get";
import { APP_LOCAL_DAILY_READS, type AppLocalTicketDetailData } from "./app-local-daily-metadata";
import type { AppLocalRead } from "./app-local-host";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
function current(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }

/** Original account/salon ownership checks run on every conditional or ordinary read. */
export async function readAppLocalDailyResource(name: string, args: Record<string, unknown> = {}, options: { scope: string; etag?: string; signal?: AbortSignal }): Promise<AppLocalRead | null> {
  if (!Object.hasOwn(APP_LOCAL_DAILY_READS, name)) return null;
  const rule = APP_LOCAL_DAILY_READS[name as keyof typeof APP_LOCAL_DAILY_READS], keys: readonly string[] = rule.argumentKeys;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.entries(args).some(([key, value]) => !keys.includes(key) || typeof value !== "string" || value.length > 160)) fail(400, "Unsupported page filter.");
  if (name === "owner.ticket-detail" && (typeof args.ticketId !== "string" || !uuid.test(args.ticketId))) fail(400, "Invalid ticket.");
  if (name === "customer.tax-report" && (typeof args.salonId !== "string" || !uuid.test(args.salonId) || args.run !== undefined && !uuid.test(String(args.run)))) fail(400, "Invalid salon report.");
  current(options.signal);
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const root = await runReadWithDeadline(getRequestBusinessContext(), 12000);
  if (!root.user) fail(401, "Please sign in again.");
  if (!options.scope || getExperienceContext(root).scope !== options.scope) fail(409, "Your workspace changed. Open this page again.");
  current(options.signal);
  let data: unknown;
  if (name === "owner.ticket-detail") {
    if (!isSalonManageContext(root) || !root.currentSalon || !root.currentAccount) fail(403, "Open your salon management workspace.");
    const context = await runReadWithDeadline(requireSalonManagePageContext(`/pos-tickets/${args.ticketId}`), 12000);
    if (getExperienceContext(context).scope !== options.scope || context.user.id !== root.user.id) fail(409, "Your workspace changed. Open this page again.");
    if (!await hasPermission(POS_TICKET_PERMISSIONS.view, context)) fail(403, "You do not have permission to view POS tickets.");
    const [result, canManageTickets, canVoidTickets] = await runReadWithDeadline(Promise.all([
      getCurrentSalonPosTicket(String(args.ticketId)), hasPermission(POS_TICKET_PERMISSIONS.manage, context), hasPermission(POS_TICKET_PERMISSIONS.void, context),
    ]), 20000);
    if (getExperienceContext(result.context).scope !== options.scope || result.context.user?.id !== root.user.id) fail(409, "Your workspace changed. Open this page again.");
    if (!result.ticket || result.ticket.salon_id !== context.currentSalon.id) fail(404, "POS Ticket was not found for the current salon.");
    const optionsData = canManageTickets && result.ticket.status === "open" ? await runReadWithDeadline(getCurrentSalonPosTicketOptions(context), 12000) : { services: [], staff: [] };
    data = { ticket: result.ticket, salon: context.currentSalon, canManageTickets, canVoidTickets, options: { services: optionsData.services, staff: optionsData.staff } } satisfies AppLocalTicketDetailData;
  } else if (name === "customer.tax-salons") {
    data = await runReadWithDeadline(taxCompanySalons(), 15000);
  } else {
    // The original RPC verifies this user's active salon connection; it is never replaced by the route policy.
    data = await runReadWithDeadline(taxCompanyReport(String(args.salonId), args.run as string | undefined, args.period as string | undefined), 20000);
  }
  current(options.signal);
  const etag = '"' + createHash("sha256").update(JSON.stringify({ schemaVersion: 1, scope: options.scope, name, args, data })).digest("hex") + '"';
  return { schemaVersion: 1, status: options.etag === etag ? 304 : 200, scope: options.scope, etag, updatedAt: Date.now(), ...(options.etag === etag ? {} : { data }) };
}
