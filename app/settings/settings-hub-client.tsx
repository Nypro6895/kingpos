"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useState, type ReactNode } from "react";
import type { KingUser } from "@/types/user";
import { AccountProfileEditor } from "@/app/account/account-profile-editor";
import { PersonalPublicProfilePanel } from "./personal-public-profile-panel";
import { DeferredPersonalSection } from "./deferred-personal-section";
import { NotificationPreferencesPanel } from "./notification-preferences-panel";
import { ConnectionsPanel } from "./connections-panel";
import { SalonListPanel } from "./salon-list-panel";
import { DirectSettingsPanel } from "./direct-settings-panel";
import type { DirectSettingsKind } from "./direct-settings-actions";
import { loadSettingsHub, type SettingsHubIndex } from "./settings-hub-actions";
import "./settings-hub.css";
import Link from "next/link";
import {BlockedUsersPanel} from "./blocked-users-panel";

const manageItems: {kind:DirectSettingsKind;label:string;permission?:string;owner?:boolean}[]=[
 {kind:"salon-profile",label:"Salon information, opening hours & map",permission:"salon_settings.view"},
 {kind:"public-profile",label:"Public profile, website & publishing",permission:"salon_profile.view"},
 {kind:"services",label:"Services, prices & booking staff",permission:"services.view"},
 {kind:"booking",label:"Booking rules & availability",permission:"booking.view"},
 {kind:"staff-team",label:"Staff, invitations & public team",permission:"staff.view"},
 {kind:"payroll",label:"Pay cycle & staff payroll",permission:"payroll.view"},
 {kind:"pos-display",label:"POS, devices & customer display",permission:"tickets.view"},
 {kind:"shortcuts",label:"Today shortcuts"},
 {kind:"ownership",label:"Owners, ownership history & transfer",owner:true},
 {kind:"close-salon",label:"Salon status, backup & permanent closure",owner:true},
];
type SettingItem = {id:string; label:string; content:ReactNode};
type SettingGroup = {id:string; label:string; description?:string; items:SettingItem[]; owners?:ReactNode};
function SettingContent({active,children}:{active:boolean;children:ReactNode}) {
 const [visited,setVisited]=useState(active);
 if(active&&!visited)setVisited(true);
 return visited||active?<div hidden={!active}>{children}</div>:null;
}
export function SettingsHubClient({user,createdAtLabel,index:initial,initialSection="",initialQuery=""}: {user:KingUser;createdAtLabel:string;index:SettingsHubIndex;initialSection?:string;initialQuery?:string}) {
  const __vt = useWorkspaceTranslation();

 const [index,setIndex]=useState(initial),[query,setQuery]=useState(initialQuery),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [selection,setSelection]=useState("");
 const [mobileStep,setMobileStep]=useState<"home"|"sections"|"edit">(initialSection?"edit":"home");
 const [mobileGroup,setMobileGroup]=useState("personal");
 async function reload(){setBusy(true);setError("");try{setIndex(await loadSettingsHub());}catch(e){setError(e instanceof Error?e.message:"Could not reload your salons.");}finally{setBusy(false);}}
 function reveal(id:string){setQuery("");setSelection(id);setMobileStep("edit");window.history.replaceState(null,"",`/settings?section=${encodeURIComponent(id)}`);}
 const groups:SettingGroup[]=[{id:"personal",label:"Personal account",description:user.email||user.display_name||undefined,items:[
  {id:"personal-profile",label:"Profile & contact",content:<AccountProfileEditor user={user} createdAtLabel={createdAtLabel} embedded/>},
  {id:"personal-public",label:"Public profile & visibility",content:<PersonalPublicProfilePanel/>},
  {id:"login-security",label:"Login, devices & security",content:<DeferredPersonalSection kind="security"/>},
  {id:"notifications",label:"Notifications",content:<NotificationPreferencesPanel/>},
  {id:"connections",label:"Connections & invitations",content:<ConnectionsPanel onChanged={reload} onManageSalon={(id,mode)=>reveal(mode==="manage"?`salon-${id}-salon-profile`:`staff-${id}-profile`)}/>},
  {id:"blocked-users",label:"Blocked users",content:<BlockedUsersPanel/>},
  {id:"delete-account",label:"Delete personal account",content:<DeferredPersonalSection kind="deletion"/>},
 ]},...index.managed.map(s=>({id:`salon-${s.id}`,label:s.name,description:[s.address,s.role,`${__vt("Salon status:")} ${__vt(s.status.replaceAll("_"," "))}`].filter(Boolean).join(" · "),owners:<>{s.owners.map(o=><p key={o.id}>{o.email||o.name||o.id} <WorkspaceText text="owns" /> {s.name}<WorkspaceText text={o.isCurrentUser?" · You":""} />.</p>)}{s.ownersError?<p role="alert" className="text-red-700"><WorkspaceText text={s.ownersError} /></p>:null}</>,items:manageItems.filter(item=>(!item.owner||s.owner)&&(!item.permission||s.owner||s.permissions[item.permission])).map(item=>({id:`salon-${s.id}-${item.kind}`,label:item.label,content:<DirectSettingsPanel kind={item.kind} salonId={s.id} onChanged={["ownership","close-salon","salon-profile"].includes(item.kind)?reload:undefined}/>}))})),...index.staff.map(s=>({id:`staff-${s.id}`,label:s.name,description:s.address,items:[
  {id:`staff-${s.id}-profile`,label:"My staff profile & booking preferences",content:<DirectSettingsPanel kind="staff-workspace" salonId={s.id}/>},
  {id:`staff-${s.id}-schedule`,label:"My working hours & time off",content:<DirectSettingsPanel kind="staff-schedule" salonId={s.id}/>},
 ]}))];
 if(index.accounts.some(a=>a.canCreate))groups.push({id:"create",label:"Add salon",items:[{id:"create-salon",label:"Add salon",content:<SalonListPanel initialCreate createOnly onChanged={reload}/>} ]});
 groups.push({id:"legal",label:"Legal & Privacy",items:[{id:"legal-policies",label:"Policies & terms",content:<nav aria-label={__vt("Legal policies")} className="grid gap-3 text-sm"><Link href="/terms"><WorkspaceText text="Terms of Service" /></Link><Link href="/privacy"><WorkspaceText text="Privacy Policy" /></Link><Link href="/community"><WorkspaceText text="Community Standards" /></Link>{index.hasBusinessWorkspace?<Link href="/business-terms"><WorkspaceText text="Business & Salon Terms" /></Link>:null}</nav>}]});
 groups.push({id:"help",label:"Help & support",items:[{id:"help-support",label:"Help & support",content:<div className="grid gap-3 text-sm"><p><WorkspaceText text="Contact our team about app functionality, records, calculations or account access." /></p><Link className="text-orange-700 underline" href="/support"><WorkspaceText text="Send a request & view my conversations" /></Link><Link href="/account-recovery" className="underline"><WorkspaceText text="Account recovery" /></Link></div>}]});
 const all=groups.flatMap(g=>g.items);
 const initialId=initialSection==="profile"?"personal-profile":initialSection==="staff-connections"?"connections":all.find(i=>i.id===initialSection||i.id.endsWith(`-${initialSection}`)||initialSection==="staff-workspace"&&i.id.startsWith("staff-")&&i.id.endsWith("-profile")||initialSection==="staff-schedule"&&i.id.endsWith("-schedule"))?.id;
 const activeId=all.some(i=>i.id===selection)?selection:initialId||"personal-profile";
 const activeGroup=groups.find(g=>g.items.some(i=>i.id===activeId))||groups[0];
 const activeItem=activeGroup.items.find(i=>i.id===activeId)||activeGroup.items[0];
 const search=query.trim().toLowerCase();
 const matching=(g:SettingGroup,i:SettingItem)=>[g.label,g.description||"",i.label].some(v=>v.toLowerCase().includes(search));
 function groupButton(g:SettingGroup){return <button key={g.id} type="button" aria-pressed={activeGroup.id===g.id} onClick={()=>{setMobileGroup(g.id);setMobileStep(g.items.length>1?"sections":"edit");setSelection(g.items[0]?.id||"personal-profile");setQuery("");}} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${activeGroup.id===g.id?"font-semibold":"text-zinc-600 hover:bg-zinc-100"}`}><span className="block"><WorkspaceText text={g.label} /></span>{g.id.startsWith("salon-")||g.id.startsWith("staff-")?<span className="mt-0.5 block truncate text-xs font-normal text-zinc-500">{g.description}</span>:null}</button>;}
 const chosenGroup=groups.find(g=>g.id===mobileGroup)||activeGroup;
 function sectionButton(g:SettingGroup,i:SettingItem){return <button key={i.id} type="button" aria-current={i.id===activeItem.id?"page":undefined} onClick={()=>reveal(i.id)} className="settings-section-link"><span><WorkspaceText text={i.label} /></span><span aria-hidden="true">›</span></button>;}
 return <div className="settings-hub" data-mobile-step={mobileStep}>
  <header className="settings-page-header"><h1><WorkspaceText text="All Settings" /></h1><div className="settings-search"><label><span className="sr-only"><WorkspaceText text="Find a setting or salon" /></span><input type="search" value={query} onChange={e=>{setQuery(e.target.value);setMobileStep("home");}} placeholder={__vt("Find a setting or salon…")}/></label><button type="button" aria-label={__vt("Refresh salon list")} disabled={busy} onClick={()=>void reload()}>↻</button></div></header>
  {error?<p role="alert" className="text-sm text-red-700"><WorkspaceText text={error} /></p>:null}
  <div className="settings-workbench">
   <nav aria-label={__vt("Settings accounts and salons")} className="settings-accounts">
    {groups.map(g=><div key={g.id} className="settings-scope">{g.id===groups.find(x=>x.id.startsWith("salon-"))?.id?<p className="settings-group-label"><WorkspaceText text="Salons I own or manage" /></p>:null}{g.id===groups.find(x=>x.id.startsWith("staff-"))?.id?<p className="settings-group-label"><WorkspaceText text="Salons where I work" /></p>:null}{groupButton(g)}{g.id===activeGroup.id&&g.items.length>1?<div className="settings-desktop-sections">{g.items.map(i=>sectionButton(g,i))}</div>:null}</div>)}
   </nav>
   <div className="settings-mobile-sections"><button className="settings-back" onClick={()=>setMobileStep("home")}><WorkspaceText text="‹ All Settings" /></button><h2><WorkspaceText text={chosenGroup.label} /></h2><p className="settings-context-description">{chosenGroup.description}</p><nav aria-label={__vt("Choose a settings section")}>{chosenGroup.items.map(i=>sectionButton(chosenGroup,i))}</nav></div>
   <main className="settings-editor">
    <button className="settings-back" onClick={()=>{setMobileGroup(activeGroup.id);setMobileStep(activeGroup.items.length>1?"sections":"home");}}>‹ <WorkspaceText text={activeGroup.items.length>1?"Settings sections":"All Settings"} /></button>
    {activeGroup.id.startsWith("salon-")||activeGroup.id.startsWith("staff-")?<header className="settings-context"><span><WorkspaceText text={activeGroup.label} /></span></header>:null}
    <h2 className="settings-section-title"><WorkspaceText text={activeItem.label} /></h2>
    {groups.flatMap(g=>g.items.map(i=><section key={i.id} id={i.id} hidden={i.id!==activeItem.id} aria-label={__vt(i.label)}><SettingContent active={i.id===activeItem.id}>{i.content}</SettingContent></section>))}
   </main>
   {search?<div className="settings-results" aria-label={__vt("Matching settings")}>{groups.flatMap(g=>g.items.filter(i=>matching(g,i)).map(i=><button key={i.id} onClick={()=>reveal(i.id)}><span><WorkspaceText text={i.label} /></span><small><WorkspaceText text={g.label} /></small></button>))}{!groups.some(g=>g.items.some(i=>matching(g,i)))?<p><WorkspaceText text="No matching settings" /></p>:null}</div>:null}
  </div>
 </div>;
}
