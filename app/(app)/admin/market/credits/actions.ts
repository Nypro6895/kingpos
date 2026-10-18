"use server";
import {notFound} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requirePlatformAdmin} from "@/lib/platform-admin/auth";
import {PLATFORM_ADMIN_PERMISSIONS as P} from "@/types/platform-admin";
import {callPlatformAdminRpc} from "@/lib/platform-admin/rpc";
import {advertisingClient} from "@/lib/explore-advertising";
import {cancelCampaignCheckout,reconcileCampaignCreditOrder} from "@/lib/campaign-payments";
import type {AdminActionResult} from "../../_components/action-form";
export async function campaignCreditAdminAction(form:FormData):Promise<AdminActionResult>{
 const actor=await requirePlatformAdmin(P.teamManage);if(actor.roleSlug!=="platform_owner")notFound();
 try{
  const id=String(form.get("id")??""),action=String(form.get("intent")??""),reason=String(form.get("reason")??"").trim();
  if(!/^[0-9a-f-]{36}$/i.test(id)||!["reconcile","cancel","stop"].includes(action)||reason.length<3||reason.length>1000)throw new Error("Choose a record and add a reason (3–1000 characters).");
  if(action==="stop"){
   await callPlatformAdminRpc("admin_stop_campaign_purchases",{p_salon:id,p_reason:reason});
   revalidatePath("/admin/market/credits");revalidatePath("/campaigns");
   return{ok:true,message:"Future automatic purchases stopped. A payment already processing may still complete. Funded ads keep their credits."};
  }
  const client=advertisingClient();
  const {data:audit,error:auditError}=await client.from("market_system_audit").insert({actor_id:actor.userId,action:`campaign.credit.${action}.requested`,details:{order_id:id,reason}}).select("id").single();
  if(auditError||!audit)throw new Error("The operation could not be recorded. Please retry.");
  let message:string;
  if(action==="reconcile")message=await reconcileCampaignCreditOrder(id,String(form.get("reference")??"").trim()||undefined);
  else{
   const {data:order,error}=await client.from("campaign_credit_orders").select("owner_id,salon_id,automatic,status").eq("id",id).single();
   if(error||!order)throw new Error("Credit order could not load.");
   if(order.automatic)throw new Error("Stop future automatic purchases from the salon wallet. A processing payment must be checked with the provider.");
   const cancelled=await cancelCampaignCheckout({client,salonId:order.salon_id,userId:order.owner_id},id);
   if(!cancelled)throw new Error("Payment already completed or is being checked. Reconcile it instead.");
   message="Unpaid checkout cancelled. No refund or new charge was created.";
  }
  const {error:receiptError}=await client.from("market_system_audit").insert({actor_id:actor.userId,action:`campaign.credit.${action}.completed`,details:{order_id:id,request_id:audit.id,reason}});
  revalidatePath("/admin/market/credits");revalidatePath("/campaigns");
  return{ok:true,message:receiptError?`${message} The completion receipt needs attention; the request is recorded.`:message};
 }catch(error){return{ok:false,message:error instanceof Error?error.message:"Credit operation could not finish."};}
}
