import "server-only";

import { safeAccountAvatarUrl } from "@/lib/account-avatar";
import {
  SALON_PROFILE_MEDIA_BUCKET,
  normalizeSalonProfileMediaPath,
} from "@/lib/salon-profile-media";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Staff } from "@/types/staff";
import type { KingUser } from "@/types/user";

export const STAFF_PRESENTATION_USER_SELECT =
  "id, auth_user_id, email, first_name, last_name, display_name, avatar_url";

export type StaffPresentationConnectedUser = Pick<
  KingUser,
  | "auth_user_id"
  | "avatar_url"
  | "display_name"
  | "email"
  | "first_name"
  | "id"
  | "last_name"
>;

export type StaffPresentationBeautyIdentity = StaffPresentationConnectedUser & {
  beautyProfileVisibility: string;
};

export type StaffPresentation = {
  avatarUrl: string | null;
  bio: string | null;
  displayName: string;
  isActive: boolean;
  jobTitle: string | null;
  onlineBookingEnabled: boolean;
  publicProfileVisible: boolean;
  salonId: string;
  specialties: string[];
  staffId: string;
};

export type StaffPresentationUserMaps = {
  beautyByAccountUserId: Map<string, StaffPresentationBeautyIdentity>;
  byAccountUserId: Map<string, StaffPresentationConnectedUser>;
  byAuthUserId: Map<string, StaffPresentationConnectedUser>;
};

type StaffProfileDefaultsRow = Pick<
  Staff,
  | "account_user_id"
  | "display_name"
  | "first_name"
  | "id"
  | "last_name"
  | "salon_id"
  | "user_id"
>;

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function fullName(user: Pick<StaffPresentationConnectedUser, "first_name" | "last_name"> | null | undefined) {
  return [clean(user?.first_name), clean(user?.last_name)]
    .filter(Boolean)
    .join(" ");
}

