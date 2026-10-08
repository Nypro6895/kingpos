"use client";

import Link from "next/link";
import { Fragment, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DASHBOARD_QUEUE_LABELS, dashboardQueueHref, formatDashboardWaiting, type DashboardQueueFilters, type DashboardQueueItem, type DashboardQueuePage, type DashboardQueueSource } from "@/lib/admin-dashboard-model";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import type { DashboardDetail } from "@/types/admin-dashboard";
import type { AdminActionResult } from "../_components/action-form";
import { DashboardDetailPanel } from "./dashboard-detail";
import { DashboardActionForm } from "./dashboard-action-form";
import { dashboardBulkAssignAction } from "./actions";

function Chevron({ open }: { open: boolean }) { return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ transform: open ? "rotate(90deg)" : undefined }}><path d="m9 5 7 7-7 7" /></svg>; }
function QueueRow({ item, loadedAt, userId, selectable, selected, onSelect, onComplete }: {
  item: DashboardQueueItem; loadedAt: string; userId: string; selectable: boolean; selected: boolean;
  onSelect: () => void; onComplete: (result: AdminActionResult) => void;
}) {
  const detailId = useId();
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<DashboardDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/admin/dashboard/detail?kind=${item.kind}&id=${item.id}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Details could not be loaded.");
        if (!controller.signal.aborted) setDetail(data);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Details could not be loaded."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [expanded, item.id, item.kind, loadedAt, attempt]);
  const toggle = () => setExpanded(!expanded);
  return <Fragment>
    <tr className={`dashboard-queue-row ${expanded ? "is-expanded" : ""}`}>
      <td className="dashboard-row-controls"><button type="button" className="dashboard-icon-button" aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`} aria-expanded={expanded} aria-controls={detailId} onClick={toggle}><Chevron open={expanded} /></button>{selectable && <input type="checkbox" aria-label={`Select ${item.title}`} checked={selected} onChange={onSelect} />}</td>
      <td className="dashboard-request"><Link href={item.href}>{item.title}</Link><small>{item.reference} · {item.preview}</small></td>
      <td><span>{DASHBOARD_QUEUE_LABELS[item.kind]}</span><small>{item.status.replaceAll("_", " ")}</small></td>
      <td><span className={`dashboard-priority priority-${item.priority}`}>{item.priority}</span></td>
      <td><time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString("en-US", { timeZone: "America/Chicago" }) + " CT"}>{formatDashboardWaiting(item.createdAt, Date.parse(loadedAt))}</time></td>
      <td>{item.assignedUserId === userId ? "You" : item.assignee || "Unassigned"}</td>
      <td className="dashboard-row-action">{selectable && !item.assignedUserId && <DashboardActionForm action={dashboardBulkAssignAction} onComplete={onComplete} className="dashboard-take-form"><input name="selection" type="hidden" value={JSON.stringify([{id:item.id,kind:item.kind}])}/><input name="assignment" type="hidden" value="me"/><input name="reason" type="hidden" value="Taken from dashboard work queue"/><button className="dashboard-button">Take</button></DashboardActionForm>}<button type="button" className="dashboard-link" aria-expanded={expanded} aria-controls={detailId} onClick={toggle}>{expanded ? "Close" : item.kind === "inbox" ? "Reply" : item.kind === "pending_deletion" || item.kind === "recovery" ? "Manage" : "Review"}</button></td>
    </tr>
    {expanded && <tr className="dashboard-expanded-row"><td colSpan={7}><div id={detailId} className="dashboard-expanded-content" aria-busy={loading}>
      {loading && <p role="status" className="dashboard-muted">Loading current details…</p>}
      {error ? <div role="alert" className="dashboard-notice is-error">{error}<button type="button" className="dashboard-link" onClick={() => setAttempt(attempt + 1)}>Retry</button><Link className="dashboard-link" href={item.href}>Open management page ↗</Link></div> : !loading && detail && <DashboardDetailPanel data={detail} item={item} onComplete={onComplete} />}
    </div></td></tr>}
  </Fragment>;
}

export function DashboardRefresh({ loadedAt }: { loadedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="dashboard-refresh"><time dateTime={loadedAt}>Updated {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(loadedAt))} CT</time><button className="dashboard-link" type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5" /></svg>{pending ? "Refreshing…" : "Refresh"}</button></div>;
}

export function DashboardWorkspace({ queue, sources, filters, loadedAt, userId, permissions }: {
  queue: DashboardQueuePage; sources: Pick<DashboardQueueSource, "kind" | "error">[]; filters: DashboardQueueFilters; loadedAt: string; userId: string; permissions: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<AdminActionResult | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const canSelect = (item: DashboardQueueItem) => item.kind === "inbox" ? permissions.includes(P.inboxManage) : item.kind === "cases" && permissions.includes(P.reportsAssign);
  const eligible = queue.items.filter(canSelect);
  const activeSelection = eligible.filter(item => selected.includes(`${item.kind}:${item.id}`));
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = activeSelection.length > 0 && activeSelection.length < eligible.length; }, [activeSelection.length, eligible.length]);
  function complete(result: AdminActionResult) { setNotice(result); if (result.ok) setSelected([]); router.refresh(); }
  const activeFilters = Boolean(filters.q || filters.kind !== "all" || filters.view !== "all" || filters.sort !== "priority");
  const effective = { ...filters, page: queue.page };
  return <section className="dashboard-queue-section" aria-labelledby="dashboard-queue-title">
    <div className="dashboard-section-heading"><h2 id="dashboard-queue-title">Needs attention</h2><Link className="dashboard-link" href="/admin?kind=all#dashboard-queue-title">View all queues →</Link></div>
    {notice && <div className={`dashboard-notice dashboard-result ${notice.ok ? "is-success" : "is-error"}`} role={notice.ok ? "status" : "alert"}><span>{notice.message}</span><button type="button" className="dashboard-icon-button" aria-label="Dismiss result" onClick={() => setNotice(null)}>×</button></div>}
    {sources.filter(source => source.error).map(source => <div key={source.kind} className="dashboard-notice is-error" role="alert"><strong>{DASHBOARD_QUEUE_LABELS[source.kind]}:</strong> {source.error}</div>)}
    <div className="dashboard-queue-toolbar"><nav className="dashboard-queue-tabs" aria-label="Work queue views">{([{ value: "all", label: "All queues", count: queue.counts.all }, { value: "mine", label: "Assigned to me", count: queue.counts.mine }, { value: "overdue", label: "Overdue", count: queue.counts.overdue }, { value: "urgent", label: "High priority", count: queue.counts.urgent }] as const).map(tab => <Link key={tab.value} href={dashboardQueueHref(effective, { view: tab.value, page: 1 })} scroll={false} aria-current={filters.view === tab.value ? "page" : undefined}>{tab.label}<span>{tab.count}</span></Link>)}</nav>
      <form action="/admin" className="dashboard-queue-search"><input type="hidden" name="view" value={filters.view} /><input type="hidden" name="kind" value={filters.kind} /><input type="hidden" name="sort" value={filters.sort} /><input type="hidden" name="pageSize" value={String(filters.pageSize)} /><label className="sr-only" htmlFor="dashboard-queue-search">Search work queue</label><input key={filters.q} id="dashboard-queue-search" type="search" name="q" defaultValue={filters.q} maxLength={100} placeholder="Search queue…" /><button className="dashboard-button" type="submit">Search</button></form>
    </div>
    <div className="dashboard-queue-filters"><label>Queue<select value={filters.kind} onChange={event => router.push(dashboardQueueHref(effective, { kind: event.target.value as DashboardQueueFilters["kind"], page: 1 }), { scroll: false })}><option value="all">All types</option>{sources.map(source => <option key={source.kind} value={source.kind}>{DASHBOARD_QUEUE_LABELS[source.kind]}{source.error ? " · unavailable" : ` (${queue.byKind[source.kind] ?? 0})`}</option>)}</select></label><label>Sort<select value={filters.sort} onChange={event => router.push(dashboardQueueHref(effective, { sort: event.target.value as DashboardQueueFilters["sort"], page: 1 }), { scroll: false })}><option value="priority">Priority, then oldest</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>{activeFilters && <Link className="dashboard-link" href="/admin" scroll={false}>Reset filters</Link>}<span className="dashboard-muted">{sources.some(source => source.error) ? "Available queues shown" : "Review target: 48 hours"}</span></div>
    {activeSelection.length > 0 && <div className="dashboard-bulk-bar"><DashboardActionForm action={dashboardBulkAssignAction} onComplete={complete} confirmMessage={`Update assignment for ${Math.min(activeSelection.length, 25)} selected item(s)?`} className="dashboard-bulk-form"><strong>{activeSelection.length} selected</strong><input type="hidden" name="selection" value={JSON.stringify(activeSelection.slice(0, 25).map(item => ({ id: item.id, kind: item.kind })))} /><label><span className="sr-only">Assignment reason</span><input name="reason" required minLength={3} maxLength={1000} placeholder="Assignment reason…" /></label><button className="dashboard-button" name="assignment" value="me">Assign to me</button><button className="dashboard-button" name="assignment" value="unassign">Unassign</button><button type="button" className="dashboard-link" onClick={() => setSelected([])}>Clear selection</button>{activeSelection.length > 25 && <small>First 25 items will be updated.</small>}</DashboardActionForm></div>}
    {queue.items.length ? <div className="dashboard-table-scroll"><table className="dashboard-queue-table"><caption className="sr-only">Work awaiting review or follow-up. Expand a request to view details and take action.</caption><thead><tr><th className="dashboard-row-controls"><span className="sr-only">Expand and select</span>{eligible.length > 0 && <input ref={selectAllRef} type="checkbox" aria-label="Select all assignable items on this page" checked={activeSelection.length === eligible.length} onChange={event => setSelected(event.target.checked ? eligible.map(item => `${item.kind}:${item.id}`) : [])} />}</th><th>Request</th><th>Type / status</th><th>Priority</th><th>Waiting</th><th>Assignee</th><th>Action</th></tr></thead><tbody>{queue.items.map(item => <QueueRow key={`${item.kind}:${item.id}`} item={item} loadedAt={loadedAt} userId={userId} selectable={canSelect(item)} selected={selected.includes(`${item.kind}:${item.id}`)} onSelect={() => setSelected(current => current.includes(`${item.kind}:${item.id}`) ? current.filter(id => id !== `${item.kind}:${item.id}`) : [...current, `${item.kind}:${item.id}`])} onComplete={complete} />)}</tbody></table></div> : <div className="dashboard-empty"><span aria-hidden="true">✓</span><h3>{activeFilters ? "No requests match these filters" : sources.some(source => source.error) ? "No pending work in the available queues" : "All queues are clear"}</h3><p>{activeFilters ? "Try another queue, view, or search term." : "New requests will appear here when they need your attention."}</p>{activeFilters && <Link href="/admin" className="dashboard-link" scroll={false}>Clear filters →</Link>}</div>}
    <div className="dashboard-pagination"><p>{queue.total ? `${(queue.page - 1) * queue.pageSize + 1}–${Math.min(queue.page * queue.pageSize, queue.total)} of ${queue.total} requests` : "0 requests"}</p><div><label>Rows per page<select value={filters.pageSize} onChange={event => router.push(dashboardQueueHref(effective, { pageSize: Number(event.target.value), page: 1 }), { scroll: false })}>{[10, 25, 50].map(size => <option key={size}>{size}</option>)}</select></label><span>Page {queue.page} of {Math.max(1, Math.ceil(queue.total / queue.pageSize))}</span>{queue.page > 1 ? <Link className="dashboard-button" href={dashboardQueueHref(effective, { page: queue.page - 1 })} scroll={false}>Previous</Link> : <span className="dashboard-button is-disabled">Previous</span>}{queue.page * queue.pageSize < queue.total ? <Link className="dashboard-button" href={dashboardQueueHref(effective, { page: queue.page + 1 })} scroll={false}>Next</Link> : <span className="dashboard-button is-disabled">Next</span>}</div></div>
  </section>;
}
