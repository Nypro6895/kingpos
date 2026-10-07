"use client";
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
import { TwilioSettingsForm } from "@/app/(app)/admin/settings/twilio/settings-form";

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
 const [index,setIndex]=useState(initial),[query,setQuery]=useState(initialQuery),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [selection,setSelection]=useState("");
 async function reload(){setBusy(true);setError("");try{setIndex(await loadSettingsHub());}catch(e){setError(e instanceof Error?e.message:"Could not reload your salons.");}finally{setBusy(false);}}
 function reveal(id:string){setQuery("");setSelection(id);}
 const groups:SettingGroup[]=[{id:"personal",label:"Personal account",description:user.email||user.display_name||undefined,items:[
  {id:"personal-profile",label:"Profile & contact",content:<AccountProfileEditor user={user} createdAtLabel={createdAtLabel}/>},
  {id:"personal-public",label:"Public profile & visibility",content:<PersonalPublicProfilePanel/>},
  {id:"login-security",label:"Login, devices & security",content:<DeferredPersonalSection kind="security"/>},
  {id:"notifications",label:"Notifications",content:<NotificationPreferencesPanel/>},
  {id:"connections",label:"Connections & invitations",content:<ConnectionsPanel onChanged={reload} onManageSalon={(id,mode)=>reveal(mode==="manage"?`salon-${id}-salon-profile`:`staff-${id}-profile`)}/>},
  {id:"delete-account",label:"Delete personal account",content:<DeferredPersonalSection kind="deletion"/>},
 ]},...index.managed.map(s=>({id:`salon-${s.id}`,label:s.name,description:[s.address,s.role,s.status.replaceAll("_"," ")].filter(Boolean).join(" · "),owners:<>{s.owners.map(o=><p key={o.id}>{o.email||o.name||o.id} owns {s.name}{o.isCurrentUser?" · You":""}.</p>)}{s.ownersError?<p role="alert" className="text-red-700">{s.ownersError}</p>:null}</>,items:manageItems.filter(item=>(!item.owner||s.owner)&&(!item.permission||s.owner||s.permissions[item.permission])).map(item=>({id:`salon-${s.id}-${item.kind}`,label:item.label,content:<DirectSettingsPanel kind={item.kind} salonId={s.id} onChanged={["ownership","close-salon","salon-profile"].includes(item.kind)?reload:undefined}/>}))})),...index.staff.map(s=>({id:`staff-${s.id}`,label:s.name,description:s.address,items:[
  {id:`staff-${s.id}-profile`,label:"My staff profile & booking preferences",content:<DirectSettingsPanel kind="staff-workspace" salonId={s.id}/>},
  {id:`staff-${s.id}-schedule`,label:"My working hours & time off",content:<DirectSettingsPanel kind="staff-schedule" salonId={s.id}/>},
 ]}))];
 if(index.accounts.some(a=>a.canCreate))groups.push({id:"create",label:"Add salon",items:[{id:"create-salon",label:"Add salon",content:<SalonListPanel initialCreate createOnly onChanged={reload}/>} ]});
 if(index.support)groups.push({id:"support",label:"Account recovery",items:[{id:"recovery-back-office",label:"Support · account recovery",content:<DirectSettingsPanel kind="recovery-back-office"/>}]});
 if(index.twilio)groups.push({id:"admin",label:"Platform administration",items:[{id:"messaging",label:"Messaging",content:<TwilioSettingsForm settings={index.twilio}/>} ]});
 const all=groups.flatMap(g=>g.items);
 const initialId=initialSection==="profile"?"personal-profile":initialSection==="staff-connections"?"connections":all.find(i=>i.id===initialSection||i.id.endsWith(`-${initialSection}`)||initialSection==="staff-workspace"&&i.id.startsWith("staff-")&&i.id.endsWith("-profile")||initialSection==="staff-schedule"&&i.id.endsWith("-schedule"))?.id;
 const activeId=all.some(i=>i.id===selection)?selection:initialId||"personal-profile";
 const activeGroup=groups.find(g=>g.items.some(i=>i.id===activeId))||groups[0];
 const activeItem=activeGroup.items.find(i=>i.id===activeId)||activeGroup.items[0];
 const search=query.trim().toLowerCase();
 const matching=(g:SettingGroup,i:SettingItem)=>[g.label,g.description||"",i.label].some(v=>v.toLowerCase().includes(search));
 function groupButton(g:SettingGroup){return <button key={g.id} type="button" aria-pressed={activeGroup.id===g.id} onClick={()=>reveal(g.items[0]?.id||"personal-profile")} className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${activeGroup.id===g.id?"bg-orange-50 font-semibold text-orange-800":"text-zinc-600 hover:bg-zinc-100"}`}><span className="block">{g.label}</span>{g.id.startsWith("salon-")||g.id.startsWith("staff-")?<span className="mt-0.5 block truncate text-xs font-normal text-zinc-500">{g.description}</span>:null}</button>;}
 return <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8">
  <header className="mb-6 flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold tracking-tight text-zinc-950">All Settings</h1><button type="button" disabled={busy} onClick={()=>void reload()} className="min-h-10 px-3 text-sm font-medium text-zinc-600 hover:text-zinc-950">{busy?"Refreshing…":"Refresh salon list"}</button></header>
  <label className="mb-6 block max-w-xl"><span className="sr-only">Find a setting or salon</span><input type="search" className="min-h-11 w-full rounded-xl border-0 bg-zinc-100 px-4 text-sm outline-none focus:ring-2 focus:ring-orange-300" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a setting or salon…"/></label>
  {error?<p role="alert" className="mb-4 text-sm text-red-700">{error}</p>:null}
  <div className="grid min-w-0 gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
   <nav aria-label="Settings accounts and salons" className="space-y-5 md:border-r md:border-zinc-200 md:pr-5">
    {groupButton(groups[0])}
    <div><p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Salons I own or manage</p>{groups.filter(g=>g.id.startsWith("salon-")).map(groupButton)}{!index.managed.length?<p className="px-3 text-sm text-zinc-500">No linked salons</p>:null}{groups.filter(g=>g.id==="create").map(groupButton)}</div>
    {index.staff.length?<div><p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-zinc-400">Salons where I work</p>{groups.filter(g=>g.id.startsWith("staff-")).map(groupButton)}</div>:null}
    {groups.filter(g=>["support","admin"].includes(g.id)).map(groupButton)}
   </nav>
   <main className="min-w-0">
    <header className="mb-5"><h2 className="text-xl font-semibold tracking-tight">{activeGroup.label}</h2>{activeGroup.description?<p className="mt-1 text-sm text-zinc-500">{activeGroup.description}</p>:null}{activeGroup.owners?<div className="mt-3 space-y-1 text-sm text-zinc-600">{activeGroup.owners}</div>:null}</header>
    {search?<div className="mb-6 space-y-1" aria-label="Matching settings">{groups.flatMap(g=>g.items.filter(i=>matching(g,i)).map(i=><button key={i.id} type="button" onClick={()=>reveal(i.id)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 text-left text-sm hover:bg-zinc-100"><span>{i.label}</span><span className="text-xs text-zinc-500">{g.label}</span></button>))}{!groups.some(g=>g.items.some(i=>matching(g,i)))?<p className="text-sm text-zinc-500">No matching settings</p>:null}</div>:null}
    <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-x-5 gap-y-1 border-b border-zinc-200">{activeGroup.items.map(i=><button key={i.id} type="button" aria-current={i.id===activeItem.id?"page":undefined} onClick={()=>reveal(i.id)} className={`min-h-11 border-b-2 py-3 text-left text-sm ${i.id===activeItem.id?"border-orange-500 font-semibold text-zinc-950":"border-transparent text-zinc-500 hover:text-zinc-950"}`}>{i.label}</button>)}</nav>
    {groups.flatMap(g=>g.items.map(i=><section key={i.id} id={i.id} hidden={i.id!==activeItem.id} aria-label={i.label}><SettingContent active={i.id===activeItem.id}>{i.content}</SettingContent></section>))}
   </main>
  </div>
 </div>;
}
