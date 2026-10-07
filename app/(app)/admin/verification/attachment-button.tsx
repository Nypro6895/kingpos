"use client";
import {useState} from 'react';
import {salonVerificationAttachmentAction} from '@/app/settings/salon-verification-actions';
export function VerificationAttachmentButton({requestId,path,name}:{requestId:string;path:string;name:string}) {
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <span><button type="button" disabled={busy} className="min-h-10 text-sm text-sky-600 underline" onClick={async()=>{setBusy(true);setError('');const target=window.open('about:blank','_blank');if(target)target.opener=null;try{const url=await salonVerificationAttachmentAction(requestId,path);if(target)target.location.href=url;else setError('Allow popups to open the attachment.');}catch{target?.close();setError('Could not open file.');}finally{setBusy(false);}}}>{busy?'Opening…':name}</button>{error?<span role="alert" className="ml-2 text-xs text-red-600">{error}</span>:null}</span>;
}
