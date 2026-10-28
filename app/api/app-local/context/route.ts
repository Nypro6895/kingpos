import { readAppLocalBootstrap } from "@/lib/app-local-bootstrap-server";
import type { AppLocalContext } from "@/lib/app-local-host";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { getExperienceOfflinePath } from "@/lib/experience-offline-policy";
import { GET as offlineContext } from "@/app/api/experience/offline-context/route";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { getCurrentStaffBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { readAppLocalPortableContext } from "@/lib/app-local-portable-context-server";
import { readAppLocalDisplayContext } from "@/lib/app-local-display-server";
import { runWithReadContext } from "@/lib/read-context-scope";
import { createReadRequestTiming, type ReadRequestTiming } from "@/lib/read-request-timing";
import { getStaffOnlineOnlyAccess } from "@/lib/staff-online-access-server";
import { newReadRequestId } from "@/lib/read-request-trace-protocol";

export async function GET(request: Request) {
  const timing = createReadRequestTiming(undefined,newReadRequestId(request.headers));
  return runWithReadContext(() => readContext(request, timing), timing);
}

async function readContext(request: Request, timing: ReadRequestTiming) {
  await connection();
  const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  const json = (data: unknown, init: ResponseInit) => timing.finish(timing.measureSync("serialize", () => Response.json(data, init)));
  if ((await timing.measure("auth", () => headers())).get("x-reylumi-auth-unavailable") === "1") return json({ error: "Please try again" }, { status: 503, headers: responseHeaders });
  const url = new URL(request.url), generation = url.searchParams.get("generation") ?? "";
  if (!timing.measureSync("validate", () => /^[\w-]{16,100}$/.test(generation))) return json({ error: "Invalid device generation" }, { status: 400, headers: responseHeaders });
  try {
    const display=await timing.measure("validate", () => readAppLocalDisplayContext(url.searchParams.get("path")??"/market",generation,request.headers));
    if(display)return json(display,{headers:responseHeaders});
    const device=await timing.measure("validate", () => readAppLocalPortableContext(url.searchParams.get("path")??"/market",generation,request.headers));
    if(device)return json(device,{headers:responseHeaders});
    const business = await timing.measure("auth", () => getRequestBusinessContext());
    const requested = getExperienceOfflinePath(url.searchParams.get("path") ?? "/market", url.origin);
    // These are display leases from the existing authorization endpoint. They
    // never grant new permissions or substitute for a fresh command check.
    const path = requested ?? "/market";
    const selected = path.startsWith("/staff/") && !path.startsWith("/staff/today")
      ? path.startsWith("/staff/workday") ? await timing.measure("auth", () => getCurrentStaffBusinessContext()) : (await timing.measure("auth", () => getStaffPortalIdentity())).context
      : business;
    if (selected.user?.id !== business.user?.id) return json({ error: "Your account has changed" }, { status: 409, headers: responseHeaders });
    const context = getExperienceContext(selected);
    const leaseURL = new URL("/api/experience/offline-context", url.origin);
    leaseURL.searchParams.set("path", path); leaseURL.searchParams.set("generation", generation);
    const { response, lease } = await timing.measure("lease", async () => {
      const response = await offlineContext(new Request(leaseURL, { headers: request.headers }));
      return { response, lease: await response.json().catch(() => null) };
    });
    const grant = response.ok ? lease : null;
    let staffOnlineAccess: Awaited<ReturnType<typeof getStaffOnlineOnlyAccess>> = null;
    if (/^\/staff\/(?:my-work|workday|appointments)(?:\?|$)/.test(path)
      && response.status === 503 && lease?.offlineState === "unconfirmed"
      && request.headers.get("X-Reylumi-Staff-Online-Access") === "1") {
      try {
        const identity = await timing.measure("auth", () => getStaffPortalIdentity(selected));
        if (getExperienceContext(identity.context).scope === context.scope) {
          staffOnlineAccess = await timing.measure("auth", () => getStaffOnlineOnlyAccess({ context: selected, staff: identity.staff }));
        }
      } catch (error) {
        const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
        if ([401, 403, 409].includes(status)) throw error;
        // This optional proof must not erase an already verified offline denial.
        // A generic outage retains unconfirmed so old Staff disk authority is
        // withdrawn instead of being treated as an ordinary lease-service503.
      }
    }
    const result: AppLocalContext = { schemaVersion: 1, workspaceHandoffVersion: 2, context, home:selected.user?selected.defaultRouteForCurrentContext:"/explore", grant, grantStatus: response.status, ...(staffOnlineAccess ? { offlineState: "online-only", staffOnlineAccess } : lease?.offlineState === "unconfirmed" ? { offlineState: "unconfirmed" } : {}), display: { name: selected.user?.display_name ?? "", language: selected.user?.language ?? "en", role: selected.activeRole?.code ?? selected.salonRole ?? selected.accountRole ?? "guest" }, access: { ownerWorkspace: Boolean(selected.user && selected.currentSalon && isSalonManageContext(selected)), staffWorkspace: Boolean(selected.user && selected.currentSalon && selected.salonMode === "staff") }, onlineValidatedAt: Date.now() };
    if(request.headers.get("X-Reylumi-Initial-Data") === "1") {
      try { result.bootstrap = await readAppLocalBootstrap(result,path); } catch { /* Admission stands; page readers retain their own retry and denial gates. */ }
    }
    return json(result, {headers:responseHeaders});
  } catch(error) { const status=error&&typeof error==="object"&&"status"in error&&[400,401,403,409].includes(Number(error.status))?Number(error.status):503;return json({ error: "Connect to verify your account" }, { status, headers: responseHeaders }); }
}
