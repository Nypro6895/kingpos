import Link from "next/link";
import { EntityPicker } from "../_components/entity-picker";
import {
  AdminPageHeader,
  AdminTable,
  EmptyState,
  Pagination,
  SearchForm,
  SelectInput,
  StatusBadge,
  formatAdminDateTime,
  SecondaryLink,
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
    role: params.role,
    businessId: params.businessId,
    sort: params.sort,
  });
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;
  const role = Array.isArray(params.role) ? params.role[0] : params.role;
  const businessId = Array.isArray(params.businessId) ? params.businessId[0] : params.businessId;
  const sort = Array.isArray(params.sort) ? params.sort[0] : params.sort;
  const exportParams = new URLSearchParams();
  for (const [key,value] of Object.entries({ q:query, status, role, businessId, sort })) if (value) exportParams.set(key,value);

  return (
    <>
      <AdminPageHeader eyebrow="Platform management" title="Users" actions={<SecondaryLink href={`/admin/users/export?${exportParams}`}>Export CSV</SecondaryLink>}>
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
            { label: "Pending deletion", value: "pending_deletion" },
            { label: "Deleted", value: "deleted" },
          ]}
        />
        <SelectInput defaultValue={role ?? ""} label="Business role" name="role" options={[{label:"All roles",value:""},{label:"Owner",value:"owner"},{label:"Manager",value:"manager"},{label:"Staff",value:"staff"},{label:"Customer / no business membership",value:"customer"},{label:"Platform admin",value:"platform_admin"}]}/>
        <EntityPicker kind="business" label="Business" name="businessId" defaultValue={businessId} defaultLabel={businessId ? "Selected business" : ""}/>
        <SelectInput defaultValue={sort ?? "created_desc"} label="Sort by" name="sort" options={[{label:"Newest accounts",value:"created_desc"},{label:"Name A–Z",value:"name_asc"},{label:"Last login",value:"last_login_desc"}]}/>
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
                  <Link href={`/admin/users/${user.id}`} className="font-semibold text-zinc-950 hover:text-orange-700">
                    {user.display_name ?? user.email ?? "Unnamed user"}
                  </Link>
                  <p className="mt-1 break-all text-xs text-zinc-500">
                    {user.email ?? user.id}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <StatusBadge value={user.status} />
                </div>
                <div className="text-sm text-zinc-600 md:col-span-2">
                  {user.businesses?.length ? <div className="grid gap-1">{user.businesses.slice(0,2).map(business => <Link key={business.id} href={`/admin/businesses/${business.id}`} className="text-orange-700 hover:underline">{business.name}</Link>)}<span className="text-xs text-zinc-500">{user.roles?.join(", ")}</span>{user.businesses.length>2 && <span className="text-xs">+{user.businesses.length-2} more</span>}</div> : "No business"}
                </div>
                <div className="text-sm text-zinc-600 md:col-span-3">
                  <p>{formatAdminDateTime(user.created_at)}</p><p className="mt-1 text-xs">Last login: {formatAdminDateTime(user.last_login_at)}</p>
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
          query={{ q: query ?? null, status: status ?? null, role, businessId, sort }}
          total={users.total}
        />
      </div>
    </>
  );
}
