import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const salonId = "11111111-1111-4111-8111-111111111111";
const order = {
  id: "22222222-2222-4222-8222-222222222222", reference: "RLM-TEST-0001", salon_id: salonId,
  plugin_id: "booking-deposit", plugin_name: "Booking Deposit", publisher: "Reylumi", bank_account_id: "33333333-3333-4333-8333-333333333333",
  snapshot: { bank: { id: "33333333-3333-4333-8333-333333333333", label: "USD account", bank_name: "Invoice Bank",
    beneficiary: "Reylumi Payments", account_number: "123456789012345678901234567890", routing: "TESTUS33", instructions: "Include the invoice reference.", version: 1 },
    currency: "USD", interval: "month", tax_bps: 800, fee_bps: 200, fixed_fee_cents: 30, tax_label: "Sales tax",
    settings_version: 1, catalog_version: 1, commission_bps: 0 },
  base_cents: 590, tax_cents: 47, fee_cents: 43, total_cents: 680, received_cents: 0, unapplied_cents: 0,
  refunded_cents: 0, refunded_applied_cents: 0, currency: "USD", status: "awaiting_payment", created_at: "2026-10-09T12:00:00Z",
  expires_at: "2099-10-12T12:00:00Z", paid_at: null, service_start: null, service_end: null,
};
const state = {
  available: true, salon_id: salonId, reason: null, unavailable_reason: null,
  settings: { enabled: true, ready: true, currency: "USD", order_expiry_hours: 72, tax_bps: 800,
    fee_bps: 200, fixed_fee_cents: 30, tax_label: "Sales tax", version: 1 },
  catalog: [{ plugin_id: "booking-deposit", name: "Booking Deposit", publisher: "Reylumi", price_cents: 590,
    interval: "month", published: true, fulfillment_ready: true, commission_bps: 0, version: 1 }], orders: [],
};

