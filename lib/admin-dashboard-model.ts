import { PLATFORM_ADMIN_PERMISSIONS as P, type PlatformAdminPermission } from "@/types/platform-admin";

export const DASHBOARD_QUEUE_KINDS = ["inbox", "claims", "verification", "cases", "post_safety", "pending_deletion", "recovery"] as const;
export type DashboardQueueKind = typeof DASHBOARD_QUEUE_KINDS[number];
export const DASHBOARD_QUEUE_LABELS: Record<DashboardQueueKind, string> = {
  inbox: "Support inbox", claims: "Ownership claims", verification: "Salon verification",
  cases: "Support cases", post_safety: "Post safety", pending_deletion: "Pending deletion", recovery: "Account recovery",
};
export const DASHBOARD_QUEUE_PERMISSIONS: Record<DashboardQueueKind, PlatformAdminPermission> = {
  inbox: P.inboxRead, claims: P.locationsRead, verification: P.locationsRead,
  cases: P.reportsRead, post_safety: P.reportsRead, pending_deletion: P.usersRead, recovery: P.recoveryRead,
};
export type DashboardQueueItem = {
  id: string; kind: DashboardQueueKind; title: string; reference: string; preview: string;
  status: string; priority: string; createdAt: string; assignedUserId: string | null;
  assignee: string | null; href: string; linkedReportId?: string | null;
};
export type DashboardQueueSource = { kind: DashboardQueueKind; items: DashboardQueueItem[]; error: string | null };
export type DashboardQueueFilters = {
  q: string; kind: DashboardQueueKind | "all"; view: "all" | "mine" | "urgent" | "overdue";
  sort: "priority" | "oldest" | "newest"; page: number; pageSize: number;
};
export type DashboardQueuePage = {
  items: DashboardQueueItem[]; total: number; page: number; pageSize: number;
  counts: { all: number; mine: number; urgent: number; overdue: number }; byKind: Partial<Record<DashboardQueueKind, number>>;
};

export function isDashboardQueueKind(value: unknown): value is DashboardQueueKind {
  return DASHBOARD_QUEUE_KINDS.includes(value as DashboardQueueKind);
}
export function parseDashboardFilters(params: Record<string, string | string[] | undefined>): DashboardQueueFilters {
  const read = (key: string) => { const value = params[key]; return Array.isArray(value) ? value[0] : value; };
  const positive = (key: string, fallback: number) => { const raw = read(key); return raw && /^\d+$/.test(raw) ? Math.max(1, Math.min(Number(raw), 100000)) : fallback; };
  const kind = read("kind"), view = read("view"), sort = read("sort");
  return {
    q: (read("q") ?? "").trim().slice(0, 100), kind: isDashboardQueueKind(kind) ? kind : "all",
    view: view === "mine" || view === "urgent" || view === "overdue" ? view : "all",
    sort: sort === "oldest" || sort === "newest" ? sort : "priority",
    page: positive("page", 1), pageSize: [10, 25, 50].includes(positive("pageSize", 10)) ? positive("pageSize", 10) : 10,
  };
}
export function dashboardQueueHref(filters: DashboardQueueFilters, patch: Partial<DashboardQueueFilters> = {}) {
  const next = { ...filters, ...patch }, params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.kind !== "all") params.set("kind", next.kind);
  if (next.view !== "all") params.set("view", next.view);
  if (next.sort !== "priority") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.pageSize !== 10) params.set("pageSize", String(next.pageSize));
  return `/admin${params.size ? `?${params}` : ""}`;
}
export function filterDashboardQueue(sources: DashboardQueueSource[], filters: DashboardQueueFilters, userId: string, referenceTime?: number): DashboardQueuePage {
  const rows = sources.flatMap(source => source.items);
  // A moderation request and its linked support case represent one piece of work.
  // Keep the support case in the dedicated cases view, but avoid double counting the combined queue.
  const linked = new Set(rows.filter(row => row.kind === "post_safety").map(row => row.linkedReportId).filter(Boolean));
  const reports = new Map(rows.filter(row => row.kind === "cases").map(row => [row.id, row]));
  const combined = rows.filter(row => row.kind !== "cases" || !linked.has(row.id)).map(row => {
    const report = row.kind === "post_safety" && row.linkedReportId ? reports.get(row.linkedReportId) : null;
    return report ? { ...row, priority: report.priority, assignedUserId: report.assignedUserId, assignee: report.assignee } : row;
  });
  const all = filters.kind === "cases" ? rows.filter(row => row.kind === "cases") : combined;
  const urgent = (row: DashboardQueueItem) => row.priority === "high" || row.priority === "urgent";
  const overdue = (row: DashboardQueueItem) => referenceTime !== undefined && Number.isFinite(Date.parse(row.createdAt)) && referenceTime - Date.parse(row.createdAt) >= 48 * 60 * 60 * 1000;
  const byKind: DashboardQueuePage["byKind"] = {};
  for (const source of sources) if (!source.error) byKind[source.kind] = source.items.length;
  const scoped = all.filter(row => (filters.kind === "all" || row.kind === filters.kind) &&
    (!filters.q || `${row.title} ${row.reference} ${row.preview} ${DASHBOARD_QUEUE_LABELS[row.kind]} ${row.assignee ?? ""}`.toLowerCase().includes(filters.q.toLowerCase())));
  const counts = { all: scoped.length, mine: scoped.filter(row => row.assignedUserId === userId).length, urgent: scoped.filter(urgent).length, overdue: scoped.filter(overdue).length };
  const filtered = scoped.filter(row => filters.view === "all" || (filters.view === "mine" ? row.assignedUserId === userId : filters.view === "overdue" ? overdue(row) : urgent(row)));
  const priority: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const time = (row: DashboardQueueItem) => Number.isFinite(Date.parse(row.createdAt)) ? Date.parse(row.createdAt) : 0;
  filtered.sort((a, b) => (filters.sort === "priority" ? (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2) : 0) ||
    (filters.sort === "newest" ? time(b) - time(a) : time(a) - time(b)) || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  const page = Math.min(filters.page, Math.max(1, Math.ceil(filtered.length / filters.pageSize)));
  return { items: filtered.slice((page - 1) * filters.pageSize, page * filters.pageSize), total: filtered.length, page, pageSize: filters.pageSize, counts, byKind };
}
export function formatDashboardWaiting(value: string, now: number) {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return "—";
  const minutes = Math.max(0, Math.floor((now - date) / 60000));
  return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}
export function readableAdminAction(value: string) {
  return value.replace(/^platform_admin[._]/, "").replace(/[._]+/g, " ").replace(/\b\w/, letter => letter.toUpperCase());
}
export function adminAuditTargetHref(targetType: string, targetId: string | null, permissions: readonly PlatformAdminPermission[]) {
  if (!targetId || !/^[0-9a-f-]{36}$/i.test(targetId)) return null;
  const routes: Record<string, [string, PlatformAdminPermission]> = {
    platform_admin_user: ["users", P.usersRead], platform_admin_business: ["businesses", P.businessesRead],
    platform_admin_location: ["locations", P.locationsRead], platform_admin_report: ["reports", P.reportsRead],
    support_inbox: ["inbox", P.inboxRead],
  };
  const route = routes[targetType];
  return route && permissions.includes(route[1]) ? `/admin/${route[0]}/${targetId}` : null;
}
