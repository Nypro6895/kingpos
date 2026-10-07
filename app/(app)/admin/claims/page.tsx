import Link from 'next/link';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS} from '@/lib/platform-admin/permissions';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import type {BusinessClaimRequest} from '@/lib/business-claims';
import {ClaimReviewControls,ClaimAttachment} from './review-controls';
export default async function BusinessClaimsAdminPage() {
 const context=await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsRead);
 const client=await createAuthenticatedSupabaseServerClient();
 const {data,error}=await client!.rpc('get_business_claim_requests',{});
 if(error)throw new Error('Could not load ownership requests.');
 const requests=(data??[]) as BusinessClaimRequest[];
 const ids=[...new Set(requests.map(r=>r.salon_id))];
 const states=new Map<string,boolean>();
 await Promise.all(ids.map(async id=>{const {data:listing}=await client!.rpc('get_public_salon_directory_listing',{target_salon_id:id});states.set(id,listing?.[0]?.claim_state==='unclaimed');}));
 return <><h1 className="text-2xl font-semibold">Business claims</h1><p className="mt-2 text-sm text-zinc-500">Confirm authority to manage the salon. Approval preserves its profile and does not award a verification badge.</p><div className="mt-5 grid gap-4">
 {requests.length===0?<p>No ownership requests yet.</p>:requests.map(row=><article key={row.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
 <div className="flex flex-wrap justify-between gap-2"><Link className="font-semibold underline" href={`/explore/salons/${row.salon_id}`}>{row.salon_name}</Link><span className="text-xs capitalize">{row.status}</span></div>
 <p className="mt-2 text-sm">{row.address}</p><p className="text-sm">Applicant: {row.applicant_name || 'Reylumi user'} · {row.applicant_email}</p><p className="text-sm">{row.phone_verified_at?'Phone confirmed':'Phone not confirmed'} · {row.channel}</p>
 {row.support_reason?<p className="mt-2 whitespace-pre-wrap text-sm">{row.support_reason}</p>:null}
 <div className="mt-2 flex flex-wrap gap-3">{row.attachments.map(file=><ClaimAttachment key={file.path} requestId={row.id} path={file.path} name={file.name}/>)}</div>
 {row.review_reason?<p className="mt-2 text-sm">Decision: {row.review_reason}</p>:null}
 <details className="mt-2 text-xs text-zinc-500"><summary>Request history</summary>{row.events.map((event,index)=><p key={index}>{event.created_at} · {event.event} · {event.reason}</p>)}</details>
 {row.status==='waiting' && context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.locationsUpdateStatus)?<ClaimReviewControls requestId={row.id} canApprove={states.get(row.salon_id)??false}/>:null}
 </article>)}
 </div></>;
}