export function getStaffProfilePhotoUrl(path: string | null | undefined) {
  const cleanedPath = normalizeSalonProfileMediaPath(path);

  if (!cleanedPath) {
    return null;
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  return supabase.storage
    .from(SALON_PROFILE_MEDIA_BUCKET)
    .getPublicUrl(cleanedPath).data.publicUrl;
}

export function getStaffProfileAvatarUrl(input: {
  accountAvatarUrl?: string | null;
  beautyAvatarUrl?: string | null;
  staffProfilePhotoPath?: string | null;
}) {
  return (
    getStaffProfilePhotoUrl(input.staffProfilePhotoPath) ??
    safeAccountAvatarUrl(input.beautyAvatarUrl) ??
    safeAccountAvatarUrl(input.accountAvatarUrl)
  );
}

export function getStaffProfileDisplayName(
  staff: Pick<Staff, "display_name">,
  connectedUser?: StaffPresentationConnectedUser | null,
  beautyIdentity?: StaffPresentationBeautyIdentity | null,
) {
  return (
    clean(staff.display_name) ||
    clean(beautyIdentity?.display_name) ||
    fullName(beautyIdentity) ||
    clean(connectedUser?.display_name) ||
    fullName(connectedUser) ||
    clean(connectedUser?.email) ||
    "Professional"
  );
}

export function resolveStaffPresentation(input: {
  beautyIdentity?: StaffPresentationBeautyIdentity | null;
  connectedUser?: StaffPresentationConnectedUser | null;
  staff: Pick<
    Staff,
    | "display_name"
    | "id"
    | "is_active"
    | "job_title"
    | "online_booking_enabled"
    | "public_bio"
    | "public_profile_photo_path"
    | "public_profile_visible"
    | "salon_id"
    | "specialties"
  >;
}): StaffPresentation {
  return {
    avatarUrl: getStaffProfileAvatarUrl({
      accountAvatarUrl: input.connectedUser?.avatar_url,
      beautyAvatarUrl: input.beautyIdentity?.avatar_url,
      staffProfilePhotoPath: input.staff.public_profile_photo_path,
    }),
    bio: input.staff.public_bio,
    displayName: getStaffProfileDisplayName(
      input.staff,
      input.connectedUser,
      input.beautyIdentity,
    ),
    isActive: input.staff.is_active,
    jobTitle: input.staff.job_title,
    onlineBookingEnabled: input.staff.online_booking_enabled,
    publicProfileVisible: input.staff.public_profile_visible,
    salonId: input.staff.salon_id,
    specialties: input.staff.specialties,
    staffId: input.staff.id,
  };
}

export function getStaffPresentationUserForStaff(
  staff: Pick<Staff, "account_user_id" | "user_id">,
  maps: StaffPresentationUserMaps,
) {
  return (
    (staff.account_user_id ? maps.byAccountUserId.get(staff.account_user_id) : null) ??
    (staff.user_id ? maps.byAuthUserId.get(staff.user_id) : null) ??
    null
  );
}

export function getStaffPresentationBeautyIdentityForStaff(
  staff: Pick<Staff, "account_user_id" | "user_id">,
  maps: StaffPresentationUserMaps,
) {
  const connectedUser = getStaffPresentationUserForStaff(staff, maps);

  return connectedUser
    ? maps.beautyByAccountUserId.get(connectedUser.id) ?? null
    : null;
}

export async function loadStaffPresentationUsers(input: {
  staff: Array<Pick<Staff, "account_user_id" | "user_id">>;
  supabase: SupabaseClient;
}): Promise<StaffPresentationUserMaps> {
  const accountUserIds = Array.from(
    new Set(
      input.staff
        .map((member) => member.account_user_id)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  );
  const authUserIds = Array.from(
    new Set(
      input.staff
        .map((member) => member.user_id)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  );
  const byAccountUserId = new Map<string, StaffPresentationConnectedUser>();
  const byAuthUserId = new Map<string, StaffPresentationConnectedUser>();
  const beautyByAccountUserId = new Map<string, StaffPresentationBeautyIdentity>();

  if (accountUserIds.length > 0) {
    const { data, error } = await input.supabase
      .from("users")
      .select(STAFF_PRESENTATION_USER_SELECT)
      .in("id", accountUserIds)
      .returns<StaffPresentationConnectedUser[]>();

    if (error) {
      throw new Error(error.message);
    }

    for (const user of data ?? []) {
      byAccountUserId.set(user.id, user);

      if (user.auth_user_id) {
        byAuthUserId.set(user.auth_user_id, user);
      }
    }
  }

  if (authUserIds.length > 0) {
    const { data, error } = await input.supabase
      .from("users")
      .select(STAFF_PRESENTATION_USER_SELECT)
      .in("auth_user_id", authUserIds)
      .returns<StaffPresentationConnectedUser[]>();

    if (error) {
      throw new Error(error.message);
    }

    for (const user of data ?? []) {
      byAccountUserId.set(user.id, user);

      if (user.auth_user_id) {
        byAuthUserId.set(user.auth_user_id, user);
      }
    }
  }

  const connectedUserIds = Array.from(byAccountUserId.keys());

  if (connectedUserIds.length > 0) {
    const { data, error } = await input.supabase
      .from("beauty_profiles")
      .select("user_id, visibility")
      .in("user_id", connectedUserIds)
      .eq("visibility", "public")
      .returns<Array<{ user_id: string; visibility: string }>>();

    if (error) {
      throw new Error(error.message);
    }

    for (const profile of data ?? []) {
      const user = byAccountUserId.get(profile.user_id);

      if (user) {
        beautyByAccountUserId.set(user.id, {
          ...user,
          beautyProfileVisibility: profile.visibility,
        });
      }
    }
  }

  return { beautyByAccountUserId, byAccountUserId, byAuthUserId };
}

export async function getStaffPresentationsByStaffId(input: {
  staff: Staff[];
  supabase: SupabaseClient;
}) {
  const users = await loadStaffPresentationUsers({
    staff: input.staff,
    supabase: input.supabase,
  });

  return new Map(
    input.staff.map((member) => [
      member.id,
      resolveStaffPresentation({
        beautyIdentity: getStaffPresentationBeautyIdentityForStaff(member, users),
        connectedUser: getStaffPresentationUserForStaff(member, users),
        staff: member,
      }),
    ]),
  );
}

function beautyDefaultDisplayName(
  beautyIdentity: StaffPresentationBeautyIdentity | null,
) {
  return clean(beautyIdentity?.display_name) || fullName(beautyIdentity) || null;
}

function userDefaultDisplayName(user: StaffPresentationConnectedUser | null) {
  return clean(user?.display_name) || fullName(user) || clean(user?.email) || null;
}

function identitySeedDisplayName(input: {
  beautyIdentity: StaffPresentationBeautyIdentity | null;
  connectedUser: StaffPresentationConnectedUser | null;
}) {
  return (
    beautyDefaultDisplayName(input.beautyIdentity) ??
    userDefaultDisplayName(input.connectedUser)
  );
}

function shouldSeedDisplayName(value: string | null | undefined) {
  const normalized = clean(value).toLowerCase();

  return (
    !normalized ||
    normalized === "staff" ||
    normalized === "new staff" ||
    normalized === "team member" ||
    normalized === "professional" ||
    normalized === "existing account"
  );
}

export async function initializeStaffProfileDefaultsForStaffId(input: {
  salonId?: string | null;
  staffId: string | null | undefined;
  supabase: SupabaseClient;
}) {
  if (!input.staffId) {
    return { updated: false };
  }

  let query = input.supabase
    .from("staff")
    .select("id, salon_id, account_user_id, user_id, display_name, first_name, last_name")
    .eq("id", input.staffId);

  if (input.salonId) {
    query = query.eq("salon_id", input.salonId);
  }

  const { data: staff, error } = await query.maybeSingle<StaffProfileDefaultsRow>();

  if (error) {
    throw new Error(error.message);
  }

  if (!staff) {
    return { updated: false };
  }

  const users = await loadStaffPresentationUsers({
    staff: [staff],
    supabase: input.supabase,
  });
  const connectedUser = getStaffPresentationUserForStaff(staff, users);
  const beautyIdentity = getStaffPresentationBeautyIdentityForStaff(staff, users);
  const patch: Record<string, string> = {};
  const defaultDisplayName = identitySeedDisplayName({
    beautyIdentity,
    connectedUser,
  });

  if (defaultDisplayName && shouldSeedDisplayName(staff.display_name)) {
    patch.display_name = defaultDisplayName;
  }

  if (!clean(staff.first_name) && clean(connectedUser?.first_name)) {
    patch.first_name = clean(connectedUser?.first_name);
  }

  if (!clean(staff.last_name) && clean(connectedUser?.last_name)) {
    patch.last_name = clean(connectedUser?.last_name);
  }

  if (Object.keys(patch).length === 0) {
    return { updated: false };
  }

  const { error: updateError } = await input.supabase
    .from("staff")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", staff.id)
    .eq("salon_id", staff.salon_id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return { updated: true };
}
