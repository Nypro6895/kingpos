import "server-only";
import {createHash} from "node:crypto";
import {createClient} from "@supabase/supabase-js";

/** Technical bound for normalized, approved public post stills; not a retention policy. */
export const RIGHTS_EVIDENCE_MAX_BYTES=512000;
export const RIGHTS_EVIDENCE_REQUEST_MS=12000;
export const RIGHTS_EVIDENCE_BUCKET='rights-review-evidence' as const;
const UUID="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN=new RegExp(`^${UUID}$`);
export function isRightsEvidenceUuid(value:unknown):value is string{return typeof value==='string'&&UUID_PATTERN.test(value);}
export function isRightsEvidenceSha256(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
export function isRightsEvidenceVersion(value:unknown):value is string{return typeof value==='string'&&value.trim().length>0&&value.length<=1024&&!/[\u0000-\u001f\u007f]/.test(value);}
export function isRightsEvidenceBytes(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=RIGHTS_EVIDENCE_MAX_BYTES;}
export function rightsEvidencePrivatePath(caseId:string,evidenceId:string):string{return `v1/${caseId}/${evidenceId}.webp`;}
export function isRightsEvidencePrivatePath(value:unknown):value is string{return typeof value==='string'&&new RegExp(`^v1/${UUID}/${UUID}[.]webp$`).test(value);}

/** Reject identity/financial buckets, encoded/traversal paths, and cross-owner scopes. */
export function isRightsEvidencePublicPath(bucket:unknown,objectPath:unknown,userId:unknown,salonId:unknown):boolean{
 if(typeof objectPath!=='string'||!isRightsEvidenceUuid(userId))return false;
 if(bucket==='beauty-profile-media')return new RegExp(`^${userId}/beauty/(?:image|before|after)/${UUID}[.]webp$`).test(objectPath);
 return bucket==='salon-profile-media'&&isRightsEvidenceUuid(salonId)&&new RegExp(`^${salonId}/(?:looks/${UUID}/${UUID}|updates/${UUID})[.]webp$`).test(objectPath);
}

export class RightsEvidenceStorageError extends Error{
 constructor(){super('Private evidence storage is temporarily unavailable.');this.name='RightsEvidenceStorageError';}
}
export class RightsEvidenceMismatchError extends RightsEvidenceStorageError{
 constructor(){super();this.name='RightsEvidenceMismatchError';}
}

/** Complete bytes are verified before a checkpoint or any authorized response. */
export async function verifiedRightsEvidenceBytes(blob:unknown,expectedBytes:unknown,expectedSha256:unknown):Promise<Buffer>{
 if(!(blob instanceof Blob)||!isRightsEvidenceBytes(expectedBytes)||!isRightsEvidenceSha256(expectedSha256)||blob.size!==expectedBytes||blob.type.split(';')[0].toLowerCase()!=='image/webp')throw new RightsEvidenceMismatchError();
 let bytes:Buffer;
 try{
  bytes=Buffer.from(await blob.arrayBuffer());
 }catch{throw new RightsEvidenceStorageError();}
 if(bytes.length!==expectedBytes||createHash('sha256').update(bytes).digest('hex')!==expectedSha256)throw new RightsEvidenceMismatchError();
 return bytes;
}

/** Single bounded range only. null means the header is invalid/unsatisfiable. */
export function rightsEvidenceRange(header:string|null,size:number):{start:number;end:number}|null{
 if(!isRightsEvidenceBytes(size))return null;
 if(header===null)return{start:0,end:size-1};
 if(header.length>100)return null;
 const match=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!match||(!match[1]&&!match[2]))return null;
 if(!match[1]){
  const suffix=Number(match[2]);
  return Number.isSafeInteger(suffix)&&suffix>0?{start:Math.max(0,size-suffix),end:size-1}:null;
 }
 const start=Number(match[1]),end=match[2]?Number(match[2]):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;
 return{start,end:Math.min(end,size-1)};
}

