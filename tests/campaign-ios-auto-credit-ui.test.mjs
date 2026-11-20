import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { browserServerBoundary } from "./helpers/browser-server-boundary.mjs";

const root = process.cwd();
const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ReylumiIOS/1.0.1";
const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 ReylumiIOS/1.0.1";
const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const android = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 ReylumiAndroid/1.0 ReylumiAndroidPOS/1.0";
const notice = "New automatic purchases and changes to their setup are unavailable in this iOS app.";
const wallet = {
  available_credits: 1234, reserved_credits: 222, welcome_credits: 100,
  installed: true, auto_topup_enabled: false, topup_credits: 500,
  threshold_credits: 100, monthly_limit_cents: 3000,
  payment_ready: true, has_payment_method: true, payment_blocked: false,
  low_credit_reminders: true,
};
const names = [...fs.readFileSync("app/market/scoped-market-actions.ts", "utf8").matchAll(/export async function (\w+)/g)].map(m => m[1]);
const scopedTransport = names.map(name => `export async function ${name}(salon,...args){
  if(!salon)throw Error('Missing fixture salon');
  window.calls.push({name:${JSON.stringify(name)},salon,args});
  switch(${JSON.stringify(name)}){
    case 'loadCampaignCardAction':return {brand:'Visa',last4:'4242'};
    case 'loadCampaignLedgerAction':return {entries:[{id:'fixture-ledger',kind:'purchase',credits:500,created_at:'2026-01-01T12:00:00Z'}],hasMore:false};
    case 'buyCampaignCreditsAction':case 'campaignCardSetupAction':return {ok:true,message:'Fixture payment prepared.',url:'https://checkout.stripe.com/c/pay/cs_test_fixture_only'};
    case 'campaignPaymentControlAction':if(window.holdControl)return new Promise(resolve=>window.finishControl=()=>resolve({ok:true,message:'Payments already processing may still finish.'}));return {ok:true,message:'Payments already processing may still finish.'};
    case 'saveCampaignTopupAction':return {ok:true,message:'Credit settings saved.'};
    case 'saveCampaignRemindersAction':return;
    default:throw Error('Unexpected fixture action: '+${JSON.stringify(name)});
  }
}`).join("\n");
const result = await build({
  stdin: { resolveDir: root, loader: "tsx", contents: `
    import React,{useState}from'react';import{createRoot,hydrateRoot}from'react-dom/client';import{renderToString}from'react-dom/server';
    import{CreditPanel}from'./app/campaigns/credit-panel';import{MarketTargetProvider}from'./app/market/scoped-market-client';
    function App(){const[salon,setSalon]=useState('fixture-salon-a');window.switchSalon=setSalon;
      return <MarketTargetProvider salonId={salon}><CreditPanel wallet={window.fixtureWallet} initialView={window.fixtureView}
      onClose={()=>window.closes++} onRefresh={async()=>{window.refreshes++}}/></MarketTargetProvider>}
    const target=document.getElementById('root');
    if(window.hydrateFixture){target.innerHTML=renderToString(<App/>);hydrateRoot(target,<App/>)}else createRoot(target).render(<App/>);
  ` }, bundle: true, write: false, outdir: "fixture", format: "iife", jsx: "automatic",
  alias: { "@": root }, plugins: [{ name: "isolated-credit-transport", setup(b) {
    b.onResolve({ filter: /scoped-market-actions$|workspace-language$|^next\/(navigation|link)$/ }, a => ({ path: a.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ loader: "tsx", resolveDir: root, contents:
      a.path.endsWith("scoped-market-actions") ? scopedTransport :
      a.path.endsWith("workspace-language") ? `import copy from './lib/vietnamese-campaign-copy.json';const t=x=>window.fixtureLanguage==='vi'?(copy[x]??x):x;export const useWorkspaceTranslation=()=>t;export const WorkspaceText=({text})=>t(text);` :
      a.path === "next/link" ? `import React from'react';export default function Link(p){return <a {...p}/>} ` :
      `export function usePathname(){return '/campaigns'}export function useSearchParams(){return new URLSearchParams()}` }));
  } }, browserServerBoundary()],
});
const js = result.outputFiles.find(f => f.path.endsWith(".js")).text;
const css = result.outputFiles.find(f => f.path.endsWith(".css")).text;

