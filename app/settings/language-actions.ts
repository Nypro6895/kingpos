"use server";
import { revalidatePath } from "next/cache";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { SalonLanguageState } from "@/lib/salon-language";

export async function languageAction(salonId: string, action: "load" | "choose" | "seen", code = "en", activation: string | null = null): Promise<{ state?: SalonLanguageState; error?: string; accessDenied?: boolean }> {
  try {
    const context = await getCurrentBusinessContext();
    const salon = context.workspaceType === "salon" ? (context.salonMode === "staff" ? context.currentStaffSalon : context.currentSalon) : null;
    if (!context.user || !salon || salon.id !== salonId) return { error: "Your workspace changed. Refresh and try again.", accessDenied: true };
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client || !["load", "choose", "seen"].includes(action)) return { error: "Could not update language settings." };
    const rpc = action === "choose" ? "salon_language_choose" : action === "seen" ? "salon_language_notice_seen" : "salon_language_state";
    const scope = { p_salon: salonId, p_staff: context.salonMode === "staff" };
    const params = action === "load" ? scope : { ...scope, p_language: code, p_activation: activation };
    const { data, error } = await client.rpc(rpc, params);
    if (error) return { error: "This language could not be updated. Refresh and try again.", accessDenied: error.code === "42501" || error.message === "Salon access required." };
    if (action === "choose") revalidatePath("/", "layout");
    return { state: data as SalonLanguageState };
  } catch { return { error: "Could not update language settings. Please try again." }; }
}
