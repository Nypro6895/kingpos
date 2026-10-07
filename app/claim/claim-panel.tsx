'use client';

import {useState,useTransition} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {beginBusinessClaimAction,confirmBusinessClaimAction,requestBusinessClaimSupportAction,openClaimedSalonAction} from './actions';
import type {BusinessClaimRequest} from '@/lib/business-claims';

const button='rounded-xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50';
export function ClaimPanel({salonId,phone,unclaimed,messagingReady,uploadsReady,initialRequest}: {
 salonId:string;phone:string|null;unclaimed:boolean;messagingReady:boolean;uploadsReady:boolean;initialRequest:BusinessClaimRequest|null;
}) {
 const router=useRouter();const [pending,startTransition]=useTransition();
 const [requestId,setRequestId]=useState(initialRequest?.status==='otp_pending'?initialRequest.id:null);
 const [status,setStatus]=useState(initialRequest?.status??null);
 const [authorized,setAuthorized]=useState(false);const [code,setCode]=useState('');
 const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);
 const [support,setSupport]=useState(initialRequest?.status==='waiting'?false:!unclaimed || !messagingReady);
 function send(channel:'sms'|'call') {
 setError(null);startTransition(async()=>{try{
 const result=await beginBusinessClaimAction(salonId,channel,authorized);
 if(result.error)setError(result.error);else {setRequestId(result.requestId);setStatus('otp_pending');setNotice(channel==='call'?'Answer the salon phone and press the requested key to hear your code.':'Code sent to the salon phone.');}
 }catch{setError('Could not send a code. Please try again.');}});
 }
 function confirm() {
 setError(null);startTransition(async()=>{try{
 const result=await confirmBusinessClaimAction(requestId!,code);
 if(result.error)setError(result.error);else {setStatus(result.status);router.refresh();if(result.status==='approved')window.dispatchEvent(new Event('windows-pos:claim-approved'));}
 }catch{setError('Could not confirm your code. Please try again.');}});
 }
 function openSalon() {
 setError(null);startTransition(async()=>{try{const result=await openClaimedSalonAction(salonId);if(result.error)setError(result.error);else router.push('/salon-profile');}catch{setError('Could not open your salon. Please try again.');}});
 }
 return <div className="mt-5 grid gap-4">
 {error?<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>:null}
 {status==='approved'?<><p className="rounded-xl bg-green-50 p-4 text-sm text-green-900">Your claim is approved. You can manage this salon.</p><button className={button} disabled={pending} onClick={openSalon}>Open salon management</button></>:
 status==='waiting'?<><p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">Your request is waiting for ownership review. You can return to this page to check the result.</p><p className="text-sm text-zinc-600">{initialRequest?.support_reason || 'Our team will review your authority to manage this salon.'}</p><Link href={`/explore/salons/${salonId}`} className="text-sm underline">Back to salon</Link><button type="button" className="justify-self-start text-sm underline" onClick={()=>setSupport(!support)} aria-expanded={support}>Add supporting information</button>{support?<label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={authorized} onChange={event=>setAuthorized(event.target.checked)} className="mt-1 size-4"/>I own this salon or am authorized to manage it.</label>:null}</>:
 <>
 {initialRequest?.review_reason && status==='rejected'?<p className="text-sm text-zinc-600">Previous decision: {initialRequest.review_reason}</p>:null}
 {!unclaimed?<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">This salon already has management access. Ask the current owner to invite you. If you need ownership recovery, explain the situation below; this request will not replace the current owner.</p>:null}
 <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={authorized} onChange={event=>setAuthorized(event.target.checked)} className="mt-1 size-4"/>I own this salon or am authorized to manage it.</label>
 {unclaimed?<section className="grid gap-3 rounded-2xl border border-zinc-200 p-4">
 <h2 className="font-semibold">Verify the salon phone</h2>
 <p className="text-sm text-zinc-600">We send the code to {phone || 'the phone listed on this salon'}. A different phone number requires support review.</p>
 {!messagingReady?<p className="text-sm text-amber-900">Phone verification is being set up. You can request support below.</p>:null}
 <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={pending || !authorized || !messagingReady || !phone} onClick={()=>send('sms')}>{pending?'Please wait…':requestId?'Resend SMS':'Send SMS code'}</button><button type="button" className="rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold disabled:opacity-50" disabled={pending || !authorized || !messagingReady || !phone} onClick={()=>send('call')}>Call me with a code</button></div>
 {notice?<p role="status" className="text-sm text-zinc-600">{notice}</p>:null}
 {requestId?<form className="grid gap-3" onSubmit={event=>{event.preventDefault();confirm();}}><label className="text-sm">Six-digit code<input aria-label="Six-digit code" className="mt-2 block w-full rounded-xl border border-zinc-300 p-3 text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,''))} required pattern="[0-9]{6}"/></label><button className={button} disabled={pending || code.length!==6}>Confirm code</button><p className="text-xs text-zinc-500">Codes expire after 10 minutes. Wait 60 seconds between sends.</p></form>:null}
 </section>:null}
 <button type="button" className="justify-self-start text-sm underline" onClick={()=>setSupport(!support)} aria-expanded={support}>{support?'Hide support form':"Can't access this phone? Request support"}</button>
 </>}
 {support && status!=='approved'?<form className="grid gap-3 rounded-2xl border border-zinc-200 p-4" action={form=>{setError(null);startTransition(async()=>{try{const result=await requestBusinessClaimSupportAction(salonId,form);if(result.error)setError(result.error);else {setSupport(false);setStatus('waiting');router.refresh();}}catch{setError('Could not send your request. Please try again.');}});}}>
 <input type="hidden" name="authorized" value={authorized?'yes':'no'}/>
 <h2 className="font-semibold">Request ownership review</h2>
 <label className="grid gap-2 text-sm">Your connection to this salon<textarea name="reason" required minLength={10} maxLength={2000} rows={4} className="rounded-xl border border-zinc-300 p-3" placeholder="Tell us your role and why the listed phone cannot be used. You can include a business website or other evidence."/></label>
 {uploadsReady?<label className="grid gap-2 text-sm">Supporting documents (optional)<input type="file" name="attachments" accept="image/jpeg,image/png,application/pdf" multiple className="min-w-0 max-w-full"/><span className="text-xs text-zinc-500">Up to 3 JPG, PNG or PDF files, 5 MB each. Documents are private and available only to the review team.</span></label>:null}
 <button className={button} disabled={pending || !authorized}>{pending?'Sending…':'Submit request'}</button>
 </form>:null}
 </div>;
}
