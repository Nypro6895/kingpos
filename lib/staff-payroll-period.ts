import type { PayrollPeriod, PayrollRun, SalonPayrollSetting } from "@/types/payroll";

export const staffPeriodKey = (period: PayrollPeriod) => `${period.startDate}:${period.endDate}`;

export function staffPublishedPeriodHistory(current: PayrollPeriod, runs: PayrollRun[]) {
  const periods = new Map<string, PayrollPeriod>([[staffPeriodKey(current), current]]);
  for (const run of runs) {
    const period: PayrollPeriod = { startDate: run.period_start, endDate: run.period_end,
      cycleType: run.cycle_type, preset: "custom", label: staffPeriodLabel(run.period_start, run.period_end) };
    if (!periods.has(staffPeriodKey(period))) periods.set(staffPeriodKey(period), period);
  }
  return [current, ...[...periods.values()].filter(p => staffPeriodKey(p) !== staffPeriodKey(current))
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate))];
}

const DAY = 86400000;
export function shiftStaffDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
export function staffPeriodLabel(start: string, end: string) {
  const format = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  return `${format(start)} – ${format(end)}`;
}

// Staff periods follow the salon calendar; arbitrary URL ranges are never used.
export function staffPeriodAt(setting: SalonPayrollSetting | null, date: string): PayrollPeriod {
  const cycle = setting?.cycle_type ?? "monthly";
  const [year, month, day] = date.split("-").map(Number);
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEnd = new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
  let startDate = monthStart;
  let endDate = monthEnd;
  let preset: PayrollPeriod["preset"] = "current_month";
  if (cycle === "semi_monthly") {
    startDate = day <= 15 ? monthStart : `${date.slice(0, 7)}-16`;
    endDate = day <= 15 ? `${date.slice(0, 7)}-15` : monthEnd;
    preset = day <= 15 ? "semi_monthly_first" : "semi_monthly_second";
  } else if (cycle === "biweekly") {
    const anchor = setting?.biweekly_anchor_date;
    if (!anchor) throw new Error("The salon payroll schedule needs a start date.");
    const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${anchor}T12:00:00Z`)) / DAY);
    startDate = shiftStaffDate(anchor, Math.floor(days / 14) * 14);
    endDate = shiftStaffDate(startDate, 13);
    preset = "current_pay_period";
  }
  return { cycleType: cycle, startDate, endDate, preset, label: staffPeriodLabel(startDate, endDate) };
}

export function staffPeriodHistory(setting: SalonPayrollSetting | null, today: string, count = 12) {
  const periods: PayrollPeriod[] = [];
  let date = today;
  for (let index = 0; index < count; index++) {
    const period = staffPeriodAt(setting, date);
    periods.push(period);
    date = shiftStaffDate(period.startDate, -1);
  }
  return periods;
}

export function staffPayPeriodChoices(setting: SalonPayrollSetting | null, today: string, runs: PayrollRun[]) {
  // Include unfinalized periods too: staff should not have to wait for payroll printing.
  const scheduled = staffPeriodHistory(setting, today, setting?.cycle_type === "monthly" || !setting ? 12 : 26);
  const saved = staffPublishedPeriodHistory(scheduled[0], runs);
  const choices = new Map(saved.map(period => [staffPeriodKey(period), period]));
  for (const period of scheduled) if (!choices.has(staffPeriodKey(period))) choices.set(staffPeriodKey(period), period);
  const periods = [...choices.values()].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate));
  const daysRemaining = Math.round((Date.parse(scheduled[0].endDate) - Date.parse(today)) / DAY);
  // No separate payday is configured; use the salon's period end as the boundary.
  const previousPublished = saved.filter(period => period.endDate < scheduled[0].startDate)
    .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const previous = previousPublished && previousPublished.endDate >= scheduled[1].endDate
    ? previousPublished : scheduled[1];
  return { periods, defaultPeriod: daysRemaining <= 5 ? scheduled[0] : previous };
}

export function staffComparisonPeriods(setting: SalonPayrollSetting | null, period: PayrollPeriod, today: string) {
  const previous = staffPeriodAt(setting, shiftStaffDate(period.startDate, -1));
  const currentEnd = today < period.endDate ? today : period.endDate;
  // Compare like-for-like elapsed calendar days, limited to the shorter period.
  const currentDays = Math.round((Date.parse(currentEnd) - Date.parse(period.startDate)) / DAY) + 1;
  const previousDays = Math.round((Date.parse(previous.endDate) - Date.parse(previous.startDate)) / DAY) + 1;
  const days = Math.max(1, Math.min(currentDays, previousDays));
  const range = (base: PayrollPeriod) => ({ ...base, endDate: shiftStaffDate(base.startDate, days - 1), label: staffPeriodLabel(base.startDate, shiftStaffDate(base.startDate, days - 1)) });
  return { current: range(period), previous: range(previous) };
}