async function fixture(options, run) {
  const server = createServer((req, res) => {
    if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); return; }
    if (req.url === "/campaigns") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser, context;
  const external = [], errors = [];
  try {
    browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    context = await browser.newContext({ viewport: options.viewport ?? { width: 390, height: 844 }, userAgent: options.ua ?? ios, serviceWorkers: "block" });
    await context.route("**/*", route => {
      if (route.request().url().startsWith(origin + "/") && route.request().method() === "GET") return route.continue();
      external.push({ method: route.request().method(), origin: new URL(route.request().url()).origin });
      return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(origin + "/campaigns");
    await page.evaluate(({ wallet, view, hydrate, language }) => {
      Object.assign(window, { fixtureWallet: wallet, fixtureView: view, hydrateFixture: hydrate,
        fixtureLanguage: language, calls: [], bridgeCalls: [], refreshes: 0, closes: 0,
        __reylumiNativePayments: 1, webkit: { messageHandlers: { reylumi: { postMessage: message => window.bridgeCalls.push(message) } } } });
    }, { wallet: { ...wallet, ...options.wallet }, view: options.view, hydrate: options.hydrate, language: options.language });
    await page.addStyleTag({ content: `*{box-sizing:border-box}body{margin:0;padding:16px;font:16px Arial;background:#fcfdfb;color:#222}button,input,select{font:inherit}${css}` });
    await page.addScriptTag({ url: origin + "/fixture.js" });
    await run(page);
    assert.deepEqual(errors, []); assert.deepEqual(external, [], "no provider/other-network traffic");
  } finally {
    await context?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve));
    assert.equal(server.listening, false);
  }
}
async function calls(page, name) { return page.evaluate(name => window.calls.filter(c => c.name === name), name); }
async function screenshot(page, name) {
  if (!process.env.CAMPAIGN_IOS_QA_OUTPUT_DIR) return;
  const target = path.resolve(process.env.CAMPAIGN_IOS_QA_OUTPUT_DIR); fs.mkdirSync(target, { recursive: true });
  await page.screenshot({ path: path.join(target, name + ".png"), fullPage: true });
}
async function reviewWebSetup(page) {
  await page.getByLabel("Low balance reminder threshold", { exact: true }).fill("120");
  await page.getByRole("combobox").selectOption("1500");
  await page.getByLabel("Monthly credit limit", { exact: true }).fill("3600");
  await page.getByRole("button", { name: "Review payment & confirm →", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Enable automatic purchases", exact: true }).isDisabled(), true);
  await page.getByLabel("I authorize these automatic purchases within this monthly limit.", { exact: true }).check();
}

test("native iPhone and iPad defer new setup, including direct auto view and hydration, without changing wallet or sending actions", async () => {
  for (const options of [{ ua: ios, hydrate: true }, { ua: ipad, view: "auto", viewport: { width: 1024, height: 1366 } }]) {
    await fixture(options, async page => {
      if (!options.view) {
        const toggle = page.getByRole("switch", { name: "Automatically buy more credits", exact: true });
        await toggle.waitFor(); await page.waitForFunction(() => document.querySelector('[role="switch"]').disabled);
        assert.equal(await toggle.isChecked(), false);
        await page.getByRole("button", { name: "Automatic purchase settings", exact: true }).click();
      }
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      await dialog.getByText(notice, { exact: true }).waitFor();
      assert.equal(await dialog.locator("form,input,select").count(), 0);
      assert.equal(await dialog.getByRole("button", { name: "Enable automatic purchases", exact: true }).count(), 0);
      await dialog.getByText("Automatic purchases are off.", { exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      assert.deepEqual(await page.evaluate(() => window.fixtureWallet), wallet);
      await screenshot(page, options.ua === ios ? "iphone-deferred-auto-setup" : "ipad-deferred-auto-setup");
    });
  }
});

test("existing native automatic authorization stays visible and stoppable, including a pending stop without duplicate dispatch", () => fixture({ wallet: { auto_topup_enabled: true } }, async page => {
  const toggle = page.getByRole("switch", { name: "Automatically buy more credits", exact: true });
  assert.equal(await toggle.isChecked(), true); assert.equal(await toggle.isEnabled(), true);
  await page.getByRole("button", { name: "Automatic purchase settings", exact: true }).click();
  await page.getByText("Automatic purchases are on.", { exact: true }).waitFor();
  assert.equal((await page.getByRole("dialog").innerText()).includes("$30.00"), true);
  await page.evaluate(() => window.holdControl = true);
  const stop = page.getByRole("button", { name: "Stop automatic payments", exact: true }); await stop.click();
  await page.waitForFunction(() => typeof window.finishControl === "function");
  assert.equal(await stop.isDisabled(), true); assert.equal(await page.getByRole("button", { name: "Close dialog", exact: true }).isDisabled(), true);
  assert.deepEqual((await calls(page, "campaignPaymentControlAction")).map(c => [c.salon, c.args]), [["fixture-salon-a", ["stop"]]]);
  assert.equal((await calls(page, "saveCampaignTopupAction")).length, 0);
  assert.equal(await page.evaluate(() => window.fixtureWallet.auto_topup_enabled), true, "opening/stopping UI does not rewrite received preferences");
  await page.evaluate(() => window.finishControl()); await page.waitForFunction(() => window.refreshes === 1);
  await screenshot(page, "iphone-existing-authorization-stop");
}));

test("native one-off pack/card setup, Block/Unblock, reminders, history and scoped target retain their original transports", () => fixture({}, async page => {
  await page.getByRole("button", { name: "Add credits", exact: true }).click();
  await page.getByRole("button", { name: /1,800 credits/ }).click();
  await page.getByRole("button", { name: "Review payment →", exact: true }).click();
  await page.getByLabel("Save my card for future purchases", { exact: true }).check();
  await page.getByRole("button", { name: "Continue to secure payment →", exact: true }).click();
  await page.waitForFunction(() => window.bridgeCalls.length === 1);
  assert.deepEqual((await calls(page, "buyCampaignCreditsAction")).map(c => [c.salon, c.args]), [["fixture-salon-a", [1500, true]]]);
  assert.equal(await page.getByLabel("Save my card for future purchases", { exact: true }).isChecked(), true);
  await page.getByRole("button", { name: "Replace saved card", exact: true }).click();
  await page.waitForFunction(() => window.bridgeCalls.length === 2);
  assert.deepEqual(await page.evaluate(() => window.bridgeCalls.map(x => x.action)), ["open-payment", "open-payment"]);
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "Block new payments with this card", exact: true }).click();
  await page.waitForFunction(() => window.refreshes === 1);
  await page.evaluate(() => window.switchSalon("fixture-salon-b"));
  await page.getByRole("button", { name: "Stop automatic payments", exact: true }).click();
  await page.waitForFunction(() => window.refreshes === 2);
  assert.deepEqual((await calls(page, "campaignPaymentControlAction")).map(c => [c.salon, c.args]), [["fixture-salon-a", ["block"]], ["fixture-salon-b", ["stop"]]]);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  // This controlled preference changes only after a refreshed server wallet.
  await page.getByLabel("Remind me when credits are low", { exact: true }).click();
  await page.waitForFunction(() => window.refreshes === 3);
  await page.getByRole("button", { name: "Credit history", exact: true }).click();
  await page.getByRole("dialog").getByText(/Credits added/).waitFor();
  assert.equal((await calls(page, "loadCampaignLedgerAction")).at(-1).salon, "fixture-salon-b");
  assert.equal((await calls(page, "saveCampaignTopupAction")).length, 0);
  assert.deepEqual((await calls(page, "saveCampaignRemindersAction")).map(c => [c.salon, c.args]), [["fixture-salon-b", [false]]]);
}));

test("native already-blocked payments keep Unblock while manual purchase stays disabled", () => fixture({ view: "payment", wallet: { payment_blocked: true } }, async page => {
  assert.equal(await page.getByRole("button", { name: "Continue to secure payment →", exact: true }).isDisabled(), true);
  page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Allow new payments", exact: true }).click();
  await page.waitForFunction(() => window.refreshes === 1);
  assert.deepEqual((await calls(page, "campaignPaymentControlAction")).map(c => c.args), [["unblock"]]);
  assert.equal((await calls(page, "saveCampaignTopupAction")).length, 0);
}));

test("Safari, Android and desktop web retain affirmative enrollment and setup drafts", async () => {
  for (const ua of [safari, android, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0"]) {
    await fixture({ ua, view: "auto" }, async page => {
      await reviewWebSetup(page);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      assert.equal(await page.getByRole("combobox").inputValue(), "1500");
      assert.equal(await page.getByLabel("Monthly credit limit", { exact: true }).inputValue(), "3600");
      await page.getByRole("button", { name: "Review payment & confirm →", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Enable automatic purchases", exact: true }).isDisabled(), true);
      await page.getByLabel("I authorize these automatic purchases within this monthly limit.", { exact: true }).check();
      await page.getByRole("button", { name: "Enable automatic purchases", exact: true }).click();
      await page.waitForFunction(() => window.refreshes === 1);
      assert.deepEqual((await calls(page, "saveCampaignTopupAction")).map(c => [c.salon, c.args]), [["fixture-salon-a", [{ enabled: true, amount: 1500, threshold: 100, limit: 3000 }]]]);
    });
  }
});

test("submit and confirmation recheck the native marker at the event boundary even with a stale web DOM", async () => {
  for (const stage of ["setup", "confirmation"]) {
    await fixture({ ua: safari, view: "auto" }, async page => {
      if (stage === "confirmation") await reviewWebSetup(page);
      await page.evaluate(({ stage, ios }) => {
        Object.defineProperty(navigator, "userAgent", { configurable: true, value: ios });
        if (stage === "setup") document.querySelector("form").requestSubmit();
        else [...document.querySelectorAll("button")].find(b => b.textContent === "Enable automatic purchases").click();
      }, { stage, ios });
      await page.getByRole("dialog").getByText(notice, { exact: true }).first().waitFor();
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      assert.equal(await page.getByRole("dialog").locator("form").count(), 0);
    });
  }
});

test("approved iOS deferred state has translated copy without introducing a checkout or web bridge", () => fixture({ ua: ios, view: "auto", language: "vi" }, async page => {
  await page.getByText("App iOS hiện chưa hỗ trợ bật mới hoặc chỉnh thiết lập tự mua credit.", { exact: true }).waitFor();
  await page.getByText("Quản lý tự mua credit tại reylumi.com bằng trình duyệt.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").locator("a,form,input,select").count(), 0);
  assert.deepEqual(await page.evaluate(() => window.bridgeCalls), []);
  await screenshot(page, "iphone-deferred-auto-setup-vi");
}));
