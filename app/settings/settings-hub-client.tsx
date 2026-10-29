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
import "./settings-controls.css";
import { SettingsIcon } from "./settings-icon";
import { getSettingCopy, settingsCategories } from "./settings-navigation";
import Link from "next/link";
import {BlockedUsersPanel} from "./blocked-users-panel";
import { SettingContent } from "./setting-content";

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
export function SettingsHubClient({user,createdAtLabel,index:initial,initialSection="",initialQuery=""}: {user:KingUser;createdAtLabel:string;index:SettingsHubIndex;initialSection?:string;initialQuery?:string}) {
  const __vt = useWorkspaceTranslation();

 const [index,setIndex]=useState(initial),[query,setQuery]=useState(initialQuery),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function reload(){setBusy(true);setError("");try{setIndex(await loadSettingsHub());}catch(e){setError(e instanceof Error?e.message:"Could not reload your salons.");}finally{setBusy(false);}}
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
 const resolveSection=(section:string)=>{
  const alias=section==="profile"?"personal-profile":section==="staff-connections"?"connections":section;
  const item=all.find(i=>i.id===alias||i.id.endsWith(`-${alias}`)||alias==="staff-workspace"&&i.id.startsWith("staff-")&&i.id.endsWith("-profile")||alias==="staff-schedule"&&i.id.endsWith("-schedule"));
  const group=groups.find(g=>g.id===alias||g.items.some(i=>i.id===item?.id));
  return {group:group?.id||"personal",item:item?.id||"",step:!section?"home":item?"detail":"group"};
 };
 const [location,setLocation]=useState(()=>resolveSection(initialSection));
 const [visited,setVisited]=useState<string[]>(()=>location.item?[location.item]:[]);
 const activeGroup=groups.find(g=>g.id===location.group)||groups[0];
 const activeItem=activeGroup.items.find(i=>i.id===location.item);
 const detail=!!activeItem&&location.step==="detail";
 const search=query.trim().toLowerCase();
 function navigate(group:string,item="",step=item?"detail":"group"){
  setQuery("");setLocation({group,item,step});
  if(item)setVisited(previous=>previous.includes(item)?previous:[...previous,item]);
  const section=step==="home"?"":item||group;
  window.history.pushState(null,"",section?`/settings?section=${encodeURIComponent(section)}`:"/settings");
  requestAnimationFrame(()=>{
   document.getElementById("settings-view-heading")?.focus({preventScroll:true});
   document.querySelector(".settings-hub")?.scrollIntoView({block:"start"});
  });
 }
 function reveal(id:string){const group=groups.find(g=>g.items.some(i=>i.id===id));if(group)navigate(group.id,id);}
 useEffect(()=>()=>{
  if(initialSection)return;
  setLocation({group:"personal",item:"",step:"home"});setQuery(initialQuery);
 },[initialSection,initialQuery]);
 useEffect(()=>{
  const restore=()=>{
   const next=resolveSection(new URLSearchParams(window.location.search).get("section")||"");
   setQuery("");setLocation(next);
   if(next.item)setVisited(previous=>previous.includes(next.item)?previous:[...previous,next.item]);
  };
  window.addEventListener("popstate",restore);
  return()=>window.removeEventListener("popstate",restore);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[index]);
 const areas=[
  {id:"personal",label:"Personal",groups:groups.filter(g=>g.id==="personal")},
  {id:"managed",label:"Salons I manage",groups:groups.filter(g=>g.id.startsWith("salon-")||g.id==="create")},
  {id:"staff",label:"My staff workspaces",groups:groups.filter(g=>g.id.startsWith("staff-"))},
  {id:"support",label:"Support",groups:groups.filter(g=>g.id==="help"||g.id==="legal")},
 ];
 function context(g:SettingGroup){
  const salon=index.managed.find(s=>g.id===`salon-${s.id}`),staff=index.staff.find(s=>g.id===`staff-${s.id}`);
  return {role:salon?(salon.owner?"Owner":salon.role):staff?"Staff":"",status:salon?.status||staff?.status||"",address:salon?.address||staff?.address||""};
 }
 function categories(g:SettingGroup){
  const definitions=settingsCategories(g.id);
  return definitions.length?definitions.map(c=>({...c,items:g.items.filter(i=>c.keys.some(k=>i.id===k||i.id===`${g.id}-${k}`))})).filter(c=>c.items.length)
   :[{title:g.id.startsWith("staff-")?"My work":g.label,items:g.items}];
 }
 const matching=(g:SettingGroup,i:SettingItem)=>{
  const copy=getSettingCopy(g.id,i.id);
  return [g.label,g.description||"",i.label,copy.label,copy.description,...[copy.label,copy.description].map(__vt)].some(value=>value.toLocaleLowerCase().includes(search));
 };
 const selectedMeta=activeItem?getSettingCopy(activeGroup.id,activeItem.id):null;
 const meta=context(activeGroup);
 const singleItemGroup=["create","help","legal"].includes(activeGroup.id);
 const goBack=()=>detail&&!singleItemGroup?navigate(activeGroup.id):navigate("personal","","home");
 function selectGroup(g:SettingGroup){if(["create","help","legal"].includes(g.id))navigate(g.id,g.items[0].id);else navigate(g.id);}
 return <div className="settings-hub" data-mobile-step={search?"home":location.step}>
  <header className="settings-page-header"><h1><WorkspaceText text="All Settings"/></h1><div className="settings-search"><label><SettingsIcon name="search"/><span className="sr-only"><WorkspaceText text="Find a setting or salon"/></span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={__vt("Find a setting or salon…")}/></label><button type="button" aria-label={__vt("Refresh salon list")} disabled={busy} onClick={()=>void reload()}>↻</button></div></header>
  {error?<p role="alert" className="text-sm text-red-700"><WorkspaceText text={error}/></p>:null}
  <div className="settings-workbench">
   <nav aria-label={__vt("Settings accounts and salons")} className="settings-accounts" hidden={!!search}>
    {areas.filter(a=>a.groups.length).map(area=><section key={area.id} className="settings-area" aria-label={__vt(area.label)}><h2 className="settings-group-label"><WorkspaceText text={area.label}/></h2>{area.groups.map(g=>{
     const m=context(g);
     return <button key={g.id} type="button" className="settings-account-link" aria-pressed={activeGroup.id===g.id} onClick={()=>selectGroup(g)}>
      <SettingsIcon name={g.id==="create"?"plus":area.id==="managed"?"store":area.id==="staff"?"badge":g.id==="personal"?"user":g.id==="legal"?"document":"help"}/>
      <span className="settings-account-copy"><strong><WorkspaceText text={g.label}/></strong><small>{m.role?<><WorkspaceText text={m.role}/>{m.status?<> · <span className={m.status==="active"?"settings-active":""}><WorkspaceText text={m.status.replaceAll("_"," ")}/></span></>:null}</>:g.id==="personal"?user.email||<WorkspaceText text="Profile, security & notifications"/>:null}</small></span><span className="settings-account-chevron" aria-hidden="true">›</span>
     </button>;
    })}</section>)}
   </nav>
   <main className="settings-editor" hidden={!!search}>
    <button type="button" className="settings-back" onClick={goBack}>‹ <WorkspaceText text={detail&&!singleItemGroup?activeGroup.label:"All Settings"}/></button>
    <header className="settings-context-header">
     <p className="settings-breadcrumb"><WorkspaceText text="All Settings"/> / <WorkspaceText text={activeGroup.label}/>{detail?<> / <WorkspaceText text={selectedMeta!.label}/></>:null}</p>
     <div className="settings-context-title"><h2 id="settings-view-heading" tabIndex={-1}><WorkspaceText text={detail?selectedMeta!.label:activeGroup.label}/></h2>{meta.role?<span className="settings-role"><WorkspaceText text={meta.role}/></span>:null}{meta.status?<span className={meta.status==="active"?"settings-active":"settings-status"}><WorkspaceText text={meta.status.replaceAll("_"," ")}/></span>:null}</div>
     <p className="settings-context-description">{detail?<><WorkspaceText text={activeGroup.label}/>{meta.address?` · ${meta.address}`:""}</>:meta.address||activeGroup.description||<WorkspaceText text="Choose a setting to get started"/>}</p>
     {detail?<p className="settings-context-description"><WorkspaceText text={selectedMeta!.description}/></p>:null}
    </header>
    {!detail?<nav className="settings-category-grid" aria-label={__vt("Settings sections")}>
     {categories(activeGroup).map(c=><section key={c.title} className="settings-category"><h3><WorkspaceText text={c.title}/></h3><div className="settings-category-rows">{c.items.map(i=>{
      const copy=getSettingCopy(activeGroup.id,i.id);
      return <button type="button" key={i.id} className={copy.danger?"settings-danger-row":undefined} onClick={()=>reveal(i.id)}><SettingsIcon name={copy.icon}/><span className="settings-row-label"><strong><WorkspaceText text={copy.label}/></strong><small><WorkspaceText text={copy.description}/></small></span><span className="settings-row-chevron" aria-hidden="true">›</span></button>;
     })}</div></section>)}
    </nav>:null}
    <div className="settings-inline-sections" hidden={!detail}>
     {groups.map(g=>g.items.map(i=>{
      const active=detail&&i.id===activeItem?.id;
      return visited.includes(i.id)?<section key={i.id} id={i.id} className="settings-inline-editor" hidden={!active} aria-label={__vt(getSettingCopy(g.id,i.id).label)}><SettingContent active={active}>{i.content}</SettingContent></section>:null;
     }))}
    </div>
   </main>
   {search?<div className="settings-results" aria-label={__vt("Matching settings")}><h2><WorkspaceText text="Search results"/></h2>{groups.flatMap(g=>g.items.filter(i=>matching(g,i)).map(i=>{
    const copy=getSettingCopy(g.id,i.id);
    return <button type="button" key={i.id} className={copy.danger?"settings-danger-row":undefined} onClick={()=>reveal(i.id)}><SettingsIcon name={copy.icon}/><span className="settings-row-label"><strong><WorkspaceText text={copy.label}/></strong><small><WorkspaceText text={g.label}/></small></span><span aria-hidden="true">›</span></button>;
   }))}{!groups.some(g=>g.items.some(i=>matching(g,i)))?<p><WorkspaceText text="No matching settings"/></p>:null}</div>:null}
  </div>
 </div>;
}
