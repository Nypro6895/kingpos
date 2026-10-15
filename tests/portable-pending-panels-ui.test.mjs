import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("portable pending tabs show their frame immediately, retain hidden reads and drafts, and isolate session failures", { skip: !existsSync(executablePath), timeout: 60000 }, async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{useState}from'react';import{createRoot}from'react-dom/client';
      import{PortablePanels}from'./app/pos/portable/portable-panels';import{PortableWorkspaceTabs}from'./app/pos/portable/portable-workspace-tabs';import{PORTABLE_POS_ROUTE_LINKS}from'./lib/pos-portable-routes';
      window.fixtureScope='salon-a:key-a';window.panelCalls=[];window.pendingPanels=[];window.routerPrefetches=0;
      function Panel({path,scope}){return <section data-loaded-panel={path} data-loaded-scope={scope}><input aria-label={path.endsWith('/book')?'Booking note':'Staff filter'} defaultValue=''/></section>}
      window.finishPanel=(path,scope)=>{const request=window.pendingPanels.find(row=>!row.settled&&row.path===path&&(!scope||row.scope===scope));if(!request)throw Error('No pending '+path);request.settled=true;request.resolve(<Panel path={path} scope={request.scope}/>)};
      window.failPanel=path=>{const request=window.pendingPanels.find(row=>!row.settled&&row.path===path);if(!request)throw Error('No pending '+path);request.settled=true;request.reject(Error('Fixture unavailable'))};
      function Desk(){const[amount,setAmount]=useState('');return <section><input aria-label='Entered amount' value={amount} onChange={event=>setAmount(event.target.value)}/></section>}
      function App(){const[scope,setScope]=useState(window.fixtureScope);const[allowed,setAllowed]=useState(PORTABLE_POS_ROUTE_LINKS.map(item=>item.href));const[mounted,setMounted]=useState(true);window.changeScope=next=>{window.fixtureScope=next;setScope(next)};window.changeAllowed=setAllowed;window.mountPanels=setMounted;const items=PORTABLE_POS_ROUTE_LINKS.filter(item=>allowed.includes(item.href));return <main data-fixture-scope={scope}><PortableWorkspaceTabs localPanels items={items} salonId='salon-a' salonLogoUrl={null} salonName='Fixture Salon' salonTimezone='America/Chicago'/>{mounted?<PortablePanels allowedPaths={allowed} panels={{}}><Desk/></PortablePanels>:null}</main>};
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": process.cwd() }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "portable-fixture", setup(builder) {
      builder.onResolve({ filter: /^(next\/(?:navigation|link|image)|@\/components\/workspace-language|@\/app\/pos\/portable\/(?:actions|use-portable-draft|portable-workspace-state|portable-sync-indicator)|@\/app\/pos\/pos-workspace-realtime-refresh|\.\/(?:load-panel|portable-workspace-state|desktop-tools|portable-booking-notifications|portable-fullscreen-button))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        args.path === "next/navigation" ? `
          import{useSyncExternalStore}from'react';const push=history.pushState.bind(history);history.pushState=(...args)=>{push(...args);window.dispatchEvent(new Event('popstate'))};const subscribe=fn=>{window.addEventListener('popstate',fn);return()=>window.removeEventListener('popstate',fn)};
          export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname);export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));export const useRouter=()=>({prefetch(){window.routerPrefetches++}});
        ` :
        args.path === "next/link" ? `import React from'react';export const useLinkStatus=()=>({pending:false});export default function Link({prefetch,...props}){return <a {...props}/>}` :
        args.path === "next/image" ? `import React from'react';export default function Image({priority,...props}){return <img {...props}/>}` :
        args.path.endsWith("workspace-language") ? `export function WorkspaceText({text}){return text}export function useWorkspaceTranslation(){return value=>value}` :
        args.path.endsWith("portable-workspace-state") ? `export function usePortableWorkspaceState(){return{scope:window.fixtureScope,offlineEnabled:false}}` :
        args.path === "./load-panel" ? `export function loadPortablePanel(path){const scope=window.fixtureScope;window.panelCalls.push({path,scope});return new Promise((resolve,reject)=>window.pendingPanels.push({path,scope,resolve,reject,settled:false}))}` :
        args.path.endsWith("/actions") ? `export async function logoutPortablePosAction(){throw Error('No logout or financial writes in this fixture')}` :
        args.path.endsWith("use-portable-draft") ? `export function clearPortableLocalDrafts(){throw Error('No draft mutation in this fixture')}` :
        `export function PortableSyncIndicator(){return null}export function DesktopTools(){return null}export function PortableBookingNotifications(){return null}export function PortableFullscreenButton(){return null}export function PosWorkspaceRealtimeRefresh(){return null}`,
      }));
    }}],
  });
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(result.outputFiles[0].text); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}a{display:inline-block;padding:12px}input{min-height:32px}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-proxy-server"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; let documents = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++; });
  const path = { pos: "/pos/portable", book: "/pos/portable/book", checkIn: "/pos/portable/check-in", ticket: "/pos/portable/ticket" };
  const link = name => page.getByRole("link", { name, exact: true });
  const calls = route => page.evaluate(route => window.panelCalls.filter(row => row.path === route).length, route);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}${path.pos}`);
    await page.getByLabel("Entered amount").fill("123.45");
    await page.getByLabel("Entered amount").evaluate(input => { window.originalAmount = input; });
    await link("Book").click();
    await page.locator('[data-pos-tab-placeholder="book"]').waitFor();
    assert.equal(await page.getByLabel("Entered amount").isVisible(), false);
    assert.equal(await page.locator('[data-pos-tab-placeholder="book"]').getByText("Service", { exact: true }).count(), 1);
    assert.ok(!/\$|123\.45|Loading view|saved|cache/i.test(await page.locator('[data-pos-tab-placeholder="book"]').innerText()));
    await page.waitForFunction(() => window.panelCalls.length === 1);
    await link("Check In").click();
    await page.locator('[data-pos-tab-placeholder="checkIn"]').waitFor();
    await page.waitForFunction(() => window.panelCalls.length === 2);
    await link("Book").click();
    await page.locator('[data-pos-tab-placeholder="book"]').waitFor();
    assert.equal(await calls(path.book), 1, "revisiting a pending panel deduplicates its read");
    await link("POS").click();
    assert.equal(await page.getByLabel("Entered amount").inputValue(), "123.45");
    assert.equal(await page.getByLabel("Entered amount").evaluate(input => input === window.originalAmount), true);
    assert.equal(await link("POS").getAttribute("aria-current"), "page");
    await page.goBack();
    await page.locator('[data-pos-tab-placeholder="book"]').waitFor();
    assert.equal(await link("Book").getAttribute("aria-current"), "page", "local history, not stale optimism, selects Back tab");
    await page.goForward();
    await page.getByLabel("Entered amount").waitFor();
    assert.equal(await link("POS").getAttribute("aria-current"), "page");
    await page.evaluate(route => window.finishPanel(route), path.book);
    await page.locator(`[data-loaded-panel="${path.book}"]`).waitFor({ state: "attached" });
    assert.equal(await page.getByLabel("Booking note").isVisible(), false, "resolved hidden panel stays hidden");
    await link("Book").click();
    await page.getByLabel("Booking note").fill("Keep unsent note");
    assert.equal(await calls(path.book), 1, "hidden response is retained instead of loading again");
    await page.getByLabel("Booking note").evaluate(input => { window.originalBooking = input; });
    await link("POS").click();
    await link("Book").click();
    assert.equal(await page.getByLabel("Booking note").inputValue(), "Keep unsent note");
    assert.equal(await page.getByLabel("Booking note").evaluate(input => input === window.originalBooking), true);

    await link("Ticket").click();
    await page.locator('[data-pos-tab-placeholder="ticket"]').waitFor();
    await page.waitForFunction(() => window.panelCalls.length === 3);
    await page.evaluate(route => window.failPanel(route), path.ticket);
    await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
    await page.evaluate(route => window.failPanel(route), path.checkIn);
    await page.waitForTimeout(30);
    assert.equal(await calls(path.ticket), 1, "late hidden failure must not clear/retry the active failure");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.waitForFunction(() => window.panelCalls.filter(row => row.path.endsWith('/ticket')).length === 2);
    await link("POS").click();
    await page.evaluate(route => window.finishPanel(route), path.ticket);
    await link("Ticket").click();
    await page.getByLabel("Staff filter").waitFor();
    assert.equal(await calls(path.ticket), 2);

    await link("Check In").click();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.waitForFunction(() => window.panelCalls.filter(row => row.path.endsWith('/check-in')).length === 2);
    await link("POS").click();
    await page.evaluate(() => window.changeScope("salon-b:key-b"));
    await page.waitForFunction(() => document.querySelector('main')?.dataset.fixtureScope === 'salon-b:key-b');
    await page.evaluate(route => window.finishPanel(route, "salon-a:key-a"), path.checkIn);
    await page.waitForTimeout(30);
    assert.equal(await page.locator('[data-loaded-scope="salon-a:key-a"]').count(), 0, "old-session responses cannot restore private panels");
    await link("Check In").click();
    await page.locator('[data-pos-tab-placeholder="checkIn"]').waitFor();
    await page.waitForFunction(() => window.panelCalls.filter(row => row.path.endsWith('/check-in')).length === 3);
    await link("POS").click();
    await page.evaluate(() => window.changeAllowed(["/pos/portable"]));
    await page.evaluate(route => window.finishPanel(route, "salon-b:key-b"), path.checkIn);
    await page.waitForTimeout(30);
    assert.equal(await page.locator(`[data-loaded-panel="${path.checkIn}"]`).count(), 0, "revoked panel cannot mount from an old response");
    assert.equal(await link("Check In").count(), 0);
    assert.equal(await page.evaluate(() => window.routerPrefetches), 0);
    assert.equal(documents, 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
