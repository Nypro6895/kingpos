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
// Compile the actual private UI functions without their server-only page imports.
function functionsFrom(file, names) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return names.map(name => {
    const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(node, `${name} exists in ${file}`);
    return node.getText(source);
  }).join("\n");
}

test("booking rules and related settings drawers keep mobile actions visible and usable", { timeout: 90000, skip: !existsSync(executablePath) }, async () => {
  const booking = functionsFrom("app/bookings/booking-workspace-client.tsx", [
    "classNames", "settingsToInput", "InlineActionMessage", "QuickSetupDrawerFrame", "BookingRulesQuickSetupDrawer", "ModalFrame", "getFocusable", "Toggle", "NumberField",
  ]);
  const salon = functionsFrom("app/salon-profile/salon-profile-studio.tsx", ["Drawer"]);
  const staff = functionsFrom("app/staff/staff-slide-over.tsx", ["StaffSlideOver"]);
  const profile = functionsFrom("app/staff/my-work/staff-profile-settings-drawer.tsx", ["StaffProfileSettingsDrawer"]);
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{Activity,useCallback,useEffect,useId,useRef,useState,useTransition} from 'react';
import{createRoot}from'react-dom/client';import{createPortal}from'react-dom';
import{useCloseOnNavigation,useOverlayPortalHost}from'./components/overlay-dismissal';
import{translateVietnamese}from'./lib/vietnamese-dictionary';
const translate=text=>translateVietnamese(text,new URLSearchParams(location.search).has('vi'));
const useWorkspaceTranslation=()=>translate;const WorkspaceText=({text})=>translate(text);
const styles={primaryButton:'booking-primary-button',select:'booking-select'};
const router={replace(){window.closed=true}};const useRouter=()=>router;
const settings={any_professional_enabled:false,auto_assign_enabled:true,reminder_enabled:true,confirmation_email_enabled:true,confirmation_sms_enabled:true,booking_enabled:true,cancellation_window_minutes:1440,confirmation_mode:'request_confirmation',default_cleanup_buffer_minutes:10,guest_booking_enabled:false,maximum_advance_window_days:15,minimum_lead_time_minutes:720,online_booking_visible:true,same_day_booking_enabled:true,slot_interval_minutes:60,split_staff_appointment_enabled:true,ticket_creation_mode:'manual',timezone_iana:'America/Chicago'};
window.saved=[];async function updateBookingSettingsAction(state){window.saved.push(state);return await new Promise(resolve=>window.finishSave=resolve)};
${booking}\n${salon}\n${staff}\n${profile}
function LongForm(){return <form><div style={{height:1100}}>Long settings</div><button type='button' id='last-action'>Save settings</button></form>}
function StaffPublicProfileEditor(){return <LongForm/>}
function App(){const[open,setOpen]=useState(false);const[kind,setKind]=useState('rules');const[visible,setVisible]=useState(true);const[canManage,setCanManage]=useState(true);window.choose=value=>{setKind(value);setOpen(false);window.closed=false};window.setVisible=setVisible;window.setCanManage=setCanManage;return <><main style={{transform:'translateZ(0)',height:2000}}><button id='open' onClick={()=>setOpen(true)}>Open settings</button><Activity mode={visible?'visible':'hidden'}>{open?(kind==='rules'?<BookingRulesQuickSetupDrawer canManage={canManage} settings={settings} onClose={()=>setOpen(false)}/>:kind==='quick'?<QuickSetupDrawerFrame title='Services and professionals' subtitle='Manage services, assignments, and long settings on this page.' onClose={()=>setOpen(false)}><LongForm/></QuickSetupDrawerFrame>:kind==='salon'?<Drawer title='Salon profile and booking information' onClose={()=>setOpen(false)}><LongForm/></Drawer>:kind==='staff'?<StaffSlideOver title='Staff schedule and profile settings' subtitle='Manage availability and professional details.' closeHref='/staff'><LongForm/></StaffSlideOver>:<StaffProfileSettingsDrawer staff={{}} displayName='Test staff' avatarUrl={null} closeHref='/staff'/>):null}</Activity></main><nav style={{position:'fixed',bottom:0,left:0,right:0,height:84,zIndex:50,background:'white',borderTop:'1px solid #ddd'}}>Today · Book · Profile · Notifications · More</nav></>};createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, outfile: "fixture.js", jsx: "automatic", alias: { "@": process.cwd() }, plugins: [{ name: "navigation", setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "nav", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const usePathname=()=>'/bookings'" }));
  } }] });
  const source = readFileSync("app/globals.css", "utf8").replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./bookings";\n@source "./staff";\n@source "./salon-profile";');
  const css = (await postcss([tailwind()]).process(source, { from: path.resolve("app/globals.css") })).css
    + readFileSync("components/settings-style.css", "utf8")
    + readFileSync("app/bookings/booking-workspace.css", "utf8");
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("http://booking.test/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text}</script></body></html>` }));
  const reachable = async (locator, label) => {
    assert.ok(await locator.evaluate(el => {
      const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width > 0 && r.x >= 0 && r.right <= innerWidth + 1 && r.y >= 0 && r.bottom <= innerHeight + 1 && el.contains(hit);
    }), `${label} fits the viewport and receives taps`);
  };
  try {
    for (const lang of ["", "?vi"]) {
      await page.goto(`http://booking.test/${lang}`);
      await page.locator("#open").click();
      for (const [width, height] of [[320,568],[390,844],[430,932],[844,390],[1280,800],[390,360]]) {
        await page.setViewportSize({ width, height });
        const close = page.locator(".booking-quick-setup-close"), save = page.locator(".booking-rules-actions button");
        await reachable(close, `Close ${width}×${height} ${lang}`);
        await reachable(save, `Save ${width}×${height} ${lang}`);
        assert.equal(await close.evaluate(el => el.offsetWidth), 44);
        assert.ok(await page.locator(".booking-quick-setup-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        await page.locator(".booking-quick-setup-body").evaluate(el => el.scrollTop = el.scrollHeight);
        await reachable(page.locator('.booking-rules-section input[type="checkbox"]').last().locator(".."), "Last setting");
        await reachable(save, "Save after scrolling");
        await page.locator(".booking-quick-setup-body").evaluate(el => el.scrollTop = 0);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      if (process.env.BOOKING_QA_DIR) {
        await mkdir(process.env.BOOKING_QA_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.BOOKING_QA_DIR, `booking-rules${lang ? '-vi' : ''}.png`) });
      }
      await page.locator('input[type="number"]').first().fill("60");
      await page.locator('.booking-rules-section input[type="checkbox"]').first().locator('..').click();
      assert.equal(await page.locator('.booking-rules-section input[type="checkbox"]').first().isChecked(), false);
      await page.locator(".booking-rules-actions button").click();
      await page.waitForFunction(() => window.saved.length === 1);
      assert.equal(await page.locator(".booking-rules-actions button").isDisabled(), true);
      const saved = await page.evaluate(() => window.saved[0]);
      assert.equal(saved.minimumLeadTimeMinutes, 60); assert.equal(saved.maximumAdvanceWindowDays, 15);
      assert.equal(saved.autoAssignEnabled, false);
      assert.equal(saved.timezoneIana, "America/Chicago"); assert.equal(saved.confirmationSmsEnabled, true);
      await page.evaluate(() => window.finishSave({ ok: false, message: "Please try again." }));
      await page.getByRole("status").waitFor(); await reachable(page.getByRole("status"), "Save error");
      await page.locator(".booking-rules-actions button").click();
      await page.waitForFunction(() => window.saved.length === 2);
      await page.evaluate(() => window.finishSave({ ok: true, message: "Saved." }));
      await page.waitForFunction(() => !document.querySelector('.booking-rules-actions button').disabled);
      await reachable(page.getByRole("status"), "Save success");
      await page.locator(".booking-quick-setup-close").click();
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(await page.locator("#open").evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      await page.locator("#open").click(); await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.locator("#open").click();
      await page.locator('.booking-quick-setup-close').focus(); await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('.booking-rules-actions button').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.booking-quick-setup-close').evaluate(el => el === document.activeElement), true);
      await page.evaluate(() => window.setVisible(false));
      await page.waitForFunction(() => document.body.style.overflow === '');
      await page.evaluate(() => window.setVisible(true));
      await page.locator('.booking-quick-setup-close').waitFor();
      await reachable(page.locator('.booking-rules-actions button'), 'Save after returning to Book');
    }
    await page.goto("http://booking.test/");
    await page.evaluate(() => window.setCanManage(false)); await page.locator("#open").click();
    assert.equal(await page.locator(".booking-rules-actions button").count(), 0);
    assert.equal(await page.locator('input[type="number"]').first().isDisabled(), true);
    await page.locator(".booking-quick-setup-close").click();
    for (const kind of ["quick", "salon", "staff", "profile"]) {
      await page.goto("http://booking.test/"); await page.evaluate(kind => window.choose(kind), kind);
      await page.locator("#open").click();
      for (const [width,height] of [[320,568],[844,390],[1280,800]]) {
        await page.setViewportSize({width,height});
        const close = page.getByRole("dialog").locator('button').filter({hasText:/^Close$|^x$/});
        await reachable(kind === 'quick' ? page.locator('.booking-quick-setup-close') : kind === 'salon' ? close : close.last(), `${kind} close`);
        await page.locator("#last-action").scrollIntoViewIfNeeded();
        await reachable(page.locator("#last-action"), `${kind} last save`);
      }
      await page.locator("#last-action").click();
      const close = kind === 'quick' ? page.locator('.booking-quick-setup-close') : page.getByRole('dialog').locator('button').filter({hasText:/^Close$|^x$/}).last();
      await close.click();
      assert.equal(await page.getByRole('dialog').count(), 0, `${kind} closes`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
