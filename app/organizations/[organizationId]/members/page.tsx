import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { ROLE_SELECT } from "@/lib/current-context";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { OrganizationMember } from "@/types/membership";
import type { Organization } from "@/types/organization";
import type { Role } from "@/types/role";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

const ORGANIZATION_SELECT =
  "id, name, legal_name, owner_user_id, status, created_at, updated_at";

type OrganizationMembersPageProps = {
  params: Promise<{
    organizationId: string;
  }>;
};

type OrganizationMemberRow = Omit<OrganizationMember, "role">;

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not joined";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function MemberName({ member }: { member: OrganizationMember }) {
  const displayName = member.user?.display_name || member.user?.email || "Unnamed user";

  return (
    <div>
      <p className="font-medium text-zinc-950">{displayName}</p>
      <p className="mt-1 text-sm text-zinc-500">{member.user?.email || "No email"}</p>
    </div>
  );
}

function MembersTable({ members }: { members: OrganizationMember[] }) {
  if (members.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No members found</h2>
        <p className="mt-2 text-sm text-zinc-600">
          This organization does not have visible memberships yet.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-5">Member</div>
        <div className="hidden sm:col-span-2 sm:block">Role</div>
        <div className="hidden sm:col-span-2 sm:block">Status</div>
        <div className="hidden sm:col-span-3 sm:block">Joined</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {members.map((member) => (
          <li className="grid grid-cols-12 gap-3 px-5 py-4" key={member.id}>
            <div className="col-span-12 sm:col-span-5">
              <MemberName member={member} />
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
              <span className="font-medium text-zinc-500 sm:hidden">Role: </span>
              {member.role?.name ?? "No role"}
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
              <span className="font-medium text-zinc-500 sm:hidden">Status: </span>
              {formatLabel(member.status)}
            </div>
            <div className="col-span-12 self-center text-sm text-zinc-600 sm:col-span-3">
              <span className="font-medium text-zinc-500 sm:hidden">Joined: </span>
              {formatDateTime(member.joined_at)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function OrganizationMembersPage({
  params,
}: OrganizationMembersPageProps) {
  const [{ organizationId }, user] = await Promise.all([params, getCurrentKingUser()]);

  if (!user) {
    redirect("/login");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select(ORGANIZATION_SELECT)
    .eq("id", organizationId)
    .maybeSingle<Organization>();

  if (organizationError) {
    console.error("Supabase load organization failed for members page", {
      code: organizationError.code,
      message: organizationError.message,
      details: organizationError.details,
      hint: organizationError.hint,
      organizationId,
      userId: user.id,
    });
    throw new Error(organizationError.message);
  }

  if (!organization) {
    notFound();
  }

  const { data: members, error: membersError } = await supabase
    .from("organization_memberships")
    .select(
      "id, organization_id, user_id, role_id, status, invited_by_user_id, joined_at, created_at, updated_at, user:users!organization_memberships_user_id_fkey(id, display_name, email)",
    )
    .eq("organization_id", organization.id)
    .order("created_at", { ascending: true })
    .returns<OrganizationMemberRow[]>();

  if (membersError) {
    console.error("Supabase load organization members failed", {
      code: membersError.code,
      message: membersError.message,
      details: membersError.details,
      hint: membersError.hint,
      organizationId: organization.id,
      userId: user.id,
    });
    throw new Error(membersError.message);
  }

  const roleIds = Array.from(
    new Set(
      (members ?? [])
        .map((member) => member.role_id)
        .filter((roleId): roleId is string => Boolean(roleId)),
    ),
  );
  const { data: roles, error: rolesError } =
    roleIds.length > 0
      ? await supabase.from("roles").select(ROLE_SELECT).in("id", roleIds).returns<Role[]>()
      : { data: [], error: null };

  if (rolesError) {
    console.error("Supabase load organization member roles failed", {
      code: rolesError.code,
      message: rolesError.message,
      details: rolesError.details,
      hint: rolesError.hint,
      organizationId: organization.id,
      userId: user.id,
    });
    throw new Error(rolesError.message);
  }

  const roleById = new Map((roles ?? []).map((role) => [role.id, role]));
  const membersWithRoles = (members ?? []).map((member) => ({
    ...member,
    role: member.role_id ? (roleById.get(member.role_id) ?? null) : null,
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500">Organization members</p>
          <h1 className="mt-1 text-3xl font-semibold text-zinc-950">
            {organization.name}
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Read-only membership list for this organization.
          </p>
        </div>
        <Link
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
          href="/organizations"
        >
          Back to organizations
        </Link>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Members</h2>
        <MembersTable members={membersWithRoles} />
      </section>
    </main>
  );
}
