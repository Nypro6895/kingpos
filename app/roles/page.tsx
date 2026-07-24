import { ROLE_SELECT } from "@/lib/current-context";
import { requireAccountPageContext } from "@/lib/route-context-guards";
import { routes } from "@/lib/routes";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { Role } from "@/types/role";
import type { RoleWithMemberCount } from "@/types/role";
import Link from "next/link";
import { redirect } from "next/navigation";

function RoleBadge({ isSystem }: { isSystem: boolean }) {
  return (
    <span
      className={
        isSystem
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      {isSystem ? "System" : "Custom"}
    </span>
  );
}

function RolesTable({ roles }: { roles: RoleWithMemberCount[] }) {
  if (roles.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No roles found</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Default system roles will appear here once this Account is seeded.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-3">Role Name</div>
        <div className="hidden sm:col-span-5 sm:block">Description</div>
        <div className="hidden sm:col-span-2 sm:block">Type</div>
        <div className="hidden sm:col-span-2 sm:block">Members</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {roles.map((role) => (
          <li className="grid grid-cols-12 gap-3 px-5 py-4" key={role.id}>
            <div className="col-span-12 sm:col-span-3">
              <p className="font-medium text-zinc-950">{role.name}</p>
              <p className="mt-1 text-xs font-medium text-zinc-500">{role.code}</p>
            </div>
            <div className="col-span-12 self-center text-sm text-zinc-600 sm:col-span-5">
              <span className="font-medium text-zinc-500 sm:hidden">Description: </span>
              {role.description || "No description"}
            </div>
            <div className="col-span-6 self-center sm:col-span-2">
              <RoleBadge isSystem={role.is_system} />
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
              <span className="font-medium text-zinc-500 sm:hidden">Members: </span>
              {role.member_count}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function RolesPage() {
  const context = await requireAccountPageContext("/roles");

  if (!context.user) {
    redirect("/login?next=/roles");
  }

  const account = context.currentAccount;

  if (!account || !context.accountId) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-sm font-medium text-zinc-500">KITY Platform</p>
        <h1 className="mt-1 text-3xl font-semibold text-zinc-950">Roles</h1>
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
          <h2 className="text-lg font-semibold text-zinc-950">Choose a salon first</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Roles belong to the Account behind the current salon.
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

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("roles")
    .select(ROLE_SELECT)
    .eq("account_id", context.accountId)
    .order("is_system", { ascending: false })
    .order("created_at", { ascending: true })
    .returns<Role[]>();

  if (error) {
    console.error("Supabase load roles failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      accountId: context.accountId,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("account_memberships")
    .select("role_id")
    .eq("account_id", context.accountId)
    .neq("status", "removed")
    .returns<{ role_id: string }[]>();

  if (membershipsError) {
    console.error("Supabase load role membership counts failed", {
      code: membershipsError.code,
      message: membershipsError.message,
      details: membershipsError.details,
      hint: membershipsError.hint,
      accountId: context.accountId,
      userId: context.user.id,
    });
    throw new Error(membershipsError.message);
  }

  const memberCountByRoleId = new Map<string, number>();

  for (const membership of memberships ?? []) {
    memberCountByRoleId.set(
      membership.role_id,
      (memberCountByRoleId.get(membership.role_id) ?? 0) + 1,
    );
  }

  const roles =
    data?.map((role) => ({
      ...role,
      member_count: memberCountByRoleId.get(role.id) ?? 0,
    })) ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500">KITY Platform</p>
          <h1 className="mt-1 text-3xl font-semibold text-zinc-950">Roles</h1>
          <p className="mt-2 text-sm text-zinc-600">
            View the role foundation for {account.name}.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/permissions"
          >
            Permissions
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href={routes.salons.list()}
          >
            Salons
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/account"
          >
            Accounts
          </Link>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Account Roles</h2>
        <RolesTable roles={roles} />
      </section>
    </main>
  );
}
