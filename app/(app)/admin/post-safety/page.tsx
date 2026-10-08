import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { loadAdminDashboardWorkspace } from "@/lib/platform-admin/dashboard-workspace";
import { filterDashboardQueue, parseDashboardFilters } from "@/lib/admin-dashboard-model";
import { DashboardWorkspace } from "../dashboard/dashboard-workspace";
export default async function PostSafetyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const actor = await requirePlatformAdmin(P.reportsRead);
 const filters = {...parseDashboardFilters(await searchParams), kind: "post_safety" as const};
 const sources = await loadAdminDashboardWorkspace();
 const loadedAt = new Date().toISOString();
 const queue = filterDashboardQueue(sources, filters, actor.userId, Date.parse(loadedAt));
 return <div className="admin-dashboard"><header className="dashboard-page-heading"><div><h1>Post safety</h1><p>Review flagged posts and take action.</p></div></header><DashboardWorkspace queue={queue} sources={sources.filter(source => source.kind === "post_safety")} filters={filters} loadedAt={loadedAt} userId={actor.userId} permissions={actor.permissions}/></div>;
}
