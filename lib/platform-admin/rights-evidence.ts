import 'server-only';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import type {RightsImageEvidenceState} from '@/types/rights-evidence';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const statuses=new Set(['blocked_policy','escalation_required','capture_queued','capturing','evidence_ready','removal_blocked','removing','origin_removed','purging','purged','conflict','erasure_owned']);
const removalReasons=new Set(['permission','unavailable','policy_or_safety','capture_required','erasure_owned','shared_references','already_requested']);
export type RightsCaseEvidence={caseId:string;policyEnabled:boolean;canCapture:boolean;blockedReason:null|'permission'|'policy_disabled'|'special_safety'|'unavailable';photos:Array<{objectId:string;evidenceId:string|null;state:RightsImageEvidenceState|null}>};
export type RightsCaptureInput={caseId:string;objectId:string;requestId:string;reason:string;ordinaryConfirmed:true};
export type RightsRemovalInput={caseId:string;evidenceId:string;requestId:string;expectedVersion:string;reason:string};
export type RightsOperatorResult={ok:true;workspace:RightsCaseEvidence;message:string}|{ok:false;code:'unknown'|'stale'|'permission'|'unavailable'|'conflict';message:string;workspace?:RightsCaseEvidence};
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function uuid(value:unknown):value is string{return typeof value==='string'&&UUID.test(value);}
function date(value:unknown){return value===null||typeof value==='string'&&value.length<=64&&Number.isFinite(Date.parse(value));}
function parseState(value:unknown):RightsImageEvidenceState|null{
 if(!object(value)||!uuid(value.id)||!uuid(value.caseId)||typeof value.status!=='string'||!statuses.has(value.status)||typeof value.version!=='string'||!/^[a-f0-9]{64}$/.test(value.version)||typeof value.captured!=='boolean'||typeof value.originRemoved!=='boolean'||!['unknown','ordinary','suspected_csam','known_csam'].includes(String(value.safetyClassification))||!date(value.retainUntil)||typeof value.hasLegalHold!=='boolean'||!date(value.legalHoldReviewAt)||typeof value.canRequestRemoval!=='boolean'||value.removalBlockedReason!==null&&!removalReasons.has(String(value.removalBlockedReason)))return null;
 if(value.canRequestRemoval&&(!value.captured||value.originRemoved||value.safetyClassification!=='ordinary'||value.removalBlockedReason!==null))return null;
 // Explicit projection: never serialize an unexpected upstream path/hash/secret.
 return{id:value.id,caseId:value.caseId,status:value.status,version:value.version,captured:value.captured,originRemoved:value.originRemoved,safetyClassification:value.safetyClassification as RightsImageEvidenceState['safetyClassification'],retainUntil:value.retainUntil as string|null,hasLegalHold:value.hasLegalHold,legalHoldReviewAt:value.legalHoldReviewAt as string|null,canRequestRemoval:value.canRequestRemoval,removalBlockedReason:value.removalBlockedReason as RightsImageEvidenceState['removalBlockedReason']};
}
export function parseRightsCaseEvidence(value:unknown,caseId:string):RightsCaseEvidence|null{
 if(!object(value)||value.caseId!==caseId||!uuid(value.caseId)||typeof value.policyEnabled!=='boolean'||typeof value.canCapture!=='boolean'||value.canCapture&&(!value.policyEnabled||value.blockedReason!==null)||value.blockedReason!==null&&!['permission','policy_disabled','special_safety','unavailable'].includes(String(value.blockedReason))||!Array.isArray(value.photos)||value.photos.length>32)return null;
 const photos:RightsCaseEvidence['photos']=[],seen=new Set<string>();
 for(const photo of value.photos){if(!object(photo)||!uuid(photo.objectId)||seen.has(photo.objectId)||photo.evidenceId!==null&&!uuid(photo.evidenceId))return null;seen.add(photo.objectId);const state=photo.state===null?null:parseState(photo.state);if(photo.state!==null&&!state||state&&(state.id!==photo.evidenceId||state.caseId!==caseId)||photo.evidenceId===null&&state)return null;photos.push({objectId:photo.objectId,evidenceId:photo.evidenceId as string|null,state});}
 return{caseId,policyEnabled:value.policyEnabled,canCapture:value.canCapture,blockedReason:value.blockedReason as RightsCaseEvidence['blockedReason'],photos};
}
type Client=NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
async function load(client:Client,caseId:string){const r=await client.rpc('get_admin_rights_case_evidence',{p_case_id:caseId});return r.error?null:parseRightsCaseEvidence(r.data,caseId);}
export async function loadRightsCaseEvidence(caseId:string):Promise<RightsCaseEvidence|null>{if(!uuid(caseId))return null;try{const client=await createAuthenticatedSupabaseServerClient();return client?await load(client,caseId):null;}catch{return null;}}
const unknown=():RightsOperatorResult=>({ok:false,code:'unknown',message:'The request result is not confirmed. Keep this reason and confirm the same request.'});
function error(code:unknown):RightsOperatorResult{if(code==='42501')return{ok:false,code:'permission',message:'Only the currently assigned, authorized operator can make this request.'};if(code==='22023'||code==='23514')return{ok:false,code:'conflict',message:'This request conflicts with the current case. Refresh before starting another decision.'};if(code==='PGRST202'||code==='42883')return{ok:false,code:'unavailable',message:'Evidence handling needs a data-service update.'};return unknown();}
function validReason(reason:unknown):reason is string{return typeof reason==='string'&&reason.trim().length>=3&&reason.trim().length<=2000;}
const invalid=():RightsOperatorResult=>({ok:false,code:'conflict',message:'Use the current case and a reason of 3–2,000 characters.'});
export async function captureRightsEvidence(input:RightsCaptureInput):Promise<RightsOperatorResult>{
 if(!input||input.ordinaryConfirmed!==true||!uuid(input.caseId)||!uuid(input.objectId)||!uuid(input.requestId)||!validReason(input.reason))return invalid();
 try{const client=await createAuthenticatedSupabaseServerClient();if(!client)return error('42501');
  // The SQL receipt lookup precedes mutable photo/policy admission on retries.
  const r=await client.rpc('request_rights_image_evidence',{p_case_id:input.caseId,p_object_id:input.objectId,p_request_id:input.requestId,p_safety_classification:'ordinary',p_reason:input.reason.trim(),p_remove_origin:false});
  if(r.error)return error(r.error.code);if(!object(r.data)||!uuid(r.data.id)||typeof r.data.status!=='string'||!statuses.has(r.data.status))return unknown();
  const workspace=await load(client,input.caseId);return workspace?{ok:true,workspace,message:'Private capture requested. The original photo has not been removed.'}:unknown();
 }catch{return unknown();}
}
export async function requestRightsOriginRemoval(input:RightsRemovalInput):Promise<RightsOperatorResult>{
 if(!input||!uuid(input.caseId)||!uuid(input.evidenceId)||!uuid(input.requestId)||typeof input.expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedVersion)||!validReason(input.reason))return invalid();
 try{const client=await createAuthenticatedSupabaseServerClient();if(!client)return error('42501');
  const identity=await client.rpc('get_admin_rights_image_evidence_state',{p_id:input.evidenceId});if(identity.error)return error(identity.error.code);const current=parseState(identity.data);if(!current)return unknown();if(current.id!==input.evidenceId||current.caseId!==input.caseId)return error('42501');
  // Identity is checked above; current canRequestRemoval/version is authoritative
  // inside SQL, AFTER its immutable same-request receipt lookup.
  const r=await client.rpc('request_rights_origin_removal',{p_evidence_id:input.evidenceId,p_request_id:input.requestId,p_expected_version:input.expectedVersion,p_reason:input.reason.trim()});
  if(r.error)return error(r.error.code);if(!object(r.data)||typeof r.data.ok!=='boolean')return unknown();
  if(!r.data.ok){if(!['stale','unavailable','conflict'].includes(String(r.data.code)))return unknown();const workspace=await load(client,input.caseId);return{ok:false,code:r.data.code as 'stale'|'unavailable'|'conflict',message:r.data.code==='stale'?'The case or photo changed. Refresh and review the current evidence.':'Original removal is not available for the current case.',...(workspace?{workspace}:{})};}
  const workspace=await load(client,input.caseId);return workspace?{ok:true,workspace,message:'Removal request recorded. The original is not marked removed until processing confirms its absence.'}:unknown();
 }catch{return unknown();}
}
