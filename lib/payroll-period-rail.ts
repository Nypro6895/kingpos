import type { PayrollPeriod, SalonPayrollSetting } from "@/types/payroll";
import { staffPeriodAt, shiftStaffDate } from "@/lib/staff-payroll-period";

export function payrollPeriodHref(period: PayrollPeriod, tab: string) {
  const params = new URLSearchParams({ tab, preset: period.preset });
  if (period.preset === "custom") {
    params.set("start", period.startDate); params.set("end", period.endDate);
  } else if (period.cycleType === "biweekly") params.set("payPeriodStart", period.startDate);
  else {
    params.set("month", period.startDate.slice(0, 7));
    if (period.cycleType === "semi_monthly") params.set("segment", period.preset === "semi_monthly_second" ? "second" : "first");
  }
  return `/payroll?${params}`;
}

export type PayrollRailChoice = { period: PayrollPeriod; title: string; subtitle: string };
const format = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));

/** Presentation options only. Canonical schedule resolution remains staffPeriodAt. */
export function payrollRailChoices(selected: PayrollPeriod, setting: SalonPayrollSetting) {
  const center = new Date(`${selected.startDate}T12:00:00Z`);
  const months: PayrollRailChoice[] = [];
  for (let offset = -12; offset <= 12; offset++) {
    const year = center.getUTCFullYear(), month = center.getUTCMonth() + offset;
    const startDate = new Date(Date.UTC(year, month, 1, 12)).toISOString().slice(0, 10);
    const endDate = new Date(Date.UTC(year, month + 1, 0, 12)).toISOString().slice(0, 10);
    months.push({ period: { startDate, endDate, cycleType: setting.cycle_type === "monthly" ? "monthly" : "custom", preset: setting.cycle_type === "monthly" ? "current_month" : "custom", label: format(startDate, { month: "long", year: "numeric" }) }, title: format(startDate, { month: "short" }), subtitle: startDate.slice(0, 4) });
  }
  const periods: PayrollRailChoice[] = [];
  if (setting.cycle_type !== "monthly" && (setting.cycle_type !== "biweekly" || setting.biweekly_anchor_date)) {
    const current = staffPeriodAt(setting, selected.startDate);
    let cursor = current;
    for (let i = 0; i < 12; i++) cursor = staffPeriodAt(setting, shiftStaffDate(cursor.startDate, -1));
    for (let i = 0; i < 25; i++) {
      const period = cursor;
      periods.push({ period, title: `${format(period.startDate, { month: "short", day: "numeric" })} – ${format(period.endDate, period.startDate.slice(0, 7) === period.endDate.slice(0, 7) ? { day: "numeric" } : { month: "short", day: "numeric" })}`, subtitle: period.startDate.slice(0, 4) });
      cursor = staffPeriodAt(setting, shiftStaffDate(cursor.endDate, 1));
    }
  }
  return { months, periods };
}
