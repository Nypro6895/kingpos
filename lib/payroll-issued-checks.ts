import type { PayrollIssuedChecks } from "@/types/payroll-issued-checks";
import type { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

/** Read-only references: Check Writer remains the durable source of issued numbers. */
export async function loadPayrollIssuedChecks(client: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>, salonId: string, start: string, end: string): Promise<PayrollIssuedChecks> {
  try {
    const { data, error } = await client.rpc("payroll_issued_check_references", { p_salon: salonId, p_start: start, p_end: end }).abortSignal(AbortSignal.timeout(8000));
    if (error || !Array.isArray(data)) throw Error("Check references unavailable");
    return { status: "available", checks: data.map(row => ({ id: String(row.id), staffId: String(row.staff_id), number: String(row.number), periodStart: String(row.period_start), periodEnd: String(row.period_end) })) };
  } catch { return { status: "unavailable", checks: [] }; }
}
