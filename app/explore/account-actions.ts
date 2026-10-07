"use server";
import {
  createAuthenticatedSupabaseServerClient,
  getSupabaseAuthUser,
} from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { advertisingClient } from "@/lib/explore-advertising";
import { referenceFavorite } from "@/lib/explore-reference-favorites";
export async function referenceLoveAction(key: string, active?: boolean) {
  const user = await getSupabaseAuthUser();
  if (!user) return { error: "Sign in to save favorites.", active: false };
  if (typeof key !== "string" || key.length > 180 || !referenceFavorite(key))
    return { error: "This item is unavailable.", active: false };
  const client = advertisingClient();
  if (active === undefined) {
    const { data, error } = await client
      .from("explore_reference_favorites")
      .select("item_key")
      .eq("user_id", user.id)
      .eq("item_key", key)
      .maybeSingle();
    return {
      error: error ? "Could not load favorites." : null,
      active: Boolean(data),
    };
  }
  const result = active
    ? await client
        .from("explore_reference_favorites")
        .upsert(
          { user_id: user.id, item_key: key },
          { onConflict: "user_id,item_key" },
        )
    : await client
        .from("explore_reference_favorites")
        .delete()
        .eq("user_id", user.id)
        .eq("item_key", key);
  if (result.error)
    return { error: "Could not save this favorite.", active: false };
  revalidatePath("/explore/favorites");
  return { error: null, active };
}
export async function salonLoveAction(salonId: string, active?: boolean) {
  const user = await getSupabaseAuthUser();
  const client = await createAuthenticatedSupabaseServerClient();
  if (!user || !client)
    return { error: "Sign in to save this salon.", active: false };
  if (!/^[0-9a-f-]{36}$/i.test(salonId))
    return { error: "Salon is unavailable.", active: false };
  if (active === undefined) {
    const { data, error } = await client
      .from("salon_profile_follows")
      .select("id")
      .eq("salon_id", salonId)
      .eq("user_id", user.id)
      .maybeSingle();
    return {
      error: error ? "Could not load favorites." : null,
      active: Boolean(data),
    };
  }
  const result = active
    ? await client
        .from("salon_profile_follows")
        .upsert(
          { salon_id: salonId, user_id: user.id },
          { onConflict: "salon_id,user_id" },
        )
    : await client
        .from("salon_profile_follows")
        .delete()
        .eq("salon_id", salonId)
        .eq("user_id", user.id);
  if (result.error)
    return { error: "Could not save this salon.", active: false };
  revalidatePath(`/explore/salons/${salonId}`);
  revalidatePath("/more/following");
  return { error: null, active };
}
