import { getExperienceContext } from "@/lib/experience-context";
import { createLiveResourceSnapshot, liveResourceResponse } from "@/lib/experience-live-resource-server";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { loadStaffMyWorkResource } from "@/lib/staff-my-work-resource-server";
import { connection } from "next/server";
import { headers } from "next/headers";

const failure = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  await connection();
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") return failure("Authentication temporarily unavailable", 503);
  try {
    const identity = await getStaffPortalIdentity();
    if (!identity.context.user) return failure("Unauthorized", 401);
    if (!identity.context.currentSalon || !identity.context.currentAccount || !identity.staff) return failure("Forbidden", 403);
    const query = new URL(request.url).searchParams;
    if (query.get("scope") !== getExperienceContext(identity.context).scope) return failure("Workspace changed", 409);
    if (query.get("staffId") !== identity.staff.id) return failure("Staff profile changed", 409);
    const tab = query.get("tab") ?? "daily";
    if (!["daily", "payroll", "analysis"].includes(tab)) return failure("Invalid tab", 400);
    const payPeriodStart = query.get("payPeriodStart") ?? undefined;
    if (payPeriodStart && !/^\d{4}-\d{2}-\d{2}(?::\d{4}-\d{2}-\d{2})?$/.test(payPeriodStart)) return failure("Invalid pay period", 400);
    const data = await loadStaffMyWorkResource(identity, { tab, payPeriodStart });
    if ((tab === "payroll" && !data.payrollData) || (tab === "analysis" && !data.analysisData)) return failure("Temporarily unavailable", 503);
    return liveResourceResponse(request, createLiveResourceSnapshot(data, ["generatedAt"]));
  } catch (error) {
    console.error("My Work resource load failed", error);
    return failure("Temporarily unavailable", 503);
  }
}
