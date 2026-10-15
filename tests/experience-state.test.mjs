import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";

function fixture() {
  const records = new Map(), exports = {};
  let now = 100_000;
  const storage = {
    get length() { return records.size; },
    key(index) { return [...records.keys()][index] ?? null; },
    getItem(key) { return records.get(key) ?? null; },
    setItem(key, value) { records.set(key, value); },
    removeItem(key) { records.delete(key); },
  };
  const window = { sessionStorage: storage };
  const source = ts.transpileModule(readFileSync("lib/experience-state.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, window, Date: { now: () => now } });
  return { api: exports, records, storage, window, tick: duration => { now += duration; } };
}
const context = { namespace: "market", scope: "user-a:salon-a", key: "browse" };
const valid = value => Boolean(value && typeof value.query === "string");

test("UI state is isolated by account, salon, route and namespace, then expires", () => {
  const { api, tick } = fixture();
  assert.equal(api.writeExperienceState(context, { query: "Payroll" }, { ttlMs: 1000 }), true);
  assert.equal(api.readExperienceState(context, valid).query, "Payroll");
  for (const patch of [{ scope: "user-b:salon-a" }, { scope: "user-a:salon-b" }, { key: "another-page" }, { namespace: "salon-profile" }]) {
    assert.equal(api.readExperienceState({ ...context, ...patch }, valid), null);
  }
  tick(1000);
  assert.equal(api.readExperienceState(context, valid), null);
});

test("Activity keeps early input across hidden reveals while true mounts and context changes seed fresh state", { timeout: 60_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';
    import{useRememberedExperience}from'./lib/use-remembered-experience';
    import{readExperienceState,writeExperienceState,clearExperienceState}from'./lib/experience-state';
    history.scrollRestoration='manual';window.seeds=[];window.frameId=0;window.heldFrames=new Map();
    window.delayedExperienceFrame=callback=>{const id=++window.frameId;window.heldFrames.set(id,callback);return id};
    window.cancelDelayedExperienceFrame=id=>window.heldFrames.delete(id);
    window.releaseExperienceFrames=()=>{const callbacks=[...window.heldFrames.values()];window.heldFrames.clear();callbacks.forEach(callback=>callback(performance.now()))};
    window.writeSnapshot=(scope,key,query,scrollY=0)=>writeExperienceState({namespace:'activity',scope,key},{value:{query},scrollY});
    window.readSnapshot=(scope,key)=>readExperienceState({namespace:'activity',scope,key},value=>Boolean(value&&value.value&&typeof value.value.query==='string'));
    window.clearExperience=()=>clearExperienceState();
    function Browse({scope,routeKey}){
      const[query,setQuery]=useState('');window.setQuery=setQuery;
      useRememberedExperience({namespace:'activity',scope,key:routeKey},{value:{query},validate:value=>Boolean(value&&typeof value.query==='string'),
        onRestore:value=>{window.seeds.push({scope,key:routeKey,kind:'restore',query:value.query});setQuery(value.query)},
        onEmpty:()=>{window.seeds.push({scope,key:routeKey,kind:'empty'});setQuery('')}});
      return <main><input aria-label="Early search" value={query} onChange={event=>setQuery(event.target.value)}/><output>{query}</output><div style={{height:3000}}>Retained current data</div></main>;
    }
    function App(){const[visible,setVisible]=useState(true),[scope,setScope]=useState('user-a'),[routeKey,setRouteKey]=useState('browse'),[generation,setGeneration]=useState(0);
      window.setVisible=setVisible;window.changeScope=setScope;window.changeKey=setRouteKey;
      window.remount=()=>{setGeneration(value=>value+1);setVisible(true)};
      return <><p id="visibility">{visible?'visible':'hidden'}</p><Activity key={generation} mode={visible?'visible':'hidden'}><Browse scope={scope} routeKey={routeKey}/></Activity></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: "bundle.js", bundle: true, write: false, jsx: "automatic", format: "iife", plugins: [{ name: "delay-only-experience-restoration-frames", setup(builder) {
    builder.onLoad({ filter: /[\\/]lib[\\/]use-remembered-experience\.ts$/ }, ({ path }) => ({
      contents: readFileSync(path, "utf8").replaceAll("window.requestAnimationFrame(", "window.delayedExperienceFrame(").replaceAll("window.cancelAnimationFrame(", "window.cancelDelayedExperienceFrame("),
      loader: "ts",
    }));
  } }] });
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/bundle.js" ? "application/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? result.outputFiles[0].text : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ['--no-proxy-server'], executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.heldFrames.size === 1 && window.seeds.length === 1);
    await page.getByLabel("Early search").fill("early input");
    await page.evaluate(() => { scrollTo(0, 680); dispatchEvent(new Event('scroll')); window.setVisible(false); });
    await page.waitForFunction(() => document.querySelector('#visibility').textContent === 'hidden');
    assert.equal(await page.evaluate(() => window.heldFrames.size), 0, 'hiding cancels only the pending restoration frames');
    assert.deepEqual(await page.evaluate(() => window.readSnapshot('user-a','browse')), { value: { query: 'early input' }, scrollY: 680 }, 'early edits flush even before the two restore frames make persistence ready');
    await page.evaluate(() => { window.writeSnapshot('user-a','browse','stale stored query',680); scrollTo(0,0); window.setVisible(true); });
    await page.getByLabel("Early search").waitFor();
    await page.waitForFunction(() => window.heldFrames.size === 1);
    assert.equal(await page.getByLabel("Early search").inputValue(), 'early input', 'a stale snapshot cannot overwrite retained React input');
    assert.equal(await page.evaluate(() => window.seeds.length), 1);
    await page.evaluate(() => { window.releaseExperienceFrames(); window.releaseExperienceFrames(); });
    await page.waitForFunction(() => scrollY === 680);
    await page.evaluate(() => window.setVisible(false));
    await page.waitForFunction(() => document.querySelector('#visibility').textContent === 'hidden');
    await page.evaluate(() => { window.clearExperience(); scrollTo(0,0); window.setVisible(true); });
    await page.waitForFunction(() => window.heldFrames.size === 1);
    assert.equal(await page.getByLabel("Early search").inputValue(), 'early input', 'missing storage cannot call onEmpty again during an Activity reveal');
    assert.equal(await page.evaluate(() => window.seeds.length), 1);
    await page.evaluate(() => { window.releaseExperienceFrames(); window.releaseExperienceFrames(); window.setQuery('latest account-a query'); });
    await page.waitForFunction(() => document.querySelector('output').textContent === 'latest account-a query');
    await page.evaluate(() => {
      history.replaceState(history.state,'','?sort=closest');
      scrollTo(0,920);dispatchEvent(new Event('scroll'));
      window.setQuery('query URL committed');
    });
    await page.waitForFunction(() => document.querySelector('output').textContent === 'query URL committed');
    await page.waitForFunction(() => window.readSnapshot('user-a','browse')?.scrollY === 920);
    assert.equal(await page.evaluate(() => window.readSnapshot('user-a','browse').value.query), 'query URL committed', 'a same-context URL commit adopts the actual scroll even if its pre-commit scroll event was ignored');
    await page.evaluate(() => { location.hash='gallery';scrollTo(0,950);dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => window.readSnapshot('user-a','browse')?.scrollY === 950);
    await page.evaluate(() => { history.replaceState(history.state,'',location.pathname+location.search);window.setQuery('latest account-a query'); });
    await page.waitForFunction(() => document.querySelector('output').textContent === 'latest account-a query');
    await page.evaluate(() => window.changeScope('user-b'));
    await page.waitForFunction(() => document.querySelector('input').value === '' && window.seeds.some(seed=>seed.scope==='user-b'&&seed.kind==='empty'));
    assert.equal(await page.evaluate(() => window.readSnapshot('user-a','browse').value.query), 'latest account-a query', 'old scope cleanup uses its last committed options rather than the new account options');
    await page.getByLabel("Early search").fill('account-b query');
    await page.evaluate(() => window.changeKey('other-page'));
    await page.waitForFunction(() => document.querySelector('input').value === '' && window.seeds.some(seed=>seed.key==='other-page'&&seed.kind==='empty'));
    assert.equal(await page.evaluate(() => window.readSnapshot('user-b','browse').value.query), 'account-b query');
    await page.getByLabel("Early search").fill('retained other page');
    await page.evaluate(() => window.setVisible(false));
    await page.waitForFunction(() => document.querySelector('#visibility').textContent === 'hidden');
    await page.evaluate(() => { window.writeSnapshot('user-b','other-page','true remount query'); window.remount(); });
    await page.waitForFunction(() => document.querySelector('input')?.value === 'true remount query');
    assert.equal(await page.evaluate(() => window.seeds.filter(seed=>seed.scope==='user-b'&&seed.key==='other-page'&&seed.kind==='restore').length), 1, 'a true React remount reads the current stored state');
    await page.evaluate(() => { window.clearExperience(); dispatchEvent(new Event('reylumi:experience-reset')); });
    await page.getByLabel("Early search").fill('after logout');
    await page.evaluate(() => window.setVisible(false));
    await page.waitForFunction(() => document.querySelector('#visibility').textContent === 'hidden');
    await page.evaluate(() => window.setVisible(true));
    await page.getByLabel("Early search").waitFor();
    await page.evaluate(() => { window.releaseExperienceFrames(); window.releaseExperienceFrames(); });
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key=>key.startsWith('reylumi:experience:v1:')).length), 0, 'reset remains revoked when the same context is shown again');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

