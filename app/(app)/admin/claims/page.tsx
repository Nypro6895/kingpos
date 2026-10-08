import { AdminPageHeader, Pagination, StatusBadge, formatAdminDateTime } from "../_components/admin-ui";
import { ReviewQueueFilters } from "../_components/review-queue-filters";
import { filterAdminReviewQueue } from "@/lib/admin-review-queue";
import { parseAdminSearchParams } from "@/lib/platform-admin/validation";
import Link from 'next/link';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS} from '@/lib/platform-admin/permissions';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import type {BusinessClaimRequest} from '@/lib/business-claims';
import {ClaimReviewControls,ClaimAttachment} from './review-controls';
export default async function BusinessClaimsAdminPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const context=await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsRead);
 const client=await createAuthenticatedSupabaseServerClient();
 const params=await searchParams; const read=(key:string)=>typeof params[key]==="string"?params[key] as string:undefined; const parsed=parseAdminSearchParams(params); const status=read("status")??"waiting";
 if(!client)throw new Error("Admin data service is unavailable.");
 const {data,error}=await client!.rpc('get_business_claim_requests',{});
 if(error)throw new Error('Could not load ownership requests.');
 const allRequests=(data??[]) as BusinessClaimRequest[];
 const queue=filterAdminReviewQueue(allRequests,{...parsed,pageSize:parsed.pageSize,q:read("q"),status:status==="all"?undefined:status,sort:read("sort")},row=>`${row.salon_name} ${row.address} ${row.applicant_name ?? ""}`); const requests=queue.items;
 const ids=[...new Set(requests.map(r=>r.salon_id))];
 const states=new Map<string,boolean>();
 await Promise.all(ids.map(async id=>{const {data:listing}=await client!.rpc('get_public_salon_directory_listing',{target_salon_id:id});states.set(id,listing?.[0]?.claim_state==='unclaimed');}));
 return <><AdminPageHeader eyebrow="Review & support" title="Ownership claims">Confirm the right to manage a salon. Approval does not grant a verification badge.</AdminPageHeader><ReviewQueueFilters q={read("q")} status={status} sort={read("sort")}/><div className="mt-5 grid gap-4">
 {requests.length===0?<p>No ownership requests match these filters.</p>:requests.map(row=><article key={row.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
 <div className="flex flex-wrap justify-between gap-2"><Link className="font-semibold underline" href={`/admin/locations/${row.salon_id}`}>{row.salon_name}</Link><StatusBadge value={row.status}/></div>
 <p className="mt-2 text-sm">{row.address}</p><p className="mt-1 text-xs text-zinc-500">Submitted {formatAdminDateTime(row.created_at)}</p><p className="text-sm">Applicant: <Link href={`/admin/users/${row.applicant_user_id}`} className="text-orange-700">{row.applicant_name || 'Reylumi user'}</Link>{context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.usersReadSensitive)?` · ${row.applicant_email ?? ""}`:""}</p><p className="text-sm">{row.phone_verified_at?'Phone confirmed':'Phone not confirmed'} · {row.channel}</p>
 {row.support_reason?<p className="mt-2 whitespace-pre-wrap text-sm">{row.support_reason}</p>:null}
 <div className="mt-2 flex flex-wrap gap-3">{row.attachments.map(file=><ClaimAttachment key={file.path} requestId={row.id} path={file.path} name={file.name}/>)}</div>
 {row.review_reason?<p className="mt-2 text-sm">Decision: {row.review_reason}</p>:null}
 <details className="mt-2 text-xs text-zinc-500"><summary>Request history</summary>{row.events.map((event,index)=><p key={index}>{event.created_at} · {event.event} · {event.reason}</p>)}</details>
 {row.status==='waiting' && context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.locationsUpdateStatus)?<ClaimReviewControls requestId={row.id} canApprove={states.get(row.salon_id)??false}/>:null}
 </article>)}
 </div><Pagination basePath="/admin/claims" page={queue.page} pageSize={queue.page_size} total={queue.total} query={{q:read("q"),status,sort:read("sort")}}/></>;
}
