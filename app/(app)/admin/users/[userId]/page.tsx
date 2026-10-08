import { MembershipEditor } from "../../_components/membership-editor";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminNoteAction, updateAdminUserProfileAction } from "../../actions";
import { AdminActionForm } from "../../_components/action-form";
import { NotificationComposer } from "../../_components/notification-composer";
import { AdminPageHeader, AdminSection, EmptyState, Field, FieldGrid, SecondaryLink, StatusBadge, SubmitButton, TextArea, TextInput, formatAdminDateTime } from "../../_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { listPlatformAdminNotes } from "@/lib/platform-admin/notes";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { getPlatformAdminUserDetail } from "@/lib/platform-admin/users";
import { listAdminNotifications } from "@/lib/platform-admin/workflows";
import { searchPlatformAdminAuditLogs } from "@/lib/platform-admin/audit";
import { UserSecurityPanel } from "./security-panel";
import { getAdminAccountActivity, getAdminAttentionState } from "@/lib/platform-admin/attention";
import { AccountRowActions } from "../../dashboard/account-row-actions";
import { loadOptionalAdminSection, SectionError } from "../../_components/optional-section";

export default async function AdminUserDetailPage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<Record<string,string | string[] | undefined>> }) {
  const context = await requirePlatformAdmin(P.usersRead);
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const query = await searchParams;
  const tab = typeof query.tab === "string" && ["memberships","security","activity"].includes(query.tab) ? query.tab : "overview";
  const detail = await getPlatformAdminUserDetail(userId);
  const user = detail.user;
  const can = (permission: (typeof P)[keyof typeof P]) => context.permissions.includes(permission);
  const basePath = `/admin/users/${userId}`;
  const [notes, activity, notifications, loginActivity, attention] = await Promise.all([
    can(P.notesRead) && tab === "overview" ? loadOptionalAdminSection(() => listPlatformAdminNotes({ targetId:userId,targetType:"user" })) : null,
    can(P.auditRead) && tab === "activity" ? loadOptionalAdminSection(() => searchPlatformAdminAuditLogs({ targetId:userId })) : null,
    can(P.notificationsRead) && tab === "activity" ? loadOptionalAdminSection(() => listAdminNotifications({ userId })) : null,
    can(P.auditRead) && tab === "activity" ? loadOptionalAdminSection(() => getAdminAccountActivity(userId)) : null,
    loadOptionalAdminSection(() => getAdminAttentionState("user", userId)),
  ]);
  const name = user.display_name ?? user.email ?? "Unnamed user";
  return <>
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-zinc-500"><Link className="hover:text-orange-700" href="/admin/users">Users</Link><span className="mx-2">/</span>{name}</nav>
    <AdminPageHeader eyebrow="User account" title={name} actions={<>
      {can(P.usersUpdate) && user.status !== "deleted" && <SecondaryLink href={`${basePath}?edit=1#edit-profile`}>Edit profile</SecondaryLink>}
      {can(P.notificationsSend) && ["active","pending_deletion"].includes(user.status) && <SecondaryLink href={`${basePath}?notify=1#send-notification`}>Send notification</SecondaryLink>}
      <SecondaryLink href="/admin/users">Back to users</SecondaryLink>
    </>}><div className="flex flex-wrap items-center gap-3"><StatusBadge value={user.status}/><span>Member since {formatAdminDateTime(user.created_at)}</span></div></AdminPageHeader>
    <nav className="admin-tabs" aria-label="User details">{[["overview","Overview"],["memberships","Memberships"],["security","Security"],["activity","Activity"]].map(([key,label]) => <Link key={key} href={`${basePath}?tab=${key}`} aria-current={tab === key ? "page" : undefined}>{label}</Link>)}</nav>
    <div className="dashboard-profile-actions"><AccountRowActions id={userId} name={name} kind="user" status={user.status} marked={attention.data ?? false} permissions={context.permissions}/><Link className="dashboard-link" href="/admin/attention">Open attention list →</Link></div>
    {attention.error && <SectionError message={attention.error}/>}
    {tab === "overview" && <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div>
        <AdminSection title="Profile"><FieldGrid>
          <Field label="Email" value={can(P.usersReadSensitive) ? user.email : "Restricted by your role"}/>
          <Field label="Phone" value={can(P.usersReadSensitive) ? user.phone : "Restricted by your role"}/>
          <Field label="Language" value={user.language}/><Field label="Timezone" value={user.timezone}/>
          <Field label="Last login" value={formatAdminDateTime(user.last_login_at)}/><Field label="Updated" value={formatAdminDateTime(user.updated_at)}/>
          <Field label="User ID" value={<span className="font-mono text-xs">{user.id}</span>}/>
          {user.deletion_scheduled_for && <Field label="Deletion scheduled" value={formatAdminDateTime(user.deletion_scheduled_for)}/>}
        </FieldGrid></AdminSection>
        {can(P.usersUpdate) && user.status !== "deleted" && <AdminSection title="Edit profile"><details id="edit-profile" open={query.edit === "1"} className="rounded-xl border border-zinc-200 bg-white p-5"><summary className="cursor-pointer text-sm font-semibold">Update name and contact information</summary>
          <AdminActionForm action={updateAdminUserProfileAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <input name="user_id" type="hidden" value={user.id}/><TextInput defaultValue={user.display_name} label="Display name" name="display_name"/><TextInput defaultValue={user.first_name} label="First name" name="first_name"/><TextInput defaultValue={user.last_name} label="Last name" name="last_name"/>
            {can(P.usersReadSensitive) && <TextInput defaultValue={user.phone} label="Phone" name="phone"/>}
            <div className="sm:col-span-2"><TextArea label="Change reason" name="reason" required rows={2}/></div><SubmitButton>Save profile</SubmitButton>
          </AdminActionForm>
        </details></AdminSection>}
        <AdminSection title="Related support cases">{detail.related_reports.length ? <FieldGrid>{detail.related_reports.map(report => <Field key={report.id} label={report.report_number} value={<Link className="font-medium text-orange-700" href={`/admin/reports/${report.id}`}>{report.summary} · {report.status}</Link>}/>)}</FieldGrid> : <EmptyState title="No related support cases"/>}</AdminSection>
        {can(P.notificationsSend) && ["active","pending_deletion"].includes(user.status) && <AdminSection title="Send notification"><details id="send-notification" open={query.notify === "1"}><summary className="mb-3 cursor-pointer text-sm font-semibold">Compose an in-app message</summary><NotificationComposer userId={user.id}/></details></AdminSection>}
      </div>
      <aside>
        <AdminSection title="Membership summary"><FieldGrid><Field label="Businesses" value={detail.organization_memberships.length}/><Field label="Platform role" value={detail.platform_membership?.role_name ?? "Standard user"}/><Field label="Details" value={<Link className="text-orange-700" href={`${basePath}?tab=memberships`}>View memberships →</Link>}/></FieldGrid></AdminSection>
        <AdminSection title="Internal notes"><p className="mb-3 text-xs text-zinc-500">Visible to authorized admins. Never sent to the user.</p>
          {can(P.notesCreate) && <AdminActionForm action={createAdminNoteAction} resetOnSuccess className="mb-4 grid gap-3"><input name="target_id" type="hidden" value={user.id}/><input name="target_type" type="hidden" value="user"/><input name="return_path" type="hidden" value={basePath}/><TextArea label="New note" name="body" required/><SubmitButton>Add note</SubmitButton></AdminActionForm>}
          {!can(P.notesRead) ? <EmptyState title="Notes are restricted by your role"/> : notes?.error ? <SectionError message={notes.error}/> : notes?.data?.items.length ? <div className="grid gap-3">{notes.data.items.map(note => <article key={note.id} className="rounded-xl border border-zinc-200 bg-white p-4"><p className="whitespace-pre-wrap text-sm">{note.body}</p><p className="mt-2 text-xs text-zinc-500">{note.author?.display_name ?? "Admin"} · {formatAdminDateTime(note.created_at)}</p></article>)}</div> : <EmptyState title="No internal notes"/>}
        </AdminSection>
      </aside>
    </div>}
    {tab === "memberships" && <>
      <AdminSection title="Business memberships">{detail.organization_memberships.length ? <div className="grid gap-3">{detail.organization_memberships.map(membership => <article key={membership.id} className="rounded-xl border border-zinc-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><Link className="font-semibold text-orange-700" href={`/admin/businesses/${membership.organization_id}`}>{membership.organization_name}</Link><p className="mt-1 text-sm text-zinc-500">{membership.role} · Joined {formatAdminDateTime(membership.joined_at ?? membership.created_at)}</p></div><StatusBadge value={membership.status}/></div>{can(P.usersMembershipsManage) && !["deleted","pending_deletion"].includes(user.status) && context.userId !== user.id && <MembershipEditor userId={user.id} membershipId={membership.id} scope="business" role={membership.role} status={membership.status}/>}</article>)}</div> : <EmptyState title="No business memberships"/>}</AdminSection>
      <AdminSection title="Salon memberships">{detail.salon_memberships?.length ? <div className="grid gap-3">{detail.salon_memberships.map(membership => <article key={membership.id} className="rounded-xl border bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><Link href={`/admin/locations/${membership.salon_id}`} className="font-semibold text-orange-700">{membership.salon_name}</Link><StatusBadge value={membership.status}/></div><p className="mt-1 text-sm text-zinc-500">{membership.role}</p>{can(P.usersMembershipsManage) && !["deleted","pending_deletion"].includes(user.status) && context.userId !== user.id && <MembershipEditor userId={user.id} membershipId={membership.id} scope="salon" role={membership.role} status={membership.status}/>}</article>)}</div> : <EmptyState title="No direct salon memberships"/>}</AdminSection>
      <AdminSection title="Platform membership"><FieldGrid><Field label="Role" value={detail.platform_membership?.role_name ?? "Not a platform admin"}/><Field label="Status" value={detail.platform_membership ? <StatusBadge value={detail.platform_membership.status}/> : "—"}/>{can(P.teamRead) && <Field label="Manage" value={<Link href="/admin/team" className="text-orange-700">Open admin team →</Link>}/>}</FieldGrid></AdminSection>
    </>}
    {tab === "security" && <UserSecurityPanel user={user} context={context}/>}
    {tab === "activity" && <>
      {loginActivity && <AdminSection title="Account activity · latest 50 events">{loginActivity.error ? <SectionError message={loginActivity.error}/> : loginActivity.data?.length ? <ul className="dashboard-new-list">{loginActivity.data.map(event => <li key={event.id} className="py-3"><strong>{event.activity_type.replaceAll("_", " ")}</strong><p className="text-sm text-zinc-500">{event.device_label || "Device not recorded"} · {formatAdminDateTime(event.created_at)}</p></li>)}</ul> : <EmptyState title="No recorded account activity"/>}</AdminSection>}
      <AdminSection title="Admin activity">{!can(P.auditRead) ? <EmptyState title="Audit history is restricted by your role"/> : activity?.error ? <SectionError message={activity.error}/> : activity?.data?.items.length ? <div className="grid gap-3">{activity.data.items.map(event => <article key={event.id} className="rounded-xl border bg-white p-4"><p className="font-medium">{event.action.replaceAll("platform_admin.","").replaceAll("_"," ")}</p><p className="mt-1 text-sm text-zinc-600">{event.reason}</p><p className="mt-2 text-xs text-zinc-500">{event.actor?.display_name ?? "System"} · {formatAdminDateTime(event.created_at)}</p></article>)}</div> : <EmptyState title="No recorded admin activity"/>}{can(P.auditRead) && <Link href={`/admin/audit?targetId=${user.id}`} className="mt-3 inline-block text-sm text-orange-700">View full audit history →</Link>}</AdminSection>
      <AdminSection title="Notification history">{!can(P.notificationsRead) ? <EmptyState title="Notification history is restricted by your role"/> : notifications?.error ? <SectionError message={notifications.error}/> : notifications?.data?.items.length ? <div className="grid gap-3">{notifications.data.items.map(message => <article key={message.id} className="rounded-xl border bg-white p-4"><div className="flex justify-between gap-3"><p className="font-medium">{message.title}</p><StatusBadge value={message.read_at ? "read" : message.delivery_status}/></div><p className="mt-2 whitespace-pre-wrap text-sm">{message.body}</p><p className="mt-2 text-xs text-zinc-500">{message.sender_name ?? "Admin"} · {formatAdminDateTime(message.created_at)}</p></article>)}</div> : <EmptyState title="No notifications sent by admins"/>}</AdminSection>
    </>}
  </>;
}
