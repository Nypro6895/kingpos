import "server-only";
import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextRequest, type NextResponse } from "next/server";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { getCurrentStaffBusinessContext, isOwnerMembership, isSalonManageContext } from "./current-context";
import { getStaffPortalIdentity } from "./staff-portal-identity";
import { getSalonSwitcherProps } from "@/app/salon-switcher";
import { getAbuseNoticeData } from "@/components/abuse-notice";
import { vietnamesePluginState } from "./vietnamese-plugin";
import { advertisingClient } from "./explore-advertising";
import { ownerCampaignSettings } from "./owner-campaigns";
import { getWorkspacePendingSummary } from "./workspace-pending";
import { getWorkspaceTranslation } from "./workspace-language-server";
import { runReadWithDeadline } from "./bounded-get";
import { GET as sessionGET } from "@/app/(app)/api/auth/session/route";
import { POST as logoutPOST } from "@/app/(app)/api/auth/logout/route";
import { selectWorkspaceContext } from "@/lib/workspace-selection";
import { GET as bookingGET } from "@/app/api/public-booking/context/route";
import { GET as advertisingGET, POST as advertisingPOST } from "@/app/api/explore/advertising/route";
import { GET as campaignGET, POST as campaignPOST } from "@/app/api/campaigns/delivery/route";
import { APP_LOCAL_SHELL_READS } from "./app-local-shell-metadata";
import type { AppLocalShellConfiguration, AppLocalShellNavigation, AppLocalShellSummary, AppLocalShellNotice } from "./app-local-shell-metadata";
import type { AppLocalRead } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";

