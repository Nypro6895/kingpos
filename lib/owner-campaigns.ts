import "server-only";
import { advertisingClient } from "@/lib/explore-advertising";
import { normalizeOwnerCampaignSettings } from "@/lib/owner-campaign-rules";
import { getCurrentBusinessContext, isOwnerMembership, isSalonManageContext } from "@/lib/current-context";

export async function requireCampaignOwner(requireInstalled = true) {
  const context = await getCurrentBusinessContext();
  if (!context.user || context.user.status !== "active" || context.currentAccount?.status !== "active" || !context.currentSalon || !isSalonManageContext(context) || !isOwnerMembership(context.currentMembership) || context.currentSalon.status !== "active") throw new Error("Switch to your owner workspace to manage campaigns.");
  const client = advertisingClient();
  if (requireInstalled) {
    const {data,error} = await client.rpc("campaign_plugin_installed",{p_salon:context.currentSalon.id});
    if(error || !data) throw new Error("Add Campaigns from Market to get started.");
  }
  return { context, client, salonId: context.currentSalon.id, userId: context.user.id };
}
export async function ownerCampaignSettings() {
  const { data, error } = await advertisingClient().from("owner_campaign_settings").select("config").eq("id", true).single();
  if (error) throw new Error("Campaigns are being prepared. Please try again later.");
  return normalizeOwnerCampaignSettings(data.config);
}
