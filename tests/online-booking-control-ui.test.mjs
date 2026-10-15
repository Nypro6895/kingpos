import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sourcePath = "app/bookings/booking-workspace-client.tsx";
const ast = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ["classNames", "settingsToInput", "InlineActionMessage", "OnlineBookingControlCard", "bookingReadinessSteps"]
  .map(name => {
    const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, name);
    return node.getText(ast);
  }).join("\n");

test("online booking uses an accessible sliding switch with honest status and recoverable saves", { timeout: 90000, skip: !existsSync(executablePath) }, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState,useTransition} from 'react';import{createRoot}from'react-dom/client';
import{getSalonOnlineBookingStatus}from'./lib/booking-status';
import{translateVietnamese}from'./lib/vietnamese-dictionary';
const translate=text=>translateVietnamese(text,new URLSearchParams(location.search).has('vi'));
window.saveErrorText=translate('Please try again.');
const useWorkspaceTranslation=()=>translate;const WorkspaceText=({text})=>translate(text);
const styles={secondaryButton:'booking-secondary-button'};
const firstStaffMissingAvailability=()=>null;const buildReadinessByStaff=()=>({});const staffHasWorkingHours=()=>true;
${functions}
const initial={booking_enabled:true,online_booking_visible:true,guest_booking_enabled:false,timezone_iana:'America/Chicago',minimum_lead_time_minutes:120,maximum_advance_window_days:60,slot_interval_minutes:15,confirmation_mode:'request_confirmation',any_professional_enabled:false};
const root=createRoot(document.getElementById('root'));let settings={...initial};let canManage=true;let isReady=true;
function render(){root.render(<main data-booking-surface='owner'><OnlineBookingControlCard canManage={canManage} isReady={isReady} publicBookingHref='/book/test-salon' settings={settings}/></main>)};
window.reset=(patch={})=>{settings={...initial,...patch};canManage=true;isReady=true;render()};
window.setAccess=value=>{canManage=value;render()};window.setReady=value=>{isReady=value;render()};window.calls=[];
async function updateBookingSettingsAction(input){window.calls.push(input);return await new Promise(resolve=>window.finishSave=response=>{if(response.ok){settings={...settings,booking_enabled:input.bookingEnabled,online_booking_visible:input.onlineBookingVisible,guest_booking_enabled:input.guestBookingEnabled};render()}resolve(response)})};
window.checkReadiness=flags=>bookingReadinessSteps({...flags,options:{services:[],staff:[]},warnings:[],timezoneIana:'America/Chicago'}).find(item=>item.id==='settings').complete;
render();
` }, bundle: true, write: false, outfile: "fixture.js", jsx: "automatic" });
  const globals = readFileSync("app/globals.css", "utf8").replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./bookings";');
  const css = (await postcss([tailwind()]).process(globals, { from: path.resolve("app/globals.css") })).css + readFileSync("app/bookings/booking-workspace.css", "utf8");
  const browser = await chromium.launch({ executablePath, headless: true });
  await mkdir("work/booking-online-fix/qa", { recursive: true });
  try {
    for (const lang of ["", "?vi"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.route("http://booking.test/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>` }));
      await page.goto("http://booking.test/" + lang);
      const toggle = page.getByRole("switch");
      assert.equal(await toggle.getAttribute("aria-checked"), "false", "guest access off must not show online booking on");
      const position = () => page.locator(".booking-publish-toggle-thumb").evaluate(el => el.getBoundingClientRect().left - el.parentElement.getBoundingClientRect().left);
      assert.equal(await position(), 2);
      await page.screenshot({ path: `work/booking-online-fix/qa/switch-off${lang ? '-vi' : ''}.png` });
      for (const width of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await toggle.boundingBox();
        assert.ok(bounds.width >= 44 && bounds.height >= 44);
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await toggle.focus(); await page.keyboard.press("Space");
      await page.waitForFunction(() => window.calls.length === 1);
      assert.equal(await toggle.isDisabled(), true);
      assert.equal(await toggle.getAttribute("aria-busy"), "true");
      const saved = await page.evaluate(() => window.calls[0]);
      assert.equal(saved.bookingEnabled, true); assert.equal(saved.onlineBookingVisible, true); assert.equal(saved.guestBookingEnabled, true);
      assert.equal(saved.minimumLeadTimeMinutes, 120); assert.equal(saved.anyProfessionalEnabled, false);
      await page.evaluate(() => window.finishSave({ ok: false, message: "Please try again." }));
      await page.getByRole("status").filter({ hasText: await page.evaluate(() => window.saveErrorText) }).waitFor();
      assert.equal(await toggle.isEnabled(), true); assert.equal(await toggle.getAttribute("aria-checked"), "false");
      await toggle.click(); await page.waitForFunction(() => window.calls.length === 2);
      await page.evaluate(() => window.finishSave({ ok: true, message: "Saved." }));
      await page.waitForFunction(() => document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'true' && !document.querySelector('[role="switch"]').disabled);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.booking-publish-toggle-thumb')).transform === 'matrix(1, 0, 0, 1, 20, 0)');
      assert.equal(await position(), 22);
      await page.screenshot({ path: `work/booking-online-fix/qa/switch-on${lang ? '-vi' : ''}.png` });
      await toggle.focus(); await page.keyboard.press("Enter"); await page.waitForFunction(() => window.calls.length === 3);
      const paused = await page.evaluate(() => window.calls[2]);
      assert.equal(paused.bookingEnabled, false); assert.equal(paused.onlineBookingVisible, false); assert.equal(paused.guestBookingEnabled, true);
      await page.evaluate(() => window.finishSave({ ok: true, message: "Saved." }));
      await page.waitForFunction(() => document.querySelector('[role="switch"]').getAttribute('aria-checked') === 'false');
      await page.evaluate(() => window.setAccess(false)); assert.equal(await toggle.isDisabled(), true);
      for (const flags of [{ bookingEnabled: false, onlineBookingVisible: true, guestBookingEnabled: true }, { bookingEnabled: true, onlineBookingVisible: false, guestBookingEnabled: true }, { bookingEnabled: true, onlineBookingVisible: true, guestBookingEnabled: false }]) {
        assert.equal(await page.evaluate(flags => window.checkReadiness(flags), flags), false);
      }
      assert.equal(await page.evaluate(() => window.checkReadiness({ bookingEnabled: true, onlineBookingVisible: true, guestBookingEnabled: true })), true);
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});
