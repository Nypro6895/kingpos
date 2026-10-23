import "server-only";
import { createHash } from "node:crypto";
import { getStaffPortalIdentity } from "./staff-portal-identity";
import { getExperienceContext } from "./experience-context";
import { loadServiceRelay } from "@/app/service-relay/actions";
import type { AppLocalRead } from "./app-local-host";
import type { RelayWorkspace } from "@/types/service-relay";
function fail(status:number,message:string):never{throw Object.assign(new Error(message),{status});}
export async function readAppLocalStaffRelayResource(name:string,args:Record<string,unknown>,options:{scope:string;etag?:string;signal?:AbortSignal}):Promise<AppLocalRead<RelayWorkspace>|null>{
  if(name!=="staff.relay")return null;
  if(Object.keys(args).length!==1||typeof args.staffId!=="string"||!/^[0-9a-f-]{36}$/i.test(args.staffId))fail(400,"Invalid staff workspace.");
  const identity=await getStaffPortalIdentity();
  if(!identity.context.user)fail(401,"Please sign in again.");
  if(!identity.staff||identity.staff.id!==args.staffId||!identity.context.currentSalon)fail(403,"Your staff access has changed.");
  if(getExperienceContext(identity.context).scope!==options.scope)fail(409,"Your staff workspace has changed.");
  if(options.signal?.aborted)throw options.signal.reason;
  const result=await loadServiceRelay();if(!result.data)fail(503,"Could not update your current customer.");
  if(result.data.installed&&result.data.staffId!==identity.staff.id)fail(409,"Your staff workspace has changed.");
  if(options.signal?.aborted)throw options.signal.reason;
  const etag='"'+createHash("sha256").update(JSON.stringify([options.scope,args.staffId,result.data])).digest("hex")+'"';
  return{schemaVersion:1,status:options.etag===etag?304:200,scope:options.scope,etag,updatedAt:Date.now(),...(options.etag===etag?{}:{data:result.data})};
}
