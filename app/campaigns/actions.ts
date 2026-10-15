"use server";
import { requireCampaignOwner, ownerCampaignSettings } from "@/lib/owner-campaigns";
import { campaignQuote, validateCampaignLocation } from "@/lib/owner-campaign-rules";
import type { CampaignArea, CampaignPrompt, OwnerCampaign } from "@/types/owner-campaign";
import type { CampaignCreativeTarget } from "@/types/owner-campaign";
import { revalidatePath } from "next/cache";

export async function loadOwnerCampaignsAction() {
  const { client, salonId } = await requireCampaignOwner();
  const settings = await ownerCampaignSettings();
  const { error: refreshError } = await client.rpc("campaign_credit_close_expired", {p_salon:salonId});
  if (refreshError) throw new Error("Your campaigns could not load. Please try again.");
  const { data, error } = await client.from("owner_campaigns").select("*").eq("salon_id", salonId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Your campaigns could not load. Please try again.");
  return { settings, campaigns: (data ?? []) as OwnerCampaign[] };
}
export async function ownerCampaignPromptAction(): Promise<CampaignPrompt | null> {
  const { client, salonId, userId } = await requireCampaignOwner();
  const settings = await ownerCampaignSettings();
  if (!settings.enabled || !settings.promptsEnabled) return null;
  const { data, error } = await client.rpc("owner_campaign_claim_prompt", { p_salon: salonId, p_user: userId });
  if (error) throw new Error("Campaign suggestion is unavailable.");
  return data as CampaignPrompt | null;
}
export async function dismissCampaignPromptAction(id: string) {
  const { client, salonId } = await requireCampaignOwner();
  await client.from("owner_campaign_prompts").update({ dismissed_at: new Date().toISOString() }).eq("id", id).eq("salon_id", salonId);
}
export async function createOwnerCampaignAction(input: {
  id: string; target: CampaignCreativeTarget; keepRunning?: boolean; area: CampaignArea; location: string;
  country: string; state: string; city: string; dailyViews: number; days: number;
}) {
  try {
    const { client, salonId, userId } = await requireCampaignOwner();
    const settings = await ownerCampaignSettings();
    if (!settings.enabled) throw new Error("New campaigns are temporarily unavailable.");
    campaignQuote(settings, input.dailyViews, input.days, input.area);
    validateCampaignLocation(input.area, input.location, input.country, input.state, input.city);
    if (!/^[0-9a-f-]{36}$/i.test(input.id) || !/^[0-9a-f-]{36}$/i.test(input.target.sourceId)) throw new Error("Reopen this post and try again.");
    const { data, error } = await client.rpc("owner_campaign_create", {
      p_id: input.id, p_salon: salonId, p_user: userId,
      p_type: input.target.sourceType, p_source: input.target.sourceId,
      p_area: input.area, p_location: input.location.trim(), p_country: input.country.trim(),
      p_state: input.state.trim(), p_city: input.city.trim(), p_views: input.dailyViews, p_days: input.days,
    });
    if (error) throw new Error(error.message);
    const funded = await client.rpc("campaign_credit_fund", {p_id:data,p_salon:salonId,p_owner:userId,p_keep:input.keepRunning === true});
    if(funded.error)throw new Error(funded.error.message);
    revalidatePath("/campaigns");
    return { ok: true, message: funded.data === "pending_review" ? "Your credits are set aside. Your ad will start after a quick review." : "Your ad is saved. Add credits to submit it for review.", id: String(data), status: funded.data };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Your campaign could not be saved." }; }
}
export async function changeOwnerCampaignAction(id: string, action: "pause" | "resume" | "cancel") {
  try {
    const { client, salonId, userId } = await requireCampaignOwner();
    const { error } = await client.rpc("owner_campaign_change", { p_id: id, p_salon: salonId, p_user: userId, p_action: action });
    if (error) throw new Error(error.message);
    revalidatePath("/campaigns");
    return { ok: true, message: action === "cancel" ? "Campaign cancelled. No more views will be charged." : "Campaign updated." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Please try again." }; }
}

export async function fundSavedCampaignAction(id:string){
 try{
  const {client,salonId,userId}=await requireCampaignOwner();
  const {data:campaign}=await client.from("owner_campaigns").select("keep_running").eq("id",id).eq("salon_id",salonId).single();
  if(!campaign)throw new Error("Ad not found.");
  const {data,error}=await client.rpc("campaign_credit_fund",{p_id:id,p_salon:salonId,p_owner:userId,p_keep:campaign.keep_running});
  if(error)throw new Error(error.message);
  revalidatePath("/campaigns");return{ok:true,message:data==="pending_review"?"Credits reserved. Your ad is ready for review.":"Add enough credits to start your ad."};
 }catch(error){return{ok:false,message:error instanceof Error?error.message:"Please try again."};}
}
