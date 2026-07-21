import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import {
  isMissingRoleIdColumnError,
  roleFromLegacyRole,
  ROLE_SELECT,
  setCurrentOrganizationCookie,
} from "@/lib/current-context";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { OrganizationMembershipWithOrganization } from "@/types/membership";
import type { Organization } from "@/types/organization";
import type { Role } from "@/types/role";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

const ORGANIZATION_SELECT =
  "id, name, legal_name, owner_user_id, status, created_at, updated_at";

type OrganizationMembershipRow = Omit<
  OrganizationMembershipWithOrganization,
  "role"
>;

function readRequiredString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readOptionalString(formData: FormData, key: string) {
  const value = readRequiredString(formData, key);
  return value || null;
}

function redirectWithError(message: string): never {
  redirect(`/organizations?error=${encodeURIComponent(message)}`);
}

async function createOrganization(formData: FormData) {
  "use server";

  const supabase = await createAuthenticatedSupabaseServerClient();
  const user = await getCurrentKingUser();

  if (!supabase || !user) {
    redirect("/login");
  }

  const name = readRequiredString(formData, "name");

  if (!name) {
    redirectWithError("Organization name is required.");
  }

  console.log("Creating organization", {
    ownerUserId: user.id,
    authUserId: user.auth_user_id,
    ownerUserIdSource: "public.users.id",
  });

  const { data: organization, error } = await supabase
    .from("organizations")
    .insert({
      name,
      legal_name: readOptionalString(formData, "legal_name"),
      owner_user_id: user.id,
      status: "active",
    })
    .select(ORGANIZATION_SELECT)
    .single<Organization>();

  if (error) {
    console.error("Supabase create organization failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      ownerUserId: user.id,
      authUserId: user.auth_user_id,
    });
    redirectWithError(error.message);
  }

  if (!organization) {
    console.error("Supabase create organization returned no data", {
      ownerUserId: user.id,
      authUserId: user.auth_user_id,
    });
    redirectWithError("Organization was not created.");
  }

  const { data: ownerRole, error: ownerRoleError } = await supabase
    .from("roles")
    .select(ROLE_SELECT)
    .eq("organization_id", organization.id)
    .eq("code", "OWNER")
    .maybeSingle();

  if (ownerRoleError || !ownerRole) {
    console.error("Supabase load owner role failed", {
      code: ownerRoleError?.code,
      message: ownerRoleError?.message,
      details: ownerRoleError?.details,
      hint: ownerRoleError?.hint,
      organizationId: organization.id,
      ownerUserId: user.id,
      authUserId: user.auth_user_id,
    });
    redirectWithError(
      ownerRoleError?.message || "Organization created, but Owner role was not found.",
    );
  }

  const { error: membershipError } = await supabase
    .from("organization_memberships")
    .insert({
      organization_id: organization.id,
      user_id: user.id,
      role_id: ownerRole.id,
      role: "owner",
      status: "active",
      joined_at: new Date().toISOString(),
    });

  if (membershipError) {
    console.error("Supabase create owner membership failed", {
      code: membershipError.code,
      message: membershipError.message,
      details: membershipError.details,
      hint: membershipError.hint,
      organizationId: organization.id,
      ownerUserId: user.id,
      authUserId: user.auth_user_id,
    });
    redirectWithError(
      `Organization created, but owner membership failed: ${membershipError.message}`,
    );
  }

  await setCurrentOrganizationCookie(organization.id);
  revalidatePath("/organizations");
  revalidatePath("/", "layout");
  redirect("/organizations");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatNullableDate(value: string | null) {
  return value ? formatDate(value) : "Not joined";
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function LoginLinks() {
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <Link
        className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
        href="/login"
      >
        Login
      </Link>
      <Link
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
        href="/signup"
      >
        Sign up
      </Link>
    </div>
  );
}

function OrganizationForm() {
  return (
    <form
      action={createOrganization}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">Organization name</span>
        <input
          autoComplete="organization"
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="name"
          placeholder="Happy Nails LLC"
          required
          type="text"
        />
      </label>

      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">Legal name optional</span>
        <input
          autoComplete="organization"
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="legal_name"
          placeholder="Happy Nails Limited Liability Company"
          type="text"
        />
      </label>

      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Create organization
        </button>
      </div>
    </form>
  );
}

