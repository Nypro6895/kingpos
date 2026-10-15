"use server";
import {
  createAuthenticatedSupabaseServerClient,
  getSupabaseAuthUser,
} from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { advertisingClient } from "@/lib/explore-advertising";
import { resolveReferenceFavorites, validReferenceFavoriteKey } from "@/lib/explore-reference-favorites";
/** One actor-scoped read for a page of inspiration, rather than a request per card. */
export async function referenceLoveStatesAction(keys: string[]) {
  if (!Array.isArray(keys) || keys.length > 40) return { keys: [], error: "Too many favorites requested." };
  const valid = [...new Set(keys.filter(validReferenceFavoriteKey))];
  const user = await getSupabaseAuthUser();
  if (!user || !valid.length) return { keys: [], error: null };
  const client = await createAuthenticatedSupabaseServerClient();
  const identity = client ? await client.rpc("current_public_user_id") : null;
  const userId = !identity?.error && typeof identity?.data === "string" ? identity.data : null;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return { keys: [], error: "Favorites could not be loaded." };
  const result = await advertisingClient().from("explore_reference_favorites").select("item_key").eq("user_id", userId).in("item_key", valid);
  return { keys: (result.data ?? []).map(row => String(row.item_key)), error: result.error ? "Favorites could not be loaded." : null };
}
export async function referenceLoveAction(key: string, active?: boolean) {
  const user = await getSupabaseAuthUser();
  if (!user) return { error: "Sign in to save favorites.", active: false };
  const identityClient = await createAuthenticatedSupabaseServerClient();
  const identity = identityClient ? await identityClient.rpc("current_public_user_id") : null;
  const userId = !identity?.error && typeof identity?.data === "string" ? identity.data : null;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Your account could not be verified. Please try again.", active: false };
  if (!validReferenceFavoriteKey(key))
    return { error: "This item is unavailable.", active: false };
  // A stale favorite can still be removed after its salon has been hidden.
  if (active !== false) {
    const current = await resolveReferenceFavorites([key]);
    if (current.error) return { error: current.error, active: false };
    if (!current.items.length) return { error: "This item is unavailable.", active: false };
  }
  const client = advertisingClient();
  if (active === undefined) {
    const { data, error } = await client
      .from("explore_reference_favorites")
      .select("item_key")
      .eq("user_id", userId)
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
          { user_id: userId, item_key: key },
          { onConflict: "user_id,item_key" },
        )
    : await client
        .from("explore_reference_favorites")
        .delete()
        .eq("user_id", userId)
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
  const identity = await client.rpc("current_public_user_id");
  const userId = !identity.error && typeof identity.data === "string" ? identity.data : null;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Your account could not be verified. Please try again.", active: false };
  if (!/^[0-9a-f-]{36}$/i.test(salonId))
    return { error: "Salon is unavailable.", active: false };
  if (active === undefined) {
    const { data, error } = await client
      .from("salon_profile_follows")
      .select("id")
      .eq("salon_id", salonId)
      .eq("user_id", userId)
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
          { salon_id: salonId, user_id: userId },
          { onConflict: "salon_id,user_id" },
        )
    : await client
        .from("salon_profile_follows")
        .delete()
        .eq("salon_id", salonId)
        .eq("user_id", userId);
  if (result.error)
    return { error: "Could not save this salon.", active: false };
  revalidatePath(`/explore/salons/${salonId}`);
  revalidatePath("/more/following");
  return { error: null, active };
}
