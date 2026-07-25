"use server";

import { createHash, randomBytes } from "crypto";
import { getSalonProfileHref } from "@/lib/salon-profile";
import {
  getCurrentSalonSetting,
  updateCurrentSalonSetting,
} from "@/lib/salon-settings";
import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { refreshCurrentSalonMapLocation } from "@/lib/location/salon-map-location";
import { hasPermission } from "@/lib/permissions";
import { PORTABLE_POS_ACCESS_SETUP_MESSAGE } from "@/lib/pos-portable-access";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
  redirect(`/salon-settings?error=${encodeURIComponent(message)}`);
}

function redirectWithPosAccessError(message: string): never {
  redirect(`/pos/settings?error=${encodeURIComponent(message)}#portable-access`);
}

function normalizePortableAccessId(value: string) {
  return value.replace(/\s+/g, "-").trim();
}

function digestPortablePasscode(input: {
  accessId: string;
  passcode: string;
  salt: string;
}) {
  return createHash("sha256")
    .update(`${input.accessId.toLowerCase()}:${input.passcode}:${input.salt}`)
    .digest("hex");
}

function isMissingPortablePosAccessSchemaError(error: {
  code?: string | null;
  message?: string | null;
}) {
  const message = error.message ?? "";

  return (
    (error.code === "PGRST205" &&
      message.includes("pos_portable_access_keys")) ||
    (error.code === "42P01" &&
      message.includes("pos_portable_access_keys")) ||
    (error.code === "42703" &&
      message.includes("pos_portable_access_keys"))
  );
}

async function requirePortablePosAccessMutationContext() {
  const context = await getCurrentBusinessContext();

  if (
    !context.user ||
    !isSalonManageContext(context) ||
    !context.currentSalon
  ) {
    redirectWithPosAccessError("Choose an owner salon workspace first.");
  }

  if (!(await hasPermission("salon_settings.manage", context))) {
    redirectWithPosAccessError(
      "You do not have permission to manage POS access.",
    );
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    redirectWithPosAccessError("Supabase environment variables are missing.");
  }

  return {
    context,
    salon: context.currentSalon,
    supabase,
    user: context.user,
  };
}

export async function updateSalonSettings(formData: FormData) {
  const businessName = readRequiredString(formData, "business_name");

  if (!businessName) {
    redirectWithError("Business Name is required.");
  }

  try {
    await updateCurrentSalonSetting({
      business_name: businessName,
      phone: readOptionalString(formData, "phone"),
      email: readOptionalString(formData, "email"),
      website: readOptionalString(formData, "website"),
      address_line1: readOptionalString(formData, "address_line1"),
      address_line2: readOptionalString(formData, "address_line2"),
      city: readOptionalString(formData, "city"),
      state: readOptionalString(formData, "state"),
      postal_code: readOptionalString(formData, "postal_code"),
      country: readOptionalString(formData, "country"),
      business_description: readOptionalString(formData, "business_description"),
      allow_staff_applications:
        formData.get("allow_staff_applications") === "on",
      public_discovery_enabled:
        formData.get("public_discovery_enabled") === "on",
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Salon settings could not be saved.",
    );
  }

  revalidatePath("/salon-settings");
  revalidatePath("/explore");
  redirect("/salon-settings");
}

export async function createPortablePosAccessAction(formData: FormData) {
  const accessId = normalizePortableAccessId(
    readRequiredString(formData, "access_id"),
  );
  const label = readOptionalString(formData, "label");
  const passcode = readRequiredString(formData, "passcode");

  if (!accessId) {
    redirectWithPosAccessError("POS ID is required.");
  }

  if (!/^[a-zA-Z0-9._-]{3,48}$/.test(accessId)) {
    redirectWithPosAccessError(
      "POS ID must be 3-48 characters and use letters, numbers, dots, dashes, or underscores.",
    );
  }

  if (passcode.length < 4 || passcode.length > 32) {
    redirectWithPosAccessError("Passcode must be 4-32 characters.");
  }

  const { salon, supabase, user } =
    await requirePortablePosAccessMutationContext();
  const salt = randomBytes(16).toString("hex");
  const passcodeDigest = digestPortablePasscode({
    accessId,
    passcode,
    salt,
  });

  const { error } = await supabase.from("pos_portable_access_keys").insert({
    access_id: accessId,
    created_by: user.id,
    is_active: true,
    label,
    passcode_digest: passcodeDigest,
    passcode_salt: salt,
    salon_id: salon.id,
  });

  if (error) {
    if (isMissingPortablePosAccessSchemaError(error)) {
      redirectWithPosAccessError(PORTABLE_POS_ACCESS_SETUP_MESSAGE);
    }

    if (error.code === "23505") {
      redirectWithPosAccessError("That POS ID is already in use.");
    }

    console.error("Supabase create Portable POS access failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: salon.id,
      userId: user.id,
    });
    redirectWithPosAccessError(error.message);
  }

  revalidatePath("/pos/settings");
  redirect("/pos/settings#portable-access");
}

