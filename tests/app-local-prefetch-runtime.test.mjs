import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
let browser, server, base;
const options = { skip: !browserPath, timeout: 30000 };
const viewer = '00000000-0000-4000-8000-000000000001', salon = '00000000-0000-4000-8000-000000000002', staff = '00000000-0000-4000-8000-000000000003';
function context(kind, suffix = 'a') {
  const now = Date.now(), personal = ['customer', 'public'].includes(kind), scope = 'v3:' + suffix.repeat(64);
  const identity = { scope, viewerId: kind === 'public' ? null : viewer, authenticated: kind !== 'public', workspaceId: personal ? 'personal' : 'workspace', salonId: personal ? null : salon, permissionRevision: 'permission-r1' };
  return { schemaVersion: 1, context: identity, display: { name: 'Fixture', role: kind, language: 'en' }, onlineValidatedAt: now,
    access: { ownerWorkspace: kind === 'owner', staffWorkspace: kind === 'staff' },
    grant: { version: 1, ...identity, scopes: [scope], generation: 'generation-0000000001', grantRevision: 'r1', issuedAt: now - 100, expiresAt: now + 3600000,
      kind, path: kind === 'owner' ? '/staff/today' : kind === 'staff' ? '/staff/my-work' : '/explore',
      ...(kind === 'staff' ? { staffBinding: { version: 1, staffId: staff, viewerId: viewer, salonId: salon, revision: '00000000-0000-4000-8000-000000000004', approvedAt: '2020-01-01T00:00:00Z' } } : {}) } };
}
before(async () => {
  if (!browserPath) return;
  const root = resolve('.').replaceAll('\\', '/');
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: root, contents: `
    import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
    import{useAppLocalResource,prefetchAppLocalResource,resetAppLocalResources,appLocalResourceCache}from'./lib/app-local-resource';
    import{useAppLocalPrefetch}from'./lib/app-local-prefetch';import{readPriorityScheduler}from'./lib/read-priority-scheduler';
    const h=window.h={reads:[],caches:[],commands:[],rules:[],cacheRules:[],readPending:new Map(),cachePending:new Map(),serial:0};
    window.__reylumiAppLocalContext={generation:'generation-0000000001',scopeEpoch:1,nonce:'fixture'};
    const marker=(name,scope)=>name+':'+scope;
    const data=(name,args,scope)=>name==='page.owner-today'?{marker:marker(name,scope),dashboard:{date:'2026-10-27',noAccess:false,permissions:{canViewBookings:false,canViewReports:false,canViewStaffFinancials:false},dayView:{isCurrentDate:true}}}:{marker:marker(name,scope)};
    const response=(row,extra={})=>({schemaVersion:1,status:200,scope:row.scope,etag:'fixture-'+row.id,updatedAt:Date.now(),data:data(row.name,row.args,row.scope),offline:false,...extra});
    window.holdRead=(name,extra={})=>h.rules.push({name,remaining:1,...extra});
    window.holdCache=(name)=>h.cacheRules.push({name,remaining:1});
    window.releaseRead=(id,extra={})=>{const item=h.readPending.get(id);if(!item)throw Error('No held read '+id);h.readPending.delete(id);item.resolve(response(item.row,extra));};
    window.releaseCache=(id,value)=>{const item=h.cachePending.get(id);if(!item)throw Error('No held cache '+id);h.cachePending.delete(id);item.resolve(value);};
    window.host={isNative:true,
      read(name,args={},options={}){const row={id:++h.serial,name,args,scope:options.scope,started:performance.now(),aborted:false,finished:false};h.reads.push(row);
        const rule=h.rules.find(r=>r.name===name&&r.remaining>0&&(!r.scope||r.scope===options.scope));if(rule)rule.remaining--;
        return new Promise((resolve,reject)=>{const abort=()=>{row.aborted=true;if(!rule?.ignoreAbort){row.finished=true;reject(new DOMException('Read cancelled','AbortError'));}};
          options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
          if(rule?.status){row.finished=true;row.status=rule.status;reject(Object.assign(new Error('Fixture read denied'),{status:rule.status}));}
          else if(rule)h.readPending.set(row.id,{row,resolve:value=>{row.finished=true;resolve(value);}});
          else{row.finished=true;resolve(response(row));}
        });},
      cache(operation,args){const row={id:++h.serial,operation,...args,started:performance.now(),finished:false};h.caches.push(row);
        const rule=h.cacheRules.find(r=>r.name===args.name&&r.remaining>0);if(operation==='get'&&rule){rule.remaining--;return new Promise(resolve=>h.cachePending.set(row.id,{resolve:value=>{row.finished=true;resolve(value);}}));}
        row.finished=true;return Promise.resolve(null);},
      command(name,args){h.commands.push({name,args});throw Error('No command is authorized in this read fixture');},openOnline(){throw Error('No navigation transport in read fixture');}
    };
    let configure;function Foreground({value,read}){const state=useAppLocalResource(value.context.scope,read.name,read.args??{});useEffect(()=>{window.foregroundState=state;},[state]);return <output data-testid='foreground'>{state.data?.marker??(state.error?'error:'+state.error:'opening')}</output>;}
    function Runtime({value,path}){useAppLocalPrefetch(value,path);return null;}
    function App(){const[cfg,set]=useState({context:null,path:'/',runtime:false,foreground:null});configure=next=>{history.replaceState({},'',next.path??cfg.path);set({...cfg,...next});};return <>{cfg.context&&cfg.foreground?<Foreground key={cfg.context.context.scope+cfg.foreground.name+JSON.stringify(cfg.foreground.args??{})} value={cfg.context} read={cfg.foreground}/>:null}{cfg.context&&cfg.runtime?<Runtime value={cfg.context} path={cfg.path}/>:null}</>;}
    window.configure=next=>configure(next);window.scheduler=readPriorityScheduler;window.resetReads=resetAppLocalResources;
    window.cached=(scope,name,args={})=>appLocalResourceCache.get({scope,key:'app-local:'+JSON.stringify([name,Object.fromEntries(Object.entries(args).sort(([a],[b])=>a.localeCompare(b)))])});
    window.startDirect=(scope,name,args={})=>{const controller=new AbortController();const state=window.direct={controller,settled:false};prefetchAppLocalResource(scope,name,args,{signal:controller.signal,route:'/pos/book',priority:90}).then(value=>{state.value=value;state.settled=true;},error=>{state.error={name:error.name,status:error.status};state.settled=true;});};
    createRoot(document.getElementById('root')).render(<App/>);window.fixtureReady=true;
  ` }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', plugins: [{ name: 'native-read-boundaries', setup(b) {
    b.onResolve({ filter: /app-local-host$/ }, () => ({ path: 'host', namespace: 'fixture' }));
    b.onResolve({ filter: /experience-persistent-cache$/ }, () => ({ path: 'disk', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'host'
      ? 'export const getAppLocalHost=()=>window.host;'
      : 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};' }));
  } }] });
  server = createServer((req, res) => { if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); } else { res.setHeader('Content-Type', 'text/html'); res.end('<div id="root"></div><script src="/bundle.js"></script>'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function fixture(t) {
  const page = await browser.newPage(); t.after(() => page.close());
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  t.after(() => assert.deepEqual(failures, [], 'browser must have no unhandled rejection or React error'));
  await page.goto(base); await page.waitForFunction(() => window.fixtureReady && typeof window.configure === 'function');
  return page;
}

test('settings memory reuse stays scoped, refreshes after writes, and never restores a durable settings form', options, async t => {
  const page = await fixture(t), value = context('owner');
  const args = {kind:'salon-profile',salonId:salon};
  await page.evaluate(cfg => window.configure(cfg), {context:value,path:'/settings',foreground:{name:'settings.direct',args},runtime:false});
  await page.getByTestId('foreground').filter({hasText:'settings.direct:'+value.context.scope}).waitFor();
  await page.evaluate(()=>window.configure({foreground:null}));
  await page.getByTestId('foreground').waitFor({state:'detached'});
  await page.evaluate(args=>window.configure({foreground:{name:'settings.direct',args}}),args);
  await page.getByTestId('foreground').filter({hasText:'settings.direct:'+value.context.scope}).waitFor();
  assert.equal(await page.evaluate(()=>window.h.reads.filter(r=>r.name==='settings.direct').length),1,'reopening a recently verified panel reuses its memory snapshot');
  assert.equal(await page.evaluate(()=>window.h.caches.filter(r=>r.name==='settings.direct').length),0,'retention:none never restores a form from native storage');
  await page.evaluate(scope=>window.dispatchEvent(new CustomEvent('reylumi:app-local-command-complete',{detail:{scope,source:'app/settings/direct-settings-actions.ts'}})),value.context.scope);
  await page.waitForFunction(()=>window.h.reads.filter(r=>r.name==='settings.direct').length===2);
  const other=context('owner','b');
  await page.evaluate(cfg=>window.configure(cfg),{context:other,foreground:{name:'settings.direct',args},runtime:false});
  await page.getByTestId('foreground').filter({hasText:'settings.direct:'+other.context.scope}).waitFor();
  assert.equal(await page.evaluate(()=>window.h.reads.filter(r=>r.name==='settings.direct').length),3,'a different account or permission scope cannot borrow the old form');
  await page.evaluate(()=>{window.holdRead('settings.direct',{status:403});void window.foregroundState.refresh();});
  await page.waitForFunction(()=>window.foregroundState.accessDenied===true);
  assert.equal(await page.evaluate(()=>window.foregroundState.data),undefined,'confirmed revocation withdraws cached settings');
});

test('accepted owner, staff and personal plans prepare nearby tabs without hidden UI trees', options, async t => {
  const cases = [
    ['owner', '/staff/today', { name: 'page.owner-today', args: {} }, 'owner.salon-profile'],
    ['staff', '/staff/my-work', { name: 'staff.my-work', args: { staffId: staff } }, 'owner.salon-profile'],
    ['customer', '/explore', { name: 'page.explore', args: { query: '' } }, 'page.beauty'],
  ];
  for (const [kind, path, foreground, last] of cases) {
    const page = await fixture(t), value = context(kind);
    await page.evaluate(cfg => window.configure(cfg), { context: value, path, foreground, runtime: true });
    await page.waitForFunction(name => window.h.reads.some(row => row.name === name), last);
    const reads = await page.evaluate(() => window.h.reads.map(row => row.name));
    if (kind === 'owner') assert.ok(!reads.some(name => /^staff\.|^customer\./.test(name)));
    if (kind === 'customer') assert.ok(!reads.some(name => /^owner\.|^staff\.|page\.owner-/.test(name)));
    if (kind === 'staff') assert.ok(!reads.some(name => name === 'owner.workspace' || name === 'page.owner-payroll'));
    assert.equal(await page.locator('[data-testid=foreground]').count(), 1);
    assert.equal(await page.evaluate(() => window.h.commands.length), 0);
    assert.equal(await page.locator('#root *').count(), 1, 'only the actual selected page mounts');
  }
});

test('startup bounds hidden reads and navigation still opens an unwarmed financial page', options, async t => {
  const page = await fixture(t), value = context('owner');
  await page.evaluate(cfg => window.configure(cfg), { context: value, path: '/staff/today', foreground: { name: 'page.owner-today', args: {} }, runtime: true });
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'owner.salon-profile' && row.finished));
  await page.waitForTimeout(300);
  const hidden = await page.evaluate(() => window.h.reads.filter(row => row.name !== 'page.owner-today').map(row => row.name));
  assert.deepEqual(hidden, ['owner.bookings', 'owner.salon-profile'], 'startup must not drain every role page');
  await page.evaluate(() => { window.dispatchEvent(new Event('reylumi:foreground')); window.dispatchEvent(new Event('online')); });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.h.reads.filter(row => row.name === 'page.owner-payroll').length), 0);
  await page.evaluate(() => window.configure({path:'/payroll', foreground:{name:'page.owner-payroll',args:{tab:'overview'}}}));
  await page.getByTestId('foreground').filter({hasText:'page.owner-payroll:'}).waitFor();
  assert.equal(await page.evaluate(() => window.h.reads.filter(row => row.name === 'page.owner-payroll').length), 1);
  assert.equal(await page.evaluate(() => window.h.commands.length), 0);
});

