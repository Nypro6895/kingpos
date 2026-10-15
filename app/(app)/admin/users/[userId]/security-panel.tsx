import Link from "next/link";
import { restoreAdminUserAction, suspendAdminUserAction } from "../../actions";
import { cancelAdminDeletionAction, revokeAdminSessionsAction, scheduleAdminDeletionAction } from "../../workflow-actions";
import { AdminActionForm } from "../../_components/action-form";
import { AdminSection, EmptyState, SecondaryLink, StatusBadge, SubmitButton, TextArea, TextInput, formatAdminDateTime } from "../../_components/admin-ui";
import { loadOptionalAdminSection, SectionError } from "../../_components/optional-section";
import { getAdminDeletionImpact, getAdminUserSecurity } from "@/lib/platform-admin/workflows";
import { PLATFORM_ADMIN_PERMISSIONS as P, type PlatformAdminContext } from "@/types/platform-admin";
import type { PlatformAdminUserDetail } from "@/lib/platform-admin/users";

export async function UserSecurityPanel({ user, context }: { user: PlatformAdminUserDetail["user"]; context: PlatformAdminContext }) {
  const can = (permission: (typeof P)[keyof typeof P]) => context.permissions.includes(permission);
  const ownAccount = context.userId === user.id;
  const [security,impact] = await Promise.all([
    can(P.recoveryRead) ? loadOptionalAdminSection(() => getAdminUserSecurity(user.id)) : null,
    can(P.usersDelete) ? loadOptionalAdminSection(() => getAdminDeletionImpact(user.id)) : null,
  ]);
  return <>
    <AdminSection title="Login sessions">{!can(P.recoveryRead) ? <EmptyState title="Session information is restricted by your role"/> : security?.error ? <SectionError message={security.error}/> : security?.data?.sessions.length ? <div className="grid gap-3">{security.data.sessions.map(session => <article key={session.id} className="flex flex-wrap justify-between gap-3 rounded-xl border bg-white p-4"><div><p className="font-medium">{session.device_label || session.browser_name || "Device"} · {session.os_name}</p><p className="mt-1 text-xs text-zinc-500">Last seen {formatAdminDateTime(session.last_seen_at)}</p></div><StatusBadge value={session.revoked_at ? "revoked" : "active"}/></article>)}</div> : <EmptyState title="No recorded login sessions"/>}
      {can(P.recoveryManage) && !ownAccount && <AdminActionForm action={revokeAdminSessionsAction} confirmMessage="Revoke all recorded login sessions for this user?" className="mt-4 grid max-w-xl gap-3 rounded-xl border bg-white p-5"><input name="user_id" type="hidden" value={user.id}/><TextArea label="Session revocation reason" name="reason" required rows={2}/><SubmitButton>Revoke all sessions</SubmitButton></AdminActionForm>}
    </AdminSection>
    <AdminSection title="Account access"><div className="rounded-xl border border-zinc-200 bg-white p-5">
      {ownAccount ? <p className="text-sm text-zinc-500">Manage your own account from account settings.</p> : ["pending_deletion","deleted"].includes(user.status) ? <p className="text-sm text-zinc-500">Access changes are unavailable during or after account deletion.</p> : can(P.usersSuspend) && user.status !== "suspended" ? <AdminActionForm action={suspendAdminUserAction} confirmMessage="Suspend this account and revoke its recorded login sessions?" className="grid max-w-xl gap-3"><input name="user_id" type="hidden" value={user.id}/><TextArea label="Suspension reason" name="reason" required rows={2}/><SubmitButton>Suspend account</SubmitButton></AdminActionForm> : can(P.usersRestore) && user.status === "suspended" ? <AdminActionForm action={restoreAdminUserAction} confirmMessage="Restore access for this suspended account?" className="grid max-w-xl gap-3"><input name="user_id" type="hidden" value={user.id}/><TextArea label="Restoration reason" name="reason" required rows={2}/><SubmitButton>Restore account</SubmitButton></AdminActionForm> : <p className="text-sm text-zinc-500">Account access changes are restricted by your role.</p>}
    </div></AdminSection>
    <AdminSection title="Account deletion"><div id="account-deletion" className="rounded-xl border border-red-200 bg-white p-5">
      <p className="mb-4 text-sm text-zinc-600">Deletion uses the existing 30-day grace period. Retained business, financial and audit records are preserved. Last-owner salons must be transferred or closed first.</p>
      {!can(P.usersDelete) ? <p className="text-sm text-zinc-500">Only authorized platform owners can schedule or cancel deletion.</p> : impact?.error ? <SectionError message={impact.error}/> : <>
        {impact?.data?.salons.length ? <ul className="mb-4 grid gap-2">{impact.data.salons.map(salon => <li key={salon.id} className="text-sm"><Link href={`/admin/locations/${salon.id}`} className="font-medium text-orange-700">{salon.name}</Link> · {salon.status} · {salon.last_owner ? "Last owner" : "Other owner available"}</li>)}</ul> : <p className="mb-4 text-sm text-zinc-500">No owned salons.</p>}
        {ownAccount ? <SecondaryLink href="/account#delete-account">Open my account settings</SecondaryLink> : user.status === "pending_deletion" ? <AdminActionForm action={cancelAdminDeletionAction} confirmMessage="Cancel this pending account deletion?" className="grid max-w-xl gap-3"><input name="user_id" type="hidden" value={user.id}/><TextArea label="Cancellation reason" name="reason" required rows={2}/><SubmitButton>Cancel pending deletion</SubmitButton></AdminActionForm> : user.status === "deleted" ? <p className="text-sm text-zinc-500">Deletion has already completed.</p> : user.status !== "active" ? <p className="text-sm text-zinc-500">Restore this account to active status before scheduling deletion. Scheduling deletion never unlocks a suspended account.</p> : impact?.data?.blocked ? <p role="alert" className="text-sm text-red-700">Deletion is blocked until last-owner salons are transferred or permanently closed.</p> : impact?.data && <AdminActionForm action={scheduleAdminDeletionAction} confirmMessage="Schedule deletion of this account in 30 days?" className="grid max-w-xl gap-3"><input name="user_id" type="hidden" value={user.id}/><TextArea label="Deletion reason" name="reason" required rows={2}/><TextInput label="Type DELETE to confirm" name="confirmation" required/><label className="flex gap-2 text-sm"><input name="backup_acknowledged" type="checkbox" required/>I reviewed ownership, backup needs and retained records.</label><button type="submit" className="justify-self-start rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Schedule deletion</button></AdminActionForm>}
      </>}
    </div></AdminSection>
  </>;
}
