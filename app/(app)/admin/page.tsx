import { DashboardIcon } from "./dashboard/dashboard-icons";
import Link from "next/link";
import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { getPlatformAdminDashboard } from "@/lib/platform-admin/dashboard";
import { loadAdminDashboardWorkspace } from "@/lib/platform-admin/dashboard-workspace";
import { searchPlatformAdminAuditLogs } from "@/lib/platform-admin/audit";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { filterDashboardQueue, parseDashboardFilters } from "@/lib/admin-dashboard-model";
import { loadOptionalAdminSection, SectionError } from "./_components/optional-section";
import { DashboardWorkspace, DashboardRefresh } from "./dashboard/dashboard-workspace";
import { DashboardAudit } from "./dashboard/dashboard-secondary";
import { DashboardNewAccounts } from "./dashboard/dashboard-new-accounts";
import { DashboardSurface } from "./dashboard/dashboard-surface";
import { DashboardOperations } from "./dashboard/dashboard-operations";

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePlatformAdmin(P.dashboardRead);
  const params = await searchParams;
  const filters = parseDashboardFilters(params);
  const selected = typeof params.record === "string" ? /^(user|location|business):([0-9a-f-]{36})$/i.exec(params.record) : null;
  const initialSelection = selected ? { kind: selected[1].toLowerCase() as "user" | "location" | "business", id: selected[2], tab: params.panel === "followup" ? "followup" : "overview" } : null;
  const can = (permission: typeof P[keyof typeof P]) => actor.permissions.includes(permission);
  const [overview, sources, audit] = await Promise.all([
    loadOptionalAdminSection(getPlatformAdminDashboard), loadAdminDashboardWorkspace(),
    can(P.auditRead) ? loadOptionalAdminSection(() => searchPlatformAdminAuditLogs({ pageSize: "8" })) : null,
  ]);
  const loadedAt = new Date().toISOString();
  const queue = filterDashboardQueue(sources, filters, actor.userId, Date.parse(loadedAt));
  const totalQueue = filterDashboardQueue(sources, { ...filters, q: "", kind: "all", view: "all" }, actor.userId, Date.parse(loadedAt));
  const data = overview.data;
  const metric = (label: string, value: number | undefined, href: string, allowed: boolean, detail: ReactNode) => <div className="dashboard-stat-row" key={label}>
    <dt><DashboardIcon name={label === "Users" ? "users" : label === "Businesses" ? "business" : label === "Salons" ? "salon" : "reports"}/>{allowed ? <Link href={href}>{label}</Link> : label}</dt><dd>{allowed ? <Link href={href}>{value?.toLocaleString("en-US") ?? "—"}</Link> : value?.toLocaleString("en-US") ?? "—"}</dd>
    <div className="dashboard-stat-detail">{detail}</div>
  </div>;
  return <DashboardSurface loadedAt={loadedAt} initialSelection={initialSelection}><div className="admin-dashboard">
    <header className="dashboard-page-heading"><div><h1>Dashboard</h1><p>Your platform, ready for action</p></div><DashboardRefresh loadedAt={loadedAt} /></header>
    {overview.error && <SectionError message={overview.error} />}
    <div className="dashboard-overview-layout">
      <DashboardNewAccounts permissions={actor.permissions} />
      <aside className="dashboard-stats" aria-labelledby="dashboard-stats-title"><h2 id="dashboard-stats-title">Platform overview</h2><dl>
        {metric("Users", data?.users.total, "/admin/users", can(P.usersRead), can(P.usersRead) ? <><Link href="/admin/users?status=active">{data?.users.active ?? "—"} active</Link> · <Link href="/admin/users?status=suspended">{data?.users.suspended ?? "—"} suspended</Link></> : "Platform accounts")}
        {metric("Businesses", data?.businesses.total, "/admin/businesses", can(P.businessesRead), "Registered businesses")}
        {metric("Salons", data?.locations.total, "/admin/locations", can(P.locationsRead), "Salon locations")}
        {metric("Open reports", data?.reports.open, "/admin/reports", can(P.reportsRead), can(P.reportsRead) ? <Link href="/admin?kind=cases&view=urgent">{data?.reports.urgent_or_high ?? "—"} high or urgent</Link> : "Pending reports")}
      </dl></aside>
    </div>
    {totalQueue.counts.all > 0 && <p className="sr-only"><strong>{totalQueue.counts.all} requests</strong> awaiting review or follow-up.{totalQueue.counts.urgent > 0 && <Link className="dashboard-link" href="/admin?view=urgent">{totalQueue.counts.urgent} need priority attention →</Link>}</p>}
    <DashboardWorkspace queue={queue} sources={sources.map(({ kind, error }) => ({ kind, error }))} filters={filters} loadedAt={loadedAt} userId={actor.userId} permissions={actor.permissions} />
    <DashboardOperations userId={actor.userId} loadedAt={loadedAt} permissions={actor.permissions}/>
    <details className="dashboard-recent-audit"><summary className="dashboard-link">Recent admin activity</summary><div className="dashboard-secondary-grid">
      {audit && <section aria-labelledby="dashboard-activity-title"><div className="dashboard-section-heading"><h2 id="dashboard-activity-title">Recent activity</h2><Link className="dashboard-link" href="/admin/audit">View audit log →</Link></div>{audit.error ? <SectionError message={audit.error} /> : <DashboardAudit items={audit.data?.items ?? []} permissions={actor.permissions} />}</section>}

    </div>
    </details><p className="dashboard-footer">Admin actions are recorded in their audit or workflow history.</p>
  </div></DashboardSurface>;
}
