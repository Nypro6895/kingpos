import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { getSelfBeautyProfilePage } from "./beauty";
import { getPostCommentViewer } from "./post-comments";
import { listCustomerBookings } from "./customer-bookings";
import { loadNotificationPage } from "./notification-center";
import { getWorkspacePendingSummary } from "./workspace-pending";
import { GET as notificationGET, POST as notificationPOST } from "@/app/api/notifications/route";
import { APP_LOCAL_PERSONAL_READS } from "./app-local-personal-metadata";
import type { AppLocalRead } from "./app-local-host";
import type { AppLocalHttpResponse } from "./app-local-http-client";
function fail(status:number,message:string):never{throw Object.assign(new Error(message),{status});}
async function authority(scope:string){
  if((await headers()).get("x-reylumi-auth-unavailable")==="1")fail(503,"Please reconnect and try again.");
  const context=await getRequestBusinessContext();if(!context.user)fail(401,"Please sign in again.");
  if(getExperienceContext(context).scope!==scope)fail(409,"Your workspace changed.");return context;
}
async function wire(response:Response):Promise<AppLocalHttpResponse>{return{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/json"},body:await response.text()};}
export async function readAppLocalPersonalResource(name:string,args:Record<string,unknown>,options:{scope:string;etag?:string;signal?:AbortSignal}):Promise<AppLocalRead|null>{
  if(!Object.hasOwn(APP_LOCAL_PERSONAL_READS,name))return null;
  const rule=APP_LOCAL_PERSONAL_READS[name as keyof typeof APP_LOCAL_PERSONAL_READS],allowed:readonly string[]=rule.argumentKeys;
  if(Object.entries(args).some(([key,value])=>!allowed.includes(key)||typeof value!=="string"||value.length>512))fail(400,"Invalid page filters.");
  const context=await authority(options.scope);if(options.signal?.aborted)throw options.signal.reason;
  let data:unknown;
  if(name==="page.beauty"){
    const [profile,commentViewer,upcoming]=await Promise.all([getSelfBeautyProfilePage(),getPostCommentViewer(),listCustomerBookings({scope:"upcoming",limit:1})]);
    if(!profile.ok)fail(profile.code==="sign_in_required"?401:503,"Your profile could not be loaded.");
    if(!upcoming.ok)fail(503,"Your next appointment could not be loaded.");
    data={profile:profile.data,commentViewer,booking:upcoming.data[0]??null};
  }else if(name==="page.notifications"){
    const filter=args.filter==="unread"?"unread":"all";
    const [feed,pending]=await Promise.all([loadNotificationPage(context,{unread:filter==="unread"}),getWorkspacePendingSummary(context)]);
    data={initialFilter:filter,initialItems:feed.items,initialCursor:feed.cursor,initialError:"",actionItems:pending.previewItems.filter(item=>item.source!=="app")};
  }else{
    const url=new URL("/api/notifications","https://reylumi.com");url.search=new URLSearchParams(args as Record<string,string>).toString();data=await wire(await notificationGET(new Request(url,{signal:options.signal})));
  }
  if(options.signal?.aborted)throw options.signal.reason;
  const etag='"'+createHash("sha256").update(JSON.stringify([options.scope,name,Object.entries(args).sort(),data])).digest("hex")+'"';
  return{schemaVersion:1,status:options.etag===etag?304:200,scope:options.scope,etag,updatedAt:Date.now(),...(options.etag===etag?{}:{data})};
}
export async function runAppLocalPersonalCommand(name:string,args:Record<string,unknown>,request:Request,scope:string){
  if(name!=="http.notifications.viewed")return{handled:false};
  const origin=new URL(request.url).origin;if(request.headers.get("origin")!==origin)fail(403,"Invalid origin.");
  await authority(scope);
  if(Object.keys(args).some(key=>key!=="input")||!args.input||typeof args.input!=="object"||Array.isArray(args.input)||JSON.stringify(args.input).length>16384)fail(400,"Invalid notifications.");
  const forwarded=new Headers({"Content-Type":"application/json",Origin:origin});const cookie=request.headers.get("cookie");if(cookie)forwarded.set("cookie",cookie);
  return{handled:true,data:await wire(await notificationPOST(new Request(new URL("/api/notifications",origin),{method:"POST",headers:forwarded,body:JSON.stringify(args.input)})))};
}
