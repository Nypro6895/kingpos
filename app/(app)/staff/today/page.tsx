import { withExperiencePage } from "@/components/experience-page";
import { TodayDashboardClient } from "@/app/staff/today/today-dashboard-client";
import { getExperienceContext } from "@/lib/experience-context";
import { createLiveResourceSnapshot } from "@/lib/experience-live-resource-server";
import { isOwnerMembership } from "@/lib/current-context";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { getTodayDashboard } from "@/lib/today-dashboard";
import { Suspense } from "react";
import { PageLoadingSkeleton } from "@/components/loading-feedback";
import { runReadWithDeadline } from "@/lib/bounded-get";
import { runWithReadContext } from "@/lib/read-context-scope";

type StaffTodayPageProps = {
  searchParams: Promise<{ date?: string | string[] }>;
};

async function TodayContent(props: StaffTodayPageProps) {
  return runWithReadContext(() => loadTodayContent(props));
}

async function loadTodayContent({ searchParams }: StaffTodayPageProps) {
  const context = await requireSalonManagePageContext("/staff/today");
  const params = await searchParams;
  const dashboard = await runReadWithDeadline(getTodayDashboard(context, { date: params.date, phase: "shell" }), 12000);
  return <TodayDashboardClient
    initialSnapshot={createLiveResourceSnapshot(dashboard, ["generatedAt"])}
    scope={getExperienceContext(context).scope}
    salonId={context.currentSalon.id}
    requestedDate={Array.isArray(params.date) ? params.date[0] : params.date}
    isOwner={isOwnerMembership(context.currentMembership)}
  />;
}

function StaffTodayPage(props: StaffTodayPageProps) {
  return <Suspense fallback={<PageLoadingSkeleton />}><TodayContent {...props} /></Suspense>;
}

export default withExperiencePage(StaffTodayPage);
