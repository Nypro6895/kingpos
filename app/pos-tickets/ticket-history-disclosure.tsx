"use client";

import {useEffect,useId,useRef,useState,type ReactNode} from "react";
import {useSearchParams} from "next/navigation";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {InlineFinancialHistory,InlineFinancialRecord,useInlineFinancialHistory,useFinancialHistoryContext} from "@/app/payroll/inline-financial-history";
import {financialHistoryForObject} from "@/lib/inline-financial-history";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import styles from "./ticket-history-disclosure.module.css";

export type TicketLegacyHistoryEntry={id:string;eventId?:string|null;createdAt:string;actor:string;note:string;summary:string[];change?:PayrollLiveChange};

/** Only an explicit event key can establish that two stores describe one save. */
export function mergeTicketInlineHistory(changes:readonly PayrollLiveChange[],legacyEntries:readonly TicketLegacyHistoryEntry[]=[]){
 const known=new Set(changes.map(change=>change.id)),seen=new Set<string>(),legacy:TicketLegacyHistoryEntry[]=[],earlier:TicketLegacyHistoryEntry[]=[];
 for(const entry of legacyEntries){
  const key=entry.eventId?`event:${entry.eventId}`:`raw:${entry.id}`;
  if(entry.eventId&&known.has(entry.eventId)||seen.has(key)||entry.change&&!financialHistoryForObject([entry.change]).length)continue;
  seen.add(key);
  if(entry.eventId)legacy.push(entry);else earlier.push(entry);
 }
 const count=known.size+legacy.length;
 return {legacy,earlier,count,hasChanges:count>0||earlier.length>0,countKnown:earlier.length===0};
}

export function useTicketInlineHistory(ticketId:string,legacyEntries:TicketLegacyHistoryEntry[]=[]){
 const history=useInlineFinancialHistory({ticketId,sourceKinds:["ticket"]}),context=useFinancialHistoryContext(),query=useSearchParams(),key=useId();
 const merged=mergeTicketInlineHistory(history.changes,legacyEntries),target=history.focusedEventId??context.focusedEventId??query?.get("inputEvent")?.toLowerCase();
 const legacyFocus=target&&[...merged.legacy,...merged.earlier].some(entry=>(entry.eventId??entry.id)===target)?target:undefined,claim=context.claim;
 useEffect(()=>legacyFocus?claim?.(legacyFocus,key):undefined,[claim,legacyFocus,key]);
 return {...history,...merged,focusedEventId:history.focusedEventId??legacyFocus};
}

function LegacyEntry({entry,timeZone}:{entry:TicketLegacyHistoryEntry;timeZone?:string}){
 let time="";try{if(Number.isFinite(Date.parse(entry.createdAt)))time=new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:timeZone??"UTC"}).format(new Date(entry.createdAt));}catch{}
 return <div className={styles.legacy} data-input-event={entry.eventId??entry.id}>
  {entry.summary.map((line,index)=><p key={index}>{line}</p>)}
  {entry.note&&<p><Text text="Reason"/>: {entry.note}</p>}
  <p className={styles.meta}>{entry.actor}{time&&<> · <time dateTime={entry.createdAt}>{time}</time></>}</p>
 </div>;
}

function EarlierRecords({entries,focusedEventId,timeZone,inline=false}:{entries:TicketLegacyHistoryEntry[];focusedEventId?:string;timeZone?:string;inline?:boolean}){
 const ref=useRef<HTMLDetailsElement>(null),[visible,setVisible]=useState(2);
 const ordered=[...entries].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)),focusIndex=ordered.findIndex(entry=>(entry.eventId??entry.id)===focusedEventId),shown=Math.max(visible,focusIndex+1);
 useEffect(()=>{if(focusIndex>=0&&ref.current){ref.current.open=true;ref.current.scrollIntoView({block:"nearest"});}},[focusIndex,focusedEventId]);
 if(!entries.length)return null;
 const records=<>{ordered.slice(0,shown).map(entry=><LegacyEntry key={entry.id} entry={entry} timeZone={timeZone}/>)}{shown<ordered.length&&<button className={styles.more} type="button" onClick={()=>setVisible(shown+5)}><Text text="View earlier records"/></button>}</>;
 if(inline)return <div className={styles.earlier} data-earlier-ticket-records><p className={styles.explanation}><Text text={entries.length===1?"Earlier record":"Earlier records"}/></p>{records}</div>;
 return <details ref={ref} className={styles.earlier} data-earlier-ticket-records>
  <summary><Text text="Earlier records"/></summary>
  <p className={styles.explanation}><Text text="Older records may describe the same edit."/></p>
  {records}
 </details>;
}

