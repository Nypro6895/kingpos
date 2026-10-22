import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import ts from "typescript";
import { chromium } from "playwright-core";

// Actual registry, native host/request fencing, Services pilot/controller and
// IndexedDB. Only unrelated page content and the existing manager branch are
// markers. The native transport is a synthetic, read-only in-browser fixture.
const scope = `v3:${"a".repeat(64)}`;
const partition = { viewerId: "fixture-viewer", accountId: "fixture-account", salonId: "fixture-salon", scope, permissionRevision: "fixture-services.view" };
const setup = `
window.fixture={calls:[],pending:[],opened:[],resourceBranches:[],commands:0,behavior:{},visit:0};
window.__reylumiAppLocalContext={generation:'native-registry-fixture-generation',scopeEpoch:1,nonce:'fixture-nonce'};
window.__reylumiAppLocalTransport={request(request){
 const f=window.fixture;f.calls.push(request);
 if(request.kind==='cache'&&request.name==='cancel')return Promise.resolve(null);
 if(request.kind==='online'){f.opened.push(request.args.path);return Promise.resolve();}
 if(request.kind==='command'){f.commands++;return Promise.reject(Error('No writes allowed in fixture'));}
 if(request.kind!=='read')return Promise.reject(Error('Unexpected native request '+request.kind));
 const admission=request.name==='page.services-catalog-admission';
 if(!admission&&request.name!=='page.services-catalog')return Promise.reject(Error('Unexpected resource '+request.name));
 const b={...f.behavior};
 return new Promise((resolve,reject)=>{
  const release=()=>{
   const status=admission?b.admissionError:b.freshError;
   if(status)return reject(Object.assign(Error('Synthetic native failure'),{status}));
   const data=admission?{schemaVersion:1,partition:${JSON.stringify(partition)}}:{services:[{id:'fixture-service',name:b.label||'Synthetic services',category:'Nails',description:'Local fixture only',basePrice:25,durationMinutes:30}]};
   resolve({schemaVersion:1,status:200,scope:request.args.scope,etag:'fixture',updatedAt:Date.now(),data,offline:false,...(admission?b.admissionEnvelope:b.freshEnvelope)});
  };
  if(admission?b.holdAdmission:b.holdFresh)f.pending.push({name:request.name,release});else release();
 });
}};
window.fixtureRelease=name=>{const i=window.fixture.pending.findIndex(x=>x.name===name);if(i<0)throw Error('Missing pending '+name);window.fixture.pending.splice(i,1)[0].release();};
`;
const harness = `
import React,{useState}from'react';
import{createRoot}from'react-dom/client';
import{getAppLocalPage}from'./lib/app-local-page-registry';
import{getAppLocalHost}from'./lib/app-local-host';
import{SERVICES_CATALOG_DATABASE,SERVICES_CATALOG_STORE}from'./lib/services-catalog-cache';
window.fixture.database=SERVICES_CATALOG_DATABASE;window.fixture.store=SERVICES_CATALOG_STORE;
function Harness(){
 const [config,setConfig]=useState(null);window.fixtureMount=value=>{window.fixture.visit++;setConfig(value?{...value,visit:window.fixture.visit}:null);};
 if(!config)return <p>Outside Services</p>;
 const path=config.path||'/services',Component=getAppLocalPage(path).Component;
 const context={schemaVersion:1,context:{authenticated:config.authenticated!==false,viewerId:'fixture-viewer',workspaceId:'fixture-workspace',salonId:'fixture-salon',permissionRevision:'fixture-services.view',scope:${JSON.stringify(scope)}},grant:null,display:{name:'Fixture',language:'en',role:'owner'},onlineValidatedAt:Date.now()};
 const host=config.native===false?{...getAppLocalHost(),isNative:false}:getAppLocalHost();
 return <Component key={config.visit} path={path} context={context} host={host} navigate={()=>{throw Error('Unexpected local navigation');}}/>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
`;

