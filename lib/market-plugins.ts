import "server-only";
import { resolveMarketTarget } from "@/lib/market-target-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export const PAYROLL_DATA_PLUGIN = "payroll-data-download";

export class MarketOwnerContextError extends Error {
  constructor(
    message: string,
    readonly reason: "denied" | "signin" = "denied",
  ) {
    super(message);
  }
}

export async function marketPluginContext(targetSalonId?: string) {
  const context = await resolveMarketTarget(targetSalonId);
  const client = await createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true });
  if (!client) throw new MarketOwnerContextError("Please sign in again.", "signin");
  return { client, salonId: context.currentSalon.id, userId: context.user.id };
}

export async function payrollDataPluginInstalled() {
  const { client, salonId } = await marketPluginContext();
  const { data, error } = await client
    .from("salon_market_plugins")
    .select("plugin_id")
    .eq("salon_id", salonId)
    .eq("plugin_id", PAYROLL_DATA_PLUGIN)
    .maybeSingle();
  if (error)
    throw new Error(
      "Market features could not be loaded. Please try again later.",
    );
  return Boolean(data);
}