const SERVICE_RPCS=new Set(['claim_rights_image_evidence','revalidate_rights_image_evidence','finish_rights_image_evidence_capture','finish_rights_image_evidence_removal','finish_rights_image_evidence_purge','fail_rights_image_evidence']);
export function isRightsEvidencePublicObjectPath(bucket:unknown,key:unknown){if(typeof bucket!=='string'||typeof key!=='string')return false;const prefix=key.split('/')[0];return isRightsEvidencePublicPath(bucket,key,prefix,bucket==='salon-profile-media'?prefix:null);}
function allowedStorageRequest(url:URL,method:string,init:RequestInit){
 if(url.search||url.hash)return false;
 if(method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/'))return SERVICE_RPCS.has(url.pathname.slice('/rest/v1/rpc/'.length));
 const object=/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)(?:\/(.+))?$/.exec(url.pathname);
 if(!object)return false;const [,bucket,key]=object;
 if(method==='GET'&&key)return bucket===RIGHTS_EVIDENCE_BUCKET?isRightsEvidencePrivatePath(key):isRightsEvidencePublicObjectPath(bucket,key);
 if(method==='POST'&&bucket===RIGHTS_EVIDENCE_BUCKET&&isRightsEvidencePrivatePath(key)){
  const headers=new Headers(init.headers),body=init.body;
  const size=body instanceof ArrayBuffer?body.byteLength:ArrayBuffer.isView(body)?body.byteLength:0;
  return headers.get('x-upsert')!=='true'&&headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='image/webp'&&isRightsEvidenceBytes(size);
 }
 if(method==='DELETE'&&!key&&typeof init.body==='string'){
  try{const body=JSON.parse(init.body);if(!body||Object.keys(body).length!==1||!Array.isArray(body.prefixes)||body.prefixes.length!==1)return false;
   return bucket===RIGHTS_EVIDENCE_BUCKET?isRightsEvidencePrivatePath(body.prefixes[0]):typeof body.prefixes[0]==='string'&&isRightsEvidencePublicObjectPath(bucket,body.prefixes[0]);
  }catch{return false;}
 }
 return false;
}

/** Fixed-origin operations, no redirects, bounded time and body before SDK Blob allocation. */
export function createRightsEvidenceFetch(origin:string,fetchImpl:typeof fetch=fetch,timeoutMs=RIGHTS_EVIDENCE_REQUEST_MS):typeof fetch{
 const base=new URL(origin);
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!['','/'].includes(base.pathname)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>RIGHTS_EVIDENCE_REQUEST_MS)throw new RightsEvidenceStorageError();
 return async(input,init={})=>{
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined,response:Response|undefined,completed=false;
  const controller=new AbortController();
  try{
   const url=new URL(input instanceof Request?input.url:input.toString()),method=(init.method??(input instanceof Request?input.method:'GET')).toUpperCase();
   if(url.origin!==base.origin||url.username||url.password||!allowedStorageRequest(url,method,init))throw new RightsEvidenceStorageError();
   const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(new RightsEvidenceStorageError());},timeoutMs);});
   const request=async()=>{
    response=await fetchImpl(input,{...init,method,redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:init.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal});
    if(response.redirected||(response.url&&new URL(response.url).origin!==base.origin))throw new RightsEvidenceStorageError();
    const length=response.headers.get('content-length');
    if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>RIGHTS_EVIDENCE_MAX_BYTES))throw new RightsEvidenceStorageError();
    const chunks:Uint8Array[]=[];let size=0;
    if(response.body){reader=response.body.getReader();for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>RIGHTS_EVIDENCE_MAX_BYTES)throw new RightsEvidenceStorageError();chunks.push(part.value);}}
    if(controller.signal.aborted||init.signal?.aborted)throw new RightsEvidenceStorageError();
    completed=true;
    return new Response([204,205,304].includes(response.status)?null:Buffer.concat(chunks),{status:response.status,statusText:response.statusText,headers:response.headers});
   };
   return await Promise.race([request(),expired]);
  }catch{throw new RightsEvidenceStorageError();}
  finally{if(timer)clearTimeout(timer);controller.abort();if(!completed){if(reader)void reader.cancel().catch(()=>{});else if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});}try{reader?.releaseLock();}catch{/* The timed-out reader may still be cancelling. */}}
 };
}

/** Resolve deployment credentials only on invocation; never inspect or log them. */
export function rightsEvidenceServiceClient(options:{url?:string;serviceKey?:string;fetchImpl?:typeof fetch;timeoutMs?:number}={}){
 const url=options.url??process.env.NEXT_PUBLIC_SUPABASE_URL,key=options.serviceKey??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new RightsEvidenceStorageError();
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:createRightsEvidenceFetch(url,options.fetchImpl,options.timeoutMs)}});
}
