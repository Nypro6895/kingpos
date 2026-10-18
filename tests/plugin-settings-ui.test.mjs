import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const output = "work/plugin-settings-consistency-20261016/qa";
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{BookingRulesSettings,BookSmsSettings}from'./app/settings/booking-plugin-settings';
import{PluginActivationPrompt,PluginActivationButton}from'./app/settings/plugin-settings-row';
import{PluginMarketSettings}from'./app/settings/plugin-market-settings';
const root=createRoot(document.getElementById('root'));let revision=0;
window.reset=(active=false)=>{window.active=active;window.calls=[];root.render(<div key={++revision}><BookingRulesSettings salonId='salon-a'/><BookSmsSettings salonId='salon-a'/><PluginMarketSettings salonId='salon-a' group='salon'/><PluginMarketSettings salonId='salon-a' group='pos'/><PluginMarketSettings salonId='salon-a' group='payroll'/></div>)};window.reset();
` }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", plugins: [{ name: "inert-actions", setup(b) {
  b.onResolve({ filter: /^(next\/link|@\/components\/workspace-language)$|\.\/plugin-(?:settings|market-status)-actions$/ }, args => ({ path: args.path, namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
    args.path === "next/link" ? `export default function Link({prefetch,...props}){return <a {...props}/>}` : args.path.endsWith("workspace-language") ? `export const useWorkspaceTranslation=()=>value=>value;` : args.path.endsWith("plugin-settings-actions") ? `
    const policy=()=>({active:window.active,subscribed:window.active,content:'Please arrive early.',published:false});
    const sms=()=>({active:window.active,installed:window.active,enabled:false,confirmation:true,reminders:false,accountSid:'saved',messagingServiceSid:'saved',from:'',tokenConfigured:!window.missingSender});
    export async function loadBookingRulesSettingsAction(){return {state:policy()}}
    export async function loadBookSmsSettingsAction(){return {state:sms()}}
    export async function saveBookingRulesSettingsAction(salon,content,published){window.calls.push({type:'rules',salon,content,published});return window.failSave?{error:'Could not save.'}:{state:{...policy(),content,published}}}
    export async function saveBookSmsSettingsAction(salon,options){window.calls.push({type:'sms',salon,options});return {state:{...sms(),...options}}}
    ` : `
    export async function loadPluginMarketStatusAction(salon,group){return {rows:(group==='salon'?[['Campaigns','Run ads for your salon','/campaigns']]:group==='pos'?[['Check-in Receipt','Print check-in receipts'],['Phone Checkin','Check in customers by phone']]:[['Payroll Data Download','Download payroll data','/payroll?tab=download'],['Tax Company','Connect your tax company','/payroll/tax-company/settings']]).map(([name,label,settingsHref])=>({name,label,settingsHref,active:window.active}))}}
    `,
  }));
} }] });

async function fixture(run) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("http://plugins.test/**", route => {
    const path = new URL(route.request().url()).pathname;
    const file = bundle.outputFiles.find(file => file.path.endsWith(path === "/app.css" ? ".css" : ".js"));
    return route.fulfill({ contentType: path === "/" ? "text/html" : path.endsWith("css") ? "text/css" : "text/javascript", body: path === "/" ? '<!doctype html><html><head><link rel="stylesheet" href="/app.css"><style>body{font-family:Arial;margin:0}main{max-width:1040px;margin:24px auto;padding:16px}*{box-sizing:border-box}a{color:#3730a3}</style></head><body><main id="root"></main><script src="/app.js"></script></body></html>' : file.text });
  });
  try { await page.goto("http://plugins.test/"); await page.waitForFunction(() => document.querySelectorAll('[role="switch"]:not(:disabled)').length === 6); await run(page); assert.deepEqual(errors, []); }
  finally { await browser.close(); }
}

test("feature labels stay concise; activation appears only after an attempted use and never writes", async () => fixture(async page => {
  assert.equal(await page.getByRole("link", { name: "Open Market" }).count(), 0);
  assert.equal(await page.getByRole("textbox").count(), 0);
  assert.equal(await page.getByRole("checkbox").count(), 0);
  assert.doesNotMatch(await page.locator("main").innerText(), /Tiếng Việt|Stripe|Twilio|subscription|USD|per month/);
  for (const [label, name] of [["Show booking rules", "Booking Rules"], ["Send booking SMS", "BookSMS"], ["Run ads for your salon", "Campaigns"], ["Print check-in receipts", "Check-in Receipt"], ["Check in customers by phone", "Phone Checkin"], ["Connect your tax company", "Tax Company"]]) {
    const region = page.getByRole("region", { name: label, exact: true });
    await region.getByRole("switch").click();
    const dialog = page.getByRole("dialog", { name: name === "Campaigns" ? "Advertising" : name, exact: true });
    await dialog.waitFor();
    assert.equal(await region.locator('[role="switch"]').getAttribute("aria-checked"), "false");
    assert.equal(await dialog.getByRole("link", { name: "Open Market" }).getAttribute("href"), `/market?q=${encodeURIComponent(name)}`);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.getByRole("link", { name: "Open Market" }).count(), 0);
  }
  const download = page.getByRole("region", { name: "Download payroll data" });
  assert.equal(await download.getByRole("status").count(), 0);
  await download.getByRole("button", { name: "Download", exact: true }).click();
  assert.equal(await page.getByRole("dialog").getByRole("link").getAttribute("href"), "/market?q=Payroll%20Data%20Download");
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: `${output}/inactive-desktop.png`, fullPage: true });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await download.getByRole("button", { name: "Download", exact: true }).evaluate(button => button === document.activeElement), true);
}));

test("activated rules and SMS save only operational settings; other plugins keep their existing workspaces", async () => fixture(async page => {
  await page.evaluate(() => window.reset(true));
  const rules = page.getByRole("region", { name: "Show booking rules", exact: true });
  const sms = page.getByRole("region", { name: "Send booking SMS", exact: true });
  await rules.getByRole("button", { name: "Save", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Manage in Market" }).count(), 0);
  assert.equal(await rules.getByRole("textbox").isVisible(), false, "editor starts collapsed");
  await rules.getByText("Edit booking rules", { exact: true }).click();
  await rules.getByLabel("Booking rules", { exact: true }).fill("Please arrive 10 minutes early.");
  await rules.getByRole("switch").click(); await rules.getByRole("button", { name: "Save", exact: true }).click();
  await rules.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await sms.getByRole("switch").click(); await sms.getByLabel("Reminders", { exact: true }).check();
  await sms.getByRole("button", { name: "Save", exact: true }).click();
  await sms.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.calls), [{ type: "rules", salon: "salon-a", content: "Please arrive 10 minutes early.", published: true }, { type: "sms", salon: "salon-a", options: { enabled: true, confirmation: true, reminders: true } }]);
  assert.equal(await page.getByRole("region", { name: "Campaigns", exact: true }).getByRole("link", { name: "Open", exact: true }).getAttribute("href"), "/campaigns");
  assert.equal(await page.getByRole("region", { name: "Payroll Data Download", exact: true }).getByRole("link", { name: "Download", exact: true }).getAttribute("href"), "/payroll?tab=download");
  assert.equal(await page.getByRole("region", { name: "Tax Company", exact: true }).getByRole("link", { name: "Open", exact: true }).getAttribute("href"), "/payroll/tax-company/settings");
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/active-${width}.png`, fullPage: true });
  }
  await page.evaluate(() => { window.missingSender = true; window.reset(true); });
  await sms.getByRole("button", { name: "Save", exact: true }).waitFor();
  await sms.getByRole("switch").click();
  await sms.getByRole("link", { name: "Open Market" }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.calls), []);
}));
