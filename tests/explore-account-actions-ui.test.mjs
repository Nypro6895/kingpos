import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

let bundle;
async function fixture(options = {}) {
  bundle ??= build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {ExploreAccountActionsProvider,ExploreReferenceLove,ExploreSalonLove} from './components/explore-account-actions';
      window.calls=[];window.reads=[];window.writes=[];window.mode='ok';window.events=[];
      window.resolveReads=active=>window.reads.splice(0).forEach(request=>request.resolve({active,error:null}));
      window.rejectReads=()=>window.reads.splice(0).forEach(request=>request.reject(new TypeError('offline')));
      window.resolveWrites=()=>window.writes.splice(0).forEach(request=>request.resolve({active:request.active,error:null}));
      for(const event of ['reylumi:reference-favorite','reylumi:salon-favorite','reylumi:saved-post-state-change'])window.addEventListener(event,e=>window.events.push({event,...e.detail}));
      function App(){
        const query=new URLSearchParams(location.search),kind=query.get('kind')||'reference';
        const [auth,setAuth]=useState(query.get('guest')!=='true'),[item,setItem]=useState('first');
        window.authenticate=()=>setAuth(true);window.logout=()=>setAuth(false);window.changeItem=()=>setItem('second');
        const id=item==='first'?'11111111-1111-4111-8111-111111111111':'22222222-2222-4222-8222-222222222222';
        return <ExploreAccountActionsProvider authenticated={auth}>{[1,2].map(copy=><section aria-label={'Card '+copy} key={copy}>
          {kind==='reference'?<ExploreReferenceLove itemKey={'look:nail-'+item} name={'Look '+copy} initialActive={query.has('initial')?query.get('initial')==='true':undefined}/>:<ExploreSalonLove salonId={id} name={'Salon '+copy}/>}
        </section>)}</ExploreAccountActionsProvider>;
      }createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, jsx: "automatic", plugins: [{ name: "fixture", setup(builder) {
      const mocks = {
        "next/navigation": "export const usePathname=()=>'/explore'",
        "@/components/workspace-language": "export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text",
        "@/components/auth-intent-prompt": "export function AuthIntentPrompt({title,children,onClose}){return <section role='dialog' aria-label={title}>{children}<button onClick={onClose}>Close prompt</button></section>}",
        "@/components/reylumi-icons": "export const ReylumiIcon=()=>null",
        "@/lib/quick-booking-client": "export const openQuickBooking=()=>{}",
        "@/app/explore/account-actions": `
          function favorite(kind,key,active){
            window.calls.push({kind,key,active});
            if(active===undefined)return new Promise((resolve,reject)=>window.reads.push({resolve,reject}));
            if(window.mode==='reject')return Promise.reject(new TypeError('offline'));
            if(window.mode==='deny')return Promise.resolve({active:false,error:'Could not save this favorite.'});
            if(window.mode==='defer')return new Promise(resolve=>window.writes.push({resolve,active}));
            return Promise.resolve({active,error:null});
          }
          export const referenceLoveAction=(key,active)=>favorite('reference',key,active);
          export const salonLoveAction=(key,active)=>favorite('salon',key,active);
        `,
        "@/app/saved-post/actions": `export async function setAccountSavedPostAction(target,active){window.calls.push({kind:'save',target,active});if(window.mode==='reject')throw new TypeError('offline');return {active,error:window.mode==='deny'?'Could not save post.':null,saveCount:4}}`,
      };
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
    } }] });
  const result = await bundle;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://favorite.test/**", route => route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${result.outputFiles[0].text}</script>` }));
  await page.goto(`https://favorite.test/?${new URLSearchParams(options)}`);
  const heart = copy => page.getByRole("region", { name: `Card ${copy}` }).getByRole("button", { name: /^Love / });
  await heart(1).waitFor();
  return { page, heart, errors, close: () => browser.close() };
}

test("both Explore hearts synchronize duplicates and ignore reads that finish after a save", async () => {
  for (const kind of ["reference", "salon"]) {
    const ui = await fixture({ kind });
    try {
      await ui.page.waitForFunction(() => window.reads.length === 2);
      await ui.heart(1).click();
      await ui.heart(2).getAttribute("aria-pressed").then(value => assert.equal(value, "true"));
      await ui.page.evaluate(() => window.resolveReads(false));
      assert.equal(await ui.heart(1).getAttribute("aria-pressed"), "true");
      assert.equal(await ui.heart(2).getAttribute("aria-pressed"), "true");
      await ui.heart(2).click();
      assert.equal(await ui.heart(1).getAttribute("aria-pressed"), "false");
      assert.deepEqual(await ui.page.evaluate(() => window.calls.filter(call => call.active !== undefined).map(call => call.active)), [true, false]);
      assert.deepEqual(ui.errors, []);
    } finally { await ui.close(); }
  }
});

