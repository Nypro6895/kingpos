import Link from "next/link";
import {
  createAdminNoteAction,
  restoreAdminUserAction,
  suspendAdminUserAction,
  updateAdminUserProfileAction,
} from "@/app/(app)/admin/actions";
import {
  AdminPageHeader,
  AdminSection,
  EmptyState,
  Field,
  FieldGrid,
  SecondaryLink,
  StatusBadge,
  SubmitButton,
  TextArea,
  TextInput,
  formatAdminDateTime,
  hasAdminPermission,
} from "@/app/(app)/admin/_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { listPlatformAdminNotes } from "@/lib/platform-admin/notes";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { getPlatformAdminUserDetail } from "@/lib/platform-admin/users";

type UserDetailPageProps = {
  params: Promise<{ userId: string }>;
};

export default async function AdminUserDetailPage({
  params,
}: UserDetailPageProps) {
  const context = await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.usersRead);
  const { userId } = await params;
  const detail = await getPlatformAdminUserDetail(userId);
  const canUpdate = hasAdminPermission(context, PLATFORM_ADMIN_PERMISSIONS.usersUpdate);
  const canSuspend = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.usersSuspend,
  );
  const canRestore = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.usersRestore,
  );
  const canReadNotes = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.notesRead,
  );
  const canCreateNotes = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.notesCreate,
  );
  const notes = canReadNotes
    ? await listPlatformAdminNotes({ targetId: userId, targetType: "user" })
    : null;

  return (
    <>
      <AdminPageHeader
        actions={<SecondaryLink href="/admin/users">Back to users</SecondaryLink>}
        eyebrow="Account"
        title={detail.user.display_name ?? detail.user.email ?? "User detail"}
      >
        Account profile, platform membership, tenant memberships, notes and
        related reports.
      </AdminPageHeader>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-6">
          <AdminSection title="Profile">
            <FieldGrid>
              <Field label="User ID" value={detail.user.id} />
              <Field label="Auth user ID" value={detail.user.auth_user_id ?? "-"} />
              <Field label="Status" value={<StatusBadge value={detail.user.status} />} />
              <Field label="Email" value={detail.user.email ?? "-"} />
              <Field label="Phone" value={detail.user.phone ?? "-"} />
              <Field label="Language" value={detail.user.language} />
              <Field label="Timezone" value={detail.user.timezone} />
              <Field label="Created" value={formatAdminDateTime(detail.user.created_at)} />
              <Field label="Updated" value={formatAdminDateTime(detail.user.updated_at)} />
            </FieldGrid>
          </AdminSection>

          {canUpdate ? (
            <AdminSection title="Safe Profile Edit">
              <form
                action={updateAdminUserProfileAction}
                className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-2"
              >
                <input name="user_id" type="hidden" value={detail.user.id} />
                <TextInput
                  defaultValue={detail.user.display_name}
                  label="Display name"
                  name="display_name"
                />
                <TextInput
                  defaultValue={detail.user.first_name}
                  label="First name"
                  name="first_name"
                />
                <TextInput
                  defaultValue={detail.user.last_name}
                  label="Last name"
                  name="last_name"
                />
                <TextInput defaultValue={detail.user.phone} label="Phone" name="phone" />
                <div className="sm:col-span-2">
                  <TextArea label="Reason" name="reason" required rows={3} />
                </div>
                <div className="sm:col-span-2">
                  <SubmitButton>Save profile</SubmitButton>
                </div>
              </form>
            </AdminSection>
          ) : null}

          <AdminSection title="Organization Memberships">
            {detail.organization_memberships.length === 0 ? (
              <EmptyState title="No tenant memberships" />
            ) : (
              <FieldGrid>
                {detail.organization_memberships.map((membership) => (
                  <Field
                    key={membership.id}
                    label={membership.organization_name}
                    value={
                      <span>
                        {membership.role} - <StatusBadge value={membership.status} /> -{" "}
                        {formatAdminDateTime(membership.created_at)}
                      </span>
                    }
                  />
                ))}
              </FieldGrid>
            )}
          </AdminSection>

          <AdminSection title="Related Reports">
            {detail.related_reports.length === 0 ? (
              <EmptyState title="No reports tied to this user" />
            ) : (
              <FieldGrid>
                {detail.related_reports.map((report) => (
                  <Field
                    key={report.id}
                    label={report.report_number}
                    value={
                      <Link
                        className="font-bold text-orange-700"
                        href={`/admin/reports/${report.id}`}
                      >
                        {report.summary} - {report.status}
                      </Link>
                    }
                  />
                ))}
              </FieldGrid>
            )}
          </AdminSection>
        </div>

        <aside className="grid content-start gap-6">
          <AdminSection title="Account Actions">
            <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              {canSuspend && detail.user.status !== "suspended" ? (
                <form action={suspendAdminUserAction} className="grid gap-3">
                  <input name="user_id" type="hidden" value={detail.user.id} />
                  <TextArea label="Suspend reason" name="reason" required rows={3} />
                  <SubmitButton>Suspend user</SubmitButton>
                </form>
              ) : null}
              {canRestore && detail.user.status === "suspended" ? (
                <form action={restoreAdminUserAction} className="grid gap-3">
                  <input name="user_id" type="hidden" value={detail.user.id} />
                  <TextArea label="Restore reason" name="reason" required rows={3} />
                  <SubmitButton>Restore user</SubmitButton>
                </form>
              ) : null}
              {!canSuspend && !canRestore ? (
                <p className="text-sm text-zinc-600">
                  No account status actions available for your role.
                </p>
              ) : null}
            </div>
          </AdminSection>

          <AdminSection title="Platform Membership">
            <FieldGrid>
              <Field
                label="Role"
                value={detail.platform_membership?.role_name ?? "Not a platform admin"}
              />
              <Field
                label="Status"
                value={
                  detail.platform_membership ? (
                    <StatusBadge value={detail.platform_membership.status} />
                  ) : (
                    "-"
                  )
                }
              />
            </FieldGrid>
          </AdminSection>

          <AdminSection title="Internal Notes">
            {canCreateNotes ? (
              <form action={createAdminNoteAction} className="mb-4 grid gap-3">
                <input name="target_id" type="hidden" value={detail.user.id} />
                <input name="target_type" type="hidden" value="user" />
                <input
                  name="return_path"
                  type="hidden"
                  value={`/admin/users/${detail.user.id}`}
                />
                <TextArea label="New note" name="body" required />
                <SubmitButton>Add note</SubmitButton>
              </form>
            ) : null}
            {notes && notes.items.length > 0 ? (
              <div className="grid gap-3">
                {notes.items.map((note) => (
                  <div
                    className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm"
                    key={note.id}
                  >
                    <p className="whitespace-pre-wrap text-sm text-zinc-800">
                      {note.body}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {note.author?.display_name ?? "Unknown"} -{" "}
                      {formatAdminDateTime(note.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No visible notes" />
            )}
          </AdminSection>
        </aside>
      </div>
    </>
  );
}
