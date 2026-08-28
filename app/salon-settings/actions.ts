"use server";

import { createHash, randomBytes } from "crypto";
import { getSalonProfileHref } from "@/lib/salon-profile";
import {
  closeSalonPermanently,
  disableSalon,
  getSalonClosureReview,
  getSalonLifecycle,
  reactivateSalon,
} from "@/lib/salon-lifecycle";
import { createSalonLifecycleExport } from "@/lib/lifecycle-export";
import { normalizeSalonLifecycleStatus } from "@/lib/salon-lifecycle-rules";
import {
  getCurrentSalonSetting,
  updateCurrentSalonSetting,
} from "@/lib/salon-settings";
import {
  getCurrentBusinessContext,
  isOwnerMembership,
  isSalonManageContext,
} from "@/lib/current-context";
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

function redirectWithLifecycleError(message: string): never {
  redirect(
    `/salon-settings?lifecycle_error=${encodeURIComponent(message)}#salon-status`,
  );
}

function redirectWithNotice(message: string): never {
  redirect(`/salon-settings?notice=${encodeURIComponent(message)}#salon-status`);
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

async function requireSalonLifecycleMutationContext() {
  const context = await getCurrentBusinessContext();

  if (
    !context.user ||
    !isSalonManageContext(context) ||
    !context.currentSalon
  ) {
    redirectWithLifecycleError("Choose an owner salon workspace first.");
  }

  if (!(await hasPermission("salon_settings.manage", context))) {
    redirectWithLifecycleError(
      "You do not have permission to manage salon lifecycle.",
    );
  }

  if (
    !isOwnerMembership(context.currentMembership) &&
    !context.permissionCodes.includes("account.manage")
  ) {
    redirectWithLifecycleError("Only an Owner can change salon lifecycle.");
  }

  return {
    context,
    salon: context.currentSalon,
    user: context.user,
  };
}

async function requireSalonBackupContext() {
  const context = await getCurrentBusinessContext();

  if (
    !context.user ||
    !isSalonManageContext(context) ||
    !context.currentSalon
  ) {
    throw new Error("Choose an owner salon workspace first.");
  }

  return {
    context,
    salon: context.currentSalon,
    user: context.user,
  };
}

function requireChecked(formData: FormData, key: string, message: string) {
  if (formData.get(key) !== "on") {
    redirectWithLifecycleError(message);
  }
}

export type SalonBackupActionResult =
  | {
      error: null;
      expiresAt: string;
      filename: string;
      signedUrl: string;
    }
  | {
      error: string;
      expiresAt?: never;
      filename?: never;
      signedUrl?: never;
    };

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

export async function disableCurrentSalonAction(formData: FormData) {
  requireChecked(
    formData,
    "disable_acknowledged",
    "Confirm that new business activity will be paused.",
  );

  const { salon } = await requireSalonLifecycleMutationContext();
  const lifecycle = await getSalonLifecycle(salon.id);

  if (!lifecycle || lifecycle.lifecycleStatus !== "active") {
    redirectWithLifecycleError("Only an active salon can be disabled.");
  }

  try {
    await disableSalon({
      reason: readOptionalString(formData, "disable_reason"),
      salonId: salon.id,
    });
  } catch (error) {
    redirectWithLifecycleError(
      error instanceof Error ? error.message : "Salon could not be disabled.",
    );
  }

  revalidatePath("/salon-settings");
  revalidatePath("/", "layout");
  redirectWithNotice("Salon disabled. Historical data remains available.");
}

export async function reactivateCurrentSalonAction(formData: FormData) {
  requireChecked(
    formData,
    "reactivate_acknowledged",
    "Confirm that business activity can resume.",
  );

  const { salon } = await requireSalonLifecycleMutationContext();
  const lifecycle = await getSalonLifecycle(salon.id);

  if (!lifecycle || lifecycle.lifecycleStatus !== "disabled") {
    redirectWithLifecycleError("Only a temporarily disabled salon can be reactivated.");
  }

  try {
    await reactivateSalon({
      reason: readOptionalString(formData, "reactivate_reason"),
      salonId: salon.id,
    });
  } catch (error) {
    redirectWithLifecycleError(
      error instanceof Error ? error.message : "Salon could not be reactivated.",
    );
  }

  revalidatePath("/salon-settings");
  revalidatePath("/", "layout");
  redirectWithNotice("Salon reactivated.");
}

export async function closeCurrentSalonPermanentlyAction(formData: FormData) {
  const { context, salon } = await requireSalonLifecycleMutationContext();
  const lifecycle = await getSalonLifecycle(salon.id);
  const lifecycleStatus = normalizeSalonLifecycleStatus(lifecycle?.status);

  if (!lifecycle || lifecycleStatus === "permanently_closed") {
    redirectWithLifecycleError("This salon is already permanently closed.");
  }

  const confirmationName = readRequiredString(formData, "confirmation_name");

  if (confirmationName !== salon.name) {
    redirectWithLifecycleError("Type the salon name exactly to confirm permanent closure.");
  }

  requireChecked(
    formData,
    "backup_acknowledged",
    "Acknowledge the backup/export choice before closing this salon.",
  );

  const review = await getSalonClosureReview({
    context,
    salonId: salon.id,
  });

  if (!review.canClose) {
    redirectWithLifecycleError(
      "Resolve future bookings, pending appointments, and open POS tickets before permanently closing this salon.",
    );
  }

  try {
    await closeSalonPermanently({
      reason: readOptionalString(formData, "closure_reason"),
      salonId: salon.id,
    });
  } catch (error) {
    redirectWithLifecycleError(
      error instanceof Error
        ? error.message
        : "Salon could not be permanently closed.",
    );
  }

  revalidatePath("/salon-settings");
  revalidatePath("/", "layout");
  redirectWithNotice("Salon permanently closed. Historical access remains available.");
}

export async function generateCurrentSalonBackupAction(): Promise<SalonBackupActionResult> {
  try {
    const { salon } = await requireSalonBackupContext();
    const salonExport = await createSalonLifecycleExport({
      salonId: salon.id,
    });

    return {
      error: null,
      expiresAt: salonExport.expiresAt,
      filename: salonExport.filename,
      signedUrl: salonExport.signedUrl,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Salon export could not be generated.",
    };
  }
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
  revalidatePath("/staff");
  revalidatePath("/staff/my-work");
  revalidatePath("/services");
  revalidatePath("/booking-setup");
  revalidatePath("/bookings");
  revalidatePath("/staff/appointments");
  revalidatePath("/pos");
  revalidatePath("/pos/portable");
  revalidatePath("/pos/portable/check-in");
  revalidatePath("/payroll");
  revalidatePath("/salon-profile");
  revalidatePath(`/book/${salon.id}`);
  revalidatePath(getSalonProfileHref(salon.id));
  return { error: null, updatedCount: typeof data === "number" ? data : 0 };
}
