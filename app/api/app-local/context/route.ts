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

export async function GET(request: Request) {
  return runWithReadContext(() => readContext(request));
}

async function readContext(request: Request) {
  await connection();
  const responseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") return Response.json({ error: "Please try again" }, { status: 503, headers: responseHeaders });
  const url = new URL(request.url), generation = url.searchParams.get("generation") ?? "";
  if (!/^[\w-]{16,100}$/.test(generation)) return Response.json({ error: "Invalid device generation" }, { status: 400, headers: responseHeaders });
  try {
    const display=await readAppLocalDisplayContext(url.searchParams.get("path")??"/market",generation,request.headers);
    if(display)return Response.json(display,{headers:responseHeaders});
    const device=await readAppLocalPortableContext(url.searchParams.get("path")??"/market",generation,request.headers);
    if(device)return Response.json(device,{headers:responseHeaders});
    const business = await getRequestBusinessContext();
    const requested = getExperienceOfflinePath(url.searchParams.get("path") ?? "/market", url.origin);
    // These are display leases from the existing authorization endpoint. They
    // never grant new permissions or substitute for a fresh command check.
    const path = requested ?? "/market";
    const selected = path.startsWith("/staff/") && !path.startsWith("/staff/today")
      ? path.startsWith("/staff/workday") ? await getCurrentStaffBusinessContext() : (await getStaffPortalIdentity()).context
      : business;
    if (selected.user?.id !== business.user?.id) return Response.json({ error: "Your account has changed" }, { status: 409, headers: responseHeaders });
    const context = getExperienceContext(selected);
    const leaseURL = new URL("/api/experience/offline-context", url.origin);
    leaseURL.searchParams.set("path", path); leaseURL.searchParams.set("generation", generation);
    const response = await offlineContext(new Request(leaseURL, { headers: request.headers }));
    const lease = await response.json().catch(() => null), grant = response.ok ? lease : null;
    return Response.json({ schemaVersion: 1, context, home:selected.user?selected.defaultRouteForCurrentContext:"/explore", grant, grantStatus: response.status, ...(lease?.offlineState === "unconfirmed" ? { offlineState: "unconfirmed" } : {}), display: { name: selected.user?.display_name ?? "", language: selected.user?.language ?? "en", role: selected.activeRole?.code ?? selected.salonRole ?? selected.accountRole ?? "guest" }, access: { ownerWorkspace: Boolean(selected.user && selected.currentSalon && isSalonManageContext(selected)), staffWorkspace: Boolean(selected.user && selected.currentSalon && selected.salonMode === "staff") }, onlineValidatedAt: Date.now() }, { headers: responseHeaders });
  } catch(error) { const status=error&&typeof error==="object"&&"status"in error&&[400,401,403,409].includes(Number(error.status))?Number(error.status):503;return Response.json({ error: "Connect to verify your account" }, { status, headers: responseHeaders }); }
}
