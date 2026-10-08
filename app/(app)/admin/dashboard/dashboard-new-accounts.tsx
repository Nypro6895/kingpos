import Link from "next/link";
import { getAdminNewAccounts, type RecentAdminRecord } from "@/lib/platform-admin/attention";
import { PLATFORM_ADMIN_PERMISSIONS as P, type PlatformAdminPermission } from "@/types/platform-admin";
import { loadOptionalAdminSection, SectionError } from "../_components/optional-section";
import { AccountRowActions } from "./account-row-actions";
export async function DashboardNewAccounts({ permissions }: { permissions: PlatformAdminPermission[] }) {
  const result = await loadOptionalAdminSection(getAdminNewAccounts);
  if (result.error) return <SectionError message={result.error} />;
  function section(kind: "user" | "location", records: RecentAdminRecord[], count: number) {
    const users = kind === "user";
    return <section className={`dashboard-record-section ${users ? "is-users" : "is-salons"}`} aria-labelledby={`dashboard-new-${kind}`}>
      <div className="dashboard-section-heading"><div><h2 id={`dashboard-new-${kind}`}>{users ? "Newest users" : "Newest salons"}</h2><p className="dashboard-list-description"><strong>{count.toLocaleString("en-US")}</strong> new {users ? "accounts" : "salons"} today · CT</p></div><Link className="dashboard-link" href={users ? "/admin/users?sort=created_desc" : "/admin/locations"}>View all {users ? "users" : "salons"} →</Link></div>
      {records.length ? <ul className="dashboard-new-list">{records.map(record => {
        const href = `/admin/${users ? "users" : "locations"}/${record.id}`;
        return <li key={record.id} data-record={`${kind}:${record.id}`} className="dashboard-new-row">
          <div className="dashboard-new-record"><Link className="dashboard-record-avatar" aria-label={`Open ${record.name}`} href={href}>{record.name.split(/\s+/).map(word => word[0]).slice(0,2).join("").toUpperCase()}</Link><Link className="dashboard-record-title" href={href}>{record.name}</Link></div>
          <span className="dashboard-record-information" title={users ? record.contact || "" : record.address || ""}>{users ? permissions.includes(P.usersReadSensitive) ? record.contact || "No email or phone" : "Contact restricted" : record.address || "Address not recorded"}</span>
          {!users && <span className="dashboard-record-creator">Created by {record.creator_id ? <Link href={`/admin/users/${record.creator_id}`} title={record.creator_contact || undefined}>{record.creator_name || "Unnamed user"}</Link> : "Not recorded"}</span>}
          <span className={`dashboard-status status-${record.status}`}>{record.status.replaceAll("_", " ")}</span>
          <time dateTime={record.created_at}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(record.created_at))} CT</time>
          <AccountRowActions id={record.id} name={record.name} kind={kind} status={record.status} marked={record.marked} permissions={permissions} />
        </li>;
      })}</ul> : <p className="dashboard-muted">No {users ? "accounts" : "salons"} yet.</p>}
    </section>;
  }
  return <div className="dashboard-new-accounts">{permissions.includes(P.usersRead) && section("user", result.data?.users ?? [], result.data?.users_today ?? 0)}{permissions.includes(P.locationsRead) && section("location", result.data?.salons ?? [], result.data?.salons_today ?? 0)}</div>;
}
