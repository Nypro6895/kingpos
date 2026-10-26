import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getRequestBusinessContext } from "./request-business-context";
import { getExperienceContext } from "./experience-context";
import { getCurrentBusinessContext, isSalonManageContext } from "./current-context";
import { createAuthenticatedSupabaseServerClient } from "./supabase/server";
import { hasPermission } from "./permissions";
import { supportServiceClient } from "./support-server";
import { getGuestSupport } from "./guest-support";
import { requirePlatformAdmin } from "./platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "./platform-admin/permissions";
import { uploadSupportEvidence } from "@/app/support/actions";
import { uploadPayrollPaystubAction } from "@/app/payroll/actions";
import { uploadTaxPaystub } from "@/app/tax-company/actions";
import { createCampaignCreativeAction } from "@/app/campaigns/creative-actions";
import { savePosSettingsGroup, updatePosSettingsAction } from "@/app/pos/settings/actions";
import { requireCampaignOwner } from "./owner-campaigns";
import { APP_LOCAL_FILE_ACTIONS, APP_LOCAL_UPLOAD_BUCKET, APP_LOCAL_UPLOAD_COMMANDS, appLocalUploadFileKeys, appLocalUploadAllowsType, isAppLocalFileAction, type AppLocalFileAction, type AppLocalUploadDescriptor, type AppLocalUploadFileDescriptor, type AppLocalUploadResult } from "./app-local-upload-policy";

type Session = {
  id: string; actor_key: string; scope: string; action_name: AppLocalFileAction; target: Record<string,string>;
  file_name: string; mime_type: string; size_bytes: number; file_sha256: string; object_path: string;
  file_manifest?: (AppLocalUploadFileDescriptor & {object_path:string})[];
  status: "pending" | "processing" | "succeeded" | "failed" | "uncertain" | "cancelled";
  result: AppLocalUploadResult | null; expires_at: string;
};
export class AppLocalUploadError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const invalid = (): never => { throw new AppLocalUploadError(400, "Please choose the attachment again."); };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function safeExpected(value:unknown,depth=0):boolean{
  if(depth>8)return false;
  if(Array.isArray(value))return value.length<=100&&value.every(item=>safeExpected(item,depth+1));
  if(value&&typeof value==="object")return Object.entries(value).every(([key,item])=>!/(?:password|passcode|token|secret|credential|cookie|authorization|__proto__|constructor|prototype)/i.test(key)&&safeExpected(item,depth+1));
  return value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value);
}
function fields(action: AppLocalFileAction, input: unknown): Record<string,string> {
  if (!input || typeof input !== "object" || Array.isArray(input) || JSON.stringify(input).length>32768) return invalid();
  const allowed: readonly string[] = APP_LOCAL_FILE_ACTIONS[action].fields;
  const result: Record<string,string> = {};
  for (const [key,value] of Object.entries(input)) {
    if (!allowed.includes(key) || typeof value!=="string" || value.length>(key==="expected"?16384:4096) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return invalid();
    result[key]=value;
  }
  const rule=APP_LOCAL_FILE_ACTIONS[action];
  for(const key of rule.kind==="support"?["caseId"]:rule.kind==="creative"?["id"]:rule.kind.startsWith("pos-")?[]:["payroll_run_id","staff_id"]) if(!uuid(result[key])) return invalid();
  if(result.guestThreadId&&!uuid(result.guestThreadId)||rule.kind==="tax"&&!uuid(result.tax_salon_id))return invalid();
  if(result.return_to&&(!result.return_to.startsWith("/payroll")||result.return_to.startsWith("//")||/[\\\u0000-\u001f]/.test(result.return_to)))return invalid();
  if(rule.kind==="creative"&&(!result.title?.trim()||result.title.trim().length>120||!result.caption?.trim()||result.caption.trim().length>2200))return invalid();
  if(rule.kind==="pos-group"&&result.group!=="display")return invalid();
  if(rule.kind.startsWith("pos-")&&result.expected){let expected:unknown;try{expected=JSON.parse(result.expected);}catch{return invalid();}if(!expected||typeof expected!=="object"||Array.isArray(expected)||!safeExpected(expected))return invalid();}
  return result;
}
function descriptor(action: AppLocalFileAction, input: unknown): AppLocalUploadDescriptor {
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>!["name","type","size","sha256"].includes(key)))return invalid();
  const f=input as AppLocalUploadDescriptor;
  if(typeof f.name!=="string"||!f.name||f.name.length>255||/[\u0000-\u001f]/.test(f.name)||!appLocalUploadAllowsType(action,f.type)||!Number.isSafeInteger(f.size)||f.size<=0||f.size>APP_LOCAL_FILE_ACTIONS[action].maxBytes||typeof f.sha256!=="string"||!/^[a-f0-9]{64}$/.test(f.sha256))return invalid();
  return f;
}
function fileDescriptors(action:AppLocalFileAction,input:unknown):AppLocalUploadFileDescriptor[]{
  const allowed=appLocalUploadFileKeys(action);
  if(!Array.isArray(input)||input.length<1||input.length>allowed.length)return invalid();
  const seen=new Set<string>();return input.map(item=>{if(!item||typeof item!=="object"||Array.isArray(item))return invalid();const {key,...file}=item;if(typeof key!=="string"||!allowed.includes(key)||seen.has(key))return invalid();seen.add(key);return {key,...descriptor(action,file)};});
}
function sessionFiles(row:Session){
  const files=row.file_manifest?fileDescriptors(row.action_name,row.file_manifest.map(({object_path,...file})=>{void object_path;return file;})):[{key:APP_LOCAL_FILE_ACTIONS[row.action_name].fileKey,...descriptor(row.action_name,{name:row.file_name,type:row.mime_type,size:row.size_bytes,sha256:row.file_sha256})}];
  return files.map((file,index)=>{const object_path=row.object_path+(index?"/"+index:"");if(row.file_manifest?.[index].object_path!==undefined&&row.file_manifest[index].object_path!==object_path)return invalid();return {...file,object_path};});
}
/** Preparation checks the same current target boundaries; finalization invokes
 * the exact original handler, which checks them again and preserves its CAS. */
