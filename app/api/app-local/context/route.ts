import { observeAppLocalRead } from "@/lib/app-local-read-observation";
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
import { APP_LOCAL_PORTABLE_ROUTES } from "@/lib/app-local-portable-metadata";
import { runWithReadContext } from "@/lib/read-context-scope";
import { createReadRequestTiming, type ReadRequestTiming } from "@/lib/read-request-timing";
import { getStaffOnlineOnlyAccess } from "@/lib/staff-online-access-server";
import { newReadRequestId } from "@/lib/read-request-trace-protocol";

export async function GET(request: Request) {
  const timing = createReadRequestTiming(undefined,newReadRequestId(request.headers));
  const response = await runWithReadContext(() => readContext(request, timing), timing);
  return observeAppLocalRead(response, new URL(request.url).searchParams.get("path") === "/" ? "context.root" : "context.route");
}

async function readContext(request: Request, timing: ReadRequestTiming) {
  await connection();
  const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Reylumi-Compute-Region": process.env.VERCEL_REGION ?? "local" };
  const json = (data: unknown, init: ResponseInit) => timing.finish(timing.measureSync("serialize", () => Response.json(data, init)));
  if ((await timing.measure("auth", () => headers())).get("x-reylumi-auth-unavailable") === "1") return json({ error: "Please try again" }, { status: 503, headers: responseHeaders });
  const url = new URL(request.url), generation = url.searchParams.get("generation") ?? "";
  if (!timing.measureSync("validate", () => /^[\w-]{16,100}$/.test(generation))) return json({ error: "Invalid device generation" }, { status: 400, headers: responseHeaders });
  try {
    const requestedPath=url.searchParams.get("path")??"/market";
    // Device handlers keep their original gates; ordinary phone startup need
    // not initialize their POS commands, relay and pairing dependencies.
    if(requestedPath==="/pos/customer-display") {
      const {readAppLocalDisplayContext}=await import("@/lib/app-local-display-server");
      const display=await timing.measure("validate",()=>readAppLocalDisplayContext(requestedPath,generation,request.headers));
      if(display)return json(display,{headers:responseHeaders});
    }
    const portablePath=getExperienceOfflinePath(requestedPath,"https://reylumi.com");
    if(portablePath && (APP_LOCAL_PORTABLE_ROUTES as readonly string[]).includes(portablePath.split("?")[0])) {
      const {readAppLocalPortableContext}=await import("@/lib/app-local-portable-context-server");
      const device=await timing.measure("validate",()=>readAppLocalPortableContext(requestedPath,generation,request.headers));
      if(device)return json(device,{headers:responseHeaders});
    }
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
    const result: AppLocalContext = { schemaVersion: 1, workspaceHandoffVersion: 2, getterAdmissionVersion: 1, context, home:selected.user?selected.defaultRouteForCurrentContext:"/explore", grant, grantStatus: response.status, ...(staffOnlineAccess ? { offlineState: "online-only", staffOnlineAccess } : lease?.offlineState === "unconfirmed" ? { offlineState: "unconfirmed" } : {}), display: { name: selected.user?.display_name ?? "", language: selected.user?.language ?? "en", role: selected.activeRole?.code ?? selected.salonRole ?? selected.accountRole ?? "guest" }, access: { ownerWorkspace: Boolean(selected.user && selected.currentSalon && isSalonManageContext(selected)), staffWorkspace: Boolean(selected.user && selected.currentSalon && selected.salonMode === "staff") }, onlineValidatedAt: Date.now() };
    if(request.headers.get("X-Reylumi-Initial-Data") === "1") {
      try {
        if(url.searchParams.get("path") === "/" && result.home && result.home !== "/" && selected.user && ![401,403,409].includes(result.grantStatus ?? 0) && result.offlineState !== "unconfirmed") {
          const targetURL = new URL(url);targetURL.searchParams.set("path",result.home);
          const target = await GET(new Request(targetURL,{headers:request.headers}));
          if(target.ok) result.homeAdmission = await target.json();
        } else result.bootstrap = await readAppLocalBootstrap(result,validatedInitialPath(url,path),async (name,args,scope) => {
          if(name==="shell.navigation") {
            const {readAppLocalShellResource}=await import("@/lib/app-local-shell-server");
            return readAppLocalShellResource(name,args,{scope,signal:request.signal});
          }
          const {GET:readInitial} = await import("@/app/api/app-local/read/route");
          const resourceURL = new URL("/api/app-local/read",url.origin);
          resourceURL.search = new URLSearchParams({name,scope,args:JSON.stringify(args)}).toString();
          const resource = await readInitial(new Request(resourceURL,{headers:request.headers}));
          return resource.ok ? await resource.json() : null;
        });
      } catch { /* Admission stands; page readers retain their own retry and denial gates. */ }
    }
    return json(result, {headers:responseHeaders});
  } catch(error) { const status=error&&typeof error==="object"&&"status"in error&&[400,401,403,409].includes(Number(error.status))?Number(error.status):503;return json({ error: "Connect to verify your account" }, { status, headers: responseHeaders }); }
}

// Filters select initial DTO arguments only; authority always uses the original path.
function validatedInitialPath(url:URL,fallback:string) {
 const authorityPath=url.searchParams.get("path") ?? fallback;
 const initial=url.searchParams.get("initialPath");
 if(!initial || initial.length>2048 || !initial.startsWith("/") || initial.startsWith("//") || /[\\\u0000-\u001f]/.test(initial))return authorityPath;
 try {const candidate=new URL(initial,url.origin),authority=new URL(authorityPath,url.origin);return candidate.origin===url.origin && candidate.pathname===authority.pathname && !candidate.hash ? candidate.pathname+candidate.search : authorityPath;}catch{return authorityPath;}
}
