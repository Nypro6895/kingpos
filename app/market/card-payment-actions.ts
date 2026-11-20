"use server";
import { taxOwnerReturnPath, taxPaymentReturnPath } from "@/lib/tax-flow";
import { taxActivationHref } from "@/lib/tax-activation";
import { marketPluginContext } from "@/lib/market-plugins";
import { marketServiceClient } from "@/lib/market-payments";
import { paymentConfig, paymentStripe } from "@/lib/platform-payment";
import { syncCardSubscription } from "@/lib/market-card";
import { checkWriterSalesReady } from "@/lib/check-writer-readiness";
import { CARD_PLUGINS } from "@/lib/market-card-rules";
import { applyMarketTaxToCheckout } from "@/lib/market-tax";
import { revalidatePath } from "next/cache";
import { isMarketCheckoutURL } from "@/lib/market-checkout-url";
type CheckoutResult = {
  clientSecret?: string;
  publishableKey?: string;
  checkoutUrl?: string;
  message?: string;
  complete?: boolean;
  activationHref?: string;
  billingPortalUrl?: string;
};
export async function manageCardSubscription(
  pluginId: string,
  taxReturnPath?: string,
  expectedSalonId?: string,
) {
  try {
    if (!CARD_PLUGINS.some((id) => id === pluginId))
      throw Error("Unsupported plugin.");
    const { salonId, userId } = await marketPluginContext();
    const { data, error } = await marketServiceClient()
      .from("market_card_purchases")
      .select("payer_id,customer_id,snapshot")
      .eq("salon_id", salonId)
      .eq("plugin_id", pluginId)
      .not("subscription_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const config = await paymentConfig();
    if (
      error ||
      !data?.customer_id ||
      data.payer_id !== userId ||
      data.snapshot?.account_id !== config.accountId
    )
      throw Error(
        "Only the subscription payer can manage this billing account.",
      );
    if (expectedSalonId && salonId !== expectedSalonId)
      throw Error("The selected salon changed. Refresh before paying.");
    const target =
      pluginId === "tax-company"
        ? taxPaymentReturnPath(taxReturnPath, salonId)
        : undefined;
    const form = new URLSearchParams({
      customer: data.customer_id,
      return_url: target
        ? "https://reylumi.com" + target
        : `https://reylumi.com/market?salon=${encodeURIComponent(salonId)}`,
    });
    if (config.portalConfigurationId)
      form.set("configuration", config.portalConfigurationId);
    const portal = await paymentStripe(
      "billing_portal/sessions",
      form,
      undefined,
      config,
    );
    const url = new URL(portal.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "billing.stripe.com" ||
      url.username ||
      url.password ||
      url.port
    )
      throw Error("Billing portal could not open.");
    return { url: url.href };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Billing portal could not open.",
    };
  }
}
export async function startCardCheckout(
  pluginId: string,
  external = false,
  taxReturnPath?: string,
  expectedSalonId?: string,
): Promise<CheckoutResult> {
  if (pluginId === "print-check" && !checkWriterSalesReady())
    return {
      message: "Check Writer is being configured. Please try again later.",
    };
  return prepareCardCheckout(
    pluginId,
    external === true,
    0,
    taxReturnPath,
    expectedSalonId,
  );
}
async function prepareCardCheckout(
  pluginId: string,
  external: boolean,
  attempt: number,
  taxReturnPath?: string,
  expectedSalonId?: string,
): Promise<CheckoutResult> {
  try {
    if (attempt >= 3)
      throw Error(
        "Checkout changed in another window. Refresh Market before trying again.",
      );
    if (!CARD_PLUGINS.some((id) => id === pluginId))
      throw Error("This plugin is not ready for card checkout.");
    const { client, salonId } = await marketPluginContext(),
      config = await paymentConfig();
    if (expectedSalonId && salonId !== expectedSalonId)
      throw Error("The selected salon changed. Refresh before paying.");
    const returnPath =
      pluginId === "tax-company"
        ? taxOwnerReturnPath(taxReturnPath, salonId)
        : undefined;
    if (taxReturnPath && !returnPath) throw Error("Invalid return page.");
    if (!config.enabled || config.mode !== "live" || !config.webhookSecret)
      throw Error("Card payments are being connected. Please try again later.");
    const { data: row, error } = await client.rpc("market_card_reserve_target", {p_salon:salonId,p_plugin:pluginId,p_external:external,p_tax_return:returnPath ? new URL(returnPath,"https://reylumi.com").pathname : null});
    if (error || !row)
      throw Error(error?.message ?? "Checkout could not start.");
    const scopedReturn = row.snapshot.market_target_return_version === 1;
    let savedSubscriptionActive = false;
    const destination = () =>
      taxOwnerReturnPath(row.snapshot.tax_return_path, salonId) ??
      taxActivationHref(salonId);
    if (row.subscription_id) {
      savedSubscriptionActive = await syncCardSubscription(row.subscription_id);
      revalidatePath("/market");
      if (!savedSubscriptionActive && returnPath) {
        const portal = await manageCardSubscription(
          pluginId,
          returnPath,
          salonId,
        );
        if (portal.url)
            return {
              billingPortalUrl: portal.url,
              message:
                "Review the outstanding subscription payment in secure billing.",
            };
        throw Error(portal.error ?? "Subscription payment needs review.");
      }
      if (savedSubscriptionActive) return {
        complete: true,
        message: "Subscription refreshed.",
        ...(savedSubscriptionActive && pluginId === "tax-company"
          ? { activationHref: destination() }
          : {}),
      };
      if (!row.session_id)
        throw Error(
          "No active paid access confirmed yet. Manage your existing subscription or contact support before paying again.",
        );
    }
    let session;
    if (row.session_id) {
      session = await paymentStripe(
        `checkout/sessions/${row.session_id}`,
        undefined,
        undefined,
        config,
      );
      if (session.status === "expired") {
        if (row.subscription_id || session.subscription)
          throw Error(
            "This checkout is no longer open. Review the existing subscription before paying again.",
          );
        const { error } = await marketServiceClient()
          .from("market_card_purchases")
          .update({ status: "expired" })
          .eq("id", row.id)
          .in("status", ["creating", "open"]);
        if (error) throw Error("Checkout could not reset.");
        return prepareCardCheckout(
          pluginId,
          external,
          attempt + 1,
          taxReturnPath,
          expectedSalonId,
        );
      }
      if (session.status === "complete") {
        const active =
          typeof session.subscription === "string" &&
          (session.subscription === row.subscription_id
            ? savedSubscriptionActive
            : await syncCardSubscription(session.subscription));
        revalidatePath("/market");
        return active
          ? {
              complete: true,
              message: "Payment confirmed. Your plugin is ready.",
              ...(pluginId === "tax-company"
                ? { activationHref: destination() }
                : {}),
            }
          : {
              message:
                "No active paid access confirmed yet. Manage your existing subscription or contact support before paying again.",
            };
      }
    } else {
      if (Date.now() - Date.parse(row.created_at) > 23 * 60 * 60 * 1000)
        throw Error(
          "This checkout needs payment reconciliation. Contact support.",
        );
      const form = new URLSearchParams({
        mode: "subscription",
        ui_mode: "embedded",
        redirect_on_completion: "if_required",
        return_url:
          pluginId === "tax-company" &&
          row.snapshot.tax_activation_setup === true
            ? `https://reylumi.com${taxPaymentReturnPath(row.snapshot.tax_return_path, salonId) ?? taxActivationHref(salonId, true)}`
            : scopedReturn ? `https://reylumi.com/market?payment=received&salon=${encodeURIComponent(salonId)}` : "https://reylumi.com/market?payment=received",
        "payment_method_types[0]": "card",
        "saved_payment_method_options[payment_method_save]": "enabled",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(row.amount_cents),
        "line_items[0][price_data][recurring][interval]": "month",
        "line_items[0][price_data][product_data][name]": `Reylumi ${row.snapshot.name}`,
        "line_items[0][price_data][product_data][description]":
          row.snapshot.automatic_tax?.enabled === true
            ? "Monthly access. Final tax is calculated at checkout using your billing address. Cancel future renewal in Manage subscription."
            : "Monthly access. Total includes configured tax and fees. Cancel future renewal in Manage subscription.",
        "metadata[market_card_purchase]": row.id,
        "subscription_data[metadata][market_card_purchase]": row.id,
        "subscription_data[metadata][salon_id]": salonId,
        "subscription_data[metadata][plugin_id]": pluginId,
      });
      if (row.snapshot.checkout_ui_mode === "hosted") {
        form.set("ui_mode", "hosted");
        form.delete("redirect_on_completion");
        form.delete("return_url");
        form.set(
          "success_url",
          pluginId === "tax-company" &&
            row.snapshot.tax_activation_setup === true
            ? `https://reylumi.com/market/payment-return?plugin=tax-company&salon=${salonId}${row.snapshot.tax_return_path ? "&return=" + encodeURIComponent(row.snapshot.tax_return_path) : ""}`
            : scopedReturn ? `https://reylumi.com/market/payment-return?salon=${encodeURIComponent(salonId)}` : "https://reylumi.com/market/payment-return",
        );
        form.set(
          "cancel_url",
          pluginId === "tax-company" && row.snapshot.tax_return_path
            ? `https://reylumi.com/market/payment-return?cancelled=1&plugin=tax-company&salon=${salonId}&return=${encodeURIComponent(row.snapshot.tax_return_path)}`
            : scopedReturn ? `https://reylumi.com/market/payment-return?cancelled=1&salon=${encodeURIComponent(salonId)}` : "https://reylumi.com/market/payment-return?cancelled=1",
        );
      }
      if (row.snapshot.customer_id)
        form.set("customer", row.snapshot.customer_id);
      else if (row.snapshot.customer_email)
        form.set("customer_email", row.snapshot.customer_email);
      await applyMarketTaxToCheckout(form, row);
      session = await paymentStripe(
        "checkout/sessions",
        form,
        `market-card:${row.id}`,
        config,
      );
      const { error } = await marketServiceClient()
        .from("market_card_purchases")
        .update({ session_id: session.id, status: "open" })
        .eq("id", row.id)
        .eq("status", "creating");
      if (error)
        throw Error("Checkout is reserved. Retry to recover the same payment.");
    }
    if (row.snapshot.checkout_ui_mode === "hosted") {
      if (!isMarketCheckoutURL(session.url))
        throw Error("Secure checkout could not open. Please retry.");
      return { checkoutUrl: session.url };
    }
    if (external) {
      if (row.subscription_id || session.subscription)
        throw Error(
          "Continue the existing subscription checkout where it was started, or contact support before paying again.",
        );
      // Retire the old embedded session before reserving a hosted replacement.
      // A failed expiration (including a concurrent payment) must never create a
      // second subscription. Reconciliation handles a checkout already completed.
      const expired = await paymentStripe(
        `checkout/sessions/${session.id}/expire`,
        new URLSearchParams(),
        undefined,
        config,
      );
      if (expired.status !== "expired")
        throw Error(
          "The previous checkout is being confirmed. Check payment status before trying again.",
        );
      const { error } = await marketServiceClient()
        .from("market_card_purchases")
        .update({ status: "expired" })
        .eq("id", row.id)
        .in("status", ["creating", "open"]);
      if (error) throw Error("Checkout could not reset. Please retry.");
      return prepareCardCheckout(
        pluginId,
        true,
        attempt + 1,
        taxReturnPath,
        expectedSalonId,
      );
    }
    if (typeof session.client_secret !== "string")
      throw Error("Card form could not load.");
    return {
      clientSecret: session.client_secret,
      publishableKey: config.publishableKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Checkout is unavailable.",
    };
  }
}
export async function refreshCardPurchase(
  pluginId: string,
  expectedSalonId?: string,
): Promise<{
  active: boolean;
  salonId?: string;
  activationHref?: string;
  message: string;
}> {
  try {
    const { salonId } = await marketPluginContext();
    if (expectedSalonId && salonId !== expectedSalonId)
      throw Error("The selected salon changed.");
    const { data, error } = await marketServiceClient()
      .from("market_card_purchases")
      .select("subscription_id,session_id,snapshot")
      .eq("salon_id", salonId)
      .eq("plugin_id", pluginId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) throw Error("Payment could not be checked.");
    let subscription = data.subscription_id;
    if (!subscription && data.session_id) {
      const session = await paymentStripe(
        `checkout/sessions/${data.session_id}`,
      );
      subscription = session.subscription;
    }
    const active =
      typeof subscription === "string" &&
      (await syncCardSubscription(subscription));
    revalidatePath("/market");
    return {
      active: Boolean(active),
      salonId,
      message: active
        ? "Payment confirmed. Your plugin is ready."
        : "No active paid access confirmed yet. Check payment status or contact support.",
      ...(active && pluginId === "tax-company"
        ? {
            activationHref:
              taxOwnerReturnPath(data.snapshot?.tax_return_path, salonId) ??
              taxActivationHref(salonId),
          }
        : {}),
    };
  } catch {
    return {
      active: false,
      message:
        "Payment confirmation is pending. It will retry automatically; do not pay again.",
    };
  }
}
