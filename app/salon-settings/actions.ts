"use server";

import { getSalonProfileHref } from "@/lib/salon-profile";
import {
  getCurrentSalonSetting,
  updateCurrentSalonSetting,
} from "@/lib/salon-settings";
import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { refreshCurrentSalonMapLocation } from "@/lib/location/salon-map-location";
import { hasPermission } from "@/lib/permissions";
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
    !context.currentOrganization ||
    !context.currentSalon
  ) {
    return {
      error: "Choose a Manage Salon workspace first.",
      updatedCount: 0,
    };
  }

  const organization = context.currentOrganization;
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
    target_organization_id: organization.id,
    target_salon_id: salon.id,
  });

  if (error) {
    console.error("Supabase batch update staff public team failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      organizationId: organization.id,
      salonId: salon.id,
    });
    return { error: error.message, updatedCount: 0 };
  }

  revalidatePath("/salon-settings");
  revalidatePath("/salon-profile");
  revalidatePath(getSalonProfileHref(salon.id));
  return { error: null, updatedCount: typeof data === "number" ? data : 0 };
}