test('selecting the held preload reuses and promotes its one read', options, async t => {
  const page = await fixture(t), value = context('owner');
  await page.evaluate(() => window.holdRead('owner.bookings'));
  await page.evaluate(cfg => window.configure(cfg), { context: value, path: '/staff/today', foreground: { name: 'page.owner-today', args: { phase: 'shell' } }, runtime: true });
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'owner.bookings'));
  const held = await page.evaluate(() => window.h.reads.find(row => row.name === 'owner.bookings').id);
  await page.evaluate(() => window.configure({ path: '/pos/book', foreground: { name: 'owner.bookings', args: { query: '' } } }));
  await page.waitForFunction(() => window.scheduler.snapshot().some(row => row.key.includes('owner.bookings') && !row.background));
  assert.equal(await page.evaluate(() => window.h.reads.filter(row => row.name === 'owner.bookings').length), 1);
  await page.evaluate(id => window.releaseRead(id, { data: { marker: 'selected-book' } }), held);
  await page.getByTestId('foreground').filter({ hasText: 'selected-book' }).waitFor();
  assert.equal(await page.evaluate(id => window.h.reads.find(row => row.id === id).aborted, held), false);
});

test('a different foreground tab preempts a held speculative transport and ignores its late result', options, async t => {
  const page = await fixture(t), value = context('owner');
  await page.evaluate(() => window.holdRead('owner.bookings', { ignoreAbort: true }));
  await page.evaluate(cfg => window.configure(cfg), { context: value, path: '/staff/today', foreground: { name: 'page.owner-today', args: { phase: 'shell' } }, runtime: true });
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'owner.bookings'));
  const held = await page.evaluate(() => window.h.reads.find(row => row.name === 'owner.bookings').id);
  await page.evaluate(() => window.configure({ path: '/services', foreground: { name: 'page.services' } }));
  await page.getByTestId('foreground').filter({ hasText: 'page.services:' }).waitFor();
  assert.equal(await page.evaluate(id => window.h.reads.find(row => row.id === id).aborted, held), true);
  await page.evaluate(id => window.releaseRead(id, { data: { marker: 'late-book' } }), held);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.match(await page.getByTestId('foreground').innerText(), /^page.services:/);
  assert.notEqual(await page.evaluate(scope => window.cached(scope, 'owner.bookings', { query: '' })?.data.data.marker, value.context.scope), 'late-book');
});

