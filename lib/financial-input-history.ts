import "server-only";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import {getSalonBusinessTimezone} from "@/lib/salon-business-clock";
import type { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
type Client = NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
type Event = {id?:string;event_id?:string;salon_id:string;staff_id?:string;staff_name?:string;kind:string;business_date:string;source_id?:string;before_values:Record<string,unknown>;after_values:Record<string,unknown>;note:string;actor_name:string;created_at:string};
export type FinancialHistorySurface = "today" | "reports" | "payroll";
export async function loadFinancialInputHistory(client:Client,salonId:string,start:string,end:string,options:{staffId?:string;surface?:FinancialHistorySurface;createdFrom?:string;createdTo?:string}={}) {
 const staff=options.staffId,surface=options.surface??"payroll";
 const kinds=staff?surface==="today"?["ticket"]:["staff_day","payroll_settings"]:surface==="today"?["ticket"]:["ticket","staff_day","daily_report","payroll_settings"];
 const rows:PayrollLiveChange[]=[];
 for(let offset=0;;offset+=500){
  let q=client.from(staff?"financial_input_event_staff":"financial_input_events").select("*").eq("salon_id",salonId).in("kind",kinds).order("created_at",{ascending:false}).order(staff?"event_id":"id").range(offset,offset+499);
  if(staff)q=q.eq("staff_id",staff);
  if(options.createdFrom)q=q.gte("created_at",options.createdFrom);else q=q.gte("business_date",start).lte("business_date",end);
  if(options.createdTo)q=q.lt("created_at",options.createdTo);
  const {data,error}=await q.returns<Event[]>();if(error)throw new Error("Input history could not be loaded. Please retry.");
  const projections:Array<Event>=[];
  if(!staff&&data?.length){
   for(let projectionOffset=0;;projectionOffset+=1000){
    const related=await client.from("financial_input_event_staff").select("*").eq("salon_id",salonId).in("event_id",data.map(row=>row.id!)).order("event_id").order("staff_id").range(projectionOffset,projectionOffset+999).returns<Event[]>();
    if(related.error)throw new Error("Staff input history could not be loaded.");
    projections.push(...related.data??[]);if(!related.data||related.data.length<1000)break;
   }
  }
  for(const row of data??[])rows.push({id:row.id??row.event_id!,salon_id:row.salon_id,staff_id:row.staff_id??null,staff_snapshot:row.staff_id?{id:row.staff_id,displayName:row.staff_name??null}:null,
   staff_projections:projections.filter(p=>p.event_id===row.id).map(p=>({staff_id:p.staff_id!,staff_name:p.staff_name??"Staff",before_values:p.before_values,after_values:p.after_values})),
   source_table:row.kind,source_id:row.source_id??row.event_id??row.id!,period_start:row.business_date,period_end:row.business_date,before_values:row.before_values,after_values:row.after_values,actor_id:null,actor_name:row.actor_name,note:row.note,created_at:row.created_at});
  if(!data||data.length<500)break;
 }
 if(surface!=="today"){
  const cut=await client.from("financial_input_history_cutover").select("cutover_at").single();if(cut.error)throw new Error("Earlier input history could not be loaded.");
  for(let offset=0;;offset+=1000){
   let q=client.from("payroll_live_change_history").select("*").eq("salon_id",salonId).lte("period_start",end).gte("period_end",start)
    .or(`created_at.lt.${cut.data.cutover_at},source_table.in.(payroll_period_staff_inputs,salon_payroll_settings)`)
    .order("created_at",{ascending:false}).order("id").range(offset,offset+999);
   if(staff)q=q.eq("staff_id",staff).neq("source_table","pos_ticket_staff_earnings").neq("source_table","pos_daily_closings");
   const {data,error}=await q.returns<PayrollLiveChange[]>();if(error)throw new Error("Earlier input history could not be loaded. Please retry.");
   rows.push(...data??[]);if(!data||data.length<1000)break;
  }
 }
 const timeZone=await getSalonBusinessTimezone(salonId);
 return rows.map(row=>({...row,business_timezone:timeZone})).sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
}