function OrganizationList({
  memberships,
}: {
  memberships: OrganizationMembershipWithOrganization[];
}) {
  if (memberships.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No organizations yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Create your first business profile before adding Salons or teams later.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-5">Organization</div>
        <div className="hidden sm:col-span-2 sm:block">Role</div>
        <div className="hidden sm:col-span-2 sm:block">Status</div>
        <div className="hidden sm:col-span-2 sm:block">Joined</div>
        <div className="hidden sm:col-span-1 sm:block">Members</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {memberships.map((membership) => {
          const organization = membership.organization;

          if (!organization) {
            return null;
          }

          return (
            <li className="grid grid-cols-12 gap-3 px-5 py-4" key={membership.id}>
              <div className="col-span-12 sm:col-span-5">
              <p className="font-medium text-zinc-950">{organization.name}</p>
              <p className="mt-1 text-sm text-zinc-500">
                {organization.legal_name || "No legal name"}
              </p>
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
              <span className="font-medium text-zinc-500 sm:hidden">Role: </span>
              {membership.role?.name ?? "No role"}
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
              <span className="font-medium text-zinc-500 sm:hidden">Status: </span>
              {formatLabel(membership.status)}
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-600 sm:col-span-2">
              <span className="font-medium text-zinc-500 sm:hidden">Joined: </span>
              {formatNullableDate(membership.joined_at)}
            </div>
            <div className="col-span-6 self-center text-sm sm:col-span-1">
              <Link
                className="font-medium text-zinc-950 underline decoration-zinc-300 underline-offset-4"
                href={`/organizations/${organization.id}/members`}
              >
                View members
              </Link>
            </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type OrganizationsPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function OrganizationsPage({ searchParams }: OrganizationsPageProps) {
  const [{ error }, user] = await Promise.all([searchParams, getCurrentKingUser()]);

  if (!user) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-semibold text-zinc-950">Organizations</h1>
        <p className="mt-4 text-zinc-700">
          Login or create an account to manage your business organizations.
        </p>
        <LoginLinks />
      </main>
    );
  }

  const supabase = await createAuthenticatedSupabaseServerClient();
  let data: OrganizationMembershipRow[] | null = null;
  let membershipsError: Error | null = null;
  let roleIdColumnExists = true;

  if (supabase) {
    const membershipsResult = await supabase
      .from("organization_memberships")
      .select(
        `id, organization_id, user_id, role_id, status, invited_by_user_id, joined_at, created_at, updated_at, organization:organizations(${ORGANIZATION_SELECT})`,
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .returns<OrganizationMembershipRow[]>();

    data = membershipsResult.data;
    membershipsError = membershipsResult.error;

    if (membershipsError && isMissingRoleIdColumnError(membershipsError)) {
      roleIdColumnExists = false;

      const legacyMembershipsResult = await supabase
        .from("organization_memberships")
        .select(
          `id, organization_id, user_id, legacy_role:role, status, invited_by_user_id, joined_at, created_at, updated_at, organization:organizations(${ORGANIZATION_SELECT})`,
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .returns<OrganizationMembershipRow[]>();

      data = legacyMembershipsResult.data;
      membershipsError = legacyMembershipsResult.error;
    }
  } else {
    membershipsError = new Error("Supabase environment variables are missing.");
  }

  if (membershipsError) {
    console.error("Supabase load organization memberships failed", {
      message: membershipsError.message,
      userId: user.id,
    });
    throw new Error(membershipsError.message);
  }

  const roleIds = roleIdColumnExists
    ? Array.from(
        new Set(
          (data ?? [])
            .map((membership) => membership.role_id)
            .filter((roleId): roleId is string => Boolean(roleId)),
        ),
      )
    : [];
  const { data: roles, error: rolesError } =
    supabase && roleIds.length > 0
      ? await supabase.from("roles").select(ROLE_SELECT).in("id", roleIds).returns<Role[]>()
      : { data: [], error: null };

  if (rolesError) {
    console.error("Supabase load organization membership roles failed", {
      code: rolesError.code,
      message: rolesError.message,
      details: rolesError.details,
      hint: rolesError.hint,
      userId: user.id,
    });
    throw new Error(rolesError.message);
  }

  const roleById = new Map((roles ?? []).map((role) => [role.id, role]));
  const memberships = (data ?? []).map((membership) => ({
    ...membership,
    role: membership.role_id
      ? (roleById.get(membership.role_id) ?? null)
      : roleFromLegacyRole(membership.legacy_role, membership.organization_id),
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500">KingPOS Platform</p>
          <h1 className="mt-1 text-3xl font-semibold text-zinc-950">Organizations</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Manage the businesses you own before Salons and teams are added.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/salons"
          >
            Salons
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/permissions"
          >
            Permissions
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/account"
          >
            Account
          </Link>
        </div>
      </div>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Your organizations</h2>
        <OrganizationList memberships={memberships} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-950">Create organization</h2>
        <OrganizationForm />
      </section>
    </main>
  );
}
