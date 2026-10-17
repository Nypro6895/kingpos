import"server-only";
import{createHash}from"node:crypto";
import{getRequestBusinessContext}from"./request-business-context";
import{getExperienceContext}from"./experience-context";
import{marketPluginContext}from"./market-plugins";
import{marketBankBillingState}from"./market-bank-billing";
import{bookingDepositState}from"./booking-deposit";
import{bookingDepositPurchaseState}from"./booking-deposit-market";
import{campaignWalletAction}from"@/app/campaigns/credit-actions";
import{ownerCampaignSettings,requireCampaignOwner}from"./owner-campaigns";
import{advertisingClient}from"./explore-advertising";
import{APP_LOCAL_COMMERCE_READS,type AppLocalCampaigns}from"./app-local-commerce-metadata";
import type{OwnerCampaign}from"@/types/owner-campaign";
import type{AppLocalRead}from"./app-local-host";
function fail(status:number,message:string):never{throw Object.assign(new Error(message),{status});}
export async function readAppLocalCommerceResource(name:string,args:Record<string,unknown>,options:{scope:string;etag?:string;signal?:AbortSignal}):Promise<AppLocalRead|null>{
 if(!Object.hasOwn(APP_LOCAL_COMMERCE_READS,name))return null;
 const rule=APP_LOCAL_COMMERCE_READS[name as keyof typeof APP_LOCAL_COMMERCE_READS],keys:readonly string[]=rule.argumentKeys;
 if(Object.entries(args).some(([key,value])=>!keys.includes(key)||typeof value!=="string"||!/^[a-f0-9-]{36}$/i.test(value))||keys.some(key=>!Object.hasOwn(args,key)))fail(400,"Invalid page filters.");
 if(options.signal?.aborted)throw options.signal.reason;
 const context=await getRequestBusinessContext();if(getExperienceContext(context).scope!==options.scope)fail(409,"Your workspace changed.");
 let data:unknown;
 if(name==="public.campaign"){
  const client=advertisingClient(),{data:campaign,error}=await client.from("owner_campaigns").select("source_id,source_type,salon_id,approved_at,ends_at").eq("id",args.campaignId).eq("status","running").gt("ends_at",new Date().toISOString()).maybeSingle();
  if(error)fail(503,"Could not load this campaign.");if(!campaign?.approved_at||campaign.source_type!=="custom")fail(404,"This campaign is no longer available.");
  const{data:creative,error:creativeError}=await client.rpc("owner_campaign_post",{p_type:"custom",p_source:campaign.source_id,p_salon:campaign.salon_id});if(creativeError)fail(503,"Could not load this campaign.");if(!creative)fail(404,"This campaign is no longer available.");
  const{data:image}=await client.storage.from("campaign-creatives").createSignedUrl(creative.media_path,3600);data={salonId:campaign.salon_id,endsAt:campaign.ends_at,title:creative.title,caption:creative.caption,imageUrl:image?.signedUrl??null};
 }else{
  if(!context.user)fail(401,"Please sign in again.");
  if(name==="owner.campaigns"){
   const owner=await requireCampaignOwner(false);if(owner.context.user?.id!==context.user.id||getExperienceContext(owner.context).scope!==options.scope)fail(409,"Your workspace changed.");
   const[wallet,settings]=await Promise.all([campaignWalletAction(),ownerCampaignSettings()]);
   const[result,active]=wallet.installed?await Promise.all([
    owner.client.from("owner_campaigns").select("*").eq("salon_id",owner.salonId).order("created_at",{ascending:false}).order("id",{ascending:false}).range(0,49),
    owner.client.from("owner_campaigns").select("*").eq("salon_id",owner.salonId).in("status",["awaiting_payment","pending_review","running","paused"]).order("created_at",{ascending:false}).order("id",{ascending:false}).range(0,49),
   ]):[{data:[],error:null},{data:[],error:null}];
   if(result.error||active.error)fail(503,"Your campaigns could not load.");
   // This projection never closes/reserves/charges credits. The original
   // CampaignWorkspace retains its exact named POST refresh and action checks.
   data={wallet,settings,location:{city:owner.context.currentSalon?.city??"",state:owner.context.currentSalon?.state??"",country:owner.context.currentSalon?.country??"United States"},initialCampaigns:(result.data??[])as OwnerCampaign[],initialActive:(active.data??[])as OwnerCampaign[],initialHasMore:result.data?.length===50,initialError:""}satisfies AppLocalCampaigns;
  }else{
   let market:Awaited<ReturnType<typeof marketPluginContext>>;try{market=await marketPluginContext();}catch{fail(403,"Open your owner workspace first.");}
   if(!context.currentSalon||context.currentSalon.id!==market.salonId)fail(409,"Your salon changed.");
   if(name==="owner.deposit-settings"){
    const[purchase,state]=await Promise.all([bookingDepositPurchaseState(market.salonId),bookingDepositState(market.salonId)]);data={salonId:market.salonId,state,paid:purchase.paid};
   }else{
    const billing=await marketBankBillingState(market.salonId);if(!billing.available)fail(503,"The order could not be checked.");
    const order=billing.orders.find(row=>row.id===args.orderId);if(!order)fail(404,"This order is no longer available.");data={order,business:{id:context.currentSalon.id,name:context.currentSalon.name}};
   }
  }
 }
 if(options.signal?.aborted)throw options.signal.reason;
 const etag='"'+createHash("sha256").update(JSON.stringify([options.scope,name,args,data])).digest("hex")+'"';
 return{schemaVersion:1,status:options.etag===etag?304:200,scope:options.scope,etag,updatedAt:Date.now(),...(options.etag===etag?{}:{data})};
}