test("Bank checkout creates one immutable invoice, handles confirmation and guards payment on desktop and mobile", { timeout: 90_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BankCheckoutPanel} from './app/market/bank-checkout-panel';
    const params = new URLSearchParams(location.search);
    const state = ${JSON.stringify(state)}, order = ${JSON.stringify(order)};
    if (params.has('waiting')) { state.orders = [order]; state.catalog[0].price_cents = 999; state.settings.tax_bps = 0; }
    if (params.has('partial')) { state.orders = [{...order, status:'partially_paid', received_cents:300}]; }
    if (params.has('paid')) { state.orders = [{...order,status:'paid',received_cents:680,paid_at:'2026-10-09T14:00:00Z',service_start:'2026-10-09T14:00:00Z',service_end:'2099-11-09T14:00:00Z'}]; }
    if (params.has('expired')) { state.orders = [{...order,status:'expired',expires_at:'2025-10-09T14:00:00Z'}]; }
    if (params.has('public')) state.salon_id = null;
    if (params.has('preview')) state.catalog[0].fulfillment_ready = false;
    if (params.has('disabled')) state.settings.enabled = false;
    window.testState = state; window.testOrder = order;
    createRoot(document.getElementById('root')).render(<BankCheckoutPanel pluginId="booking-deposit" pluginName="Booking Deposit" billingState={state} hasActiveSubscription={params.has('stripe')}/>);
  ` }, outfile: "bundle.js", bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": process.cwd() }, plugins: [{ name: "mock-owner-actions", setup(b) {
    b.onResolve({ filter: /^(next\/navigation|.*bank-payment-actions)$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path.includes("navigation") ? `export function useRouter(){return{refresh(){window.refreshCount=(window.refreshCount||0)+1}}}` : `
      export async function createMarketBankOrder(plugin,request) {
        window.createRequests = [...(window.createRequests||[]), {plugin,request}];
        if (new URLSearchParams(location.search).has('retry') && window.createRequests.length===1) throw Error('Connection lost');
        window.testState.orders=[window.testOrder]; return {order:window.testOrder,state:window.testState};
      }
      export async function cancelMarketBankOrder(id) {
        window.cancelledId=id; const order={...window.testOrder,status:'cancelled'};
        window.testState={...window.testState,orders:[order]}; return {order,state:window.testState};
      }
      export async function refreshMarketBankBilling() {
        const order={...window.testOrder,status:'paid',received_cents:680,paid_at:'2026-10-09T14:00:00Z',service_start:'2026-10-09T14:00:00Z',service_end:'2099-11-09T14:00:00Z'};
        window.testState={...window.testState,orders:[order]}; return window.testState;
      }
    ` }));
  } }] });
  const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
  const moduleCss = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const cssPath = ".next/static/css";
  const css = fs.existsSync(cssPath) ? fs.readdirSync(cssPath).filter(file => file.endsWith(".css")).map(file => fs.readFileSync(`${cssPath}/${file}`, "utf8")).join("\n") : "";
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url.startsWith("/bundle.js") ? "application/javascript" : "text/html");
    response.end(request.url.startsWith("/bundle.js") ? js : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${moduleCss}\nbody{padding:16px;background:#fafafa;margin:0}#root{max-width:800px;margin:auto}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { async writeText(value) { window.copiedValue = value; } } }); });
    const artifacts = "artifacts/market-bank-checkout-qa"; fs.mkdirSync(artifacts, { recursive: true });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 950 }); await page.goto(base);
      await page.getByLabel("Purchase total").getByText("$6.80 USD", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Create bank payment invoice" }).click();
      await page.getByLabel("Account number", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Create bank payment invoice" }).count(), 0);
      assert.equal(await page.evaluate(() => window.createRequests.length), 1);
      assert.match(await page.evaluate(() => window.createRequests[0].request), /^[0-9a-f-]{36}$/i);
      await page.getByRole("button", { name: "Copy payment reference" }).click();
      await page.getByRole("status").filter({ hasText: "Payment reference copied." }).waitFor();
      assert.equal(await page.evaluate(() => window.copiedValue), order.reference);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${artifacts}/invoice-${width}.png`, fullPage: true });
      await page.getByRole("button", { name: "Refresh payment status" }).click();
      await page.getByText("Payment confirmed", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Cancel unpaid invoice" }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Create bank payment invoice" }).count(), 0);
      await page.getByText(/Paid access is available until/).waitFor();
    }
    await page.goto(base + "?waiting");
    await page.getByLabel("Payment invoice").getByText("$6.80 USD", { exact: true }).first().waitFor();
    assert.equal(await page.getByText("Invoice Bank", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "Cancel unpaid invoice" }).click();
    assert.equal(await page.getByRole("button", { name: "Confirm cancellation" }).isDisabled(), true);
    await page.getByLabel("I have not sent this payment.").check();
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    await page.getByText("Cancelled", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.cancelledId), order.id);
    assert.equal(await page.getByLabel("Account number", { exact: true }).count(), 0);
    await page.goto(base + "?partial");
    await page.getByText("Partially received", { exact: true }).waitFor();
    await page.getByLabel("Payment invoice").getByText("$3.80 USD", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Cancel unpaid invoice" }).count(), 0);
    await page.goto(base + "?retry");
    await page.getByRole("button", { name: "Create bank payment invoice" }).click();
    await page.getByRole("alert").filter({ hasText: "your invoice may already exist" }).waitFor();
    await page.getByRole("button", { name: "Create bank payment invoice" }).click();
    await page.getByLabel("Account number", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.createRequests[0].request === window.createRequests[1].request), true);
    for (const query of ["public", "preview", "disabled", "stripe", "paid"]) {
      await page.goto(`${base}?${query}`);
      const create = page.getByRole("button", { name: "Create bank payment invoice" });
      await page.getByRole("heading", { name: "Pay by bank transfer" }).waitFor();
      assert.equal(await create.count() ? await create.isDisabled() : true, true, query);
      assert.equal(await page.getByLabel("Account number", { exact: true }).count(), 0, query);
    }
    await page.goto(base + "?expired");
    await page.getByText("Expired", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Account number", { exact: true }).count(), 0);
    await page.getByText(/contact Reylumi with the payment reference before making another payment/).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

test("Bank DTO projects owner data, rejects invalid money and excludes foreign salon orders", async () => {
  const result = await build({ entryPoints: ["lib/market-bank-billing.ts"], bundle: true, write: false, format: "esm", platform: "node", alias: { "@": process.cwd() }, plugins: [{ name: "isolate-server-dependencies", setup(b) {
    b.onResolve({ filter: /^(server-only|@\/lib\/market-plugins|@\/lib\/supabase\/server)$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export async function marketPluginContext(){throw Error('No owner')} export function createSupabaseServerClient(){return null}" }));
  } }] });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const projected = module.normalizeMarketBankBillingState({ ...state, orders: [{ ...order, payer_id: "private-payer", admin_notes: "Private note", snapshot: { ...order.snapshot, private: "Hidden" } }, { ...order, salon_id: "44444444-4444-4444-8444-444444444444" }] }, salonId);
  assert.equal(projected.orders.length, 1);
  assert.equal(JSON.stringify(projected).includes("private-payer"), false);
  assert.equal(JSON.stringify(projected).includes("Private note"), false);
  assert.equal(JSON.stringify(projected).includes("Hidden"), false);
  assert.equal(projected.orders[0].snapshot.bank.account_number, order.snapshot.bank.account_number);
  assert.equal(module.normalizeMarketBankOrder({ ...order, total_cents: 681 }), null);
  assert.equal(module.normalizeMarketBankOrder({ ...order, received_cents: -1 }), null);
  assert.deepEqual(module.normalizeMarketBankBillingState({ ...state, orders: [order] }, null).orders, []);
  assert.equal(module.normalizeMarketBankBillingState({ ...state, settings: { ...state.settings, fee_bps: 10001 } }, salonId).available, false);
});

test("Payment actions use the active owner salon and reject cancellation outside it before mutation", async () => {
  const result = await build({ entryPoints: ["app/market/bank-payment-actions.ts"], bundle: true, write: false, format: "esm", platform: "node", alias: { "@": process.cwd() }, plugins: [{ name: "isolate-authenticated-actions", setup(b) {
    b.onResolve({ filter: /^(server-only|next\/cache|@\/lib\/market-plugins|@\/lib\/market-payments|@\/lib\/supabase\/server)$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path === "next/cache" ? `export function revalidatePath(path){globalThis.__marketBankActionTest.paths.push(path)}` : args.path === "@/lib/market-plugins" ? `
      export async function marketPluginContext(){const ctx=globalThis.__marketBankActionTest;if(ctx.denied)throw Error('Choose an active salon.');return{salonId:ctx.salonId,client:{async rpc(name,args){ctx.calls.push({name,args});if(name==='market_billing_owner_state')return{data:ctx.state,error:null};return{data:ctx.order,error:ctx.error}}}}}
    ` : args.path === "@/lib/market-payments" ? `export async function prepareMarketBankPurchase(salon,plugin){globalThis.__marketBankActionTest.prepared.push({salon,plugin})}` : `export function createSupabaseServerClient(){return null}` }));
  } }] });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const ctx = { salonId, state: { ...state, orders: [order] }, order, calls: [], paths: [], prepared: [], error: null, denied: false };
  globalThis.__marketBankActionTest = ctx;
  try {
    assert.ok((await module.createMarketBankOrder("../plugin", "invalid")).error);
    assert.deepEqual(ctx.calls, []);
    const created = await module.createMarketBankOrder("booking-deposit", "55555555-5555-4555-8555-555555555555");
    assert.equal(created.order.id, order.id);
    assert.equal(ctx.calls[0].name, "market_billing_create_order");
    assert.deepEqual(ctx.calls[0].args, { p_salon: salonId, p_plugin: "booking-deposit", p_request: "55555555-5555-4555-8555-555555555555" });
    assert.deepEqual(ctx.prepared, [{ salon: salonId, plugin: "booking-deposit" }]);
    ctx.calls = []; ctx.state = { ...state, orders: [] };
    assert.match((await module.cancelMarketBankOrder(order.id)).error, /current salon/);
    assert.equal(ctx.calls.some(call => call.name === "market_billing_cancel_order"), false);
    ctx.calls = []; ctx.state = { ...state, orders: [order] }; ctx.order = { ...order, status: "cancelled" };
    assert.equal((await module.cancelMarketBankOrder(order.id)).order.status, "cancelled");
    assert.deepEqual(ctx.calls.find(call => call.name === "market_billing_cancel_order").args, { p_order: order.id });
    ctx.denied = true; ctx.calls = [];
    assert.match((await module.createMarketBankOrder("booking-deposit", "55555555-5555-4555-8555-555555555555")).error, /active salon/);
    assert.deepEqual(ctx.calls, []);
  } finally { delete globalThis.__marketBankActionTest; }
});
