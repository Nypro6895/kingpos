"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useEffect, useState, type ReactNode } from "react";
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
 {kind:"salon-profile",label:"Salon information & opening hours",permission:"salon_settings.view"},
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
 const [mobileStep,setMobileStep]=useState<"home"|"edit">(initialSection?"edit":"home");
 async function reload(){setBusy(true);setError("");try{setIndex(await loadSettingsHub());}catch(e){setError(e instanceof Error?e.message:"Could not reload your salons.");}finally{setBusy(false);}}
 function reveal(id:string){
  setQuery("");setSelection(id);setMobileStep("edit");
  window.history.replaceState(null,"",`/settings?section=${encodeURIComponent(id)}`);
  requestAnimationFrame(()=>{
   document.getElementById(id)?.scrollIntoView({block:"start"});
   document.getElementById(`${id}-heading`)?.focus({preventScroll:true});
  });
 }
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
 const search=query.trim().toLowerCase();
 const matching=(g:SettingGroup,i:SettingItem)=>[g.label,g.description||"",i.label].some(v=>v.toLowerCase().includes(search));
 useEffect(()=>{
  const target=initialId;
  if(!target)return;
  const frame=requestAnimationFrame(()=>document.getElementById(target)?.scrollIntoView({block:"start"}));
  return ()=>cancelAnimationFrame(frame);
 },[initialId]);
 function selectGroup(g:SettingGroup){
  setQuery("");setSelection(g.items[0]?.id||"personal-profile");setMobileStep("edit");
  window.history.replaceState(null,"",`/settings?section=${encodeURIComponent(g.items[0]?.id||"personal-profile")}`);
  requestAnimationFrame(()=>document.querySelector(".settings-hub")?.scrollIntoView({block:"start"}));
 }
 const areas=[
  {id:"personal",label:"Personal",groups:groups.filter(g=>g.id==="personal")},
  {id:"managed",label:"Salons I manage",groups:groups.filter(g=>g.id.startsWith("salon-")||g.id==="create")},
  {id:"staff",label:"My staff workspaces",groups:groups.filter(g=>g.id.startsWith("staff-"))},
  {id:"support",label:"Support",groups:groups.filter(g=>g.id==="help"||g.id==="legal")},
 ];
 function context(g:SettingGroup){
  const salon=index.managed.find(s=>g.id===`salon-${s.id}`);
  const staff=index.staff.find(s=>g.id===`staff-${s.id}`);
  return {role:salon?(salon.owner?"Owner":salon.role):staff?"Staff":"",status:salon?.status||staff?.status||"",address:salon?.address||staff?.address||""};
 }
 function categories(g:SettingGroup){
  const definitions=g.id.startsWith("salon-")?[
   {title:"Salon profile",icon:"store",keys:["salon-profile","public-profile"]},
   {title:"Services & booking",icon:"calendar",keys:["services","booking"]},
   {title:"Team & payroll",icon:"team",keys:["staff-team","payroll"]},
   {title:"POS & devices",icon:"device",keys:["pos-display"]},
   {title:"Workspace",icon:"grid",keys:["shortcuts"]},
   {title:"Ownership",icon:"shield",keys:["ownership"]},
   {title:"Advanced actions",icon:"warning",keys:["close-salon"]},
  ]:g.id==="personal"?[
   {title:"Profile & contact",icon:"user",keys:["personal-profile","personal-public"]},
   {title:"Login & security",icon:"shield",keys:["login-security","blocked-users"]},
   {title:"Notifications & connections",icon:"bell",keys:["notifications","connections"]},
   {title:"Advanced actions",icon:"warning",keys:["delete-account"]},
  ]:[{title:g.id.startsWith("staff-")?"My staff workspace":g.label,icon:g.id.startsWith("staff-")?"team":"help",keys:g.items.map(i=>i.id)}];
  return definitions.map(c=>({...c,items:g.items.filter(i=>c.keys.some(k=>i.id===k||i.id===`${g.id}-${k}`))})).filter(c=>c.items.length);
 }
 return <div className="settings-hub" data-mobile-step={mobileStep}>
  <header className="settings-page-header"><h1><WorkspaceText text="All Settings" /></h1><div className="settings-search"><label><SettingsIcon name="search"/><span className="sr-only"><WorkspaceText text="Find a setting or salon" /></span><input type="search" value={query} onChange={e=>{setQuery(e.target.value);setMobileStep("home");}} placeholder={__vt("Find a setting or salon…")}/></label><button type="button" aria-label={__vt("Refresh salon list")} disabled={busy} onClick={()=>void reload()}>↻</button></div></header>
  {error?<p role="alert" className="text-sm text-red-700"><WorkspaceText text={error} /></p>:null}
  <div className="settings-workbench">
   <nav aria-label={__vt("Settings accounts and salons")} className="settings-accounts">
    {areas.filter(a=>a.groups.length).map(area=><section key={area.id} className="settings-area" aria-label={__vt(area.label)}><h2 className="settings-group-label"><WorkspaceText text={area.label}/></h2>{area.groups.map(g=>{
     const meta=context(g);
     return <button key={g.id} type="button" className="settings-account-link" aria-pressed={activeGroup.id===g.id} onClick={()=>selectGroup(g)}>
      <SettingsIcon name={area.id==="managed"?"store":area.id==="staff"?"team":g.id==="personal"?"user":g.id==="legal"?"document":"help"}/>
      <span className="settings-account-copy"><strong><WorkspaceText text={g.label}/></strong><small>{meta.role?<><WorkspaceText text={meta.role}/>{meta.status?<> · <span className={meta.status==="active"?"settings-active":""}><WorkspaceText text={meta.status.replaceAll("_"," ")}/></span></>:null}</>:g.id==="personal"?<WorkspaceText text="Profile, security & notifications"/>:null}</small></span><span className="settings-account-chevron" aria-hidden="true">›</span>
     </button>;
    })}</section>)}
   </nav>
   <main className="settings-editor" hidden={!!search}>
    <button type="button" className="settings-back" onClick={()=>{setMobileStep("home");window.history.replaceState(null,"","/settings");}}>‹ <WorkspaceText text="All Settings"/></button>
    {groups.map(g=>{
     const meta=context(g), sections=categories(g),active=g.id===activeGroup.id;
     return <section key={g.id} hidden={!active} aria-label={__vt(g.label)}><SettingContent active={active}>
      <header className="settings-context-header"><p className="settings-breadcrumb"><WorkspaceText text="All Settings"/> / {g.label}</p><div className="settings-context-title"><h2><WorkspaceText text={g.label}/></h2>{meta.role?<span className="settings-role"><WorkspaceText text={meta.role}/></span>:null}{meta.status?<span className={meta.status==="active"?"settings-active":"settings-status"}><WorkspaceText text={meta.status.replaceAll("_"," ")}/></span>:null}</div>{meta.address||g.description?<p className="settings-context-description">{meta.address||g.description}</p>:null}</header>
      <nav className="settings-category-grid" aria-label={__vt("Settings sections")}>
       {sections.map(c=><div key={c.title} className={`settings-category${c.icon==="warning"?" settings-danger":""}`}><h3><SettingsIcon name={c.icon}/><WorkspaceText text={c.title}/></h3>{c.items.map(i=><button type="button" key={i.id} onClick={()=>reveal(i.id)}><SettingsIcon name={c.icon}/><span className="settings-row-label"><WorkspaceText text={i.label}/></span><span aria-hidden="true">›</span></button>)}</div>)}
      </nav>
      <div className="settings-inline-sections">{sections.map(c=><section className={`settings-inline-category${c.icon==="warning"?" settings-danger":""}`} key={c.title} aria-label={__vt(c.title)}><h3 className="settings-inline-heading"><SettingsIcon name={c.icon}/><WorkspaceText text={c.title}/></h3>{c.items.map(i=><section key={i.id} id={i.id} className="settings-inline-editor" aria-labelledby={`${i.id}-heading`}><h4 id={`${i.id}-heading`} tabIndex={-1}><WorkspaceText text={i.label}/></h4>{i.content}</section>)}</section>)}</div>
     </SettingContent></section>;
    })}
   </main>
   {search?<div className="settings-results" aria-label={__vt("Matching settings")}>{groups.flatMap(g=>g.items.filter(i=>matching(g,i)).map(i=><button type="button" key={i.id} onClick={()=>reveal(i.id)}><span><WorkspaceText text={i.label}/></span><small><WorkspaceText text={g.label}/></small><span aria-hidden="true">›</span></button>))}{!groups.some(g=>g.items.some(i=>matching(g,i)))?<p><WorkspaceText text="No matching settings"/></p>:null}</div>:null}
  </div>
 </div>;
}

function SettingsIcon({name}:{name:string}){
 const paths:Record<string,ReactNode>={
  user:<><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></>,
  store:<><path d="M3 10 5 3h14l2 7M4 13v8h16v-8M9 21v-6h6v6"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></>,
  calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/></>,
  team:<><circle cx="9" cy="8" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 5a3 3 0 0 1 0 6m3 4a6 6 0 0 1 3 6"/></>,
  device:<><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 22h8m-4-5v5"/></>,
  grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  shield:<><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z"/><path d="m8 12 3 3 5-6"/></>,
  warning:<><path d="m12 3 10 18H2zM12 9v5m0 3v1"/></>,
  document:<><path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8m-8 4h8"/></>,
  search:<><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></>,
  bell:<><path d="M4 18h16l-2-3V9a6 6 0 0 0-12 0v6zM9 21h6"/></>,
  help:<><circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 4 3c-1 1-1 2-1 3m0 3v1"/></>,
 };
 return <svg className="settings-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.help}</svg>;
}
