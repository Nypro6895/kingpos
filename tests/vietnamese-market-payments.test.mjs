import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["lib/market-payments.ts"], bundle: true, write: false, format: "esm", platform: "node", alias: { "@": process.cwd() }, plugins: [{ name: "stubs", setup(b) {
  b.onResolve({ filter: /^(server-only|@supabase\/supabase-js|@\/lib\/reylumi-config)$/ }, a => ({ path: a.path, namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.path === "server-only" ? "" : a.path.includes("reylumi-config") ? "export const REYLUMI_METADATA_BASE = new URL('https://example.com');" : `export function createClient(){return {from(){return {select(){return this},eq(){return this},single:async()=>({data:{stripe_subscription:globalThis.linkedSubscription??null},error:null}),update(data){globalThis.savedSubscription=data;return this},then(resolve){return Promise.resolve({error:null}).then(resolve)}}}}}`, loader: "js" }));
} }] });
const payments = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));
test("Market webhook requires valid, recent signatures", () => {
  process.env.MARKET_STRIPE_WEBHOOK_SECRET = "test";
  const body = '{"type":"invoice.paid"}', timestamp = Math.floor(Date.now() / 1000);
  const signature = `t=${timestamp},v1=${createHmac("sha256", "test").update(`${timestamp}.${body}`).digest("hex")}`;
  assert.equal(payments.verifyMarketWebhook(body, signature), true);
  assert.equal(payments.verifyMarketWebhook(body + " ", signature), false);
  assert.equal(payments.verifyMarketWebhook(body, signature.replace(String(timestamp), String(timestamp - 301))), false);
  assert.equal(payments.verifyMarketWebhook(body, "t=NaN,v1=bad"), false);
  delete process.env.MARKET_STRIPE_WEBHOOK_SECRET;
  assert.equal(payments.verifyMarketWebhook(body, signature), false);
});
test("Monthly entitlement needs the exact price and a paid invoice; cancellations and failures remove it", async () => {
  const original = globalThis.fetch;
  process.env.MARKET_STRIPE_SECRET_KEY = "test"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.com"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  let subscription = { id: "sub_test", status: "active", customer: "cus_test", latest_invoice: { status: "paid" }, metadata: { reylumi_plugin: "vietnamese-language", salon_id: "00000000-0000-4000-8000-000000000001", owner_id: "00000000-0000-4000-8000-000000000002" }, items: { data: [{ quantity: 1, current_period_end: Math.floor(Date.now() / 1000) + 86400, price: { unit_amount: 399, currency: "usd", recurring: { interval: "month", interval_count: 1 } } }] } };
  try {
    globalThis.fetch = async () => Response.json(subscription);
    await payments.syncVietnameseSubscription("sub_test");
    assert.ok(globalThis.savedSubscription.paid_until);
    subscription.latest_invoice.status = "open";
    await payments.syncVietnameseSubscription("sub_test"); assert.equal(globalThis.savedSubscription.paid_until, null);
    subscription.status = "past_due";
    await payments.syncVietnameseSubscription("sub_test"); assert.equal(globalThis.savedSubscription.paid_until, null);
    subscription.status = "canceled";
    globalThis.linkedSubscription = "sub_test";
    await payments.syncVietnameseSubscription("sub_test"); assert.equal(globalThis.savedSubscription.stripe_subscription, null);
    globalThis.linkedSubscription = null;
    globalThis.savedSubscription = { checkout_reference: "new-checkout" };
    await payments.syncVietnameseSubscription("sub_test"); assert.equal(globalThis.savedSubscription.checkout_reference, "new-checkout");
    subscription.items.data[0].price.unit_amount = 398;
    await assert.rejects(payments.syncVietnameseSubscription("sub_test"), /Invalid plugin price/);
    await assert.rejects(payments.syncVietnameseSubscription("https://bad"), /Invalid subscription/);
  } finally { globalThis.fetch = original; delete globalThis.savedSubscription; delete globalThis.linkedSubscription; }
});
