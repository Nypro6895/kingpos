"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import type { DashboardRecord } from "@/types/admin-dashboard-record";
import { DashboardActionForm } from "./dashboard-action-form";
import { dashboardAccountAction, saveDashboardFollowupAction } from "./account-actions";
import { createAdminNoteAction } from "../actions";
import { scheduleAdminDeletionAction, cancelAdminDeletionAction } from "../workflow-actions";
import { NotificationComposer } from "../_components/notification-composer";
import type { AdminActionResult } from "../_components/action-form";
import { openDashboardRecord } from "@/lib/admin-record-navigation";

type Selection = { kind: "user" | "location" | "business"; id: string; tab: string };
const date = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(new Date(value)) + " CT";
function localInput(value: string | null) { if (!value) return ""; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,16); }

export function DashboardSurface({ children, loadedAt, initialSelection = null }: { children: ReactNode; loadedAt: string; initialSelection?: Selection | null }) {
  const [selection, setSelection] = useState<Selection | null>(initialSelection);
  const [record, setRecord] = useState<DashboardRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<AdminActionResult | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sourceRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  useEffect(() => {
    const choose = (event: Event) => { sourceRef.current = document.activeElement as HTMLElement; setSelection((event as CustomEvent<Selection>).detail); setRecord(null); setError(""); setNotice(null); };
    const capture = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (!link || link.hasAttribute("data-full-page") || link.target === "_blank" || link.origin !== location.origin) return;
      const href = link.pathname + link.search;
      const tab = link.search.includes("tab=security") ? "delete" : link.search.includes("tab=activity") ? "activity" : link.search.includes("followup=1") ? "followup" : "overview";
      if (openDashboardRecord(href, tab)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("admin:record", choose); document.addEventListener("click", capture, true);
    return () => { window.removeEventListener("admin:record", choose); document.removeEventListener("click", capture, true); };
  }, []);
  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    async function load() {
    setLoading(true); setError("");
    await fetch(`/admin/dashboard/record?kind=${selection!.kind}&id=${selection!.id}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Record unavailable.");
      if (!controller.signal.aborted) setRecord(result);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load record."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    void load();
    return () => controller.abort();
  }, [selection, loadedAt, attempt]);
  useEffect(() => { if (selection) closeRef.current?.focus(); }, [selection]);
  const close = () => { setSelection(null); setRecord(null); sourceRef.current?.focus(); };
  function complete(result: AdminActionResult) { setNotice(result); if (result.ok) { setAttempt(value => value + 1); router.refresh(); } }
  return <div className={`dashboard-surface ${selection ? "has-record" : ""}`}><div className="dashboard-main-content">{children}</div>{selection && <aside className="dashboard-record-drawer" role="dialog" aria-label="Record details" aria-busy={loading} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); close(); }
    if (event.key === "Tab" && window.matchMedia("(max-width: 1100px)").matches) {
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled])')].filter(node => node.offsetParent !== null);
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  }}><div className="dashboard-drawer-toolbar"><strong>Record details</strong><button ref={closeRef} className="dashboard-icon-button" type="button" aria-label="Close record details" onClick={close}>×</button></div>{notice && <p className={`dashboard-notice ${notice.ok ? "is-success" : "is-error"}`} role={notice.ok ? "status" : "alert"}>{notice.message}</p>}{loading && <p role="status" className="dashboard-muted">Loading current details…</p>}{error && <div role="alert" className="dashboard-notice is-error">{error}<button className="dashboard-button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}{record && !loading && <RecordDetail key={`${record.kind}:${record.id}:${attempt}:${loadedAt}`} record={record} initialTab={selection.tab} onComplete={complete}/>}</aside>}</div>;
}

function RecordDetail({ record, initialTab, onComplete }: { record: DashboardRecord; initialTab: string; onComplete: (result: AdminActionResult) => void }) {
  const [tab, setTab] = useState(initialTab);
  const [due, setDue] = useState(localInput(record.followup?.due_at ?? null));
  const can = (p: typeof P[keyof typeof P]) => record.permissions.includes(p);
  const canFollow = record.kind !== "business" && can(record.kind === "user" ? P.usersUpdate : P.locationsUpdateStatus);
  const locked = record.kind === "user" ? record.status === "suspended" : record.status === "inactive";
  const canLock = !record.ownAccount && record.kind !== "business" && (record.kind === "user" ? can(locked ? P.usersRestore : P.usersSuspend) && ["active","inactive","suspended"].includes(record.status) : can(P.locationsUpdateStatus));
  const fields = <><input name="target_id" type="hidden" value={record.id}/><input name="kind" type="hidden" value={record.kind}/></>;
  return <><header className="dashboard-record-heading"><span className="dashboard-record-avatar">{record.name[0]}</span><div><h2>{record.name}</h2><span className={`dashboard-status status-${record.status}`}>{record.status.replaceAll("_", " ")}</span></div><Link data-full-page className="dashboard-link" href={record.href}>Open full profile ↗</Link></header><dl className="dashboard-record-facts">{record.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.label === "Last login" && fact.value ? date(fact.value) : fact.value || "Not recorded"}</dd></div>)}<div><dt>Created</dt><dd>{date(record.createdAt)}</dd></div></dl>{record.links.length > 0 && <div className="dashboard-record-related"><strong>Related records</strong>{record.links.map(link => <Link key={link.href} className="dashboard-link" href={link.href}>{link.label} →</Link>)}</div>}{record.errors.map(error => <p key={error} role="alert" className="dashboard-notice is-error">{error}</p>)}<nav className="admin-tabs" aria-label="Record detail tabs">{["overview","activity","notes"].map(value => <button key={value} aria-current={tab === value ? "page" : undefined} onClick={() => setTab(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</nav>
    {(tab === "overview" || tab === "followup") && <>{record.kind !== "business" && <section className="dashboard-drawer-section"><h3>Follow-up {record.followup && <span className="dashboard-status status-waiting">Marked for review</span>}</h3>{canFollow ? <DashboardActionForm action={saveDashboardFollowupAction} onComplete={onComplete}>{fields}<input name="expected_updated_at" type="hidden" value={record.followup?.updated_at || ""}/><label>Reason<textarea name="reason" required minLength={3} maxLength={1000} rows={2} defaultValue={record.followup?.reason || ""}/></label><div className="dashboard-drawer-field-grid"><label>Assigned to<select name="assigned_user_id" defaultValue={record.followup?.assigned_user_id || ""}><option value="">Unassigned</option>{record.assignees.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Due (your local time)<input type="datetime-local" value={due} onChange={event => setDue(event.target.value)}/><input type="hidden" name="due_at" value={due && Number.isFinite(Date.parse(due)) ? new Date(due).toISOString() : ""}/></label></div><button className="dashboard-button dashboard-button-primary">Save follow-up</button></DashboardActionForm> : <p className="dashboard-muted">{record.followup ? `${record.followup.reason} · ${record.followup.assignee || "Unassigned"}${record.followup.due_at ? ` · ${date(record.followup.due_at)}` : ""}` : "No follow-up scheduled."}</p>}{record.followup && canFollow && <DashboardActionForm action={dashboardAccountAction} onComplete={onComplete} confirmMessage="Complete this follow-up and remove its attention mark? History will be retained.">{fields}<input name="operation" type="hidden" value="unmark"/><label>Review outcome<textarea name="reason" required minLength={3} maxLength={1000} rows={2}/></label><button className="dashboard-button">Mark reviewed</button></DashboardActionForm>}</section>}<section className="dashboard-drawer-section"><h3>Recent activity</h3><Activity record={record} limit={5}/></section>{can(P.notesCreate) && <NoteForm record={record} onComplete={onComplete}/>}</>}
    {tab === "activity" && <section className="dashboard-drawer-section"><h3>Activity history</h3><Activity record={record} limit={30}/>{can(P.auditRead) && <Link data-full-page className="dashboard-link" href={`/admin/audit?targetId=${record.id}`}>Full audit history →</Link>}</section>}
    {tab === "notes" && <section className="dashboard-drawer-section"><h3>Internal notes</h3>{can(P.notesRead) ? record.notes.length ? record.notes.map(note => <article key={note.id} className="dashboard-drawer-note"><p>{note.body}</p><small>{date(note.created_at)}</small></article>) : <p className="dashboard-muted">No notes recorded.</p> : <p className="dashboard-muted">Notes are restricted by your role.</p>}{can(P.notesCreate) && <NoteForm record={record} onComplete={onComplete}/>}</section>}
    {tab === "lock" && canLock && <section className="dashboard-drawer-section"><h3>{locked ? "Restore access" : "Lock account"}</h3><DashboardActionForm action={dashboardAccountAction} onComplete={onComplete} confirmMessage={locked ? "Restore access for this record?" : "Disable access for this record? User suspension also revokes recorded login sessions."}>{fields}<input name="operation" type="hidden" value={locked ? "unlock" : "lock"}/><label>Reason<textarea name="reason" required minLength={3} maxLength={1000} rows={2}/></label><button className="dashboard-button dashboard-button-primary">{locked ? "Restore access" : "Disable access"}</button></DashboardActionForm></section>}
    {tab === "notify" && record.kind === "user" && can(P.notificationsSend) && <NotificationComposer userId={record.id}/>}
    {tab === "delete" && record.kind === "user" && can(P.usersDelete) && <section className="dashboard-drawer-section"><h3>Review account deletion</h3><p>Deletion follows the 30-day grace period. Ownership and retained records are checked before scheduling.</p>{record.ownAccount ? <Link data-full-page href="/account#delete-account" className="dashboard-link">Manage your own account →</Link> : record.status === "pending_deletion" ? <DashboardActionForm action={cancelAdminDeletionAction} onComplete={onComplete} confirmMessage="Cancel scheduled deletion?"><input type="hidden" name="user_id" value={record.id}/><label>Reason<textarea name="reason" required minLength={3} maxLength={1000}/></label><button className="dashboard-button">Cancel pending deletion</button></DashboardActionForm> : record.status !== "active" ? <p className="dashboard-muted">Only active accounts can enter the deletion grace period.</p> : !record.deletion ? <p role="alert">Deletion impact must load before scheduling deletion.</p> : record.deletion.blocked ? <p role="alert">Transfer or permanently close last-owner salons before scheduling deletion.</p> : <DashboardActionForm action={scheduleAdminDeletionAction} onComplete={onComplete} confirmMessage={`Schedule deletion of ${record.name} in 30 days?`}><input name="user_id" type="hidden" value={record.id}/><label>Reason<textarea name="reason" required minLength={3} maxLength={1000}/></label><label>Type DELETE<input name="confirmation" required pattern="DELETE"/></label><label><input name="backup_acknowledged" type="checkbox" required/>I reviewed ownership, backup needs and retained records.</label><button className="dashboard-button dashboard-button-danger">Schedule deletion</button></DashboardActionForm>}</section>}
    <footer className="dashboard-drawer-actions">{canLock && <button className="dashboard-button" onClick={() => setTab("lock")}>{locked ? "Restore access" : record.kind === "user" ? "Lock account" : "Disable salon"}</button>}{record.kind === "user" && can(P.notificationsSend) && ["active","pending_deletion"].includes(record.status) && <button className="dashboard-button" onClick={() => setTab("notify")}>Send notification</button>}{record.kind === "user" && can(P.usersDelete) && record.status !== "deleted" && <button className="dashboard-button dashboard-button-danger" onClick={() => setTab("delete")}>Review deletion</button>}</footer>
  </>;
}
function Activity({ record, limit }: { record: DashboardRecord; limit: number }) { return record.permissions.includes(P.auditRead) ? record.activity.length ? <ol className="dashboard-record-timeline">{record.activity.slice(0,limit).map(event => <li key={event.id}><time>{date(event.createdAt)}</time><strong>{event.title}</strong>{event.reason && <p>{event.reason}</p>}{event.actor && <small>{event.actor}</small>}</li>)}</ol> : <p className="dashboard-muted">No activity recorded yet.</p> : <p className="dashboard-muted">Activity is restricted by your role.</p>; }
function NoteForm({ record, onComplete }: { record: DashboardRecord; onComplete: (result: AdminActionResult) => void }) { return <DashboardActionForm action={createAdminNoteAction} onComplete={onComplete} resetOnSuccess><input name="target_type" type="hidden" value={record.kind}/><input name="target_id" type="hidden" value={record.id}/><label>Add internal note<textarea name="body" required minLength={3} maxLength={5000} rows={3} placeholder="Add internal note…"/></label><input name="reason" type="hidden" value="Dashboard internal note"/><button className="dashboard-button dashboard-button-primary">Save note</button></DashboardActionForm>; }
