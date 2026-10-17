"use server";
import { requireCampaignOwner } from "@/lib/owner-campaigns";
import { revalidatePath } from "next/cache";
import type { CampaignWallet } from "@/types/owner-campaign";
import { campaignPaymentReady, createCreditCheckout, createCampaignCardSetup, finishCampaignCardSetup, getCampaignCardSummary } from "@/lib/campaign-payments";

export async function campaignWalletAction(): Promise<CampaignWallet> {
  const {client,salonId,userId}=await requireCampaignOwner(false);
  const {data,error}=await client.from("campaign_wallets").select("available_credits,reserved_credits,welcome_credits,installed,auto_topup_enabled,topup_credits,threshold_credits,monthly_limit_cents,stripe_payment_method,payment_owner,payment_blocked,low_credit_reminders").eq("salon_id",salonId).maybeSingle();
  if(error)throw new Error("Credits are being prepared. Please try again later.");
  const visible = data ? {available_credits:data.available_credits,reserved_credits:data.reserved_credits,welcome_credits:data.welcome_credits,installed:data.installed,auto_topup_enabled:data.auto_topup_enabled,topup_credits:data.topup_credits,threshold_credits:data.threshold_credits,monthly_limit_cents:data.monthly_limit_cents,payment_blocked:data.payment_blocked,low_credit_reminders:data.low_credit_reminders} : {};
  return {available_credits:0,reserved_credits:0,welcome_credits:0,installed:false,auto_topup_enabled:false,topup_credits:500,threshold_credits:100,monthly_limit_cents:3000,...visible,payment_ready:await campaignPaymentReady().catch(()=>false),has_payment_method:Boolean(data?.stripe_payment_method && data.payment_owner===userId)};
}
export async function setCampaignPluginAction(installed:boolean) {
  try {
    const {client,salonId,userId}=await requireCampaignOwner(false);
    const {data,error}=await client.rpc("campaign_plugin_set",{p_salon:salonId,p_owner:userId,p_install:installed});
    if(error)throw new Error("Campaigns could not be updated. Please try again.");
    revalidatePath("/market");revalidatePath("/campaigns");revalidatePath("/","layout");
    return {installed,credits:Number(data),error:null};
  }catch(error){return{error:error instanceof Error?error.message:"Please try again."};}
}
export async function saveCampaignTopupAction(input:{enabled:boolean;amount:number;threshold:number;limit:number}) {
  try {
    const {client,salonId,userId}=await requireCampaignOwner();
    if(typeof input.enabled!=="boolean" || ![500,1500,5000].includes(input.amount) || !Number.isSafeInteger(input.threshold) || input.threshold<0 || input.threshold>5000 || !Number.isSafeInteger(input.limit) || input.limit<input.amount || input.limit>100000) throw new Error("Choose a valid amount and monthly limit.");
    if(input.enabled && !(await campaignPaymentReady()))throw new Error("Automatic top-ups will be available when payment is connected.");
    const {error}=await client.rpc("campaign_credit_preferences",{p_salon:salonId,p_owner:userId,p_enabled:input.enabled,p_amount:input.amount,p_threshold:input.threshold,p_limit:input.limit});
    if(error)throw new Error(error.message);
    revalidatePath("/campaigns");return {ok:true,message:"Credit settings saved."};
  }catch(error){return {ok:false,message:error instanceof Error?error.message:"Please try again."};}
}
export async function buyCampaignCreditsAction(credits:number,saveCard:boolean) {
  try {
    const owner=await requireCampaignOwner();
    if(![500,1500,5000].includes(credits) || typeof saveCard!=="boolean")throw new Error("Choose an available credit pack.");
    if(!(await campaignPaymentReady()))throw new Error("Credit purchases will be available when payment is connected.");
    const url=await createCreditCheckout(owner,credits,saveCard);
    return {ok:true,url,message:"Continue to secure payment."};
  }catch(error){return {ok:false,message:error instanceof Error?error.message:"Payment could not start."};}
}

export async function campaignPaymentControlAction(action: "block" | "unblock" | "stop") {
  try {
    const { client, salonId, userId } = await requireCampaignOwner(false);
    if (!["block", "unblock", "stop"].includes(action)) throw new Error("Choose a payment option.");
    const { error } = await client.rpc("campaign_payment_controls", { p_salon: salonId, p_owner: userId, p_action: action });
    if (error) throw new Error("Payment preferences could not save. Please retry.");
    revalidatePath("/campaigns"); return { ok: true, message: "Payment preferences saved. Payments already processing may still finish." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Please retry." }; }
}
export async function campaignCardSetupAction() {
  try { return { ok: true, url: await createCampaignCardSetup(await requireCampaignOwner()), message: "Continue to save your card securely." }; }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Please retry." }; }
}
export async function completeCampaignCardAction(session: string) {
  await finishCampaignCardSetup(await requireCampaignOwner(), session);
  revalidatePath("/campaigns");
}
export async function loadCampaignCardAction() { return getCampaignCardSummary(await requireCampaignOwner()); }
export async function loadCampaignLedgerAction(offset = 0) {
  const { client, salonId } = await requireCampaignOwner();
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error("Reopen credit history.");
  const { data, error } = await client.from("campaign_credit_ledger").select("id,kind,credits,created_at").eq("salon_id", salonId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 49);
  if (error) throw new Error("Credit history could not load.");
  return { entries: data ?? [], hasMore: data?.length === 50 };
}
export async function saveCampaignRemindersAction(enabled: boolean) {
  const { client, salonId } = await requireCampaignOwner();
  if (typeof enabled !== "boolean") throw new Error("Choose a reminder preference.");
  const { error } = await client.from("campaign_wallets").update({ low_credit_reminders: enabled }).eq("salon_id", salonId);
  if (error) throw new Error("Reminder settings could not save.");
  revalidatePath("/campaigns");
}

