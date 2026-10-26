"use client";
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {reviewSalonVerificationAction} from '@/app/settings/salon-verification-actions';
export function VerificationReviewForm({requestId,status}:{requestId:string;status:string}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const router=useRouter();
 return <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const button=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;form.set('decision',button?.value??'');setBusy(true);setError('');try{const result=await reviewSalonVerificationAction(form);if(result.error)setError(result.error);else router.refresh();}catch{setError('Could not save decision. Please try again.');}finally{setBusy(false);}}}>
 <input type="hidden" name="request_id" value={requestId}/><input disabled={busy} name="reason" maxLength={1000} placeholder="Reason (required for rejection / block)" aria-label="Decision reason" className="min-h-9 min-w-0 w-full sm:w-auto sm:min-w-60 flex-1 rounded-xl border border-zinc-300 px-3 text-sm"/>
 {status==='waiting'?<><button disabled={busy} name="decision" value="approved" className="dashboard-button dashboard-button-primary">Approve</button><button disabled={busy} name="decision" value="rejected" className="dashboard-button">Reject</button></>:null}
 {status==='blocked'?<button disabled={busy} name="decision" value="unblock" className="dashboard-button">Allow applications again</button>:<button disabled={busy} name="decision" value="blocked" className="dashboard-button dashboard-button-danger">Block verification requests</button>}
 {busy?<p role="status" className="w-full text-xs text-zinc-500">Saving decision…</p>:null}{error?<p role="alert" className="w-full text-sm text-red-600">{error}</p>:null}
 </form>;
}
