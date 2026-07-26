import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { resolveStaffAccountForSalon } from "@/lib/staff-account";
import {
  SALON_PROFILE_MEDIA_BUCKET,
  isSalonProfileMediaPathForSalon,
  normalizeSalonProfileMediaPath,
  parseSalonProfileMediaPath,
} from "@/lib/salon-profile-media";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  CreateStaffInput,
  Staff,
  UpdateStaffDirectoryBatchInput,
} from "@/types/staff";
import type { KingUser } from "@/types/user";

export const STAFF_SELECT =
  "id, salon_id, account_user_id, user_id, display_name, first_name, last_name, phone, email, address_line1, address_line2, city, state, postal_code, job_title, passcode_is_default, pos_enabled, public_profile_photo_path, public_bio, public_profile_visible, owner_public_enabled, staff_public_consent_status, online_booking_enabled, profile_display_order, salon_profile_content_posting_enabled, specialties, is_active, created_at, updated_at";
export const STAFF_LEGACY_SELECT =
  "id, salon_id, account_user_id, user_id, display_name, first_name, last_name, phone, email, address_line1, address_line2, city, state, postal_code, job_title, pos_enabled, public_profile_photo_path, public_bio, public_profile_visible, owner_public_enabled, staff_public_consent_status, online_booking_enabled, profile_display_order, salon_profile_content_posting_enabled, specialties, is_active, created_at, updated_at";

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

function requireCurrentAccountAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open staff management from a Business workspace.");
  }

  if (!context.currentAccount) {
    throw new Error("Choose a salon workspace before managing staff.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    Account: context.currentAccount,
    salon: context.currentSalon,
  };
}

