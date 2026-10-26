"use server";
import { requireCampaignOwner, ownerCampaignSettings } from "@/lib/owner-campaigns";
import { campaignQuote, validateCampaignLocation } from "@/lib/owner-campaign-rules";
import type { CampaignArea, CampaignPrompt, OwnerCampaign } from "@/types/owner-campaign";
import type { CampaignCreativeTarget } from "@/types/owner-campaign";
import { revalidatePath } from "next/cache";

export async function loadOwnerCampaignsAction(offset = 0, activeOnly = false) {
  const { client, salonId } = await requireCampaignOwner();
  const settings = await ownerCampaignSettings();
  // Status/history reads never reconcile accounting. The credit queue closes expired periods.
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error("Reopen campaign history.");
  let query = client.from("owner_campaigns").select("*").eq("salon_id", salonId);
  if (activeOnly) query = query.or("status.in.(awaiting_payment,pending_review,running,paused),and(status.eq.completed,owner_paused_at.not.is.null)");
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 49);
  if (error) throw new Error("Your campaigns could not load. Please try again.");
  return { settings, campaigns: (data ?? []) as OwnerCampaign[], hasMore: data?.length === 50 };
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
  id: string; settingsVersion?: number; target: CampaignCreativeTarget; keepRunning?: boolean; area: CampaignArea; location: string;
  country: string; state: string; city: string; dailyViews: number; days: number; creditLimit?: number;
}) {
  try {
    const { client, salonId, userId } = await requireCampaignOwner();
    const settings = await ownerCampaignSettings();
    if (!settings.enabled) throw new Error("New campaigns are temporarily unavailable.");
    const quote = campaignQuote(settings, input.dailyViews, input.days, input.area);
    const limit = input.creditLimit ?? quote.totalCents;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > quote.totalCents) throw new Error("Choose a credit limit within the estimate.");
    validateCampaignLocation(input.area, input.location, input.country, input.state, input.city);
    if (!/^[0-9a-f-]{36}$/i.test(input.id) || !/^[0-9a-f-]{36}$/i.test(input.target.sourceId)) throw new Error("Reopen this post and try again.");
    const { data: wallet, error: walletError } = await client.from("campaign_wallets").select("auto_topup_enabled,payment_blocked").eq("salon_id", salonId).single();
    if (walletError) throw new Error("Your credit settings could not load. Please retry.");
    const { data, error } = await client.rpc("campaign_create_versioned", {
      // Existing installed clients submit an explicit ceiling but no revision.
      // Keep that ceiling unchanged; the server still quotes and validates current terms.
      p_expected:input.settingsVersion ?? (Number.isSafeInteger(input.creditLimit) && (input.creditLimit ?? 0)>0 ? settings.version : null),
      p_id: input.id, p_salon: salonId, p_user: userId,
      p_type: input.target.sourceType, p_source: input.target.sourceId,
      p_area: input.area, p_location: input.location.trim(), p_country: input.country.trim(),
      p_state: input.state.trim(), p_city: input.city.trim(), p_views: input.dailyViews, p_days: input.days,
      p_limit: limit, p_keep: input.keepRunning === true, p_auto: wallet.auto_topup_enabled && !wallet.payment_blocked,
    });
    if (error) throw new Error(error.message);
    const funded = await client.rpc("campaign_credit_fund", {p_id:data,p_salon:salonId,p_owner:userId,p_keep:input.keepRunning === true});
    if(funded.error)throw new Error(funded.error.message);
    revalidatePath("/campaigns");
    return { ok: true, message: funded.data === "pending_review" ? "Your credits are set aside. Your ad will start after a quick review." : wallet.auto_topup_enabled&&!wallet.payment_blocked ? "Your ad is saved and waiting for automatic credits within your existing limit. It starts only after funding and review." : "Your ad is saved. Add credits to submit it for review.", id: String(data), status: funded.data };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Your campaign could not be saved." }; }
}
export async function changeOwnerCampaignAction(id: string, action: "pause" | "resume" | "cancel", pauseEpisode?: string | null, resumeIntent?: "non_owner") {
  try {
    const { client, salonId, userId } = await requireCampaignOwner();
    const nonOwnerResume = action === "resume" && resumeIntent === "non_owner" && pauseEpisode === null;
    if (action === "resume" && !nonOwnerResume && (typeof pauseEpisode !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pauseEpisode))) throw new Error("Refresh this campaign before resuming it.");
    // The displayed pause episode is required. Reading the newest episode here
    // would let a delayed retry resume a later, deliberate pause.
    // An explicit unmarked admin-pause snapshot keeps the old Resume path.
    // That RPC rejects any newer owner pause under its database lock.
    const { error } = action === "resume" && !nonOwnerResume
      ? await client.rpc("owner_campaign_resume", { p_id:id, p_salon:salonId, p_user:userId, p_episode:pauseEpisode })
      : await client.rpc("owner_campaign_change", { p_id: id, p_salon: salonId, p_user: userId, p_action: action });
    if (error) throw new Error(error.message);
    revalidatePath("/campaigns");
    return { ok: true, message: action === "cancel" ? "Campaign cancelled. No more views will be charged." : "Campaign updated." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Please try again." }; }
}

export async function runAgainOwnerCampaignAction(input: {
  id: string; previousId: string; settingsVersion?: number; days: number; creditLimit: number;
}) {
  try {
    const { client, salonId, userId } = await requireCampaignOwner();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(input.id) || !uuid.test(input.previousId) || input.id === input.previousId) throw new Error("Reopen this campaign and try again.");
    if (!Number.isSafeInteger(input.days) || input.days < 1 || input.days > 90) throw new Error("Choose a valid number of days.");
    if (!Number.isSafeInteger(input.creditLimit) || input.creditLimit < 1 || input.creditLimit > 2147483647) throw new Error("Choose a valid credit limit.");
    if (!Number.isSafeInteger(input.settingsVersion) || input.settingsVersion! < 1) throw new Error("Campaign options changed. Refresh and review the new credit estimate.");
    // The transaction copies the approved campaign itself. Browser input cannot
    // substitute its post, audience, delivery limits, or approval provenance.
    const { data: id, error } = await client.rpc("campaign_run_again", {
      p_expected: input.settingsVersion, p_id: input.id, p_salon: salonId, p_user: userId,
      p_previous: input.previousId, p_days: input.days, p_limit: input.creditLimit,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/campaigns");
    const { data: campaign, error: loadError } = await client.from("owner_campaigns").select("status,auto_fund").eq("id", id).eq("salon_id", salonId).single();
    if (loadError || !campaign) return { ok: true, id: String(id), message: "Your new run is saved in History. Refresh to see its status." };
    return {
      ok: true, id: String(id), status: campaign.status,
      message: campaign.status === "running"
        ? "Your campaign is running again. This run is saved in History; no new review is needed."
        : campaign.status === "awaiting_payment"
          ? campaign.auto_fund
            ? "Your new run is saved in History and waiting for automatic credits within your existing limit. No new review is needed."
            : "Your new run is saved in History. Add credits to start it; no new review is needed."
          : "Your new run is saved in History. Refresh to see its status.",
    };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Your campaign could not run again." }; }
}

export async function fundSavedCampaignAction(id:string){
 try{
  const {client,salonId,userId}=await requireCampaignOwner();
  const {data:campaign}=await client.from("owner_campaigns").select("keep_running").eq("id",id).eq("salon_id",salonId).single();
  if(!campaign)throw new Error("Ad not found.");
  const {data,error}=await client.rpc("campaign_credit_fund",{p_id:id,p_salon:salonId,p_owner:userId,p_keep:campaign.keep_running});
  if(error)throw new Error(error.message);
  let automatic=false;
  if(data==="awaiting_payment") {
    const { data: wallet, error: walletError }=await client.from("campaign_wallets").select("auto_topup_enabled,payment_blocked").eq("salon_id",salonId).single();
    if(walletError)throw new Error("Credit settings could not load. Your saved ad has not started.");
    if(wallet?.auto_topup_enabled&&!wallet.payment_blocked) {
      automatic=true;
      const { error: markError }=await client.from("owner_campaigns").update({auto_fund:true}).eq("id",id).eq("salon_id",salonId).eq("status","awaiting_payment");
      if(markError)throw new Error("Your ad is saved. Please retry to continue with automatic credits.");
    }
  }
  revalidatePath("/campaigns");return{ok:true,message:data==="running"?"Your campaign is running.":data==="pending_review"?"Credits reserved. Your ad is ready for review.":automatic?"Waiting for automatic credits within your existing limit. Your ad has not started yet.":"Add enough credits to start your ad."};
 }catch(error){return{ok:false,message:error instanceof Error?error.message:"Please try again."};}
}

export async function loadCampaignResultsAction(id: string, days = 7) {
  const { client, salonId, userId } = await requireCampaignOwner();
  if (!/^[0-9a-f-]{36}$/i.test(id) || ![7,30,90].includes(days)) throw new Error("Choose a valid result period.");
  const { data, error } = await client.rpc("owner_campaign_daily_results", { p_salon: salonId, p_owner: userId, p_campaign: id, p_days: days });
  if (error) throw new Error("Results could not load. Please retry.");
  return (data ?? []).map((row: Record<string, unknown>) => ({ day: String(row.day), views: Number(row.views), likes: Number(row.likes), comments: Number(row.comments), bookings: Number(row.bookings) }));
}

export async function saveCampaignLimitAction(id: string, limit: number, keepRunning: boolean) {
  try {
    const { client, salonId, userId } = await requireCampaignOwner();
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(limit) || limit < 1 || typeof keepRunning !== "boolean") throw new Error("Choose a valid credit limit.");
    const { error } = await client.rpc("campaign_set_credit_limit", { p_salon: salonId, p_owner: userId, p_campaign: id, p_limit: limit, p_keep: keepRunning });
    if (error) throw new Error(error.message);
    revalidatePath("/campaigns");
    return { ok: true, message: "Campaign settings saved." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Please retry." }; }
}

export async function loadCampaignPostsAction() {
  const { client, salonId } = await requireCampaignOwner();
  const results = await Promise.all((["salon_profile_looks", "salon_profile_updates"] as const).map(async (table) => {
    // These post tables predate soft deletion; optional moderation fields are
    // checked from the row, as in owner_campaign_post, rather than queried as columns.
    const { data, error } = await client.from(table).select("*").eq("salon_id", salonId).eq("status", "published").order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error("Published posts could not load. Please retry.");
    return (data ?? []).filter(row => row.deleted_at == null && row.safety_hold !== true).map(row => ({ sourceId: row.id, sourceType: table === "salon_profile_looks" ? "salon_profile_look" as const : "salon_profile_update" as const, salonId, title: row.title || "Salon post" }));
  }));
  return results.flat();
}