test("schema, context and corrupt or impossible timestamps never restore", () => {
  for (const patch of [{ version: 0 }, { savedAt: 100_001 }, { expiresAt: 99_999 }, { expiresAt: 100_000 + 3 * 60 * 60 * 1000 }, { context: { ...context, scope: "user-b" } }, { value: { query: 123 } }]) {
    const { api, records } = fixture();
    api.writeExperienceState(context, { query: "valid" });
    const [key, raw] = [...records][0];
    records.set(key, JSON.stringify({ ...JSON.parse(raw), ...patch }));
    assert.equal(api.readExperienceState(context, valid), null);
    assert.equal(records.size, 0);
  }
  const { api, records } = fixture();
  api.writeExperienceState(context, { query: "valid" });
  records.set([...records.keys()][0], "{incomplete");
  assert.equal(api.readExperienceState(context, valid), null);
});

test("invalid TTL, context, oversized and unserializable state is rejected", () => {
  const { api, records } = fixture();
  for (const ttlMs of [-1, 0, NaN, Infinity, api.EXPERIENCE_STATE_MAX_TTL_MS + 1]) {
    assert.equal(api.writeExperienceState(context, { query: "test" }, { ttlMs }), false);
  }
  for (const patch of [{ key: "" }, { scope: "" }, { namespace: "x".repeat(257) }]) {
    assert.equal(api.writeExperienceState({ ...context, ...patch }, { query: "test" }), false);
  }
  assert.equal(api.writeExperienceState(context, { query: "x".repeat(api.EXPERIENCE_STATE_MAX_ENTRY_BYTES) }), false);
  assert.equal(api.writeExperienceState(context, undefined), false);
  const cycle = {}; cycle.self = cycle;
  assert.equal(api.writeExperienceState(context, cycle), false);
  assert.equal(records.size, 0);
});

