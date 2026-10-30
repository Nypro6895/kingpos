import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat")), lon = Number(request.nextUrl.searchParams.get("lon"));
  if (!request.nextUrl.searchParams.has("lat") || !request.nextUrl.searchParams.has("lon") || !Number.isFinite(lat) || !Number.isFinite(lon)) return Response.json([], { status: 400 });
  const db = createSupabaseServerClient();
  const result = await db?.rpc("reward_nearby", { p_lat: lat, p_lon: lon });
  return Response.json(result?.error ? [] : result?.data ?? [], { headers: { "Cache-Control": "private, max-age=60" } });
}
