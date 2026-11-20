import "server-only";
import { withDashboardDeadline } from "./dashboard-deadline";
import type { CurrentBusinessContext } from "./current-context";
import { hasPermission } from "./permissions";
import { createAuthenticatedSupabaseServerClient } from "./supabase/server";
import { zonedDateTimeToUtcIso } from "./bookings";
import { buildDayStatistics, type StatisticsTicket } from "./today-statistics";

export async function loadTodayStatistics(context: CurrentBusinessContext, date: string, timeZone: string, reads = { visits: true, tickets: true }) {
  const salonId = context.currentSalon?.id;
  if (!salonId || !context.user) throw new Error("Salon access is required.");
  const [permissions, supabase] = await withDashboardDeadline(Promise.all([
    Promise.all(["booking.view", "reports.view", "tickets.view", "tickets.manage", "payroll.view", "payroll.manage"].map(p => hasPermission(p, context))),
    createAuthenticatedSupabaseServerClient(),
  ]), 1800);
  const [canViewVisits, ...financialPermissions] = permissions;
  const canViewFinancials = financialPermissions.some(Boolean);
  if (!supabase) throw new Error("Statistics could not be loaded.");
  const nextDate = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0,10);
  const from = zonedDateTimeToUtcIso({ date, time: "00:00", timeZone });
  const to = zonedDateTimeToUtcIso({ date: nextDate, time: "00:00", timeZone });
  if (!from || !to) throw new Error("Invalid statistics date.");
  const now = new Date().toISOString();
  const errors: string[] = [];
  // Page every read: no queue limit or PostgREST row cap may turn a busy day into a partial total.
  async function visits() {
    if (!canViewVisits || !reads.visits) return null;
    const rows: { id: string; checked_in_at: string; status: string }[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase!.from("customer_visits").select("id,checked_in_at,status").eq("salon_id", salonId!).gte("checked_in_at", from).lt("checked_in_at", to).lte("checked_in_at", now).order("checked_in_at").order("id").range(offset, offset + 499);
      if (error) throw new Error("Check-ins could not be loaded.");
      rows.push(...data ?? []); if (!data || data.length < 500) return rows;
    }
  }
  async function tickets() {
    if (!canViewFinancials || !reads.tickets) return null;
    const rows: StatisticsTicket[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase!.from("pos_tickets").select("id,closed_at,status,discount_type,discount_value,tax_rate,tip_type,tip_value,payments:pos_payments(payment_method,amount),ticket_items:pos_ticket_items(quantity,line_total,is_removed,service_name_snapshot,service_category_snapshot,service:services(name,category),turn_parts:pos_ticket_item_turn_parts(amount))").eq("salon_id", salonId!).eq("status", "closed").gte("closed_at", from).lt("closed_at", to).lte("closed_at", now).order("closed_at").order("id").range(offset, offset + 499).returns<StatisticsTicket[]>();
      if (error) throw new Error("Service statistics could not be loaded.");
      rows.push(...data ?? []); if (!data || data.length < 500) return rows;
    }
  }
  async function giftFlow() {
    if (!reads.tickets || !financialPermissions[0]) return null;
    const { data, error } = await supabase!.rpc("gift_card_day_cashflow", { p_salon: salonId, p_date: date, p_before: now });
    if (error || !data || ["counterSales", "counterSalesCount", "redeemed", "redeemedCount"].some(key => !Number.isSafeInteger(data[key]) || data[key] < 0)) throw new Error("Gift card statistics could not be loaded.");
    return data as { counterSales: number; counterSalesCount: number; redeemed: number; redeemedCount: number };
  }
  // Bound each complete source independently. Never expose an incomplete page
  // as a total, or erase known ticket data because gift cashflow was slower.
  const settle = <T>(read: Promise<T>, message: string) => withDashboardDeadline(read, 1800).catch(() => {
    errors.push(message);
    return null;
  });
  const [visitRows, ticketRows, giftRows] = await Promise.all([
    settle(visits(), "Check-ins could not be loaded."),
    settle(tickets(), "Service statistics could not be loaded."),
    settle(giftFlow(), "Gift card statistics could not be loaded."),
  ]);
  return buildDayStatistics({ date, timeZone, now, visits: visitRows, tickets: ticketRows, giftFlow: giftRows, errors });
}
