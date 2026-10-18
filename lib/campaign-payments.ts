import {paymentConfig,paymentStripe} from "./platform-payment";
import "server-only";
import { createHmac,timingSafeEqual } from "node:crypto";
import { advertisingClient } from "@/lib/explore-advertising";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";
import type { requireCampaignOwner } from "@/lib/owner-campaigns";
import { formatCredits } from "@/lib/campaign-credit-display";

export async function campaignPaymentReady(){if(process.env.CAMPAIGN_STRIPE_SECRET_KEY && process.env.CAMPAIGN_STRIPE_WEBHOOK_SECRET)return true;const c=await paymentConfig();return c.enabled && c.mode==="live" && Boolean(c.webhookSecret);}
async function stripe(path:string,form?:URLSearchParams,key?:string):Promise<Record<string,unknown>>{
  const secret=process.env.CAMPAIGN_STRIPE_SECRET_KEY;
  if(!secret)return paymentStripe(path,form,key);
  const response=await fetch(`https://api.stripe.com/v1/${path}`,{method:form?"POST":"GET",headers:{Authorization:`Bearer ${secret}`,...(form?{"Content-Type":"application/x-www-form-urlencoded"}:{}),...(key?{"Idempotency-Key":key}:{})},body:form?.toString(),cache:"no-store",signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok)throw new Error("Payment needs attention. Please check your card or try again.");
  return data;
}
export async function createCreditCheckout(owner:Awaited<ReturnType<typeof requireCampaignOwner>>,credits:number,saveCard:boolean){
  const {client,salonId,userId}=owner;
  const {data:id,error}=await client.rpc("campaign_credit_order",{p_salon:salonId,p_owner:userId,p_amount:credits,p_auto:false});
  if(error||!id)throw new Error(error?.message??"Could not prepare your credit purchase.");
  const {data:order}=await client.from("campaign_credit_orders").select("*").eq("id",id).single();
  if(order?.owner_id!==userId||order?.automatic||order?.credits!==credits)throw new Error("Another credit purchase is waiting. Finish it before starting a new one.");
  const {data:wallet}=await client.from("campaign_wallets").select("stripe_customer,payment_owner").eq("salon_id",salonId).single();
  const customer=wallet?.payment_owner===userId?wallet?.stripe_customer:null;
  const form=new URLSearchParams({mode:"payment",success_url:new URL("/campaigns?payment=received&credit_session={CHECKOUT_SESSION_ID}",REYLUMI_METADATA_BASE).href.replace(/%7B/g,"{").replace(/%7D/g,"}"),cancel_url:new URL(`/campaigns?payment=cancelled&credit_order=${id}`,REYLUMI_METADATA_BASE).href,
    "line_items[0][price_data][currency]":"usd","line_items[0][price_data][unit_amount]":String(order.amount_cents),"line_items[0][price_data][product_data][name]":`${formatCredits(credits)} Reylumi ad credits`,"line_items[0][quantity]":"1",
    "metadata[campaign_credit_order]":String(id),"payment_intent_data[metadata][campaign_credit_order]":String(id),"payment_method_types[0]":"card"});
  if(customer)form.set("customer",customer);else form.set("customer_creation","always");
  if(saveCard)form.set("payment_intent_data[setup_future_usage]","off_session");
  const session=await stripe("checkout/sessions",form,`campaign-checkout:${id}`);
  const checkoutUrl=secureCheckoutUrl(session.url);
  if(typeof session.id!=="string"||!/^cs_[a-zA-Z0-9_]+$/.test(session.id))throw new Error("Secure payment could not open.");
  const {error:saveSession}=await client.from("campaign_credit_orders").update({checkout_session_id:session.id}).eq("id",id).eq("owner_id",userId).eq("salon_id",salonId);
  if(saveSession)throw new Error("Payment could not be prepared. Please retry.");
  return checkoutUrl;
}

export async function confirmCampaignCheckout(owner: Awaited<ReturnType<typeof requireCampaignOwner>>, sessionId: string) {
 if(!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)||sessionId.length>240)throw new Error("Reopen payment methods to check your purchase.");
 const session=await stripe(`checkout/sessions/${sessionId}`), metadata=session.metadata as Record<string,string>|undefined;
 if(session.mode!=="payment"||!metadata?.campaign_credit_order)throw new Error("Payment could not be confirmed.");
 const {data,error}=await owner.client.from("campaign_credit_orders").select("id").eq("id",metadata.campaign_credit_order).eq("owner_id",owner.userId).eq("salon_id",owner.salonId).single();
 if(error||!data)throw new Error("Payment could not be confirmed.");
 if(session.status!=="complete"||session.payment_status!=="paid"||typeof session.payment_intent!=="string")return false;
 await fulfillCreditPayment(session.payment_intent);return true;
}
export async function cancelCampaignCheckout(owner: Pick<Awaited<ReturnType<typeof requireCampaignOwner>>, "client" | "salonId" | "userId">,orderId: string) {
 if(!/^[0-9a-f-]{36}$/i.test(orderId))throw new Error("Payment could not be cancelled.");
 const {data,error}=await owner.client.from("campaign_credit_orders").select("checkout_session_id,status,automatic").eq("id",orderId).eq("owner_id",owner.userId).eq("salon_id",owner.salonId).single();
 if(error||!data||data.automatic)throw new Error("Payment could not be cancelled.");
 if(data.status==="paid")return false;
 if(data.status==="cancelled")return true;
 if(data.status!=="pending"||!/^cs_[a-zA-Z0-9_]+$/.test(data.checkout_session_id??""))throw new Error("Payment is still being checked. Please retry shortly.");
 let session=await stripe(`checkout/sessions/${data.checkout_session_id}`);
 if(session.status==="complete")return false;
 if(session.status==="open")session=await stripe(`checkout/sessions/${data.checkout_session_id}/expire`,new URLSearchParams(),`campaign-cancel:${orderId}`);
 if(session.status!=="expired")throw new Error("Payment is still being checked. Please retry shortly.");
 const {error:update}=await owner.client.from("campaign_credit_orders").update({status:"cancelled"}).eq("id",orderId).eq("status","pending");
 if(update)throw new Error("Payment cancellation needs retry.");return true;
}
/** Admin reconciliation only reads a provider payment and replays verified fulfillment.
 * It never creates or confirms a new charge, including unknown automatic outcomes. */
