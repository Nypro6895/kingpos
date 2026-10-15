import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("payment SDK stays unloaded while browsing and canceled async checkout cannot revive after Activity reveal", { skip: !existsSync(executablePath), timeout: 60000 }, async () => {
  const bundle = await build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';
      import{CardCheckoutPanel}from'./app/market/card-checkout-panel';import{BookingCardPayment}from'./components/booking-card-payment';
      window.stats={imports:0,loads:[],creates:0,mounts:0,destroys:0,starts:0,refreshes:0,routerRefreshes:0};
      const mode=new URLSearchParams(location.search).get('mode')||'market';
      const billing={salon_id:'fixture-salon',catalog:[{plugin_id:'booking-policy',price_cents:199,published:true,fulfillment_ready:true}],settings:{tax_bps:0,fee_bps:0,fixed_fee_cents:0}};
      const payment={token:'fixture-token',amountCents:199,account:'acct_fixture',testMode:mode==='booking-test',...(mode==='booking-complete'||mode==='booking-missing'?{}:{clientSecret:'fixture-secret'})};
      function App(){const[visible,setVisible]=useState(true);window.setPaymentVisible=setVisible;return <><button id='outside'>Outside</button><Activity mode={visible?'visible':'hidden'}>{mode==='market'?<CardCheckoutPanel pluginId='booking-policy' pluginName='Booking policy' billingState={billing} ready hasActiveSubscription={false} onStateChange={()=>{}}/>:<BookingCardPayment payment={payment}/>}</Activity></>};
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, splitting: true, format: "esm", write: false, outdir: "payment-fixture", entryNames: "fixture", chunkNames: "chunks/[name]-[hash]", jsx: "automatic",
    alias: { "@": process.cwd() }, define: { "process.env.NEXT_PUBLIC_BOOKING_STRIPE_PUBLISHABLE_KEY": '"pk_test_fixture"', "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "payment-stubs", setup(builder) {
      builder.onResolve({ filter: /^(next\/navigation|@stripe\/stripe-js(?:\/pure)?|\.\/card-payment-actions|\.\/booking-payment-status)$/ }, args => ({ path: args.path, namespace: "payment-stub" }));
      builder.onLoad({ filter: /.*/, namespace: "payment-stub" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        args.path === "@stripe/stripe-js" ? `throw Error('eager SDK entry must never be imported');` :
        args.path === "@stripe/stripe-js/pure" ? `
          window.stats.imports++;if(window.holdModule)await new Promise(resolve=>window.releaseModule=resolve);
          const stripe={async createEmbeddedCheckoutPage(options){window.stats.creates++;const embedded={mount(){window.stats.mounts++},destroy(){window.stats.destroys++}};window.completeCheckout=options.onComplete;if(window.holdEmbedded)return new Promise(resolve=>window.releaseEmbedded=()=>resolve(embedded));return embedded}};
          export async function loadStripe(...args){window.stats.loads.push(args);if(window.holdSdk)return new Promise(resolve=>window.releaseSdk=()=>resolve(stripe));return stripe}
        ` :
        args.path === "next/navigation" ? `export function useRouter(){return{refresh(){window.stats.routerRefreshes++}}}` :
        args.path === "./card-payment-actions" ? `export async function startCardCheckout(){window.stats.starts++;return{clientSecret:'fixture-secret',publishableKey:'pk_test_fixture'}}export async function refreshCardPurchase(){window.stats.refreshes++;if(window.holdRefresh)return new Promise(resolve=>window.releaseRefresh=()=>resolve({message:'Confirmed fixture'}));return{message:'Confirmed fixture'}}` :
        `import React from'react';export function BookingPaymentStatus(){return <p>Verified fixture</p>}`,
      }));
    }}],
  });
  const files = new Map(bundle.outputFiles.map(file => [file.path.split("payment-fixture")[1].replaceAll("\\", "/"), file.text]));
  const server = createServer((request, response) => {
    const file = files.get(request.url.split("?")[0]);
    if (file) { response.setHeader("Content-Type", "text/javascript"); response.end(file); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-proxy-server"] });
  const base = `http://127.0.0.1:${server.address().port}`;
  const errors = [], requests = [];
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const stats = () => page.evaluate(() => window.stats);
  try {
    for (const mode of ["market", "booking-test", "booking-complete"]) {
      await page.goto(`${base}/?mode=${mode}`);
      await page.waitForFunction(() => document.querySelector("#outside") && window.stats);
      await page.waitForTimeout(30);
      assert.equal((await stats()).imports, 0, mode);
      assert.equal((await stats()).loads.length, 0, mode);
      assert.equal((await stats()).starts, 0, mode);
    }
    assert.ok(!requests.some(url => url.includes("stripe.com")), "browsing makes no Stripe script request");

    await page.goto(`${base}/?mode=market`);
    await page.getByRole("button", { name: "Buy with card", exact: true }).waitFor();
    await page.evaluate(() => { window.holdModule = true; });
    await page.getByRole("button", { name: "Buy with card", exact: true }).click();
    await page.waitForFunction(() => typeof window.releaseModule === "function");
    assert.equal((await stats()).starts, 1);
    await page.evaluate(() => window.setPaymentVisible(false));
    await page.locator("#outside").click();
    await page.evaluate(() => window.setPaymentVisible(true));
    await page.getByRole("button", { name: "Buy with card", exact: true }).waitFor();
    await page.evaluate(() => window.releaseModule());
    await page.waitForTimeout(30);
    assert.equal((await stats()).loads.length, 0, "old module completion cannot start SDK after reveal");
    assert.equal((await stats()).starts, 1, "reveal must not replay create checkout");
    await page.getByRole("button", { name: "Buy with card", exact: true }).click();
    await page.waitForFunction(() => window.stats.mounts === 1);
    assert.equal((await stats()).starts, 2, "only a fresh user action creates the next checkout");
    assert.deepEqual((await stats()).loads, [["pk_test_fixture"]]);
    await page.evaluate(() => { window.holdRefresh = true; void window.completeCheckout(); });
    await page.waitForFunction(() => typeof window.releaseRefresh === "function");
    await page.evaluate(() => window.setPaymentVisible(false));
    await page.locator("#outside").click();
    await page.evaluate(() => { window.setPaymentVisible(true); window.releaseRefresh(); });
    await page.getByRole("button", { name: "Buy with card", exact: true }).waitFor();
    await page.waitForTimeout(30);
    assert.equal((await stats()).destroys, 1);
    assert.equal((await stats()).routerRefreshes, 0, "old completion cannot refresh a newly revealed view");
    await page.evaluate(() => window.completeCheckout());
    assert.equal((await stats()).refreshes, 1, "destroyed checkout callback cannot even start another status read");
    await page.getByRole("button", { name: "Buy with card", exact: true }).click();
    await page.waitForFunction(() => window.stats.mounts === 2);
    await page.getByRole("button", { name: "Check payment status", exact: true }).click();
    await page.waitForFunction(() => window.stats.refreshes === 2);
    await page.evaluate(() => window.setPaymentVisible(false));
    await page.locator("#outside").click();
    await page.evaluate(() => { window.setPaymentVisible(true); window.releaseRefresh(); });
    await page.getByRole("button", { name: "Buy with card", exact: true }).waitFor();
    await page.waitForTimeout(30);
    assert.equal((await stats()).routerRefreshes, 0, "late manual status response cannot refresh a newly revealed route");
    assert.equal(await page.getByRole("status").innerText(), "");
    assert.equal((await stats()).starts, 3, "manual status and reveal never create another transaction");

    await page.goto(`${base}/?mode=market`);
    await page.getByRole("button", { name: "Buy with card", exact: true }).waitFor();
    await page.evaluate(() => { window.holdSdk = true; });
    await page.getByRole("button", { name: "Buy with card", exact: true }).click();
    await page.waitForFunction(() => typeof window.releaseSdk === "function");
    await page.evaluate(() => window.setPaymentVisible(false));
    await page.locator("#outside").click();
    await page.evaluate(() => { window.setPaymentVisible(true); window.releaseSdk(); });
    await page.getByRole("button", { name: "Buy with card", exact: true }).waitFor();
    await page.waitForTimeout(30);
    assert.equal((await stats()).creates, 0, "SDK completion after navigation must not create embedded UI");
    assert.equal((await stats()).starts, 1);

    await page.addInitScript(() => { window.holdModule = true; window.holdEmbedded = true; });
    await page.goto(`${base}/?mode=booking-live`);
    await page.waitForFunction(() => typeof window.releaseModule === "function");
    await page.evaluate(() => window.setPaymentVisible(false));
    await page.locator("#outside").click();
    await page.evaluate(() => window.releaseModule());
    await page.waitForTimeout(30);
    assert.equal((await stats()).loads.length, 0, "hidden booking module completion cannot load remote SDK");
    await page.evaluate(() => { window.holdModule = false; window.setPaymentVisible(true); });
    await page.waitForFunction(() => typeof window.releaseEmbedded === "function");
    assert.deepEqual((await stats()).loads, [["pk_test_fixture", { stripeAccount: "acct_fixture" }]]);
    await page.evaluate(() => window.setPaymentVisible(false));
    await page.locator("#outside").click();
    await page.evaluate(() => window.releaseEmbedded());
    await page.waitForFunction(() => window.stats.destroys === 1);
    assert.equal((await stats()).mounts, 0, "a late embedded checkout is destroyed before mounting");
    await page.evaluate(() => { window.holdEmbedded = false; window.setPaymentVisible(true); });
    await page.waitForFunction(() => window.stats.mounts === 1);
    await page.evaluate(() => window.completeCheckout());
    await page.getByText("Verified fixture", { exact: true }).waitFor();
    assert.equal((await stats()).destroys, 2);
    assert.equal((await stats()).starts, 0, "booking display never creates a Market transaction");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
