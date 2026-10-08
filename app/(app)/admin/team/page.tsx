import Link from "next/link";
import { EntityPicker } from "../_components/entity-picker";
import { AdminActionForm } from "@/app/(app)/admin/_components/action-form";
import {
  createAdminTeamMembershipAction,
  updateAdminTeamMembershipAction,
} from "@/app/(app)/admin/actions";
import {
  AdminPageHeader,
  AdminSection,
  AdminTable,
  EmptyState,
  Pagination,
  SearchForm,
  SelectInput,
  StatusBadge,
  SubmitButton,
  TextArea,
  TextInput,
  formatAdminDateTime,
  hasAdminPermission,
} from "@/app/(app)/admin/_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { listPlatformAdminTeam } from "@/lib/platform-admin/team";

type TeamPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ROLE_OPTIONS = [
  { label: "Platform Owner", value: "platform_owner" },
  { label: "Operations Admin", value: "operations_admin" },
  { label: "Support Agent", value: "support_agent" },
  { label: "Moderator", value: "moderator" },
  { label: "Auditor", value: "auditor" },
];

export default async function AdminTeamPage({ searchParams }: TeamPageProps) {
  const context = await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.teamRead);
  const params = await searchParams;
  const team = await listPlatformAdminTeam({
    page: params.page,
    pageSize: params.pageSize,
    q: params.q,
    role: params.role,
    status: params.status,
  });
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const role = Array.isArray(params.role) ? params.role[0] : params.role;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;
  const canManage = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.teamManage,
  );

  return (
    <>
      <AdminPageHeader eyebrow="Team" title="Platform Admin Team">
        Independent platform admin membership. Tenant owners are not platform
        admins unless explicitly added here.
      </AdminPageHeader>

      <SearchForm defaultQuery={query}>
        <SelectInput
          defaultValue={role ?? ""}
          label="Role"
          name="role"
          options={[{ label: "Any role", value: "" }, ...ROLE_OPTIONS]}
        />
        <SelectInput
          defaultValue={status ?? ""}
          label="Status"
          name="status"
          options={[
            { label: "Any status", value: "" },
            { label: "Active", value: "active" },
            { label: "Suspended", value: "suspended" },
            { label: "Revoked", value: "revoked" },
          ]}
        />
      </SearchForm>

      <AdminSection title="Members">
        {team.items.length === 0 ? (
          <EmptyState title="No platform admin members found" />
        ) : (
          <AdminTable
            columns={
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-3">User</div>
                <div className="col-span-2">Role</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">User status</div>
                <div className="col-span-3">Updated</div>
              </div>
            }
          >
            {team.items.map((member) => (
              <div
                className="grid gap-4 px-4 py-4 md:grid-cols-12 md:items-start"
                key={member.id}
              >
                <div className="md:col-span-3">
                  <Link href={`/admin/users/${member.user_id}`} className="font-semibold text-orange-700">
                    {member.user_display_name ?? member.user_email ?? member.user_id}
                  </Link>
                  <p className="mt-1 break-all text-xs text-zinc-500">
                    {member.user_email ?? member.user_id}
                  </p>
                </div>
                <div className="text-sm text-zinc-700 md:col-span-2">
                  {member.role_name}
                </div>
                <div className="md:col-span-2">
                  <StatusBadge value={member.status} />
                </div>
                <div className="md:col-span-2">
                  <StatusBadge value={member.user_status} />
                </div>
                <div className="text-sm text-zinc-600 md:col-span-3">
                  {formatAdminDateTime(member.updated_at)}
                </div>
                {canManage ? (
                  <AdminActionForm
                    action={updateAdminTeamMembershipAction}
                    className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 md:col-span-12 md:grid-cols-4 md:items-end"
                  >
                    <input name="membership_id" type="hidden" value={member.id} />
                    <SelectInput
                      defaultValue={member.role_slug}
                      label="Role"
                      name="role_slug"
                      options={ROLE_OPTIONS}
                    />
                    <SelectInput
                      defaultValue={member.status}
                      label="Membership status"
                      name="status"
                      options={[
                        { label: "Active", value: "active" },
                        { label: "Suspended", value: "suspended" },
                        { label: "Revoked", value: "revoked" },
                      ]}
                    />
                    <TextInput label="Reason" name="reason" required />
                    <SubmitButton>Save member</SubmitButton>
                  </AdminActionForm>
                ) : null}
              </div>
            ))}
          </AdminTable>
        )}
        <Pagination
          basePath="/admin/team"
          page={team.page}
          pageSize={team.page_size}
          query={{ q: query ?? null, role: role ?? null, status: status ?? null }}
          total={team.total}
        />
      </AdminSection>

      {canManage ? (
        <AdminSection title="Add Existing User">
          <AdminActionForm
            action={createAdminTeamMembershipAction}
            className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm lg:grid-cols-3"
          >
            <EntityPicker kind="user" label="Existing user" name="user_id" required/>
            <SelectInput
              defaultValue="support_agent"
              label="Role"
              name="role_slug"
              options={ROLE_OPTIONS}
            />
            <TextArea label="Reason" name="reason" required rows={3} />
            <div className="lg:col-span-3">
              <SubmitButton>Add platform admin</SubmitButton>
            </div>
          </AdminActionForm>
        </AdminSection>
      ) : null}
    </>
  );
}