async function compile(enabled) {
  const text = await readFile("lib/app-local-page-registry.tsx", "utf8");
  const parsed = ts.createSourceFile("registry.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keep = new Set(["react", "./app-local-host", "@/app/services/services-catalog-native-page", "./services-catalog-native-flag", "./services-catalog-native-runtime"]);
  const mocked = new Map();
  for (const node of parsed.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly || keep.has(node.moduleSpecifier.text)) continue;
    const names = node.importClause?.namedBindings?.elements?.filter(value => !value.isTypeOnly).map(value => value.propertyName?.text ?? value.name.text) ?? [];
    if (names.length) mocked.set(node.moduleSpecifier.text, names);
  }
  const replacements = {
    "@/app/services/services-manager": `export function ServicesManager(){return <p data-manager-branch>Original ServicesManager branch</p>;}`,
    "./app-local-resource": `export function useAppLocalResource(scope,name){window.fixture.resourceBranches.push({scope,name});return{data:{},refresh:async()=>{}};}`,
  };
  return build({ stdin: { contents: harness, sourcefile: "catalog-native-registry-fixture.tsx", resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', __REYLUMI_SERVICES_CATALOG_QA__: String(enabled) }, logLevel: "silent", plugins: [{ name: "registry-non-pilot-content", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (!/[\\/]lib[\\/]app-local-page-registry\.tsx$/.test(args.importer) || !mocked.has(args.path)) return;
      return { path: args.path, namespace: "registry-content-fixture" };
    });
    builder.onLoad({ filter: /.*/, namespace: "registry-content-fixture" }, ({ path }) => ({ contents: replacements[path] ?? mocked.get(path).map(name => `export const ${name}=()=>null;`).join("\n"), loader: "tsx", resolveDir: process.cwd() }));
  } }] });
}

