"use server";
import { taxActivationHref } from "@/lib/tax-activation";
import { revalidatePath } from "next/cache";
import { marketPluginContext } from "@/lib/market-plugins";
import { checkWriterTrialReady } from "@/lib/check-writer-readiness";
import { marketServiceClient } from "@/lib/market-payments";
import { MARKET_TRIAL_PLUGINS } from "@/lib/market-access";

export async function marketTrialAction(pluginId: string, start = false, expectedSalonId?: string):Promise<{activationHref?:string;state?:{started:boolean;active:boolean;endsAt:string|null;paid:boolean};error?:string}> {
  try {
    if (!MARKET_TRIAL_PLUGINS.some(id => id === pluginId)) throw new Error("This plugin uses its own free activation.");
    const { client, salonId, userId } = await marketPluginContext();
    if (!expectedSalonId || expectedSalonId !== salonId) throw new Error("Your salon changed. Reopen this plugin before starting a trial.");
    if (pluginId === "print-check" && start && !checkWriterTrialReady()) throw new Error("Check Writer trial is being configured. Please try again later.");
    const { data, error } = pluginId === "print-check"
      ? await marketServiceClient().rpc("check_writer_trial", { p_salon: salonId, p_actor: userId, p_start: start === true })
      : await client.rpc("market_plugin_trial", { p_salon: salonId, p_plugin: pluginId, p_start: start === true });
    if (error) throw new Error(pluginId === "print-check" ? "The Check Writer trial is unavailable for this owner. Reopen Market or contact Reylumi." : "Trial access could not be loaded. Please retry or contact Reylumi.");
    if (start) {
      for (const path of ["/market", "/settings", "/bookings", "/payroll", "/pos", "/check-writer", `/book/${salonId}`]) revalidatePath(path);
    }
    return { activationHref: start && pluginId === "tax-company" && data?.active ? taxActivationHref(salonId) : undefined, state: data as { started: boolean; active: boolean; endsAt: string | null; paid: boolean } };
  } catch (error) { return { error: error instanceof Error ? error.message : "Trial access is unavailable." }; }
}
