import { withExperiencePage } from "@/components/experience-page";
import { campaignWalletAction } from "@/app/campaigns/credit-actions";
import { ownerCampaignSettings } from "@/lib/owner-campaigns";
import { redirect } from "next/navigation";
import { requireCampaignOwner } from "@/lib/owner-campaigns";
import { loadOwnerCampaignsAction } from "@/app/campaigns/actions";
import { CampaignWorkspace } from "@/app/campaigns/campaign-workspace";
import type { OwnerCampaign } from "@/types/owner-campaign";
async function CampaignsPage() {
  try { await requireCampaignOwner(false); } catch { redirect("/my-place"); }
  const wallet = await campaignWalletAction();
  if(!wallet.installed)redirect("/market");
  const settings = await ownerCampaignSettings();
  const owner = await requireCampaignOwner();
  let campaigns: OwnerCampaign[] = [];
  let message = "";
  try { campaigns = (await loadOwnerCampaignsAction()).campaigns; }
  catch (error) { message = error instanceof Error ? error.message : "Campaigns could not load."; }
  return <CampaignWorkspace wallet={wallet} settings={settings} location={{city:owner.context.currentSalon?.city ?? "",state:owner.context.currentSalon?.state ?? "",country:owner.context.currentSalon?.country ?? "United States"}} initialCampaigns={campaigns} initialError={message} />;
}

export default withExperiencePage(CampaignsPage);
