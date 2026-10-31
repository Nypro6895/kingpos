"use client";
import {useEffect,useState} from "react";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {DailyPosTicketCard} from "@/app/pos-tickets/closed-ticket-correction-form";
import {InlineFinancialHistory,InlineFinancialRecord,useFinancialHistoryContext} from "@/app/payroll/inline-financial-history";
import {financialHistoryForObject} from "@/lib/inline-financial-history";
import {financialHistoryText} from "@/lib/financial-change-presentation";
import {ticketDayBounds} from "@/lib/ticket-day-bounds";
import type {PosTicketWithRelations} from "@/types/pos-ticket";
import type {PayrollLiveChange} from "@/types/payroll-live-history";

export function TodayInlineTickets({date,timeZone,open}:{date:string;timeZone:string;open:boolean}){
 const history=useFinancialHistoryContext(),[result,setResult]=useState<{key:string;tickets:PosTicketWithRelations[];error:string}>({key:"",tickets:[],error:""}),[attempt,setAttempt]=useState(0);
 const key=date+":"+timeZone;
 useEffect(()=>{
  if(!open)return;const controller=new AbortController(),args=new URLSearchParams(ticketDayBounds(date,timeZone));
  void fetch('/api/pos/owner/tickets?'+args,{credentials:"same-origin",cache:"no-store",signal:controller.signal}).then(async response=>{
   const data=await response.json();if(!response.ok||!Array.isArray(data.tickets))throw Error();
   if(!controller.signal.aborted)setResult({key,tickets:data.tickets,error:""});
  }).catch(()=>{if(!controller.signal.aborted)setResult({key,tickets:[],error:"Tickets could not be loaded."});});
  return()=>controller.abort();
 },[open,date,timeZone,key,attempt]);
 if(!open)return null;
 if(result.key!==key)return <p role="status" className="py-3 text-xs text-zinc-500"><Text text="Loading tickets…"/></p>;
 if(result.error)return <p role="status" className="py-3 text-xs text-zinc-500"><Text text={result.error}/> <button type="button" className="min-h-11 underline" onClick={()=>setAttempt(attempt+1)}><Text text="Retry"/></button></p>;
 const completed=result.tickets.filter(ticket=>ticket.status==="closed"),current=new Set(completed.map(ticket=>ticket.id)),missing=new Map<string,PayrollLiveChange[]>();
 const dailyNumbers=new Map([...result.tickets].sort((a,b)=>new Date(a.opened_at).getTime()-new Date(b.opened_at).getTime()||a.ticket_sequence-b.ticket_sequence).map((ticket,index)=>[ticket.id,index+1]));
 for(const change of [...financialHistoryForObject(history.changes,{sourceKinds:["ticket"]}),...(history.record?[history.record]:[])]){
  const id=change.ticket_id??change.source_id;if(change.source_table!=="ticket"||current.has(id))continue;
  missing.set(id,[...(missing.get(id)??[]),change]);
 }
 return <div className="col-span-full min-w-0 border-t border-zinc-200" data-today-ticket-list>
  {!completed.length&&!missing.size&&<p className="py-3 text-xs text-zinc-500"><Text text="No completed tickets recorded for this date."/></p>}
  {completed.map(ticket=><DailyPosTicketCard key={ticket.id} ticket={ticket} dailyNumber={dailyNumbers.get(ticket.id)??ticket.ticket_sequence} businessDateCompactLabel={date} canEdit={false} canApplyFinancialCorrection={false} isBusinessDateLocked services={[]} staff={[]} returnTo={'/staff/today?date='+date} timeZone={timeZone}/>)}
  {[...missing].map(([id,rows])=>{const record=rows.find(row=>row===history.record),changes=rows.filter(row=>row!==record),last=rows[0];return <details className={`border-b border-zinc-200 ${changes.length?'bg-orange-50/60':''}`} key={id} data-ticket-context={id}>
   <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm"><strong>{financialHistoryText(last.ticket_number??last.after_values.ticket_number,"Ticket")}</strong> · {last.period_start}{changes.length>0&&<span className="ml-2 text-xs text-orange-800"><Text text="Edited"/> · {changes.length}</span>}</summary>
   <div className="bg-white px-3"><p className="py-2 text-xs text-zinc-500"><Text text="Earlier ticket · Reference only"/></p><InlineFinancialHistory changes={changes}/>{record&&<InlineFinancialRecord record={record}/>}</div>
  </details>;})}
 </div>;
}
