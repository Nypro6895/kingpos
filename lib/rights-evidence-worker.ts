import "server-only";
import type {RightsImageEvidenceRow} from '@/types/rights-evidence';
import {RIGHTS_EVIDENCE_BUCKET,RIGHTS_EVIDENCE_REQUEST_MS,RightsEvidenceMismatchError,isRightsEvidenceUuid,isRightsEvidenceSha256,isRightsEvidenceVersion,isRightsEvidenceBytes,isRightsEvidencePublicObjectPath,rightsEvidencePrivatePath,rightsEvidenceServiceClient,verifiedRightsEvidenceBytes} from './rights-evidence-storage';

type Client=ReturnType<typeof rightsEvidenceServiceClient>;
export type RightsEvidenceStage='capture'|'remove_origin'|'purge';
type Claimed=RightsImageEvidenceRow&{stage:RightsEvidenceStage;lease_token:string;leased_until:string};
type Outcome='captured'|'removed'|'purged'|'failed'|'deferred'|'blocked';
type Failure='source_mismatch'|'private_mismatch'|'storage_failed'|'time_budget';
export type RightsEvidenceCounts={claimed:number;captured:number;removed:number;purged:number;failed:number;deferred:number;blocked:number};
const MAX_BATCH=1,WORK_BUDGET_MS=45000;

/** SQL claim + fresh revalidation are the policy/operator/risk authority. */
export function isRightsEvidenceRow(value:unknown,stage:RightsEvidenceStage|'read',now=Date.now()):value is RightsImageEvidenceRow{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const r=value as Record<string,unknown>;
 if(r.stage!==stage||!isRightsEvidenceUuid(r.id)||!isRightsEvidenceUuid(r.case_id)||!isRightsEvidenceUuid(r.source_object_id)||!isRightsEvidenceVersion(r.source_version)||!isRightsEvidenceVersion(r.source_etag)||!isRightsEvidenceSha256(r.sha256)||!isRightsEvidenceBytes(r.bytes)||r.mime!=='image/webp'||!isRightsEvidencePublicObjectPath(r.source_bucket,r.source_path)||r.evidence_bucket!==RIGHTS_EVIDENCE_BUCKET||r.evidence_path!==rightsEvidencePrivatePath(r.case_id,r.id)||!Object.hasOwn(r,'retain_until'))return false;
 if(r.retain_until!==null&&(typeof r.retain_until!=='string'||!Number.isFinite(Date.parse(r.retain_until))))return false;
 if(stage==='purge'){if(r.retain_until===null||Date.parse(r.retain_until as string)>now)return false;}
 else if(r.retain_until!==null&&Date.parse(r.retain_until as string)<=now)return false;
 const privatePins=isRightsEvidenceUuid(r.private_object_id)&&isRightsEvidenceVersion(r.private_version)&&isRightsEvidenceVersion(r.private_etag);
 if(stage!=='capture'&&!privatePins)return false;
 if(stage==='capture'&&!privatePins&&![r.private_object_id,r.private_version,r.private_etag].every(v=>v===null))return false;
 if(stage==='read')return r.lease_token===null&&r.leased_until===null;
 return isRightsEvidenceUuid(r.lease_token)&&typeof r.leased_until==='string'&&Number.isFinite(Date.parse(r.leased_until))&&Date.parse(r.leased_until)>now;
}
function canRequest(row:Claimed,deadline:number){const now=Date.now();return now<deadline&&Date.parse(row.leased_until)-now>RIGHTS_EVIDENCE_REQUEST_MS&&(row.stage==='purge'||row.retain_until===null||Date.parse(row.retain_until)>now);}
async function revalidate(client:Client,row:Claimed,deadline:number){if(!canRequest(row,deadline))return false;try{const r=await client.rpc('revalidate_rights_image_evidence',{p_id:row.id,p_lease:row.lease_token});return !r.error&&r.data===true&&canRequest(row,deadline);}catch{return false;}}
async function fail(client:Client,row:Claimed,deadline:number,error:Failure){if(!canRequest(row,deadline))return;try{await client.rpc('fail_rights_image_evidence',{p_id:row.id,p_lease:row.lease_token,p_error:error});}catch{/* Lease expiry is the bounded retry fallback. */}}
async function download(client:Client,bucket:string,key:string,row:Claimed){const result=await client.storage.from(bucket).download(key);if(result.error||!result.data)throw new Error();return verifiedRightsEvidenceBytes(result.data,row.bytes,row.sha256);}
async function finish(client:Client,row:Claimed,deadline:number,name:string):Promise<boolean>{if(!canRequest(row,deadline))return false;try{const r=await client.rpc(name,{p_id:row.id,p_lease:row.lease_token});return !r.error&&r.data===true;}catch{return false;}}