export async function getCurrentSalonStaff() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, staff: [] };
  }

  await requirePermission(STAFF_PERMISSIONS.view, context);

  const { salon } = requireCurrentAccountAndSalon(context);
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
      accountId: context.currentAccount?.id,
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

  const { Account, salon } = requireCurrentAccountAndSalon(resolvedContext);
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
    .eq("salon_id", salon.id)
    .order("display_name", { ascending: true })
    .returns<Staff[]>();

  const payrollQuery = canViewPayrollSetup
    ? supabase
        .from("staff_payroll_settings")
        .select(STAFF_PAYROLL_SETUP_SELECT)
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
      accountId: Account.id,
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
      accountId: Account.id,
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
        accountId: Account.id,
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
        accountId: Account.id,
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

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const displayName = input.display_name.trim();

  if (!displayName) {
    throw new Error("Display Name is required.");
  }

  const ownerPublicEnabled =
    input.owner_public_enabled ?? input.public_profile_visible ?? true;
  const staffPublicConsentStatus =
    input.staff_public_consent_status ??
    ((input.public_profile_visible ?? true) ? "granted" : "not_requested");

  const { data, error } = await supabase
    .from("staff")
    .insert({
      salon_id: salon.id,
      display_name: displayName,
      first_name: input.first_name,
      last_name: input.last_name,
      phone: input.phone,
      email: input.email,
      address_line1: input.address_line1,
      address_line2: input.address_line2,
      city: input.city,
      job_title: input.job_title,
      postal_code: input.postal_code,
      pos_enabled: input.pos_enabled ?? true,
      state: input.state,
      online_booking_enabled: input.online_booking_enabled ?? true,
      owner_public_enabled: ownerPublicEnabled,
      profile_display_order: input.profile_display_order ?? 0,
      public_bio: input.public_bio ?? null,
      public_profile_photo_path: input.public_profile_photo_path ?? null,
      public_profile_visible:
        ownerPublicEnabled && staffPublicConsentStatus === "granted",
      salon_profile_content_posting_enabled:
        input.salon_profile_content_posting_enabled ?? true,
      specialties: input.specialties ?? [],
      staff_public_consent_status: staffPublicConsentStatus,
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
      accountId: Account.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  return data;
}

function cleanOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

export async function updateStaffDirectoryBatch(
  input: UpdateStaffDirectoryBatchInput,
) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to update staff.");
  }

  await requirePermission(STAFF_PERMISSIONS.manage, context);

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const changes = Array.from(
    new Map(
      input.changes
        .filter((change) => change.staff_id)
        .map((change) => [change.staff_id, change]),
    ).values(),
  );

  if (changes.length === 0) {
    return { updated: 0 };
  }

  const staffIds = changes.map((change) => change.staff_id);
  const { data: existingStaff, error: loadError } = await supabase
    .from("staff")
    .select(STAFF_SELECT)
    .eq("salon_id", salon.id)
    .in("id", staffIds)
    .returns<Staff[]>();

  if (loadError) {
    console.error("Supabase load staff batch update failed", {
      accountId: Account.id,
      code: loadError.code,
      details: loadError.details,
      hint: loadError.hint,
      message: loadError.message,
      salonId: salon.id,
      userId: context.user.id,
    });
    throw new Error(loadError.message);
  }

  const existingById = new Map(
    (existingStaff ?? []).map((member) => [member.id, member]),
  );

  if (existingById.size !== changes.length) {
    throw new Error("One or more staff profiles could not be found.");
  }

  for (const change of changes) {
    const existing = existingById.get(change.staff_id);

    if (!existing) {
      throw new Error("Staff profile was not found.");
    }

    const displayName = cleanOptional(change.display_name);

    if (!displayName) {
      throw new Error("Display name is required for every staff profile.");
    }

    const isActive = change.is_active;
    const ownerPublicEnabled = isActive && change.owner_public_enabled;

    const { error } = await supabase
      .from("staff")
      .update({
        address_line1: cleanOptional(change.address_line1),
        address_line2: cleanOptional(change.address_line2),
        city: cleanOptional(change.city),
        display_name: displayName,
        email: cleanOptional(change.email),
        first_name: cleanOptional(change.first_name),
        is_active: isActive,
        job_title: cleanOptional(change.job_title),
        last_name: cleanOptional(change.last_name),
        online_booking_enabled: isActive && change.online_booking_enabled,
        owner_public_enabled: ownerPublicEnabled,
        phone: cleanOptional(change.phone),
        postal_code: cleanOptional(change.postal_code),
        pos_enabled: isActive && change.pos_enabled,
        public_profile_visible:
          ownerPublicEnabled &&
          existing.staff_public_consent_status === "granted",
        salon_profile_content_posting_enabled:
          isActive && change.salon_profile_content_posting_enabled,
        state: cleanOptional(change.state),
      })
      .eq("id", change.staff_id)
      .eq("salon_id", salon.id);

    if (error) {
      console.error("Supabase update staff directory row failed", {
        accountId: Account.id,
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
        salonId: salon.id,
        staffId: change.staff_id,
        userId: context.user.id,
      });
      throw new Error(error.message);
    }
  }

  return { updated: changes.length };
}

function normalizeSpecialties(value: string[] | null | undefined) {
  return Array.from(
    new Set(
      (value ?? [])
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .slice(0, 12),
    ),
  );
}

function getStorageParent(path: string) {
  const parts = path.split("/");
  const name = parts.pop() ?? "";

  return {
    folder: parts.join("/"),
    name,
  };
}

