"use server";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { isSalonId, type SalonSocialField } from "@/lib/explore-social";
import { salonLoveAction } from "./account-actions";
import { revalidatePath } from "next/cache";

export async function setExploreSalonPreferenceAction(salonId: string, field: SalonSocialField, active: boolean) {
  if (!isSalonId(salonId) || !["loved", "saved", "hidden", "following"].includes(field) || typeof active !== "boolean") return { error: "Salon action is not valid." };
  if (field === "following") return salonLoveAction(salonId, active);
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) return { error: "Sign in to save your preferences." };
  const { error } = await client.rpc("set_explore_salon_preference", { p_salon: salonId, p_field: field, p_active: active });
  if (error) return { error: "Your preference could not be saved. Please try again." };
  revalidatePath("/explore/favorites");
  return { error: null };
}
