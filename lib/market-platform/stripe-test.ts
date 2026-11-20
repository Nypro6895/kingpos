import { createHmac, timingSafeEqual } from "node:crypto";

export type TestPaymentConfig = { key: string; webhookSecret: string; connectWebhookSecret?: string; accountId: string; origin: string };
export function testPaymentConfig(env = process.env): TestPaymentConfig {
  const key = env.MARKET_PLATFORM_STRIPE_TEST_KEY ?? "", webhookSecret = env.MARKET_PLATFORM_STRIPE_TEST_WEBHOOK_SECRET ?? "";
  const accountId = env.MARKET_PLATFORM_STRIPE_TEST_ACCOUNT ?? "", origin = env.MARKET_PLATFORM_TEST_ORIGIN ?? "";
  if (!key.startsWith("sk_test_") || !webhookSecret.startsWith("whsec_") || !/^acct_[A-Za-z0-9]+$/.test(accountId)
    || !/^http:\/\/(localhost|127\.0\.0\.1):[0-9]{2,5}$/.test(origin)) throw new Error("Marketplace test payments are not configured. Live keys and live origins are not accepted.");
  const connectWebhookSecret = env.MARKET_PLATFORM_STRIPE_TEST_CONNECT_WEBHOOK_SECRET;
  if (connectWebhookSecret && !connectWebhookSecret.startsWith("whsec_")) throw new Error("Invalid Connect test webhook configuration.");
  return { key, webhookSecret, connectWebhookSecret, accountId, origin };
}
export function verifyTestWebhook(body: string, signature: string, secret: string, now = Date.now()) {
  if (Buffer.byteLength(body) > 65536 || signature.length > 2048) throw new Error("Invalid webhook size.");
  const parts = signature.split(",");
  const times = parts.filter(v => v.startsWith("t="));
  if (times.length !== 1 || !/^t=[0-9]{10}$/.test(times[0])) throw new Error("Invalid webhook timestamp.");
  const timestamp = Number(times[0].slice(2));
  if (Math.abs(now / 1000 - timestamp) > 300) throw new Error("Expired webhook signature.");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  if (!parts.filter(v => /^v1=[a-f0-9]{64}$/.test(v)).some(v => timingSafeEqual(expected, Buffer.from(v.slice(3), "hex")))) throw new Error("Invalid webhook signature.");
  const event = JSON.parse(body);
  if (event.livemode !== false || !/^evt_[A-Za-z0-9]+$/.test(event.id ?? "")) throw new Error("Test event required.");
  return event as { id: string; type: string; created: number; account?: string; data: { object: Record<string, unknown> }; livemode: false };
}
export type OrderQuote = { id: string; salon_id: string; version_id: string; buyer_id: string; account_id: string; amount_cents: number; fee_cents: number; state: string; checkout_id: string | null; name: string; created_at: string };
export function checkoutForm(quote: OrderQuote, config: TestPaymentConfig) {
  if (!Number.isSafeInteger(quote.amount_cents) || quote.amount_cents < 50 || !Number.isSafeInteger(quote.fee_cents) || quote.fee_cents < 0 || quote.fee_cents > quote.amount_cents || !/^acct_[A-Za-z0-9]+$/.test(quote.account_id)) throw new Error("Invalid saved quote.");
  return new URLSearchParams({ mode: "payment", "payment_method_types[0]": "card", "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": String(quote.amount_cents),
    "line_items[0][price_data][product_data][name]": quote.name, "client_reference_id": quote.id,
    "metadata[market_platform_order]": quote.id, "payment_intent_data[metadata][market_platform_order]": quote.id,
    "payment_intent_data[transfer_data][destination]": quote.account_id,
    "payment_intent_data[application_fee_amount]": String(quote.fee_cents),
    success_url: `${config.origin}/market?payment=returned`, cancel_url: `${config.origin}/market?payment=canceled` });
}
export function providerRedirect(url: unknown, kind: "onboarding" | "checkout") {
  if (typeof url !== "string") throw new Error("Provider URL missing.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hostname !== (kind === "onboarding" ? "connect.stripe.com" : "checkout.stripe.com")) throw new Error("Invalid provider redirect.");
  return parsed.href;
}
