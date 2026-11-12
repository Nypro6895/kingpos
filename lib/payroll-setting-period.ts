import type { SalonPayrollSetting } from "@/types/payroll";
import { staffPeriodAt, shiftStaffDate } from "./staff-payroll-period";

export function payrollSettingPeriod(
  setting: SalonPayrollSetting | null,
  date: string,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T12:00:00Z`)) ||
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new Error("Choose a valid payroll period.");
  return staffPeriodAt(setting, date);
}
export function nextPayrollSettingPeriod(
  setting: SalonPayrollSetting | null,
  date: string,
) {
  return payrollSettingPeriod(
    setting,
    shiftStaffDate(payrollSettingPeriod(setting, date).endDate, 1),
  );
}
export function requirePayrollSettingBoundary(
  setting: SalonPayrollSetting | null,
  date: string,
) {
  const period = payrollSettingPeriod(setting, date);
  if (period.startDate !== date)
    throw new Error(
      `Settings must start with a whole payroll period (${period.startDate}). Choose this entire period or the next period.`,
    );
  return period;
}
