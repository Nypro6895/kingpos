import Link from "next/link";
import { AdminPageHeader, AdminSection, EmptyState, Pagination, SearchForm, StatusBadge, formatAdminDateTime } from "../_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { listSupportInbox } from "@/lib/platform-admin/inbox";
import { SUPPORT_STATUSES, SUPPORT_STATUS_LABELS } from "@/lib/support-rules";
import { InboxRefresh } from "./inbox-refresh";

export default async function SupportInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin(P.inboxRead);
  const params = await searchParams;
  const read = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  const result = await listSupportInbox({ page: read("page"), pageSize: read("pageSize"), q: read("q"), status: read("status") });
  return <><AdminPageHeader eyebrow="Communication" title="Inbox">Customer messages from the Contact Support form. Read requests, coordinate follow-up and reply by email.</AdminPageHeader><div className="mt-5 flex flex-wrap items-center gap-3"><InboxRefresh /><Link target="_blank" href="/contact-support" className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium">Open Contact Support form ↗</Link><p className="text-xs text-zinc-500">Updates every 30 seconds while this page is open.</p></div>
    <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{SUPPORT_STATUSES.map(status => <Link key={status} href={`/admin/inbox?status=${status}`} className={`rounded-xl border bg-white p-4 ${read("status") === status ? "border-orange-300" : "border-zinc-200"}`}><p className="text-xs font-medium text-zinc-500">{SUPPORT_STATUS_LABELS[status]}</p><p className="mt-2 text-2xl font-semibold">{result.counts[status]}</p></Link>)}</div>
    <SearchForm defaultQuery={read("q")} placeholder="Search name, email, message or reference"><label className="grid gap-1 text-sm font-medium">Status<select name="status" defaultValue={read("status") ?? ""} className="rounded-lg border border-zinc-300 px-3 py-2"><option value="">All messages</option>{SUPPORT_STATUSES.map(status => <option key={status} value={status}>{SUPPORT_STATUS_LABELS[status]}</option>)}</select></label></SearchForm>
    <AdminSection title="Conversations">{result.items.length ? <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white">{result.items.map(item => <Link key={item.id} href={`/admin/inbox/${item.id}`} className="admin-data-row block p-5 transition hover:bg-zinc-50"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">{item.customer_name}</h2><p className="break-all text-sm text-zinc-500">{item.customer_email}</p></div><StatusBadge value={item.status} /></div><p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-sm text-zinc-700">{item.preview}</p><p className="mt-3 text-xs text-zinc-500">#{item.id.slice(0, 8).toUpperCase()} · {formatAdminDateTime(item.created_at)} · {item.assignee ? `Assigned to ${item.assignee}` : "Unassigned"}{item.needs_delivery_review ? " · Email delivery needs review" : ""}</p></Link>)}</div> : <EmptyState title="No support messages found">New Contact Support submissions will appear here.</EmptyState>}<Pagination basePath="/admin/inbox" page={result.page} pageSize={result.page_size} total={result.total} query={{ q: read("q"), status: read("status"), pageSize: read("pageSize") }} /></AdminSection>
  </>;
}
