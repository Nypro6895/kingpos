"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useState } from "react";
import type { TodayQuickAccessConfiguration } from "@/lib/today-quick-accesses";
import { saveSettingsShortcuts } from "./settings-extra-actions";
import { InlineForm, buttonClass } from "./direct-settings-ui";
export function ShortcutsSettingsPanel({salonId,configuration,onSaved}:{salonId:string;configuration:TodayQuickAccessConfiguration;onSaved:()=>Promise<void>}){
  const __vt = useWorkspaceTranslation();

 const [ids,setIds]=useState(configuration.selected.map(s=>s.id));
 const choices=[...configuration.selected,...configuration.available];
 return <InlineForm onSaved={onSaved} onCancel={()=>setIds(configuration.selected.map(s=>s.id))} label={__vt("Save shortcut order")} save={()=>saveSettingsShortcuts(salonId,ids)}>
  {configuration.loadError?<p role="alert" className="text-sm text-red-700"><WorkspaceText text={configuration.loadError} /></p>:null}
  <p className="text-xs text-zinc-500"><WorkspaceText text="Choose up to" /> {configuration.maxSelected} <WorkspaceText text="shortcuts for this salon." /></p>
  {ids.map((id,index)=><div key={id} className="flex flex-wrap items-center gap-2 rounded-md border p-2"><span className="flex-1 text-sm">{index+1}. {choices.find(c=>c.id===id)?.label}</span>{(["up","down"] as const).map(direction=><button key={direction} type="button" className={buttonClass} disabled={direction==="up"?index===0:index===ids.length-1} aria-label={__vt(`Move ${choices.find(c=>c.id===id)?.label} ${direction}`)} onClick={()=>{const next=[...ids],other=index+(direction==="up"?-1:1);[next[index],next[other]]=[next[other],next[index]];setIds(next);}}>{direction==="up"?"↑":"↓"}</button>)}<button type="button" className={buttonClass} onClick={()=>setIds(ids.filter(i=>i!==id))}><WorkspaceText text="Remove" /></button></div>)}
  <div className="flex flex-wrap gap-2">{choices.filter(c=>!ids.includes(c.id)).map(c=><button type="button" disabled={ids.length>=configuration.maxSelected} key={c.id} className={buttonClass} onClick={()=>setIds([...ids,c.id])}>+ <WorkspaceText text={c.label} /></button>)}</div>
 </InlineForm>;
}
