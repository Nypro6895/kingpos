import Link from "next/link";
import {
  AdminPageHeader,
  AdminTable,
  EmptyState,
  Pagination,
  SearchForm,
  SelectInput,
  StatusBadge,
  formatAdminDateTime,
} from "@/app/(app)/admin/_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { searchPlatformAdminUsers } from "@/lib/platform-admin/users";

type UsersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminUsersPage({ searchParams }: UsersPageProps) {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.usersRead);
  const params = await searchParams;
  const users = await searchPlatformAdminUsers({
    page: params.page,
    pageSize: params.pageSize,
    q: params.q,
    status: params.status,
  });
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;

  return (
    <>
      <AdminPageHeader eyebrow="Accounts" title="Users">
        Search platform users and open account details. Sensitive fields only
        appear for roles with explicit permission.
      </AdminPageHeader>

      <SearchForm defaultQuery={query}>
        <SelectInput
          defaultValue={status ?? ""}
          label="Status"
          name="status"
          options={[
            { label: "Any status", value: "" },
            { label: "Active", value: "active" },
            { label: "Inactive", value: "inactive" },
            { label: "Suspended", value: "suspended" },
            { label: "Deleted", value: "deleted" },
          ]}
        />
      </SearchForm>

      <div className="mt-6">
        {users.items.length === 0 ? (
          <EmptyState title="No users found" />
        ) : (
          <AdminTable
            columns={
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">User</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Organizations</div>
                <div className="col-span-3">Created</div>
                <div className="col-span-1 text-right">Open</div>
              </div>
            }
          >
            {users.items.map((user) => (
              <div
                className="grid gap-3 px-4 py-4 md:grid-cols-12 md:items-center"
                key={user.id}
              >
                <div className="md:col-span-4">
                  <p className="font-bold text-zinc-950">
                    {user.display_name ?? user.email ?? "Unnamed user"}
                  </p>
                  <p className="mt-1 break-all text-xs text-zinc-500">
                    {user.email ?? user.id}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <StatusBadge value={user.status} />
                </div>
                <div className="text-sm text-zinc-600 md:col-span-2">
                  {user.organization_count}
                </div>
                <div className="text-sm text-zinc-600 md:col-span-3">
                  {formatAdminDateTime(user.created_at)}
                </div>
                <div className="md:col-span-1 md:text-right">
                  <Link
                    className="text-sm font-bold text-orange-700 hover:text-orange-800"
                    href={`/admin/users/${user.id}`}
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </AdminTable>
        )}
        <Pagination
          basePath="/admin/users"
          page={users.page}
          pageSize={users.page_size}
          query={{ q: query ?? null, status: status ?? null }}
          total={users.total}
        />
      </div>
    </>
  );
}
