import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { marketServiceClient, marketPaymentSettings } from "@/lib/market-payments";
import { marketPluginContext } from "@/lib/market-plugins";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { bookingDepositCents, EMPTY_BOOKING_DEPOSIT, type BookingDepositSettings, type BookingDepositState } from "@/types/booking-deposit";
import type { PublicBookingActionResult } from "@/lib/public-booking";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";

export async function depositStripe(path: string, account?: string, form?: URLSearchParams, key?: string) {
  const secret = process.env.BOOKING_STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Booking payments are not connected yet.");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: form ? "POST" : "GET",
    headers: { Authorization: `Bearer ${secret}`, ...(account ? { "Stripe-Account": account } : {}),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
    body: form?.toString(), cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("Stripe could not complete this request. Please retry.");
  return response.json();
}
export async function publicBookingDeposit(salonId: string): Promise<BookingDepositSettings | null> {
  const client = await createSupabaseServerClient();
  if (!client) throw new Error("Booking settings could not load.");
  const { data, error } = await client.rpc("public_booking_deposit", { p_salon: salonId });
  // Existing salons keep working before the additive migration is applied; confirmation RPC still enforces the gate.
  if (error?.code === "PGRST202" || error?.code === "42883") return null;
  if (error) throw new Error("Booking payment settings could not load. Please retry.");
  return data as BookingDepositSettings | null;
}
export async function bookingDepositState(salonId: string): Promise<BookingDepositState> {
  const scope = await marketPluginContext();
  if (scope.salonId !== salonId) throw new Error("Choose this salon in your Owner workspace first.");
  const { data, error } = await marketServiceClient().from("booking_deposit_subscriptions").select("*").eq("salon_id", salonId).maybeSingle();
  if (error) throw new Error("Booking Deposit requires the latest database update.");
  let connected = false;
  if (data?.stripe_account) {
    try {
      const account = await depositStripe(`accounts/${data.stripe_account}`);
      connected = account.charges_enabled === true && account.payouts_enabled === true;
    } catch { /* Owners must still be able to turn payment requirements off during a provider outage. */ }
  }
  const testMode = (await marketPaymentSettings()).booking_deposit_test_enabled === true;
  return { ...EMPTY_BOOKING_DEPOSIT, enabled: data?.enabled ?? false, mode: data?.mode ?? "fixed", checkout: data?.checkout ?? "both", value: Number(data?.value ?? 20), testMode, installed: Boolean(data?.installed),
    active: Boolean(data?.installed && (testMode || (data?.paid_until && Date.parse(data.paid_until) > Date.now()))), subscribed: Boolean(data?.stripe_subscription), connected };
}
export async function prepareBookingDeposit(args: Record<string, unknown>, totalCents: number, actorId: string | null, requested: "embedded" | "hosted"): Promise<PublicBookingActionResult | null> {
  const salonId = String(args.p_salon_id);
  const settings = await publicBookingDeposit(salonId);
  if (!settings) return null;
  const amount = bookingDepositCents(totalCents, settings);
  if (amount < 50) throw new Error("This booking needs a payment of at least $0.50. Please contact the salon.");
  if (!settings.testMode && !process.env.NEXT_PUBLIC_BOOKING_STRIPE_PUBLISHABLE_KEY && requested === "embedded") throw new Error("Card entry is not connected yet. Choose Stripe checkout.");
  const checkout = settings.checkout === "both" ? requested : settings.checkout;
  const client = marketServiceClient();
  const { data: config, error: configError } = await client.from("booking_deposit_subscriptions").select("stripe_account").eq("salon_id", salonId).single();
  if (configError || (!settings.testMode && !config?.stripe_account)) throw new Error("The salon has not connected Stripe.");
  if (!settings.testMode) {
    const account = await depositStripe(`accounts/${config.stripe_account}`);
    if (!account.charges_enabled || !account.payouts_enabled) throw new Error("The salon's Stripe account is not ready to receive payments.");
  }
  const hash = createHash("sha256").update(JSON.stringify({ args, actorId, totalCents, amount, checkout, testMode: Boolean(settings.testMode) })).digest("hex");
  const requestKey = String(args.p_idempotency_key);
  // The unique request key reserves one immutable amount, customer and appointment across retries.
  const inserted = await client.from("booking_deposit_orders").insert({ salon_id: salonId, actor_id: actorId, request_key: requestKey, request_hash: hash,
    args, total_cents: totalCents, amount_cents: amount, mode: settings.mode, checkout, stripe_account: settings.testMode ? "test" : config.stripe_account, is_test: Boolean(settings.testMode) });
  if (inserted.error && inserted.error.code !== "23505") throw new Error("Payment could not be prepared.");
  const { data: order, error } = await client.from("booking_deposit_orders").select("*").eq("salon_id", salonId).eq("request_key", requestKey).single();
  if (error || !order || order.request_hash !== hash) throw new Error("Your booking changed. Refresh and choose your appointment again.");
  if (order.result) return depositOrderResult(order);
  if (order.status !== "pending") throw new Error("This payment has already been processed. Open your payment receipt.");
  if (order.is_test) return { ok: false, code: "payment_required", message: "Test checkout — no money will be charged.", payment: { token: order.token, checkout, account: "test", amountCents: amount, testMode: true } };
  let session;
  if (order.stripe_session) session = await depositStripe(`checkout/sessions/${order.stripe_session}`, order.stripe_account);
  else {
    if (Date.parse(order.created_at) + 1800000 <= Date.now()) throw new Error("Payment expired. Refresh and choose your appointment again.");
    const returnUrl = new URL(`/booking-payment/${order.token}`, REYLUMI_METADATA_BASE).href;
    const form = new URLSearchParams({ mode: "payment", ui_mode: checkout, client_reference_id: order.id,
      "payment_method_types[0]": "card", "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(amount), "line_items[0][price_data][product_data][name]": settings.mode === "full" ? "Appointment prepayment" : "Appointment deposit",
      "metadata[booking_deposit_order]": order.id, "payment_intent_data[metadata][booking_deposit_order]": order.id,
      "payment_intent_data[receipt_email]": String(args.p_customer_email ?? ""), customer_email: String(args.p_customer_email ?? ""),
      expires_at: String(Math.floor(Date.parse(order.created_at) / 1000) + 3600) });
    if (checkout === "embedded") { form.set("return_url", returnUrl); form.set("redirect_on_completion", "if_required"); }
    else { form.set("success_url", returnUrl); form.set("cancel_url", `${returnUrl}?cancelled=1`); }
    session = await depositStripe("checkout/sessions", order.stripe_account, form, `booking-deposit:${order.id}`);
    const saved = await client.from("booking_deposit_orders").update({ stripe_session: session.id }).eq("id", order.id);
    if (saved.error) throw new Error("Payment could not be saved. Please retry.");
  }
  if (session.status === "expired") throw new Error("Payment expired. Refresh and choose your appointment again.");
  if (session.status === "complete") return { ok: false, message: "Payment received. Confirming your appointment…", payment: { token: order.token, checkout, account: order.stripe_account, amountCents: amount } };
  if (checkout === "hosted" && (typeof session.url !== "string" || new URL(session.url).hostname !== "checkout.stripe.com")) throw new Error("Secure checkout could not open.");
  return { ok: false, code: "payment_required", message: "Pay before confirming your appointment.",
    payment: { token: order.token, checkout, account: order.stripe_account, amountCents: amount, url: session.url, clientSecret: session.client_secret } };
}
// Only return the minimum customer-facing receipt; never expose the stored booking input.
function depositOrderResult(order: { result: { booking_id: string; manage_token: string; status: string; confirmation_status?: string }; actor_id: string | null; amount_cents: number; refunded_cents: number; receipt_url: string | null; is_test?: boolean }): PublicBookingActionResult {
  return { ok: true, bookingId: order.result.booking_id, manageToken: order.result.manage_token,
    accountLinked: Boolean(order.actor_id), status: order.result.status, confirmationStatus: order.result.confirmation_status,
    message: order.is_test ? "Test checkout completed. No money was charged. Appointment submitted." : "Payment received and appointment submitted.", receipt: { amountCents: order.amount_cents, refundedCents: order.refunded_cents, url: order.receipt_url, testMode: order.is_test } };
}
export function verifyDepositWebhook(payload: string, signature: string) {
  const secret = process.env.BOOKING_STRIPE_WEBHOOK_SECRET;
  const timestamp = signature.split(",").find(part => part.startsWith("t="))?.slice(2);
  if (!secret || !timestamp || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest();
  return signature.split(",").filter(part => part.startsWith("v1=")).some(part => { const actual = Buffer.from(part.slice(3), "hex"); return actual.length === expected.length && timingSafeEqual(actual, expected); });
}
export async function syncBookingDeposit(id: string, expectedAccount?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid payment reference.");
  const client = marketServiceClient();
  const { data: order, error } = await client.from("booking_deposit_orders").select("*").eq("id", id).single();
  if (error || !order || (expectedAccount && expectedAccount !== order.stripe_account)) throw new Error("Payment account mismatch.");
  if (order.is_test) throw new Error("Test checkout cannot process Stripe payments.");
  if (!order.stripe_session) return;
  const session = await depositStripe(`checkout/sessions/${order.stripe_session}?expand[]=payment_intent.latest_charge`, order.stripe_account);
  if (session.metadata?.booking_deposit_order !== order.id || session.amount_total !== order.amount_cents || session.currency !== "usd") throw new Error("Payment amount mismatch.");
  if (session.payment_status !== "paid" || session.status !== "complete") return;
  const intent = session.payment_intent;
  if (intent?.status !== "succeeded" || intent.amount_received !== order.amount_cents || intent.currency !== "usd") throw new Error("Verified payment required.");
  const charge = intent.latest_charge;
  const refunded = Number(charge?.amount_refunded ?? 0);
  const receiptUrl = typeof charge?.receipt_url === "string" && new URL(charge.receipt_url).hostname === "pay.stripe.com" ? charge.receipt_url : null;
  const recorded = await client.rpc("booking_deposit_record_payment", { p_order: id, p_intent: intent.id, p_refunded: refunded, p_receipt: receiptUrl });
  if (recorded.error) throw new Error("Receipt could not be recorded.");
  // Refund totals only increase under a row lock; stale polling cannot reverse a newer refund webhook.
  if (recorded.data?.booking_id || Number(recorded.data?.refunded_cents) >= order.amount_cents) return;
  const finalized = await client.rpc("booking_deposit_finalize", { p_order: id });
  if (finalized.error) throw new Error("Appointment confirmation is being retried.");
  if (finalized.data?.refund) {
    // A database lock reserves the refund first, so concurrent retries can never confirm the appointment afterward.
    const refund = await depositStripe("refunds", order.stripe_account, new URLSearchParams({ payment_intent: intent.id }), `booking-refund:${id}`);
    if (refund.status !== "succeeded") throw new Error("Refund is being processed.");
    const saved = await client.from("booking_deposit_orders").update({ status: "refunded", refunded_cents: order.amount_cents }).eq("id", id);
    if (saved.error) throw new Error("Refund could not be recorded.");
  }
}
export async function confirmBookingDepositTest(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Invalid test checkout.");
  const client = marketServiceClient();
  const { data: order, error } = await client.from("booking_deposit_orders").select("*").eq("token", token).single();
  if (error || !order?.is_test) throw new Error("Test checkout was not found.");
  if (!order.result) {
    const finalized = await client.rpc("booking_deposit_finalize", { p_order: order.id });
    if (finalized.error) throw new Error("This appointment cannot be booked. Please choose another available time.");
  }
  return bookingDepositStatus(token);
}
export async function bookingDepositStatus(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw new Error("Invalid payment link.");
  const client = marketServiceClient();
  const { data: before, error } = await client.from("booking_deposit_orders").select("*").eq("token", token).single();
  if (error || !before) throw new Error("Payment link was not found.");
  if (before.result) return depositOrderResult(before);
  if (before.stripe_session) await syncBookingDeposit(before.id);
  const { data: order, error: readError } = await client.from("booking_deposit_orders").select("*").eq("id", before.id).single();
  if (readError || !order) throw new Error("Payment could not be checked.");
  if (order.result) return depositOrderResult(order);
  if (order.status === "pending" && order.checkout === "hosted" && order.stripe_session) {
    const session = await depositStripe(`checkout/sessions/${order.stripe_session}`, order.stripe_account);
    if (session.status === "expired") return { ok: false, code: "expired", message: "Payment expired. Return to the salon booking page to choose an appointment." };
    if (session.status === "open" && typeof session.url === "string" && new URL(session.url).hostname === "checkout.stripe.com") return { ok: false, message: "Your appointment will be submitted after payment.", payment: { token, checkout: "hosted" as const, account: order.stripe_account, amountCents: order.amount_cents, url: session.url } };
  }
  return { ok: false, code: order.status, message: order.status === "refunded" ? "The appointment could not be booked. Your payment was refunded." : "Waiting for payment confirmation…" };
}