test('aborting the preload consumer preserves a mounted foreground observer of the same read', options, async t => {
  const page = await fixture(t), value = context('owner');
  await page.evaluate(scope => { window.holdRead('owner.bookings'); window.startDirect(scope, 'owner.bookings', { query: '' }); }, value.context.scope);
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'owner.bookings'));
  const held = await page.evaluate(() => window.h.reads.find(row => row.name === 'owner.bookings').id);
  await page.evaluate(cfg => window.configure(cfg), { context: value, path: '/pos/book', foreground: { name: 'owner.bookings', args: { query: '' } }, runtime: false });
  await page.waitForFunction(() => window.scheduler.snapshot().some(row => !row.background));
  await page.evaluate(() => window.direct.controller.abort());
  assert.equal(await page.evaluate(id => window.h.reads.find(row => row.id === id).aborted, held), false);
  await page.evaluate(id => window.releaseRead(id, { data: { marker: 'foreground-owned' } }), held);
  await page.getByTestId('foreground').filter({ hasText: 'foreground-owned' }).waitFor();
  await page.waitForFunction(() => window.direct.settled);
  assert.equal(await page.evaluate(() => window.direct.error?.name), 'AbortError');
});

test('same-scope display lease recovery preserves an unplanned foreground read', options, async t => {
  const page = await fixture(t), initial = context('owner'), recovered = context('owner');
  initial.grant = null;
  await page.evaluate(() => window.holdRead('page.settings'));
  await page.evaluate(cfg => window.configure(cfg), { context: initial, path: '/settings', foreground: { name: 'page.settings' }, runtime: true });
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'page.settings'));
  const held = await page.evaluate(() => window.h.reads.find(row => row.name === 'page.settings').id);
  // Entry keeps this unchanged account/scope mounted when a temporary grant
  // outage recovers. Settings is intentionally outside the background plan.
  await page.evaluate(value => window.configure({ context: value }), recovered);
  const observed = await page.evaluate(id => ({
    aborted: window.h.reads.find(row => row.id === id).aborted,
    reads: window.h.reads.filter(row => row.name === 'page.settings').length,
    visible: document.querySelector('[data-testid=foreground]').textContent,
  }), held);
  assert.equal(observed.aborted, false, JSON.stringify(observed));
  await page.evaluate(id => window.releaseRead(id, { data: { marker: 'settings-after-lease-recovery' } }), held);
  await page.getByTestId('foreground').filter({ hasText: 'settings-after-lease-recovery' }).waitFor();
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'owner.bookings'));
  assert.equal(await page.evaluate(() => window.h.reads.filter(row => row.name === 'page.settings').length), 1);
});

