import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PROFILE_PREFERENCES, type SalonProfilePreferences } from "./salon-profile-preferences";
export async function readSalonProfilePreferences(client: SupabaseClient, salonId: string): Promise<SalonProfilePreferences> {
  const { data, error } = await client.from("salon_profile_preferences").select("layout, show_customer_reviews, customer_review_count, show_featured, show_services, show_team, allow_staff_posts, allow_sharing, allow_saves, allow_comments").eq("salon_id", salonId).maybeSingle();
  if (error) throw new Error("Profile settings could not be loaded.");
  return { ...DEFAULT_PROFILE_PREFERENCES, ...data };
}
