import "server-only";
import { isOwnerMembership, type CurrentBusinessContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { isDateInputValue } from "@/lib/daily-pos-report";
import { resolvePayrollPeriod, SALON_PAYROLL_SETTING_SELECT } from "@/lib/payroll";
import { payrollRailChoices } from "@/lib/payroll-period-rail";
import { staffPeriodAt } from "@/lib/staff-payroll-period";
import type { SalonPayrollSetting } from "@/types/payroll";
import type { ReportExpensePeriod } from "@/lib/report-expense-period";

/** Schedule metadata only. Never calculates payroll or reads staff income/history. */
export async function loadReportExpensePeriod(context: CurrentBusinessContext, timezone: string, requestedStart?: string | string[]): Promise<ReportExpensePeriod | null> {
  if (!context.user || !context.currentSalon || !isOwnerMembership(context.currentMembership)) return null;
  const db = await createAuthenticatedSupabaseServerClient();
  if (!db) throw new Error("Payroll schedule is unavailable.");
  const { data, error } = await db.from("salon_payroll_settings").select(SALON_PAYROLL_SETTING_SELECT).eq("salon_id", context.currentSalon.id).maybeSingle<SalonPayrollSetting>();
  if (error) throw new Error("Payroll schedule is unavailable.");
  const setting: SalonPayrollSetting = data ?? { id: "", salon_id: context.currentSalon.id, cycle_type: "monthly", biweekly_anchor_date: null, created_at: "", updated_at: "" };
  if (setting.salon_id !== context.currentSalon.id) throw new Error("Selected salon changed. Reopen this page.");
  const needsAnchor = setting.cycle_type === "biweekly" && !setting.biweekly_anchor_date;
  const raw = Array.isArray(requestedStart) ? requestedStart[0] : requestedStart;
  // A URL can select a configured period, never invent a custom financial range.
  const selected = !needsAnchor && raw && isDateInputValue(raw) && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw ? staffPeriodAt(setting, raw) : null;
  const period = resolvePayrollPeriod({
    salonSetting: setting, timezone,
    ...(selected ? { payPeriodStart: selected.startDate, month: selected.startDate.slice(0, 7), preset: selected.preset, segment: selected.preset === "semi_monthly_second" ? "second" : "first" } : {}),
  });
  const choices = needsAnchor ? { months: [], periods: [] } : payrollRailChoices(period, setting);
  return { period, months: setting.cycle_type === "monthly" ? choices.months : [], periods: choices.periods, needsAnchor };
}