test('account scope switch cancels old work and rejects a transport that resolves late', options, async t => {
  const page = await fixture(t), previous = context('owner', 'a'), next = context('owner', 'b');
  next.context.viewerId = '00000000-0000-4000-8000-000000000005'; next.grant.viewerId = next.context.viewerId;
  await page.evaluate(() => window.holdRead('owner.bookings', { ignoreAbort: true }));
  await page.evaluate(cfg => window.configure(cfg), { context: previous, path: '/staff/today', foreground: { name: 'page.owner-today', args: { phase: 'shell' } }, runtime: true });
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'owner.bookings'));
  const held = await page.evaluate(() => window.h.reads.find(row => row.name === 'owner.bookings').id);
  await page.evaluate(cfg => window.configure(cfg), { context: next, path: '/pos', foreground: { name: 'owner.workspace', args: { query: '' } }, runtime: true });
  await page.getByTestId('foreground').filter({ hasText: next.context.scope }).waitFor();
  await page.evaluate(id => window.releaseRead(id, { data: { marker: 'old-account-secret' } }), held);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(id => window.h.reads.find(row => row.id === id).aborted, held), true);
  assert.ok(!(await page.getByTestId('foreground').innerText()).includes('old-account-secret'));
  assert.equal(await page.evaluate(scope => window.cached(scope, 'owner.bookings', { query: '' })?.data.data.marker, previous.context.scope), undefined);
});

