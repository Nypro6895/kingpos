import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type { Location } from "@/types/location";
import type { OrganizationMembershipWithOrganization } from "@/types/membership";
import type { Role } from "@/types/role";
import type { KingUser } from "@/types/user";
import { cookies } from "next/headers";

export const CURRENT_SALON_COOKIE = "kingpos-current-salon-id";

export const ORGANIZATION_SELECT =
  "id, name, legal_name, owner_user_id, status, created_at, updated_at";

export const LOCATION_SELECT =
  "id, organization_id, name, phone, address_line1, address_line2, city, state, postal_code, country, status, created_at, updated_at";

export const ROLE_SELECT =
  "id, organization_id, name, code, description, is_system, created_at, updated_at";

export function isOwnerMembership(
  membership: OrganizationMembershipWithOrganization | null,
) {
  return membership?.role?.code === "OWNER" || membership?.legacy_role === "owner";
}

export type CurrentBusinessContext = {
  currentOrganization: OrganizationMembershipWithOrganization["organization"];
  currentMembership: OrganizationMembershipWithOrganization | null;
  currentSalon: Location | null;
  salons: Location[];
  user: KingUser | null;
};

type OrganizationMembershipRow = Omit<
  OrganizationMembershipWithOrganization,
  "role"
>;

export function isMissingRoleIdColumnError(error: { code?: string; message?: string }) {
  return (
    error.code === "42703" ||
    error.message?.includes("organization_memberships.role_id") === true
  );
}

export function roleFromLegacyRole(
  legacyRole: string | null | undefined,
  organizationId: string,
): Role | null {
  if (!legacyRole) {
    return null;
  }

  const roleNames: Record<string, string> = {
    owner: "Owner",
    admin: "Manager",
    manager: "Manager",
    technician: "Technician",
    receptionist: "Front Desk",
    member: "Front Desk",
  };
  const roleCodes: Record<string, string> = {
    owner: "OWNER",
    admin: "MANAGER",
    manager: "MANAGER",
    technician: "TECHNICIAN",
    receptionist: "FRONT_DESK",
    member: "FRONT_DESK",
  };

  return {
    id: "",
    organization_id: organizationId,
    name: roleNames[legacyRole] ?? legacyRole,
    code: roleCodes[legacyRole] ?? legacyRole.toUpperCase(),
    description: null,
    is_system: true,
    created_at: "",
    updated_at: "",
  };
}

async function loadCurrentMembership() {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const user = await getCurrentKingUser();

  if (!supabase || !user) {
    return { membership: null, user };
  }

  const membershipQuery = supabase
    .from("organization_memberships")
    .select(
      `id, organization_id, user_id, role_id, status, invited_by_user_id, joined_at, created_at, updated_at, organization:organizations(${ORGANIZATION_SELECT})`,
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);

  const { data: memberships, error: membershipError } =
    await membershipQuery.returns<OrganizationMembershipRow[]>();

  if (!membershipError) {
    return { membership: memberships?.[0] ?? null, user };
  }

  if (!isMissingRoleIdColumnError(membershipError)) {
    console.error("Supabase load current organization membership failed", {
      code: membershipError.code,
      message: membershipError.message,
      details: membershipError.details,
      hint: membershipError.hint,
      userId: user.id,
    });
    throw new Error(membershipError.message);
  }

  const { data: legacyMemberships, error: legacyMembershipError } = await supabase
    .from("organization_memberships")
    .select(
      `id, organization_id, user_id, legacy_role:role, status, invited_by_user_id, joined_at, created_at, updated_at, organization:organizations(${ORGANIZATION_SELECT})`,
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .returns<OrganizationMembershipRow[]>();

  if (legacyMembershipError) {
    console.error("Supabase load current organization membership failed", {
      code: legacyMembershipError.code,
      message: legacyMembershipError.message,
      details: legacyMembershipError.details,
      hint: legacyMembershipError.hint,
      userId: user.id,
    });
    throw new Error(legacyMembershipError.message);
  }

  return { membership: legacyMemberships?.[0] ?? null, user };
}

export async function getCurrentBusinessContext(): Promise<CurrentBusinessContext> {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const { membership, user } = await loadCurrentMembership();

  if (!supabase || !user) {
    return {
      currentOrganization: null,
      currentMembership: null,
      currentSalon: null,
      salons: [],
      user,
    };
  }

  let currentMembership: OrganizationMembershipWithOrganization | null = null;

  if (membership) {
    let role = roleFromLegacyRole(membership.legacy_role, membership.organization_id);

    if (membership.role_id) {
      const { data: loadedRole, error: roleError } = await supabase
        .from("roles")
        .select(ROLE_SELECT)
        .eq("id", membership.role_id)
        .eq("organization_id", membership.organization_id)
        .maybeSingle<Role>();

      if (roleError) {
        console.error("Supabase load current membership role failed", {
          code: roleError.code,
          message: roleError.message,
          details: roleError.details,
          hint: roleError.hint,
          roleId: membership.role_id,
          organizationId: membership.organization_id,
          userId: user.id,
        });
        throw new Error(roleError.message);
      }

      role = loadedRole ?? role;
    }

    currentMembership = {
      ...membership,
      role: role ?? null,
    };
  }

  const currentOrganization = currentMembership?.organization ?? null;

  if (!currentOrganization) {
    return {
      currentOrganization: null,
      currentMembership,
      currentSalon: null,
      salons: [],
      user,
    };
  }

  const { data: salons, error: salonsError } = await supabase
    .from("locations")
    .select(LOCATION_SELECT)
    .eq("organization_id", currentOrganization.id)
    .order("created_at", { ascending: true })
    .returns<Location[]>();

  if (salonsError) {
    console.error("Supabase load current organization salons failed", {
      code: salonsError.code,
      message: salonsError.message,
      details: salonsError.details,
      hint: salonsError.hint,
      organizationId: currentOrganization.id,
      userId: user.id,
    });
    throw new Error(salonsError.message);
  }

  const availableSalons = salons ?? [];
  const cookieStore = await cookies();
  const storedSalonId = cookieStore.get(CURRENT_SALON_COOKIE)?.value ?? null;
  const storedSalon = storedSalonId
    ? availableSalons.find((salon) => salon.id === storedSalonId)
    : null;

  return {
    currentOrganization,
    currentMembership,
    currentSalon: storedSalon ?? availableSalons[0] ?? null,
    salons: availableSalons,
    user,
  };
}

export async function setCurrentSalonCookie(salonId: string) {
  const cookieStore = await cookies();

  cookieStore.set(CURRENT_SALON_COOKIE, salonId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