test("failed reads and writes show feedback, release the click lock, and never change another heart", async () => {
  for (const kind of ["reference", "salon"]) {
    const ui = await fixture({ kind });
    try {
      await ui.page.waitForFunction(() => window.reads.length === 2);
      await ui.page.evaluate(() => { window.rejectReads(); window.mode = "reject"; });
      await ui.page.getByRole("alert").first().waitFor();
      assert.match(await ui.page.getByRole("alert").first().innerText(), /could not be loaded/);
      await ui.heart(1).click();
      await ui.page.getByRole("alert").first().filter({ hasText: "Connection interrupted" }).waitFor();
      assert.equal(await ui.heart(1).isEnabled(), true);
      assert.equal(await ui.heart(2).getAttribute("aria-pressed"), "false");
      assert.equal(await ui.page.evaluate(() => window.events.length), 0);
      await ui.page.evaluate(() => { window.mode = "defer"; });
      await ui.heart(1).evaluate(button => { button.click(); button.click(); button.click(); });
      assert.equal(await ui.page.evaluate(() => window.writes.length), 1);
      await ui.page.evaluate(() => window.resolveWrites());
      assert.equal(await ui.heart(2).getAttribute("aria-pressed"), "true");
      assert.equal(await ui.page.getByRole("alert").count(), 0);
      await ui.page.evaluate(() => { window.mode = "deny"; });
      await ui.heart(1).click();
      await ui.page.getByRole("alert").waitFor();
      assert.equal(await ui.heart(1).getAttribute("aria-pressed"), "true");
      assert.equal(await ui.heart(2).getAttribute("aria-pressed"), "true");
      assert.deepEqual(ui.errors, []);
    } finally { await ui.close(); }
  }
});

test("guest love resumes once after login, synchronizes hearts and clears them on logout", async () => {
  for (const kind of ["reference", "salon"]) {
    const ui = await fixture({ kind, guest: "true" });
    try {
      await ui.heart(1).click();
      await ui.page.getByRole("dialog").waitFor();
      assert.equal(await ui.page.evaluate(() => window.calls.length), 0);
      await ui.page.evaluate(() => window.authenticate());
      await ui.page.waitForFunction(() => window.calls.some(call => call.active === true));
      assert.equal(await ui.heart(1).getAttribute("aria-pressed"), "true");
      assert.equal(await ui.heart(2).getAttribute("aria-pressed"), "true");
      await ui.page.evaluate(() => window.resolveReads(false));
      assert.equal(await ui.heart(2).getAttribute("aria-pressed"), "true");
      assert.equal(await ui.page.evaluate(() => window.calls.filter(call => call.active !== undefined).length), 1);
      assert.equal(await ui.page.evaluate(() => sessionStorage.getItem("reylumi-explore-account-intent")), null);
      await ui.page.evaluate(() => window.logout());
      assert.equal(await ui.heart(1).getAttribute("aria-pressed"), "false");
      assert.equal(await ui.heart(2).getAttribute("aria-pressed"), "false");
      assert.deepEqual(ui.errors, []);
    } finally { await ui.close(); }
  }
});

test("resumed failures are visible and rejected post saves do not broadcast false state", async () => {
  for (const kind of ["reference", "salon", "save"]) {
    const ui = await fixture({ guest: "true" });
    try {
      await ui.page.evaluate(kind => {
        const intent = kind === "reference" ? { kind, itemKey: "look:nail-first" } : kind === "salon" ? { kind, salonId: "11111111-1111-4111-8111-111111111111" } : { kind, target: { sourceType: "beauty_post", sourceId: "11111111-1111-4111-8111-111111111111" } };
        sessionStorage.setItem("reylumi-explore-account-intent", JSON.stringify({ ...intent, at: Date.now() }));
        window.mode = kind === "save" ? "deny" : "reject"; window.authenticate();
      }, kind);
      await ui.page.getByRole("status").waitFor();
      assert.match(await ui.page.getByRole("status").innerText(), kind === "save" ? /Could not save post/ : /Connection interrupted/);
      assert.equal(await ui.page.evaluate(() => window.events.length), 0);
      assert.equal(await ui.heart(1).getAttribute("aria-pressed"), "false");
      assert.deepEqual(ui.errors, []);
    } finally { await ui.close(); }
  }
});

test("a late response for the previous item cannot alter a new heart", async () => {
  for (const kind of ["reference", "salon"]) {
    const ui = await fixture({ kind });
    try {
      await ui.page.evaluate(() => { window.mode = "defer"; });
      await ui.heart(1).click();
      await ui.page.evaluate(() => window.changeItem());
      await ui.page.waitForFunction(() => window.calls.some(call => call.key.includes("second") || call.key.startsWith("2222")));
      await ui.page.evaluate(() => { window.resolveWrites(); window.resolveReads(false); });
      assert.equal(await ui.heart(1).getAttribute("aria-pressed"), "false");
      assert.equal(await ui.heart(2).getAttribute("aria-pressed"), "false");
      assert.equal(await ui.heart(1).isEnabled(), true);
      assert.deepEqual(ui.errors, []);
    } finally { await ui.close(); }
  }
});
