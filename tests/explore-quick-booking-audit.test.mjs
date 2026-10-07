import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";

const enabled = Boolean(process.env.ESBUILD_MODULE_PATH && process.env.TEST_BROWSER_PATH);

async function fixture(run, options = {}) {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {QuickBooking} from './components/quick-booking';
      import {InspirationAvailability} from './components/inspiration-availability';
      import {ShowcaseBookIntent} from './app/explore/showcase-book-intent';
      import {ExploreAccountActionsProvider} from './components/explore-account-actions';
      window.contexts=0; window.hintCalls=0; window.intents=[];
      const salon='1650370b-f86d-461e-8d97-6210052eeed7';
      const first='2650370b-f86d-461e-8d97-6210052eeed7';
      const second='3650370b-f86d-461e-8d97-6210052eeed7';
      window.bookHref='/book/'+salon+'?inspiration='+first;
      window.fetch=async(url, options)=>{
        if(String(url).includes('inspiration-times')){
          window.hintCalls++;
          const input=JSON.parse(options.body);
          if(window.holdHints) await new Promise(resolve=>window.releaseHints=resolve);
          return new Response(JSON.stringify(input.contentIds.map(key=>({key,startAt:window.hintStart??'2099-10-02T16:00:00Z',timezoneIana:window.hintTimezone??'America/Chicago'}))));
        }
        window.contexts++;
        if(window.failContext){window.failContext=false; return new Response('{}',{status:503});}
        if(window.holdContext) await new Promise(resolve=>window.releaseContext=resolve);
        return new Response(JSON.stringify({label:new URL(url,location.href).searchParams.get('inspiration'),state:window.bookingState,salon:{name:'King Nails',phone:'+15555550100'}}));
      };
      window.addEventListener('reylumi:quick-book',event=>window.intents.push(event.detail.href));
      function App(){const [href,setHref]=useState(window.bookHref);window.changeHint=()=>setHref('/book/'+salon+'?inspiration='+second);return <ExploreAccountActionsProvider authenticated={true}>
        <a href={window.bookHref}>Book this post</a>
        <a href={window.bookHref} target='_blank'>Open in another tab</a>
        <ShowcaseBookIntent bookingHref={window.bookHref} salonName='King Nails' price='$40'/>
        <InspirationAvailability href={href}/><QuickBooking/>
      </ExploreAccountActionsProvider>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outdir: "fixture", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "wizard", setup(builder) {
      builder.onResolve({ filter: /app\/book\/\[salonId\]\/public-booking-client$/ }, () => ({ path: "wizard", namespace: "stub" }));
      builder.onResolve({filter:/^@\/app\/(explore\/account-actions|saved-post\/actions)$/},()=>({path:'actions',namespace:'stub'}));
      builder.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'stub'}));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ resolveDir: process.cwd(), loader: "tsx", contents: args.path === "actions" ? "export const salonLoveAction=async()=>({active:true});export const referenceLoveAction=salonLoveAction;export const setAccountSavedPostAction=salonLoveAction;" : args.path === "link" ? "import React from 'react';export default function Link(props){return React.createElement('a',props,props.children);}" : args.path === "navigation"
        ? "export const usePathname=()=>'/explore';"
        : `import React,{useEffect} from 'react'; export function PublicBookingClient({data,onClose,onBusyChange}){
          useEffect(()=>{onBusyChange?.(false)},[]);
          window.setBookingBusy=onBusyChange;
          return <div><p>Loaded booking: {data.label}</p><button onClick={onClose}>Close booking</button></div>;
        }` }));
    } }],
  });
  const js = built.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = built.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(js); }
    else response.end(`<html><head><style>${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({ timezoneId: options.timezoneId });
    if (options.time) await page.clock.setFixedTime(new Date(options.time));
    if (options.hintTimezone) await page.addInitScript(({ timezone, start }) => { window.hintTimezone = timezone; window.hintStart = start; }, { timezone: options.hintTimezone, start: options.hintStart });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}${options.explore ? '/explore' : '/'}`);
    await page.getByRole("link", { name: "Book this post", exact: true }).waitFor();
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

test("an unconfigured salon shows contact details after login", { skip: !enabled }, async () => fixture(async page => {
  await page.evaluate(() => { window.bookingState = 'incomplete'; });
  await page.getByRole("link", { name: "Book this post", exact: true }).click();
  const contact = page.getByRole('dialog', { name: 'Contact salon' });
  await contact.waitFor();
  assert.equal(await contact.getByRole('link', { name: /Call/ }).getAttribute('href'), 'tel:+15555550100');
  assert.equal(await page.getByRole('dialog', { name: 'Quick booking' }).count(), 0);
}, { explore: true }));

test("a repeated intent for the open booking keeps the loaded form", { skip: !enabled }, async () => fixture(async page => {
  await page.getByRole("link", { name: "Book this post", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Quick booking" });
  await popup.getByText(/Loaded booking/).waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("reylumi:quick-book", { detail: { href: window.bookHref } })));
  await page.waitForTimeout(100);
  assert.equal(await popup.getByText(/Loaded booking/).count(), 1);
  assert.equal(await page.evaluate(() => window.contexts), 1);
}));

test("booking closes on client navigation and restores scrolling", { skip: !enabled }, async () => fixture(async page => {
  await page.getByRole("button", { name: "Book King Nails · $40", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Quick booking" });
  await popup.getByText(/Loaded booking/).waitFor();
  await page.evaluate(() => document.dispatchEvent(new Event("reylumi:overlay-navigation")));
  await page.waitForTimeout(100);
  assert.equal(await popup.count(), 0);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
}));

test("changing a post cannot expose the previous post's time chip", { skip: !enabled }, async () => fixture(async page => {
  const chip = page.getByRole("button", { name: /▣/ });
  await chip.waitFor();
  await page.evaluate(() => { window.holdHints = true; window.changeHint(); });
  await page.waitForFunction(() => Boolean(window.releaseHints));
  assert.equal(await chip.count(), 0, "old time must disappear while the new post's availability is loading");
  await page.evaluate(() => window.releaseHints());
  await chip.waitFor();
  await chip.click();
  const intent = new URL(await page.evaluate(() => window.intents.at(-1)));
  assert.equal(intent.searchParams.get("inspiration"), "3650370b-f86d-461e-8d97-6210052eeed7");
  assert.equal(intent.searchParams.get("startAt"), "2099-10-02T16:00:00Z");
}));

test("booking load failures allow a clean retry and dismissal", { skip: !enabled }, async () => fixture(async page => {
  await page.evaluate(() => { window.failContext = true; });
  await page.getByRole("button", { name: "Book King Nails · $40", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Quick booking" });
  await popup.getByRole("alert").waitFor();
  await popup.getByRole("button", { name: "Try again" }).click();
  await popup.getByText(/Loaded booking/).waitFor();
  await popup.getByRole("button", { name: "Close booking" }).click();
  await popup.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
}));

test("tomorrow chips follow the salon's calendar across the browser's DST change", { skip: !enabled }, async () => fixture(async page => {
  await page.getByRole("button", { name: /▣/ }).waitFor();
  assert.match(await page.getByRole("button", { name: /▣/ }).innerText(), /Tomorrow/);
}, { timezoneId: "America/New_York", time: "2026-11-01T05:30:00Z", hintTimezone: "America/Guatemala", hintStart: "2026-11-01T16:00:00Z" }));
