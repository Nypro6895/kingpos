import "server-only";

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

/** Complete existing DTO; only independent data reads overlap. Closing permission
 * hints retain their original position after the Overview read has completed. */
export async function loadOwnerReportsRead(params: OperationalReportSearchParams, context: CurrentBusinessContext) {
  const prepared = await prepareOperationalReport(params, context);
  const overview = prepared.load();
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const closing = normalizeReportDate(isDateInputValue(rawDate) ? rawDate : prepared.range.endDate, context)
    .then(date => getDailyPosReport(date, context));
  const hints = overview.then(() => Promise.all([
    getDefaultReportDate(context),
    canEditDailyPosClosing(context),
    hasPermission(DAILY_POS_REPORT_PERMISSIONS.requestCorrection, context),
    canApplyFinancialCorrections(context),
  ]));
  const [reportOverview, report, [today, canEditPermission, canRequestCorrection, canApplyCorrection]] =
    await Promise.all([overview, closing, hints]);
  return { today, report, reportOverview, canEdit: canEditPermission && !report.lock.isLocked, canApplyCorrection, canRequestCorrection };
}
