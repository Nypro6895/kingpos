import { NextResponse } from "next/server";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { EMPTY_SALON_SOCIAL, isSalonId, type SalonSocialState } from "@/lib/explore-social";

export async function GET(request: Request) {
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(","))];
  if (ids.length > 60 || !ids.every(isSalonId)) return NextResponse.json({ error: "Invalid salons." }, { status: 400 });
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) return NextResponse.json({ states: {} }, { headers: { "Cache-Control": "private, no-store" } });
  const actor = await client.rpc("current_public_user_id");
  if (actor.error || !actor.data) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const [preferences, follows] = await Promise.all([
    client.from("explore_salon_preferences").select("salon_id,loved,saved,hidden").eq("user_id", actor.data).in("salon_id", ids),
    client.from("salon_profile_follows").select("salon_id").eq("user_id", actor.data).in("salon_id", ids),
  ]);
  if (preferences.error || follows.error) return NextResponse.json({ error: "Preferences could not be loaded." }, { status: 503 });
  const states: Record<string, SalonSocialState> = Object.fromEntries(ids.map(id => [id, { ...EMPTY_SALON_SOCIAL }]));
  for (const row of preferences.data ?? []) states[row.salon_id] = { ...states[row.salon_id], loved: row.loved, saved: row.saved, hidden: row.hidden };
  for (const row of follows.data ?? []) states[row.salon_id].following = true;
  return NextResponse.json({ states }, { headers: { "Cache-Control": "private, no-store" } });
}