async function authorize(action: AppLocalFileAction, target: Record<string,string>, scope: string): Promise<string> {
  const business=await getRequestBusinessContext();
  if(!/^v3:[a-f0-9]{64}$/.test(scope)||getExperienceContext(business).scope!==scope)throw new AppLocalUploadError(409,"Your workspace changed. Please open the form again.");
  const rule=APP_LOCAL_FILE_ACTIONS[action];
  if(rule.kind==="creative"){
    const owner=await requireCampaignOwner();
    if(!business.user||owner.userId!==business.user.id||owner.salonId!==business.currentSalon?.id)throw new AppLocalUploadError(403,"Switch to your owner workspace to manage campaigns.");
    return "user:"+owner.userId;
  }
  if(rule.kind==="support") {
    if(target.guestThreadId) {
      const conversation=await getGuestSupport(target.guestThreadId);
      if(conversation.id!==target.caseId)throw new AppLocalUploadError(403,"Request unavailable.");
      return "guest:"+target.guestThreadId.toLowerCase();
    }
    if(!business.user)throw new AppLocalUploadError(401,"Please sign in again.");
    const client=await createAuthenticatedSupabaseServerClient();
    if(!client)throw new AppLocalUploadError(401,"Please sign in again.");
    const {data,error}=await client.rpc("get_support_conversation",{p_report_id:target.caseId});
    if(error||!data||data.id!==target.caseId)throw new AppLocalUploadError(403,"Request unavailable.");
    if(data.admin_view)await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.reportsUpdate);
    return "user:"+business.user.id;
  }
  const context=await getCurrentBusinessContext();
  if(!context.user||context.user.id!==business.user?.id)throw new AppLocalUploadError(401,"Please sign in again.");
  const client=await createAuthenticatedSupabaseServerClient();
  if(!client)throw new AppLocalUploadError(401,"Please sign in again.");
  if(rule.kind.startsWith("pos-")){
    if(!isSalonManageContext(context)||!context.currentSalon||!await hasPermission("tickets.manage",context))throw new AppLocalUploadError(403,"You do not have permission to manage POS settings.");
    return "user:"+context.user.id;
  }
  let salonId: string;
  if(rule.kind==="tax") {
    const {data,error}=await client.rpc("tax_company_scope",{p_salon:target.tax_salon_id});
    if(error||!data?.salon||!data?.account||data.salon.id!==target.tax_salon_id)throw new AppLocalUploadError(403,"This salon connection is inactive. Connect again with its current credentials.");
    salonId=data.salon.id;
  } else {
    if(!isSalonManageContext(context)||!context.currentAccount||!context.currentSalon)throw new AppLocalUploadError(403,"Open payroll from a Business workspace.");
    const [manage,tax]=await Promise.all([hasPermission("payroll.manage",context),hasPermission("payroll.tax_company",context)]);
    if(!manage&&!tax)throw new AppLocalUploadError(403,"You do not have permission to upload paystubs.");
    salonId=context.currentSalon.id;
  }
  const {data:run,error:runError}=await client.from("payroll_runs").select("id,status").eq("id",target.payroll_run_id).eq("salon_id",salonId).maybeSingle();
  if(runError||!run)throw new AppLocalUploadError(404,"Payroll statement was not found.");
  if(run.status!=="printed"&&run.status!=="paid")throw new AppLocalUploadError(403,"Upload paystubs after the payroll statement is printed.");
  const {data:line,error:lineError}=await client.from("payroll_staff_lines").select("id").eq("salon_id",salonId).eq("payroll_run_id",run.id).eq("staff_id",target.staff_id).maybeSingle();
  if(lineError||!line)throw new AppLocalUploadError(403,"Paystub upload is only available for payroll staff lines.");
  return "user:"+context.user.id;
}
function service() { return supportServiceClient(); }
async function removeStage(path: string|string[]) {
  try { const {error}=await service().storage.from(APP_LOCAL_UPLOAD_BUCKET).remove(typeof path==="string"?[path]:path);return !error; }catch{return false;}
}
/** Bounded maintenance; also exported for the existing service maintenance job.
 * Immediate terminal cleanup deliberately does not consume this final cleanup. */
