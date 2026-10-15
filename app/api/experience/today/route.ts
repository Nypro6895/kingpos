import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { getExperienceContext } from "@/lib/experience-context";
import { createLiveResourceSnapshot, liveResourceResponse } from "@/lib/experience-live-resource-server";
import { getTodayDashboard } from "@/lib/today-dashboard";
import { connection } from "next/server";
import { headers } from "next/headers";

const failure = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  await connection();
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") return failure("Authentication temporarily unavailable", 503);
  const context = await getCurrentBusinessContext();
  if (!context.user) return failure("Unauthorized", 401);
  if (!isSalonManageContext(context) || !context.currentBusiness || !context.currentAccount || !context.currentSalon) {
    return failure("Forbidden", 403);
  }
  const query = new URL(request.url).searchParams;
  if (query.get("scope") !== getExperienceContext(context).scope) {
    return failure("Workspace changed", 409);
  }
  const date = query.get("date") ?? undefined;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return failure("Invalid date", 400);
  }
  try {
    const dashboard = await getTodayDashboard(context, { date });
    if (dashboard.noAccess) return failure("Forbidden", 403);
    // An upstream failure must not replace a retained section with an empty
    // fallback. A subsequent workspace event or poll retries silently.
    if (dashboard.loadErrors.length) return failure("Temporarily unavailable", 503);
    return liveResourceResponse(request, createLiveResourceSnapshot(dashboard, ["generatedAt"]));
  } catch (error) {
    console.error("Today resource load failed", error);
    return failure("Temporarily unavailable", 503);
  }
}
