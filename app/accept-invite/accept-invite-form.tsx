"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
export function AcceptInviteForm() {
 const router=useRouter();const [ready,setReady]=useState(false);const [error,setError]=useState('');const [pending,setPending]=useState(false);
 const initialization=useRef<Promise<boolean>|null>(null);
 useEffect(()=>{let live=true;
  async function init(){
   const client=createSupabaseBrowserClient();const hash=new URLSearchParams(location.hash.slice(1));const access=hash.get('access_token'),refresh=hash.get('refresh_token');
   history.replaceState(history.state,'',location.pathname);
   if(!client||hash.get('type')!=='invite'||!access||!refresh)return false;
   const result=await client.auth.setSession({access_token:access,refresh_token:refresh});
   return !result.error;
  }
  initialization.current??=init();void initialization.current.then(valid=>{if(live){if(valid)setReady(true);else setError('This invitation is invalid or expired. Ask support to resend it.');}}).catch(()=>{if(live)setError('Unable to check this invitation. Try opening the link again.');});return()=>{live=false;};
 },[]);
 return <>{error&&<p role="alert" className="mt-5 text-sm text-red-700">{error}</p>}{!ready&&!error&&<p role="status" className="mt-5 text-sm">Checking invitation…</p>}{ready&&<form className="mt-6 grid gap-4" onSubmit={async e=>{
  e.preventDefault();if(pending)return;const form=new FormData(e.currentTarget);const password=String(form.get('password'));
  if(password!==form.get('confirmation')){setError('Passwords do not match.');return;}
  const client=createSupabaseBrowserClient();if(!client){setError('Authentication is unavailable.');return;}
  setPending(true);setError('');try{const result=await client.auth.updateUser({password});if(result.error){setError(result.error.message);return;}await client.auth.signOut();router.replace('/login?message=Invitation+accepted.+Sign+in+with+your+new+password.');}catch{setError('The password update could not be confirmed. Try signing in before retrying.');}finally{setPending(false);}
 }}><label className="grid gap-1 text-sm">Password<input className="rounded-md border p-3" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><label className="grid gap-1 text-sm">Confirm password<input className="rounded-md border p-3" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><button className="rounded-md bg-orange-600 p-3 text-sm text-white" disabled={pending}>{pending?'Saving…':'Accept invitation'}</button></form>}</>;
}