test("entry and byte budgets evict oldest state while preserving unrelated session data", () => {
  const { api, records, tick } = fixture();
  records.set("other-feature", "untouched");
  for (let index = 0; index < api.EXPERIENCE_STATE_MAX_ENTRIES + 4; index += 1) {
    assert.equal(api.writeExperienceState({ ...context, key: `page-${index}` }, { query: "small" }), true);
    tick(1);
  }
  assert.equal(records.size, api.EXPERIENCE_STATE_MAX_ENTRIES + 1);
  assert.equal(api.readExperienceState({ ...context, key: "page-0" }, valid), null);
  assert.equal(api.readExperienceState({ ...context, key: "page-43" }, valid).query, "small");
  for (let index = 0; index < 20; index += 1) {
    api.writeExperienceState({ ...context, key: `large-${index}` }, { query: "x".repeat(6000) });
    tick(1);
  }
  const owned = [...records].filter(([key]) => key.startsWith(api.EXPERIENCE_STATE_PREFIX));
  assert.ok(owned.reduce((bytes, [key, raw]) => bytes + (key.length + raw.length) * 2, 0) <= api.EXPERIENCE_STATE_MAX_BYTES);
  assert.equal(records.get("other-feature"), "untouched");
});

test("explicit namespace and account cleanup removes only intended experience state", () => {
  const { api, records } = fixture();
  const other = { namespace: "profile", scope: "user-b", key: "page" };
  api.writeExperienceState(context, { query: "mine" });
  api.writeExperienceState(other, { query: "theirs" });
  api.writeExperienceState({ ...context, namespace: "profile" }, { query: "mine too" });
  records.set("unrelated", "keep");
  api.clearExperienceState({ namespace: "market", scope: context.scope });
  assert.equal(api.readExperienceState(context, valid), null);
  assert.equal(api.readExperienceState({ ...context, namespace: "profile" }, valid).query, "mine too");
  api.clearExperienceState({ scope: context.scope });
  assert.equal(api.readExperienceState(other, valid).query, "theirs");
  api.clearExperienceState();
  assert.deepEqual([...records], [["unrelated", "keep"]]);
});

