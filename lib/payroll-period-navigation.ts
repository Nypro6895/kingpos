import type { PayrollPeriod } from "@/types/payroll";

const iso = (date: Date) => date.toISOString().slice(0, 10);
export function adjacentPayrollPeriod(period: PayrollPeriod, direction: -1 | 1): PayrollPeriod {
  const anchor = new Date(`${direction < 0 ? period.startDate : period.endDate}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + direction);
  const isCalendarMonth = period.startDate.endsWith("-01") && period.endDate === iso(new Date(Date.UTC(Number(period.startDate.slice(0,4)),Number(period.startDate.slice(5,7)),0,12)));
  if (period.cycleType === "monthly" || period.cycleType === "custom" && isCalendarMonth) {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12));
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 12));
    return { ...period, startDate: iso(start), endDate: iso(end), preset: period.cycleType === "custom" ? "custom" : "current_month" };
  }
  if (period.cycleType === "semi_monthly") {
    const first = anchor.getUTCDate() <= 15;
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), first ? 1 : 16, 12));
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + (first ? 0 : 1), first ? 15 : 0, 12));
    return { ...period, startDate: iso(start), endDate: iso(end), preset: first ? "semi_monthly_first" : "semi_monthly_second" };
  }
  const days = Math.round((Date.parse(period.endDate) - Date.parse(period.startDate)) / 86400000) + 1;
  const start = new Date(`${period.startDate}T12:00:00Z`), end = new Date(`${period.endDate}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() + direction * days); end.setUTCDate(end.getUTCDate() + direction * days);
  return { ...period, startDate: iso(start), endDate: iso(end), preset: period.cycleType === "biweekly" ? "current_pay_period" : "custom" };
}
