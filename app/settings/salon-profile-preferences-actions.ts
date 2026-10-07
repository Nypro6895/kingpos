"use server";
import { withSettingsTarget } from "@/lib/settings-target-context";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { readSalonProfilePreferences } from "@/lib/salon-profile-preferences-server";
import { DEFAULT_PROFILE_PREFERENCES, type SalonProfilePreferences } from "@/lib/salon-profile-preferences";
async function requireProfileSettingsAccess(expectedSalonId?: string) {
  const context = await getCurrentBusinessContext();
  if (!context.user || !context.currentSalon || !(await hasPermission("salon_profile.manage", context))) throw new Error("You do not have permission to change this salon’s profile settings.");
  if (expectedSalonId && context.currentSalon.id !== expectedSalonId) throw new Error("The selected salon changed. Reload these settings before saving.");
  const supabase = await createAuthenticatedSupabaseServerClient();
  if (!supabase) throw new Error("Profile settings are unavailable.");
  return { client: supabase as SupabaseClient, salonId: context.currentSalon.id };
}
export async function loadSalonProfilePreferencesAction(expectedSalonId?: string) {
 return withSettingsTarget(expectedSalonId, async () => {
  try { const { client, salonId } = await requireProfileSettingsAccess(expectedSalonId); return { error: null, preferences: await readSalonProfilePreferences(client, salonId) }; }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not load settings.", preferences: null }; }

 }, "manage");
}
export async function saveSalonProfilePreferencesAction(input: SalonProfilePreferences, expectedSalonId?: string) {
 return withSettingsTarget(expectedSalonId, async () => {
  try {
    const { client, salonId } = await requireProfileSettingsAccess(expectedSalonId);
    const preferences = Object.fromEntries(Object.keys(DEFAULT_PROFILE_PREFERENCES).map((key) => {
      const value = input[key as keyof SalonProfilePreferences];
      if (key === "customer_review_count") {
        if (value !== 2 && value !== 3) throw new Error("Choose two or three customer reviews.");
        return [key, value];
      }
      if (key === "layout") {
        if (!["booking", "portfolio", "balanced"].includes(String(value))) throw new Error("Invalid profile layout.");
        return [key, value];
      }
      if (typeof value !== "boolean") throw new Error("Invalid profile setting.");
      return [key, value];
    })) as SalonProfilePreferences;
    const { error } = await client.from("salon_profile_preferences").upsert({ salon_id: salonId, ...preferences });
    if (error) throw new Error("Could not save profile settings.");
    revalidatePath("/salon-profile");
    revalidatePath(`/explore/salons/${salonId}`);
    return { error: null, preferences };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not save settings.", preferences: null }; }

 }, "manage");
}
