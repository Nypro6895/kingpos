"use client";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { savePosSettingsGroup } from "./actions";
import { normalizeWorkspacePreferences } from "@/lib/pos-workspace-preferences";
const button="min-h-12 rounded-xl border px-4 py-3 font-semibold transition hover:bg-orange-50";
function valueFor(name:string,row:Record<string,unknown>){
  const preferences=normalizeWorkspacePreferences(row.workspace_preferences);
  if(name in preferences)return preferences[name as keyof typeof preferences];
  if(name.startsWith('tip_suggestion_'))return (row.tip_suggestions as number[]|undefined)?.[Number(name.slice(-1))-1]??0;
  if(name.startsWith('current_'))return row[name.slice(8)]??'';
  if(name.startsWith('remove_'))return false;
  return row[name];
}
export function SettingsGroupForm({group,snapshot,children}:{group:string;snapshot:Record<string,unknown>;children:ReactNode}) {
  const expected=useRef(snapshot),form=useRef<HTMLFormElement>(null);
  const [busy,start]=useTransition(),[message,setMessage]=useState('');
  const [conflict,setConflict]=useState<Record<string,unknown>|null>(null);
  const [changed,setChanged]=useState<{name:string;label:string;saved:string}[]>([]);
  function describeConflict(conflict:Record<string,unknown>){return form.current?Array.from(form.current.elements).flatMap(element=>{
    if(!(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)||!element.name||element.type==='hidden'||element.type==='file')return [];
    const saved=valueFor(element.name,conflict);if(saved===undefined)return [];
    const mine=element instanceof HTMLInputElement&&element.type==='checkbox'?element.checked:element.value;
    if(String(saved)===String(mine))return [];
    return [{name:element.name,label:element.labels?.[0]?.textContent?.trim()||element.name.replaceAll('_',' '),saved:typeof saved==='boolean'?(saved?'On':'Off'):String(saved??'Empty')}];
  }):[];}
  function acceptSaved(){
    if(!conflict||!form.current)return;
    for(const element of Array.from(form.current.elements)){
      if(!(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement)||!element.name)continue;
      if(element instanceof HTMLInputElement&&element.type==='file'){element.value='';continue;}
      const saved=valueFor(element.name,conflict);if(saved===undefined)continue;
      if(element instanceof HTMLInputElement&&element.type==='checkbox')element.checked=Boolean(saved);
      else element.value=String(saved??'');
    }
    expected.current=conflict;setConflict(null);setMessage('Saved values loaded. Other settings groups were kept.');
  }
  return <form ref={form} className="mt-4 grid gap-4" onSubmit={event=>{
    event.preventDefault();if(conflict)return;
    const data=new FormData(event.currentTarget);data.set('group',group);data.set('expected',JSON.stringify(expected.current));
    start(async()=>{try{const result=await savePosSettingsGroup(data);if(result.ok&&result.snapshot)expected.current=result.snapshot;setConflict(result.conflict??null);setChanged(result.conflict?describeConflict(result.conflict):[]);setMessage(result.ok?'Saved':result.error??'Unable to save. Your changes are still here.');}catch{setMessage('Unable to save. Your changes are still here.');}});
  }}><fieldset disabled={busy} className="grid gap-4">{children}</fieldset>
    {conflict?<section className="rounded-xl border border-amber-200 bg-amber-50 p-4" aria-label="Settings changed"><p className="font-semibold">Changed on another screen</p><ul className="my-3 space-y-2 text-sm">{changed.map(item=><li key={item.name}>{item.label}: <strong>{item.saved}</strong></li>)}</ul><div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={acceptSaved}>Use saved values</button><button type="button" className={button} onClick={()=>{expected.current=conflict;setConflict(null);setMessage('Your changes are kept. Select Save changes to replace the saved values.');}}>Keep my changes</button></div></section>:null}
    <div className="flex items-center justify-end gap-3"><p role="status" className="text-sm text-zinc-600">{message}</p><button className="min-h-12 rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white transition hover:bg-orange-700 disabled:opacity-50" disabled={busy||Boolean(conflict)}>{busy?'Saving...':'Save changes'}</button></div></form>;
}