test('an explicit 403 ends the speculative chain across repeated foreground events', options, async t => {
  const page = await fixture(t), value = context('owner');
  await page.evaluate(() => window.holdRead('owner.bookings', { status: 403 }));
  await page.evaluate(cfg => window.configure(cfg), { context: value, path: '/staff/today', foreground: { name: 'page.owner-today', args: { phase: 'shell' } }, runtime: true });
  await page.waitForFunction(() => window.h.reads.some(row => row.status === 403) && window.scheduler.snapshot().length === 0);
  await page.evaluate(() => { window.dispatchEvent(new Event('reylumi:foreground')); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('reylumi:foreground')); });
  await page.waitForTimeout(250);
  const names = await page.evaluate(() => window.h.reads.map(row => row.name));
  assert.ok(!names.includes('owner.salon-profile') && !names.includes('page.owner-payroll'), JSON.stringify(names));
  assert.equal(names.filter(name => name === 'owner.bookings').length, 1);
});

test('held disk hydration cannot gate the foreground online read beyond its short head start', options, async t => {
  const page = await fixture(t), value = context('customer');
  await page.evaluate(() => window.holdCache('page.beauty'));
  await page.evaluate(cfg => window.configure(cfg), { context: value, path: '/beauty', foreground: { name: 'page.beauty' }, runtime: false });
  await page.getByTestId('foreground').filter({ hasText: 'page.beauty:' }).waitFor();
  const facts = await page.evaluate(() => ({ cache: window.h.caches.find(row => row.name === 'page.beauty'), read: window.h.reads.find(row => row.name === 'page.beauty'), held: window.h.cachePending.size }));
  assert.equal(facts.held, 1); assert.equal(facts.cache.finished, false);
  assert.ok(facts.read.started - facts.cache.started >= 45 && facts.read.started - facts.cache.started < 1500, JSON.stringify(facts));
});

