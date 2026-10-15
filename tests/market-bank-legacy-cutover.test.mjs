import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["lib/market-payments.ts"], bundle: true, write: false, format: "esm", platform: "node", alias: { "@": process.cwd() }, plugins: [{ name: "isolate-legacy-cutover", setup(b) {
  b.onResolve({ filter: /^(server-only|@supabase\/supabase-js|@\/lib\/reylumi-config)$/ }, args => ({ path: args.path, namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path === "server-only" ? "" : args.path.includes("reylumi-config") ? `export const REYLUMI_METADATA_BASE="https://reylumi.com"` : `
    export function createClient(){const ctx=globalThis.__marketLegacyCutover;return {
      async rpc(name,args){ctx.rpcs.push({name,args});return ctx.rpcResponse},
      from(table){const filters=[];let value;return {
        select(columns){ctx.reads.push({table,columns});return this},eq(column,entry){filters.push({kind:'eq',column,value:entry});return this},
        is(column,entry){filters.push({kind:'is',column,value:entry});return this},
        async maybeSingle(){return {data:ctx.row,error:ctx.readError}},
        update(entry){value=entry;return this},
        then(resolve,reject){ctx.updates.push({table,value,filters});return Promise.resolve({data:null,error:ctx.clearError}).then(resolve,reject)}
      }}
    }}
  ` }));
} }] });
const payment = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const salon = "11111111-1111-4111-8111-111111111111";
const plugins = {
  "vietnamese-language": { table: "vietnamese_plugin_subscriptions", column: "checkout_session" },
  "booking-policy": { table: "booking_policy_subscriptions", column: "stripe_checkout" },
  "booking-deposit": { table: "booking_deposit_subscriptions", column: "stripe_checkout" },
  "checkin-receipt": { table: "checkin_receipt_subscriptions", column: "stripe_checkout" },
};
function context(overrides = {}) {
  return { row: null, readError: null, clearError: null, readStatus: "expired", expireStatus: "expired", httpFailure: null,
    rpcResponse: { data: { settings: { enabled: true } }, error: null }, rpcs: [], reads: [], requests: [], updates: [], ...overrides };
}
async function run(ctx, action) {
  const originalFetch = globalThis.fetch;
  const envKeys = ["MARKET_STRIPE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const env = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.MARKET_STRIPE_SECRET_KEY = "test-key"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.com"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  globalThis.__marketLegacyCutover = ctx;
  globalThis.fetch = async (url, options) => {
    ctx.requests.push({ url, method: options?.method, body: options?.body });
    if (ctx.httpFailure && (!ctx.httpFailure.onlyExpire || url.endsWith("/expire"))) return new Response("Unavailable", { status: 503 });
    return Response.json({ id: "cs_old", status: url.endsWith("/expire") ? ctx.expireStatus : ctx.readStatus });
  };
  try { await action(); }
  finally { globalThis.fetch = originalFetch; delete globalThis.__marketLegacyCutover; for (const key of envKeys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } }
}

test("Legacy card purchase guard permits only databases without bank billing and fails closed on uncertain availability", async () => {
  for (const code of ["PGRST202", "42883"]) {
    const ctx = context({ rpcResponse: { data: null, error: { code } } });
    await run(ctx, async () => { await payment.assertLegacyMarketCheckoutAllowed(); assert.equal(ctx.rpcs[0].name, "market_billing_public_catalog"); });
  }
  for (const response of [{ data: { settings: { enabled: false } }, error: null }, { data: { settings: { enabled: true } }, error: null }]) {
    await run(context({ rpcResponse: response }), async () => { await assert.rejects(payment.assertLegacyMarketCheckoutAllowed(), /New purchases use the bank payment/); });
  }
  await run(context({ rpcResponse: { data: null, error: { code: "network_error" } } }), async () => { await assert.rejects(payment.assertLegacyMarketCheckoutAllowed(), /availability could not be checked/); });
});

test("Bank cutover rejects linked subscriptions for every plugin and never mutates prepaid entitlement", async () => {
  for (const [plugin, spec] of Object.entries(plugins)) {
    const ctx = context({ row: { stripe_subscription: "sub_existing", [spec.column]: "cs_old" } });
    await run(ctx, async () => {
      await assert.rejects(payment.prepareMarketBankPurchase(salon, plugin), /existing Stripe subscription/);
      assert.equal(ctx.reads[0].table, spec.table); assert.deepEqual(ctx.requests, []); assert.deepEqual(ctx.updates, []);
    });
    await run(context(), async () => { await payment.prepareMarketBankPurchase(salon, plugin); });
  }
  await run(context(), async () => { await assert.rejects(payment.prepareMarketBankPurchase(salon, "unimplemented-plugin"), /not ready for payment/); });
});

test("Verified expired legacy sessions are cleared with matching session and no subscription race filters", async () => {
  for (const [plugin, spec] of Object.entries(plugins)) {
    const ctx = context({ row: { stripe_subscription: null, [spec.column]: "cs_old" } });
    await run(ctx, async () => {
      await payment.prepareMarketBankPurchase(salon, plugin);
      assert.equal(ctx.requests.length, 1); assert.equal(ctx.requests[0].method, "GET");
      const update = ctx.updates[0]; assert.equal(update.table, spec.table);
      assert.deepEqual(update.filters, [{ kind: "eq", column: "salon_id", value: salon }, { kind: "eq", column: spec.column, value: "cs_old" }, { kind: "is", column: "stripe_subscription", value: null }]);
      assert.equal(update.value[spec.column], null);
      assert.equal("paid_until" in update.value, false); assert.equal("installed" in update.value, false);
      if (plugin === "vietnamese-language") assert.deepEqual(update.value, { checkout_session: null, checkout_reference: null, checkout_owner: null });
      else assert.match(update.value.checkout_reference, /^[0-9a-f-]{36}$/i);
    });
  }
});

test("Open card sessions are expired before clearing; completed or uncertain sessions cannot switch payment methods", async () => {
  const ctx = context({ row: { stripe_subscription: null, stripe_checkout: "cs_old" }, readStatus: "open" });
  await run(ctx, async () => {
    await payment.prepareMarketBankPurchase(salon, "booking-policy");
    assert.deepEqual(ctx.requests.map(request => [request.method, new URL(request.url).pathname]), [["GET", "/v1/checkout/sessions/cs_old"], ["POST", "/v1/checkout/sessions/cs_old/expire"]]);
    assert.equal(ctx.updates.length, 1);
  });
  for (const [readStatus, expected] of [["complete", /being confirmed/], ["unexpected", /could not be closed/]]) {
    const ctx = context({ row: { stripe_subscription: null, stripe_checkout: "cs_old" }, readStatus });
    await run(ctx, async () => { await assert.rejects(payment.prepareMarketBankPurchase(salon, "booking-policy"), expected); assert.deepEqual(ctx.updates, []); });
  }
  const malformed = context({ row: { stripe_subscription: null, stripe_checkout: "https://unrelated-session" } });
  await run(malformed, async () => { await assert.rejects(payment.prepareMarketBankPurchase(salon, "booking-policy"), /needs billing support/); assert.deepEqual(malformed.requests, []); assert.deepEqual(malformed.updates, []); });
});

test("Stripe and database failures keep the old reservation, including an unverified expiration response", async () => {
  for (const httpFailure of [{ onlyExpire: false }, { onlyExpire: true }]) {
    const ctx = context({ row: { stripe_subscription: null, stripe_checkout: "cs_old" }, readStatus: "open", httpFailure });
    await run(ctx, async () => { await assert.rejects(payment.prepareMarketBankPurchase(salon, "booking-policy"), /could not be completed/); assert.deepEqual(ctx.updates, []); });
  }
  const unreadable = context({ readError: { message: "connection failed" } });
  await run(unreadable, async () => { await assert.rejects(payment.prepareMarketBankPurchase(salon, "booking-policy"), /could not be checked/); assert.deepEqual(unreadable.requests, []); });
  const clearFailed = context({ row: { stripe_subscription: null, stripe_checkout: "cs_old" }, clearError: { message: "connection failed" } });
  await run(clearFailed, async () => { await assert.rejects(payment.prepareMarketBankPurchase(salon, "booking-policy"), /could not be cleared/); });
  const unverified = context({ row: { stripe_subscription: null, stripe_checkout: "cs_old" }, readStatus: "open", expireStatus: "open" });
  await run(unverified, async () => { await assert.rejects(payment.prepareMarketBankPurchase(salon, "booking-policy"), /closed|expired/); assert.deepEqual(unverified.updates, []); });
});