test("unavailable storage, revoked access and quota errors leave browsing usable", () => {
  for (const failure of ["getter", "read", "write"]) {
    const { api, storage, window } = fixture();
    if (failure === "getter") Object.defineProperty(window, "sessionStorage", { get() { throw new Error("disabled"); } });
    else storage[failure === "read" ? "getItem" : "setItem"] = () => { throw new Error("quota or denied"); };
    assert.doesNotThrow(() => api.clearExperienceState());
    assert.equal(api.readExperienceState(context, valid), null);
    assert.equal(api.writeExperienceState(context, { query: "test" }), failure === "read");
  }
});

test("back restores browsing choices and scroll; hashes, fresh visits, accounts and reset stay authoritative", { timeout: 60_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{useRememberedExperience}from'./lib/use-remembered-experience';
    import{clearExperienceState}from'./lib/experience-state';
    history.scrollRestoration='manual';
    function Browse({scope}){
      const[query,setQuery]=useState(''),[tab,setTab]=useState('discover');
      useRememberedExperience({namespace:'runtime',scope,key:'browse'},{value:{query,tab},
        validate:value=>Boolean(value&&typeof value.query==='string'&&['discover','gallery'].includes(value.tab)),
        onRestore:value=>{setQuery(value.query);setTab(value.tab)},onEmpty:()=>{setQuery('');setTab('discover')}});
      return <><input aria-label="Search" value={query} onChange={event=>setQuery(event.target.value)}/>
        <button onClick={()=>setTab('gallery')}>Gallery</button><output>{tab}</output><div style={{height:3000}}>Current server data</div></>;
    }
    function App(){const[path,setPath]=useState(location.pathname),[scope,setScope]=useState('user-a');
      useEffect(()=>{const changed=()=>setPath(location.pathname);addEventListener('popstate',changed);return()=>removeEventListener('popstate',changed)},[]);
      window.changeAccount=setScope;window.resetExperience=()=>{clearExperienceState();dispatchEvent(new Event('reylumi:experience-reset'))};
      // A destination may reset scroll before the outgoing React effects clean up.
      window.navigate=(url)=>{history.pushState({},'',url);setPath(location.pathname);scrollTo(0,0);dispatchEvent(new Event('scroll'))};
      return path==='/detail'?<p>Detail</p>:<Browse scope={scope}/>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: "bundle.js", bundle: true, write: false, jsx: "automatic", format: "iife" });
  const js = result.outputFiles[0].text;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/bundle.js" ? "application/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? js : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ['--no-proxy-server'], executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/browse`);
    await page.getByLabel("Search").fill("nails");
    await page.getByRole("button", { name: "Gallery", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("output").textContent === "gallery");
    await page.evaluate(() => scrollTo(0, 1000));
    await page.waitForFunction(() => Object.values(sessionStorage).some(raw => raw.includes('"scrollY":1000')));
    await page.evaluate(() => {
      scrollTo(0, 1100);
      dispatchEvent(new Event("scroll"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.ok(await page.evaluate(() => Object.values(sessionStorage).some(raw => raw.includes('"scrollY":1100'))));
    await page.evaluate(() => {
      delete document.visibilityState;
      scrollTo(0, 1000);
      dispatchEvent(new Event("scroll"));
    });
    await page.waitForFunction(() => Object.values(sessionStorage).some(raw => raw.includes('"scrollY":1000')));
    await page.evaluate(() => window.navigate("/detail"));
    await page.getByText("Detail", { exact: true }).waitFor();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector("input")?.value === "nails" && scrollY === 1000);
    assert.equal(await page.locator("output").textContent(), "gallery");
    await page.reload();
    await page.waitForFunction(() => document.querySelector("input")?.value === "nails"
      && Object.values(sessionStorage).some(raw => raw.includes('"scrollY":0')));
    assert.equal(await page.evaluate(() => performance.getEntriesByType("navigation")[0].type), "reload");
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.evaluate(() => scrollTo(0, 1250));
    await page.waitForFunction(() => Object.values(sessionStorage).some(raw => raw.includes('"scrollY":1250')));
    await page.evaluate(() => window.navigate("/detail"));
    await page.getByText("Detail", { exact: true }).waitFor();
    await page.goBack();
    await page.waitForFunction(() => document.querySelector("input")?.value === "nails" && scrollY === 1250);
    await page.evaluate(() => window.navigate("/detail"));
    await page.getByText("Detail", { exact: true }).waitFor();
    await page.evaluate(() => window.navigate("/browse"));
    await page.waitForFunction(() => document.querySelector("input")?.value === "nails");
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.evaluate(() => window.changeAccount("user-b"));
    await page.waitForFunction(() => document.querySelector("input").value === "" && document.querySelector("output").textContent === "discover");
    await page.evaluate(() => window.changeAccount("user-a"));
    await page.waitForFunction(() => document.querySelector("input").value === "nails");
    await page.evaluate(() => window.resetExperience());
    await page.getByLabel("Search").fill("should not be saved");
    assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("reylumi:experience:v1:")).length), 0);
    await page.evaluate(() => window.navigate("/detail"));
    await page.getByText("Detail", { exact: true }).waitFor();
    await page.evaluate(() => {
      const key='reylumi:experience:v1:'+encodeURIComponent(JSON.stringify(['runtime','user-a','browse']));
      sessionStorage.setItem(key,JSON.stringify({version:1,context:{namespace:'runtime',scope:'user-a',key:'browse'},savedAt:Date.now(),expiresAt:Date.now()+30000,value:{value:{query:'old search',tab:'gallery'},scrollY:1000}}));
      window.navigate('/browse#explicit-section');
    });
    await page.getByLabel("Search").waitFor();
    await page.waitForFunction(() => Object.values(sessionStorage).some(raw => raw.includes('"query":""')));
    assert.equal(await page.getByLabel("Search").inputValue(), "");
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
