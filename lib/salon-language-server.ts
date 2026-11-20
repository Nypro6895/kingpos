import "server-only";
import { cache } from "react";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { PERSONAL_LANGUAGE, type SalonLanguageState } from "@/lib/salon-language";

export async function getSalonLanguageForContext(context: import("@/lib/current-context").CurrentBusinessContext): Promise<SalonLanguageState> {
  const salon = context.workspaceType === "salon" ? (context.salonMode === "staff" ? context.currentStaffSalon : context.currentSalon) : null;
  if (!context.user || !salon) return PERSONAL_LANGUAGE;
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Could not load language settings. Please try again.");
  const { data, error } = await client.rpc("salon_language_state", { p_salon: salon.id, p_staff: context.salonMode === "staff" });
  if (error) throw new Error("Could not load language settings. Please try again.");
  return data as SalonLanguageState;
}

export const getSalonLanguage = cache(async (): Promise<SalonLanguageState> => getSalonLanguageForContext(await getRequestBusinessContext()));
