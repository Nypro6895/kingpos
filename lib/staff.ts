import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { CreateStaffInput, Staff } from "@/types/staff";
import type { KingUser } from "@/types/user";

export const STAFF_SELECT =
  "id, organization_id, salon_id, account_user_id, user_id, display_name, first_name, last_name, phone, email, job_title, is_active, created_at, updated_at";

const STAFF_PAYROLL_SETUP_SELECT = "id, staff_id, effective_from, effective_to";

export const STAFF_PERMISSIONS = {
  view: "staff.view",
  manage: "staff.manage",
} as const;

const PAYROLL_SETUP_PERMISSIONS = [
  "payroll.view",
  "payroll.manage",
  "payroll.tax_company",
] as const;

export type StaffPayrollSetupStatus = "configured" | "missing" | "restricted";

export type StaffConnectedUser = Pick<
  KingUser,
  | "auth_user_id"
  | "created_at"
  | "display_name"
  | "email"
  | "id"
  | "last_login_at"
  | "phone"
  | "status"
>;

export type StaffDirectoryMember = Staff & {
  connected_user: StaffConnectedUser | null;
  payroll_setup_id: string | null;
  payroll_setup_status: StaffPayrollSetupStatus;
};

type StaffPayrollSetupRow = {
  effective_from: string;
  effective_to: string | null;
  id: string;
  staff_id: string;
};

const STAFF_CONNECTED_USER_SELECT =
  "id, auth_user_id, email, phone, display_name, status, last_login_at, created_at";

function requireCurrentOrganizationAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open staff management from a Manage Salon workspace.");
  }

  if (!context.currentOrganization) {
    throw new Error("Create an organization before managing staff.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    organization: context.currentOrganization,
    salon: context.currentSalon,
  };
}

