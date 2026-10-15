import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";
import { VIETNAMESE_MONTHLY_CENTS } from "@/types/vietnamese-plugin";
import { randomUUID } from "node:crypto";

export function marketServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Market storage is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function marketPaymentReady() { return Boolean(process.env.MARKET_STRIPE_SECRET_KEY && process.env.MARKET_STRIPE_WEBHOOK_SECRET); }
export async function marketStripe(path: string, form?: URLSearchParams, idempotencyKey?: string) {
  const secret = process.env.MARKET_STRIPE_SECRET_KEY;
  if (!secret) { const {paymentStripe,paymentConfig}=await import("./platform-payment"); const config=await paymentConfig(); if(path==="billing_portal/sessions"&&form&&config.portalConfigurationId)form.set("configuration",config.portalConfigurationId); return paymentStripe(path,form,idempotencyKey,config); }
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? "POST" : "GET", headers: { Authorization: `Bearer ${secret}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: form?.toString(), cache: "no-store", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("Market payment could not be completed. Please try again.");
  return await response.json();
}
export async function marketPaymentSettings() {
  const { data, error } = await marketServiceClient().from("market_payment_settings").select("enabled,vietnamese_published,booking_deposit_test_enabled").eq("id", true).single();
  if (error || !data) throw new Error("Market settings could not load. Apply the Market migration.");
  return data;
}
export async function assertLegacyMarketCheckoutAllowed() {
  const { data, error } = await marketServiceClient().rpc("market_billing_public_catalog");
  // During rollout an older database may not yet have the bank billing RPC.
  if (error && ["PGRST202", "42883"].includes(error.code)) return;
  if (error || !data) throw new Error("Payment availability could not be checked. Refresh Market and try again.");
  throw new Error("New purchases use Buy with card in Market. Existing Stripe subscriptions can still be managed through Manage subscription.");
}
export async function prepareMarketBankPurchase(salonId: string, pluginId: string) {
  const tables: Record<string, string> = { "booksms": "booksms_subscriptions", "tax-company": "tax_company_subscriptions", "vietnamese-language": "vietnamese_plugin_subscriptions", "booking-policy": "booking_policy_subscriptions", "booking-deposit": "booking_deposit_subscriptions", "checkin-receipt": "checkin_receipt_subscriptions" };
  const table = tables[pluginId];
  if (!table) throw new Error("This plugin is not ready for payment.");
  const client = marketServiceClient();
  const checkoutColumn = pluginId === "vietnamese-language" ? "checkout_session" : "stripe_checkout";
  const { data, error } = await client.from(table).select(`stripe_subscription,${checkoutColumn}`).eq("salon_id", salonId).maybeSingle();
  if (error) throw new Error("Existing billing could not be checked. Please retry.");
  const row = data as { stripe_subscription?: string | null; checkout_session?: string | null; stripe_checkout?: string | null } | null;
  if (row?.stripe_subscription) throw new Error("Manage or cancel your existing Stripe subscription first. You cannot pay twice for the same plugin period.");
  const checkout = row?.[checkoutColumn];
  if (!checkout) return;
  if (typeof checkout !== "string" || !/^cs_[a-zA-Z0-9_]+$/.test(checkout)) throw new Error("The previous checkout needs billing support.");
  const session = await marketStripe(`checkout/sessions/${checkout}`);
  if (session.status === "complete") throw new Error("Your earlier payment is being confirmed. Refresh Market before starting another payment.");
  if (session.status === "open") {
    const expired = await marketStripe(`checkout/sessions/${checkout}/expire`, new URLSearchParams());
    if (expired.status !== "expired") throw new Error("The previous checkout could not be closed. Please retry.");
  }
  else if (session.status !== "expired") throw new Error("The previous checkout could not be closed. Please retry.");
  const clearing = pluginId === "vietnamese-language" ? { checkout_session: null, checkout_reference: null, checkout_owner: null } : { stripe_checkout: null, checkout_reference: randomUUID() };
  const { error: clearError } = await client.from(table).update(clearing).eq("salon_id", salonId).eq(checkoutColumn, checkout).is("stripe_subscription", null);
  if (clearError) throw new Error("The previous checkout could not be cleared. Please retry.");
}
export async function vietnameseCheckout(salonId: string, ownerId: string) {
  await assertLegacyMarketCheckoutAllowed();
  const client = marketServiceClient();
  const settings = await marketPaymentSettings();
  if (!marketPaymentReady() || !settings.enabled) throw new Error("Payments are not connected yet. Contact Reylumi to continue after your trial.");
  const { data: plugin, error } = await client.from("vietnamese_plugin_subscriptions").select("*").eq("salon_id", salonId).single();
  if (error || !plugin?.installed) throw new Error("Start your trial before subscribing.");
  if (plugin.stripe_subscription) throw new Error("A subscription already exists. Use Manage subscription.");
  if (plugin.paid_until && Date.parse(plugin.paid_until) > Date.now()) throw new Error("Your paid access is still active. Subscribe again after the current paid period ends.");
  if (Date.parse(plugin.trial_ends_at) > Date.now()) throw new Error("Your free trial is still active. Subscribe after it ends; your full 5 days are free.");
  const { data: reference, error: claimError } = await client.rpc("vietnamese_checkout_claim", { p_salon: salonId, p_owner: ownerId });
  if (claimError || !reference) throw new Error(claimError?.message ?? "Checkout could not be prepared.");
  if (plugin.checkout_session) {
    const previous = await marketStripe(`checkout/sessions/${plugin.checkout_session}`);
    if (previous.status === "open" && typeof previous.url === "string" && new URL(previous.url).hostname === "checkout.stripe.com") return previous.url as string;
    if (previous.status === "complete") throw new Error("Payment is being confirmed. Please refresh Market shortly.");
    const { error: resetError } = await client.from("vietnamese_plugin_subscriptions").update({ checkout_reference: null, checkout_owner: null, checkout_session: null }).eq("salon_id", salonId).eq("checkout_reference", reference);
    if (resetError) throw new Error("Checkout could not reset.");
    return vietnameseCheckout(salonId, ownerId);
  }
  const form = new URLSearchParams({ mode: "subscription",
    success_url: new URL("/market?payment=received", REYLUMI_METADATA_BASE).href,
    cancel_url: new URL("/market?payment=cancelled", REYLUMI_METADATA_BASE).href,
    "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(VIETNAMESE_MONTHLY_CENTS),
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": "Reylumi Vietnamese Language",
    "subscription_data[metadata][reylumi_plugin]": "vietnamese-language",
    "subscription_data[metadata][salon_id]": salonId,
    "subscription_data[metadata][owner_id]": ownerId,
    "payment_method_types[0]": "card",
    "metadata[vietnamese_checkout]": reference,
    "metadata[salon_id]": salonId,
  });
  const session = await marketStripe("checkout/sessions", form, `vi-checkout:${reference}`);
  if (typeof session.url !== "string" || new URL(session.url).hostname !== "checkout.stripe.com") throw new Error("Secure checkout could not open.");
  const { error: saveError } = await client.from("vietnamese_plugin_subscriptions").update({ checkout_session: session.id }).eq("salon_id", salonId).eq("checkout_reference", reference);
  if (saveError) throw new Error("Checkout could not be recorded. Please retry.");
  return session.url as string;
}
export function verifyMarketWebhook(payload: string, signature: string) {
  const secret = process.env.MARKET_STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;
  const parts = signature.split(","), timestamp = parts.find(part => part.startsWith("t="))?.slice(2);
  if (!timestamp || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  return parts.filter(part => part.startsWith("v1=")).some(part => {
    const actual = Buffer.from(part.slice(3), "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
export async function syncVietnameseSubscription(subscriptionId: string) {
  if (!/^sub_[a-zA-Z0-9]+$/.test(subscriptionId)) throw new Error("Invalid subscription.");
  // Retrieve current Stripe state rather than trusting event ordering or redirect parameters.
  const subscription = await marketStripe(`subscriptions/${subscriptionId}?expand[]=latest_invoice`);
  if (subscription.metadata?.reylumi_plugin !== "vietnamese-language") return;
  const salonId = subscription.metadata?.salon_id, ownerId = subscription.metadata?.owner_id;
  if (!/^[0-9a-f-]{36}$/i.test(salonId ?? "") || !/^[0-9a-f-]{36}$/i.test(ownerId ?? "")) throw new Error("Invalid subscription metadata.");
  const item = subscription.items?.data?.[0];
  if (subscription.items?.data?.length !== 1 || item?.quantity !== 1 || item?.price?.unit_amount !== 399 || item?.price?.currency !== "usd" || item?.price?.recurring?.interval !== "month" || item?.price?.recurring?.interval_count !== 1) throw new Error("Invalid plugin price.");
  const client = marketServiceClient();
  const { data: row, error: readError } = await client.from("vietnamese_plugin_subscriptions").select("stripe_subscription").eq("salon_id", salonId).single();
  if (readError || !row) throw new Error("Plugin is not installed.");
  // A replay of an old cancellation must not clear a newer checkout reservation.
  if (subscription.status === "canceled" && row.stripe_subscription !== subscriptionId) return;
  if (row.stripe_subscription && row.stripe_subscription !== subscriptionId) return;
  const end = item.current_period_end ?? subscription.current_period_end;
  const paidUntil = ["active", "canceled"].includes(subscription.status) && subscription.latest_invoice?.status === "paid" && typeof end === "number" ? new Date(end * 1000).toISOString() : null;
  const { error } = await client.from("vietnamese_plugin_subscriptions").update({
    stripe_subscription: subscription.status === "canceled" ? null : subscriptionId, stripe_customer: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    payment_owner: ownerId, paid_until: paidUntil, updated_at: new Date().toISOString(),
    checkout_reference: null, checkout_owner: null, checkout_session: null,
  }).eq("salon_id", salonId);
  if (error) throw new Error("Subscription could not be recorded.");
}

