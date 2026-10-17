import "server-only";
import { createHash } from "node:crypto";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { isSalonManageContext, isOwnerMembership } from "./current-context";
import { hasPermission } from "./permissions";
import { getCurrentSalonStaffDirectory, STAFF_PERMISSIONS } from "./staff";
import { getCurrentSalonBookingSetup } from "./booking-setup";
import { getSalonStaffConnectionRequests, searchStaffAccountExact } from "./staff-salon-connections";
import { getManagedStaffOfflineBinding } from "./staff-offline-binding-server";
import { getCurrentSalonCustomerList, getCurrentSalonCustomerDetail, getCurrentSalonCustomer } from "./customers";
import { resolveBeautyProfileForSalonCustomer } from "./beauty-relationship";
import { getPayrollPageData } from "./payroll";
import { taxCompanySettings } from "./tax-company";
import { payrollDataPluginInstalled } from "./market-plugins";
import { runReadWithDeadline } from "./bounded-get";
import policy from "./app-local-owner-page-registry.json";
import type { AppLocalRead } from "./app-local-host";
import type { AppLocalOwnerStaffData, AppLocalOwnerCustomersData, AppLocalOwnerCustomerDetailData, AppLocalOwnerCustomerFormData, AppLocalOwnerPayrollData } from "./app-local-owner-page-types";

type Options = { scope?: string; etag?: string; signal?: AbortSignal };
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
function parse(name: keyof typeof policy.reads, input: Record<string, unknown>) {
  const allowed: readonly string[] = policy.reads[name].argumentKeys, args: Record<string, string> = {};
  if (!input || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype || JSON.stringify(input).length > 8192) fail(400, "Invalid page arguments");
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key) || typeof value !== "string" || value.length > 512 || /[\u0000-\u001f]/.test(value)) fail(400, "Invalid page filter");
    args[key] = value;
  }
  for (const key of ["customerId", "staff", "invite_request", "editStaff", "overviewStaff", "overviewService"]) if (args[key] && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args[key])) fail(400, "Invalid record");
  return args;
}
function cancelled(options: Options) { if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("Cancelled", "AbortError"); }
const verifyScope = (context: Parameters<typeof getExperienceContext>[0], scope: string) => { if (getExperienceContext(context).scope !== scope) fail(409, "The workspace has changed"); };

