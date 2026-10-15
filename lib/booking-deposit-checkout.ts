import "server-only";
import { marketPluginContext } from "@/lib/market-plugins";
import { marketServiceClient } from "@/lib/market-payments";
import { paymentConfig, paymentStripe } from "@/lib/platform-payment";
import { syncCardSubscription } from "@/lib/market-card";
import { applyMarketTaxToCheckout } from "@/lib/market-tax";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";

export async function prepareBookingDepositCheckout(expectedSalonId: string) {
  const { client, salonId } = await marketPluginContext();
  if (salonId !== expectedSalonId) throw new Error("Your salon changed. Reload this page before continuing.");
  const config = await paymentConfig();
  if (!config.enabled || config.mode !== "live" || !config.webhookSecret) throw new Error("Payment is unavailable. Please try again later.");
  const successUrl = new URL(`/market/booking-deposit/payment?salon=${encodeURIComponent(salonId)}`, REYLUMI_METADATA_BASE).href;
  const cancelUrl = new URL("/market/booking-deposit?cancelled=1", REYLUMI_METADATA_BASE).href;
  for (let attempt = 0; attempt < 3; attempt++) {
    // The existing reservation locks salon/plugin access and freezes price/tax.
    // No new schema or changes to checkout for other plugins are required.
    const { data: row, error } = await client.rpc("market_card_reserve", { p_salon: salonId, p_plugin: "booking-deposit" });
    if (error || !row) throw new Error(error?.message || "Payment could not open. Please try again.");
    if (row.subscription_id) return { complete: await syncCardSubscription(row.subscription_id) };
    let session;
    if (row.session_id) {
      session = await paymentStripe(`checkout/sessions/${row.session_id}`, undefined, undefined, config);
      if (session.status === "complete") return { complete: typeof session.subscription === "string" && await syncCardSubscription(session.subscription) };
      if (session.status === "open" && session.ui_mode === "hosted" && session.success_url === successUrl) return { url: checkoutUrl(session.url) };
      if (session.status === "open") {
        const expired = await paymentStripe(`checkout/sessions/${row.session_id}/expire`, new URLSearchParams(), undefined, config);
        if (expired.status !== "expired") throw new Error("Payment is still being confirmed. Check again in a moment.");
      } else if (session.status !== "expired") throw new Error("Payment is still being confirmed. Check again in a moment.");
      const { error: resetError } = await marketServiceClient().from("market_card_purchases").update({ status: "expired" })
        .eq("id", row.id).in("status", ["creating", "open"]);
      if (resetError) throw new Error("Payment is still being confirmed. Check again in a moment.");
      continue;
    }
    if (Date.now() - Date.parse(row.created_at) > 23 * 60 * 60 * 1000) throw new Error("This checkout needs payment reconciliation. Contact support.");
    const form = new URLSearchParams({
      mode: "subscription", ui_mode: "hosted", success_url: successUrl, cancel_url: cancelUrl,
      "payment_method_types[0]": "card", "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": String(row.amount_cents),
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][price_data][product_data][name]": `Reylumi ${row.snapshot.name}`,
      "line_items[0][price_data][product_data][description]": "Monthly access for your salon. Cancel future renewal in Manage subscription.",
      "metadata[market_card_purchase]": row.id, "subscription_data[metadata][market_card_purchase]": row.id,
      "subscription_data[metadata][salon_id]": salonId, "subscription_data[metadata][plugin_id]": "booking-deposit",
    });
    if (row.snapshot.customer_id) form.set("customer", row.snapshot.customer_id);
    else if (row.snapshot.customer_email) form.set("customer_email", row.snapshot.customer_email);
    await applyMarketTaxToCheckout(form, row);
    session = await paymentStripe("checkout/sessions", form, `market-card:${row.id}`, config);
    const { error: saveError } = await marketServiceClient().from("market_card_purchases")
      .update({ session_id: session.id, status: "open" }).eq("id", row.id).eq("status", "creating");
    if (saveError) throw new Error("Checkout is reserved. Retry to recover the same payment.");
    return { url: checkoutUrl(session.url) };
  }
  throw new Error("Payment is still being confirmed. Check again in a moment.");
}

function checkoutUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("Payment could not open. Please try again.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password || url.port) throw new Error("Payment could not open. Please try again.");
  return url.href;
}
