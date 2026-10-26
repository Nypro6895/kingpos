import "server-only";
import { randomUUID } from "node:crypto";
import { marketServiceClient, marketStripe, marketPaymentReady, marketPaymentSettings, assertLegacyMarketCheckoutAllowed } from "@/lib/market-payments";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";
import { CHECKIN_RECEIPT_PLUGIN, CHECKIN_RECEIPT_MONTHLY_CENTS, type CheckinReceiptSubscription } from "@/types/checkin-receipt";

export async function checkinReceiptSubscription(salonId: string): Promise<CheckinReceiptSubscription> {
  const { data, error } = await marketServiceClient().from("checkin_receipt_subscriptions").select("paid_until,stripe_subscription").eq("salon_id", salonId).maybeSingle();
  if (error) throw new Error("Check-in Receipt requires the latest database update.");
  return { active: Boolean(data?.paid_until && Date.parse(data.paid_until) > Date.now()), subscribed: Boolean(data?.stripe_subscription) };
}
export async function syncCheckinReceiptSubscription(id: string) {
  if (!/^sub_[a-zA-Z0-9]+$/.test(id)) throw new Error("Invalid subscription.");
  const subscription = await marketStripe(`subscriptions/${id}?expand[]=latest_invoice`);
  if (subscription.metadata?.reylumi_plugin !== CHECKIN_RECEIPT_PLUGIN) return;
  const salonId = subscription.metadata?.salon_id, ownerId = subscription.metadata?.owner_id;
  if (![salonId, ownerId].every(value => /^[0-9a-f-]{36}$/i.test(value ?? ""))) throw new Error("Invalid subscription metadata.");
  const item = subscription.items?.data?.[0];
  if (subscription.items?.data?.length !== 1 || item.quantity !== 1 || item.price?.unit_amount !== CHECKIN_RECEIPT_MONTHLY_CENTS || item.price?.currency !== "usd" || item.price?.recurring?.interval !== "month" || item.price?.recurring?.interval_count !== 1) throw new Error("Invalid receipt plugin price.");
  const client = marketServiceClient();
  const { data: row, error: readError } = await client.from("checkin_receipt_subscriptions").select("stripe_subscription,payment_owner").eq("salon_id", salonId).single();
  if (readError || !row || row.payment_owner !== ownerId) throw new Error("Subscription is not linked to this salon.");
  if (subscription.status === "canceled" && row.stripe_subscription !== id) return;
  if (row.stripe_subscription && row.stripe_subscription !== id) throw new Error("Subscription is not linked to this salon.");
  const end = item.current_period_end ?? subscription.current_period_end;
  const { error } = await client.from("checkin_receipt_subscriptions").update({ stripe_subscription: subscription.status === "canceled" ? null : id,
    stripe_customer: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    paid_until: ["active", "canceled"].includes(subscription.status) && subscription.latest_invoice?.status === "paid" && typeof end === "number" ? new Date(end * 1000).toISOString() : null,
    ...(subscription.status === "canceled" ? { stripe_checkout: null, checkout_reference: randomUUID() } : {}),
    updated_at: new Date().toISOString() }).eq("salon_id", salonId);
  if (error) throw new Error("Receipt subscription could not be saved.");
}
export async function checkinReceiptPayment(salonId: string, ownerId: string, portal: boolean) {
  const client = marketServiceClient();
  const { data: row, error } = await client.from("checkin_receipt_subscriptions").select("stripe_subscription,stripe_checkout,stripe_customer,payment_owner,checkout_reference,paid_until").eq("salon_id", salonId).maybeSingle();
  if (error) throw new Error("Apply the Check-in Receipt database update first.");
  if (portal) {
    if (!row?.stripe_customer || row.payment_owner !== ownerId) throw new Error("Only the subscription payer can manage billing.");
    const session = await marketStripe("billing_portal/sessions", new URLSearchParams({ customer: row.stripe_customer, return_url: new URL("/market", REYLUMI_METADATA_BASE).href }));
    if (typeof session.url !== "string" || new URL(session.url).hostname !== "billing.stripe.com") throw new Error("Billing portal could not open.");
    return session.url as string;
  }
  await assertLegacyMarketCheckoutAllowed();
  if (row?.stripe_subscription) throw new Error("Use Manage subscription to update your plan.");
  if (row?.paid_until && Date.parse(row.paid_until) > Date.now()) throw new Error("Your paid access is still active. Subscribe again after the current paid period ends.");
  if (row?.payment_owner && row.payment_owner !== ownerId) throw new Error("Another owner has started checkout. Contact that owner to continue.");
  if (!marketPaymentReady() || !(await marketPaymentSettings()).enabled) throw new Error("Market payments are not connected yet.");
  if (row?.stripe_checkout) {
    if (!/^cs_[a-zA-Z0-9_]+$/.test(row.stripe_checkout)) throw new Error("Invalid checkout session.");
    const pending = await marketStripe(`checkout/sessions/${row.stripe_checkout}`);
    if (pending.status === "complete") throw new Error("Payment is being confirmed. Refresh Market shortly.");
    if (pending.status === "open") {
      if (typeof pending.url !== "string" || new URL(pending.url).hostname !== "checkout.stripe.com") throw new Error("Secure checkout could not open.");
      return pending.url as string;
    }
    if (pending.status !== "expired") throw new Error("Checkout could not be checked. Please retry.");
  }
  if (!row || !row.payment_owner) {
    const { error: insertError } = row ? await client.from("checkin_receipt_subscriptions").update({ payment_owner: ownerId }).eq("salon_id", salonId).is("payment_owner", null).select("salon_id").single() : await client.from("checkin_receipt_subscriptions").insert({ salon_id: salonId, payment_owner: ownerId });
    if (insertError) throw new Error("Checkout is already being prepared. Try again.");
  }
  const { data: reservation, error: reservationError } = await client.from("checkin_receipt_subscriptions").select("checkout_reference").eq("salon_id", salonId).eq("payment_owner", ownerId).single();
  if (reservationError || !reservation?.checkout_reference) throw new Error("Checkout could not be prepared. Please retry.");
  const form = new URLSearchParams({ mode: "subscription", success_url: new URL("/market?payment=received", REYLUMI_METADATA_BASE).href,
    cancel_url: new URL("/market?payment=cancelled", REYLUMI_METADATA_BASE).href,
    "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": String(CHECKIN_RECEIPT_MONTHLY_CENTS),
    "line_items[0][price_data][recurring][interval]": "month", "line_items[0][price_data][product_data][name]": "Reylumi Check-in Receipt",
    "subscription_data[metadata][reylumi_plugin]": CHECKIN_RECEIPT_PLUGIN, "subscription_data[metadata][salon_id]": salonId, "subscription_data[metadata][owner_id]": ownerId });
  const session = await marketStripe("checkout/sessions", form, `checkin:${reservation.checkout_reference}:${row?.stripe_checkout ?? "initial"}`);
  if (typeof session.url !== "string" || new URL(session.url).hostname !== "checkout.stripe.com") throw new Error("Secure checkout could not open.");
  const { error: saveError } = await client.from("checkin_receipt_subscriptions").update({ stripe_checkout: session.id }).eq("salon_id", salonId).eq("payment_owner", ownerId);
  if (saveError) throw new Error("Checkout could not be saved. Please retry.");
  return session.url as string;
}
