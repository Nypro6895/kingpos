
import { OwnerLiveReports } from '@/app/reports/owner-live-reports';
import {
  canApplyFinancialCorrections,
  canEditDailyPosClosing,
  DAILY_POS_REPORT_PERMISSIONS,
  getDailyPosReport,
  getDefaultReportDate,
  isDateInputValue,
  normalizeReportDate,
} from "@/lib/daily-pos-report";
import {
  getOperationalReport,
  type OperationalReportSearchParams,
} from "@/lib/operational-report";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";

type ReportsPageProps = {
  searchParams: Promise<OperationalReportSearchParams>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const [params, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/reports"),
  ]);

  const canViewReports = await hasPermission(
    DAILY_POS_REPORT_PERMISSIONS.view,
    context,
  );

  if (!canViewReports) {
    return <p className="p-6">You do not have permission to view reports.</p>;
  }

  const reportOverview = await getOperationalReport(params, context);
  const date = firstParam(params.date);
  const selectedDate = await normalizeReportDate(
    isDateInputValue(date) ? date : reportOverview.range.endDate,
    context,
  );
  const today = await getDefaultReportDate(context);
  const [report, canEditPermission, canRequestCorrection, canApplyCorrection] =
    await Promise.all([
      getDailyPosReport(selectedDate, context),
      canEditDailyPosClosing(context),
      hasPermission(DAILY_POS_REPORT_PERMISSIONS.requestCorrection, context),
      canApplyFinancialCorrections(context),
    ]);
  const canEdit = canEditPermission && !report.lock.isLocked;

  // Server response timestamp is intentionally request-specific.
  // eslint-disable-next-line react-hooks/purity
  return <OwnerLiveReports snapshotAt={Date.now()} key={JSON.stringify(params)} salonId={context.currentSalon.id} salonName={context.currentSalon.name} today={today} report={report} reportOverview={reportOverview} canEdit={canEdit} canApplyCorrection={canApplyCorrection} canRequestCorrection={canRequestCorrection}/>;
}
