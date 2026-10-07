"use client";

import { useEffect, useState } from "react";
import { AccountDeletionPanel } from "@/app/account/account-deletion-panel";
import { AccountProfileEditor } from "@/app/account/account-profile-editor";
import { LoginSecurityPanel } from "./login-security/login-security-panel";
import { loadPersonalSettingsSection } from "./load-personal-section";

export function DeferredPersonalSection({kind}:{kind:"security"|"deletion"}) {
  const [content,setContent]=useState<Awaited<ReturnType<typeof loadPersonalSettingsSection>>|null>(null);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    void loadPersonalSettingsSection(kind).then(next=>{if(active)setContent(next);})
      .catch(()=>{if(active)setError("This section could not load. Please try again.");});
    return()=>{active=false;};
  },[kind,retry]);
  if(content)return <>{error?<p role="alert" className="text-sm text-red-700">{error}<button type="button" className="ml-2 underline" onClick={()=>{setError("");setRetry(v=>v+1);}}>Reload section</button></p>:null}{content.kind==="deletion"?<AccountDeletionPanel impact={content.impact} onSaved={()=>setRetry(v=>v+1)}/>:<LoginSecurityPanel overview={content.overview} onSaved={()=>setRetry(v=>v+1)} contactEditor={<AccountProfileEditor user={content.user} createdAtLabel={new Date(content.user.created_at).toLocaleDateString("en-US")}/>}/>}</>;
  return <div role="status">{error ? <><p>{error}</p><button type="button" onClick={()=>{setError("");setRetry(value=>value+1);}}>Try again</button></> : "Loading account details…"}</div>;
}

export function DeferredDeletionSection({initialOpen=false}:{initialOpen?:boolean}) {
  const [open,setOpen]=useState(initialOpen);
  useEffect(()=>{
    const reveal=()=>{if(window.location.hash==="#delete-account")setOpen(true);};
    reveal();window.addEventListener("hashchange",reveal);
    return()=>window.removeEventListener("hashchange",reveal);
  },[]);
  return <details id={open ? undefined : "delete-account"} open={open} onToggle={event=>setOpen(event.currentTarget.open)} className="rounded-lg border border-zinc-200 p-5">
    <summary className="cursor-pointer font-semibold">Danger Zone · account backup & deletion</summary>
    {open ? <DeferredPersonalSection kind="deletion"/> : null}
  </details>;
}
