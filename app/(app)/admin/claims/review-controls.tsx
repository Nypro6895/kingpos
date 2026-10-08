'use client';
import {useState,useTransition} from 'react';
import {reviewBusinessClaimAction,businessClaimAttachmentAction} from '@/app/claim/actions';
export function ClaimReviewControls({requestId,canApprove}:{requestId:string;canApprove:boolean}) {
 const [error,setError]=useState<string|null>(null);const [pending,startTransition]=useTransition();
 return <form className="mt-3 grid gap-2" action={form=>startTransition(async()=>{try{const result=await reviewBusinessClaimAction(form);setError(result.error);}catch{setError('Could not save the decision.');}})}>
 <input type="hidden" name="request_id" value={requestId}/><label className="text-sm">Decision reason<input name="reason" required minLength={3} maxLength={1000} className="mt-1 block w-full rounded-lg border border-zinc-300 p-2"/></label>
 <div className="flex gap-2"><button name="decision" value="approved" disabled={pending || !canApprove} className="rounded-lg bg-zinc-950 px-3 py-2 text-sm text-white disabled:opacity-50">Approve claim</button><button name="decision" value="rejected" disabled={pending} className="rounded-lg border px-3 py-2 text-sm">Reject</button></div>
 {!canApprove?<p className="text-xs text-amber-900">Existing management requires an owner invitation or the recovery workflow. A claim cannot replace the owner.</p>:null}
 {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}</form>;
}
export function ClaimAttachment({requestId,path,name}:{requestId:string;path:string;name:string}) {
 const [error,setError]=useState<string|null>(null);const [pending,startTransition]=useTransition();
 return <span><button type="button" className="text-sm underline" disabled={pending} onClick={()=>{setError(null);const target=window.open('about:blank','_blank');if(target)target.opener=null;startTransition(async()=>{try{const url=await businessClaimAttachmentAction(requestId,path);if(target)target.location.href=url;else setError('Allow popups to open the attachment.');}catch{target?.close();setError('Document unavailable.');}});}}>{pending?'Opening…':name}</button>{error?<span role="alert" className="ml-2 text-xs text-red-700">{error}</span>:null}</span>;
}
