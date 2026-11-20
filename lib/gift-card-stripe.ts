import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { depositStripe } from "@/lib/booking-deposit";
import { marketServiceClient } from "@/lib/market-payments";
import { REYLUMI_METADATA_BASE } from "@/lib/reylumi-config";

export function verifyGiftSignature(raw: string, signature: string, secret = process.env.GIFT_CARD_STRIPE_WEBHOOK_SECRET) {
  const parts = signature.split(","); const timestamp = parts.find(p => p.startsWith("t="))?.slice(2);
  if (!secret || !timestamp || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest();
  return parts.filter(p => /^v1=[a-f0-9]{64}$/.test(p)).some(p => timingSafeEqual(expected, Buffer.from(p.slice(3), "hex")));
}
export async function giftStripeAccount(salonId: string) {
  const db = marketServiceClient();
  const settings = await db.from("gift_card_settings").select("stripe_account,installed").eq("salon_id", salonId).maybeSingle();
  if (settings.error || !settings.data?.installed) throw new Error("Gift card sales are not enabled at this salon.");
  const booking = await db.from("booking_deposit_subscriptions").select("stripe_account").eq("salon_id", salonId).maybeSingle();
  const account = settings.data.stripe_account || booking.data?.stripe_account;
  if (!account) throw new Error("The salon needs to connect Stripe in Gift Card Settings.");
  const verified = await depositStripe(`accounts/${account}`);
  if (verified.charges_enabled !== true || verified.payouts_enabled !== true) throw new Error("Complete the salon's Stripe bank setup before online sales.");
  return account as string;
}
export async function connectGiftStripe(salonId: string) {
  const db = marketServiceClient();
  const settings = await db.from("gift_card_settings").select("stripe_account").eq("salon_id", salonId).maybeSingle();
  const booking = await db.from("booking_deposit_subscriptions").select("stripe_account").eq("salon_id", salonId).maybeSingle();
  let id = settings.data?.stripe_account || booking.data?.stripe_account;
  if (!id) {
    const account = await depositStripe("accounts", undefined, new URLSearchParams({ type: "express", "capabilities[card_payments][requested]": "true", "capabilities[transfers][requested]": "true", "metadata[reylumi_salon]": salonId }), `gift-connect:${salonId}`);
    id = account.id;
    if (!/^acct_[A-Za-z0-9]+$/.test(id)) throw new Error("Stripe setup could not open.");
  }
  const saved = await db.from("gift_card_settings").upsert({ salon_id: salonId, stripe_account: id }, { onConflict: "salon_id" });
  if (saved.error) throw new Error("Bank setup could not be saved.");
  const url = new URL("/gift-cards/manage", REYLUMI_METADATA_BASE).href;
  const link = await depositStripe("account_links", undefined, new URLSearchParams({ account: id, type: "account_onboarding", refresh_url: `${url}?bank=retry`, return_url: `${url}?bank=returned` }));
  if (typeof link.url !== "string" || new URL(link.url).hostname !== "connect.stripe.com") throw new Error("Invalid Stripe setup link.");
  return { url: link.url as string };
}
export async function prepareGiftOnline(salonId: string, amount: number, requestId: string, actor: string | null) {
  if(!process.env.GIFT_CARD_STRIPE_WEBHOOK_SECRET)throw new Error("Online gift card payments are not ready. Contact the salon.");
  if (!Number.isInteger(amount) || amount < 100 || amount > 100000 || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error("Invalid gift card purchase.");
  const account = await giftStripeAccount(salonId); const db = marketServiceClient();
  const insert = await db.from("gift_card_online_orders").insert({ salon_id: salonId, actor_id: actor, amount, request_id: requestId, stripe_account: account });
  if (insert.error && insert.error.code !== "23505") throw new Error("Purchase could not be prepared.");
  const { data: order, error } = await db.from("gift_card_online_orders").select("*").eq("salon_id", salonId).eq("request_id", requestId).single();
  if (error || !order || order.amount !== amount || order.actor_id !== actor || order.stripe_account !== account) throw new Error("Purchase changed. Start again.");
  if (order.status !== "pending") return { order: order.token };
  let session;
  if (order.stripe_session) session = await depositStripe(`checkout/sessions/${order.stripe_session}`, account);
  else {
    if (Date.now() - Date.parse(order.created_at) > 23 * 3600000) throw new Error("Purchase expired. Start again.");
    const returnUrl = new URL(`/gift-cards?order=${order.token}`, REYLUMI_METADATA_BASE).href;
    session = await depositStripe("checkout/sessions", account, new URLSearchParams({ mode: "payment", "payment_method_types[0]": "card", success_url: returnUrl, cancel_url: `${returnUrl}&cancelled=1`,
      "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": String(amount), "line_items[0][price_data][product_data][name]": "Salon digital gift card", "metadata[gift_card_order]": order.id, "payment_intent_data[metadata][gift_card_order]": order.id }), `gift-purchase:${order.id}`);
    const saved = await db.from("gift_card_online_orders").update({ stripe_session: session.id }).eq("id", order.id).is("stripe_session", null);
    if (saved.error) throw new Error("Retry to recover this reserved checkout.");
  }
  if (session.payment_status === "paid") { await syncGiftOnline(order.id, account); return { order: order.token }; }
  if (session.status !== "open" || typeof session.url !== "string" || new URL(session.url).hostname !== "checkout.stripe.com") throw new Error("Checkout expired. Start a new purchase.");
  return { url: session.url as string, order: order.token as string };
}
export async function syncGiftOnline(id: string, expectedAccount?: string, forceReview = false) {
  const db = marketServiceClient(); const { data: order, error } = await db.from("gift_card_online_orders").select("*").eq("id", id).single();
  if (error || !order || !order.stripe_session || expectedAccount && order.stripe_account !== expectedAccount) throw new Error("Payment account mismatch.");
  const session = await depositStripe(`checkout/sessions/${order.stripe_session}?expand[]=payment_intent.latest_charge`, order.stripe_account);
  if (session.metadata?.gift_card_order !== id || session.currency !== "usd" || session.amount_total !== order.amount || session.livemode !== !process.env.BOOKING_STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("Payment identity mismatch.");
  if (session.payment_status !== "paid" || session.status !== "complete") return;
  const intent = session.payment_intent;
  if (!intent || intent.status !== "succeeded" || intent.currency !== "usd" || intent.amount_received !== order.amount) throw new Error("Verified payment required.");
  const fulfilled = await db.rpc("gift_card_online_fulfill", { p_order: id, p_intent: intent.id, p_refunded: forceReview ? order.amount : intent.latest_charge?.amount_refunded ?? 0 });
  if (fulfilled.error) throw new Error("Payment received; card confirmation will retry.");
}