test('an unvisited oversize preload does not retain an invisible DTO after bounded cache rejection', options, async t => {
  const page = await fixture(t), value = context('customer');
  await page.evaluate(scope => {
    window.holdRead('page.beauty'); window.startDirect(scope, 'page.beauty');
  }, value.context.scope);
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'page.beauty'));
  await page.evaluate(() => window.releaseRead(window.h.reads.find(row => row.name === 'page.beauty').id, {
    data: { marker: 'unvisited-oversize', padding: 'x'.repeat(3 * 1024 * 1024) },
  }));
  await page.waitForFunction(() => window.direct.settled);
  assert.equal(await page.evaluate(scope => Boolean(window.cached(scope, 'page.beauty')), value.context.scope), false, 'UTF-16 accounting rejects this payload above the 5 MiB cache budget');
  await page.evaluate(() => window.holdRead('page.beauty'));
  await page.evaluate(cfg => window.configure(cfg), { context: value, path: '/beauty', foreground: { name: 'page.beauty' }, runtime: false });
  await page.waitForFunction(() => window.h.reads.filter(row => row.name === 'page.beauty').length === 2);
  assert.equal(await page.getByTestId('foreground').innerText(), 'opening', 'an unmounted preload cell must not preserve data rejected by the bounded cache');
  await page.evaluate(() => window.releaseRead(window.h.reads.filter(row => row.name === 'page.beauty')[1].id, {
    data: { marker: 'mounted-foreground-large', padding: 'x'.repeat(3 * 1024 * 1024) },
  }));
  await page.getByTestId('foreground').filter({ hasText: 'mounted-foreground-large' }).waitFor();
  assert.equal(await page.evaluate(scope => Boolean(window.cached(scope, 'page.beauty')), value.context.scope), false);
});

for (const order of ['before', 'after']) test(`clock-skewed disk arriving ${order} online cannot replace the fresh network DTO`, options, async t => {
  const page = await fixture(t), value = context('customer');
  await page.evaluate(order => { window.holdCache('page.beauty'); if (order === 'before') window.holdRead('page.beauty'); }, order);
  await page.evaluate(cfg => window.configure(cfg), { context: value, path: '/beauty', foreground: { name: 'page.beauty' }, runtime: false });
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'page.beauty'));
  const cacheId = await page.evaluate(() => window.h.caches.find(row => row.name === 'page.beauty').id);
  if (order === 'after') await page.getByTestId('foreground').filter({ hasText: 'page.beauty:' }).waitFor();
  await page.evaluate(id => window.releaseCache(id, { data: { marker: 'skewed-disk' }, revision: 'old-disk', updatedAt: Date.now() + 3600000 }), cacheId);
  if (order === 'before') {
    await page.getByTestId('foreground').filter({ hasText: 'skewed-disk' }).waitFor();
    await page.evaluate(() => window.releaseRead(window.h.reads.find(row => row.name === 'page.beauty').id, { data: { marker: 'network-fresh' }, updatedAt: Date.now() }));
    await page.getByTestId('foreground').filter({ hasText: 'network-fresh' }).waitFor();
  }
  await page.waitForFunction(() => window.h.caches.find(row => row.name === 'page.beauty').finished);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(!(await page.getByTestId('foreground').innerText()).includes('skewed-disk'));
  const saved = await page.evaluate(scope => window.cached(scope, 'page.beauty')?.data, value.context.scope);
  assert.equal(saved.offline, false); assert.ok(!saved.data.marker.includes('skewed-disk'));
});

