import type {PayrollLiveChange} from "@/types/payroll-live-history";
import {financialHistoryForObject} from "@/lib/inline-financial-history";

export type StaffTicketHistoryContext={ticketId:string;businessDate:string;ticketNumber:string;changes:PayrollLiveChange[];record?:PayrollLiveChange;values:Record<string,unknown>};

/** Context rows explain captured own work; callers never add them to totals. */
export function staffTicketHistoryContexts(currentTicketIds:readonly string[],businessDate:string,staffId:string,changes:readonly PayrollLiveChange[],record?:PayrollLiveChange){
 const current=new Set(currentTicketIds),groups=new Map<string,StaffTicketHistoryContext>();
 for(const change of [...financialHistoryForObject(changes,{staffId,sourceKinds:["ticket"]}),...(record?[record]:[])].sort((a,b)=>a.created_at.localeCompare(b.created_at))){
  if(change.source_table!=="ticket"||change.staff_id!==staffId||!change.ticket_id)continue;
  if(change.period_start===businessDate&&current.has(change.ticket_id))continue;
  const key=change.ticket_id+":"+change.period_start,values=change.after_values??{};
  const group=groups.get(key)??{ticketId:change.ticket_id,businessDate:change.period_start,ticketNumber:change.ticket_number??String(values.ticket_number??change.before_values?.ticket_number??"Ticket"),changes:[],values};
  if(change===record)group.record=record;else if(!group.changes.some(row=>row.id===change.id))group.changes.push(change);
  group.values=values;
  groups.set(key,group);
 }
 return [...groups.values()].sort((a,b)=>b.businessDate.localeCompare(a.businessDate)||a.ticketNumber.localeCompare(b.ticketNumber));
}
