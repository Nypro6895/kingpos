import { withExperiencePage } from "@/components/experience-page";
import { campaignWalletAction } from "@/app/campaigns/credit-actions";
import { ownerCampaignSettings } from "@/lib/owner-campaigns";
import { redirect } from "next/navigation";
import { requireCampaignOwner } from "@/lib/owner-campaigns";
import { loadOwnerCampaignsAction } from "@/app/campaigns/actions";
import { CampaignWorkspace } from "@/app/campaigns/campaign-workspace";
import { CampaignActivation, CampaignLoadError } from "@/app/campaigns/campaign-entry";
import { completeCampaignCardAction } from "@/app/campaigns/credit-actions";
import { getCurrentBusinessContext, isOwnerMembership, isSalonManageContext } from "@/lib/current-context";
import { confirmCampaignCheckout, cancelCampaignCheckout } from "@/lib/campaign-payments";
import type { OwnerCampaign } from "@/types/owner-campaign";
async function CampaignsPage({ searchParams }: { searchParams: Promise<CampaignQuery> }) {
  const context=await getCurrentBusinessContext();
  if(!context.user)redirect("/login?next=/campaigns");
  if(!isSalonManageContext(context)||!isOwnerMembership(context.currentMembership))redirect("/my-place");
  const data=await loadCampaignPage(await searchParams);
  if(data.kind==="failed")return <CampaignLoadError/>;
  if(data.kind==="inactive")return <CampaignActivation/>;
  return <CampaignWorkspace {...data.props}/>;
}

type CampaignQuery = { tab?: string; credits?: string; payment?: string; card_session?: string; card?: string; credit_session?: string; credit_order?: string };
async function loadCampaignPage(query: CampaignQuery): Promise<{kind:"failed"}|{kind:"inactive"}|{kind:"ready";props:Parameters<typeof CampaignWorkspace>[0]}> {
  try {
    let message="";
    if(query.card_session){try{await completeCampaignCardAction(query.card_session);message="Card saved. Automatic purchases remain off until you enable them.";}catch{message="Your card setup could not be confirmed. Check Payment method before trying again.";}}
    if(query.card==="cancelled")message="Card setup was cancelled. Your campaigns and existing credits are unchanged.";
    if(query.payment==="cancelled"&&query.credit_order){try{const cancelled=await cancelCampaignCheckout(await requireCampaignOwner(false),query.credit_order);message=cancelled?"Payment was cancelled. Your campaigns and existing credits are unchanged.":"This payment has already been processed. Review your credit balance.";}catch{message="Payment cancellation is being checked. Review payment methods before retrying.";}}
    if(query.payment==="received"){try{const confirmed=query.credit_session&&await confirmCampaignCheckout(await requireCampaignOwner(false),query.credit_session);message=confirmed?"Your purchased credits are ready to use.":"Checking your credit purchase. Credits appear only after payment is confirmed.";}catch{message="Payment is being checked. Review your balance before starting another purchase.";}}
    const wallet=await campaignWalletAction();
    if(!wallet.installed)return {kind:"inactive"};
    const settings=await ownerCampaignSettings();
    const owner=await requireCampaignOwner();
    let campaigns:OwnerCampaign[]=[],active:OwnerCampaign[]=[],hasMore=false;
    try { const [history,current]=await Promise.all([loadOwnerCampaignsAction(),loadOwnerCampaignsAction(0,true)]);campaigns=history.campaigns;active=current.campaigns;hasMore=history.hasMore; }
    catch { message="Your campaigns could not load. Refresh to try again."; }
    return {kind:"ready",props:{wallet,settings,location:{city:owner.context.currentSalon?.city??"",state:owner.context.currentSalon?.state??"",country:owner.context.currentSalon?.country??"United States"},initialCampaigns:campaigns,initialActive:active,initialHasMore:hasMore,initialError:message,initialTab:query.tab==="settings"||query.card_session||query.card?"settings":"campaigns",initialCreditView:query.payment==="attention"?"payment":query.credits==="needed"&&!wallet.auto_topup_enabled?"add":undefined}};
  }catch{return {kind:"failed"};}
}

export default withExperiencePage(CampaignsPage);
