'use client';

import {useEffect,useRef,useState,useTransition,type ReactNode} from 'react';
import Link from 'next/link';
import {findBusinessClaimMatchesAction} from '@/app/claim/actions';
import type {BusinessClaimInput,BusinessClaimMatch} from '@/lib/business-claims';

function readForm(form:HTMLFormElement):BusinessClaimInput {
 const data=new FormData(form);const text=(key:string)=>String(data.get(key)??'');
 return {name:text('name'),phone:text('phone'),address:text('address_line1'),unit:text('address_line2'),city:text('city'),state:text('state')};
}
export function ClearSalonCreationDraft() {
 useEffect(()=>{try{sessionStorage.removeItem('business-create-draft');}catch{}},[]);
 return null;
}
const inputKey=(input:BusinessClaimInput)=>JSON.stringify(input);
export function ClaimSuggestions({children}:{children:ReactNode}) {
 const wrapper=useRef<HTMLDivElement>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const generation=useRef(0);
 const [matches,setMatches]=useState<BusinessClaimMatch[]>([]);const [error,setError]=useState<string|null>(null);const [pending,startTransition]=useTransition();
 const checkedKey=useRef('');const acknowledgedKey=useRef('');
 useEffect(()=>{
 const form=wrapper.current?.querySelector('form');if(!form)return;
 try {const draft=JSON.parse(sessionStorage.getItem('business-create-draft')??'null') as Record<string,string>|null;
 if(draft)for(const [key,value] of Object.entries(draft)){const field=form.elements.namedItem(key);if(field instanceof HTMLInputElement && field.type!=='hidden'){if(field.type==='checkbox')field.checked=value==='yes';else if(!field.value)field.value=value;}}
 }catch{/* Browser storage is optional. */}
 return ()=>{if(timer.current)clearTimeout(timer.current);};
 },[]);
 async function search(form:HTMLFormElement) {
 const input=readForm(form),key=inputKey(input),current=++generation.current;
 const result=await findBusinessClaimMatchesAction(input);
 if(current!==generation.current || key!==inputKey(readForm(form)))return null;
 checkedKey.current=result.error?'':key;setMatches(result.matches);setError(result.error);
 return result;
 }
 function persist(form:HTMLFormElement) {
 const data=new FormData(form);const draft:Record<string,string>={};for(const [key,value] of data)if(typeof value==='string' && key!=='create_request_key' && key!=='duplicate_acknowledged')draft[key]=value;
 try{sessionStorage.setItem('business-create-draft',JSON.stringify(draft));}catch{}
 }
 function continueCreate() {
 const form=wrapper.current?.querySelector('form');if(!form)return;
 acknowledgedKey.current=inputKey(readForm(form));
 const field=form.elements.namedItem('duplicate_acknowledged');if(field instanceof HTMLInputElement)field.value='yes';
 form.requestSubmit();
 }
 return <div ref={wrapper} onChange={event=>{
 const form=(event.target as HTMLInputElement).form;if(!form)return;
 persist(form);acknowledgedKey.current='';generation.current++;setMatches([]);
 const field=form.elements.namedItem('duplicate_acknowledged');if(field instanceof HTMLInputElement)field.value='no';
 if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>startTransition(async()=>{await search(form);}),450);
 }} onSubmit={event=>{
 const form=event.target as HTMLFormElement;if(!(form instanceof HTMLFormElement))return;
 const key=inputKey(readForm(form));persist(form);
 if(acknowledgedKey.current===key || checkedKey.current===key && matches.length===0)return;
 event.preventDefault();if(timer.current)clearTimeout(timer.current);
 startTransition(async()=>{const result=await search(form);if(result && !result.error && result.matches.length===0)form.requestSubmit();});
 }}>
 {children}
 <div aria-live="polite" className="mt-4">
 {pending?<p className="text-sm text-zinc-500">Checking existing salons…</p>:null}
 {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}
 {matches.length?<section className="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold">Your salon may already be on Reylumi</h2><p className="text-sm text-zinc-600">Choose an existing profile to keep its followers and posts.</p>{matches.map(row=><article key={row.salon_id} className="rounded-xl bg-white p-3"><h3 className="font-semibold">{row.name}</h3><p className="text-sm text-zinc-600">{row.address}</p><p className="text-sm text-zinc-600">{row.phone}</p><p className="mt-1 text-xs text-zinc-500">{row.phone_match && row.address_match?'Same phone and address':row.phone_match?'Same phone':row.address_match?'Similar address':'Similar name'}</p><Link className="mt-2 inline-block rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white" href={`/claim/${row.salon_id}`}>{row.unclaimed?'This is my salon — claim it':'This is my salon — request access'}</Link></article>)}<button type="button" disabled={pending} className="justify-self-start text-sm underline" onClick={continueCreate}>My salon is different — continue creating</button></section>:null}
 </div></div>;
}