const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
async function authorized(scope?: string, prewriteBusiness?: Awaited<ReturnType<typeof getRequestBusinessContext>>) {
  const current = await headers();
  if (current.get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const business = prewriteBusiness ?? await getRequestBusinessContext();
  if (!scope) fail(409, "Your workspace has changed.");
  if (getExperienceContext(business).scope === scope) return { context: business, business, current };
  if (!business.user) fail(409, "Your workspace has changed.");
  // The context endpoint deliberately preserves the original MyWork/schedule
  // and workday staff fallbacks. A selected root workspace is not their scope.
  const alternatives = await Promise.allSettled([
    runReadWithDeadline(getStaffPortalIdentity().then(identity => identity.context), 12_000),
    runReadWithDeadline(getCurrentStaffBusinessContext(), 12_000),
  ]);
  for (const result of alternatives) if (result.status === "fulfilled" && result.value.user?.id === business.user!.id && getExperienceContext(result.value).scope === scope) return { context: result.value, business, current };
  if (alternatives.some(result => result.status === "rejected")) fail(503, "Please reconnect and try again.");
  return fail(409, "Your workspace has changed.");
}
function envelope<T>(scope: string, name: string, args: unknown, data: T, prior?: string): AppLocalRead<T> {
  const etag = '"' + createHash("sha256").update(JSON.stringify([scope, name, args, data])).digest("hex") + '"';
  return { schemaVersion: 1, status: prior === etag ? 304 : 200, scope, etag, updatedAt: Date.now(), ...(prior === etag ? {} : { data }) };
}
/** Only response cookies selected by the original handlers reach the real HTTPS
 * response cookie jar. Values are never serialized into the JavaScript DTO. */
async function applyCookies(response: Response) {
  const source = (response as NextResponse).cookies;
  if (!source?.getAll) return;
  const store = await cookies();
  for (const cookie of source.getAll()) store.set(cookie);
}
async function wire(response: Response): Promise<AppLocalHttpResponse> {
  await applyCookies(response);
  const selected: Record<string, string> = {};
  for (const key of ["content-type", "cache-control", "etag"]) { const value = response.headers.get(key); if (value) selected[key] = value; }
  return { status: response.status, headers: selected, body: await response.text() };
}
function forwarded(current: Headers, origin?: string) {
  const value = new Headers(); if (current.get("cookie")) value.set("cookie", current.get("cookie")!);
  if (origin) value.set("origin", origin);
  // Keep the original advertising/safety authority's trusted proxy inputs.
  for (const key of ["x-vercel-forwarded-for", "x-forwarded-for", "cf-connecting-ip", "user-agent"]) if (current.get(key)) value.set(key, current.get(key)!);
  return value;
}
async function configuration(context: Awaited<ReturnType<typeof getRequestBusinessContext>>, scope: string): Promise<AppLocalShellConfiguration> {
  const salonId = context.workspaceType === "salon" ? context.salonMode === "staff" ? context.currentStaffSalon?.id : context.currentSalon?.id : null;
  const language = (async () => {
    const plugin = salonId ? await runReadWithDeadline(vietnamesePluginState(salonId), 8_000) : null;
    return { enabled: Boolean(plugin?.active && (context.salonMode === "manage" || context.salonMode === "staff" && plugin.staff_enabled)), portableEnabled: Boolean(plugin?.active && plugin.portable_enabled), expiresAt: plugin ? [plugin.trial_ends_at, plugin.paid_until].filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null : null };
  })();
  const campaign = (async () => {
    if (!context.user || context.user.status !== "active" || context.currentAccount?.status !== "active" || !isSalonManageContext(context) || !isOwnerMembership(context.currentMembership) || context.currentSalon?.status !== "active") return { installed: false, runtime: null };
    // Deliberately select only display/runtime configuration. No wallet install,
    // credit allocation, billing action or payment credential is called here.
    const { data, error } = await runReadWithDeadline(Promise.resolve(advertisingClient().from("campaign_wallets").select("installed,available_credits").eq("salon_id", context.currentSalon.id).maybeSingle()), 6_000);
    if (error) throw error;
    if (!data?.installed) return { installed: false, runtime: null };
    const settings = await runReadWithDeadline(ownerCampaignSettings(), 6_000).catch(() => null);
    return { installed: true, runtime: settings ? { availableCredits: data.available_credits, scope: `${context.currentSalon.id}:${context.user.id}`, settings, location: { city: context.currentSalon.city ?? "", state: context.currentSalon.state ?? "", country: context.currentSalon.country } } : null };
  })().catch(() => ({ installed: false, runtime: null }));
  const [languageValue, campaignValue] = await Promise.all([language, campaign]);
  return { scope, language: languageValue, campaign: campaignValue };
}

export async function readAppLocalShellResource(name: string, args: Record<string, unknown> = {}, options: { scope?: string; etag?: string; signal?: AbortSignal } = {}): Promise<AppLocalRead<AppLocalShellNavigation | AppLocalShellConfiguration | AppLocalShellSummary | AppLocalShellNotice | AppLocalHttpResponse> | null> {
  const rule = APP_LOCAL_SHELL_READS.find(value => value.name === name); if (!rule) return null;
  const allowed: readonly string[] = rule.argumentKeys;
  if (Object.entries(args).some(([key, value]) => !allowed.includes(key) || typeof value !== "string" || value.length > 512)) fail(400, "Unsupported shell request.");
  if (options.signal?.aborted) throw options.signal.reason;
  const { context, current } = await authorized(options.scope); const scope = options.scope!;
  let data: AppLocalShellNavigation | AppLocalShellConfiguration | AppLocalShellSummary | AppLocalShellNotice | AppLocalHttpResponse;
  if (name === "shell.navigation") {
    data = { scope, authenticated: Boolean(context.user), navigation: await getSalonSwitcherProps(context), ownerQueueScope: isSalonManageContext(context) && context.currentSalon && context.user ? `owner:${context.currentSalon.id}:${context.user.id}` : null, audience: !context.user ? "guest" : context.workspaceType === "salon" ? context.salonMode === "staff" ? "staff" : "owner" : "personal" };
  } else if (name === "shell.configuration") data = await configuration(context, scope);
  else if (name === "shell.summary") {
    const [summary, translate] = await Promise.all([runReadWithDeadline(getWorkspacePendingSummary(context), 8_000), runReadWithDeadline(getWorkspaceTranslation(), 8_000)]);
    data = { scope, notificationScope: `${context.user?.id}:${context.currentWorkspace?.id ?? "personal"}`, summary: translate(summary) };
  }
  else if (name === "shell.notice") data = { scope, mode: await runReadWithDeadline(getAbuseNoticeData(context.user?.id ?? null), 6_000) };
  else if (name === "http.shell.campaigns") {
    const origin = "https://reylumi.com", url = new URL("/api/campaigns/delivery",origin);
    if (args.batch !== undefined && !["0","1"].includes(String(args.batch))) fail(400,"Invalid advertising request.");
    if (args.latitude !== undefined || args.longitude !== undefined) {
      if (typeof args.latitude !== "string" || !args.latitude.trim() || typeof args.longitude !== "string" || !args.longitude.trim()) fail(400,"Choose a valid location.");
      const next = new NextRequest(url,{method:"POST",headers:forwarded(current,origin),signal:options.signal,body:JSON.stringify({kind:"select",location:args.location ?? "",latitude:Number(args.latitude),longitude:Number(args.longitude),batch:args.batch === "1"})});
      data = await wire(await campaignPOST(next));
    } else {
      url.search = new URLSearchParams(args as Record<string,string>).toString();
      data = await wire(await campaignGET(new NextRequest(url,{headers:forwarded(current),signal:options.signal})));
    }
  }
  else {
    const path = name === "http.shell.session" ? "/api/auth/session" : name === "http.shell.quick-booking" ? "/api/public-booking/context" : "/api/explore/advertising";
    const url = new URL(path, "https://reylumi.com"); url.search = new URLSearchParams(args as Record<string, string>).toString();
    const request = new NextRequest(url, { headers: forwarded(current), signal: options.signal });
    data = await wire(await (name === "http.shell.session" ? sessionGET(request) : name === "http.shell.quick-booking" ? bookingGET(request) : advertisingGET(request)));
  }
  if (options.signal?.aborted) throw options.signal.reason;
  return envelope(scope, name, args, data, name.startsWith("http.") ? undefined : options.etag);
}

/** Explicit original handlers only. No generic URL, method, cookie or action is supplied by the caller. */
export async function runAppLocalShellCommand(name: string, args: Record<string, unknown>, request: Request, scope: string, prewriteBusiness?: Awaited<ReturnType<typeof getRequestBusinessContext>>): Promise<{ handled: boolean; data?: unknown }> {
  if (!["shell.switch-workspace", "shell.logout", "http.shell.advertising-event", "http.shell.campaign-event"].includes(name)) return { handled: false };
  // Only the workspace selector can reuse the command route's fresh prewrite
  // context. Never retain it or let another command borrow it after a write.
  const { context, business, current } = await authorized(scope, name === "shell.switch-workspace" ? prewriteBusiness : undefined), origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) fail(403, "Please open this page again.");
  if (name === "shell.switch-workspace") {
    if (!context.user) fail(401, "Please sign in again.");
    if (Object.keys(args).some(key => !["workspaceId", "destination"].includes(key)) || typeof args.workspaceId !== "string" || args.workspaceId.length > 160 || args.destination !== undefined && (typeof args.destination !== "string" || args.destination.length > 2048)) fail(400, "Choose a workspace.");
    const url = new URL("/workspace/open", origin); url.searchParams.set("workspace_id", String(args.workspaceId)); if (args.destination) url.searchParams.set("destination", String(args.destination));
    const result = await selectWorkspaceContext(business, url);
    if (!result.ok) return fail(result.status, result.error);
    const target = result.destination;
    return { handled: true, data: { path: target.pathname + target.search + target.hash } };
  }
  if (name === "shell.logout") {
    if (Object.keys(args).length) fail(400, "Invalid sign-out request.");
    return { handled: true, data: await wire(await logoutPOST()) };
  }
  if (Object.keys(args).some(key => key !== "input") || !args.input || typeof args.input !== "object" || Array.isArray(args.input) || JSON.stringify(args.input).length > 2048) fail(400, "Invalid advertising event.");
  if (name === "http.shell.campaign-event") {
    const input = args.input as Record<string,unknown>;
    if (!["view","click"].includes(String(input.kind)) || typeof input.ticket !== "string" || Object.keys(input).some(key => !["kind","ticket"].includes(key))) fail(400,"Invalid advertising event.");
    const next = new NextRequest(new URL("/api/campaigns/delivery",origin),{method:"POST",headers:forwarded(current,origin),body:JSON.stringify(input)});
    return {handled:true,data:await wire(await campaignPOST(next))};
  }
  const next = new NextRequest(new URL("/api/explore/advertising", origin), { method: "POST", headers: forwarded(current, origin), body: JSON.stringify(args.input) });
  return { handled: true, data: await wire(await advertisingPOST(next)) };
}
