import { connection } from "next/server";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { getCurrentSalonProfileManageData, getPublicSalonProfileContentPage, isValidSalonProfileId } from "@/lib/salon-profile";
import { buildPreviewData } from "@/lib/salon-profile-preview";
import { loadSalonPostAttribution } from "@/lib/salon-post-attribution";
import { defaultSalonOperatingStatus } from "@/lib/salon-operating-status-core";
import { workspaceResourceResponse } from "@/lib/workspace-resource-response";
import { createReadRequestTiming } from "@/lib/read-request-timing";

export async function GET(request: Request) {
  await connection();
  const timing = createReadRequestTiming();
  const fail = (status: number) => timing.finish(new Response(null, { status, headers: { "Cache-Control": "private, no-store" } }));
  if ((await timing.measure("auth", () => headers())).get("x-reylumi-auth-unavailable") === "1") return fail(503);
  const query = new URL(request.url).searchParams;
  const salonId = query.get("salonId") ?? "";
  const page = Number(query.get("page"));
  if (!isValidSalonProfileId(salonId) || !query.has("page") || !Number.isInteger(page) || page < 0 || page > 1000) return fail(400);
  try {
    const context = await timing.measure("auth", () => getRequestBusinessContext());
    if (query.get("scope") !== getExperienceContext(context).scope) return fail(409);
    if (query.get("managed") === "1") {
      const ownSalon = context.salonMode === "staff" ? context.currentStaffSalon : context.currentSalon;
      if (!context.user || ownSalon?.id !== salonId) return fail(403);
      const data = await timing.measure("load", () => getCurrentSalonProfileManageData(context, page));
      if (!data.canViewProfile) return fail(403);
      const attribution = await timing.measure("load", () => loadSalonPostAttribution([...data.looks, ...data.updates].map(post => post.id)));
      const preview = timing.measureSync("load", () => buildPreviewData({ ...data, attribution, accountId: context.accountId ?? "", operatingStatus: defaultSalonOperatingStatus() }));
      return workspaceResourceResponse(request, { looks: preview.looks, updates: preview.updates, feed: preview.feed, contentPage: data.contentPage }, timing);
    }
    const content = await timing.measure("load", () => getPublicSalonProfileContentPage(salonId, page));
    return content ? workspaceResourceResponse(request, content, timing) : fail(404);
  } catch {
    return fail(503);
  }
}