async function verifyStaffAvatarPath(input: {
  path: string | null | undefined;
  salonId: string;
  staffId: string;
}) {
  const normalizedPath = normalizeSalonProfileMediaPath(input.path);

  if (!normalizedPath) {
    return null;
  }

  const parsed = parseSalonProfileMediaPath(normalizedPath);

  if (
    !parsed ||
    parsed.kind !== "staffAvatar" ||
    !isSalonProfileMediaPathForSalon({
      allowedKinds: ["staffAvatar"],
      path: normalizedPath,
      salonId: input.salonId,
    }) ||
    !normalizedPath.includes(`/staff/${input.staffId}/avatar/`)
  ) {
    throw new Error("Uploaded avatar does not belong to this staff profile.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { folder, name } = getStorageParent(normalizedPath);
  const { data, error } = await supabase.storage
    .from(SALON_PROFILE_MEDIA_BUCKET)
    .list(folder, { limit: 10, search: name });

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.some((object) => object.name === name)) {
    throw new Error("Uploaded avatar was not found in Storage.");
  }

  return normalizedPath;
}

export async function updateStaffPublicProfile(input: {
  displayName?: string | null;
  jobTitle?: string | null;
  publicBio?: string | null;
  publicProfilePhotoPath?: string | null;
  removePhoto?: boolean;
  specialties?: string[] | null;
  staffPublicConsentStatus?: Staff["staff_public_consent_status"];
  staffId: string;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to update staff profiles.");
  }

  if (!context.currentAccount || !context.currentSalon) {
    throw new Error("Choose a salon workspace before updating staff.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const [canManageStaff, staffResolution] = await Promise.all([
    hasPermission(STAFF_PERMISSIONS.manage, context),
    resolveStaffAccountForSalon({ context, supabase }),
  ]);
  const canEditSelf =
    staffResolution.status === "found" && staffResolution.staff.id === input.staffId;

  if (!canManageStaff && !canEditSelf) {
    throw new Error("You can only update your own public staff profile.");
  }

  const { data: existing, error: loadError } = await supabase
    .from("staff")
    .select(STAFF_SELECT)
    .eq("id", input.staffId)
    .eq("salon_id", context.currentSalon.id)
    .maybeSingle<Staff>();

  if (loadError || !existing) {
    throw new Error(loadError?.message ?? "Staff profile was not found.");
  }

  const avatarPath = input.removePhoto
    ? null
    : await verifyStaffAvatarPath({
        path: input.publicProfilePhotoPath,
        salonId: context.currentSalon.id,
        staffId: input.staffId,
      });
  const displayName = cleanOptional(input.displayName) ?? existing.display_name;

  if (!displayName) {
    throw new Error("Display name is required.");
  }

  const nextConsentStatus = canEditSelf
    ? input.staffPublicConsentStatus ?? existing.staff_public_consent_status
    : existing.staff_public_consent_status;

  const { error } = await supabase
    .from("staff")
    .update({
      display_name: displayName,
      job_title: cleanOptional(input.jobTitle) ?? existing.job_title,
      public_bio:
        input.publicBio === undefined
          ? existing.public_bio
          : cleanOptional(input.publicBio),
      public_profile_photo_path:
        input.removePhoto === true
          ? null
          : (avatarPath ?? existing.public_profile_photo_path),
      public_profile_visible:
        existing.owner_public_enabled && nextConsentStatus === "granted",
      staff_public_consent_status: nextConsentStatus,
      specialties:
        input.specialties === undefined
          ? existing.specialties
          : normalizeSpecialties(input.specialties),
    })
    .eq("id", input.staffId)
    .eq("salon_id", context.currentSalon.id);

  if (error) {
    console.error("Supabase update staff public profile failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: context.currentSalon.id,
      staffId: input.staffId,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  if (avatarPath) {
    await supabase
      .from("salon_profile_media_assets")
      .update({
        attached_at: new Date().toISOString(),
        attached_entity_id: input.staffId,
        attached_entity_type: "staff",
        status: "active",
      })
      .eq("bucket", SALON_PROFILE_MEDIA_BUCKET)
      .eq("object_path", avatarPath);
  }

  if ((avatarPath || input.removePhoto) && existing.public_profile_photo_path) {
    await supabase
      .from("salon_profile_media_assets")
      .update({
        attached_entity_id: null,
        attached_entity_type: null,
        orphaned_at: new Date().toISOString(),
        status: "orphaned",
      })
      .eq("bucket", SALON_PROFILE_MEDIA_BUCKET)
      .eq("object_path", existing.public_profile_photo_path);
  }
}
