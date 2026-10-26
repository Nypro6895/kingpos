import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { requireSalonManagePageContext } from "./route-context-guards";
import { getPayrollTaxCompanyData } from "./payroll";
import { taxCompanySettings } from "./tax-company";
import { runReadWithDeadline } from "./bounded-get";
import { APP_LOCAL_PAYROLL_TAX_READS, type AppLocalPayrollTaxData } from "./app-local-payroll-tax-metadata";
import type { AppLocalRead } from "./app-local-host";

function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
function check(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
export async function readAppLocalPayrollTaxResource(name: string, args: Record<string, unknown> = {}, options: { scope: string; etag?: string; signal?: AbortSignal }): Promise<AppLocalRead | null> {
  if (!Object.hasOwn(APP_LOCAL_PAYROLL_TAX_READS, name)) return null;
  const rule = APP_LOCAL_PAYROLL_TAX_READS[name as keyof typeof APP_LOCAL_PAYROLL_TAX_READS], allowed: readonly string[] = rule.argumentKeys;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.entries(args).some(([key, value]) => !allowed.includes(key) || typeof value !== "string" || value.length > 100)) fail(400, "Invalid payroll filters.");
  check(options.signal);
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const root = await runReadWithDeadline(getRequestBusinessContext(), 12000);
  if (!root.user) fail(401, "Please sign in again.");
  if (!options.scope || getExperienceContext(root).scope !== options.scope) fail(409, "Your workspace changed. Open this page again.");
  let data: unknown;
  if (name === "owner.payroll-tax-settings") {
    // Original owner/plugin RPC checks remain authoritative, including connection visibility.
    data = await runReadWithDeadline(taxCompanySettings(), 15000);
  } else {
    const context = await runReadWithDeadline(requireSalonManagePageContext("/payroll/tax-company"), 12000);
    if (context.user.id !== root.user.id || getExperienceContext(context).scope !== options.scope) fail(409, "Your workspace changed. Open this page again.");
    const result = await runReadWithDeadline(getPayrollTaxCompanyData({ endDate: args.end as string | undefined, month: args.month as string | undefined, payPeriodStart: args.payPeriodStart as string | undefined, preset: args.preset as string | undefined, segment: args.segment as string | undefined, startDate: args.start as string | undefined }), 25000);
    if (result.context.user?.id !== root.user.id || getExperienceContext(result.context).scope !== options.scope) fail(409, "Your workspace changed. Open this page again.");
    // The client needs the saved version header and reportable lines, never a full account context or a duplicate payroll snapshot.
    data = { access: result.access, latestStatement: result.latestStatement ? { run: { id: result.latestStatement.run.id, version: result.latestStatement.run.version, status: result.latestStatement.run.status } } : null,
      lines: result.lines, period: result.period, periodOptions: result.periodOptions, scheduleSetup: result.scheduleSetup, salonPayrollSetting: result.salonPayrollSetting, source: result.source, summary: result.summary } satisfies AppLocalPayrollTaxData;
  }
  check(options.signal);
  const etag = '"' + createHash("sha256").update(JSON.stringify({ schemaVersion: 1, name, args, scope: options.scope, data })).digest("hex") + '"';
  return { schemaVersion: 1, status: options.etag === etag ? 304 : 200, scope: options.scope, etag, updatedAt: Date.now(), ...(options.etag === etag ? {} : { data }) };
}