function TicketHistoryContents({history,timeZone}:{history:ReturnType<typeof useTicketInlineHistory>;timeZone?:string}){
 const [visible,setVisible]=useState(2);
 const items=[...history.changes.map(change=>({id:change.id,createdAt:change.created_at,change,legacy:undefined as TicketLegacyHistoryEntry|undefined})),
  ...history.legacy.map(legacy=>({id:legacy.eventId??legacy.id,createdAt:legacy.createdAt,change:legacy.change,legacy}))]
  .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
 const focusIndex=items.findIndex(item=>item.id===history.focusedEventId),shown=Math.max(visible,focusIndex+1);
 return <div className={styles.body}>
  {items.slice(0,shown).map(item=>item.change?<InlineFinancialHistory key={item.id} changes={[item.change]}/>:item.legacy?<LegacyEntry key={item.id} entry={item.legacy} timeZone={timeZone}/>:null)}
  {shown<items.length&&<button className={styles.more} type="button" onClick={()=>setVisible(shown+5)}><Text text="View earlier edits"/> · {items.length-shown}</button>}
  <EarlierRecords entries={history.earlier} focusedEventId={history.focusedEventId} timeZone={timeZone} inline={!items.length}/>
 </div>;
}

/** One disclosure belongs to the ticket itself; its editor remains independent. */
export function TicketHistoryDisclosure({ticketId,legacyEntries,children,timeZone,inlineOnly=false,additionalDetails}:{ticketId:string;legacyEntries?:TicketLegacyHistoryEntry[];children?:ReactNode;timeZone?:string;inlineOnly?:boolean;additionalDetails?:ReactNode}){
 const history=useTicketInlineHistory(ticketId,legacyEntries),ref=useRef<HTMLDetailsElement>(null),plain=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(history.focusedEventId&&(history.changes.some(change=>change.id===history.focusedEventId)||[...history.legacy,...history.earlier].some(entry=>(entry.eventId??entry.id)===history.focusedEventId))){
   if(ref.current){ref.current.open=true;ref.current.scrollIntoView({block:"nearest"});}
  }
  if(history.record)plain.current?.scrollIntoView({block:"nearest"});
 },[history.focusedEventId,history.changes,history.legacy,history.earlier,history.record]);
 if(inlineOnly)return history.hasChanges?<TicketHistoryContents history={history} timeZone={timeZone}/>:null;
 if(!history.hasChanges&&!additionalDetails)return <div ref={plain}>{children}{history.record&&<InlineFinancialRecord record={history.record}/>} {history.error&&<p className={styles.neutral} role="status"><Text text="Ticket edit history could not load."/> <button type="button" onClick={history.retry}><Text text="Retry"/></button></p>}</div>;
 return <details ref={ref} className={history.hasChanges?styles.edited:undefined} data-edited-ticket={history.hasChanges?ticketId:undefined}>
  <summary className={styles.summary}>{children}<span className={`${styles.label} ${!history.hasChanges?styles.plainLabel:""}`}><span>{history.hasChanges?<><Text text="Edited"/>{history.countKnown&&<> · {history.count}</>}</>:<Text text="Details"/>}</span><svg className={styles.chevron} viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg></span></summary>
  {history.hasChanges&&<TicketHistoryContents history={history} timeZone={timeZone}/>}
  {additionalDetails}
 </details>;
}
