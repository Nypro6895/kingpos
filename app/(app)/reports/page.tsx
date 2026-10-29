import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";

import { OwnerLiveReports } from '@/app/reports/owner-live-reports';
import { DAILY_POS_REPORT_PERMISSIONS } from "@/lib/daily-pos-report";
import type { OperationalReportSearchParams } from "@/lib/operational-report";
import { loadOwnerReportsRead } from "@/lib/owner-reports-read";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";

type ReportsPageProps = {
  searchParams: Promise<OperationalReportSearchParams>;
};

async function ReportsPage({ searchParams }: ReportsPageProps) {
  const [params, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/reports"),
  ]);

  const canViewReports = await hasPermission(
    DAILY_POS_REPORT_PERMISSIONS.view,
    context,
  );

  if (!canViewReports) {
    return <p className="p-6"><WorkspaceText text="You do not have permission to view reports." /></p>;
  }

  const reports = await loadOwnerReportsRead(params, context);

  // Server response timestamp is intentionally request-specific.
  // eslint-disable-next-line react-hooks/purity
  return <OwnerLiveReports snapshotAt={Date.now()} key={JSON.stringify(params)} viewerId={context.user.id} salonId={context.currentSalon.id} salonName={context.currentSalon.name} {...reports}/>;
}

export default withExperiencePage(ReportsPage);
