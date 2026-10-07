import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { getCampaigns } from "@/lib/explore-advertising";
import { CampaignManager } from "./campaign-manager";
export default async function AdvertisingPage() {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.businessesUpdate);
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [],
    error = "";
  try {
    campaigns = await getCampaigns();
  } catch (e) {
    error = e instanceof Error ? e.message : "Campaigns could not load.";
  }
  return <CampaignManager initialCampaigns={campaigns} error={error} />;
}