export async function getCurrentSalonStaff() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, staff: [] };
  }

  await requirePermission(STAFF_PERMISSIONS.view, context);

  const { salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("staff")
    .select(STAFF_SELECT)
    .eq("salon_id", salon.id)
    .order("created_at", { ascending: false })
    .returns<Staff[]>();

  if (error) {
    console.error("Supabase load staff failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      organizationId: context.currentOrganization?.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  return { context, staff: data ?? [] };
}

export async function getCurrentSalonStaffDirectory(
  context?: CurrentBusinessContext,
) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    return {
      canViewPayrollSetup: false,
      context: resolvedContext,
      staff: [] as StaffDirectoryMember[],
    };
  }

  await requirePermission(STAFF_PERMISSIONS.view, resolvedContext);

  const { organization, salon } = requireCurrentOrganizationAndSalon(resolvedContext);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const payrollPermissionResults = await Promise.all(
    PAYROLL_SETUP_PERMISSIONS.map((permission) =>
      hasPermission(permission, resolvedContext),
    ),
  );
  const canViewPayrollSetup = payrollPermissionResults.some(Boolean);
  const staffQuery = supabase
    .from("staff")
    .select(STAFF_SELECT)
    .eq("organization_id", organization.id)
    .eq("salon_id", salon.id)
    .order("display_name", { ascending: true })
    .returns<Staff[]>();

  const payrollQuery = canViewPayrollSetup
    ? supabase
        .from("staff_payroll_settings")
        .select(STAFF_PAYROLL_SETUP_SELECT)
        .eq("organization_id", organization.id)
        .eq("salon_id", salon.id)
        .order("effective_from", { ascending: false })
        .returns<StaffPayrollSetupRow[]>()
    : Promise.resolve({ data: [] as StaffPayrollSetupRow[], error: null });

  const [staffResult, payrollResult] = await Promise.all([staffQuery, payrollQuery]);

  if (staffResult.error) {
    console.error("Supabase load staff directory failed", {
      code: staffResult.error.code,
      message: staffResult.error.message,
      details: staffResult.error.details,
      hint: staffResult.error.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(staffResult.error.message);
  }

  if (payrollResult.error) {
    console.error("Supabase load staff payroll setup failed", {
      code: payrollResult.error.code,
      message: payrollResult.error.message,
      details: payrollResult.error.details,
      hint: payrollResult.error.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(payrollResult.error.message);
  }

  const payrollSetupByStaffId = new Map<string, StaffPayrollSetupRow>();

  for (const setup of payrollResult.data ?? []) {
    if (!payrollSetupByStaffId.has(setup.staff_id)) {
      payrollSetupByStaffId.set(setup.staff_id, setup);
    }
  }

  const connectedAccountUserIds = Array.from(
    new Set(
      (staffResult.data ?? [])
        .map((member) => member.account_user_id)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  );
  const connectedLegacyAuthUserIds = Array.from(
    new Set(
      (staffResult.data ?? [])
        .map((member) => member.user_id)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  );
  const connectedUsersById = new Map<string, StaffConnectedUser>();
  const connectedUsersByAuthId = new Map<string, StaffConnectedUser>();

  if (connectedAccountUserIds.length > 0) {
    const { data: connectedUsers, error: connectedUsersError } = await supabase
      .from("users")
      .select(STAFF_CONNECTED_USER_SELECT)
      .in("id", connectedAccountUserIds)
      .returns<StaffConnectedUser[]>();

    if (connectedUsersError) {
      console.error("Supabase load connected staff account users failed", {
        code: connectedUsersError.code,
        message: connectedUsersError.message,
        details: connectedUsersError.details,
        hint: connectedUsersError.hint,
        salonId: salon.id,
        organizationId: organization.id,
        userId: resolvedContext.user.id,
      });
      throw new Error(connectedUsersError.message);
    }

    for (const user of connectedUsers ?? []) {
      connectedUsersById.set(user.id, user);

      if (user.auth_user_id) {
        connectedUsersByAuthId.set(user.auth_user_id, user);
      }
    }
  }

  if (connectedLegacyAuthUserIds.length > 0) {
    const { data: connectedUsers, error: connectedUsersError } = await supabase
      .from("users")
      .select(STAFF_CONNECTED_USER_SELECT)
      .in("auth_user_id", connectedLegacyAuthUserIds)
      .returns<StaffConnectedUser[]>();

    if (connectedUsersError) {
      console.error("Supabase load legacy connected staff users failed", {
        code: connectedUsersError.code,
        message: connectedUsersError.message,
        details: connectedUsersError.details,
        hint: connectedUsersError.hint,
        salonId: salon.id,
        organizationId: organization.id,
        userId: resolvedContext.user.id,
      });
      throw new Error(connectedUsersError.message);
    }

    for (const user of connectedUsers ?? []) {
      connectedUsersById.set(user.id, user);

      if (user.auth_user_id) {
        connectedUsersByAuthId.set(user.auth_user_id, user);
      }
    }
  }

  const staff =
    staffResult.data?.map<StaffDirectoryMember>((member) => {
      const payrollSetup = payrollSetupByStaffId.get(member.id) ?? null;

      return {
        ...member,
        connected_user:
          (member.account_user_id
            ? connectedUsersById.get(member.account_user_id)
            : null) ??
          (member.user_id ? connectedUsersByAuthId.get(member.user_id) : null) ??
          null,
        payroll_setup_id: payrollSetup?.id ?? null,
        payroll_setup_status: canViewPayrollSetup
          ? payrollSetup
            ? "configured"
            : "missing"
          : "restricted",
      };
    }) ?? [];

  return {
    canViewPayrollSetup,
    context: resolvedContext,
    staff,
  };
}

export async function createStaff(input: CreateStaffInput) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to create staff.");
  }

  await requirePermission(STAFF_PERMISSIONS.manage, context);

  const { organization, salon } = requireCurrentOrganizationAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const displayName = input.display_name.trim();

  if (!displayName) {
    throw new Error("Display Name is required.");
  }

  const { data, error } = await supabase
    .from("staff")
    .insert({
      organization_id: organization.id,
      salon_id: salon.id,
      display_name: displayName,
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone,
      email: input.email,
      job_title: input.job_title,
      is_active: input.is_active ?? true,
    })
    .select(STAFF_SELECT)
    .single<Staff>();

  if (error) {
    console.error("Supabase create staff failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      organizationId: organization.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  return data;
}
