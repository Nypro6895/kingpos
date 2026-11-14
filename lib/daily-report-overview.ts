import "server-only";
import { loadTicketFinancialSourceMap } from "@/lib/pos-ticket-financial-sources";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { DailyPosReport } from "@/types/pos-daily-closing";
import { requirePermission, hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getUtcBoundsForLocalDate } from "@/lib/daily-pos-report";
import { getContextBusinessTimezone } from "@/lib/salon-business-clock";
import { buildDailyReportOverview, type OverviewTicket, type OverviewVisit, type OverviewWorkday } from "./daily-report-overview-model";

export async function getDailyReportOverview(report: DailyPosReport, context: CurrentBusinessContext) {
  await requirePermission("reports.view", context);
  if (!context.currentSalon) throw new Error("Choose a salon.");
  const db = await createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true });
  if (!db) throw new Error("Reports are temporarily unavailable.");
  const salon = context.currentSalon.id, date = report.reportDate;
  const timeZone = await getContextBusinessTimezone(context), bounds = getUtcBoundsForLocalDate(date, timeZone);
  const ticketSelect = "id,ticket_number,customer_id,opened_at,status,discount_type,discount_value,tax_rate,tip_type,tip_value,customer:customers(name),ticket_items:pos_ticket_items(id,service_name_snapshot,assigned_staff_id,line_total,is_removed,assigned_staff:staff!pos_ticket_items_assigned_staff_id_fkey(id,display_name),turn_parts:pos_ticket_item_turn_parts(staff_id,amount,staff:staff(id,display_name)))";
  // Each page has a deterministic tie-breaker. Never compute a day's count from a capped queue.
  async function readVisits() {
    const rows: OverviewVisit[] = [];
    for (let offset=0;;offset+=500) {
      const {data,error}=await db!.from("customer_visits").select("id,customer_id,checked_in_at,ticket_id,status,customer:customers(name),requested:customer_visit_services(sort_order,service:services(name))").eq("salon_id",salon).gte("checked_in_at",bounds.openedFrom).lte("checked_in_at",bounds.openedTo).order("checked_in_at").order("id").range(offset,offset+499).returns<OverviewVisit[]>();
      if(error) throw new Error("Customer check-ins could not load.");
      rows.push(...data??[]);if(!data||data.length<500)return rows;
    }
  }
  async function readTickets() {
    const rows: OverviewTicket[] = [];
    for(let offset=0;;offset+=500){
      const {data,error}=await db!.from("pos_tickets").select(ticketSelect).eq("salon_id",salon).gte("opened_at",bounds.openedFrom).lte("opened_at",bounds.openedTo).order("opened_at").order("id").range(offset,offset+499).returns<OverviewTicket[]>();
      if(error)throw new Error("Daily tickets could not load.");rows.push(...data??[]);if(!data||data.length<500)return rows;
    }
  }
  const canReadTickets=await hasPermission("tickets.view",context);
  const [visits,tickets,workdays]=await Promise.all([
    readVisits(), canReadTickets?readTickets():Promise.resolve([] as OverviewTicket[]),
    db.from("staff_workdays").select("staff_id,check_in_at,check_in_sequence,staff:staff(display_name)").eq("salon_id",salon).eq("work_date",date).order("staff_id").returns<OverviewWorkday[]>(),
  ]);
  if(workdays.error)throw new Error("Staff check-ins could not load.");
  // Include exact linked tickets even when check-in and ticket dates differ.
  const known=new Set(tickets.map(t=>t.id));const missing=[...new Set(visits.map(v=>v.ticket_id).filter((id):id is string=>!!id&&!known.has(id)))];
  if(canReadTickets)for(let i=0;i<missing.length;i+=100){const {data,error}=await db.from("pos_tickets").select(ticketSelect).eq("salon_id",salon).in("id",missing.slice(i,i+100)).returns<OverviewTicket[]>();if(error)throw new Error("Linked tickets could not load.");tickets.push(...data??[]);}
  const financialSources=await loadTicketFinancialSourceMap(db,salon,tickets.map(ticket=>ticket.id));
  const result=buildDailyReportOverview({date,timeZone,visits,tickets:tickets.map(ticket=>({...ticket,financial_sources:financialSources[ticket.id]})),workdays:workdays.data??[],report,notes:canReadTickets?[]:["Ticket details require ticket access."]});
  // Summary follows the same ticket-open business date as canonical POS/Payroll.
  result.submittedCount=tickets.filter(t=>t.status==="closed"&&t.opened_at>=bounds.openedFrom&&t.opened_at<=bounds.openedTo).length;
  return result;
}
