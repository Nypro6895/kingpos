import {paymentConfig,paymentStripe} from "./platform-payment";
import "server-only";
import { createHmac,timingSafeEqual } from "node:crypto";
import { advertisingClient } from "@/lib/explore-advertising";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";
import type { requireCampaignOwner } from "@/lib/owner-campaigns";

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
  const form=new URLSearchParams({mode:"payment",success_url:new URL("/campaigns?payment=received",REYLUMI_METADATA_BASE).href,cancel_url:new URL("/campaigns?payment=cancelled",REYLUMI_METADATA_BASE).href,
    "line_items[0][price_data][currency]":"usd","line_items[0][price_data][unit_amount]":String(order.amount_cents),"line_items[0][price_data][product_data][name]":`${credits.toLocaleString()} Reylumi ad credits`,"line_items[0][quantity]":"1",
    "metadata[campaign_credit_order]":String(id),"payment_intent_data[metadata][campaign_credit_order]":String(id),"payment_method_types[0]":"card"});
  if(customer)form.set("customer",customer);else form.set("customer_creation","always");
  if(saveCard)form.set("payment_intent_data[setup_future_usage]","off_session");
  const session=await stripe("checkout/sessions",form,`campaign-checkout:${id}`);
  if(typeof session.url!=="string"||new URL(session.url).hostname!=="checkout.stripe.com")throw new Error("Secure payment could not open.");
  return session.url;
}
export function verifyCampaignWebhook(payload:string,signature:string){
  const secret=process.env.CAMPAIGN_STRIPE_WEBHOOK_SECRET;if(!secret)return false;
  const parts=signature.split(",");const timestamp=parts.find(v=>v.startsWith("t="))?.slice(2);
  if(!timestamp||!Number.isFinite(Number(timestamp))||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const expected=createHmac("sha256",secret).update(`${timestamp}.${payload}`).digest();
  return parts.filter(v=>v.startsWith("v1=")).some(v=>{const actual=Buffer.from(v.slice(3),"hex");return actual.length===expected.length&&timingSafeEqual(actual,expected);});
}
export async function fulfillCreditPayment(intentId:string){
  if(!/^pi_[a-zA-Z0-9]+$/.test(intentId))throw new Error("Invalid payment.");
  const intent=await stripe(`payment_intents/${intentId}`);
  const metadata=intent.metadata as Record<string,string>|undefined;
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
  const {data:campaigns}=await client.from("owner_campaigns").select("id").eq("keep_running",true).in("status",["running","completed"]).lte("ends_at",new Date().toISOString()).limit(100);
  for(const campaign of campaigns??[])await client.rpc("campaign_credit_renew",{p_id:campaign.id});
  const {data:expired}=await client.from("owner_campaigns").select("salon_id").in("status",["running","paused"]).lte("ends_at",new Date().toISOString()).limit(100);
  for(const salonId of new Set((expired??[]).map(row=>row.salon_id)))await client.rpc("campaign_credit_close_expired",{p_salon:salonId});
}

export async function expireCreditCheckout(orderId:string){
 if(!/^[0-9a-f-]{36}$/i.test(orderId))return;
 await advertisingClient().from("campaign_credit_orders").update({status:"cancelled"}).eq("id",orderId).eq("automatic",false).eq("status","pending");
}

