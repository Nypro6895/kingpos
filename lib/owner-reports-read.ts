import "server-only";

import { loadReportExpensePeriod } from "@/lib/report-expense-period-server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import {
  canApplyFinancialCorrections,
  canEditDailyPosClosing,
  DAILY_POS_REPORT_PERMISSIONS,
  getDailyPosReport,
  getDefaultReportDate,
  isDateInputValue,
  normalizeReportDate,
} from "@/lib/daily-pos-report";
import { prepareOperationalReport, type OperationalReportSearchParams } from "@/lib/operational-report";
import { hasPermission } from "@/lib/permissions";
import { getDailyReportOverview } from "@/lib/daily-report-overview";

/** Complete existing DTO; only independent data reads overlap. Closing permission
 * hints retain their original position after the Overview read has completed. */
export async function loadOwnerReportsRead(params: OperationalReportSearchParams & { expensePeriodStart?: string | string[] }, context: CurrentBusinessContext) {
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const today = await getDefaultReportDate(context);
  const date = await normalizeReportDate(isDateInputValue(rawDate) ? rawDate : today, context);
  const prepared = await prepareOperationalReport({date,preset:"custom",start:date,end:date}, context);
  const [report, [canEditPermission, canRequestCorrection, canApplyCorrection], expensePeriod] = await Promise.all([
    getDailyPosReport(date, context),
    Promise.all([
    canEditDailyPosClosing(context),
    hasPermission(DAILY_POS_REPORT_PERMISSIONS.requestCorrection, context),
    canApplyFinancialCorrections(context),
    ]),
    loadReportExpensePeriod(context, prepared.range.timeZone, params.expensePeriodStart).catch(() => ({ error: "Payroll schedule is unavailable. Reopen Reports to retry." })),
  ]);
  // The accounting screen only needs day metadata. Do not load the retired
  // operational charts, comparisons, bookings or customer analytics on entry.
  const reportOverview = {range:{...prepared.range}};
  const accountingOverview = await getDailyReportOverview(report, context);
  return { today, expensePeriod, report, reportOverview, accountingOverview, canEdit: canEditPermission && !report.lock.isLocked, canApplyCorrection, canRequestCorrection };
}