export async function reconcileCampaignCreditOrder(orderId:string,reference?:string){
 if(!/^[0-9a-f-]{36}$/i.test(orderId))throw new Error("Choose a valid credit order.");
 const client=advertisingClient();
 const {data:order,error}=await client.from("campaign_credit_orders").select("id,status,checkout_session_id,provider_reference").eq("id",orderId).single();
 if(error||!order)throw new Error("Credit order could not load.");
 let intent=reference?.trim()||order.provider_reference;
 if(intent&&!/^pi_[a-zA-Z0-9]+$/.test(intent))throw new Error("Use the payment reference from your payment provider.");
 if(!intent&&order.checkout_session_id){
  if(!/^cs_[a-zA-Z0-9_]+$/.test(order.checkout_session_id))throw new Error("Credit checkout reference is invalid.");
  const session=await stripe(`checkout/sessions/${order.checkout_session_id}`);
  if((session.metadata as Record<string,string>|undefined)?.campaign_credit_order!==orderId)throw new Error("Payment does not belong to this order.");
  if(session.status!=="complete"||session.payment_status!=="paid"||typeof session.payment_intent!=="string")throw new Error("Payment is not complete. No credits were added.");
  intent=session.payment_intent;
 }
 if(!intent)throw new Error("Check the payment provider and supply its payment reference. No new charge was sent.");
 if(!/^pi_[a-zA-Z0-9]+$/.test(intent))throw new Error("Credit payment reference is invalid.");
 const payment=await stripe(`payment_intents/${intent}`);
 if((payment.metadata as Record<string,string>|undefined)?.campaign_credit_order!==orderId)throw new Error("Payment does not belong to this order.");
 await fulfillCreditPayment(intent,orderId);
 return "Verified payment and credits synchronized. No new charge was created.";
}
export function verifyCampaignWebhook(payload:string,signature:string){
  const secret=process.env.CAMPAIGN_STRIPE_WEBHOOK_SECRET;if(!secret)return false;
  const parts=signature.split(",");const timestamp=parts.find(v=>v.startsWith("t="))?.slice(2);
  if(!timestamp||!Number.isFinite(Number(timestamp))||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const expected=createHmac("sha256",secret).update(`${timestamp}.${payload}`).digest();
  return parts.filter(v=>v.startsWith("v1=")).some(v=>{const actual=Buffer.from(v.slice(3),"hex");return actual.length===expected.length&&timingSafeEqual(actual,expected);});
}
export async function fulfillCreditPayment(intentId:string,expectedOrderId?:string){
  if(!/^pi_[a-zA-Z0-9]+$/.test(intentId))throw new Error("Invalid payment.");
  const intent=await stripe(`payment_intents/${intentId}`);
  const metadata=intent.metadata as Record<string,string>|undefined;
  if(expectedOrderId&&metadata?.campaign_credit_order!==expectedOrderId)throw new Error("Payment does not belong to this order.");
  if(intent.status!=="succeeded"||intent.currency!=="usd"||!metadata?.campaign_credit_order)throw new Error("Payment is not complete.");
  const client=advertisingClient();
  const {error}=await client.rpc("campaign_credit_paid",{p_order:metadata.campaign_credit_order,p_reference:intentId,p_amount:intent.amount_received,p_customer:typeof intent.customer==="string"?intent.customer:null,p_method:intent.setup_future_usage==="off_session"&&typeof intent.payment_method==="string"?intent.payment_method:null});
  if(error)throw new Error("Credits could not be recorded. Payment will be retried.");
}
export async function processCampaignCreditQueue(){
  const started=Date.now();
  const client=advertisingClient();
  if(await campaignPaymentReady()){
    const {data:wallets}=await client.from("campaign_wallets").select("salon_id,payment_owner,topup_credits,threshold_credits,available_credits,stripe_customer,stripe_payment_method").eq("installed",true).eq("auto_topup_enabled",true).order("updated_at").limit(100);
    for(const wallet of wallets??[]){
      if(Date.now()-started>240000)break;
      await client.from("campaign_wallets").update({updated_at:new Date().toISOString()}).eq("salon_id",wallet.salon_id);
      const {data:id,error}=await client.rpc("campaign_credit_order",{p_salon:wallet.salon_id,p_owner:wallet.payment_owner,p_amount:wallet.topup_credits,p_auto:true});
      if(error||!id)continue;
      const {data:order}=await client.from("campaign_credit_orders").select("*").eq("id",id).single();
      if(!order?.automatic||order.status==="paid"||order.owner_id!==wallet.payment_owner||order.credits!==wallet.topup_credits)continue;
      const {data:claim,error:claimError}=await client.rpc("campaign_credit_claim",{p_order:id});
      if(claimError||!claim)continue;
      try{
        const intent=await stripe("payment_intents",new URLSearchParams({amount:String(claim.amount),currency:"usd",customer:claim.customer,payment_method:claim.method,confirm:"true",off_session:"true","metadata[campaign_credit_order]":String(id)}),`campaign-topup:${id}`);
        if(intent.status==="succeeded")await fulfillCreditPayment(String(intent.id));
        else {await client.from("campaign_credit_orders").update({status:"failed",error:"Your card needs confirmation."}).eq("id",id).neq("status","paid");await client.from("campaign_wallets").update({auto_topup_enabled:false}).eq("salon_id",wallet.salon_id); }
      }catch{
        // Keep the same pending order/idempotency key after an unknown outcome. Never retry with a new charge.
        await client.from("campaign_credit_orders").update({error:"Payment needs attention. Check your payment method."}).eq("id",id).neq("status","paid");
        await client.from("campaign_wallets").update({auto_topup_enabled:false}).eq("salon_id",wallet.salon_id);
      }
    }
  }
  // Only ads explicitly submitted while automatic purchases were enabled may be funded by the queue.
  const { data: waiting } = await client.from("owner_campaigns").select("id,salon_id,owner_id,keep_running").eq("status","awaiting_payment").eq("auto_fund",true).limit(100);
  for (const campaign of waiting ?? []) {
    const { data: wallet } = await client.from("campaign_wallets").select("auto_topup_enabled,payment_blocked").eq("salon_id",campaign.salon_id).single();
    if (wallet?.auto_topup_enabled && !wallet.payment_blocked) await client.rpc("campaign_credit_fund",{p_id:campaign.id,p_salon:campaign.salon_id,p_owner:campaign.owner_id,p_keep:campaign.keep_running});
  }
  const {data:campaigns}=await client.from("owner_campaigns").select("id").eq("keep_running",true).in("status",["running","completed"]).lte("ends_at",new Date().toISOString()).limit(100);
  for(const campaign of campaigns??[])await client.rpc("campaign_credit_renew",{p_id:campaign.id});
  const {data:expired}=await client.from("owner_campaigns").select("salon_id").in("status",["running","paused"]).lte("ends_at",new Date().toISOString()).limit(100);
  for(const salonId of new Set((expired??[]).map(row=>row.salon_id)))await client.rpc("campaign_credit_close_expired",{p_salon:salonId});
}

type CampaignOwner = Awaited<ReturnType<typeof requireCampaignOwner>>;
function secureCheckoutUrl(value: unknown) {
 if(typeof value!=="string") throw new Error("Secure payment could not open.");
 const u=new URL(value);if(u.protocol!=="https:"||u.hostname!=="checkout.stripe.com"||u.username||u.password||u.port)throw new Error("Secure payment could not open.");
 return value;
}
export async function createCampaignCardSetup(owner: CampaignOwner) {
 if(!await campaignPaymentReady())throw new Error("Payment methods are not available yet.");
 const {client,salonId,userId}=owner;
 const {data:wallet,error}=await client.from("campaign_wallets").select("stripe_customer,payment_owner,payment_revision").eq("salon_id",salonId).single();
 if(error)throw new Error("Payment settings could not load.");
 let customer=wallet.payment_owner===userId?wallet.stripe_customer:null;
 const setup=crypto.randomUUID();
 if(!customer){const result=await stripe("customers",new URLSearchParams({"metadata[campaign_owner]":userId}),`campaign-customer:${salonId}:${userId}`);customer=result.id;}
 if(typeof customer!=="string"||!/^cus_[a-zA-Z0-9]+$/.test(customer))throw new Error("Your card could not be prepared.");
 const {error:recordError}=await client.from("campaign_card_setups").insert({id:setup,salon_id:salonId,owner_id:userId,payment_revision:wallet.payment_revision});
 if(recordError)throw new Error("Your card could not be prepared.");
 const form=new URLSearchParams({mode:"setup",customer,"payment_method_types[0]":"card",
 success_url:new URL("/campaigns?card_session={CHECKOUT_SESSION_ID}",REYLUMI_METADATA_BASE).href.replace(/%7B/g,"{").replace(/%7D/g,"}"),
 cancel_url:new URL("/campaigns?card=cancelled",REYLUMI_METADATA_BASE).href,
 "metadata[campaign_card_setup]":setup,"metadata[campaign_salon]":salonId,"metadata[campaign_owner]":userId,
 "setup_intent_data[metadata][campaign_card_setup]":setup});
 return secureCheckoutUrl((await stripe("checkout/sessions",form,`campaign-card:${setup}`)).url);
}
export async function finishCampaignCardSetup(owner: CampaignOwner,sessionId:string) {
 if(!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)||sessionId.length>240)throw new Error("Reopen payment methods to check your card.");
 const session=await stripe(`checkout/sessions/${sessionId}`);
 const metadata=session.metadata as Record<string,string>|undefined;
 if(session.mode!=="setup"||session.status!=="complete"||metadata?.campaign_owner!==owner.userId||metadata?.campaign_salon!==owner.salonId||!metadata?.campaign_card_setup)throw new Error("Your card setup is not complete.");
 if(typeof session.setup_intent!=="string"||!/^seti_[a-zA-Z0-9]+$/.test(session.setup_intent))throw new Error("Your card setup is not complete.");
 const intent=await stripe(`setup_intents/${session.setup_intent}`);
 if(intent.status!=="succeeded"||intent.customer!==session.customer||typeof intent.customer!=="string"||typeof intent.payment_method!=="string")throw new Error("Your card setup is not complete.");
 const {error}=await owner.client.rpc("campaign_save_card",{p_setup:metadata.campaign_card_setup,p_owner:owner.userId,p_customer:intent.customer,p_method:intent.payment_method});
 if(error)throw new Error("Your card could not be saved. Please retry.");
}
/** Verified provider callbacks work even when Safari and the native app have separate login cookies. */
export async function fulfillCampaignCardSetup(sessionId: string) {
 if(!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)||sessionId.length>240)throw new Error("Invalid card setup.");
 const session=await stripe(`checkout/sessions/${sessionId}`);
 const metadata=session.metadata as Record<string,string>|undefined;
 if(!metadata?.campaign_card_setup||!metadata.campaign_owner||!metadata.campaign_salon)throw new Error("Invalid card setup.");
 const client=advertisingClient();
 const {data:setup,error}=await client.from("campaign_card_setups").select("owner_id,salon_id,status,payment_revision").eq("id",metadata.campaign_card_setup).single();
 if(error||!setup||setup.owner_id!==metadata.campaign_owner||setup.salon_id!==metadata.campaign_salon)throw new Error("Invalid card setup.");
 if(setup.status!=="pending")return;
 const {data:wallet,error:walletError}=await client.from("campaign_wallets").select("payment_revision").eq("salon_id",setup.salon_id).single();
 if(walletError)throw new Error("Card setup needs retry.");
 // An obsolete setup is acknowledged, without replacing a newer payment choice.
 if(wallet.payment_revision!==setup.payment_revision)return;
 await finishCampaignCardSetup({client,salonId:setup.salon_id,userId:setup.owner_id} as CampaignOwner,sessionId);
}
export async function getCampaignCardSummary(owner: CampaignOwner) {
 const {data,error}=await owner.client.from("campaign_wallets").select("stripe_payment_method,payment_owner").eq("salon_id",owner.salonId).single();
 if(error)throw new Error("Payment methods could not load.");
 if(!data.stripe_payment_method||data.payment_owner!==owner.userId)return null;
 if(!/^pm_[a-zA-Z0-9]+$/.test(data.stripe_payment_method))throw new Error("Update your payment method.");
 const method=await stripe(`payment_methods/${data.stripe_payment_method}`);
 const card=method.card as {brand?:string;last4?:string;exp_month?:number;exp_year?:number}|undefined;
 return card?{brand:card.brand??"Card",last4:card.last4??"",expMonth:card.exp_month,expYear:card.exp_year}:null;
}

export async function expireCreditCheckout(orderId:string){
 if(!/^[0-9a-f-]{36}$/i.test(orderId))return;
 await advertisingClient().from("campaign_credit_orders").update({status:"cancelled"}).eq("id",orderId).eq("automatic",false).eq("status","pending");
}

