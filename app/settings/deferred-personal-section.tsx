"use client";

import { WorkspaceText } from "@/components/workspace-language";
import { useEffect, useState } from "react";
import {getAppLocalHost} from "@/lib/app-local-host";
import {getAppLocalCommandScope} from "@/lib/app-local-command-client";
import {useAppLocalResource} from "@/lib/app-local-resource";
import { AccountDeletionPanel } from "@/app/account/account-deletion-panel";
import { AccountProfileEditor } from "@/app/account/account-profile-editor";
import { LoginSecurityPanel } from "./login-security/login-security-panel";
import { SettingsLoading } from "./settings-loading";
import { loadPersonalSettingsSection } from "./load-personal-section";

export function DeferredPersonalSection({kind}:{kind:"security"|"deletion"}) {
  return getAppLocalHost().isNative?<NativePersonalSection kind={kind}/>:<WebPersonalSection kind={kind}/>;
}
function WebPersonalSection({kind}:{kind:"security"|"deletion"}) {
  const [content,setContent]=useState<Awaited<ReturnType<typeof loadPersonalSettingsSection>>|null>(null);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    void loadPersonalSettingsSection(kind).then(next=>{if(active)setContent(next);})
      .catch(()=>{if(active)setError("This section could not load. Please try again.");});
    return()=>{active=false;};
  },[kind,retry]);
  if(content)return <>{error?<p role="alert" className="text-sm text-red-700"><WorkspaceText text={error} /><button type="button" className="ml-2 underline" onClick={()=>{setError("");setRetry(v=>v+1);}}><WorkspaceText text="Reload section" /></button></p>:null}{content.kind==="deletion"?<AccountDeletionPanel impact={content.impact} onSaved={()=>setRetry(v=>v+1)}/>:<LoginSecurityPanel overview={content.overview} onSaved={()=>setRetry(v=>v+1)} contactEditor={<AccountProfileEditor embedded phoneOnly sectionId="settings-security-profile-contact" user={content.user} createdAtLabel={new Date(content.user.created_at).toLocaleDateString("en-US")}/>}/>}</>;
  return <div role="status">{error ? <><p><WorkspaceText text={error} /></p><button type="button" onClick={()=>{setError("");setRetry(value=>value+1);}}><WorkspaceText text="Try again" /></button></> : <SettingsLoading label="Loading account details…"/>}</div>;

}

export function DeferredDeletionSection({initialOpen=false}:{initialOpen?:boolean}) {
  const [open,setOpen]=useState(initialOpen);
  useEffect(()=>{
    const reveal=()=>{if(window.location.hash==="#delete-account")setOpen(true);};
    reveal();window.addEventListener("hashchange",reveal);
    return()=>window.removeEventListener("hashchange",reveal);
  },[]);
  return <details id={open ? undefined : "delete-account"} open={open} onToggle={event=>setOpen(event.currentTarget.open)} className="rounded-lg border border-zinc-200 p-5">
    <summary className="cursor-pointer font-semibold"><WorkspaceText text="Danger Zone · account backup & deletion" /></summary>
    {open ? <DeferredPersonalSection kind="deletion"/> : null}
  </details>;
}

function NativePersonalSection({kind}:{kind:"security"|"deletion"}) {
 const scope=getAppLocalCommandScope();
 const state=useAppLocalResource<Awaited<ReturnType<typeof loadPersonalSettingsSection>>>(scope,"settings.personal",{kind},{refreshAfterMs:15_000});
 const content=state.available&&!state.accessDenied?state.data:undefined;
 if(content&&content.kind===kind)return content.kind==="deletion"?<AccountDeletionPanel impact={content.impact} onSaved={()=>void state.refresh()}/>:<LoginSecurityPanel overview={content.overview} onSaved={()=>void state.refresh()} contactEditor={<AccountProfileEditor embedded sectionId="settings-security-profile-contact" user={content.user} createdAtLabel={new Date(content.user.created_at).toLocaleDateString("en-US")}/>}/>;
 const error=!scope||state.accessDenied?"Your account has changed. Please open the page again.":state.error;
 return <div role="status">{error?<><p><WorkspaceText text={error}/></p><button type="button" onClick={()=>void state.refresh()}><WorkspaceText text="Try again"/></button></>:<SettingsLoading label="Loading account details…"/>}</div>;
}
