import { staffPeriodAt, staffPeriodHistory, staffPeriodKey } from "@/lib/staff-payroll-period";
import type { PayrollPeriod, SalonPayrollSetting } from "@/types/payroll";

export type TaxPayrollRun = { id: string; period_start: string; period_end: string; status: string; version: number; cycle_type: PayrollPeriod["cycleType"] };
export type TaxPeriodOption = { value: string; startDate: string; endDate: string; historical: boolean };
export function taxPayrollScheduleLabel(cycle: string | null | undefined) {
  return cycle === "semi_monthly" ? "Twice monthly · 1–15 & 16–month end" : cycle === "biweekly" ? "Every two weeks" : "Monthly · 1–month end";
}
export function taxCompanyPeriods(setting: SalonPayrollSetting | null, runs: TaxPayrollRun[], today: string, requestedPeriod?: string, requestedRun?: string) {
  // Both halves remain selectable even before the second half of the current month starts.
  const calendarEnd = setting?.cycle_type === "semi_monthly" ? staffPeriodAt(null, today).endDate : today;
  const scheduled = staffPeriodHistory(setting, calendarEnd, setting?.cycle_type === "monthly" || !setting ? 12 : 26);
  const options = new Map<string, TaxPeriodOption>(scheduled.map(period => [staffPeriodKey(period), { value: staffPeriodKey(period), startDate: period.startDate, endDate: period.endDate, historical: false }]));
  for (const run of runs) {
    const value = `${run.period_start}:${run.period_end}`;
    if (!options.has(value)) {
      const currentSchedule = staffPeriodAt(setting, run.period_start);
      options.set(value, { value, startDate: run.period_start, endDate: run.period_end, historical: currentSchedule.startDate !== run.period_start || currentSchedule.endDate !== run.period_end });
    }
  }
  const sortedRuns = [...runs].sort((a, b) => b.period_start.localeCompare(a.period_start) || b.period_end.localeCompare(a.period_end) || b.version - a.version);
  const explicitRun = requestedRun ? runs.find(run => run.id === requestedRun) : undefined;
  if (requestedRun && !explicitRun) throw new Error("This payroll statement is unavailable.");
  const latestScheduled = sortedRuns.find(run => !options.get(`${run.period_start}:${run.period_end}`)?.historical);
  const selected = requestedPeriod ?? (explicitRun ? `${explicitRun.period_start}:${explicitRun.period_end}` : latestScheduled ? `${latestScheduled.period_start}:${latestScheduled.period_end}` : staffPeriodKey(staffPeriodAt(setting, today)));
  const period = options.get(selected);
  if (!period) throw new Error("Choose a payroll period from this salon’s schedule.");
  const run = !requestedPeriod && explicitRun ? explicitRun : sortedRuns.find(row => `${row.period_start}:${row.period_end}` === selected) ?? null;
  return { period, run, periodOptions: [...options.values()].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate)) };
}

export function taxSalonAddress(salon: { address_line1?: string | null; address_line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null }) {
  return [salon.address_line1, salon.address_line2, [salon.city, salon.state].filter(Boolean).join(", "), salon.postal_code].filter(Boolean).join(" · ");
}
