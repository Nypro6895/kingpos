import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import ts from "typescript";

test("mutation retirement bounds unavailable storage without changing auth or purging another salon", async () => {
  const calls = [], timers = [], exports = {};
  const code = ts.transpileModule(readFileSync("lib/services-catalog-runtime.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", "window", "setTimeout", "clearTimeout", code)(name => {
    assert.equal(name, "./services-catalog-cache");
    return { createServicesCatalogStore: () => ({ removeScope(scope) { calls.push(["remove", scope]); return new Promise(() => {}); }, purge() { throw Error("Mutation must never purge unrelated partitions"); } }) };
  }, exports, {}, (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, () => {});
  exports.getServicesCatalogStore(); exports.observeServicesCatalogScope("scope-a");
  exports.subscribeServicesCatalogInvalidation(() => calls.push(["withdraw"]));
  const done = exports.invalidateServicesCatalogForMutation("scope-a");
  assert.deepEqual(calls, [["withdraw"], ["remove", "scope-a"]]); assert.equal(timers[0].ms, 2_000);
  timers[0].callback(); await done;
  assert.equal(exports.servicesCatalogActiveScope(), "scope-a", "Mutation invalidation does not grant or change authority");
});

// Real manager save/create/delete success handlers, pilot, runtime and IndexedDB.
// Only server mutations, navigation and surrounding translation/chrome are local
// fixtures. No account, database or network business writes are performed.
const scope = `v3:${"a".repeat(64)}`, otherScope = `v3:${"b".repeat(64)}`;
const partition = { viewerId: "fixture-viewer", accountId: "fixture-account", salonId: "fixture-salon-a", scope, permissionRevision: "fixture-owner" };
const source = `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{ServicesManager}from'./app/services/services-manager';
import{ServicesCatalogPilot}from'./app/services/services-catalog-pilot';
import{ServicesCatalogCacheLifecycle}from'./components/services-catalog-cache-lifecycle';
import{getServicesCatalogStore}from'./lib/services-catalog-runtime';
window.fixture={label:'Old catalog',ok:true,pending:[],mutations:[],opened:[],native:false,refreshes:0};
const partition=${JSON.stringify(partition)}, other={...partition,salonId:'fixture-salon-b',scope:${JSON.stringify(otherScope)}};
const projection=label=>({services:[{id:'service-one',name:label,category:'Nails',description:null,basePrice:25,durationMinutes:30}]});
const store=getServicesCatalogStore();window.fixtureStore=store;
window.fixtureSeed=async()=>{await store.observeAccount(partition.viewerId,partition.accountId);await store.read(other);await store.write(other,projection('Other salon'));await store.read(partition);await store.write(partition,projection('Old catalog'));};
window.fixtureCached=async()=>({a:await store.read(partition),b:await store.read(other)});
const host={get isNative(){return window.fixture.native;},read:async(name,args,options)=>{
 if(name==='page.services-catalog-admission')return{schemaVersion:1,status:200,scope:partition.scope,data:{schemaVersion:1,partition}};
 if(name!=='page.services-catalog')throw Error('Unexpected read');
 const data=projection(window.fixture.label);return new Promise(resolve=>window.fixture.pending.push(()=>resolve({schemaVersion:1,status:200,scope:partition.scope,data})));
},openOnline:async path=>{window.fixture.opened.push(path);window.fixture.cacheAtHandoff=await window.fixtureCached();if(!window.fixture.native){window.location.assign(path);return;}window.fixtureSetMode('manager');},context:async()=>{throw Error('Unused');},cache:async()=>null,command:async()=>{throw Error('No commands');}};
function data(){return{canManage:true,addOnLinks:[],staff:[],services:[{id:'service-one',salon_id:partition.salonId,name:window.fixture.label,category:'Nails',description:null,base_price:25,duration_minutes:30,is_active:true,online_booking_enabled:false,created_at:'2026-01-01',updated_at:'2026-01-01',bookingAddOns:[],addOnServiceIds:[],bookingStaffIds:[],readiness:{ready:false,needsSetup:false,bookingStaffCount:0,eligibleBookingStaffCount:0,reasons:[]}}]};}
function App(){const[mode,setMode]=useState(new URLSearchParams(location.search).get('live')==='1'?'manager':'none'),[visit,setVisit]=useState(0);window.fixtureSetMode=value=>{setMode(value);setVisit(v=>v+1);};return<><ServicesCatalogCacheLifecycle enabled viewerId={partition.viewerId} accountId={partition.accountId} scope={partition.scope}/>{mode==='pilot'?<ServicesCatalogPilot key={visit} scope={partition.scope} serviceId={null} host={host}/>:mode==='manager'?<ServicesManager key={visit} data={data()} expectedSalonId={partition.salonId} catalogScope={window.fixture.managerScope??partition.scope} initialServiceId='service-one'/>:<p>Outside Services</p>}</>};
createRoot(document.getElementById('root')).render(<App/>);
`;
const replacements = {
  "@/components/workspace-language": `export const useWorkspaceTranslation=()=>value=>value;export function WorkspaceText({text}){return text;}`,
  "@/components/contextual-support": `export const ContextualSupport=()=>null;`,
  "@/components/workspace-toolbar": `export const toolbarStyles={};export function WorkspaceToolbar({children}){return <div>{children}</div>;}`,
  "@/components/compact-filters": `export function CompactFilters({children}){return <div>{children}</div>;}`,
  "next/navigation": `export const useRouter=()=>({refresh(){window.fixture.refreshes++;},replace(path){window.fixture.replaced=path;}});`,
  "@/app/services/actions": `export async function saveServiceConfigsAction(values){window.fixture.mutations.push('save');if(!window.fixture.ok)return{ok:false,message:'Synthetic save failure'};window.fixture.label=values[0].name;return{ok:true,message:'Saved fixture',serviceIds:['service-one']};}export async function createServiceAction(value){window.fixture.mutations.push('create');if(!window.fixture.ok)return{ok:false,message:'Synthetic create failure'};window.fixture.label=value.name;return{ok:true,message:'Created fixture',serviceIds:['service-two']};}`,
  "./delete-unused-action": `export async function deleteUnusedRecordAction(){window.fixture.mutations.push('delete');return window.fixture.ok?{ok:true}:{ok:false,message:'Synthetic delete failure'};}`,
};

test("successful local service mutations retire the matching pilot catalog", { timeout: 90_000 }, async t => {
  const bundle = await build({ stdin: { contents: source, loader: "tsx", resolveDir: process.cwd(), sourcefile: "catalog-mutation-fixture.tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", plugins: [{ name: "local-mutation-boundaries", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(replacements, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: replacements[args.path], loader: "tsx", resolveDir: process.cwd() }));
  } }] });
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].contents); return; }
    response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.SERVICES_CATALOG_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const contexts = [];
  async function fixture() {
    const context = await browser.newContext(); contexts.push(context);
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(8_000); await page.goto(origin); await page.waitForFunction(() => typeof window.fixtureSetMode === "function"); await page.evaluate(() => window.fixtureSeed()); return page;
  }
  t.after(async () => { for (const context of contexts) await context.close(); });
  const mode = (page, value) => page.evaluate(value => window.fixtureSetMode(value), value);
  const cached = page => page.evaluate(() => window.fixtureCached());
  const openPilot = async page => { await mode(page, "pilot"); await page.waitForFunction(() => window.fixture.pending.length > 0); };
  const noOld = async page => { await openPilot(page); assert.equal(await page.getByRole("heading", { name: "Old catalog", exact: true }).count(), 0); };
  async function save(page, name = "Changed catalog") { await page.getByLabel("Name:", { exact: true }).fill(name); await page.getByRole("button", { name: "Save changes", exact: true }).click(); await page.waitForFunction(() => window.fixture.mutations.includes("save")); }

  await t.test("web save success then reopen cannot render the pre-save payload; other salon survives", async () => {
    const page = await fixture(); await mode(page, "manager"); await save(page); await page.getByText("Saved fixture", { exact: true }).waitFor();
    await noOld(page); const rows = await cached(page); assert.equal(rows.a, null); assert.equal(rows.b.data.services[0].name, "Other salon");
  });
  await t.test("failed web save preserves the previously valid catalog", async () => {
    const page = await fixture(); await page.evaluate(() => { window.fixture.ok = false; }); await mode(page, "manager"); await save(page); await page.getByText("Synthetic save failure", { exact: true }).first().waitFor();
    await openPilot(page); await page.getByRole("heading", { name: "Old catalog", exact: true }).waitFor(); assert.equal((await cached(page)).a.data.services[0].name, "Old catalog");
  });
  await t.test("direct manager reload invalidates catalog persisted by the previous document", async () => {
    const page = await fixture(); await page.goto(`${origin}/services?live=1`); await page.waitForFunction(() => typeof window.fixtureSetMode === "function"); await save(page); await page.getByText("Saved fixture", { exact: true }).waitFor();
    await noOld(page); assert.equal((await cached(page)).a, null);
  });
  await t.test("save from a different role scope retires the same salon's older role payload", async () => {
    const page = await fixture(); await page.evaluate(() => { window.fixture.managerScope = `v3:${"c".repeat(64)}`; }); await mode(page, "manager"); await save(page); await page.getByText("Saved fixture", { exact: true }).waitFor();
    await noOld(page); const rows = await cached(page); assert.equal(rows.a, null); assert.equal(rows.b.data.services[0].name, "Other salon");
  });
  await t.test("web create success retires cached catalog before router replacement", async () => {
    const page = await fixture(); await mode(page, "manager"); await page.getByRole("button", { name: "New service", exact: true }).click();
    await page.getByRole("dialog").locator('input[maxlength="120"]').fill("Created catalog"); await page.getByRole("button", { name: "Create service", exact: true }).click(); await page.waitForFunction(() => Boolean(window.fixture.replaced));
    await noOld(page); assert.equal((await cached(page)).a, null);
  });
  await t.test("web delete success retires cached catalog through the actual delete callback", async () => {
    const page = await fixture(); await mode(page, "manager"); await page.getByRole("button", { name: "Delete Old catalog", exact: true }).click(); await page.getByRole("button", { name: "Confirm delete", exact: true }).click(); await page.waitForFunction(() => window.fixture.refreshes > 0);
    await noOld(page); assert.equal((await cached(page)).a, null);
  });
  await t.test("native Manage handoff fences old cache before hosted mutation and ignores its old read", async () => {
    const page = await fixture(); await page.evaluate(() => { window.fixture.native = true; }); await openPilot(page); await page.getByRole("heading", { name: "Old catalog", exact: true }).waitFor();
    await page.getByRole("link", { name: "Manage services" }).click(); await page.waitForFunction(() => Boolean(window.fixture.cacheAtHandoff));
    assert.equal((await page.evaluate(() => window.fixture.cacheAtHandoff)).a, null);
    await save(page); await page.getByText("Saved fixture", { exact: true }).waitFor(); await page.evaluate(() => window.fixture.pending.shift()());
    await noOld(page); assert.equal((await cached(page)).a, null); assert.equal((await cached(page)).b.data.services[0].name, "Other salon");
  });
  await t.test("web Manage navigation retires only the matching catalog before page unload", async () => {
    const page = await fixture(); await openPilot(page); await page.getByRole("heading", { name: "Old catalog", exact: true }).waitFor();
    await page.getByRole("link", { name: "Manage services" }).click(); await page.waitForURL("**/services?live=1"); await page.waitForFunction(() => typeof window.fixtureCached === "function");
    const rows = await cached(page); assert.equal(rows.a, null); assert.equal(rows.b.data.services[0].name, "Other salon");
  });
});