/** Only existing authorized getters produce DTOs. Request context/credentials are never serialized. */
export async function readAppLocalOwnerPageResource(name: string, input: Record<string, unknown> = {}, options: Options = {}): Promise<AppLocalRead | null> {
  if (!Object.hasOwn(policy.reads, name)) return null;
  const args = parse(name as keyof typeof policy.reads, input);
  cancelled(options);
  const context = await runReadWithDeadline(getRequestBusinessContext(), 12000);
  if (!context.user) fail(401, "Please sign in again");
  if (!isSalonManageContext(context) || !context.currentSalon || !context.currentAccount || !context.currentBusiness) fail(403, "Open this page from a Business workspace");
  if (!options.scope) fail(400, "A workspace is required");
  const scope = options.scope;
  verifyScope(context, scope);
  let data: AppLocalOwnerStaffData | AppLocalOwnerCustomersData | AppLocalOwnerCustomerDetailData | AppLocalOwnerCustomerFormData | AppLocalOwnerPayrollData;
  if (name === "page.owner-staff") {
    if (!await hasPermission(STAFF_PERMISSIONS.view, context)) fail(403, "You do not have permission to view staff");
    const [directory, bookingSetup, canManageStaff, canManagePayroll] = await runReadWithDeadline(Promise.all([
      getCurrentSalonStaffDirectory(context), getCurrentSalonBookingSetup(context), hasPermission(STAFF_PERMISSIONS.manage, context), hasPermission("payroll.manage", context),
    ]), 20000);
    verifyScope(directory.context, scope);
    const connectionRequests = canManageStaff ? (await runReadWithDeadline(getSalonStaffConnectionRequests(), 12000)).requests : [];
    let lookupResult: AppLocalOwnerStaffData["lookupResult"] = null, lookupError: string | null = null;
    if (canManageStaff && (args.invite_email?.trim() || args.invite_phone?.trim())) {
      try { lookupResult = await runReadWithDeadline(searchStaffAccountExact({ email: args.invite_email?.trim() || null, phone: args.invite_phone?.trim() || null }), 12000); }
      catch (error) { lookupError = error instanceof Error ? error.message : "Account lookup failed."; }
    }
    const selected = args.staff ? directory.staff.find(member => member.id === args.staff) : null;
    const offlineBinding = canManageStaff && selected ? await runReadWithDeadline(getManagedStaffOfflineBinding(context, selected.id), 10000) : null;
    data = { canViewStaff: true, canManageStaff, canManagePayroll, directory: { staff: directory.staff }, bookingSetup, connectionRequests, lookupResult, lookupError, offlineBinding, experienceScope: scope,
      canBecomeStaff: isOwnerMembership(context.currentMembership) && !directory.staff.some(member => member.account_user_id === context.user!.id || Boolean(context.user!.auth_user_id && member.user_id === context.user!.auth_user_id)) };
  } else if (name === "page.owner-customers") {
    const result = await runReadWithDeadline(getCurrentSalonCustomerList({ page: args.page, search: args.q }), 20000);
    verifyScope(result.context, scope);
    data = { customers: result.customers, pagination: result.pagination, canManageCustomers: await hasPermission("customers.manage", result.context) };
  } else if (name === "page.owner-customer-detail") {
    if (!args.customerId) fail(400, "A customer is required");
    const result = await runReadWithDeadline(getCurrentSalonCustomerDetail(args.customerId, { walkingGroup: args.group === "walking" }), 20000);
    verifyScope(result.context, scope);
    if (!result.data) fail(404, "Customer not found");
    const beautyProfileResult = result.data.customer.customer_user_id ? await runReadWithDeadline(resolveBeautyProfileForSalonCustomer({ context: result.context, customerId: result.data.customer.id }), 12000) : null;
    data = { data: result.data, beautyProfileResult, canManageCustomers: await hasPermission("customers.manage", result.context) };
  } else if (name === "page.owner-customer-form") {
    if (!await hasPermission("customers.manage", context)) fail(403, "You do not have permission to manage customers");
    if (args.customerId) {
      const result = await runReadWithDeadline(getCurrentSalonCustomer(args.customerId), 12000);
      verifyScope(result.context, scope);
      if (!result.customer) fail(404, "Customer not found");
      data = { customer: result.customer, canManageCustomers: true };
    } else data = { canManageCustomers: true };
  } else {
    const downloadRead = payrollDataPluginInstalled().catch(() => null);
    const result = await runReadWithDeadline(getPayrollPageData({ includeAnalytics: !args.tab || args.tab === "overview" || !["staff", "shop", "tax", "settings", "tools", "download"].includes(args.tab), endDate: args.end, month: args.month, payPeriodStart: args.payPeriodStart, preset: args.preset, segment: args.segment, startDate: args.start }), 20000);
    verifyScope(result.context, scope);
    const canManageConnection = isOwnerMembership(context.currentMembership);
    const [taxPlugin, downloadEnabled] = await Promise.all([args.tab === "tax" && canManageConnection ? taxCompanySettings().catch(() => null) : Promise.resolve(null), downloadRead]);
    const { context: privateContext, ...payroll } = result;
    void privateContext;
    data = { payroll, salonId: context.currentSalon.id, salonName: context.currentSalon.name, payrollScope: `${context.currentSalon.id}:${context.user.id}`, canManageConnection, taxPlugin, downloadEnabled };
  }
  cancelled(options);
  const etag = '"' + createHash("sha256").update(JSON.stringify({ schemaVersion: 1, name, scope, data })).digest("hex") + '"';
  return { schemaVersion: 1, status: options.etag === etag ? 304 : 200, scope, etag, updatedAt: Date.now(), ...(options.etag === etag ? {} : { data }) };
}
