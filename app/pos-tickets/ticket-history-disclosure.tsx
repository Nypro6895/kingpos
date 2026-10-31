"use client";

import {useEffect,useRef,useState,type ReactNode} from "react";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {InlineFinancialHistory,InlineFinancialRecord,useInlineFinancialHistory} from "@/app/payroll/inline-financial-history";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import styles from "./ticket-history-disclosure.module.css";

export type TicketLegacyHistoryEntry={id:string;eventId?:string|null;createdAt:string;actor:string;note:string;summary:string[];change?:PayrollLiveChange};

export function useTicketInlineHistory(ticketId:string,legacyEntries:TicketLegacyHistoryEntry[]=[]){
 const history=useInlineFinancialHistory({ticketId,sourceKinds:["ticket"]});
 const known=new Set(history.changes.map(change=>change.id));
 const legacy=legacyEntries.filter(entry=>!entry.eventId||!known.has(entry.eventId));
 const ids=new Set(history.changes.map(change=>change.id));
 for(const entry of legacy)ids.add(entry.eventId??entry.id);
 return {...history,legacy,count:ids.size};
}

function TicketHistoryContents({history,timeZone}:{history:ReturnType<typeof useTicketInlineHistory>;timeZone?:string}){
 const [visible,setVisible]=useState(2);
 const items=[...history.changes.map(change=>({id:change.id,createdAt:change.created_at,change,legacy:undefined as TicketLegacyHistoryEntry|undefined})),
  ...history.legacy.map(legacy=>({id:legacy.eventId??legacy.id,createdAt:legacy.createdAt,change:legacy.change,legacy}))]
  .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
 const focusIndex=items.findIndex(item=>item.id===history.focusedEventId),shown=Math.max(visible,focusIndex+1);
 return <div className={styles.body}>
  {items.slice(0,shown).map(item=>item.change?<InlineFinancialHistory key={item.id} changes={[item.change]}/>:<div className={styles.legacy} key={item.id} data-input-event={item.id}>
   {item.legacy?.summary.map((line,index)=><p key={index}>{line}</p>)}
   {item.legacy?.note&&<p><Text text="Reason"/>: {item.legacy.note}</p>}
   <p className={styles.meta}>{item.legacy?.actor} · <time dateTime={item.createdAt}>{new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:timeZone??"UTC"}).format(new Date(item.createdAt))}</time></p>
  </div>)}
  {shown<items.length&&<button className={styles.more} type="button" onClick={()=>setVisible(shown+5)}><Text text="View earlier edits"/> · {items.length-shown}</button>}
 </div>;
}

/** One disclosure belongs to the ticket itself; its editor remains independent. */
export function TicketHistoryDisclosure({ticketId,legacyEntries,children,timeZone,inlineOnly=false,additionalDetails}:{ticketId:string;legacyEntries?:TicketLegacyHistoryEntry[];children?:ReactNode;timeZone?:string;inlineOnly?:boolean;additionalDetails?:ReactNode}){
 const history=useTicketInlineHistory(ticketId,legacyEntries),ref=useRef<HTMLDetailsElement>(null),plain=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(history.focusedEventId&&(history.changes.some(change=>change.id===history.focusedEventId)||history.legacy.some(entry=>(entry.eventId??entry.id)===history.focusedEventId))){
   if(ref.current){ref.current.open=true;ref.current.scrollIntoView({block:"nearest"});}
  }
  if(history.record)plain.current?.scrollIntoView({block:"nearest"});
 },[history.focusedEventId,history.changes,history.legacy,history.record]);
 if(inlineOnly)return history.count?<TicketHistoryContents history={history} timeZone={timeZone}/>:null;
 if(!history.count&&!additionalDetails)return <div ref={plain}>{children}{history.record&&<InlineFinancialRecord record={history.record}/>} {history.error&&<p className={styles.neutral} role="status"><Text text="Ticket edit history could not load."/> <button type="button" onClick={history.retry}><Text text="Retry"/></button></p>}</div>;
 return <details ref={ref} className={history.count?styles.edited:undefined} data-edited-ticket={history.count?ticketId:undefined}>
  <summary className={styles.summary}>{children}<span className={`${styles.label} ${!history.count?styles.plainLabel:""}`}><span>{history.count?<><Text text="Edited"/> · {history.count}</>:<Text text="Details"/>}</span><svg className={styles.chevron} viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg></span></summary>
  {history.count>0&&<TicketHistoryContents history={history} timeZone={timeZone}/>}
  {additionalDetails}
 </details>;
}
