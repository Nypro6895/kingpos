"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLATFORM_ADMIN_PERMISSIONS as P, type PlatformAdminPermission } from "@/types/platform-admin";
import { DashboardActionForm } from "./dashboard-action-form";
import { dashboardAccountAction } from "./account-actions";
import { openDashboardRecord } from "@/lib/admin-record-navigation";
function Icon({ name }: { name: "lock" | "delete" | "attention" | "history" }) {
  const paths = { lock: "M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3", delete: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7", attention: "M12 3 2 21h20L12 3z M12 9v5 M12 17v1", history: "M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l4 2" };
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
export function AccountRowActions({ id, name, kind, status, marked, permissions }: { id: string; name: string; kind: "user" | "location"; status: string; marked: boolean; permissions: PlatformAdminPermission[] }) {
  const [operation, setOperation] = useState<string | null>(null);
  const router = useRouter(), can = (p: PlatformAdminPermission) => permissions.includes(p);
  const locked = kind === "user" ? status === "suspended" : status === "inactive";
  const canLock = kind === "user" ? can(locked ? P.usersRestore : P.usersSuspend) && ["active", "inactive", "suspended"].includes(status) : can(P.locationsUpdateStatus);
  const title = operation === "mark" ? "Mark for follow-up" : operation === "unmark" ? "Remove attention mark" : operation === "unlock" ? "Restore access" : "Disable access";
  const base = `/admin/${kind === "user" ? "users" : "locations"}/${id}`;
  function choose(value: string) { if (!openDashboardRecord(base, value === "mark" || value === "unmark" ? "followup" : "lock")) setOperation(operation ? null : value); }
  return <div className="dashboard-record-controls"><div className="dashboard-record-icons">
    {canLock && <button type="button" className="dashboard-icon-button" title={`${locked ? "Unlock" : "Lock"} ${name}`} aria-label={`${locked ? "Unlock" : "Lock"} ${name}`} onClick={() => choose(locked ? "unlock" : "lock")}><Icon name="lock" /></button>}
    {kind === "user" && can(P.usersDelete) && status !== "deleted" && <Link className="dashboard-icon-button" title={`Review deletion of ${name}`} aria-label={`Review deletion of ${name}`} href={`${base}?tab=security#account-deletion`}><Icon name="delete" /></Link>}
    {can(kind === "user" ? P.usersUpdate : P.locationsUpdateStatus) && <button type="button" className={`dashboard-icon-button ${marked ? "is-marked" : ""}`} title={`${marked ? "Remove attention mark for" : "Mark for follow-up:"} ${name}`} aria-label={`${marked ? "Remove attention mark for" : "Mark for follow-up:"} ${name}`} aria-pressed={marked} onClick={() => choose(marked ? "unmark" : "mark")}><Icon name="attention" /></button>}
    {can(P.auditRead) && <Link className="dashboard-icon-button" title={`Activity history of ${name}`} aria-label={`Activity history of ${name}`} href={kind === "user" ? `${base}?tab=activity` : `/admin/audit?targetType=location&targetId=${id}`}><Icon name="history" /></Link>}
  </div>{operation && <div className="dashboard-record-action-panel"><strong>{title}: {name}</strong><DashboardActionForm action={dashboardAccountAction} confirmMessage={`${title} for ${name}? This action will be recorded in the audit history.`} onComplete={result => { if (result.ok) { setOperation(null); router.refresh(); } }}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="target_id" value={id} /><input type="hidden" name="operation" value={operation} /><label>Reason<textarea name="reason" required minLength={3} maxLength={1000} rows={2} /></label><div className="dashboard-button-row"><button className="dashboard-button dashboard-button-primary">{title}</button><button type="button" className="dashboard-button" onClick={() => setOperation(null)}>Cancel</button></div></DashboardActionForm></div>}</div>;
}
