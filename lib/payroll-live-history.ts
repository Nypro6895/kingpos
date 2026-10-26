import "server-only";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import type { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export async function loadPayrollLiveHistory(client: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>, salonId: string, start: string, end: string, staffId?: string) {
  const rows: PayrollLiveChange[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = client.from("payroll_live_change_history").select("id,salon_id,staff_id,staff_snapshot,source_table,source_id,period_start,period_end,before_values,after_values,actor_id,created_at")
      .eq("salon_id", salonId).lte("period_start", end).gte("period_end", start)
      .order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
    if (staffId) query = query.eq("staff_id", staffId);
    const { data, error } = await query.returns<PayrollLiveChange[]>();
    if (error) throw new Error("Change history could not be loaded. Please retry.");
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