export async function cleanupAppLocalUploadStages(limit=8) {
  const client=service();
  const {data,error}=await client.from("app_local_upload_sessions").select("*").is("cleaned_at",null).lt("cleanup_after",new Date().toISOString()).order("cleanup_after").limit(Math.min(32,Math.max(1,limit)));
  if(error||!data)return;
  for(const row of data)if(/^v1\/[a-f0-9-]{36}$/.test(row.object_path)&&isAppLocalFileAction(row.action_name)&&await removeStage(sessionFiles(row as Session).map(file=>file.object_path)))await client.from("app_local_upload_sessions").update({cleaned_at:new Date().toISOString()}).eq("id",row.id);
}
async function findSession(id: unknown): Promise<Session> {
  if(!uuid(id))return invalid();
  const {data,error}=await service().from("app_local_upload_sessions").select("*").eq("id",id).maybeSingle<Session>();
  if(error||!data)throw new AppLocalUploadError(404,"This attachment session is unavailable.");
  if(!isAppLocalFileAction(data.action_name)||data.object_path!=="v1/"+data.id)return invalid();
  fields(data.action_name,data.target);sessionFiles(data);
  return data;
}
async function authorizedSession(id: unknown,scope: string) {
  const row=await findSession(id);
  if(row.scope!==scope)throw new AppLocalUploadError(409,"Your workspace changed. Please open the form again.");
  if(await authorize(row.action_name,row.target,scope)!==row.actor_key)throw new AppLocalUploadError(403,"This attachment belongs to another account.");
  return row;
}
async function finish(row: Session,status: "succeeded"|"failed"|"uncertain",result: AppLocalUploadResult|null=null) {
  const {error}=await service().from("app_local_upload_sessions").update({status,result}).eq("id",row.id).eq("status","processing");
  if(error)throw new AppLocalUploadError(503,"The result could not be confirmed. Check the current record before trying again.");
}
function originalRedirect(error: unknown): string|null {
  const digest=error&&typeof error==="object"&&"digest" in error?String(error.digest):"";
  if(!digest.startsWith("NEXT_REDIRECT;"))return null;
  const path=digest.split(";").slice(2,-2).join(";");
  return path.startsWith("/")&&!path.startsWith("//")&&!/[\\\u0000-\u001f]/.test(path)?path:null;
}
async function finalized(row: Session): Promise<AppLocalUploadResult> {
  // Repeated finalization can return a stored result, never execute an action.
  if(row.status==="succeeded"&&row.result)return row.result;
  if(row.status!=="pending"||Date.parse(row.expires_at)<=Date.now())throw new AppLocalUploadError(409,"The result could not be confirmed. Check the current record before trying again.");
  const client=service();
  const {data,error}=await client.rpc("claim_app_local_upload",{p_id:row.id,p_actor:row.actor_key,p_scope:row.scope});
  const claim=Array.isArray(data)?data[0]:data;
  if(error||!claim)throw new AppLocalUploadError(409,"This attachment is already being processed. Check the current record before trying again.");
  let actionStarted=false;
  try {
    const form=new FormData();for(const [key,value]of Object.entries(row.target))form.set(key,value);
    for(const file of sessionFiles(row)){
    const downloaded=await client.storage.from(APP_LOCAL_UPLOAD_BUCKET).download(file.object_path);
    if(downloaded.error||!downloaded.data)throw new AppLocalUploadError(400,"The attachment did not finish uploading. Choose it again.");
    const blob=downloaded.data;
    if(blob.size!==file.size||blob.type!==file.type||blob.size>APP_LOCAL_FILE_ACTIONS[row.action_name].maxBytes)return invalid();
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(createHash("sha256").update(bytes).digest("hex")!==file.sha256)return invalid();
    // All supported formats have a signature. Support performs its own original
    // check again; paystub content also cannot disguise a different MIME type.
    const valid=file.type==="image/png"?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:file.type==="image/jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:file.type==="application/pdf"?new TextDecoder().decode(bytes.slice(0,5))==="%PDF-":new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
    if(!valid)throw new AppLocalUploadError(400,"The file format does not match its type.");
    form.set(file.key,new File([bytes],file.name,{type:file.type}));
    }
    // Authority might change during the object read. Check immediately before
    // the original handler, which independently authorizes again as usual.
    if(await authorize(row.action_name,row.target,row.scope)!==row.actor_key)throw new AppLocalUploadError(403,"Your access changed. Open the form again.");
    actionStarted=true;let result:AppLocalUploadResult;
    try {
      const kind=APP_LOCAL_FILE_ACTIONS[row.action_name].kind;
      const value=kind==="support"?await uploadSupportEvidence(form):kind==="tax"?await uploadTaxPaystub(form):kind==="creative"?await createCampaignCreativeAction(form):kind==="pos-group"?await savePosSettingsGroup(form):kind==="pos-settings"?await updatePosSettingsAction(form):await uploadPayrollPaystubAction(form);
      result=value===undefined?{}:{value};
    }catch(error){const redirect=originalRedirect(error);if(!redirect)throw error;result={redirect};}
    await finish(row,"succeeded",result);
    return result;
  }catch(error){
    // Once an original action starts, its result may already be committed.
    // No retry path changes processing/uncertain back to pending.
    await finish(row,actionStarted?"uncertain":"failed").catch(()=>{});
    throw error;
  }finally{await removeStage(sessionFiles(row).map(file=>file.object_path));}
}
/** Called only behind the existing command route's strict Origin/body guards.
 * This narrow adapter repeats current scope+target authorization itself, so
 * authenticated and cookie-bound guest Support follow their original rules. */
