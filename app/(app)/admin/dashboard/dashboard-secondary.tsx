"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { adminAuditTargetHref, readableAdminAction } from "@/lib/admin-dashboard-model";
import { PLATFORM_ADMIN_PERMISSIONS as P, type PlatformAdminAuditLogItem, type PlatformAdminPermission } from "@/types/platform-admin";
import { NotificationComposer } from "../_components/notification-composer";
import { EntityPicker } from "../_components/entity-picker";
import { routes } from "@/lib/routes";

export function DashboardAudit({ items, permissions }: { items: PlatformAdminAuditLogItem[]; permissions: PlatformAdminPermission[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!items.length) return <p className="dashboard-muted">No activity recorded yet.</p>;
  return <div className="dashboard-table-scroll"><table className="dashboard-audit-table"><caption className="sr-only">Recent admin activity with expandable changes</caption><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{items.map(item => {
    const href = adminAuditTargetHref(item.target_type, item.target_id, permissions);
    const open = expanded === item.id;
    return <Fragment key={item.id}><tr><td><time dateTime={item.created_at}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(item.created_at))} CT</time></td><td>{item.actor?.id && permissions.includes(P.usersRead) ? <Link href={`/admin/users/${item.actor.id}`}>{item.actor.display_name || "Admin"}</Link> : item.actor?.display_name || "System"}</td><td>{readableAdminAction(item.action)}</td><td>{href ? <Link href={href} className="dashboard-link">{item.target_type.replace("platform_admin_", "").replaceAll("_", " ")} · {item.target_id?.slice(0, 8)}</Link> : item.target_type.replaceAll("_", " ")}</td><td><button type="button" className="dashboard-icon-button" aria-label={`${open ? "Collapse" : "Expand"} activity ${readableAdminAction(item.action)}`} aria-expanded={open} aria-controls={`audit-${item.id}`} onClick={() => setExpanded(open ? null : item.id)}>{open ? "⌄" : "›"}</button></td></tr>{open && <tr className="dashboard-audit-expanded"><td colSpan={5}><div id={`audit-${item.id}`}><p><strong>Reason:</strong> {item.reason || "No reason recorded."}</p><div className="dashboard-audit-changes"><div><h3>Before</h3><pre>{JSON.stringify(item.before_data ?? {}, null, 2)}</pre></div><div><h3>After</h3><pre>{JSON.stringify(item.after_data ?? {}, null, 2)}</pre></div></div><Link className="dashboard-link" href={`/admin/audit?${new URLSearchParams({ ...(item.target_id ? { targetId: item.target_id } : {}), targetType: item.target_type })}`}>View related activity →</Link></div></td></tr>}</Fragment>;
  })}</tbody></table></div>;
}

export function DashboardQuickActions({ permissions }: { permissions: string[] }) {
  const can = (permission: string) => permissions.includes(permission);
  const [panel, setPanel] = useState<"user" | "notification" | null>(null);
  return <section className="dashboard-quick-actions" aria-labelledby="dashboard-quick-title"><div className="dashboard-section-heading"><h2 id="dashboard-quick-title">Quick actions</h2></div>
    {can(P.businessesUpdate) && <Link href={routes.salons.create()} className="dashboard-quick-action"><span><strong>Add business</strong><small>Register a salon in your owner workspace</small></span><span aria-hidden="true">→</span></Link>}
    {can(P.usersRead) && <button type="button" className="dashboard-quick-action" aria-expanded={panel === "user"} aria-controls="dashboard-find-user" onClick={() => setPanel(panel === "user" ? null : "user")}><span>Find user</span><span aria-hidden="true">{panel === "user" ? "−" : "→"}</span></button>}
    {panel === "user" && <form id="dashboard-find-user" action="/admin/users" className="dashboard-quick-panel"><label>Search user<input name="q" type="search" minLength={2} maxLength={100} required autoFocus placeholder="Name, email, or phone…" /></label><button className="dashboard-button dashboard-button-primary">Find user</button></form>}
    {can(P.notificationsSend) && can(P.usersRead) && <button type="button" className="dashboard-quick-action" aria-expanded={panel === "notification"} aria-controls="dashboard-send-notification" onClick={() => setPanel(panel === "notification" ? null : "notification")}><span>Send notification</span><span aria-hidden="true">{panel === "notification" ? "−" : "→"}</span></button>}
    {panel === "notification" && <div id="dashboard-send-notification" className="dashboard-quick-panel"><NotificationComposer /></div>}
    {can(P.reportsCreate) && <Link className="dashboard-quick-action" href="/admin/reports#create-case"><span>Create support case</span><span aria-hidden="true">→</span></Link>}
    {can(P.businessesRead) && <Link className="dashboard-quick-action" href="/admin/businesses"><span>Manage businesses</span><span aria-hidden="true">→</span></Link>}
    {can(P.usersRead) && <details className="dashboard-quick-panel"><summary className="dashboard-link">Open a specific user</summary><form className="dashboard-form" action={form => { const id = String(form.get("user_id") || ""); if (/^[0-9a-f-]{36}$/i.test(id)) window.location.assign(`/admin/users/${id}`); }}><EntityPicker kind="user" name="user_id" label="User" required /><button className="dashboard-button">Open profile</button></form></details>}
  </section>;
}
