import { connection } from "next/server";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { getCurrentSalonProfileManageData, getPublicSalonProfileContentPage, isValidSalonProfileId } from "@/lib/salon-profile";
import { buildPreviewData } from "@/lib/salon-profile-preview";
import { loadSalonPostAttribution } from "@/lib/salon-post-attribution";
import { defaultSalonOperatingStatus } from "@/lib/salon-operating-status-core";
import { workspaceResourceResponse } from "@/lib/workspace-resource-response";

export async function GET(request: Request) {
  await connection();
  const fail = (status: number) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") return fail(503);
  const query = new URL(request.url).searchParams;
  const salonId = query.get("salonId") ?? "";
  const page = Number(query.get("page"));
  if (!isValidSalonProfileId(salonId) || !query.has("page") || !Number.isInteger(page) || page < 0 || page > 1000) return fail(400);
  try {
    const context = await getRequestBusinessContext();
    if (query.get("scope") !== getExperienceContext(context).scope) return fail(409);
    if (query.get("managed") === "1") {
      const ownSalon = context.salonMode === "staff" ? context.currentStaffSalon : context.currentSalon;
      if (!context.user || ownSalon?.id !== salonId) return fail(403);
      const data = await getCurrentSalonProfileManageData(context, page);
      if (!data.canViewProfile) return fail(403);
      const attribution = await loadSalonPostAttribution([...data.looks, ...data.updates].map(post => post.id));
      const preview = buildPreviewData({ ...data, attribution, accountId: context.accountId ?? "", operatingStatus: defaultSalonOperatingStatus() });
      return workspaceResourceResponse(request, { looks: preview.looks, updates: preview.updates, feed: preview.feed, contentPage: data.contentPage });
    }
    const content = await getPublicSalonProfileContentPage(salonId, page);
    return content ? workspaceResourceResponse(request, content) : fail(404);
  } catch {
    return fail(503);
  }
}
