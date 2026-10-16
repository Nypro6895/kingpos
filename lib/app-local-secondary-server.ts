import "server-only";
import {createHash}from"node:crypto";
import {getRequestBusinessContext}from"./request-business-context";
import {getExperienceContext}from"./experience-context";
import {requireSalonManagePageContext}from"./route-context-guards";
import {createAuthenticatedSupabaseServerClient}from"./supabase/server";
import {listBeautySalonPublicationRequests}from"./beauty-salon-publications";
import {resolveReferenceFavorites}from"./explore-reference-favorites";
import {APP_LOCAL_SECONDARY_READS}from"./app-local-secondary-metadata";
import type {AppLocalRead}from"./app-local-host";
function fail(status:number,message:string):never{throw Object.assign(new Error(message),{status});}
export async function readAppLocalSecondaryResource(name:string,args:Record<string,unknown>,options:{scope:string;etag?:string;signal?:AbortSignal}):Promise<AppLocalRead|null>{
 if(!Object.hasOwn(APP_LOCAL_SECONDARY_READS,name))return null;
 const rule=APP_LOCAL_SECONDARY_READS[name as keyof typeof APP_LOCAL_SECONDARY_READS],keys:readonly string[]=rule.argumentKeys;
 if(Object.entries(args).some(([key,value])=>!keys.includes(key)||typeof value!=="string"||!/^[a-z0-9-]{1,100}$/i.test(value))||keys.some(key=>!Object.hasOwn(args,key)))fail(400,"Invalid page filters.");
 if(options.signal?.aborted)throw options.signal.reason;
 const root=await getRequestBusinessContext();if(getExperienceContext(root).scope!==options.scope)fail(409,"Your workspace changed.");
 let data:unknown;
 if(name==="public.directory"){
  const resolved=await resolveReferenceFavorites([`directory:${args.businessId}`]);if(resolved.error)fail(503,"Could not update this salon.");
  const favorite=resolved.items[0];if(!favorite)fail(404,"This salon is no longer available.");
  if(!favorite.href.startsWith("/")||favorite.href.startsWith("//")||/[\\\u0000-\u001f]/.test(favorite.href))fail(503,"Invalid salon destination.");data={href:favorite.href};
 }else{
  if(!root.user)fail(401,"Please sign in again.");
  if(name==="customer.visit"){
   if(!/^[a-f0-9-]{36}$/i.test(String(args.visitId)))fail(400,"Invalid visit.");
   const client=await createAuthenticatedSupabaseServerClient();if(!client)fail(503,"Please reconnect.");
   const result=await client.rpc("get_notification_visit",{p_id:args.visitId});if(result.error||!result.data)fail(404,"This visit is no longer available.");
   // The original RPC owns both customer ownership and visibility. Keep only
   // the fields actually shown by the original page in a durable read model.
   const value=result.data;data={salonName:value.salonName,status:value.status,checkedInAt:value.checkedInAt,timezone:value.timezone,bookingId:value.bookingId??null,isCustomer:value.isCustomer===true,salonPhone:value.salonPhone??null};
  }else{
   const context=await requireSalonManagePageContext("/salon-profile/client-transformations");
   if(context.user?.id!==root.user.id||getExperienceContext(context).scope!==options.scope)fail(409,"Your workspace changed.");
   data=await listBeautySalonPublicationRequests(context);
  }
 }
 if(options.signal?.aborted)throw options.signal.reason;
 const etag='"'+createHash("sha256").update(JSON.stringify([options.scope,name,args,data])).digest("hex")+'"';
 return{schemaVersion:1,status:etag===options.etag?304:200,scope:options.scope,etag,updatedAt:Date.now(),...(etag===options.etag?{}:{data})};
}