test("Services registry native opt-in and native read contract", { timeout: 120_000 }, async t => {
  const [on, off] = await Promise.all([compile(true), compile(false)]);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (pathname === "/on.js" || pathname === "/off.js") { response.setHeader("Content-Type", "text/javascript"); response.end((pathname === "/on.js" ? on : off).outputFiles[0].contents); return; }
    response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><html><body><div id="root"></div><script>${setup}</script><script src="/${pathname === "/off" ? "off" : "on"}.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.SERVICES_CATALOG_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
  const context = await browser.newContext(), errors = [], external = [];
  await context.route("**/*", route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  t.after(async () => { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const load = async flag => { await page.goto(`${origin}/${flag ? "on" : "off"}`); await page.waitForFunction(() => typeof window.fixtureMount === "function"); };
  const mount = async (behavior = {}, config = {}) => { await page.evaluate(({ behavior, config }) => { window.fixture.behavior = behavior; window.fixtureMount(config); }, { behavior, config }); };
  const pending = async name => page.waitForFunction(name => window.fixture.pending.some(value => value.name === name), name);
  const release = async name => { await pending(name); await page.evaluate(name => window.fixtureRelease(name), name); };
  const row = label => page.getByRole("heading", { name: label, exact: true });
  const absent = async label => assert.equal(await row(label).count(), 0);
  const reads = () => page.evaluate(() => window.fixture.calls.filter(value => value.kind === "read"));
  const persisted = async () => page.waitForFunction(() => new Promise(resolve => {
    const request = indexedDB.open(window.fixture.database, 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => { const db = request.result; if (!db.objectStoreNames.contains(window.fixture.store)) { db.close(); resolve(false); return; } const tx = db.transaction(window.fixture.store), get = tx.objectStore(window.fixture.store).getAll(); get.onsuccess = () => { resolve(get.result.some(value => value.id.startsWith("catalog:"))); db.close(); }; get.onerror = () => { db.close(); resolve(false); }; };
  }));
  const admission = "page.services-catalog-admission", fresh = "page.services-catalog";

  await t.test("ordinary bundle retains the original manager branch and makes no pilot reads", async () => {
    await load(false); await mount(); await page.locator("[data-manager-branch]").waitFor(); assert.deepEqual(await reads(), []);
    assert.equal(await page.evaluate(() => window.fixture.resourceBranches.at(-1).name), "page.services");
  });
  await t.test("QA on a web host and live=1 both retain the original manager branch", async () => {
    await load(true); await mount({}, { native: false }); await page.locator("[data-manager-branch]").waitFor(); assert.deepEqual(await reads(), []);
    await mount({}, { path: "/services?live=1" }); await page.locator("[data-manager-branch]").waitFor(); assert.deepEqual(await reads(), []);
  });
  await t.test("unauthenticated registry entry never reads the catalog", async () => {
    await mount({}, { authenticated: false }); await page.getByText("Sign in to view your account.").waitFor(); assert.deepEqual(await reads(), []);
  });
  await t.test("QA native uses real host.read envelopes and waits for exact admission before fresh read", async () => {
    await mount({ holdAdmission: true, holdFresh: true, label: "Native first" }); await pending(admission);
    assert.deepEqual((await reads()).map(value => value.name), [admission]); assert.equal(await page.locator("li").count(), 0);
    await release(admission); await pending(fresh); assert.equal(await page.locator("li").count(), 0);
    await release(fresh); await row("Native first").waitFor(); await persisted();
    const calls = await reads(); assert.deepEqual(calls.map(value => value.name), [admission, fresh]);
    for (const value of calls) { assert.equal(value.kind, "read"); assert.equal(value.args.scope, scope); assert.equal(value.nonce, "fixture-nonce"); assert.equal(value.scopeEpoch, 1); }
  });
  await t.test("warm native return admits before cache render and opens manager through existing online host", async () => {
    await mount({ holdAdmission: true, holdFresh: true, label: "Native updated" }, { path: "/services?service=fixture-service" }); await pending(admission); await absent("Native first");
    await release(admission); await pending(fresh); await row("Native first").waitFor(); await page.getByRole("status").filter({ hasText: "Updating services" }).waitFor();
    await page.getByRole("link", { name: "Manage services" }).click();
    assert.deepEqual(await page.evaluate(() => window.fixture.opened), ["/services?live=1&service=fixture-service"]);
    await release(fresh); await row("Native updated").waitFor();
    const names = await page.evaluate(() => performance.getEntriesByType("measure").map(value => value.name));
    assert.ok(names.includes("reylumi:services-pilot:cache-render")); assert.ok(names.includes("reylumi:services-pilot:fresh-data-ready"));
  });
  for (const [label, envelope] of [["offline", { offline: true }], ["304", { status: 304 }], ["mismatched scope", { scope: `v3:${"b".repeat(64)}` }]]) {
    await t.test(`${label} admission never grants cached presentation or fresh data read`, async () => {
      const before = (await reads()).length;
      await mount({ admissionEnvelope: envelope }); await page.getByRole("alert").waitFor(); await absent("Native updated"); assert.equal(await page.locator("li").count(), 0);
      assert.deepEqual((await reads()).slice(before).map(value => value.name), [admission]);
    });
  }
  await t.test("native URLSession -1009 keeps admitted cache with stale indication", async () => {
    await mount({ holdFresh: true, freshError: -1009 }); await pending(fresh); await row("Native updated").waitFor();
    await release(fresh); await page.getByRole("status").filter({ hasText: "Showing previously loaded details" }).waitFor(); await row("Native updated").waitFor();
  });
  await t.test("explicit403 withdraws and removes the current cached scope", async () => {
    await mount({ holdFresh: true, freshError: 403 }); await pending(fresh); await row("Native updated").waitFor();
    await release(fresh); await page.getByRole("alert").waitFor(); await absent("Native updated");
    await mount({ holdFresh: true }); await pending(fresh); assert.equal(await page.locator("li").count(), 0);
    await release(fresh); await row("Synthetic services").waitFor();
    assert.equal(await page.evaluate(() => window.fixture.commands), 0); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  });
});
