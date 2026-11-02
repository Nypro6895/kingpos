"use client";
import {WorkspaceText,useWorkspaceTranslation} from "@/components/workspace-language";
import {updateStaffPublicTeamBatchAction,type PublicTeamBatchUpdate} from "@/app/salon-settings/actions";
import {useRouter} from "next/navigation";
import {useEffect,useMemo,useState,useTransition} from "react";
import "./public-team-settings-editor.css";
export type PublicTeamSettingsMember={avatarUrl:string|null;displayName:string;id:string;isActive:boolean;jobTitle:string|null;onlineBookingEnabled:boolean;profileDisplayOrder:number;salonProfileContentPostingEnabled:boolean};
function signature(m:PublicTeamSettingsMember){return JSON.stringify([m.id,m.onlineBookingEnabled,m.profileDisplayOrder,m.salonProfileContentPostingEnabled]);}
function Switch({checked,disabled,label,onChange}:{checked:boolean;disabled:boolean;label:string;onChange:()=>void}){return <button type="button" className="public-team-switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}><span className="public-team-track" aria-hidden="true"><span/></span></button>;}
export function PublicTeamSettingsEditor({canManageSettings,members}:{canManageSettings:boolean;members:PublicTeamSettingsMember[]}){
 const t=useWorkspaceTranslation(),router=useRouter();
 const [saved,setSaved]=useState(members),[draft,setDraft]=useState(members),[message,setMessage]=useState(""),[failed,setFailed]=useState(false),[pending,startTransition]=useTransition();
 const savedSignatures=useMemo(()=>new Map(saved.map(m=>[m.id,signature(m)])),[saved]);
 const dirtyCount=draft.filter(m=>savedSignatures.get(m.id)!==signature(m)).length,disabled=!canManageSettings||pending;
 useEffect(()=>{if(!dirtyCount)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirtyCount]);
 function update(id:string,patch:Partial<PublicTeamSettingsMember>){setMessage("");setFailed(false);setDraft(current=>current.map(m=>m.id===id?{...m,...patch}:m));}
 function bulk(field:"onlineBookingEnabled"|"salonProfileContentPostingEnabled",enabled:boolean){setMessage("");setFailed(false);setDraft(current=>current.map(m=>enabled&&!m.isActive?m:{...m,[field]:enabled}));}
 function cancel(){setDraft(saved);setMessage("");setFailed(false);}
 function save(){if(disabled||!dirtyCount)return;const submitted=draft;
  const payload:PublicTeamBatchUpdate[]=submitted.map(m=>({staffId:m.id,onlineBookingEnabled:m.onlineBookingEnabled,profileDisplayOrder:m.profileDisplayOrder,salonProfileContentPostingEnabled:m.salonProfileContentPostingEnabled}));setMessage("");setFailed(false);
  startTransition(async()=>{try{const result=await updateStaffPublicTeamBatchAction(payload);if(result.error){setFailed(true);setMessage(result.error);return;}setSaved(submitted);setMessage(result.updatedCount===1?"1 staff setting saved.":`${result.updatedCount} staff settings saved.`);router.refresh();}catch(error){setFailed(true);setMessage(error instanceof Error?error.message:"Could not save. Your changes are still here.");}});
 }
 if(!members.length)return <div className="public-team-editor"><p className="public-team-note"><WorkspaceText text="No staff profiles found for this salon."/></p></div>;
 return <div className="public-team-editor">
  <div className="public-team-caption"><span><WorkspaceText text={`${members.length} staff`}/></span><span><WorkspaceText text="Changes apply after saving"/></span></div>
  <div className="public-team-list" role="group" aria-label={t("Public team staff")}>
   <div className="public-team-columns" aria-hidden="true"><span><WorkspaceText text="Staff"/></span><span><WorkspaceText text="Booking"/></span><span><WorkspaceText text="Posting"/></span></div>
   {draft.map(m=><div className="public-team-row" key={m.id} data-staff-id={m.id} data-dirty={savedSignatures.get(m.id)!==signature(m)}>
    <div className="public-team-person"><span className="public-team-avatar" aria-hidden="true">{m.avatarUrl?
     // eslint-disable-next-line @next/next/no-img-element
     <img alt="" src={m.avatarUrl}/>:m.displayName.split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]?.toUpperCase()).join("")}</span><span><strong>{m.displayName}</strong><small><WorkspaceText text={m.jobTitle||"Staff"}/> · <WorkspaceText text={m.isActive?"Active":"Inactive"}/></small></span></div>
    <Switch checked={m.onlineBookingEnabled} disabled={disabled||!m.isActive} label={`${m.displayName}: ${t("Online booking")}`} onChange={()=>update(m.id,{onlineBookingEnabled:!m.onlineBookingEnabled})}/>
    <Switch checked={m.salonProfileContentPostingEnabled} disabled={disabled||!m.isActive} label={`${m.displayName}: ${t("Allow Salon Profile posting")}`} onChange={()=>update(m.id,{salonProfileContentPostingEnabled:!m.salonProfileContentPostingEnabled})}/>
   </div>)}
  </div>
  <details className="public-team-disclosure"><summary><WorkspaceText text="Display order"/></summary><p className="public-team-note"><WorkspaceText text="Lower numbers appear first."/></p>{draft.map(m=><label className="public-team-order" key={m.id}><span>{m.displayName}</span><input type="number" aria-label={`${m.displayName}: ${t("Display order")}`} disabled={disabled} value={m.profileDisplayOrder} onChange={event=>update(m.id,{profileDisplayOrder:Number.parseInt(event.currentTarget.value,10)||0})}/></label>)}</details>
  <details className="public-team-disclosure"><summary><WorkspaceText text="Apply to all staff"/></summary><p className="public-team-note"><WorkspaceText text="Turning on applies to active staff. Turning off applies to all staff. Save to apply these changes."/></p>{([['onlineBookingEnabled','Online booking'],['salonProfileContentPostingEnabled','Salon Profile posting']] as const).map(([field,label])=><div className="public-team-bulk" key={field}><span><WorkspaceText text={label}/></span><div><button type="button" disabled={disabled} aria-label={`${t(label)}: ${t("On for active")}`} onClick={()=>bulk(field,true)}><WorkspaceText text="On for active"/></button><button type="button" disabled={disabled} aria-label={`${t(label)}: ${t("Off for all")}`} onClick={()=>bulk(field,false)}><WorkspaceText text="Off for all"/></button></div></div>)}</details>
  <details className="public-team-disclosure public-team-help"><summary><WorkspaceText text="How public profiles work"/></summary><p className="public-team-note"><WorkspaceText text="Active staff with online booking or Salon Profile posting enabled can appear publicly. These controls also change booking and posting permissions."/></p></details>
  {dirtyCount>0?<div className="public-team-save"><span><WorkspaceText text={`${dirtyCount} staff changed`}/></span><button type="button" disabled={pending} onClick={cancel}><WorkspaceText text="Cancel"/></button><button type="button" className="public-team-primary" disabled={disabled} onClick={save}><WorkspaceText text={pending?"Saving…":"Save changes"}/></button></div>:null}
  {message?<p className="public-team-message" role={failed?"alert":"status"}><WorkspaceText text={message}/></p>:null}
 </div>;
}
