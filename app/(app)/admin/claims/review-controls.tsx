'use client';
import {useState,useTransition} from 'react';
import {reviewBusinessClaimAction,businessClaimAttachmentAction} from '@/app/claim/actions';
export function ClaimReviewControls({requestId,canApprove}:{requestId:string;canApprove:boolean}) {
 const [error,setError]=useState<string|null>(null);const [pending,startTransition]=useTransition();
 return <form className="mt-3 grid gap-2" action={form=>startTransition(async()=>{try{const result=await reviewBusinessClaimAction(form);setError(result.error);}catch{setError('Could not save the decision.');}})}>
 <input type="hidden" name="request_id" value={requestId}/><label className="text-sm">Explanation for the applicant<textarea name="reason" required minLength={3} maxLength={1000} rows={3} className="mt-1 block w-full rounded-lg border border-zinc-300 p-2"/></label>
 <p className="text-xs text-zinc-500">Explain the decision, or list exactly which documents or details are needed. This message is visible to the applicant.</p>
 <label className="text-sm">Internal note (optional)<textarea name="internal_note" maxLength={2000} rows={2} className="mt-1 block w-full rounded-lg border border-zinc-300 p-2"/></label>
 <div className="flex flex-wrap gap-2"><button name="decision" value="approved" disabled={pending || !canApprove} className="rounded-lg bg-zinc-950 px-3 py-2 text-sm text-white disabled:opacity-50">Approve claim</button><button name="decision" value="needs_info" disabled={pending} className="rounded-lg border px-3 py-2 text-sm">Request information</button><button name="decision" value="rejected" disabled={pending} className="rounded-lg border px-3 py-2 text-sm">Reject</button></div>
 {!canApprove?<p className="text-xs text-amber-900">Existing management requires an owner invitation or the recovery workflow. A claim cannot replace the owner.</p>:null}
 {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}</form>;
}
export function ClaimAttachment({requestId,path,name}:{requestId:string;path:string;name:string}) {
 const [error,setError]=useState<string|null>(null);const [pending,startTransition]=useTransition();
 return <span><button type="button" className="text-sm underline" disabled={pending} onClick={()=>{setError(null);const target=window.open('about:blank','_blank');if(target)target.opener=null;startTransition(async()=>{try{const url=await businessClaimAttachmentAction(requestId,path);if(target)target.location.href=url;else setError('Allow popups to open the attachment.');}catch{target?.close();setError('Document unavailable.');}});}}>{pending?'Opening…':name}</button>{error?<span role="alert" className="ml-2 text-xs text-red-700">{error}</span>:null}</span>;
}
