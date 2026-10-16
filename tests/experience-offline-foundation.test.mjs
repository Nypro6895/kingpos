import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runInNewContext } from 'node:vm';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
async function moduleFrom(file, plugins = []) {
  const result = await build({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@': process.cwd() }, plugins });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('offline policy rejects secret/action/foreign routes and expired or mismatched leases', async () => {
  const api = await moduleFrom('lib/experience-offline-policy.ts');
  for (const path of ['/pos', '/pos/book', '/staff/my-work?tab=payroll', '/activity', '/my-bookings/id-1', '/explore/favorites', '/payroll', '/more/saved-post', '/more/following', '/beauty']) assert.ok(api.getExperienceOfflinePath(path));
  for (const path of ['/api/pos/operations', '/admin', '/login', '/book/a', '/booking/manage?token=a', '/pos/customer-display?token=a', '/customers/new', '/customers/a/edit', '/market?client_secret=a', '/market?bookingStripe=done', '/market?setup_intent_client_secret=a', '/market?payment=received', '/more/security', '/pos?token=a', '//foreign.test/pos', '/pos#hidden']) assert.equal(api.getExperienceOfflinePath(path), null, path);
  const now = Date.now(), grant = { version: 1, scope: 'scope-a', scopes: ['scope-a'], viewerId: 'viewer-a', workspaceId: 'salon-a', salonId: 'salon-a', grantRevision: 'revision-a', generation: 'generation-fixture-12345', issuedAt: now, expiresAt: now + 86400000, path: '/pos', kind: 'owner' };
  assert.equal(api.isExperienceOfflineGrant(grant), true);
  assert.equal(api.isExperienceOfflineGrant({ ...grant, expiresAt: now - 1 }), false);
  assert.equal(api.isExperienceOfflineGrant({ ...grant, expiresAt: now + 86400001 }), false);
  assert.equal(api.isExperienceOfflineGrant(grant, { scope: 'scope-b' }), false);
  assert.equal(api.isExperienceOfflineGrant(grant, { generation: 'different-generation' }), false);
  assert.equal(api.isExperienceOfflineGrant(grant, { path: '/payroll' }), false);
});

test('fresh grant endpoint preserves outage versus denial and derives actual staff authority', async () => {
  const state = globalThis.__offlineGrantFixture = { unavailable: false, contextReads: 0, user: true, staff: true, portable: null, error: null };
  const context = { scope: 'scope-a', viewerId: 'viewer-a', workspaceId: 'workspace-a', salonId: 'salon-a', permissionRevision: 'read-write', authenticated: true };
  state.context = context;
  const api = await moduleFrom('app/api/experience/offline-context/route.ts', [{ name: 'authorized-read-fixture', setup(builder) {
    builder.onResolve({ filter: /^(?:next\/(?:headers|server)|@\/lib\/(?:request-business-context|experience-context|staff-portal-identity|staff-offline-binding-server|staff-workdays|staff-account|supabase\/server|current-context|bounded-get))$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
      const state=globalThis.__offlineGrantFixture;
      export const connection=async()=>{};export const headers=async()=>new Headers(state.unavailable?{'x-reylumi-auth-unavailable':'1'}:{});
      export const cookies=async()=>({get:name=>state.portable?.[name]?{value:state.portable[name]}:undefined});
      export const getRequestBusinessContext=async()=>{state.contextReads++;if(state.error)throw Error('Read unavailable');return{user:state.user?{id:state.context.viewerId}:null,currentSalon:{id:state.context.salonId},experience:{...state.context,authenticated:state.user,viewerId:state.user?state.context.viewerId:null}}};
      export const getExperienceContext=context=>context.experience;export const isSalonManageContext=()=>state.manage!==false;
      export const getCurrentStaffBusinessContext=async()=>({user:{id:state.context.viewerId},currentSalon:{id:state.context.salonId},currentAccount:{id:'account-a'},experience:{...state.context,scope:'staff-scope'}});
      export const getCurrentStaffForSalon=async()=>state.staff?{id:state.staffId??'staff-a'}:Promise.reject(Error('No staff found'));export const CURRENT_STAFF_NOT_FOUND_MESSAGE='No staff found';
      export const getStaffPortalIdentity=async()=>({context:{user:{id:state.context.viewerId},experience:{...state.context,scope:'staff-scope'}},staff:state.staff?{id:state.staffId??'staff-a'}:null});
      export const getStaffOfflineBindingAuthorization=async()=>state.bindingState==='approved'?{state:'approved',binding:state.binding}:{state:state.bindingState??'unconfirmed',binding:null};
      export const createSupabaseServerClient=()=>({rpc:async()=>state.portableResult??{data:null,error:null}});
      export const runReadWithDeadline=promise=>promise;
    ` }));
  } }]);
  const request = path => new Request('https://reylumi.test/api/experience/offline-context?generation=generation-fixture-12345&path=' + encodeURIComponent(path));
  let response = await api.GET(request('/pos')); assert.equal(response.status, 200);
  let grant = await response.json(); assert.equal(grant.expiresAt - grant.issuedAt, 86400000); assert.deepEqual(grant.scopes, ['scope-a']);
  response = await api.GET(request('/staff/my-work')); assert.equal(response.status, 503, 'participant-writable staff links cannot issue a durable display lease');
  response = await api.GET(request('/staff/workday')); assert.equal(response.status, 503);
  response = await api.GET(request('/staff/today')); grant = await response.json(); assert.equal(grant.kind, 'owner');
  state.unavailable = true; const reads = state.contextReads;
  assert.equal((await api.GET(request('/pos'))).status, 503); assert.equal(state.contextReads, reads);
  state.unavailable = false; state.error = true; assert.equal((await api.GET(request('/pos'))).status, 503);
  state.error = null; state.user = false; assert.equal((await api.GET(request('/payroll'))).status, 401);
  state.user = true; state.manage = false; assert.equal((await api.GET(request('/pos'))).status, 403);
  state.manage = true; state.staff = false; assert.equal((await api.GET(request('/staff/my-work'))).status, 403);
  state.staff = true; state.bindingState = 'revoked'; assert.equal((await api.GET(request('/staff/my-work'))).status, 403);
  state.bindingState = 'approved'; state.context.viewerId = '11111111-1111-4111-8111-111111111111'; state.context.salonId = '22222222-2222-4222-8222-222222222222'; state.staffId = '33333333-3333-4333-8333-333333333333';
  state.binding = { version: 1, viewerId: state.context.viewerId, salonId: state.context.salonId, staffId: state.staffId, revision: '44444444-4444-4444-8444-444444444444', approvedAt: new Date().toISOString() };
  response = await api.GET(request('/staff/my-work')); assert.equal(response.status, 200); grant = await response.json(); assert.equal(grant.kind, 'staff'); assert.deepEqual(grant.staffBinding, state.binding);
  state.portable = { 'kingpos-portable-pos-key-id': 'key-a', 'kingpos-portable-pos-session': 'test-signature' };
  state.portableResult = { data: null, error: { code: 'PGRST000' } }; assert.equal((await api.GET(request('/pos/portable'))).status, 503);
  state.portableResult = { data: null, error: null }; assert.equal((await api.GET(request('/pos/portable'))).status, 403);
  delete globalThis.__offlineGrantFixture;
});

let compiled;
async function fixture(overrides = {}) {
  compiled ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import*as cache from'./lib/experience-persistent-cache';import*as offline from'./lib/experience-offline-client';
    import{useExperienceResource}from'./lib/use-experience-resource';import{ExperienceScopeProvider}from'./components/experience-scope';
    import{savePortableOperation,listPortableOperations}from'./lib/portable-operations';
    import*as native from'./lib/experience-native-readmodels';import{registerPortableServiceWorker}from'./lib/portable-service-worker';
    import{resetExperienceCaches}from'./lib/reset-experience-cache';import{ExperienceCacheLifecycle}from'./components/experience-cache-lifecycle';
    window.api={...cache,...offline,...native,resetExperienceCaches,registerPortableServiceWorker,savePortableOperation,listPortableOperations};window.readyEvents=[];window.clearEvents=0;
    window.addEventListener('reylumi:offline-ready',event=>window.readyEvents.push(event.detail));window.addEventListener('reylumi:offline-clear',()=>window.clearEvents++);
    const context=window.SERVER_CONTEXT,scope=context.scope;
    function NativeReadProbe(){const seed={data:{amount:10},revision:'a'.repeat(64),sections:{amount:'a'.repeat(64)},updatedAt:new Date(window.SERVER_SEED).toISOString()};const view=useExperienceResource({scope,key:'native-resource',initialData:seed,initialUpdatedAt:window.SERVER_SEED,freshForMs:0,retainForMs:120000,persistence:{domain:'owner-today',endpoint:'/api/experience/today?date=2026-10-16'},fetcher:()=>new Promise(resolve=>{window.currentNativeGet={resolve}})});return <p data-native-read>{view.data?.data.amount}</p>}
    function App(){const[money,setMoney]=useState(()=>localStorage.getItem('fixture-money')??'125.75');const[tool,setTool]=useState(false);
      const view=useExperienceResource({scope,key:'fixture-ui',initialData:{total:10},initialUpdatedAt:window.SERVER_SEED,freshForMs:0,retainForMs:120000,persistence:{domain:'owner-pos',params:{date:'2026-10-16'}},fetcher:async()=>{throw Error('Fixture live read held')}});
      return <><input aria-label='Money draft' value={money} onChange={event=>{setMoney(event.target.value);localStorage.setItem('fixture-money',event.target.value)}}/><p data-readmodel>{view.data?.total}</p><button onClick={()=>import('/_next/static/lazy-extra.js').then(value=>setTool(value.ready))}>{tool?'Local tool ready':'Open local tool'}</button><a href='/staff/my-work'>My Work</a><div data-owner-workspace><div data-owner-more-popover><a href='/activity'>History in More</a></div></div>{window.NATIVE_PROBE?<NativeReadProbe/>:null}</>}
    createRoot(document.getElementById('root')).render(<ExperienceScopeProvider context={context}><ExperienceCacheLifecycle viewerId={context.viewerId} workspace={context.workspaceId} permissionRevision={context.permissionRevision} scope={scope}/><App/></ExperienceScopeProvider>);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'browser-context-fixture', setup(builder) {
    builder.onResolve({ filter: /^\/_next\/static\// }, args => ({ path: args.path, external: true }));
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)(?:workspace-language|loading-feedback|experience-reload)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'tsx', resolveDir: process.cwd(), contents: `export const usePathname=()=>location.pathname;export const useRouter=()=>({refresh(){}});export const WorkspaceText=({text})=>text;export const PageLoadingSkeleton=()=> <p data-access-blocked>Checking access</p>;export const allowExperienceReload=()=>Boolean(window.REAL_RECOVERY);` }));
  } }] });
  const bundle = (await compiled).outputFiles[0].text;
  const bootstrap = await moduleFrom('components/experience-offline-bootstrap.tsx');
  const head = renderToStaticMarkup(React.createElement(bootstrap.ExperienceOfflineBootstrap));
  const seed = Date.now() - 1000;
  const context = { scope: 'scope-a', viewerId: 'viewer-a', workspaceId: 'salon-a', salonId: 'salon-a', permissionRevision: 'revision-a', authenticated: true, ...overrides };
  const state = { grantStatus: 200, holdContext: false, contextResponses: [], heldAssets: [], assetHold: false, version: 'fixture-build-0001', failAsset: false, corruptAsset: false, hits: [], htmlStatus: 200, grantScope: context.scope, contextScope: context.scope, grantRevision: 'revision-a', grantKind: 'owner', staffBinding: undefined, offlineState: undefined, deniedPaths: [] };
  const server = createServer((request, response) => {
    state.hits.push({ method: request.method, path: request.url, at: Date.now(), mode: request.headers['sec-fetch-mode'], destination: request.headers['sec-fetch-dest'] }); const url = new URL(request.url, 'http://localhost');
    const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (url.pathname === '/api/experience/offline-context') return json({ version: 1, ...context, scope: state.grantScope, scopes: [state.grantScope], grantRevision: state.grantRevision, generation: url.searchParams.get('generation'), issuedAt: Date.now(), expiresAt: Date.now() + 86400000, path: url.searchParams.get('path'), kind: state.grantKind, staffBinding: state.staffBinding, localCommands: true, offlineState: state.offlineState }, state.deniedPaths.includes(url.searchParams.get('path')) ? 403 : state.grantStatus);
    if (url.pathname === '/api/experience/context') { if (state.holdContext) { state.contextResponses.push(response); return; } return json({ ...context, scope: state.contextScope }); }
    if (url.pathname === '/api/experience/offline-assets') {
      const bodies = { '/_next/static/fixture-main.js': bundle, '/_next/static/styles.css': '@font-face{font-family:Fixture;src:url(/_next/static/fixture-font.woff2)}body{font:16px system-ui}', '/_next/static/lazy-extra.js': 'export const ready=true;', '/_next/static/fixture-font.woff2': 'fixture-font', ...(state.failAsset || state.assetHold || state.corruptAsset ? { '/_next/static/held-extra.js': 'export const held=true;' } : {}) };
      const files = Object.entries(bodies).map(([path, body]) => ({ path, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') }));
      return json({ version: state.version, totalBytes: files.reduce((sum, row) => sum + row.bytes, 0), assets: Object.keys(bodies), files });
    }
    if (url.pathname === '/portable-sw.js' || url.pathname === '/experience-sw.js' || url.pathname === '/experience-offline-worker.js') { response.writeHead(200, { 'Content-Type': 'text/javascript', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-store' }); response.end(readFileSync(join('public', url.pathname.slice(1)))); return; }
    if (url.pathname === '/_next/static/fixture-main.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(bundle); }
    if (url.pathname === '/_next/static/lazy-extra.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end('export const ready=true;'); }
    if (url.pathname === '/_next/static/held-extra.js') { if (state.assetHold) { state.heldAssets.push(response); return; } response.statusCode = state.failAsset ? 503 : 200; return response.end(state.corruptAsset ? 'export const wrong=true;' : 'export const held=true;'); }
    if (url.pathname === '/_next/static/styles.css') { response.setHeader('Content-Type', 'text/css'); return response.end('@font-face{font-family:Fixture;src:url(/_next/static/fixture-font.woff2)}body{font:16px system-ui}'); }
    if (url.pathname === '/_next/static/fixture-font.woff2') { response.setHeader('Content-Type', 'font/woff2'); return response.end(Buffer.from('fixture-font')); }
    if (url.pathname.startsWith('/api/')) return json({}, 503);
    response.writeHead(state.htmlStatus, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    response.end('<!doctype html><html><head>' + head + '<link rel="stylesheet" href="/_next/static/styles.css"></head><body>' + (url.pathname === '/pos/customer-display' ? '<span data-customer-display-shell></span>' : renderToStaticMarkup(React.createElement('span', { hidden: true, 'data-experience-offline-scope': context.scope }))) + '<div id="root"><p data-private-server-preview>Private server receipt $150</p></div><script>window.SERVER_DOCUMENT=' + JSON.stringify(crypto.randomUUID()) + ';window.SERVER_SEED=' + seed + ';window.SERVER_CONTEXT=' + JSON.stringify(context).replaceAll('<', '\\u003c') + '</script><script src="/_next/static/fixture-main.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, profile = mkdtempSync(join(tmpdir(), 'reylumi-offline-foundation-'));
  let browser;
  async function launch(offline = false) { browser = await chromium.launchPersistentContext(profile, { executablePath: browserPath, headless: true, offline, args: ['--no-proxy-server'], viewport: { width: 390, height: 844 } }); const page = await browser.newPage(); page.setDefaultTimeout(12000); return page; }
  return { state, origin, launch, async restart(offline = false) { await browser.close(); return launch(offline); }, async close() { for (const response of [...state.contextResponses, ...state.heldAssets]) response.destroy(); await browser?.close(); await new Promise(resolve => server.close(resolve)); assert.ok(resolve(profile).startsWith(resolve(tmpdir()) + '\\') || resolve(profile).startsWith(resolve(tmpdir()) + '/')); rmSync(profile, { recursive: true, force: true }); } };
}

test('complete local boot survives browser restart offline and under held auth, with working controls and newer disk readmodel', { skip, timeout: 90000 }, async t => {
  const app = await fixture();
  try {
    let page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').fill('987.65');
    assert.equal(await page.evaluate(async () => Boolean(await api.prepareExperienceOfflinePath('/pos', { scope: 'scope-a' }))), true);
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos')), true);
    const ready = await page.evaluate(() => readyEvents.at(-1)); assert.equal(ready.path, '/pos'); assert.equal(ready.version, 1); assert.ok(Date.parse(ready.expiresAt) > Date.now());
    assert.equal(await page.evaluate(async () => Boolean(await api.prepareExperienceOfflinePath('/activity', { scope: 'scope-a' }))), true);
    assert.equal(await page.evaluate(() => api.writeExperienceSnapshot({ scope: 'scope-a', domain: 'owner-pos', params: { date: '2026-10-16' }, data: { total: 25 } })), true);
    page = await app.restart(true); const offlineStart = Date.now(); await page.goto(app.origin + '/pos');
    assert.equal(await page.getByLabel('Money draft').inputValue(), '987.65');
    await page.getByLabel('Money draft').fill('987.66'); const offlineColdUsableMs = Date.now() - offlineStart;
    await page.locator('[data-readmodel]').filter({ hasText: '25' }).waitFor();
    await page.getByRole('button', { name: 'Open local tool' }).click(); await page.getByRole('button', { name: 'Local tool ready' }).waitFor();
    await page.getByRole('link', { name: 'History in More' }).click(); await page.waitForURL(app.origin + '/activity');
    assert.equal(await page.getByLabel('Money draft').inputValue(), '987.66', 'More links use a prepared full document while the draft survives locally');
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    app.state.holdContext = true;
    page = await app.restart(false); const start = Date.now(); await page.goto(app.origin + '/pos');
    await page.getByLabel('Money draft').fill('654.32'); assert.ok(Date.now() - start < 6000, 'valid local lease must not await the 8-second context deadline');
    t.diagnostic(JSON.stringify({ offlineColdUsableMs, heldAuthUsableMs: Date.now() - start, environment: 'Chromium persistent-profile fixture, not iPhone' }));
    assert.equal(await page.getByLabel('Money draft').inputValue(), '654.32');
    await page.waitForFunction(() => document.getElementById('reylumi-offline-boot'));
  } finally { await app.close(); }
});

test('missing assets never publish readiness; lock defeats late preparation and preserves the financial outbox', { skip, timeout: 90000 }, async () => {
  const app = await fixture();
  try {
    const page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').waitFor();
    assert.equal(await page.evaluate(async () => Boolean(await api.prepareExperienceOfflinePath('/pos', { scope: 'scope-a' }))), true);
    app.state.version = 'fixture-build-0002'; app.state.failAsset = true;
    assert.equal(await page.evaluate(async () => Boolean(await api.prepareExperienceOfflinePath('/pos/ticket', { scope: 'scope-a' }))), false);
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos/ticket')), false);
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos')), true, 'a failed prepare must retain the previous complete document');
    await page.evaluate(() => api.savePortableOperation('owner:salon-a:viewer-a', 'receipt', { lines: [{ total: 10 }], localDraftKey: 'fixture-cart' }));
    app.state.failAsset = false; app.state.assetHold = true; app.state.version = 'fixture-build-0003';
    await page.evaluate(() => { window.latePrepare = api.prepareExperienceOfflinePath('/pos/book', { scope: 'scope-a' }); });
    await page.waitForTimeout(200);
    await page.evaluate(() => api.lockExperienceOffline());
    for (const response of app.state.heldAssets) { response.setHeader('Content-Type', 'text/javascript'); response.end('export const held=true;'); }
    assert.equal(await page.evaluate(() => latePrepare), null);
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos')), false);
    const rows = await page.evaluate(() => api.listPortableOperations('owner:salon-a:viewer-a')); assert.equal(rows.length, 1); assert.equal(rows[0].state, 'pending');
  } finally { await app.close(); }
});

test('durable JSON is scoped, bounded, refuses credentials and cannot resurrect after reset', { skip, timeout: 90000 }, async () => {
  const app = await fixture();
  try {
    const page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').waitFor();
    await page.evaluate(() => api.refreshExperienceOfflineAuthorization('/pos', 'scope-a'));
    const outcome = await page.evaluate(async () => {
      const context = { scope: 'scope-a', domain: 'payroll-draft', params: { b: 2, a: 1 } };
      const saved = await api.writeExperienceSnapshot({ ...context, data: { bonus: '125.50' } });
      const restored = await api.readExperienceSnapshot({ ...context, params: { a: 1, b: 2 } });
      const wrongAccount = await api.readExperienceSnapshot({ ...context, scope: 'scope-b' });
      const secret = await api.writeExperienceSnapshot({ ...context, data: { access_token: 'forbidden' } });
      const huge = await api.writeExperienceSnapshot({ ...context, data: { text: 'x'.repeat(2 * 1024 * 1024) } });
      const invalidTtl = await api.writeExperienceSnapshot({ ...context, data: {}, retainForMs: NaN });
      const late = api.writeExperienceSnapshot({ ...context, data: { bonus: '9999' } });
      await api.clearExperienceSnapshots(); const lateAccepted = await late;
      await api.refreshExperienceOfflineAuthorization('/pos', 'scope-a');
      for (let index = 0; index < 40; index++) await api.refreshExperienceOfflineAuthorization('/pos?slot=' + index, 'scope-a');
      const savedGrants = await new Promise((resolve, reject) => { const open = indexedDB.open('reylumi-experience-readmodels-v1'); open.onsuccess = () => { const db = open.result, read = db.transaction('records').objectStore('records').getAll(); read.onsuccess = () => { resolve(read.result.filter(row => 'grant' in row).length); db.close(); }; read.onerror = () => reject(read.error); }; });
      return { saved, restored, wrongAccount, secret, huge, invalidTtl, lateAccepted, savedGrants, after: await api.readExperienceSnapshot(context) };
    });
    assert.equal(outcome.saved, true); assert.equal(outcome.restored.data.bonus, '125.50'); assert.equal(outcome.wrongAccount, null);
    assert.equal(outcome.secret, false); assert.equal(outcome.huge, false); assert.equal(outcome.invalidTtl, false); assert.equal(outcome.lateAccepted, false); assert.equal(outcome.after, null);
    assert.equal(outcome.savedGrants, 32, 'expired/query-varied authorization rows also have a fixed disk budget');
  } finally { await app.close(); }
});

test('expired grants, evicted lazy chunks and mismatched build bytes cannot expose a prepared private document', { skip, timeout: 90000 }, async () => {
  const app = await fixture();
  try {
    const page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').waitFor();
    assert.equal(await page.evaluate(async () => Boolean(await api.prepareExperienceOfflinePath('/pos', { scope: 'scope-a' }))), true);
    await page.evaluate(async () => { for (const name of await caches.keys()) if (name.startsWith('reylumi-offline-assets-')) await (await caches.open(name)).delete('/_next/static/lazy-extra.js'); });
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos')), false, 'an existing asset cache name cannot prove completeness');
    assert.equal(await page.evaluate(async () => Boolean(await api.prepareExperienceOfflinePath('/pos', { scope: 'scope-a' }))), true, 'the minute shortcut must repair an evicted chunk');
    app.state.corruptAsset = true; app.state.version = 'fixture-build-corrupt';
    assert.equal(await page.evaluate(async () => Boolean(await api.prepareExperienceOfflinePath('/pos/report', { scope: 'scope-a' }))), false, '200 status with bytes from another build must fail SHA256');
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos/report')), false);
    await page.evaluate(async () => {
      const cache = await caches.open('reylumi-offline-web-v1-index'); const key = new URL('/__experience-offline__/web', location.origin); const meta = await (await cache.match(key)).json();
      for (const row of Object.values(meta.entries)) row.grant.expiresAt = Date.now() - 1;
      await cache.put(key, new Response(JSON.stringify(meta)));
    });
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos')), false);
    await page.context().setOffline(true); await page.goto(app.origin + '/pos');
    assert.equal(await page.getByLabel('Money draft').count(), 0); assert.match(await page.locator('body').innerText(), /Please connect to continue/);
  } finally { await app.close(); }
});

test('fresh confirmed revocation clears both worker realms and hides retained private DOM even when root context alone still matches', { skip, timeout: 90000 }, async () => {
  const app = await fixture();
  try {
    const page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').waitFor();
    await page.evaluate(() => api.prepareExperienceOfflinePath('/pos', { scope: 'scope-a' }));
    await page.evaluate(() => api.prepareExperienceOfflinePath('/pos/ticket', { scope: 'scope-a' }));
    app.state.grantStatus = 403;
    assert.equal(await page.evaluate(() => api.prepareExperienceOfflinePath('/pos/report', { scope: 'scope-a' })), null);
    await page.getByText('Your access has changed. Reload to continue.').waitFor();
    assert.equal(await page.getByLabel('Money draft').isVisible(), false);
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos')), false);
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos/ticket')), false);
    assert.equal(await page.evaluate(() => api.isExperienceSnapshotAuthorized('scope-a')), false);
  } finally { await app.close(); }
});

test('native read packets require full envelopes and current foreground authorization; staff persistence cannot borrow a customer lease', { skip, timeout: 90000 }, async () => {
  const app = await fixture();
  try {
    const page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').waitFor();
    const outcome = await page.evaluate(async () => {
      await api.clearExperienceSnapshots();
      const generation = api.getExperienceDeviceGeneration(), now = Date.now(), revision = 'a'.repeat(64), context = { scope: 'scope-a', domain: 'customer-activity' };
      const grant = { version: 1, scope: 'scope-a', scopes: ['scope-a'], viewerId: 'viewer-a', workspaceId: 'salon-a', salonId: 'salon-a', grantRevision: 'r', generation, issuedAt: now, expiresAt: now + 86400000, path: '/activity', kind: 'customer' };
      await api.acceptExperienceOfflineGrant(grant);
      const staffDenied = await api.writeExperienceSnapshot({ scope: 'scope-a', domain: 'staff-my-work', data: { confidential: true } });
      const payrollDenied = await api.writeExperienceSnapshot({ scope: 'scope-a', domain: 'draft:payroll-input', data: { bonus: 100 } });
      const customerAllowed = await api.writeExperienceSnapshot({ ...context, data: { receipts: [] } });
      const packet = { partial: false, data: { amount: 42 }, revision, sections: { amount: revision }, updatedAt: new Date(now).toISOString() }, receivedAt = new Date(now).toISOString();
      const partialRejected = api.parseExperienceNativeReadModel({ ...packet, partial: true }, receivedAt) === null;
      const malformedRejected = api.parseExperienceNativeReadModel({ ...packet, revision: 'bad' }, receivedAt) === null;
      const oldRejected = api.parseExperienceNativeReadModel(packet, new Date(now - 90000000).toISOString()) === null;
      let applied = 0; const registrations = []; window.__reylumiBackgroundSync = { register: value => registrations.push(value), drain: () => {} };
      const stop = api.subscribeExperienceNativeReadModel({ scope: 'scope-a', key: 'native-key', endpoint: '/api/experience/today?date=2026-10-16', onSnapshot: () => applied++ });
      // Drop fresh checks without changing the lease, as on a cold offline boot.
      await api.clearExperienceSnapshots(); const next = { ...grant, generation: api.getExperienceDeviceGeneration() }; await api.acceptExperienceOfflineGrant(next);
      const send = (scope, key = 'native-key', payload = packet) => window.dispatchEvent(new CustomEvent('reylumi:native-snapshots', { detail: { scope, snapshots: [{ key, endpoint: '/api/experience/today?date=2026-10-16&scope=scope-a', payload, receivedAt }] } }));
      send('scope-a'); const beforeFresh = applied;
      api.markExperienceScopeOnlineValidated('scope-a'); send('scope-a'); const customerNativeDenied = applied === 0;
      await api.acceptExperienceOfflineGrant({ ...next, kind: 'owner' });
      send('wrong-scope'); send('scope-a', 'wrong-key'); send('scope-a', 'native-key', { ...packet, partial: true }); send('scope-a');
      const afterFresh = applied; stop(); send('scope-a');
      return { staffDenied, payrollDenied, customerAllowed, partialRejected, malformedRejected, oldRejected, customerNativeDenied, beforeFresh, afterFresh, afterStop: applied, registrations: registrations.length };
    });
    assert.equal(outcome.staffDenied, false); assert.equal(outcome.payrollDenied, false); assert.equal(outcome.customerAllowed, true);
    assert.equal(outcome.partialRejected, true); assert.equal(outcome.malformedRejected, true); assert.equal(outcome.oldRejected, true);
    assert.equal(outcome.customerNativeDenied, true);
    assert.equal(outcome.beforeFresh, 0); assert.equal(outcome.afterFresh, 1); assert.equal(outcome.afterStop, 1); assert.ok(outcome.registrations > 0);
  } finally { await app.close(); }
});

test('the paired customer display keeps its legacy offline shell under a fresh bounded Portable lease', { skip, timeout: 90000 }, async t => {
  const app = await fixture();
  try {
    let page = await app.launch(); await page.goto(app.origin + '/pos/portable'); await page.getByLabel('Money draft').waitFor();
    assert.equal(await page.evaluate(async () => {
      const worker = await api.registerPortableServiceWorker(), channel = new MessageChannel();
      const complete = new Promise(resolve => { channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data?.ok); }; });
      worker.postMessage({ kind: 'portable-prepare', scope: 'scope-a', displayPath: '/pos/customer-display?token=fixture-paired-token', assets: [] }, [channel.port2]);
      return complete;
    }), true);
    await page.waitForFunction(async () => { const cache = await caches.open('reylumi-offline-pos-v1-index'); const response = await cache.match(new URL('/__experience-offline__/pos', location.origin)); return response && Boolean((await response.json()).entries['/pos/customer-display?token=fixture-paired-token']); });
    page = await app.restart(true); await page.goto(app.origin + '/pos/customer-display?token=fixture-paired-token');
    await page.getByLabel('Money draft').waitFor().catch(async error => {
      const state = await page.evaluate(async () => {
        const names = await caches.keys(), response = await (await caches.open('reylumi-offline-pos-v1-index')).match(new URL('/__experience-offline__/pos', location.origin));
        return { text: document.body.innerText, media: document.getElementById('reylumi-offline-guard')?.media, boot: document.getElementById('reylumi-offline-boot')?.textContent, authorized: window.api?.readExperienceOfflineBootGrant('scope-a'), active: window.api?.getExperienceOfflineGrant('scope-a'), names, metadata: await response?.json() };
      });
      t.diagnostic(JSON.stringify(state)); throw error;
    });
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos/customer-display?token=fixture-paired-token')), false, 'paired bearer URLs never become generic offline route hints');
  } finally { await app.close(); }
});

test('stale-generation cached boot stays hidden before fresh authorization and cannot reveal the old account', { skip, timeout: 90000 }, async () => {
  const app = await fixture();
  try {
    let page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').waitFor();
    await page.evaluate(() => api.prepareExperienceOfflinePath('/pos', { scope: 'scope-a' }));
    // Simulate the narrow interval after a reset changed shared storage and
    // before its asynchronous worker-lock message was delivered.
    await page.evaluate(() => localStorage.setItem('reylumi:offline-device-generation:v1', 'changed-generation-1234567890'));
    app.state.holdContext = true; app.state.grantStatus = 503;
    page = await app.restart(true); await page.goto(app.origin + '/pos');
    await page.getByText('Please check your connection and try again.').waitFor();
    assert.equal(await page.getByLabel('Money draft').isVisible(), false);
    assert.equal(await page.evaluate(() => api.readExperienceOfflineBootGrant('scope-a').grant), null);
    app.state.holdContext = false; app.state.contextScope = 'different-account-scope';
    await page.context().setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.getByText('Your access has changed. Reload to continue.').waitFor();
    assert.equal(await page.getByLabel('Money draft').isVisible(), false);
  } finally { await app.close(); }
});

test('two live tabs share one reset generation and can prepare then cold boot the same authorized workspace', { skip, timeout: 90000 }, async () => {
  const app = await fixture();
  try {
    let a = await app.launch(); await a.goto(app.origin + '/pos'); await a.getByLabel('Money draft').waitFor();
    const b = await a.context().newPage(); await b.goto(app.origin + '/pos/ticket'); await b.getByLabel('Money draft').waitFor();
    const old = await a.evaluate(() => api.getExperienceDeviceGeneration());
    assert.equal(await b.evaluate(() => api.getExperienceDeviceGeneration()), old);
    await a.evaluate(() => api.resetExperienceCaches({ reason: 'reset', broadcast: true }));
    await b.waitForFunction(() => clearEvents > 0);
    const current = await a.evaluate(() => api.getExperienceDeviceGeneration());
    assert.notEqual(current, old); assert.equal(await b.evaluate(() => api.getExperienceDeviceGeneration()), current, 'receiving the broadcast must adopt, not rotate again');
    assert.equal(await a.evaluate(async () => Boolean(await api.prepareExperienceOfflinePath('/pos', { scope: 'scope-a' }))), true);
    assert.equal(await b.evaluate(async () => Boolean(await api.prepareExperienceOfflinePath('/pos/ticket', { scope: 'scope-a' }))), true);
    assert.equal(await a.evaluate(() => api.getExperienceDeviceGeneration()), current);
    assert.equal(await b.evaluate(() => api.getExperienceDeviceGeneration()), current);
    a = await app.restart(true); await a.goto(app.origin + '/pos'); await a.getByLabel('Money draft').fill('123.45');
    assert.equal(await a.getByLabel('Money draft').inputValue(), '123.45');
  } finally { await app.close(); }
});

test('a full native read fills the retained view while a newer foreground GET is held, and that GET later wins', { skip, timeout: 90000 }, async t => {
  const app = await fixture();
  try {
    const page = await app.launch(); await page.addInitScript(() => { window.NATIVE_PROBE = true; window.nativeRegistrations = []; window.__reylumiBackgroundSync = { register: value => nativeRegistrations.push(value), drain() {} }; });
    await page.goto(app.origin + '/pos'); await page.locator('[data-native-read]').filter({ hasText: '10' }).waitFor();
    await page.waitForFunction(() => currentNativeGet && nativeRegistrations.length > 0);
    await page.evaluate(() => {
      const row = nativeRegistrations.at(-1), receivedAt = new Date().toISOString(), revision = 'b'.repeat(64);
      window.dispatchEvent(new CustomEvent('reylumi:native-snapshots', { detail: { scope: 'scope-a', snapshots: [{ key: row.key, endpoint: row.endpoint, receivedAt, payload: { data: { amount: 42 }, revision, sections: { amount: revision }, updatedAt: receivedAt, partial: false } }] } }));
    });
    await page.locator('[data-native-read]').filter({ hasText: '42' }).waitFor();
    await page.evaluate(() => { const revision = 'c'.repeat(64); currentNativeGet.resolve({ data: { data: { amount: 99 }, revision, sections: { amount: revision }, updatedAt: new Date().toISOString() } }); });
    await page.locator('[data-native-read]').filter({ hasText: '99' }).waitFor().catch(async error => { t.diagnostic(JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, current: api.getExperienceOfflineGrant('scope-a'), value: currentNativeGet, registrations: nativeRegistrations })))); throw error; });
  } finally { await app.close(); }
});

test('malformed cached bootstrap values fail closed while the literal fresh-server null stays ordinary', async () => {
  const { EXPERIENCE_OFFLINE_BOOT_SCRIPT } = await moduleFrom('components/experience-offline-bootstrap.tsx');
  for (const raw of ['false', '0', '""', '{}', '[]', 'undefined', '']) {
    const style = { media: 'not all' };
    runInNewContext(EXPERIENCE_OFFLINE_BOOT_SCRIPT, { document: { getElementById: id => id === 'reylumi-offline-boot' ? { textContent: raw } : style }, location: { href: 'https://reylumi.test/pos' }, URL, localStorage: { getItem: () => null } });
    assert.equal(style.media, 'all', raw);
  }
  const style = { media: 'not all' };
  runInNewContext(EXPERIENCE_OFFLINE_BOOT_SCRIPT, { document: { getElementById: id => id === 'reylumi-offline-boot' ? { textContent: 'null' } : style } });
  assert.equal(style.media, 'not all');
});

test('actual JSON permission scope prepares and cold-boots with the exact escaped server marker', { skip, timeout: 90000 }, async () => {
  const scope = JSON.stringify({ viewer: 'owner-a', workspace: 'salon-a', permissions: ["customers:read", "service's & salon <manage>"] });
  const app = await fixture({ scope });
  try {
    let page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').fill('456.78');
    assert.equal(await page.evaluate(scope => api.prepareExperienceOfflinePath('/pos', { scope }).then(Boolean), scope), true);
    page = await app.restart(true); await page.goto(app.origin + '/pos');
    await page.getByLabel('Money draft').waitFor(); assert.equal(await page.getByLabel('Money draft').inputValue(), '456.78');
  } finally { await app.close(); }
});

test('base and explicitly approved staff authorities coexist; outage preserves the lease but verified unconfirmed rebind clears it', { skip, timeout: 90000 }, async () => {
  const viewerId = '11111111-1111-4111-8111-111111111111', salonId = '22222222-2222-4222-8222-222222222222', staffId = '33333333-3333-4333-8333-333333333333';
  const app = await fixture({ viewerId, salonId });
  app.state.grantKind = 'staff'; app.state.grantRevision = 'staff-approval-a';
  app.state.staffBinding = { version: 1, viewerId, salonId, staffId, revision: '44444444-4444-4444-8444-444444444444', approvedAt: new Date().toISOString() };
  try {
    const page = await app.launch(); await page.goto(app.origin + '/staff/my-work'); await page.getByLabel('Money draft').waitFor();
    assert.equal(await page.evaluate(() => api.prepareExperienceOfflinePath('/staff/my-work', { scope: 'scope-a' }).then(Boolean)), true);
    const context = { scope: 'scope-a', domain: 'staff-my-work', params: { staffId } };
    assert.equal(await page.evaluate(context => api.writeExperienceSnapshot({ ...context, data: { amount: 125 } }), context), true);
    assert.equal(await page.evaluate(context => api.writeExperienceSnapshot({ ...context, params: { staffId: 'another-staff' }, data: { amount: 125 } }), context), false);
    app.state.grantKind = 'customer'; app.state.grantRevision = 'root-revision'; app.state.staffBinding = undefined;
    assert.equal(await page.evaluate(() => api.prepareExperienceOfflinePath('/market', { scope: 'scope-a' }).then(Boolean)), true);
    assert.equal(await page.evaluate(context => api.isExperienceSnapshotContextAuthorized(context), context), true);
    assert.equal(await page.getByLabel('Money draft').isVisible(), true);
    app.state.grantStatus = 503;
    await page.evaluate(() => api.refreshExperienceOfflineAuthorization('/staff/my-work', 'scope-a'));
    assert.equal(await page.evaluate(context => api.readExperienceSnapshot(context).then(row => row?.data.amount), context), 125);
    app.state.offlineState = 'unconfirmed';
    await page.evaluate(() => api.refreshExperienceOfflineAuthorization('/staff/my-work', 'scope-a'));
    await page.getByText('Your access has changed. Reload to continue.').waitFor();
    assert.equal(await page.getByLabel('Money draft').isVisible(), false);
    assert.equal(await page.evaluate(context => api.isExperienceSnapshotContextAuthorized(context), context), false);
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/staff/my-work')), false);
  } finally { await app.close(); }
});

test('a fresh Portable capability revision invalidates previously prepared revoked subviews even while POS remains allowed', { skip, timeout: 90000 }, async () => {
  const app = await fixture(); app.state.grantKind = 'portable';
  try {
    const page = await app.launch(); await page.goto(app.origin + '/pos/portable'); await page.getByLabel('Money draft').waitFor();
    assert.equal(await page.evaluate(() => api.prepareExperienceOfflinePath('/pos/portable', { scope: 'scope-a' }).then(Boolean)), true);
    assert.equal(await page.evaluate(() => api.prepareExperienceOfflinePath('/pos/portable/ticket', { scope: 'scope-a' }).then(Boolean)), true);
    app.state.grantRevision = 'capabilities-b'; app.state.deniedPaths.push('/pos/portable/ticket');
    assert.equal(await page.evaluate(() => api.prepareExperienceOfflinePath('/pos/portable', { scope: 'scope-a' })), null);
    await page.getByText('Your access has changed. Reload to continue.').waitFor();
    assert.equal(await page.getByLabel('Money draft').isVisible(), false);
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos/portable/ticket')), false);
    assert.equal(await page.evaluate(() => api.isExperienceSnapshotAuthorized('scope-a')), false);
    assert.equal(app.state.grantStatus, 200, 'the new POS grant itself remains authorized; its obsolete document must still be replaced');
  } finally { await app.close(); }
});

test('a newly approved staff binding revision cannot reuse the previous staff DOM or durable rows', { skip, timeout: 90000 }, async () => {
  const viewerId = '11111111-1111-4111-8111-111111111111', salonId = '22222222-2222-4222-8222-222222222222', staffId = '33333333-3333-4333-8333-333333333333';
  const app = await fixture({ viewerId, salonId }); app.state.grantKind = 'staff'; app.state.grantRevision = 'staff-approval-a';
  app.state.staffBinding = { version: 1, viewerId, salonId, staffId, revision: '44444444-4444-4444-8444-444444444444', approvedAt: new Date().toISOString() };
  try {
    const page = await app.launch(); await page.goto(app.origin + '/staff/my-work'); await page.getByLabel('Money draft').waitFor();
    const other = await page.context().newPage(); await other.goto(app.origin + '/staff/my-work'); await other.getByLabel('Money draft').waitFor();
    await page.evaluate(() => api.prepareExperienceOfflinePath('/staff/my-work', { scope: 'scope-a' }));
    assert.equal(await page.evaluate(staffId => api.writeExperienceSnapshot({ scope: 'scope-a', domain: 'staff-my-work', params: { staffId }, data: { amount: 999 } }), staffId), true);
    app.state.grantRevision = 'staff-approval-b'; app.state.staffBinding = { ...app.state.staffBinding, staffId: '55555555-5555-4555-8555-555555555555', revision: '66666666-6666-4666-8666-666666666666' };
    await page.evaluate(() => api.refreshExperienceOfflineAuthorization('/staff/my-work', 'scope-a'));
    await page.getByText('Your access has changed. Reload to continue.').waitFor();
    await other.getByText('Your access has changed. Reload to continue.').waitFor();
    assert.equal(await other.getByLabel('Money draft').isVisible(), false);
    assert.equal(await page.getByLabel('Money draft').isVisible(), false);
    assert.equal(await page.evaluate(staffId => api.readExperienceSnapshot({ scope: 'scope-a', domain: 'staff-my-work', params: { staffId } }), staffId), null);
  } finally { await app.close(); }
});

test('invalid cached boot with matching base context waits for worker-clear ACK then reloads one fresh document', { skip, timeout: 90000 }, async t => {
  const app = await fixture();
  try {
    let page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').fill('142.50');
    const grant = await page.evaluate(() => api.prepareExperienceOfflinePath('/pos', { scope: 'scope-a' })); assert.ok(grant);
    const cachedDocument = await page.evaluate(async () => {
      const meta = await (await (await caches.open('reylumi-offline-web-v1-index')).match(new URL('/__experience-offline__/web', location.origin))).json();
      const html = await (await (await caches.open(meta.entries['/pos'].cache)).match('/pos')).text(); return JSON.parse(html.match(/window.SERVER_DOCUMENT=("[^"]+")/)[1]);
    });
    await page.evaluate(() => localStorage.setItem('reylumi:offline-device-generation:v1', 'invalidated-generation-1234567890'));
    app.state.grantStatus = 503;
    const readsBefore = app.state.hits.filter(hit => hit.path === '/pos').length;
    page = await app.restart(true); await page.addInitScript(() => { window.REAL_RECOVERY = true; });
    const documents = []; page.on('domcontentloaded', () => { void page.evaluate(() => window.SERVER_DOCUMENT).then(id => documents.push(id)).catch(() => {}); });
    await page.goto(app.origin + '/pos');
    await page.getByText('Please check your connection and try again.').waitFor();
    assert.equal(await page.getByLabel('Money draft').isVisible(), false);
    assert.equal(await page.evaluate(() => document.getElementById('reylumi-offline-boot')?.textContent.trim() !== 'null'), true, 'the rejected document must actually be the cached one');
    await page.context().setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(old => window.SERVER_DOCUMENT && window.SERVER_DOCUMENT !== old, cachedDocument);
    await page.getByLabel('Money draft').waitFor(); assert.equal(await page.getByLabel('Money draft').inputValue(), '142.50');
    const after = app.state.hits.filter(hit => hit.path === '/pos').slice(readsBefore); t.diagnostic(JSON.stringify({ documents, reads: after }));
    assert.equal(after.length, 1, 'recovery performs exactly one network document read after cached HTML was cleared');
    assert.ok(documents.filter(id => id === cachedDocument).length <= 1, 'the stale document cannot be served again on the recovery reload');
    assert.equal(await page.evaluate(() => api.hasPreparedExperiencePath('/pos')), false);
  } finally { await app.close(); }
});

test('an expiring display lease hides a retained private view offline without deleting pending money commands', { skip, timeout: 90000 }, async () => {
  const app = await fixture();
  try {
    const page = await app.launch(); await page.goto(app.origin + '/pos'); await page.getByLabel('Money draft').fill('857.25');
    await page.evaluate(() => api.prepareExperienceOfflinePath('/pos', { scope: 'scope-a' }));
    await page.evaluate(() => api.savePortableOperation('owner:salon-a:viewer-a', 'receipt', { lines: [{ total: 8 }], localDraftKey: 'expired-lease-cart' }));
    await page.context().setOffline(true);
    await page.evaluate(() => { api.getExperienceOfflineGrant('scope-a').expiresAt = Date.now() + 80; window.dispatchEvent(new CustomEvent('reylumi:offline-authorization')); });
    await page.getByText('Please check your connection and try again.').waitFor();
    assert.equal(await page.getByLabel('Money draft').isVisible(), false);
    const rows = await page.evaluate(() => api.listPortableOperations('owner:salon-a:viewer-a')); assert.equal(rows.length, 1); assert.equal(rows[0].state, 'pending');
  } finally { await app.close(); }
});
