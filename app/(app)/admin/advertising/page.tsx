import { withExperiencePage } from "@/components/experience-page";
import { DEFAULT_ADVERTISING_LIMITS } from "@/types/advertising-report";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import {
  getCampaigns,
  getAdvertisingLimits,
  getAdvertisingReport,
} from "@/lib/explore-advertising";
import { CampaignManager } from "./campaign-manager";
async function AdvertisingPage() {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.advertisingManage);
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [],
    error = "";
  try {
    campaigns = await getCampaigns();
  } catch (e) {
    error = e instanceof Error ? e.message : "Campaigns could not load.";
  }
  const results = await Promise.allSettled([
    getAdvertisingLimits(),
    getAdvertisingReport(),
  ]);
  const limits =
    results[0].status === "fulfilled"
      ? results[0].value
      : DEFAULT_ADVERTISING_LIMITS;
  const report = results[1].status === "fulfilled" ? results[1].value : [];
  for (const result of results)
    if (result.status === "rejected")
      error +=
        " " +
        (result.reason instanceof Error
          ? result.reason.message
          : "Insights unavailable.");
  return (
    <>
    <CampaignManager
      initialCampaigns={campaigns}
      error={error.trim()}
      report={report}
      limits={limits}
    />
    </>
  );
}

export default withExperiencePage(AdvertisingPage, { admin: true });