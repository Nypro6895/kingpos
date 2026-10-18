import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const outputDirectory = "work/booking-deposit-compact-settings-20261016/qa";
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {BookingDepositSettings} from './app/settings/booking-deposit-settings';
      const root=createRoot(document.getElementById('root'));
      let version=0;
      window.reset=(state,options={})=>{
        window.fixture=state;window.options=options;window.calls=[];window.loads=[];
        root.render(<BookingDepositSettings key={++version} salonId={options.salonId||'salon-a'}/>);
      };
      window.reset({enabled:false,mode:'fixed',value:20,checkout:'both',installed:false,active:false,subscribed:false,connected:false});
    `,
  },
  bundle: true, write: false, outdir: "fixture", jsx: "automatic",
  plugins: [{ name: "local-fixture", setup(builder) {
    builder.onResolve({ filter: /^(next\/link|@\/components\/workspace-language|@\/app\/market\/booking-deposit-actions)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
      args.path === "next/link" ? `export default function Link({prefetch,...props}){return <a {...props}/>}` :
      args.path.endsWith("workspace-language") ? `export const useWorkspaceTranslation=()=>text=>text;` : `
        export async function loadBookingDepositAction(salonId){
          window.loads.push(salonId);
          if(window.options.loadError)return {error:window.options.loadError};
          return {state:{...window.fixture}};
        }
        export async function saveBookingDepositAction(state,salonId){
          window.calls.push({state:{...state},salonId});
          return await new Promise(resolve=>window.finishSave=()=>resolve(window.options.saveError?{error:window.options.saveError}:{state}));
        }
      `,
    }));
  } }],
});

const inactive = { enabled: false, mode: "fixed", value: 20, checkout: "both", installed: false, active: false, subscribed: false, connected: false };
const active = { ...inactive, installed: true, active: true, subscribed: true, connected: true };

async function fixture(run) {
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://deposit.test/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    const asset = pathname === "/app.js" ? bundle.outputFiles.find(file => file.path.endsWith(".js")) : pathname === "/app.css" ? bundle.outputFiles.find(file => file.path.endsWith(".css")) : null;
    return route.fulfill({ contentType: pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".css") ? "text/css" : "text/html", body: asset?.text ?? '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;font-family:Arial,sans-serif;color:#27272a}main{max-width:1040px;margin:32px auto;padding:16px}*{box-sizing:border-box}</style></head><body><main class="settings-direct-panel"><div id="root"></div></main><script src="/app.js"></script></body></html>' });
  });
  try {
    await page.goto("http://deposit.test/");
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.disabled === false);
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

async function reset(page, state, options = {}) {
  await page.evaluate(({ state, options }) => window.reset(state, options), { state, options });
  await page.waitForFunction(() => document.querySelector('section[aria-busy="false"]') !== null && window.loads.length === 1);
}

async function finishSave(page, count) {
  await page.waitForFunction(count => window.calls.length === count, count);
  assert.equal(await page.getByRole("switch").isDisabled(), true);
  await page.evaluate(() => window.finishSave());
  await page.waitForFunction(() => document.querySelector('section[aria-busy="false"]') !== null);
}

test("uninstalled deposits show one toggle and send activation to Market without saving", { skip: !existsSync(executablePath) }, async () => fixture(async page => {
  const toggle = page.getByRole("switch", { name: "Require deposit when booking" });
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  assert.equal(await page.getByRole("combobox").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link").count(), 0);
  await toggle.click();
  await page.getByRole("dialog", { name: "Booking Deposit", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Open Market" }).getAttribute("href"), "/market/booking-deposit");
  assert.equal(await page.locator('[role="switch"]').getAttribute("aria-checked"), "false");
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  assert.equal(await page.getByRole("combobox").count(), 0);
  mkdirSync(outputDirectory, { recursive: true });
  await page.screenshot({ path: `${outputDirectory}/activation-desktop.png` });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await toggle.evaluate(button => button === document.activeElement), true);

  for (const state of [{ ...active, active: false }, { ...active, connected: false }]) {
    await reset(page, state);
    await toggle.click();
    await page.getByRole("link", { name: "Open Market" }).waitFor();
    assert.equal(await page.locator('[role="switch"]').getAttribute("aria-checked"), "false");
    assert.deepEqual(await page.evaluate(() => window.calls), []);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  }
}));

test("compact installed controls preserve deposit amounts, checkout values and explicit saves", { skip: !existsSync(executablePath) }, async () => fixture(async page => {
  await reset(page, active);
  const toggle = page.getByRole("switch");
  const save = page.getByRole("button", { name: "Save", exact: true });
  assert.doesNotMatch(await page.locator("main").innerText(), /subscription|By Reylumi|Connect Stripe|processing|receipts/i);
  await toggle.focus(); await page.keyboard.press("Space");
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  await page.getByLabel("Deposit ($)", { exact: true }).fill("35.50");
  await page.getByLabel("Checkout method").selectOption("hosted");
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  await save.click(); await finishSave(page, 1);
  assert.deepEqual(await page.evaluate(() => window.calls[0]), { state: { ...active, enabled: true, value: 35.5, checkout: "hosted" }, salonId: "salon-a" });

  await page.getByLabel("Deposit type").selectOption("percent");
  assert.equal(await page.getByRole("status").count(), 0, "editing must clear the previous saved confirmation");
  await page.getByLabel("Deposit (%)", { exact: true }).fill("25");
  await page.getByLabel("Checkout method").selectOption("embedded");
  await save.click(); await finishSave(page, 2);
  assert.deepEqual(await page.evaluate(() => window.calls[1].state), { ...active, enabled: true, mode: "percent", value: 25, checkout: "embedded" });

  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok((await toggle.boundingBox()).height >= 44);
    if (width === 1280) assert.ok((await page.getByRole("region", { name: "Booking deposit settings" }).boundingBox()).height < 180);
  }
  mkdirSync(outputDirectory, { recursive: true });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: `${outputDirectory}/installed-mobile.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${outputDirectory}/installed-desktop.png` });

  await page.getByLabel("Deposit type").selectOption("full");
  assert.equal(await page.getByRole("spinbutton").count(), 0);
  await page.getByLabel("Checkout method").selectOption("both");
  await save.click(); await finishSave(page, 3);
  assert.deepEqual(await page.evaluate(() => window.calls[2].state), { ...active, enabled: true, mode: "full", value: 25, checkout: "both" });
}));

test("provider outage still allows turning deposits off, test mode works, and failures stay visible", { skip: !existsSync(executablePath) }, async () => fixture(async page => {
  const outage = { ...active, enabled: true, connected: false, active: false, mode: "percent", value: 40, checkout: "hosted" };
  await reset(page, outage);
  await page.getByRole("switch").click();
  assert.equal(await page.getByRole("link", { name: "Open Market" }).count(), 0);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await finishSave(page, 1);
  assert.deepEqual(await page.evaluate(() => window.calls[0].state), { ...outage, enabled: false });

  await reset(page, { ...active, connected: false, testMode: true });
  await page.getByRole("switch").click();
  assert.equal(await page.getByRole("switch").getAttribute("aria-checked"), "true");
  assert.equal(await page.getByRole("link", { name: "Open Market" }).count(), 0);

  await reset(page, active, { saveError: "Could not save.", salonId: "salon-b" });
  await page.getByRole("button", { name: "Save", exact: true }).click(); await finishSave(page, 1);
  await page.getByRole("status").filter({ hasText: "Could not save." }).waitFor();
  assert.equal(await page.evaluate(() => window.calls[0].salonId), "salon-b");
  assert.equal(await page.getByRole("switch").isEnabled(), true);

  await reset(page, active, { loadError: "Choose an active salon in your Owner workspace to manage this feature." });
  assert.equal(await page.getByRole("switch").isDisabled(), true);
  assert.equal(await page.getByRole("combobox").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).count(), 0);
  await page.getByRole("status").filter({ hasText: "Choose an active salon" }).waitFor();
}));
