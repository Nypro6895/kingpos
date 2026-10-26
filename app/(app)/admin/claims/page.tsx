import { withExperiencePage } from "@/components/experience-page";
import { AdminPageHeader, EmptyState, Pagination, StatusBadge, formatAdminDateTime } from "../_components/admin-ui";
import { ReviewQueueFilters } from "../_components/review-queue-filters";
import { filterAdminReviewQueue } from "@/lib/admin-review-queue";
import { parseAdminSearchParams } from "@/lib/platform-admin/validation";
import Link from 'next/link';
import {AdminConversationButton} from "../_components/admin-conversation-button";
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS} from '@/lib/platform-admin/permissions';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import type {BusinessClaimRequest} from '@/lib/business-claims';
import {ClaimReviewControls,ClaimAttachment} from './review-controls';
async function BusinessClaimsAdminPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const context=await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsRead);
 const client=await createAuthenticatedSupabaseServerClient();
 const params=await searchParams; const read=(key:string)=>typeof params[key]==="string"?params[key] as string:undefined; const parsed=parseAdminSearchParams(params); const status=read("status")??"waiting";
 if(!client)throw new Error("Admin data service is unavailable.");
 const {data,error}=await client!.rpc('get_business_claim_requests',{});
 if(error)throw new Error('Could not load ownership requests.');
 const allRequests=(data??[]) as BusinessClaimRequest[];
 const queue=filterAdminReviewQueue(read("case")?allRequests.filter(row=>row.id===read("case")):allRequests,{...parsed,pageSize:parsed.pageSize,q:read("q"),status:status==="all"?undefined:status,sort:read("sort")},row=>`${row.salon_name} ${row.address} ${row.applicant_name ?? ""}`); const requests=queue.items;
 const ids=[...new Set(requests.map(r=>r.salon_id))];
 const states=new Map<string,boolean>();
 await Promise.all(ids.map(async id=>{const {data:listing}=await client!.rpc('get_public_salon_directory_listing',{target_salon_id:id});states.set(id,listing?.[0]?.claim_state==='unclaimed');}));
 return <><AdminPageHeader eyebrow="Review & support" title="Ownership claims">Confirm the right to manage a salon. Approval does not grant a verification badge.</AdminPageHeader><nav className="admin-queue-summary" aria-label="Review status">{["waiting","needs_info","approved","rejected","all"].map(value => { const search = new URLSearchParams(); search.set("status",value); if(read("q")) search.set("q",read("q")!); if(read("sort")) search.set("sort",read("sort")!); return <Link key={value} href={`?${search.toString()}`} aria-current={status===value ? "page" : undefined}>{value==="all" ? "All requests" : value==="waiting" ? "Waiting for review" : value==="needs_info"?"More information needed":value.charAt(0).toUpperCase()+value.slice(1)}<strong>{value==="all" ? allRequests.length : allRequests.filter(request=>request.status===value).length}</strong></Link>; })}</nav><ReviewQueueFilters q={read("q")} status={status} sort={read("sort")}/><div className="admin-review-list mt-4 grid gap-3">
 {requests.length===0?<EmptyState title="No ownership requests match these filters">Change the status or reset filters to see other requests.</EmptyState>:requests.map(row=><article key={row.id} className="admin-review-card rounded-lg border border-zinc-200 bg-white p-4">
 <div className="flex flex-wrap justify-between gap-2"><Link className="font-semibold underline" href={`/admin/locations/${row.salon_id}`}>{row.salon_name}</Link><StatusBadge value={row.status}/></div>
 <p className="mt-2 text-sm">{row.address}</p><p className="mt-1 text-xs text-zinc-500">Submitted {formatAdminDateTime(row.created_at)}</p><p className="text-sm">Applicant: <Link href={`/admin/users/${row.applicant_user_id}`} className="text-orange-700">{row.applicant_name || 'Reylumi user'}</Link>{context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.usersReadSensitive)?` · ${row.applicant_email ?? ""}`:""}</p><p className="text-sm">{row.phone_verified_at?'Phone confirmed':'Phone not confirmed'} · {row.channel}</p>
 {row.support_reason?<p className="mt-2 whitespace-pre-wrap text-sm">{row.support_reason}</p>:null}
 <div className="mt-2 flex flex-wrap gap-3">{row.attachments.map(file=><ClaimAttachment key={file.path} requestId={row.id} path={file.path} name={file.name}/>)}</div>
 {row.support_report_id?<div className="mt-3"><AdminConversationButton reportId={row.support_report_id}>Open applicant conversation</AdminConversationButton></div>:null}
 {row.review_reason?<p className="mt-2 text-sm">Decision: {row.review_reason}</p>:null}
 <details className="mt-2 text-xs text-zinc-500"><summary>Request history</summary>{row.events.map((event,index)=><p key={index}>{event.created_at} · {event.event} · {event.reason}</p>)}</details>
 {['waiting','needs_info'].includes(row.status) && context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.locationsUpdateStatus)?<details className="admin-review-actions"><summary>Review ownership claim</summary><ClaimReviewControls requestId={row.id} canApprove={states.get(row.salon_id)??false}/></details>:null}
 </article>)}
 </div><Pagination basePath="/admin/claims" page={queue.page} pageSize={queue.page_size} total={queue.total} query={{q:read("q"),status,sort:read("sort")}}/></>;
}

export default withExperiencePage(BusinessClaimsAdminPage, { admin: true });
