import 'server-only';
import {callPlatformAdminRpc} from './rpc';
import {getPlatformAdminReportDetail} from './reports';
import {loadAdminPostReviewWorkspace} from './post-safety';
import {supportRpc,type SupportConversation} from '@/lib/support-cases';
import type {AdminReportPreview} from '@/lib/admin-report-presentation';
import type {AdminPostSafetyCase} from '@/types/admin-post-safety';
import type {SocialTextReportEvidence} from '@/types/social-text-reports';

export async function loadAdminReportPreviews(ids:string[]){
 const result:Record<string,AdminReportPreview>={};
 const unique=[...new Set(ids)];
 for(let i=0;i<unique.length;i+=200)Object.assign(result,await callPlatformAdminRpc<Record<string,AdminReportPreview>>('get_admin_report_previews',{p_report_ids:unique.slice(i,i+200)}));
 return result;
}
export async function loadAdminReportContext(id:string){
 const [detail,previews]=await Promise.all([getPlatformAdminReportDetail(id),loadAdminReportPreviews([id])]);
 const preview=previews[id]??null;
 let conversation:SupportConversation|null=null,post:AdminPostSafetyCase|null=null;
 const errors:string[]=[];
 await Promise.all([
  ['user_support','guest_support'].includes(detail.report.source)?supportRpc<SupportConversation>('get_support_conversation',{p_report_id:id}).then(value=>{conversation=value;}).catch(()=>{errors.push('The conversation and attachments could not load. Open the chat to retry.');}):Promise.resolve(),
  preview?.review?.kind==='post_report'?loadAdminPostReviewWorkspace(preview.review.origin==='automatic'?'automatic':'user',preview.review.id,undefined,{status:'all',q:preview.review.id}).then(value=>{post=value.cases.find(row=>row.id===preview.review!.id)??null;if(!post)errors.push('The linked content could not be found. Open the content review to investigate.');}).catch(()=>{errors.push('The reported content could not load. Open the content review to retry.');}):Promise.resolve(),
 ]);
 let socialContent:SocialTextReportEvidence|null=null;
 if (detail.report.source==='user_support') {
  // Resolve by case ID on the authenticated admin boundary; the customer's
  // account-scoped /more/reviews URL is not a moderator evidence destination.
  try { socialContent=await callPlatformAdminRpc<SocialTextReportEvidence>('get_admin_social_report_evidence',{p_report_id:id}); }
  catch {
   const knownSocial=detail.report.social_content_report===true||(conversation as SupportConversation|null)?.context?.module==='social_content_report';
   // Transport failure is not evidence of the case type. Preserve ordinary
   // booking/support context even if this optional lookup is unavailable.
   if (knownSocial) socialContent={status:'unavailable'};
   errors.push(knownSocial?'The reported text lookup could not load. Retry this case before recording a content decision.':'Additional case details could not load. Retry to verify them.');
  }
 }
 return {detail,preview,conversation:conversation as SupportConversation|null,post:post as AdminPostSafetyCase|null,socialContent,errors};
}
