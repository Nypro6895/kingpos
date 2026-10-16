import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { getStaffPortalIdentity } from "./staff-portal-identity";
import { GET as creationGET, POST as creationPOST } from "@/app/api/staff/create-appointment/route";
import { POST as noShowPOST } from "@/app/api/staff/report-no-show/route";
import { POST as confirmPOST } from "@/app/api/staff/confirm-booking/route";
import { POST as staffPreferencesPOST } from "@/app/api/staff/booking-preferences/route";
import { GET as preferencesGET, POST as preferencesPOST } from "@/app/api/notifications/preferences/route";
import { ROLE_READS, ROLE_COMMANDS } from "./app-local-platform-types";
import type { AppLocalRead } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";

const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
async function authorized(scope?: string) {
  const current = await headers();
  if (current.get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const context = await getRequestBusinessContext();
  if (!context.user) fail(401, "Sign in required.");
  if (!scope) fail(409, "Your account has changed.");
  if (getExperienceContext(context).scope !== scope) {
    const staff = await getStaffPortalIdentity();
    if (staff.context.user?.id !== context.user!.id || !staff.staff || getExperienceContext(staff.context).scope !== scope) fail(409, "Your account has changed.");
  }
  return current;
}
async function wire(response: Response): Promise<AppLocalHttpResponse> {
  const selected: Record<string, string> = {};
  for (const name of ["content-type", "cache-control", "etag", "server-timing"]) { const value = response.headers.get(name); if (value) selected[name] = value; }
  return { status: response.status, headers: selected, body: await response.text() };
}
export async function readAppLocalRoleHttpResource(name: string, args: Record<string, unknown> = {}, options: { scope?: string; etag?: string; signal?: AbortSignal } = {}): Promise<AppLocalRead<AppLocalHttpResponse> | null> {
  if (!Object.hasOwn(ROLE_READS, name)) return null;
  const rule = ROLE_READS[name as keyof typeof ROLE_READS], allowed: readonly string[] = rule.argumentKeys;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.entries(args).some(([key, value]) => !allowed.includes(key) || typeof value !== "string" || value.length > 512)) fail(400, "Unsupported application query");
  if (options.signal?.aborted) throw options.signal.reason;
  const current = await authorized(options.scope), url = new URL(rule.path, "https://reylumi.com"); url.search = new URLSearchParams(args as Record<string, string>).toString();
  const forwarded = new Headers(); if (current.get("cookie")) forwarded.set("cookie", current.get("cookie")!);
  const response = name === "http.staff.creation" ? await creationGET(new Request(url, { headers: forwarded, signal: options.signal })) : await preferencesGET();
  const result = await wire(response);
  if (options.signal?.aborted) throw options.signal.reason;
  // These control DTOs are never retained by native. Preserve their actual wire status/body.
  const etag = '"' + createHash("sha256").update(JSON.stringify([options.scope, name, args, result])).digest("hex") + '"';
  return { schemaVersion: 1, status: 200, scope: options.scope!, etag, updatedAt: Date.now(), data: result };
}
export async function runAppLocalRoleHttpCommand(name: string, args: Record<string, unknown>, request: Request, scope: string): Promise<{ handled: boolean; data?: AppLocalHttpResponse; status?: number }> {
  if (!Object.hasOwn(ROLE_COMMANDS, name)) return { handled: false };
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) fail(403, "Please open the form again.");
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => key !== "input") || !args.input || typeof args.input !== "object" || Array.isArray(args.input)) fail(400, "Invalid application request");
  const body = JSON.stringify(args.input); if (body.length > 64 * 1024) fail(413, "This request is too large.");
  const current = await authorized(scope), forwarded = new Headers({ "Content-Type": "application/json", Origin: origin });
  const cookie = request.headers.get("cookie") ?? current.get("cookie"); if (cookie) forwarded.set("cookie", cookie);
  const handlers = { "http.staff.create-appointment": creationPOST, "http.staff.report-no-show": noShowPOST, "http.staff.confirm-booking": confirmPOST, "http.staff.booking-preferences": staffPreferencesPOST, "http.notifications.preferences": preferencesPOST };
  const rule = ROLE_COMMANDS[name as keyof typeof ROLE_COMMANDS], handler = handlers[name as keyof typeof handlers];
  const result = await wire(await handler(new Request(new URL(rule.path, origin), { method: "POST", headers: forwarded, body })));
  return { handled: true, data: result, status: result.status };
}
