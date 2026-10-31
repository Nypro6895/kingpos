import "server-only";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import {getSalonBusinessTimezone} from "@/lib/salon-business-clock";
import {hasMeaningfulFinancialInputChange,isFinancialInputCreation} from "@/lib/financial-change-presentation";
import type {createAuthenticatedSupabaseServerClient} from "@/lib/supabase/server";
type Client=NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
type Event={id?:string;event_id?:string;event_action?:"created"|"updated"|"draft";salon_id:string;staff_id?:string;staff_name?:string;kind:string;business_date:string;source_id?:string;before_values:Record<string,unknown>;after_values:Record<string,unknown>;note:string;actor_name:string;created_at:string};
type Metadata={event_id:string;event_action:"created"|"updated"|"draft";ticket_id?:string;ticket_number?:string;before_context?:Record<string,unknown>|null;after_context?:Record<string,unknown>|null};
export type FinancialHistorySurface="today"|"reports"|"payroll";
export async function loadFinancialInputHistory(client:Client,salonId:string,start:string,end:string,options:{staffId?:string;surface?:FinancialHistorySurface;createdFrom?:string;createdTo?:string;eventId?:string;includeCreation?:boolean}={}){
 const staff=options.staffId,surface=options.surface??"payroll";
 const kinds=staff?surface==="today"?["ticket"]:["staff_day","payroll_settings"]:surface==="today"?["ticket"]:["ticket","staff_day","daily_report","payroll_settings"];
 const rows:PayrollLiveChange[]=[];
 for(let offset=0;;offset+=500){
  let query=client.from(staff?"financial_input_event_staff":"financial_input_events").select("*").eq("salon_id",salonId).in("kind",kinds).order("created_at",{ascending:false}).order(staff?"event_id":"id").range(offset,offset+499);
  if(staff)query=query.eq("staff_id",staff);
  if(options.eventId)query=query.eq(staff?"event_id":"id",options.eventId);
  else{
   if(options.createdFrom)query=query.gte("created_at",options.createdFrom);else query=query.gte("business_date",start).lte("business_date",end);
   if(options.createdTo)query=query.lt("created_at",options.createdTo);
  }
  const {data,error}=await query.returns<Event[]>();
  if(error)throw new Error("Input history could not be loaded. Please retry.");
  const projections:Event[]=[],metadata=new Map<string,Metadata>();
  if(data?.some(row=>row.kind==="ticket")){
   // Classify old draft/submitted events from immutable snapshots. Staff context
   // contains only their own work, never current settings or coworker money.
   const result=await client.rpc("get_financial_input_event_metadata",{p_event_ids:data.filter(row=>row.kind==="ticket").map(row=>row.id??row.event_id!)});
   if(result.error||!Array.isArray(result.data))throw new Error("Ticket history context could not be loaded.");
   for(const item of result.data as Metadata[])metadata.set(item.event_id,item);
   if(data.some(row=>row.kind==="ticket"&&!metadata.has(row.id??row.event_id!)))throw new Error("Ticket history context is incomplete.");
  }
  if(!staff&&data?.length){
   for(let projectionOffset=0;;projectionOffset+=1000){
    const related=await client.from("financial_input_event_staff").select("*").eq("salon_id",salonId).in("event_id",data.map(row=>row.id!)).order("event_id").order("staff_id").range(projectionOffset,projectionOffset+999).returns<Event[]>();
    if(related.error)throw new Error("Staff input history could not be loaded.");
    projections.push(...related.data??[]);if(!related.data||related.data.length<1000)break;
   }
  }
  for(const row of data??[]){
   const meta=metadata.get(row.event_id??row.id!);
   rows.push({id:row.id??row.event_id!,salon_id:row.salon_id,staff_id:row.staff_id??null,staff_snapshot:row.staff_id?{id:row.staff_id,displayName:row.staff_name??null}:null,
    event_action:meta?.event_action??row.event_action??(row.kind==="ticket"&&Object.keys(row.before_values??{}).length===0?"created":"updated"),ticket_number:meta?.ticket_number,ticket_id:row.kind==="ticket"?(meta?.ticket_id??row.source_id):undefined,
    staff_projections:projections.filter(item=>item.event_id===row.id).map(item=>({staff_id:item.staff_id!,staff_name:item.staff_name??"Staff",before_values:item.before_values,after_values:item.after_values})),
    source_table:row.kind,source_id:(row.kind==="ticket"?meta?.ticket_id:undefined)??row.source_id??row.event_id??row.id!,period_start:row.business_date,period_end:row.business_date,
    before_values:{...row.before_values,...(staff?meta?.before_context:{})},after_values:{...row.after_values,...(staff?meta?.after_context:{}),...(meta?.ticket_number?{ticket_number:meta.ticket_number}:{})},
    actor_id:null,actor_name:row.actor_name,note:row.note,created_at:row.created_at});
  }
  if(!data||data.length<500)break;
 }
 if(surface!=="today"&&(!options.eventId||!rows.length)){
  const cut=await client.from("financial_input_history_cutover").select("cutover_at").single();
  if(cut.error)throw new Error("Earlier input history could not be loaded.");
  for(let offset=0;;offset+=1000){
   let query=client.from("payroll_live_change_history").select("*").eq("salon_id",salonId)
    .or(`created_at.lt.${cut.data.cutover_at},source_table.in.(payroll_period_staff_inputs,salon_payroll_settings)`)
    .order("created_at",{ascending:false}).order("id").range(offset,offset+999);
   if(options.eventId)query=query.eq("id",options.eventId);else query=query.lte("period_start",end).gte("period_end",start);
   if(staff)query=query.eq("staff_id",staff).neq("source_table","pos_ticket_staff_earnings").neq("source_table","pos_daily_closings");
   const {data,error}=await query.returns<PayrollLiveChange[]>();
   if(error)throw new Error("Earlier input history could not be loaded. Please retry.");
   rows.push(...data??[]);if(!data||data.length<1000)break;
  }
 }
 const timeZone=await getSalonBusinessTimezone(salonId);
 return rows.filter(row=>hasMeaningfulFinancialInputChange(row)||(options.includeCreation&&options.eventId===row.id&&isFinancialInputCreation(row)))
  .map(row=>({...row,business_timezone:timeZone})).sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
}
