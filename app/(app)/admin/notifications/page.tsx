import Link from "next/link";
import { AdminPageHeader, AdminSection, EmptyState, Pagination, SearchForm, StatusBadge, formatAdminDateTime } from "../_components/admin-ui";
import { NotificationComposer } from "../_components/notification-composer";
import { EntityPicker } from "../_components/entity-picker";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { listAdminNotifications } from "@/lib/platform-admin/workflows";

export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const context = await requirePlatformAdmin(P.notificationsRead);
  const params = await searchParams;
  const read = (key:string) => typeof params[key] === "string" ? params[key] as string : undefined;
  const messages = await listAdminNotifications({page:read("page"),q:read("q"),userId:read("userId")});
  return <>
    <AdminPageHeader eyebrow="Communication" title="Notifications">Send targeted in-app messages and review delivery history. Advertising announcements are managed separately.</AdminPageHeader>
    {context.permissions.includes(P.notificationsSend) && <AdminSection title="New notification"><details className="rounded-xl border bg-white p-5"><summary className="cursor-pointer text-sm font-semibold">Compose a message</summary><div className="mt-4 max-w-3xl"><NotificationComposer/></div></details></AdminSection>}
    <SearchForm defaultQuery={read("q")} placeholder="Search title or recipient name"><EntityPicker kind="user" name="userId" label="Recipient" defaultValue={read("userId")} defaultLabel={read("userId") ? "Selected user" : ""}/></SearchForm>
    <AdminSection title="Delivery history">{messages.items.length ? <div className="grid gap-3">{messages.items.map(message => <article key={message.id} className="rounded-xl border border-zinc-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-base font-semibold">{message.title}</h2><Link href={`/admin/users/${message.recipient_user_id}`} className="text-sm text-orange-700">{message.recipient_name ?? "Unnamed user"}</Link></div><StatusBadge value={message.read_at ? "read" : message.delivery_status}/></div><p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">{message.body}</p><p className="mt-3 text-xs text-zinc-500">{message.sender_name ?? "Admin"} · {formatAdminDateTime(message.created_at)}{message.read_at ? ` · Read ${formatAdminDateTime(message.read_at)}` : ""}</p><details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">Internal send reason</summary><p className="mt-1">{message.reason}</p></details>{message.delivery_status === "suppressed" && <p className="mt-2 text-xs text-amber-800">Not delivered because of recipient preferences.</p>}</article>)}</div> : <EmptyState title="No notifications found"/>}<Pagination basePath="/admin/notifications" page={messages.page} pageSize={messages.page_size} total={messages.total} query={{q:read("q"),userId:read("userId")}}/></AdminSection>
  </>;
}
