import "server-only";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { marketPluginContext } from "@/lib/market-plugins";
import { getCurrentBusinessContext } from "@/lib/current-context";
import type { PayrollStaffLineWithDailyTotals, SalonPayrollSetting } from "@/types/payroll";
import type { TaxCompanyNote, TaxCompanySalon } from "@/types/tax-company";
import type { Location } from "@/types/location";
import { taxCompanyPeriods, type TaxPayrollRun } from "@/lib/tax-company-periods";
import { isTaxCompanyReportableLine } from "@/lib/payroll";

export async function taxCompanyClient() {
  const context = await getCurrentBusinessContext();
  if (!context.user) throw new Error("Sign in to your personal Reylumi account first.");
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Please sign in again.");
  return { client, context };
}
export async function taxCompanySettings() {
  const { client, salonId } = await marketPluginContext();
  const { data, error } = await client.rpc("tax_company_owner_details", { p_salon: salonId });
  if (error) throw new Error("Tax Company requires the latest database update.");
  return data as { active: boolean; enabled: boolean; salon_name: string; login_id: string | null; connections: { user_id: string; display_name: string | null; email: string | null; phone: string | null; account_active: boolean; connected_at: string }[] };
}
export async function taxCompanyInstalled() {
  return (await taxCompanySettings()).active;
}
export async function taxCompanySalons() {
  const { client } = await taxCompanyClient();
  const { data, error } = await client.rpc("tax_company_salons");
  if (error) throw new Error("Tax Company could not load. Check the database update.");
  return data as TaxCompanySalon[];
}
export async function taxCompanyReport(salonId: string, runId?: string, requestedPeriod?: string) {
  const { client } = await taxCompanyClient();
  const { data: scope, error: scopeError } = await client.rpc("tax_company_scope", { p_salon: salonId });
  if (scopeError || !scope) throw new Error("This salon connection is inactive. Connect again with its current ID and password.");
  const { data: runs, error } = await client.from("payroll_runs").select("id,period_start,period_end,status,version,cycle_type").eq("salon_id", salonId).in("status", ["printed", "paid"]).order("period_start", { ascending: false }).order("version", { ascending: false }).limit(500).returns<TaxPayrollRun[]>();
  if (error) throw new Error("Payroll statements could not load.");
  const setting = scope.payroll_setting as SalonPayrollSetting | null;
  const selection = taxCompanyPeriods(setting, runs ?? [], new Date().toISOString().slice(0, 10), requestedPeriod, runId);
  const { run } = selection;
  const report = { ...selection, salon: scope.salon as Location, payrollSetting: setting, note: scope.note as TaxCompanyNote };
  if (!run) return { ...report, lines: [] as PayrollStaffLineWithDailyTotals[] };
  const [{ data: lines, error: linesError }, { data: paystubs, error: paystubsError }] = await Promise.all([
    client.from("payroll_staff_lines").select("*").eq("salon_id", salonId).eq("payroll_run_id", run.id).order("staff_display_name_snapshot"),
    client.from("payroll_paystubs").select("*").eq("salon_id", salonId).eq("payroll_run_id", run.id),
  ]);
  if (linesError || paystubsError) throw new Error("Tax report could not load.");
  const signed = await Promise.all((paystubs ?? []).map(async stub => {
    const { data } = await client.storage.from("payroll-paystubs").createSignedUrl(stub.file_url_or_path, 60);
    return { ...stub, view_url: data?.signedUrl ?? null };
  }));
  const reportLines = (lines ?? []).map(line => ({ ...line, paystub: signed.find(stub => stub.staff_id === line.staff_id) ?? null, daily_totals: [] })) as PayrollStaffLineWithDailyTotals[];
  return { ...report, lines: reportLines.filter(isTaxCompanyReportableLine) };
}
