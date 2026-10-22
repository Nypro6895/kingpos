import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

// Real product view, lifecycle/reset subscriptions, fetch interception, host,
// controller and IndexedDB. Only server responses, clock sampling and a delay
// before a real observeAccount call are controlled by this local fixture.
const entry = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ServicesCatalogPilot } from './app/services/services-catalog-pilot';
import { ServicesCatalogCacheLifecycle } from './components/services-catalog-cache-lifecycle';
import { ExperienceCacheLifecycle } from './components/experience-cache-lifecycle';
import { SessionExpiryPrompt } from './components/session-expiry-prompt';
import { getServicesCatalogStore, servicesCatalogRuntimeRevision } from './lib/services-catalog-runtime';
import { resetExperienceCaches } from './lib/reset-experience-cache';
import { SERVICES_CATALOG_DATABASE, SERVICES_CATALOG_STORE } from './lib/services-catalog-cache';
window.__realmStore = getServicesCatalogStore;
window.__realmRevision = servicesCatalogRuntimeRevision;
window.__realmReset = resetExperienceCaches;
window.__realmDatabase = SERVICES_CATALOG_DATABASE;
window.__realmRecordStore = SERVICES_CATALOG_STORE;
window.__realmClock = { wall: Date.now(), monotonic: performance.now() };
window.__realmHistory = [];
window.__realmObserveStarted = 0;
window.__realmObserveCompleted = 0;
window.__realmReadCount = 0;
window.__realmRefreshStarted = 0;
window.__realmRefreshCompleted = 0;
window.__realmAbortCount = 0;
window.__realmActiveTransactions = 0;
window.__realmRaw = async () => {
  const request = indexedDB.open(SERVICES_CATALOG_DATABASE, 1);
  const db = await new Promise((resolve,reject) => { request.onupgradeneeded=()=>request.result.createObjectStore(SERVICES_CATALOG_STORE,{keyPath:'id'}); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });
  try { return await new Promise((resolve,reject) => { const tx=db.transaction(SERVICES_CATALOG_STORE), read=tx.objectStore(SERVICES_CATALOG_STORE).getAll(); read.onsuccess=()=>resolve(read.result); read.onerror=()=>reject(read.error); }); }
  finally { db.close(); }
};
window.__realmHoldObserve = () => {
  window.__realmObserveGate = new Promise(resolve => { window.__realmReleaseObserve=()=>{window.__realmObserveGate=null;resolve();}; });
};
const clear = IDBObjectStore.prototype.clear, remove = IDBObjectStore.prototype.delete;
const transaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction=function(...args){
  const tx=transaction.apply(this,args);
  if(this.name===SERVICES_CATALOG_DATABASE){
    window.__realmActiveTransactions++;
    let done=false;const settled=()=>{if(!done){done=true;window.__realmActiveTransactions--;}};
    tx.addEventListener('complete',settled,{once:true});tx.addEventListener('abort',settled,{once:true});
  }
  return tx;
};
const aborted = new WeakSet();
function abortDeletion(store) {
  if (!window.__realmFailDeletion || store.name !== SERVICES_CATALOG_STORE || store.transaction.db.name !== SERVICES_CATALOG_DATABASE || aborted.has(store.transaction)) return;
  const tx=store.transaction; aborted.add(tx);
  queueMicrotask(()=>{try {tx.abort(); window.__realmAbortCount++;} catch {}});
}
IDBObjectStore.prototype.clear=function(...args){const value=clear.apply(this,args);abortDeletion(this);return value;};
IDBObjectStore.prototype.delete=function(...args){const value=remove.apply(this,args);abortDeletion(this);return value;};
function Harness() {
  const [config,setConfig]=useState(null), [,pulse]=useState(0);
  window.__realmMount=setConfig; window.__realmPulse=()=>pulse(value=>value+1);
  if (!config) return <p>Outside Services</p>;
  return <>
    <ExperienceCacheLifecycle viewerId={config.viewerId} workspace={config.accountId} permissionRevision={config.permissionRevision} scope={config.scope}/>
    <SessionExpiryPrompt authenticated={true}/>
    <ServicesCatalogCacheLifecycle enabled={true} viewerId={config.viewerId} accountId={config.accountId} scope={config.scope}/>
    <ServicesCatalogPilot key={config.visit} scope={config.scope} serviceId={null}/>
  </>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
`;
const controllerWrapper = `
import {createServicesCatalogController as actual} from './lib/services-catalog-controller';
export * from './lib/services-catalog-controller';
export function createServicesCatalogController(options) {
  const realStore=options.store;
  const store={...realStore, async observeAccount(...args) {
    if(window.__realmObserveGate) {window.__realmObserveStarted++; await window.__realmObserveGate;}
    try {return await realStore.observeAccount(...args);} finally {window.__realmObserveCompleted++;}
  },read(...args){window.__realmReadCount++;return realStore.read(...args);}};
  const controller=actual({...options,store,now:()=>window.__realmClock.wall,monotonic:()=>window.__realmClock.monotonic});
  window.__realmController=controller;
  const refresh=controller.refresh;
  controller.refresh=async(...args)=>{window.__realmRefreshStarted++;try{return await refresh(...args);}finally{window.__realmRefreshCompleted++;}};
  controller.subscribe(()=>{const s=controller.getSnapshot();window.__realmHistory.push({phase:s.phase,run:s.run,names:s.data?.services.map(x=>x.name)??[],stale:s.stale??false});});
  return controller;
}
`;
const a = { viewerId: 'fixture-viewer-a', accountId: 'fixture-account-a', salonId: 'fixture-salon-a', scope: 'fixture-scope-a', permissionRevision: 'fixture-owner:services.view' };
const other = { ...a, viewerId: 'fixture-viewer-b', accountId: 'fixture-account-b', salonId: 'fixture-salon-b', scope: 'fixture-scope-b' };
const dto = name => ({ services: [{ id: 'fixture-service', name, category: null, description: null, basePrice: 20, durationMinutes: 30 }] });
const executablePath = process.env.TEST_BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(existsSync);
let browser, server, origin, sequence = 0;
const behavior = new Map(), requests = [], pending = new Set();
const errors = [];
before(async () => {
  const built = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: 'realm-fixture.tsx', loader: 'tsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
    plugins: [{ name: 'realm-fixture-boundaries', setup(build) {
      build.onResolve({filter:/^@\/lib\/services-catalog-controller$/},()=>({path:'controller-wrapper',namespace:'fixture'}));
      build.onResolve({filter:/^@\/components\/experience-scope$/},()=>({path:'scope',namespace:'fixture'}));
      build.onResolve({filter:/^@\/components\/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
      build.onResolve({filter:/^@\/app\/login\/login-form$/},()=>({path:'login',namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'}, args=>({contents: args.path==='controller-wrapper'?controllerWrapper:args.path==='scope'?'export const useExperienceScope=()=>null;':args.path==='language'?'export const WorkspaceText=({text})=>text;':'export const LoginForm=()=>null;',loader:'tsx',resolveDir:process.cwd()}));
    } }],
  });
  server = createServer((request,response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if(url.pathname==='/bundle.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});response.end(built.outputFiles[0].contents);return;}
    if(url.pathname==='/'){response.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>');return;}
    const realm = new URL(request.headers.referer || 'http://127.0.0.1').searchParams.get('realm');
    const settings = behavior.get(realm) ?? {};
    if(url.pathname==='/api/auth/session'){response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({authenticated:settings.authenticated!==false}));return;}
    if(url.pathname==='/api/auth/logout'){response.writeHead(200,{'Content-Type':'application/json'});response.end('{}');return;}
    if(url.pathname!=='/api/app-local/read'){response.writeHead(404);response.end();return;}
    const name=url.searchParams.get('name'), scope=url.searchParams.get('scope');
    assert.ok(['page.services-catalog-admission','page.services-catalog'].includes(name));
    const kind=name.endsWith('admission')?'admission':'fresh';
    const item={realm,kind,scope,released:false,release(change={}){
      if(item.released)return;item.released=true;pending.delete(item);
      const current={...settings,...change};
      if(kind==='fresh'&&current.network){response.destroy();return;}
      const status=(kind==='admission'?current.admissionStatus:current.freshStatus)??200;
      response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
      response.end(JSON.stringify(status===200?{schemaVersion:1,status:200,scope,updatedAt:Date.now(),etag:'"fixture"',data:kind==='admission'?{schemaVersion:1,partition:current.partition??a}:dto(current.label??'Live fixture')}:{error:'Fixture refusal'}));
    }};
    requests.push(item);pending.add(item);
    if(kind==='admission'?!settings.holdAdmission:!settings.holdFresh)item.release();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--disable-background-networking','--disable-component-update','--no-first-run']});
});
after(async()=>{for(const item of pending)item.release({admissionStatus:503,freshStatus:503});await browser?.close();await new Promise(resolve=>server?.close(resolve));});

async function fixture(run) {
  const context=await browser.newContext(), ids=[`realm-${++sequence}-a`,`realm-${sequence}-b`];
  const pages=[];
  try {
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    for(const id of ids){const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`${origin}/?realm=${id}`);await page.waitForFunction(()=>typeof window.__realmMount==='function');pages.push(page);}
    await run({context,pages,ids});
  } finally {
    for(const item of pending)if(ids.includes(item.realm))item.release({admissionStatus:503,freshStatus:503});
    await context.close();for(const id of ids)behavior.delete(id);
  }
}
async function nextRequest(id,kind,after) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){const found=requests.slice(after).find(x=>x.realm===id&&x.kind===kind);if(found)return found;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail(`Missing ${id} ${kind} request`);
}
async function mount(page,id,part=a,options={}) {
  const after=requests.length;behavior.set(id,{partition:part,holdFresh:true,...options});
  await page.evaluate(config=>window.__realmMount(config),{...part,visit:++sequence});
  const admission=await nextRequest(id,'admission',after);
  return {after,admission,fresh:()=>nextRequest(id,'fresh',after)};
}
const snapshot = page => page.evaluate(()=>window.__realmController.getSnapshot());
const rows = page => page.evaluate(()=>window.__realmRaw());
const catalogRows = values => values.filter(value=>typeof value.id==='string'&&value.id.startsWith('catalog:'));
async function waitSnapshot(page,predicate) {
  await page.waitForFunction(predicate);return snapshot(page);
}
async function seed(page,id,label='Stored private fixture') {
  const request=await mount(page,id,a,{label});(await request.fresh()).release();
  await page.getByRole('heading',{name:label,exact:true}).waitFor();
  await page.waitForFunction(async()=>{const rows=await window.__realmRaw();return rows.some(row=>row.data?.services?.length);});
}
async function reload(page,id) {
  await page.reload();await page.waitForFunction(()=>typeof window.__realmMount==='function');
  assert.equal(new URL(page.url()).searchParams.get('realm'),id);
}

test('two real realms: delayed observe after another realm removes the scope still requires a new authorized catalog read',()=>fixture(async({pages:[first,second],ids:[one,two]})=>{
  await seed(first,one);await first.evaluate(()=>window.__realmMount(null));
  await second.evaluate(()=>window.__realmHoldObserve());
  const waiting=await mount(second,two,a,{freshStatus:403});
  await second.waitForFunction(()=>window.__realmObserveStarted>0);
  const denial=await mount(first,one,a,{admissionStatus:403});await denial.admission.release();
  await first.waitForFunction(()=>window.__realmController.getSnapshot().phase==='unavailable');
  await first.waitForFunction(async()=>!(await window.__realmRaw()).some(row=>row.data?.services));
  await second.evaluate(()=>window.__realmReleaseObserve());
  (await waiting.fresh()).release();
  const state=await waitSnapshot(second,()=>window.__realmController.getSnapshot().phase==='unavailable');
  assert.equal(state.data,undefined);assert.equal(catalogRows(await rows(second)).length,0);
  assert.deepEqual(await second.evaluate(()=>window.__realmHistory.flatMap(value=>value.names)),[]);
}));

test('actual web logout interception broadcasts withdrawal before delayed observe/fresh results can render',()=>fixture(async({pages:[first,second],ids:[one,two]})=>{
  await seed(first,one);
  await second.evaluate(()=>window.__realmHoldObserve());
  await mount(second,two);await second.waitForFunction(()=>window.__realmObserveStarted>0);
  const before=await second.evaluate(()=>window.__realmRevision());
  await first.evaluate(()=>fetch('/api/auth/logout',{method:'POST'}));
  await second.waitForFunction(before=>window.__realmRevision()>before,before);
  await second.evaluate(()=>window.__realmReleaseObserve());
  await second.waitForFunction(()=>window.__realmController.getSnapshot().phase==='unavailable');
  assert.equal((await snapshot(second)).data,undefined);
  assert.deepEqual(await second.evaluate(()=>window.__realmHistory.flatMap(value=>value.names)),[]);
  assert.equal(requests.filter(item=>item.realm===two&&item.kind==='fresh').length,0);
}));

test('logout plus failed deletion in both realms leaves residue but delayed observe cannot restart the invalidated controller',()=>fixture(async({pages:[first,second],ids:[one,two]})=>{
  await seed(first,one);
  await second.evaluate(()=>window.__realmHoldObserve());
  await mount(second,two);await second.waitForFunction(()=>window.__realmObserveStarted>0);
  for(const page of [first,second])await page.evaluate(()=>{window.__realmFailDeletion=true;});
  await first.evaluate(()=>fetch('/api/auth/logout',{method:'POST'}));
  await first.waitForFunction(()=>window.__realmAbortCount>=1&&window.__realmActiveTransactions===0&&window.__realmController.getSnapshot().phase==='unavailable');
  await second.waitForFunction(()=>window.__realmAbortCount>=2&&window.__realmActiveTransactions===0&&window.__realmController.getSnapshot().phase==='unavailable');
  assert.equal(catalogRows(await rows(second)).length,1,'Both failed purges must leave the original disk row before releasing observation');
  await second.evaluate(()=>window.__realmReleaseObserve());
  await second.waitForFunction(()=>window.__realmObserveCompleted>0&&window.__realmRefreshCompleted===window.__realmRefreshStarted&&window.__realmActiveTransactions===0);
  assert.equal(catalogRows(await rows(second)).length,1,'Both failed purges must leave the original disk row');
  assert.equal((await snapshot(second)).data,undefined);
  assert.equal(await second.getByRole('heading',{name:'Stored private fixture',exact:true}).count(),0);
  assert.deepEqual(await second.evaluate(()=>window.__realmHistory.flatMap(value=>value.names)),[]);
  assert.equal(requests.filter(item=>item.realm===two&&item.kind==='fresh').length,0,'fetchFresh cannot start after delayed observation is cancelled');
}));

test('logout plus failed deletion in both realms rejects an already-inflight late200 and withdraws rendered cache',()=>fixture(async({pages:[first,second],ids:[one,two]})=>{
  await seed(first,one);
  const active=await mount(second,two);const late=await active.fresh();
  await second.getByRole('heading',{name:'Stored private fixture',exact:true}).waitFor();
  const after=await second.evaluate(()=>window.__realmHistory.length);
  for(const page of [first,second])await page.evaluate(()=>{window.__realmFailDeletion=true;});
  await first.evaluate(()=>fetch('/api/auth/logout',{method:'POST'}));
  await first.waitForFunction(()=>window.__realmAbortCount>=1&&window.__realmActiveTransactions===0&&window.__realmController.getSnapshot().phase==='unavailable');
  await second.waitForFunction(()=>window.__realmAbortCount>=2&&window.__realmActiveTransactions===0&&window.__realmController.getSnapshot().phase==='unavailable'&&window.__realmRefreshCompleted===window.__realmRefreshStarted);
  assert.equal(catalogRows(await rows(second)).length,1);
  // The actual host request has already settled through abort above. Releasing
  // its server response proves cancellation, not receipt of an unabortable200.
  late.release({freshStatus:200,label:'Late200 after known logout'});
  assert.equal((await snapshot(second)).data,undefined);
  assert.equal(await second.locator('li h2').count(),0);
  assert.deepEqual(await second.evaluate(after=>window.__realmHistory.slice(after).flatMap(value=>value.names),after),[]);
}));

for(const change of ['account','scope']) test(`actual web ${change} context broadcast invalidates a sibling delayed observation`,()=>fixture(async({pages:[first,second],ids:[one,two]})=>{
  await seed(first,one);
  await second.evaluate(()=>window.__realmHoldObserve());
  await mount(second,two);await second.waitForFunction(()=>window.__realmObserveStarted>0);
  const before=await second.evaluate(()=>window.__realmRevision());
  const next=change==='account'?other:{...a,salonId:'fixture-salon-next',scope:'fixture-scope-next'};
  await mount(first,one,next);
  await second.waitForFunction(before=>window.__realmRevision()>before,before);
  await second.evaluate(()=>window.__realmReleaseObserve());
  await second.waitForFunction(()=>window.__realmController.getSnapshot().phase==='unavailable');
  assert.equal((await snapshot(second)).data,undefined);
  assert.deepEqual(await second.evaluate(()=>window.__realmHistory.flatMap(value=>value.names)),[]);
  assert.equal(requests.filter(item=>item.realm===two&&item.kind==='fresh').length,0);
}));

test('uninformed other realm retains only its prior admission bound; its own later 403 withdraws immediately',()=>fixture(async({pages:[first,second],ids:[one,two]})=>{
  await seed(first,one);await first.evaluate(()=>window.__realmMount(null));
  const active=await mount(second,two);
  await second.getByRole('heading',{name:'Stored private fixture',exact:true}).waitFor();
  const before=await second.evaluate(()=>window.__realmRevision());
  await mount(first,one,a,{admissionStatus:403});await first.waitForFunction(()=>window.__realmController.getSnapshot().phase==='unavailable');
  // A catalog403 is a local known denial. Existing generic web broadcasts are
  // separate; this assertion describes the uninformed realm's granted interval.
  assert.equal(await second.evaluate(()=>window.__realmRevision()),before);
  await second.evaluate(()=>{window.__realmClock.wall+=29_999;window.__realmClock.monotonic+=29_999;window.__realmPulse();});
  assert.equal((await snapshot(second)).data.services[0].name,'Stored private fixture');
  assert.equal(await second.getByRole('heading',{name:'Stored private fixture',exact:true}).count(),1);
  await second.evaluate(()=>{window.__realmClock.wall++;window.__realmClock.monotonic++;window.__realmPulse();});
  await second.waitForFunction(()=>!window.__realmController.getSnapshot().data);
  await second.getByRole('heading',{name:'Stored private fixture',exact:true}).waitFor({state:'detached'});
  (await active.fresh()).release({freshStatus:200,label:'Late result after admission expiry'});
  await second.waitForFunction(()=>window.__realmRefreshCompleted===window.__realmRefreshStarted);
  assert.equal((await snapshot(second)).data,undefined);
  assert.equal(await second.locator('li h2').count(),0);
  assert.ok(!(await second.evaluate(()=>window.__realmHistory.flatMap(value=>value.names))).includes('Late result after admission expiry'));
  const local=await mount(second,two,a,{holdFresh:true});(await local.fresh()).release({freshStatus:403});
  await second.waitForFunction(()=>window.__realmController.getSnapshot().phase==='unavailable');
  assert.equal((await snapshot(second)).data,undefined);
}));

for(const status of [401,403,503]) test(`failed real deletion leaves disk residue, but reload admission${status} never displays it`,()=>fixture(async({pages:[page],ids:[id]})=>{
  await seed(page,id);
  await page.evaluate(()=>{window.__realmFailDeletion=true;window.__realmReset({reason:'logout',broadcast:false});});
  await page.waitForFunction(()=>window.__realmAbortCount>0);
  assert.equal((await snapshot(page)).data,undefined);assert.equal(catalogRows(await rows(page)).length,1,'The fixture must prove actual disk residue');
  await reload(page,id);
  const item=await mount(page,id,a,{admissionStatus:status});await item.admission.release();
  await page.waitForFunction(()=>window.__realmController.getSnapshot().phase==='unavailable'&&window.__realmRefreshCompleted===window.__realmRefreshStarted);
  assert.equal((await snapshot(page)).data,undefined);
  assert.deepEqual(await page.evaluate(()=>window.__realmHistory.flatMap(value=>value.names)),[]);
  assert.equal(await page.evaluate(()=>window.__realmReadCount),0,'Denied/uncertain initial admission cannot call the catalog read adapter');
  assert.equal(await page.getByRole('heading',{name:'Stored private fixture',exact:true}).count(),0);
  assert.equal(requests.slice(item.after).filter(value=>value.kind==='fresh').length,0);
}));

test('failed deletion residue cannot cross account/scope; a new valid account can fetch only its own catalog',()=>fixture(async({pages:[page],ids:[id]})=>{
  await seed(page,id);
  await page.evaluate(()=>{window.__realmFailDeletion=true;window.__realmReset({reason:'logout',broadcast:false});});
  await page.waitForFunction(()=>window.__realmAbortCount>0);assert.equal(catalogRows(await rows(page)).length,1);
  await reload(page,id);await page.evaluate(()=>{window.__realmFailDeletion=true;});
  const request=await mount(page,id,other,{label:'Other account services'});
  await request.fresh();assert.equal((await snapshot(page)).data,undefined);
  assert.equal(await page.getByRole('heading',{name:'Stored private fixture',exact:true}).count(),0);
  (await request.fresh()).release();await page.getByRole('heading',{name:'Other account services',exact:true}).waitFor();
  const names=await page.evaluate(()=>window.__realmHistory.flatMap(value=>value.names));
  assert.ok(!names.includes('Stored private fixture'));assert.ok(names.includes('Other account services'));
}));

test('realm harness has no unexpected browser exceptions',()=>assert.deepEqual(errors,[]));
