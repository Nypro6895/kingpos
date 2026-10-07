import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Campaign } from "@/types/explore-advertising";
import { campaignActive } from "@/lib/explore-advertising-rules";
export function advertisingClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Advertising storage is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function getCampaigns(activeOnly = false): Promise<Campaign[]> {
  const { data, error } = await advertisingClient()
    .from("explore_campaigns")
    .select("config")
    .order("updated_at", { ascending: false });
  if (error)
    throw new Error(
      "Advertising storage is unavailable. Apply the advertising migration.",
    );
  const campaigns = (data ?? []).map((row) => row.config as Campaign);
  return activeOnly
    ? campaigns.filter((campaign) => campaignActive(campaign))
    : campaigns;
}
