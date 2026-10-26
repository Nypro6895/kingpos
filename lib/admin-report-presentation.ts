import type { PlatformAdminReportListItem } from '@/types/platform-admin';
import type { PlatformAdminReportDetail } from '@/lib/platform-admin/reports';
import { reportReasonLabel } from '@/lib/post-review-navigation';

export type AdminReportPreview = {
 report_number?:string; assigned_name?:string|null; assigned_membership_id?:string|null;
 description: string | null; context_path: string | null; reporter_name: string | null;
 guest_name: string | null; inbox_thread_id: string | null; customer_message: string | null;
 customer_message_at: string | null; support_message: string | null; support_message_at: string | null;
 support_message_kind: string | null; resolved_by: string | null; closed_by: string | null;
 review: {kind:'post_report'|'claim';id:string;status:string;origin?:string;reason?:string;title?:string;caption?:string;source_type?:string;source_id?:string} | null;
};
type Report = Pick<PlatformAdminReportListItem,'summary'|'category'|'status'|'source'> & {assigned_membership_id?:string|null;assignee?:unknown};
export const reportCategoryLabel=(value:string)=>({review_dispute:'Content report',data_calculation:'Data or calculation',salon_access:'Business access',technical:'Technical issue',other:'Support request',account_takeover:'Account takeover',lost_access:'Lost access',ownership:'Ownership'}[value]??value.replaceAll('_',' '));
export function reportTitle(report:Pick<Report,'summary'|'category'>,preview?:AdminReportPreview|null){
 if(preview?.review?.kind==='post_report')return `${reportReasonLabel(preview.review.reason??'content_report')} · ${preview.review.title?.trim()||'Reported post'}`;
 return report.summary?.trim()||reportCategoryLabel(report.category);
}
export function reportWaitingForCustomer(report:Report,preview?:AdminReportPreview|null){
 return report.status==='action_required' && (preview?.review?.kind==='post_report'||preview?.support_message_kind==='information') && (!preview?.customer_message_at||!preview?.support_message_at||Date.parse(preview.customer_message_at)<=Date.parse(preview.support_message_at));
}
export function reportStatusLabel(report:Report,preview?:AdminReportPreview|null){
 if(preview?.review?.kind==='post_report'&&preview.review.status==='pending'&&['resolved','closed'].includes(report.status))return 'Content review still pending';
 if(report.status==='under_review'&&preview?.review?.kind==='post_report'&&preview.review.origin==='user'&&preview.review.status!=='pending')return 'Reconsideration requested';
 if(report.status==='closed')return 'Closed';
 if(report.status==='resolved')return 'Resolved';
 if(reportWaitingForCustomer(report,preview))return 'Waiting for customer';
 if(report.status==='action_required')return 'Follow-up required';
 if(!report.assigned_membership_id&&!report.assignee)return 'Awaiting assignment';
 return report.status==='new'?'Received · assigned':'Under review';
}
export function reportCustomerMessage(description:string|null,preview?:AdminReportPreview|null,messages?:Array<{sender:string;body:string}>){
 if(description?.trim()&&!/^Reported issue:\s*/i.test(description))return description;
 return messages?.find(message=>message.sender==='user'&&!/^Reported issue:\s*/i.test(message.body))?.body||preview?.customer_message||null;
}
export function reportContextPath(path:string|null|undefined){
 if(!path||!/^\/(?!\/)/.test(path)||/[\\\u0000-\u0020]/.test(path))return null;
 // Customer-supplied context is a location hint, never a privileged destination.
 const clean=path.split(/[?#]/,1)[0];
 return /^\/(admin|api|auth|login|logout)(?:\/|$)/i.test(clean)?null:clean;
}
export function reportReviewHref(preview?:AdminReportPreview|null){
 if(!preview?.review)return null;
 return preview.review.kind==='post_report'?`/admin/post-safety?origin=${preview.review.origin==='automatic'?'automatic':'user'}&case=${encodeURIComponent(preview.review.id)}&status=all`:`/admin/claims?status=all&case=${encodeURIComponent(preview.review.id)}`;
}
export function reportNextStep(detail:PlatformAdminReportDetail,preview?:AdminReportPreview|null){
 const r=detail.report;
 if(reportWaitingForCustomer(r,preview))return 'Waiting for the customer to provide the requested details. Review their reply in the conversation.';
 if(preview?.review?.status==='pending')return 'Review the reported content and evidence, then record a moderation decision.';
 if(r.status==='under_review'&&preview?.review?.kind==='post_report'&&preview.review.origin==='user')return 'Read the new evidence in the conversation, then reopen the content review if it needs a new decision.';
 if(['resolved','closed'].includes(r.status))return 'Review the recorded outcome and customer conversation before taking further action.';
 if(!detail.assignee)return 'Assign an owner to review the customer’s request and evidence.';
 if(r.status==='new')return 'Start the review, check the evidence and identify the next action for the customer.';
 return r.status==='action_required'?'Check the latest message and history to see what is still needed.':'Check the customer’s request and evidence, then respond or record the outcome.';
}
