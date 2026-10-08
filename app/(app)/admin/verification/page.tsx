import Link from "next/link";
import { AdminPageHeader, Pagination, StatusBadge, formatAdminDateTime } from "../_components/admin-ui";
import { ReviewQueueFilters } from "../_components/review-queue-filters";
import { filterAdminReviewQueue } from "@/lib/admin-review-queue";
import { parseAdminSearchParams } from "@/lib/platform-admin/validation";
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS} from '@/lib/platform-admin/permissions';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import type {SalonVerificationRequest} from '@/lib/salon-identity';
import {VerificationReviewForm} from './review-form';
import {VerificationAttachmentButton} from './attachment-button';
export default async function VerificationPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const context=await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsRead);
 const client=await createAuthenticatedSupabaseServerClient();
 const params=await searchParams; const read=(key:string)=>typeof params[key]==="string"?params[key] as string:undefined; const parsed=parseAdminSearchParams(params); const status=read("status")??"waiting";
 if(!client)throw new Error("Admin data service is unavailable.");
 const {data,error}=await client!.rpc('get_salon_verification_requests',{});
 if(error) throw new Error('Could not load verification requests.');
 const allRequests=(data??[]) as SalonVerificationRequest[];
 const queue=filterAdminReviewQueue(allRequests,{...parsed,pageSize:parsed.pageSize,q:read("q"),status:status==="all"?undefined:status,sort:read("sort")},row=>`${row.salon_name} ${row.address}`); const requests=queue.items;
 const latest=new Map<string,string>();for(const row of allRequests)if(!latest.has(row.salon_id))latest.set(row.salon_id,row.id);
 const canReview=context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.locationsUpdateStatus);
 return <><AdminPageHeader eyebrow="Review & support" title="Salon verification">Review salon identity and verification badges. Ownership claims are a separate process.</AdminPageHeader><ReviewQueueFilters q={read("q")} status={status} sort={read("sort")} verification/><div className="mt-5 grid gap-4">{requests.length===0?<p>No applications match these filters.</p>:requests.map(row=><article key={row.id} className="rounded-2xl border border-zinc-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><Link href={`/admin/locations/${row.salon_id}`} className="font-semibold text-orange-700">{row.salon_name}</Link><span className="text-xs capitalize"><StatusBadge value={row.status}/> · Application {row.attempt}{row.attempt>1?` · Reapplied ${row.attempt-1} time(s)`:''}</span></div><p className="mt-2 text-sm">{row.address}</p>{context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.usersReadSensitive)?<p className="text-sm">{row.phone}</p>:null}<p className="mt-1 text-xs text-zinc-500">Submitted {formatAdminDateTime(row.submitted_at)} · Salon {row.salon_id}</p>{row.review_reason?<p className="mt-2 text-sm">Decision reason: {row.review_reason}</p>:null}{row.decisions?.length?<details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">Decision history</summary>{row.decisions.map((d,i)=><p key={i}>{d.decision} · {d.created_at} · {d.reason}</p>)}</details>:null}<div className="mt-2 flex flex-wrap gap-3">{row.attachments.map(file=><VerificationAttachmentButton key={file.path} requestId={row.id} path={file.path} name={file.name}/>)}</div>{canReview && latest.get(row.salon_id)===row.id && ['waiting','rejected','blocked'].includes(row.status)?<VerificationReviewForm requestId={row.id} status={row.status}/>:null}</article>)}</div><Pagination basePath="/admin/verification" page={queue.page} pageSize={queue.page_size} total={queue.total} query={{q:read("q"),status,sort:read("sort")}}/></>;
}
