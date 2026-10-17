export type PayrollSchedule = { cycle_type: "monthly" | "semi_monthly" | "biweekly"; biweekly_anchor_date: string | null };
export type ClosedPayrollPeriod = { startDate: string; endDate: string; cycleType: PayrollSchedule["cycle_type"] };
const DAY = 86_400_000;
function date(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid payroll date.");
  const result = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0,10) !== value) throw new Error("Invalid payroll date.");
  return result;
}
function iso(value: Date): string { return value.toISOString().slice(0,10); }
export function addPayrollDays(value: string, amount: number): string { return iso(new Date(date(value).getTime() + amount * DAY)); }
export function payrollLocalDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function payrollPeriodContaining(day: string, schedule: PayrollSchedule): ClosedPayrollPeriod {
  const current = date(day), year = current.getUTCFullYear(), month = current.getUTCMonth();
  if (schedule.cycle_type === "biweekly") {
    if (!schedule.biweekly_anchor_date) throw new Error("Set the biweekly anchor before automatic payroll closing.");
    const offset = Math.floor((current.getTime() - date(schedule.biweekly_anchor_date).getTime()) / DAY / 14) * 14;
    const startDate = addPayrollDays(schedule.biweekly_anchor_date, offset);
    return { startDate, endDate:addPayrollDays(startDate,13), cycleType:"biweekly" };
  }
  const second = schedule.cycle_type === "semi_monthly" && current.getUTCDate() > 15;
  return {
    startDate:iso(new Date(Date.UTC(year,month,second ? 16 : 1))),
    endDate:iso(schedule.cycle_type === "semi_monthly" && !second ? new Date(Date.UTC(year,month,15)) : new Date(Date.UTC(year,month+1,0))),
    cycleType:schedule.cycle_type,
  };
}
export function isPayrollPeriodClosed(period: ClosedPayrollPeriod, now: Date, timezone: string): boolean {
  date(period.startDate); date(period.endDate);
  return period.endDate < payrollLocalDate(now,timezone);
}