export async function updatePortablePosAccessStatusAction(formData: FormData) {
  const keyId = readRequiredString(formData, "key_id");
  const nextActive = readRequiredString(formData, "next_active") === "true";

  if (!keyId) {
    redirectWithPosAccessError("Portable POS access key is required.");
  }

  const { salon, supabase, user } =
    await requirePortablePosAccessMutationContext();
  const { error } = await supabase
    .from("pos_portable_access_keys")
    .update({ is_active: nextActive })
    .eq("id", keyId)
    .eq("salon_id", salon.id);

  if (error) {
    if (isMissingPortablePosAccessSchemaError(error)) {
      redirectWithPosAccessError(PORTABLE_POS_ACCESS_SETUP_MESSAGE);
    }

    console.error("Supabase update Portable POS access status failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: salon.id,
      keyId,
      userId: user.id,
    });
    redirectWithPosAccessError(error.message);
  }

  revalidatePath("/pos/settings");
  redirect("/pos/settings#portable-access");
}

export async function refreshSalonMapLocation() {
  try {
    const { context, setting } = await getCurrentSalonSetting();

    if (!setting) {
      redirectWithError("Salon settings could not be loaded.");
    }

    await refreshCurrentSalonMapLocation({
      context,
      reason: "manual_refresh",
      setting,
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error
        ? error.message
        : "Map location could not be refreshed.",
    );
  }

  revalidatePath("/salon-settings");
  revalidatePath("/explore");
  redirect("/salon-settings");
}

export type PublicTeamBatchUpdate = {
  ownerPublicEnabled: boolean;
  onlineBookingEnabled: boolean;
  profileDisplayOrder: number;
  salonProfileContentPostingEnabled: boolean;
  staffId: string;
};

export async function updateStaffPublicTeamBatchAction(
  updates: PublicTeamBatchUpdate[],
): Promise<{ error: string | null; updatedCount: number }> {
  const context = await getCurrentBusinessContext();

  if (
    !context.user ||
    !isSalonManageContext(context) ||
    !context.currentAccount ||
    !context.currentSalon
  ) {
    return {
      error: "Choose a salon workspace first.",
      updatedCount: 0,
    };
  }

  const Account = context.currentAccount;
  const salon = context.currentSalon;

  if (!(await hasPermission("salon_settings.manage", context))) {
    return {
      error: "You do not have permission to manage public team settings.",
      updatedCount: 0,
    };
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return {
      error: "Supabase environment variables are missing.",
      updatedCount: 0,
    };
  }

  if (!Array.isArray(updates) || updates.length === 0) {
    return { error: null, updatedCount: 0 };
  }

  const normalizedUpdates = updates.map((update) => ({
    online_booking_enabled: update.onlineBookingEnabled === true,
    owner_public_enabled: update.ownerPublicEnabled === true,
    profile_display_order: Number.isFinite(update.profileDisplayOrder)
      ? Math.trunc(update.profileDisplayOrder)
      : 0,
    salon_profile_content_posting_enabled:
      update.salonProfileContentPostingEnabled === true,
    staff_id: update.staffId,
  }));

  const { data, error } = await supabase.rpc("update_staff_public_team_batch", {
    changes: normalizedUpdates,
    target_account_id: Account.id,
    target_salon_id: salon.id,
  });

  if (error) {
    console.error("Supabase batch update staff public team failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      accountId: Account.id,
      salonId: salon.id,
    });
    return { error: error.message, updatedCount: 0 };
  }

  revalidatePath("/salon-settings");
  revalidatePath("/salon-profile");
  revalidatePath(getSalonProfileHref(salon.id));
  return { error: null, updatedCount: typeof data === "number" ? data : 0 };
}
