import {AD_REPORT_REASONS,type AdReportSubmission} from '@/types/ad-disclosure';

export const APP_LOCAL_AD_REPORT_BYTES=40000;
export const APP_LOCAL_AD_SELECTION_BYTES=2048;
export const appLocalInputBytes=(value:string)=>new TextEncoder().encode(value).byteLength;
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
export type AppLocalAdSelection={kind:'select';location:string;latitude?:number;longitude?:number;batch?:boolean;query?:string};
export function isAppLocalAdSelection(value:unknown):value is AppLocalAdSelection{
 if(!object(value)||Object.keys(value).some(key=>!['kind','location','latitude','longitude','batch','query'].includes(key))||value.kind!=='select'||typeof value.location!=='string'||value.location.length>160||/[\x00-\x1f\x7f]/.test(value.location)||value.batch!==undefined&&typeof value.batch!=='boolean'||value.query!==undefined&&(typeof value.query!=='string'||value.query.length>160||/[\x00-\x1f\x7f]/.test(value.query)))return false;
 const gps=value.latitude!==undefined||value.longitude!==undefined;
 return !gps||typeof value.latitude==='number'&&typeof value.longitude==='number'&&Number.isFinite(value.latitude)&&Number.isFinite(value.longitude)&&Math.abs(value.latitude)<=90&&Math.abs(value.longitude)<=180;
}
export function isAppLocalAdReport(value:unknown):value is AdReportSubmission{
 if(!object(value)||Object.keys(value).sort().join('|')!==['details','kind','proof','reason','requestId'].join('|'))return false;
 return typeof value.requestId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId)
  &&['owner_campaign','platform_campaign'].includes(String(value.kind))&&typeof value.proof==='string'&&value.proof.length<=33000
  &&AD_REPORT_REASONS.includes(value.reason as AdReportSubmission['reason'])&&typeof value.details==='string'&&value.details.length<=1000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.details);
}
/** The new signed platform admission is the only large legacy event payload. */
export function isAppLocalAdProofReservation(value:unknown):boolean{
 if(!object(value)||Object.keys(value).some(key=>!['id','event','phase','reservation','path','device','disclosureProof'].includes(key)))return false;
 const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
 return uuid(value.id)&&value.event==='view'&&value.phase==='reserve'&&(value.reservation===undefined||uuid(value.reservation))
  &&typeof value.path==='string'&&value.path.startsWith('/')&&!value.path.startsWith('//')&&value.path.length<=2048&&!/[\x00-\x1f\x7f]/.test(value.path)
  &&['mobile','desktop'].includes(String(value.device))&&typeof value.disclosureProof==='string'&&value.disclosureProof.length<=33000&&/^v1\.[a-zA-Z0-9_-]+$/.test(value.disclosureProof);
}
