import type {RightsCaptureInput,RightsRemovalInput} from './platform-admin/rights-evidence';

export type RightsEvidenceIntent={kind:'capture';objectId:string;input:RightsCaptureInput}|{kind:'remove';objectId:string;input:RightsRemovalInput};
export type RightsEvidenceSavedIntent={version:1;actorId:string;caseId:string;createdAt:number;expiresAt:number;attempt:RightsEvidenceIntent};
type Store=Pick<Storage,'length'|'key'|'getItem'|'setItem'|'removeItem'>;
const PREFIX='rights-evidence-pending:v1:',TTL=30*60*1000,MAX_BYTES=16384,MAX_COUNT=4;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const unavailable=()=>new Error('Recovery storage is unavailable. No new request was sent.');
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
function exact(v:Record<string,unknown>,names:string[]){return Object.keys(v).length===names.length&&names.every(n=>Object.hasOwn(v,n));}
function uuid(v:unknown):v is string{return typeof v==='string'&&UUID.test(v);}
function key(actor:string,caseId:string){if(!uuid(actor)||!uuid(caseId))throw unavailable();return PREFIX+actor+':'+caseId;}
function parse(raw:string):RightsEvidenceSavedIntent|null{
 if(new TextEncoder().encode(raw).length>MAX_BYTES)return null;
 try{const e:unknown=JSON.parse(raw);if(!object(e)||!exact(e,['version','actorId','caseId','createdAt','expiresAt','attempt'])||e.version!==1||!uuid(e.actorId)||!uuid(e.caseId)||typeof e.createdAt!=='number'||!Number.isSafeInteger(e.createdAt)||typeof e.expiresAt!=='number'||e.expiresAt-e.createdAt!==TTL||!object(e.attempt)||!exact(e.attempt,['kind','objectId','input'])||!uuid(e.attempt.objectId)||!object(e.attempt.input))return null;
  const a=e.attempt,i=a.input;if(!object(i)||!uuid(i.caseId)||i.caseId!==e.caseId||!uuid(i.requestId)||typeof i.reason!=='string'||i.reason!==i.reason.trim()||i.reason.length<3||i.reason.length>2000)return null;
  if(a.kind==='capture'){if(!exact(i,['caseId','objectId','requestId','reason','ordinaryConfirmed'])||i.objectId!==a.objectId||i.ordinaryConfirmed!==true)return null;}
  else if(a.kind==='remove'){if(!exact(i,['caseId','evidenceId','requestId','expectedVersion','reason'])||!uuid(i.evidenceId)||typeof i.expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(i.expectedVersion))return null;}
  else return null;return e as RightsEvidenceSavedIntent;
 }catch{return null;}
}
export function readRightsEvidenceIntent(storage:Store,actor:string,caseId:string,now=Date.now()):{status:'none'|'expired'|'invalid'|'unavailable'}|{status:'saved';value:RightsEvidenceSavedIntent}{
 try{const k=key(actor,caseId),raw=storage.getItem(k);if(raw===null)return{status:'none'};const saved=parse(raw);if(!saved||saved.actorId!==actor||saved.caseId!==caseId||saved.createdAt>now+60000)return{status:'invalid'};if(saved.expiresAt<=now){storage.removeItem(k);return{status:'expired'};}return{status:'saved',value:saved};}catch{return{status:'unavailable'};}
}
/** Persist/read back BEFORE dispatch. Never evict another valid pending case. */
export function saveRightsEvidenceIntent(storage:Store,actor:string,caseId:string,attempt:RightsEvidenceIntent,now=Date.now()):RightsEvidenceSavedIntent{
 try{
  const k=key(actor,caseId),existing=readRightsEvidenceIntent(storage,actor,caseId,now);
  if(existing.status==='saved'){if(JSON.stringify(existing.value.attempt)!==JSON.stringify(attempt))throw unavailable();return existing.value;}
  if(!['none','expired'].includes(existing.status))throw unavailable();
  if(storage.length>2048)throw unavailable();const names:string[]=[];for(let i=0;i<storage.length;i++){const n=storage.key(i);if(n?.startsWith(PREFIX))names.push(n);}
  let count=0;for(const n of names){const raw=storage.getItem(n),saved=raw===null?null:parse(raw);if(saved&&saved.expiresAt<=now)storage.removeItem(n);else count++;}
  if(count>=MAX_COUNT)throw unavailable();
  const value:RightsEvidenceSavedIntent={version:1,actorId:actor,caseId,createdAt:now,expiresAt:now+TTL,attempt};const raw=JSON.stringify(value);if(!parse(raw))throw unavailable();storage.setItem(k,raw);if(storage.getItem(k)!==raw)throw unavailable();return value;
 }catch{throw unavailable();}
}
/** A late A response cannot clear B or a newer request in the same case. */
export function clearRightsEvidenceIntent(storage:Store,actor:string,caseId:string,requestId:string):boolean{
 try{const k=key(actor,caseId),raw=storage.getItem(k),saved=raw===null?null:parse(raw);if(!saved||saved.actorId!==actor||saved.caseId!==caseId||saved.attempt.input.requestId!==requestId)return false;storage.removeItem(k);return storage.getItem(k)===null;}catch{return false;}
}
