import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { isSalonManageContext } from "./current-context";
import { hasPermission } from "./permissions";
import { POS_TICKET_PERMISSIONS } from "./pos-tickets";
import { getOrCreatePosLiveDraft, getPosLiveDraft, getCustomerDisplayServiceCatalog } from "@/app/pos/actions";
import { getCurrentPortablePosSession, getPortablePosDeskData } from "@/app/pos/portable/actions";
import { getPublicPosDisplaySettingsByToken } from "./pos-settings";
import { readAppLocalPortableContext, requireAppLocalPortableScope } from "./app-local-portable-context-server";
import { GET as offlineContext } from "@/app/api/experience/offline-context/route";
import { GET as settingsGET } from "@/app/api/pos/customer-display/settings/route";
import { GET as entryGET } from "@/app/api/service-relay/entry/route";
import { isExperienceOfflineGrant } from "./experience-offline-policy";
import { runReadWithDeadline } from "./bounded-get";
import { APP_LOCAL_DISPLAY_READS, APP_LOCAL_DISPLAY_ACTIONS, type AppLocalDisplayContext } from "./app-local-display-metadata";
import type { AppLocalRead } from "./app-local-host";

function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
const deviceScope = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function check(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
async function ownerAllowed(context: Awaited<ReturnType<typeof getRequestBusinessContext>>) {
  return Boolean(context.user && context.currentSalon && isSalonManageContext(context) && await hasPermission(POS_TICKET_PERMISSIONS.manage, context));
}
async function ownerContext(scope: string) {
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const context = await runReadWithDeadline(getRequestBusinessContext(), 12000);
  if (!context.user) fail(401, "Please sign in again.");
  if (!scope || getExperienceContext(context).scope !== scope) fail(409, "Your workspace changed. Open the display again.");
  if (!await ownerAllowed(context)) fail(403, "Open the display from your POS workspace.");
  return context;
}

/** Match the original page's owner-first, paired-device-second, public-default resolution. */
export async function readAppLocalDisplayContext(path: string, generation: string, requestHeaders: Headers): Promise<AppLocalDisplayContext | null> {
  if (path !== "/pos/customer-display") return null;
  if (!/^[\w-]{16,100}$/.test(generation)) fail(400, "Invalid device generation.");
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const business = await runReadWithDeadline(getRequestBusinessContext(), 12000), owner = await ownerAllowed(business);
  if (!owner && await runReadWithDeadline(getCurrentPortablePosSession(), 12000)) {
    const portable = await readAppLocalPortableContext("/pos/portable", generation, requestHeaders);
    if (!portable) fail(503, "This display could not be paired.");
    return { ...portable!, displayAuthority: { kind: "portable" } };
  }
  const context = getExperienceContext(business), url = new URL("/api/experience/offline-context", "https://reylumi.com"); url.searchParams.set("path", "/market"); url.searchParams.set("generation", generation);
  const response = await runReadWithDeadline(offlineContext(new Request(url, { headers: requestHeaders })), 15000), candidate = await response.json();
  const grant = response.ok && isExperienceOfflineGrant(candidate, { scope: context.scope, generation, path: "/market" }) ? candidate : null;
  return { schemaVersion: 1, context, grant, grantStatus: response.status, displayAuthority: { kind: owner ? "owner" : "public" },
    display: { name: business.user?.display_name ?? "", language: business.user?.language ?? "en", role: business.activeRole?.code ?? business.salonRole ?? business.accountRole ?? "guest" },
    onlineValidatedAt: Date.now() };
}

async function portableDraft(scope: string) {
  const session = await requireAppLocalPortableScope(scope, "portable.pos.use"), data = await runReadWithDeadline(getPortablePosDeskData(), 20000);
  if (data.salonId !== session.salon_id || data.liveDraft?.salon_id !== session.salon_id || !data.liveDraft?.token) fail(409, "The paired display changed. Open it from POS again.");
  return data.liveDraft!;
}
/** A paired capability never authorizes another device/salon's customer data. */
export async function requireAppLocalDisplayToken(scope: string, token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{32}$/i.test(token)) fail(400, "Open the display from POS again.");
  if (deviceScope.test(scope)) {
    const draft = await portableDraft(scope); if (draft.token !== token) fail(409, "The paired display changed. Open it from POS again.");
  } else {
    const context = await ownerContext(scope), draft = await runReadWithDeadline(getPosLiveDraft(token), 15000);
    if (!draft.ok || !draft.data || draft.data.salon_id !== context.currentSalon!.id) fail(403, "This display belongs to another POS workspace.");
  }
}
const pairedCommands = new Map(APP_LOCAL_DISPLAY_ACTIONS.map(action => ["action." + createHash("sha256").update(action.module + "#" + action.export).digest("hex").slice(0, 24), action]));
export async function authorizeAppLocalDisplayCommand(name: string, values: unknown[], scope: string): Promise<boolean> {
  const action = pairedCommands.get(name); if (!action) return false;
  const token = action.tokenArgument === "first" ? values[0] : values[0] && typeof values[0] === "object" ? (values[0] as { token?: unknown }).token : undefined;
  await requireAppLocalDisplayToken(scope, token); return true;
}

export async function readAppLocalDisplayResource(name: string, args: Record<string, unknown> = {}, options: { scope: string; etag?: string; signal?: AbortSignal }): Promise<AppLocalRead | null> {
  if (!Object.hasOwn(APP_LOCAL_DISPLAY_READS, name)) return null;
  const rule = APP_LOCAL_DISPLAY_READS[name as keyof typeof APP_LOCAL_DISPLAY_READS], allowed: readonly string[] = rule.argumentKeys;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.entries(args).some(([key, value]) => !allowed.includes(key) || typeof value !== "string" || value.length > 256)) fail(400, "Invalid display request.");
  check(options.signal);
  let data: unknown;
  if (name.startsWith("display.http.")) {
    await requireAppLocalDisplayToken(options.scope, args.token);
    const url = new URL(name === "display.http.settings" ? "/api/pos/customer-display/settings" : "/api/service-relay/entry", "https://reylumi.com"); url.searchParams.set("token", String(args.token));
    const response = await (name === "display.http.settings" ? settingsGET : entryGET)(new Request(url, { signal: options.signal }));
    data = { status: response.status, body: await response.text(), headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": response.headers.get("cache-control") ?? "private, no-store" } };
  } else {
    let token: string, draftId: string;
    if (name === "portable.customer-display-settings") { const draft = await portableDraft(options.scope); token = draft.token; draftId = draft.id; }
    else {
      const context = await ownerContext(options.scope), result = await runReadWithDeadline(getOrCreatePosLiveDraft(), 20000);
      if (!result.ok) fail(503, result.error);
      if (result.data.salon_id !== context.currentSalon!.id) fail(409, "Your workspace changed. Open the display again.");
      token = result.data.token; draftId = result.data.id;
    }
    const [settings, serviceCatalog] = await runReadWithDeadline(Promise.all([getPublicPosDisplaySettingsByToken(token), getCustomerDisplayServiceCatalog(token)]), 15000);
    data = name === "portable.customer-display-settings" ? { settings, serviceCatalog, draftId } : { settings, serviceCatalog, token };
  }
  check(options.signal);
  const etag = '"' + createHash("sha256").update(JSON.stringify([options.scope, name, args, data])).digest("hex") + '"';
  return { schemaVersion: 1, status: options.etag === etag && !name.startsWith("display.http.") ? 304 : 200, scope: options.scope, etag, updatedAt: Date.now(), ...(options.etag === etag && !name.startsWith("display.http.") ? {} : { data }) };
}
