"use client";
import {useEffect,useRef,useState} from "react";
import {useSearchParams} from "next/navigation";
import {PayrollChangeHistory} from "./payroll-change-history";
import {financialHistoryText} from "@/lib/financial-change-presentation";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import {WorkspaceText as Text} from "@/components/workspace-language";
import styles from "./financial-input-history.module.css";

function TicketRecord({record}:{record:PayrollLiveChange}){
 const ref=useRef<HTMLElement>(null),values=record.after_values;
 useEffect(()=>{ref.current?.scrollIntoView({block:"nearest"});},[record.id]);
 const ticket=financialHistoryText(record.ticket_number??values.ticket_number);
 const amount=(value:unknown)=>value!==null&&value!==undefined&&Number.isFinite(Number(value))?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(value)):"—";
 const lines=Array.isArray(values.lines)?values.lines.filter((line):line is Record<string,unknown>=>Boolean(line)&&typeof line==="object"):[];
 return <section ref={ref} id="ticket-record" className={styles.section} aria-label="Recorded ticket"><h2><Text text={ticket?`Ticket ${ticket} recorded`:"Ticket recorded"}/></h2>
  <p className={styles.meta}><Text text="Business date"/> {record.period_start} · <time dateTime={record.created_at}>{new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:record.business_timezone??"UTC"}).format(new Date(record.created_at))}</time></p>
  <p className={styles.meta}><Text text="Recorded by"/> {financialHistoryText(record.actor_name,"POS")}</p>
  <p className={styles.hint}><Text text="Original ticket entry, as recorded at that time."/></p>
  <dl>{[["Services",values.service_total],["Tips",values.tip_amount],...(!record.staff_id&&values.discount_amount!==undefined?[["Customer discount",values.discount_amount]]:[])].map(([label,value])=><div className={styles.value} key={String(label)}><dt><Text text={String(label)}/></dt><dd>{amount(value)}</dd></div>)}</dl>
  {lines.length>0&&<ul className={styles.list}>{lines.map((line,index)=><li className={styles.value} key={index}><span>{financialHistoryText(line.service_name??line.service_name_snapshot,"Service")}</span><span>{amount(line.service_total)}</span></li>)}</ul>}
 </section>;
}

export function FinancialInputHistoryPanel({salonId="",surface="today",start,end,refreshKey,scope="",historyQuery,title="Recent input changes",focusOnly=false,anchorId="input-history"}:{salonId?:string;surface?:"today"|"reports"|"payroll";start?:string;end?:string;refreshKey?:unknown;scope?:string;historyQuery?:string;title?:string;focusOnly?:boolean;anchorId?:string}){
 const nextQuery=useSearchParams(),query=historyQuery!==undefined?new URLSearchParams(historyQuery):nextQuery,eventDate=surface==="today"?query?.get("eventDate"):null,eventId=query?.get("inputEvent")?.toLowerCase()??null;
 const key=JSON.stringify([salonId,surface,start,end,eventDate,eventId,refreshKey,scope]);
 const [result,setResult]=useState<{key:string;rows:PayrollLiveChange[];record?:PayrollLiveChange;error:string}>({key:"",rows:[],error:""});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(focusOnly&&!eventId)return;
  const abort=new AbortController();let readVersion=0;
  async function load(){
   const version=++readVersion,args=new URLSearchParams({surface});
   if(salonId)args.set("salonId",salonId);if(start)args.set("start",start);if(end)args.set("end",end);
   if(eventDate&&/^\d{4}-\d{2}-\d{2}$/.test(eventDate))args.set("date",eventDate);
   if(eventId)args.set("inputEvent",eventId);
   try{
    const response=await fetch(`/api/financial-input-history?${args}`,{credentials:"same-origin",cache:"no-store",signal:abort.signal}),data=await response.json();
    if(!response.ok||!Array.isArray(data.rows))throw new Error(data.error??"History unavailable.");
    if(!abort.signal.aborted&&version===readVersion)setResult({key,rows:data.rows,record:data.record,error:""});
   }catch{if(!abort.signal.aborted&&version===readVersion)setResult({key,rows:[],error:"This history record could not be loaded."});}
  }
  void load();const refresh=()=>{if(document.visibilityState==="visible")void load();};
  window.addEventListener("focus",refresh);window.addEventListener("financial-input-saved",refresh);window.addEventListener("hashchange",refresh);
  return()=>{abort.abort();window.removeEventListener("focus",refresh);window.removeEventListener("financial-input-saved",refresh);window.removeEventListener("hashchange",refresh);};
 },[key,attempt,salonId,surface,start,end,eventDate,eventId,focusOnly]);
 if(focusOnly&&!eventId)return null;
 if(result.key!==key)return <div id={anchorId}><p role="status" className={styles.hint}><Text text="Loading input history…"/></p></div>;
 if(result.error)return <div id={anchorId}><p role="status" className={styles.hint}><Text text={result.error}/> <button type="button" className={styles.more} onClick={()=>setAttempt(n=>n+1)}><Text text="Retry"/></button></p></div>;
 const recentQuery=new URLSearchParams(query?.toString());recentQuery.delete("inputEvent");recentQuery.delete("eventDate");
 return <div id={anchorId}>
  {result.record&&<TicketRecord record={result.record}/>}
  <PayrollChangeHistory compact changes={result.rows} title={eventId?"Change from notification":title} focusedEventId={eventId??undefined}/>
  {eventId&&!focusOnly&&<a className={styles.more} href={`${recentQuery.size?`?${recentQuery}`:"?"}#input-history`}><Text text="View recent changes"/></a>}
 </div>;
}
