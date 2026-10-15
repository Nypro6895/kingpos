import "server-only";
import { getCurrentBusinessContext, isOwnerMembership, isSalonManageContext } from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export const PAYROLL_DATA_PLUGIN = "payroll-data-download";

export async function marketPluginContext() {
  const context = await getCurrentBusinessContext();
  if (!context.user || !context.currentSalon || !isSalonManageContext(context) || !isOwnerMembership(context.currentMembership) || context.currentSalon.status !== "active") {
    throw new Error("Choose an active salon in your Owner workspace to manage this feature.");
  }
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Please sign in again.");
  return { client, salonId: context.currentSalon.id };
}

export async function payrollDataPluginInstalled() {
  const { client, salonId } = await marketPluginContext();
  const { data, error } = await client.from("salon_market_plugins").select("plugin_id").eq("salon_id", salonId).eq("plugin_id", PAYROLL_DATA_PLUGIN).maybeSingle();
  if (error) throw new Error("Market features could not be loaded. Please try again later.");
  return Boolean(data);
}