test('a 304 validation clears a disk clock skew before a later changed network response', options, async t => {
  const page = await fixture(t), value = context('customer');
  await page.evaluate(() => { window.holdCache('page.beauty'); window.holdRead('page.beauty'); });
  await page.evaluate(cfg => window.configure(cfg), { context: value, path: '/beauty', foreground: { name: 'page.beauty' }, runtime: false });
  await page.waitForFunction(() => window.h.reads.some(row => row.name === 'page.beauty'));
  await page.evaluate(() => window.releaseCache(window.h.caches.find(row => row.name === 'page.beauty').id, { data: { marker: 'disk-unchanged' }, revision: 'old-disk', updatedAt: Date.now() + 3600000 }));
  await page.getByTestId('foreground').filter({ hasText: 'disk-unchanged' }).waitFor();
  await page.evaluate(() => window.releaseRead(window.h.reads.find(row => row.name === 'page.beauty').id, { status: 304, data: undefined, etag: 'old-disk', updatedAt: Date.now() }));
  await page.waitForFunction(scope => window.cached(scope, 'page.beauty')?.data.offline === false, value.context.scope);
  assert.ok(await page.evaluate(scope => window.cached(scope, 'page.beauty').data.updatedAt <= Date.now(), value.context.scope));
  await page.evaluate(() => { window.holdRead('page.beauty'); void window.foregroundState.refresh(); });
  await page.waitForFunction(() => window.h.reads.filter(row => row.name === 'page.beauty').length === 2);
  await page.evaluate(() => window.releaseRead(window.h.reads.filter(row => row.name === 'page.beauty').at(-1).id, { data: { marker: 'later-network-change' }, updatedAt: Date.now() }));
  await page.getByTestId('foreground').filter({ hasText: 'later-network-change' }).waitFor();
});

test('workspace gesture stops old speculative HTTP before command preflight; foreground and new identity continue', options, async t => {
  const page=await fixture(t), previous=context('owner'), next=context('staff','b');
  await page.evaluate(()=>window.holdRead('owner.bookings',{ignoreAbort:true}));
  await page.evaluate(cfg=>window.configure(cfg),{context:previous,path:'/staff/today',foreground:{name:'page.owner-today',args:{}},runtime:true});
  await page.waitForFunction(()=>h.reads.some(r=>r.name==='owner.bookings'));
  await page.evaluate(scope=>window.dispatchEvent(new CustomEvent('reylumi:app-local-workspace-start',{detail:{scope}})),previous.context.scope);
  await page.waitForFunction(()=>h.reads.find(r=>r.name==='owner.bookings').aborted);
  const count=await page.evaluate(()=>h.reads.length);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>h.reads.length),count);
  await page.evaluate(()=>window.configure({path:'/customers',foreground:{name:'page.owner-customers'}}));
  await page.getByTestId('foreground').filter({hasText:'page.owner-customers:'+previous.context.scope}).waitFor();
  await page.evaluate(cfg=>window.configure(cfg),{context:next,path:'/staff/my-work',foreground:{name:'staff.my-work',args:{staffId:staff}},runtime:true});
  await page.getByTestId('foreground').filter({hasText:'staff.my-work:'+next.context.scope}).waitFor();
  await page.waitForFunction(scope=>h.reads.some(r=>r.scope===scope&&r.name==='staff.schedule'),next.context.scope);
  assert.deepEqual(await page.evaluate(()=>h.commands),[]);
});