export async function processRightsImageEvidence(client:Client,input:unknown,stage:RightsEvidenceStage,deadline:number):Promise<Outcome>{
 if(!Number.isFinite(deadline)||!isRightsEvidenceRow(input,stage))return 'failed';const row=input as Claimed;
 if(!canRequest(row,deadline))return 'deferred';
 if(!await revalidate(client,row,deadline))return 'blocked';
 if(stage==='capture'){
  let bytes:Buffer;
  try{bytes=await download(client,row.source_bucket,row.source_path,row);}catch(error){await fail(client,row,deadline,error instanceof RightsEvidenceMismatchError?'source_mismatch':'storage_failed');return 'failed';}
  if(!canRequest(row,deadline))return 'deferred';
  if(!await revalidate(client,row,deadline))return 'blocked';
  // A lost upload response is not approval. Reuse is permitted only after the
  // existing immutable private object is read and its complete bytes match.
  try{await client.storage.from(RIGHTS_EVIDENCE_BUCKET).upload(row.evidence_path,bytes,{contentType:'image/webp',upsert:false,cacheControl:'0',metadata:{sha256:row.sha256}});}catch{/* Verify the exact reserved object before any capture checkpoint. */}
  if(!canRequest(row,deadline))return 'deferred';
  if(!await revalidate(client,row,deadline))return 'blocked';
  try{await download(client,RIGHTS_EVIDENCE_BUCKET,row.evidence_path,row);}catch(error){await fail(client,row,deadline,error instanceof RightsEvidenceMismatchError?'private_mismatch':'storage_failed');return 'failed';}
  if(!canRequest(row,deadline))return 'deferred';
  return await finish(client,row,deadline,'finish_rights_image_evidence_capture')?'captured':'failed';
 }
 if(stage==='remove_origin'){
  // Re-read the pinned private bytes on the removal pass. A metadata-only
  // capture receipt cannot authorize public origin deletion by itself.
  try{await download(client,RIGHTS_EVIDENCE_BUCKET,row.evidence_path,row);}catch(error){await fail(client,row,deadline,error instanceof RightsEvidenceMismatchError?'private_mismatch':'storage_failed');return 'failed';}
  if(!canRequest(row,deadline))return 'deferred';
  if(!await revalidate(client,row,deadline))return 'blocked';
  try{const removed=await client.storage.from(row.source_bucket).remove([row.source_path]);if(removed.error)throw new Error();}catch{await fail(client,row,deadline,'storage_failed');return 'failed';}
  if(!canRequest(row,deadline))return 'deferred';
  return await finish(client,row,deadline,'finish_rights_image_evidence_removal')?'removed':'failed';
 }
 try{const removed=await client.storage.from(RIGHTS_EVIDENCE_BUCKET).remove([row.evidence_path]);if(removed.error)throw new Error();}catch{await fail(client,row,deadline,'storage_failed');return 'failed';}
 if(!canRequest(row,deadline))return 'deferred';
 return await finish(client,row,deadline,'finish_rights_image_evidence_purge')?'purged':'failed';
}

/** One stage per bounded pass. Never capture and remove in the same loop. */
export async function runRightsImageEvidence(stage:RightsEvidenceStage='capture',client:Client=rightsEvidenceServiceClient()):Promise<RightsEvidenceCounts>{
 if(!['capture','remove_origin','purge'].includes(stage))throw new Error('Evidence stage is unavailable.');
 const deadline=Date.now()+WORK_BUDGET_MS;
 let jobs:unknown[];
 try{const r=await client.rpc('claim_rights_image_evidence',{p_stage:stage,p_limit:MAX_BATCH});if(r.error||!Array.isArray(r.data)||r.data.length>MAX_BATCH)throw new Error();jobs=r.data;}catch{throw new Error('Private evidence work could not be read.');}
 const counts:RightsEvidenceCounts={claimed:jobs.length,captured:0,removed:0,purged:0,failed:0,deferred:0,blocked:0};
 for(const row of jobs){const outcome=await processRightsImageEvidence(client,row,stage,deadline);if(outcome==='captured'||outcome==='removed'||outcome==='purged')counts[outcome]++;else{counts.failed++;if(outcome==='deferred')counts.deferred++;if(outcome==='blocked')counts.blocked++;}}
 // No source paths, reviewer identities, object bytes or raw provider errors.
 return counts;
}
