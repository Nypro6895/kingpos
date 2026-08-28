import { ROLE_SELECT } from "@/lib/current-context";
import { getAccountPermissionSet } from "@/lib/permissions";
import { requireAccountPageContext } from "@/lib/route-context-guards";
import { routes } from "@/lib/routes";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { Permission } from "@/types/permission";
import type { Role } from "@/types/role";
import Link from "next/link";
import { redirect } from "next/navigation";

const CATEGORY_ORDER = [
  "Account",
  "Business",
  "Members",
  "Roles",
  "Customers",
  "Staff",
  "Services",
  "Booking",
  "Tickets",
  "Payroll",
  "Reports",
  "Settings",
];

function groupPermissionsByCategory(permissions: Permission[]) {
  const groupedPermissions = new Map<string, Permission[]>();

  for (const permission of permissions) {
    const categoryPermissions = groupedPermissions.get(permission.category) ?? [];
    categoryPermissions.push(permission);
    groupedPermissions.set(permission.category, categoryPermissions);
  }

  return Array.from(groupedPermissions.entries()).sort(
    ([leftCategory], [rightCategory]) => {
      const leftIndex = CATEGORY_ORDER.indexOf(leftCategory);
      const rightIndex = CATEGORY_ORDER.indexOf(rightCategory);

      if (leftIndex === -1 && rightIndex === -1) {
        return leftCategory.localeCompare(rightCategory);
      }

      if (leftIndex === -1) {
        return 1;
      }

      if (rightIndex === -1) {
        return -1;
      }

      return leftIndex - rightIndex;
    },
  );
}

function displayCategory(category: string) {
  if (category === "Account") {
    return "Account";
  }

  if (category === "Business" || category === "Salon") {
    return "Salon";
  }

  return category;
}

function EmptyBusinessState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">Choose a salon first</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Permissions are assigned to roles for the current Account and salon.
        </p>
        <Link
          className="mt-5 inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          href={routes.salons.list()}
        >
          Go to Salons
        </Link>
      </div>
    </main>
  );
}

function PermissionCatalog({ permissions }: { permissions: Permission[] }) {
  const groupedPermissions = groupPermissionsByCategory(permissions);

  if (permissions.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No permissions found</h2>
        <p className="mt-2 text-sm text-zinc-600">
          System permissions will appear here once the permission foundation is seeded.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      {groupedPermissions.map(([category, categoryPermissions]) => (
        <section
          className="rounded-lg border border-zinc-200 bg-white p-5"
          key={category}
        >
          <h3 className="text-sm font-semibold uppercase tracking-normal text-zinc-500">
            {displayCategory(category)}
          </h3>
          <ul className="mt-4 space-y-3">
            {categoryPermissions.map((permission) => (
              <li key={permission.id}>
                <p className="text-sm font-medium text-zinc-950">{permission.name}</p>
                <p className="mt-1 text-xs text-zinc-500">{permission.description}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RolePermissionList({
  roles,
}: {
  roles: Array<Role & { permissions: Permission[] }>;
}) {
  if (roles.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No roles found</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Default roles need to be seeded before permissions can be shown by role.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {roles.map((role) => (
        <section className="rounded-lg border border-zinc-200 bg-white p-5" key={role.id}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 pb-4">
            <div>
              <h3 className="text-lg font-semibold text-zinc-950">{role.name}</h3>
              <p className="mt-1 text-sm text-zinc-600">{role.description}</p>
            </div>
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
              {role.permissions.length} permissions
            </span>
          </div>

          {role.permissions.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {role.permissions.map((permission) => (
                <li
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-700"
                  key={permission.id}
                >
                  {permission.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-zinc-600">
              No permissions are assigned to this role yet.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

export default async function PermissionsPage() {
  const context = await requireAccountPageContext("/permissions");

  if (!context.user) {
    redirect("/login");
  }

  const account = context.currentAccount;

  if (!account || !context.accountId) {
    return <EmptyBusinessState />;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: roles, error: rolesError } = await supabase
    .from("roles")
    .select(ROLE_SELECT)
    .eq("account_id", context.accountId)
    .order("is_system", { ascending: false })
    .order("created_at", { ascending: true })
    .returns<Role[]>();

  if (rolesError) {
    console.error("Supabase load roles for permissions page failed", {
      code: rolesError.code,
      message: rolesError.message,
      details: rolesError.details,
      hint: rolesError.hint,
      accountId: context.accountId,
      userId: context.user.id,
    });
    throw new Error(rolesError.message);
  }

  const permissionSet = await getAccountPermissionSet(account.id, roles ?? []);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap justify-end gap-3">
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/roles"
          >
            Roles
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href={routes.salons.list()}
          >
            Salons
          </Link>
        </div>
      </div>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-zinc-950">
          Role permissions for {account.name}
        </h2>
        <RolePermissionList roles={permissionSet.roles} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-950">Permission catalog</h2>
        <PermissionCatalog permissions={permissionSet.permissions} />
      </section>
    </main>
  );
}
