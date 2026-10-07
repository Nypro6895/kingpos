"use server";
import { withSettingsTarget } from "@/lib/settings-target-context";


import { getCurrentStaffBusinessContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function staffBookingPreferencesAction(change?: {
  preference: "online" | "notifications";
  enabled: boolean;
}, expectedSalonId?: string) {
 return withSettingsTarget(expectedSalonId, async () => {
  try {
    const context = await getCurrentStaffBusinessContext();
    if (!context.user || !context.currentStaffSalon) throw new Error("Open your staff workspace first.");
    if (expectedSalonId && context.currentStaffSalon.id !== expectedSalonId) throw new Error("The selected staff salon changed. Reload these settings before saving.");
    if (change && (typeof change.enabled !== "boolean" || !["online", "notifications"].includes(change.preference))) throw new Error("Invalid preference.");
    const supabase = await createAuthenticatedSupabaseServerClient();
    if (!supabase) throw new Error("Please sign in again.");
    const { data, error } = await supabase.rpc("own_staff_booking_preferences", {
      p_salon_id: context.currentStaffSalon.id,
      p_online: change?.preference === "online" ? change.enabled : null,
      p_notifications: change?.preference === "notifications" ? change.enabled : null,
    });
    if (error) throw new Error(error.code === "PGRST202" ? "Booking preferences are not available yet. Please contact the salon." : error.message);
    if (!data?.ok) throw new Error("You can only change your own staff booking preferences.");
    if (change) {
      revalidatePath("/staff/appointments");
      revalidatePath(`/book/${context.currentStaffSalon.id}`);
    }
    return { ok: true as const, online: Boolean(data.online), notifications: Boolean(data.notifications) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Unable to save preferences." };
  }

 }, "staff");
}
