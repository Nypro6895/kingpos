import { withExperiencePage } from "@/components/experience-page";
import { AdminPageHeader, EmptyState } from "../_components/admin-ui";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { listAdminAttention } from "@/lib/platform-admin/attention";
import { AccountRowActions } from "../dashboard/account-row-actions";
import { loadOptionalAdminSection, SectionError } from "../_components/optional-section";
async function AttentionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const kind = params.kind === "location" ? "location" : "user";
  const actor = await requirePlatformAdmin(kind === "user" ? P.usersRead : P.locationsRead);
  const page = Math.min(100000, Math.max(1, Number.parseInt(String(params.page || "1"), 10) || 1));
  const result = await loadOptionalAdminSection(() => listAdminAttention(page, kind));
  return <div className="admin-dashboard"><AdminPageHeader eyebrow="Review & support" title="Attention list">Users and businesses marked for review or follow-up.</AdminPageHeader><nav className="admin-tabs" aria-label="Attention records">{actor.permissions.includes(P.usersRead) && <Link href="/admin/attention" aria-current={kind === "user" ? "page" : undefined}>Users</Link>}{actor.permissions.includes(P.locationsRead) && <Link href="/admin/attention?kind=location" aria-current={kind === "location" ? "page" : undefined}>Businesses</Link>}</nav>{result.error ? <SectionError message={result.error} /> : <><p className="dashboard-list-description">{result.data?.total ?? 0} marked {kind === "user" ? "users" : "businesses"}</p><ul className="dashboard-new-list">{result.data?.items.map(record => <li key={record.target_id} className="dashboard-new-row"><div className="dashboard-new-record"><div className="dashboard-record-name"><Link className="dashboard-link" href={`/admin/${kind === "user" ? "users" : "locations"}/${record.target_id}`}><strong>{record.name}</strong></Link><small>{record.contact ? `${record.contact} · ` : ""}{record.status.replaceAll("_", " ")}</small><p className="dashboard-attention-reason">{record.reason}</p><small>Due: {record.due_at ? new Intl.DateTimeFormat("en-US", {dateStyle:"medium",timeStyle:"short",timeZone:"America/Chicago"}).format(new Date(record.due_at)) + " CT" : "Not scheduled"}</small><Link className="dashboard-link" href={`/admin?record=${kind}:${record.target_id}&panel=followup`}>Edit follow-up →</Link><small>Marked by {record.marked_by || "Admin"} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" }).format(new Date(record.created_at))}</small></div></div><AccountRowActions id={record.target_id} name={record.name} kind={kind} status={record.status} marked permissions={actor.permissions} /></li>)}</ul>{!result.data?.items.length && <EmptyState title="No marked records on this page">Mark users or businesses for follow-up from their workspace.</EmptyState>}<nav className="dashboard-button-row" aria-label="Attention pagination">{page > 1 && <Link className="dashboard-button" href={`/admin/attention?kind=${kind}&page=${page - 1}`}>Previous</Link>}<span>Page {page}</span>{page * 25 < (result.data?.total ?? 0) && <Link className="dashboard-button" href={`/admin/attention?kind=${kind}&page=${page + 1}`}>Next</Link>}</nav></>}</div>;
}

export default withExperiencePage(AttentionPage, { admin: true });