export async function runAppLocalUploadCommand(name: string,args: Record<string,unknown>,scope: string):Promise<{handled:false}|{handled:true;data:unknown}> {
  if(!Object.hasOwn(APP_LOCAL_UPLOAD_COMMANDS,name))return {handled:false};
  const allowed:readonly string[]=APP_LOCAL_UPLOAD_COMMANDS[name as keyof typeof APP_LOCAL_UPLOAD_COMMANDS].argumentKeys;
  if(Object.keys(args).some(key=>!allowed.includes(key)))return invalid();
  if(name==="upload.prepare") {
    if(typeof args.action!=="string"||!isAppLocalFileAction(args.action))return invalid();
    const action=args.action,target=fields(action,args.fields);
    if(args.file!==undefined&&args.files!==undefined)return invalid();
    const files=args.files!==undefined?fileDescriptors(action,args.files):[{key:APP_LOCAL_FILE_ACTIONS[action].fileKey,...descriptor(action,args.file)}],file=files[0];
    const actor=await authorize(action,target,scope),id=randomUUID(),client=service();
    await cleanupAppLocalUploadStages().catch(()=>{});
    const {data,error}=await client.rpc("prepare_app_local_upload",{p_id:id,p_actor:actor,p_scope:scope,p_action:action,p_target:target,p_file_name:file.name,p_mime:file.type,p_size:file.size,p_sha256:file.sha256,p_files:files});
    const row=(Array.isArray(data)?data[0]:data)as Session|null;
    if(error||!row)throw new AppLocalUploadError(429,"Please finish the current attachment before adding another.");
    const signedFiles:{key:string;uploadUrl:string}[]=[];
    for(const file of sessionFiles(row)){
      const signed=await client.storage.from(APP_LOCAL_UPLOAD_BUCKET).createSignedUploadUrl(file.object_path,{upsert:false});
      if(signed.error||!signed.data){await client.from("app_local_upload_sessions").update({status:"failed"}).eq("id",id).eq("status","pending");throw new AppLocalUploadError(503,"The attachment could not be prepared. Please try again.");}
      const configured=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL??""),url=new URL(signed.data.signedUrl);
      if(configured.protocol!=="https:"||url.origin!==configured.origin||url.pathname!==`/storage/v1/object/upload/sign/${APP_LOCAL_UPLOAD_BUCKET}/${file.object_path}`||url.username||url.password||Array.from(url.searchParams).length!==1||!url.searchParams.get("token"))throw new AppLocalUploadError(503,"The attachment could not be prepared.");
      signedFiles.push({key:file.key,uploadUrl:url.href});
    }
    return {handled:true,data:{sessionId:id,uploadUrl:signedFiles[0].uploadUrl,expiresAt:Date.parse(row.expires_at),...(appLocalUploadFileKeys(action).length>1?{files:signedFiles}:{})}};
  }
  const row=await authorizedSession(args.sessionId,scope);
  if(name==="upload.status")return {handled:true,data:{status:row.status,...(row.status==="succeeded"?{result:row.result}:{})}};
  if(name==="upload.cancel") {
    const {data,error}=await service().from("app_local_upload_sessions").update({status:"cancelled"}).eq("id",row.id).eq("status","pending").select("id");
    if(error)throw new AppLocalUploadError(503,"The attachment could not be cancelled.");
    if(data?.length)await removeStage(sessionFiles(row).map(file=>file.object_path));
    return {handled:true,data:{cancelled:Boolean(data?.length)}};
  }
  return {handled:true,data:await finalized(row)};
}
