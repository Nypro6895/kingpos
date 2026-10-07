"use client";

import { useEffect, useRef, useState } from "react";
import { openQuickBooking } from "@/lib/quick-booking-client";
type Hint = {key:string;startAt:string|null;timezoneIana?:string};
type Pending = {id:string;resolve:(hint:Hint|null)=>void};
const queues = new Map<string,Pending[]>();
const cache = new Map<string,{until:number;value:Hint|null}>();
let active = 0;
async function flush(salonId:string) {
  if (active >= 2) { setTimeout(() => void flush(salonId),100); return; }
  const batch = queues.get(salonId)?.splice(0,12) ?? [];
  if (!batch.length) { queues.delete(salonId); return; }
  active++;
  try {
    const response = await fetch("/api/public-booking/inspiration-times",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({salonId,contentIds:[...new Set(batch.map(item=>item.id))]})});
    if (!response.ok) throw new Error("unavailable");
    const hints = await response.json() as Hint[];
    for (const item of batch) { const value=hints.find(hint=>hint.key===item.id)??null; if(cache.size>=100)cache.delete(cache.keys().next().value!); cache.set(`${salonId}:${item.id}`,{until:Date.now()+20000,value});item.resolve(value); }
  } catch { batch.forEach(item=>item.resolve(null)); }
  finally { active--; if(queues.get(salonId)?.length)void flush(salonId);else queues.delete(salonId); }
}
function readHint(salonId:string,id:string):Promise<Hint|null> {
  const known=cache.get(`${salonId}:${id}`);
  if(known&&known.until>Date.now())return Promise.resolve(known.value);
  return new Promise(resolve=>{const queue=queues.get(salonId);if(queue)queue.push({id,resolve});else{queues.set(salonId,[{id,resolve}]);setTimeout(()=>void flush(salonId),100);}});
}
export function InspirationAvailability({href}:{href:string}) {
  const root=useRef<HTMLDivElement>(null);
  const [result,setResult]=useState<{href:string;hint:Hint|null}|null>(null);
  const hint=result?.href===href?result.hint:null;
  useEffect(()=>{
    const url=new URL(href,location.href);const id=url.searchParams.get("inspiration")??url.searchParams.get("lookId");const salonId=url.pathname.split("/")[2];
    if(!id||!salonId)return;
    let active=true;
    const observer=new IntersectionObserver(entries=>{if(!entries.some(entry=>entry.isIntersecting))return;observer.disconnect();void readHint(salonId,id).then(value=>{if(active)setResult({href,hint:value});});},{rootMargin:"100px"});
    if(root.current)observer.observe(root.current);
    return()=>{active=false;observer.disconnect();};
  },[href]);
  if(!hint?.startAt)return <div ref={root}/>;
  const timezone=hint.timezoneIana;
  if(!timezone)return <div ref={root}/>;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:timezone}).format(new Date());
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:timezone}).format(new Date(hint.startAt));
  const tomorrow=new Date(`${today}T12:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const nextDay=tomorrow.toISOString().slice(0,10);
  const label=day===today?"Today":day===nextDay?"Tomorrow":new Intl.DateTimeFormat("en-US",{weekday:"short",month:"short",day:"numeric",timeZone:timezone}).format(new Date(hint.startAt));
  const time=new Intl.DateTimeFormat("en-US",{hour:"numeric",minute:"2-digit",timeZone:timezone}).format(new Date(hint.startAt));
  return <div ref={root}><button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-full bg-[#e6f5f3] px-3 text-xs font-semibold text-[#168785]" onClick={()=>{const url=new URL(href,location.href);url.searchParams.set("startAt",hint.startAt!);openQuickBooking(url.href);}}>▣ {label} · {time}</button></div>;
}
