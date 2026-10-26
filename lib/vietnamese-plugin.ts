import "server-only";
import { cache } from "react";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { EMPTY_VIETNAMESE_PLUGIN, type VietnamesePluginState } from "@/types/vietnamese-plugin";

export const vietnamesePluginState = cache(async (salonId: string | null): Promise<VietnamesePluginState> => {
  if (!salonId) return EMPTY_VIETNAMESE_PLUGIN;
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) return EMPTY_VIETNAMESE_PLUGIN;
  const { data, error } = await client.rpc("vietnamese_plugin_state", { p_salon: salonId });
  if (error) throw new Error("Vietnamese plugin could not load. Please try again later.");
  return data ?? EMPTY_VIETNAMESE_PLUGIN;
});
