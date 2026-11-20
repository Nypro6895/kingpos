import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rewardDiscoveryArea } from "@/lib/reward-discovery-area";
import { rewardDiscoveryKind, rewardDiscoveryPoint, rewardDiscoveryRadius } from "@/lib/reward-discovery";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const headers = { "Cache-Control": "no-store" };
  const point = rewardDiscoveryPoint(q.get("lat"), q.get("lon"));
  if ((q.has("lat") || q.has("lon")) && !point) return Response.json({ error: "Choose a valid location." }, { status: 400, headers });
  const db = createSupabaseServerClient();
  if (!db) return Response.json({ error: "Rewards could not be loaded." }, { status: 503, headers });
  try {
    const area = point ? null : rewardDiscoveryArea(q.get("location") ?? "");
    if (!point && !area) return Response.json({ salons: [], hasMore: false, needsArea: true }, { headers });
    const result = await db.rpc("reward_discover", {
      p_lat: point?.latitude ?? null, p_lon: point?.longitude ?? null,
      p_city: area?.city || null, p_state: area?.state || null, p_postal: area?.postal || null,
      p_country: area?.country || "US", p_category: (q.get("category") ?? "").slice(0, 80),
      p_kind: rewardDiscoveryKind(q.get("kind")), p_radius_miles: rewardDiscoveryRadius(q.get("radius")),
    });
    if (result.error) throw result.error;
    return Response.json({ ...result.data, areaLabel: area?.label }, { headers });
  } catch {
    return Response.json({ error: "Rewards could not be loaded. Try again." }, { status: 503, headers });
  }
}
