import "server-only";

import { cookies, headers } from "next/headers";
import { getCurrentPortablePosSession } from "@/app/pos/portable/actions";
import { GET as offlineContext } from "@/app/api/experience/offline-context/route";
import { getExperienceOfflinePath, isExperienceOfflineGrant } from "./experience-offline-policy";
import { APP_LOCAL_PORTABLE_ROUTES, type AppLocalPortableContext } from "./app-local-portable-metadata";
import type { PortablePosCapability } from "./pos-portable-capabilities";
import { runReadWithDeadline } from "./bounded-get";

function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** A device session is never replaced by an owner's account membership. */
export async function requireAppLocalPortableScope(scope: string, capability?: string) {
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") fail(503, "Please reconnect and try again.");
  const cookieStore = await cookies();
  if (!cookieStore.get("kingpos-portable-pos-key-id")?.value || !cookieStore.get("kingpos-portable-pos-session")?.value || cookieStore.get("kingpos-portable-local-lock")?.value === "1") fail(401, "Open Portable POS and enter its POS ID and passcode.");
  const session = await runReadWithDeadline(getCurrentPortablePosSession(), 12000);
  if (!session) fail(503, "This POS session could not be checked. Reconnect and try again.");
  if (!uuid.test(session.salon_id) || !uuid.test(session.key_id) || scope !== `${session.salon_id}:${session.key_id}` || cookieStore.get("kingpos-portable-pos-key-id")?.value !== session.key_id) fail(409, "The POS device changed. Open it again.");
  if (capability && !session.capabilities.includes(capability as PortablePosCapability)) fail(403, "This POS device does not have access to this view.");
  return session;
}

/** Fresh original cookie/RPC validation and the unchanged server-issued Portable lease. */
export async function readAppLocalPortableContext(path: string, generation: string, requestHeaders: Headers): Promise<AppLocalPortableContext | null> {
  const canonical = getExperienceOfflinePath(path, "https://reylumi.com");
  if (!canonical || !(APP_LOCAL_PORTABLE_ROUTES as readonly string[]).includes(canonical.split("?")[0])) return null;
  if (!/^[\w-]{16,100}$/.test(generation)) fail(400, "Invalid device generation.");
  const url = new URL("/api/experience/offline-context", "https://reylumi.com"); url.searchParams.set("path", canonical); url.searchParams.set("generation", generation);
  const response = await runReadWithDeadline(offlineContext(new Request(url, { headers: requestHeaders })), 15000);
  if (!response.ok) fail(response.status, response.status === 403 ? "This POS device does not have access to this view." : "Open Portable POS and check its access.");
  const grant = await response.json();
  if (!isExperienceOfflineGrant(grant, { path: canonical, generation }) || grant.kind !== "portable" || !grant.salonId || !uuid.test(grant.salonId) || !uuid.test(grant.workspaceId) || grant.scope !== `${grant.salonId}:${grant.workspaceId}`) fail(503, "POS access could not be checked.");
  const session = await requireAppLocalPortableScope(grant.scope);
  if (session.salon_id !== grant.salonId || session.key_id !== grant.workspaceId) fail(409, "The POS device changed. Open it again.");
  const store = await cookies(), now = Date.now();
  return { schemaVersion: 1, context: { scope: grant.scope, viewerId: grant.viewerId, workspaceId: grant.workspaceId, salonId: grant.salonId, permissionRevision: grant.grantRevision, authenticated: false },
    grant, grantStatus: 200, display: { name: session.salon_name, language: "en", role: "portable" }, onlineValidatedAt: now,
    portable: { scope: grant.scope, keyId: session.key_id, salonId: session.salon_id, salonName: session.salon_name, salonLogoUrl: session.salon_logo_url, timeZone: session.salon_timezone,
      capabilities: session.capabilities, touchKeyboardEnabled: session.touch_keyboard_enabled !== false, preparedAt: now, offlineEnabled: grant.localCommands === true, devicePrepared: Boolean(store.get("kingpos-workspace-device")?.value) } };
}
