"use server";
import { revalidatePath } from "next/cache";
import { marketPluginContext } from "@/lib/market-plugins";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { marketServiceClient, marketStripe, vietnameseCheckout } from "@/lib/market-payments";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";
import type { VietnamesePluginState } from "@/types/vietnamese-plugin";

export async function setVietnamesePlugin(installed: boolean, staff: boolean, portable: boolean): Promise<{ state?: VietnamesePluginState; error?: string }> {
  try {
    const { client, salonId } = await marketPluginContext();
    if ([installed, staff, portable].some(value => typeof value !== "boolean")) throw new Error("Invalid plugin options.");
    if (!installed) {
      const service = marketServiceClient();
      const { data: subscription, error: readError } = await service.from("vietnamese_plugin_subscriptions").select("stripe_subscription,checkout_session").eq("salon_id", salonId).maybeSingle();
      if (readError) throw new Error("Subscription could not be checked.");
      if (subscription?.checkout_session) {
        const checkout = await marketStripe(`checkout/sessions/${subscription.checkout_session}`);
        if (checkout.status === "open") await marketStripe(`checkout/sessions/${subscription.checkout_session}/expire`, new URLSearchParams());
        if (checkout.status === "complete" && !subscription.stripe_subscription) throw new Error("Payment is being confirmed. Refresh Market before removing the plugin.");
        const { error: clearError } = await service.from("vietnamese_plugin_subscriptions").update({ checkout_session: null, checkout_reference: null, checkout_owner: null }).eq("salon_id", salonId);
        if (clearError) throw new Error("Checkout could not be cleared.");
      }
      if (subscription?.stripe_subscription) await marketStripe(`subscriptions/${subscription.stripe_subscription}`, new URLSearchParams({ cancel_at_period_end: "true" }));
    }
    const { data, error } = await client.rpc("vietnamese_plugin_set", { p_salon: salonId, p_install: installed, p_staff: staff, p_portable: portable });
    if (error) throw new Error(error.message);
    revalidatePath("/", "layout");
    return { state: data };
  } catch (error) { return { error: error instanceof Error ? error.message : "Plugin could not be updated." }; }
}
export async function vietnamesePaymentAction(portal = false): Promise<{ url?: string; error?: string }> {
  try {
    const { salonId } = await marketPluginContext();
    const context = await getCurrentBusinessContext();
    if (!context.user) throw new Error("Please sign in again.");
    if (!portal) return { url: await vietnameseCheckout(salonId, context.user.id) };
    const { data: row, error } = await marketServiceClient().from("vietnamese_plugin_subscriptions").select("stripe_customer,payment_owner").eq("salon_id", salonId).single();
    if (error || !row?.stripe_customer || row.payment_owner !== context.user.id) throw new Error("Only the subscription payer can manage its billing.");
    const session = await marketStripe("billing_portal/sessions", new URLSearchParams({ customer: row.stripe_customer, return_url: new URL("/market", REYLUMI_METADATA_BASE).href }));
    if (typeof session.url !== "string" || new URL(session.url).hostname !== "billing.stripe.com") throw new Error("Billing portal could not open.");
    return { url: session.url };
  } catch (error) { return { error: error instanceof Error ? error.message : "Payment could not open." }; }
}
