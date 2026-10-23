"use client";
import { getAppLocalHost } from "./app-local-host";
import { APP_LOCAL_FILE_ACTIONS, APP_LOCAL_UPLOAD_BUCKET, appLocalUploadFileKeys, appLocalUploadAllowsType, isAppLocalFileAction, type AppLocalPreparedUpload, type AppLocalUploadFileDescriptor, type AppLocalUploadResult } from "./app-local-upload-policy";

type Handled = { handled: false } | ({ handled: true } & AppLocalUploadResult);
const pending=new WeakMap<FormData,{action:string;scope:string;operation:Promise<Handled>}>();
const uncertain="The result could not be confirmed. Check the current record before trying again.";
function uploadURL(value: AppLocalPreparedUpload,href=value.uploadUrl,index=0) {
  const configured=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL??""),url=new URL(href);
  if(configured.protocol!=="https:"||!configured.hostname.endsWith(".supabase.co")||configured.port||configured.username||configured.password||url.origin!==configured.origin||url.username||url.password||url.hash||url.pathname!==`/storage/v1/object/upload/sign/${APP_LOCAL_UPLOAD_BUCKET}/v1/${value.sessionId}${index?"/"+index:""}`||Array.from(url.searchParams).length!==1||!url.searchParams.get("token")||!/^[a-f0-9-]{36}$/i.test(value.sessionId)||!Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Date.now()+11*60_000)throw new Error("The attachment could not be prepared. Please choose it again.");
  return url.href;
}
async function send(action: keyof typeof APP_LOCAL_FILE_ACTIONS,form: FormData,scope: string):Promise<Handled> {
  const rule=APP_LOCAL_FILE_ACTIONS[action],fileKeys=appLocalUploadFileKeys(action),chosen=fileKeys.flatMap(key=>{const file=form.get(key);return file instanceof File&&file.size>0?[{key,file}]:[];});
  if(!chosen.length||chosen.some(({file})=>file.size>rule.maxBytes||!appLocalUploadAllowsType(action,file.type)))throw new Error(rule.kind==="support"?"Choose a PNG, JPG, WebP or PDF file up to 5 MB.":rule.kind.startsWith("pos-")?"Choose JPEG, PNG or WebP images up to 15 MB each.":rule.kind==="creative"?"Choose a JPG, PNG or WebP image under 5 MB.":"Choose a PDF, PNG, JPEG or WebP paystub up to 10 MB.");
  const fields:Record<string,string>={};
  for(const key of rule.fields){const value=form.get(key);if(value!==null){if(typeof value!=="string"||value.length>(key==="expected"?16384:4096))throw new Error("Please open the form again.");fields[key]=value;}}
  for(const [key,value]of form)if(value instanceof Blob&&!fileKeys.includes(key))throw new Error("Choose only the attachments shown on this form.");
  if(!crypto.subtle)throw new Error("Open the online page to attach this file.");
  const host=getAppLocalHost(),abort=new AbortController();let stale=false,sessionId:string|undefined,finalizing=false;
  const generation=typeof window!=="undefined"?window.__reylumiAppLocalContext?.generation:undefined;
  const current=()=>!stale&&(!generation||window.__reylumiAppLocalContext?.generation===generation);
  const reset=()=>{stale=true;if(!finalizing)abort.abort();};
  window.addEventListener("reylumi:app-local-reset",reset);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const files:AppLocalUploadFileDescriptor[]=[];
    // Hash and transfer each file in sequence, keeping mobile peak memory to
    // one selected file rather than materializing a 45MiB three-file command.
    for(const {key,file}of chosen){const sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer())),byte=>byte.toString(16).padStart(2,"0")).join("");files.push({key,name:file.name,type:file.type,size:file.size,sha256});}
    if(!current())throw new Error("Your account changed. Please open the page again.");
    const {key:singleKey,...singleFile}=files[0];void singleKey;
    const prepared=await host.command<AppLocalPreparedUpload>("upload.prepare",{action,fields,...(fileKeys.length>1?{files}:{file:singleFile})},{scope});
    sessionId=prepared.sessionId;
    const urls=fileKeys.length>1?prepared.files:undefined;
    if(fileKeys.length>1&&(!Array.isArray(urls)||urls.length!==chosen.length||urls.some((row,index)=>row.key!==chosen[index].key)))throw new Error("The attachments could not be prepared. Please choose them again.");
    if(!current())throw new Error("Your account changed. Please open the page again.");
    // Signed PUT needs no session cookies, bearer credentials or arbitrary URL
    // forwarding. It is one request to this app's pinned private stage object.
    for(let index=0;index<chosen.length;index++){
    const file=chosen[index].file,url=uploadURL(prepared,urls?.[index].uploadUrl??prepared.uploadUrl,index);
    if(!current())throw new Error("Your account changed. Please open the page again.");
    const body=new FormData();body.set("cacheControl","0");body.append("",file,file.name);
    timer=setTimeout(()=>abort.abort(),120_000);
    const response=await fetch(url,{method:"PUT",credentials:"omit",mode:"cors",redirect:"error",cache:"no-store",headers:{"x-upsert":"false"},body,signal:abort.signal});
    clearTimeout(timer);timer=undefined;
    if(!response.ok)throw new Error("The attachment could not finish uploading. Please choose it again.");
    }
    if(!current())throw new Error("Your account changed. Please open the page again.");
    finalizing=true;
    let result:AppLocalUploadResult;
    try {result=await host.command<AppLocalUploadResult>("upload.finalize",{sessionId},{scope});}
    catch {
      // A readback can recover a lost response; it never repeats finalization
      // or the original business write after an ambiguous network result.
      const status=await host.command<{status:string;result?:AppLocalUploadResult}>("upload.status",{sessionId},{scope}).catch(()=>null);
      if(status?.status!=="succeeded"||!status.result)throw new Error(uncertain);
      result=status.result;
    }
    if(!current())throw new Error("Your account changed. Check the current record before continuing.");
    return {handled:true,...result};
  }catch(error){
    if(sessionId&&!finalizing)void host.command("upload.cancel",{sessionId},{scope}).catch(()=>{});
    throw error;
  }finally{if(timer)clearTimeout(timer);window.removeEventListener("reylumi:app-local-reset",reset);}
}
/** Called before the ordinary bounded command codec. All other actions retain
 * their existing transport. No File bytes enter a command, cache or outbox. */
export async function handlesAppLocalFileCommand(name:string,originalValues:unknown[],scope:string):Promise<Handled> {
  if(!isAppLocalFileAction(name))return {handled:false};
  if(originalValues.length!==1||!(originalValues[0] instanceof FormData)||!/^v3:[a-f0-9]{64}$/.test(scope))throw new Error("Please open the form again.");
  const form=originalValues[0],existing=pending.get(form);
  if(APP_LOCAL_FILE_ACTIONS[name].kind.startsWith("pos-")&&!appLocalUploadFileKeys(name).some(key=>{const file=form.get(key);return file instanceof File&&file.size>0;}))return {handled:false};
  if(existing){if(existing.action!==name||existing.scope!==scope)throw new Error("Your account changed. Please open the form again.");return existing.operation;}
  const operation=send(name,form,scope);pending.set(form,{action:name,scope,operation});
  try{return await operation;}finally{if(pending.get(form)?.operation===operation)pending.delete(form);}
}
