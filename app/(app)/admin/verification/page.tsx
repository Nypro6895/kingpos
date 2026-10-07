import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS} from '@/lib/platform-admin/permissions';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import type {SalonVerificationRequest} from '@/lib/salon-identity';
import {VerificationReviewForm} from './review-form';
import {VerificationAttachmentButton} from './attachment-button';
export default async function VerificationPage() {
 const context=await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsRead);
 const client=await createAuthenticatedSupabaseServerClient();
 const {data,error}=await client!.rpc('get_salon_verification_requests',{});
 if(error) throw new Error('Could not load verification requests.');
 const requests=(data??[]) as SalonVerificationRequest[];
 const latest=new Map<string,string>();for(const row of requests)if(!latest.has(row.salon_id))latest.set(row.salon_id,row.id);
 const canReview=context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.locationsUpdateStatus);
 return <><h1 className="text-2xl font-semibold">Salon verification</h1><p className="mt-2 text-sm text-zinc-500">Review phone-confirmed identity submissions. Blocking affects verification requests only.</p><div className="mt-5 grid gap-4">{requests.length===0?<p>No applications yet.</p>:requests.map(row=><article key={row.id} className="rounded-2xl border border-zinc-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{row.salon_name}</h2><span className="text-xs capitalize">{row.status} · Application {row.attempt}{row.attempt>1?` · Reapplied ${row.attempt-1} time(s)`:''}</span></div><p className="mt-2 text-sm">{row.address}</p><p className="text-sm">{row.phone}</p><p className="mt-1 text-xs text-zinc-500">Submitted {row.submitted_at?new Date(row.submitted_at).toLocaleString('en-US',{timeZone:'UTC'}):'—'} UTC · Salon {row.salon_id}</p>{row.review_reason?<p className="mt-2 text-sm">Decision reason: {row.review_reason}</p>:null}{row.decisions?.length?<details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">Decision history</summary>{row.decisions.map((d,i)=><p key={i}>{d.decision} · {d.created_at} · {d.reason}</p>)}</details>:null}<div className="mt-2 flex flex-wrap gap-3">{row.attachments.map(file=><VerificationAttachmentButton key={file.path} requestId={row.id} path={file.path} name={file.name}/>)}</div>{canReview && latest.get(row.salon_id)===row.id && ['waiting','rejected','blocked'].includes(row.status)?<VerificationReviewForm requestId={row.id} status={row.status}/>:null}</article>)}</div></>;
}
