import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { loadMarketExperienceData } from "@/lib/market-experience-data";
import { createLiveResourceSnapshot, liveResourceResponse } from "@/lib/experience-live-resource-server";
import { connection } from "next/server";
import { headers as requestHeaders } from "next/headers";

export async function GET(request: Request) {
  await connection();
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    if ((await requestHeaders()).get("x-reylumi-auth-unavailable") === "1") {
      return Response.json({ error: "Authentication temporarily unavailable" }, { status: 503, headers });
    }
    const context = await getRequestBusinessContext();
    if (new URL(request.url).searchParams.get("scope") !== getExperienceContext(context).scope) {
      return Response.json({ error: "Workspace changed" }, { status: 409, headers });
    }
    const data = await loadMarketExperienceData(context);
    if (data.pluginLoadError) return Response.json({ error: "Temporarily unavailable" }, { status: 503, headers });
    return liveResourceResponse(request, createLiveResourceSnapshot(data));
  } catch {
    return Response.json({ error: "Temporarily unavailable" }, { status: 503, headers });
  }
}
