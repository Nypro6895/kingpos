import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import ts from 'typescript';

// Real production resource/cache, Payroll argument resolver, period links and
// prefetch runtime. Only host IO is synthetic; this is not physical-iOS QA or
// a test of the full Payroll financial view/calculator.
const browserPath = process.env.TEST_BROWSER_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const options = { skip: !browserPath, timeout: 30_000 };
const scopeA = 'v3:' + 'a'.repeat(64), scopeB = 'v3:' + 'b'.repeat(64);
const november = { cycleType: 'monthly', startDate: '2026-11-01', endDate: '2026-11-30', preset: 'current_month', label: 'November' };
const december = { ...november, startDate: '2026-12-01', endDate: '2026-12-31', label: 'December' };
let browser, server, base;

function registryDefinition(name) {
  const file = 'lib/app-local-owner-page-registry.tsx';
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statement = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === name));
  assert.ok(statement, 'production registry definition must exist: ' + name);
  return statement.getText(ast);
}

function ownerContext(scope = scopeA) {
  const now = Date.now();
  const identity = { scope, viewerId: '00000000-0000-4000-8000-000000000001', salonId: '00000000-0000-4000-8000-000000000002', workspaceId: 'fixture-workspace', permissionRevision: 'r1', authenticated: true };
  return {
    schemaVersion: 1, context: identity, onlineValidatedAt: now,
    display: { name: 'Synthetic QA', role: 'Owner', language: 'en' },
    access: { ownerWorkspace: true, staffWorkspace: false },
    grant: { version: 1, ...identity, scopes: [scope], generation: 'generation-0000000001', grantRevision: 'r1', issuedAt: now - 100, expiresAt: now + 3_600_000, kind: 'owner', path: '/payroll' },
  };
}

before(async () => {
  if (!browserPath) return;
  const root = resolve('.').replaceAll('\\', '/');
  const bundle = await build({
    stdin: { loader: 'tsx', resolveDir: root, contents: `
      import React,{useState,useEffect,useLayoutEffect} from 'react';
      import{createRoot}from'react-dom/client';
      import{useAppLocalResource,peekAppLocalResource,seedAppLocalResource,resetAppLocalResources}from'./lib/app-local-resource';
      import{appLocalPayrollReadArgs}from'./lib/app-local-payroll-read';
      import{DEFAULT_PAYROLL_READ_ARGS}from'./lib/app-local-payroll-read';
      import{payrollReadArgs}from'./lib/payroll-read-args';
      import{payrollPeriodHref}from'./lib/payroll-period-rail';
      import{useAppLocalPrefetch}from'./lib/app-local-prefetch';
      const h=window.h={reads:[],caches:[],commands:[],states:[],committedPeriods:[],rules:[],pending:new Map(),serial:0,payrollVersion:0,defaultPeriod:${JSON.stringify(november)}};
      window.__reylumiAppLocalContext={generation:'generation-0000000001',scopeEpoch:1,nonce:'fixture'};
      function periodFor(args){
        if(args.start&&args.end)return{...h.defaultPeriod,startDate:args.start,endDate:args.end,cycleType:'custom',preset:'custom'};
        if(args.month){const[y,m]=args.month.split('-').map(Number);return{...h.defaultPeriod,startDate:args.month+'-01',endDate:args.month+'-'+new Date(Date.UTC(y,m,0)).getUTCDate(),preset:args.preset??'current_month'};}
        return structuredClone(h.defaultPeriod);
      }
      const response=row=>({schemaVersion:1,status:200,scope:row.scope,etag:'read-'+row.id,updatedAt:Date.now(),offline:false,data:{payroll:{period:row.period},version:row.version,scope:row.scope}});
      window.holdRead=(extra={})=>h.rules.push({remaining:1,...extra});
      window.releaseRead=id=>{const held=h.pending.get(id);if(!held)throw Error('No held Payroll read '+id);h.pending.delete(id);held.resolve(response(held.row));};
      window.rejectRead=(id,status)=>{const held=h.pending.get(id);if(!held)throw Error('No held Payroll read '+id);h.pending.delete(id);held.reject(Object.assign(new Error('Synthetic denial'),{status}));};
      window.host={isNative:true,
        read(name,args={},options={}){
          const row={id:++h.serial,name,args,scope:options.scope,period:periodFor(args),version:name==='page.owner-payroll'?++h.payrollVersion:0,finished:false,aborted:false};h.reads.push(row);
          const rule=name==='page.owner-payroll'?h.rules.find(r=>r.remaining>0&&(!r.scope||r.scope===options.scope)&&(!r.args||Object.entries(r.args).every(([key,value])=>args[key]===value))):null;if(rule)rule.remaining--;
          return new Promise((resolve,reject)=>{
            const abort=()=>{row.aborted=true;if(!rule?.ignoreAbort){row.finished=true;reject(new DOMException('Read cancelled','AbortError'));}};
            options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
            if(rule?.status){row.finished=true;reject(Object.assign(new Error('Synthetic denial'),{status:rule.status}));}
            else if(rule)h.pending.set(row.id,{row,resolve:value=>{row.finished=true;resolve(value);},reject:error=>{row.finished=true;reject(error);}});
            else{row.finished=true;resolve(response(row));}
          });
        },
        cache(operation,args){h.caches.push({operation,...args});return Promise.resolve(null);},
        command(name,args){h.commands.push({name,args});throw Error('Business writes are forbidden in this fixture');},
        openOnline(){throw Error('External navigation is forbidden in this fixture');}
      };
      const WorkspaceText=({text})=>text,LumiLoadingStatus=()=> <p>Loading</p>;
      const getAppLocalHost=()=>window.host;
      const PayrollRefreshProvider=({refresh,children})=>{window.registryRefresh=refresh;return children;};
      const AppLocalOwnerPayrollView=({value,params})=><FixturePayrollBody value={value} tab={params.tab??'shop'}/>;
      ${['urlFor', 'query', 'Read', 'PayrollPending', 'PayrollPage'].map(registryDefinition).join('\n')}
      function FixturePayrollBody({value,tab}){
        useLayoutEffect(()=>{h.committedPeriods.push(value.payroll.period.startDate);},[value]);
        return <>
        <nav>{['shop','gifts','rewards','discounts','staff','tax','tools','analytics'].map(tab=><a key={tab} data-testid={'tab-'+tab} href={payrollPeriodHref(value.payroll.period,tab)} onClick={e=>{e.preventDefault();window.configure({path:e.currentTarget.getAttribute('href')});}}>{tab}</a>)}</nav>
        <output data-testid='content'>{tab+'|'+value.payroll.period.startDate+'|'+value.version+'|'+value.scope}</output>
        {tab==='shop'&&<input data-testid='financial-draft' aria-label='Synthetic unsaved financial draft' defaultValue=''/>}
      </>;}
      // Representative view only: production hook/helper and real period hrefs
      // exercise read ownership without stubbing the wage/financial components.
      function Payroll({value,path}){
        const scope=value.context.scope;
        useAppLocalResource(scope,'page.owner-payroll',{tab:'shop'},{enabled:false});
        const args=appLocalPayrollReadArgs(scope,path);
        const state=useAppLocalResource(scope,'page.owner-payroll',args,{enabled:value.access.ownerWorkspace});
        window.state=state;
        const tab=new URL(path,location.origin).searchParams.get('tab')??'shop';
        useEffect(()=>{h.states.push({path,args,data:state.data?.payroll.period.startDate,updatedAt:state.updatedAt,refreshing:state.refreshing,error:state.error});},[path,state.data,state.updatedAt,state.refreshing,state.error]);
        return <main><h1>Payroll read fixture</h1>{state.data?<>
          <nav>{['shop','gifts','rewards','discounts','staff','tax','tools','analytics'].map(tab=><a key={tab} data-testid={'tab-'+tab} href={payrollPeriodHref(state.data.payroll.period,tab)} onClick={e=>{e.preventDefault();window.configure({path:e.currentTarget.getAttribute('href')});}}>{tab}</a>)}</nav>
          <output data-testid='content'>{tab+'|'+state.data.payroll.period.startDate+'|'+state.data.version+'|'+state.data.scope}</output>
        </>:<output data-testid='pending'>{state.error?'error':'pending'}</output>}</main>;
      }
      function Runtime({value,path}){useAppLocalPrefetch(value,path);return null;}
      function App(){
        const[cfg,set]=useState({value:null,path:'/payroll',runtime:false,show:true,registry:false});
        window.configure=next=>set(old=>{const updated={...old,...next};history.replaceState({},'',updated.path);return updated;});
        return <>{cfg.value&&cfg.show?(cfg.registry?<PayrollPage context={cfg.value} path={cfg.path} navigate={path=>window.configure({path})}/>:<Payroll value={cfg.value} path={cfg.path}/>):null}{cfg.value&&cfg.runtime?<Runtime value={cfg.value} path={cfg.path}/>:null}</>;
      }
      window.peek=(scope,args={tab:'shop'})=>peekAppLocalResource(scope,'page.owner-payroll',args);
      window.seedPayroll=(scope,args,snapshot)=>seedAppLocalResource(scope,'page.owner-payroll',args,snapshot);
      window.argsFor=(scope,path)=>appLocalPayrollReadArgs(scope,path);
      window.periodHref=payrollPeriodHref;
      window.resetReads=resetAppLocalResources;
      createRoot(document.getElementById('root')).render(<App/>);window.fixtureReady=true;
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    plugins: [{ name: 'payroll-native-boundaries', setup(b) {
      b.onResolve({ filter: /\/(app-local-host|experience-persistent-cache)$/ }, a => ({ path: a.path.split('/').at(-1), namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'app-local-host'
        ? 'export const getAppLocalHost=()=>window.host;'
        : 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};' }));
    } }],
  });
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
});

after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function fixture(t, { runtime = false, hold, registry = false, start = true } = {}) {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { try { assert.deepEqual(errors, []); assert.equal(await page.evaluate(() => h.commands.length), 0); } finally { await page.close(); } });
  // Install before modules capture Date.now; only clock age is controlled, not
  // action/snapshot latency or timers. No 30-second sleep is necessary.
  await page.addInitScript(() => { const realNow = Date.now; window.clockOffset = 0; Date.now = () => realNow() + window.clockOffset; });
  await page.goto(base); await page.waitForFunction(() => window.fixtureReady && typeof window.configure === 'function');
  if (hold) await page.evaluate(rule => window.holdRead(rule), hold);
  if (start) await page.evaluate(cfg => window.configure(cfg), { value: ownerContext(), path: '/payroll', runtime, registry });
  return page;
}
const payrollReads = page => page.evaluate(() => h.reads.filter(row => row.name === 'page.owner-payroll'));
const content = (page, tab = 'shop', date = november.startDate, scope = scopeA) => page.getByTestId('content').filter({ hasText: new RegExp('^' + tab + '\\|' + date + '\\|\\d+\\|' + scope + '$') }).waitFor();

test('default period to real Gift/Rewards/Discount links shares one fresh read with runtime prefetch', options, async t => {
  const page = await fixture(t, { runtime: true }); await content(page);
  const initial = await page.evaluate(scope => window.peek(scope), scopeA);
  const href = await page.getByTestId('tab-gifts').getAttribute('href');
  assert.match(href, /preset=current_month/); assert.match(href, /month=2026-11/);
  for (const tab of ['gifts', 'rewards', 'discounts', 'shop']) {
    await page.getByTestId('tab-' + tab).click(); await content(page, tab);
    await page.waitForTimeout(220); // includes the real 150ms speculative queue.
  }
  const reads = await payrollReads(page);
  assert.equal(reads.length, 1, 'neither the selected view nor prefetch may reread an already accepted period');
  assert.deepEqual(reads[0].args, { tab: 'shop' });
  const final = await page.evaluate(scope => window.peek(scope), scopeA);
  assert.equal(final.updatedAt, initial.updatedAt); assert.equal(final.verifiedAt, initial.verifiedAt, 'tab changes cannot renew validation time');
  assert.deepEqual(await page.evaluate(() => h.states.filter(s => s.path !== '/payroll' && !s.data)), [], 'the cached tab transition must not go through pending');
});

test('a different explicit period keeps its own pending read and correct returned date', options, async t => {
  const page = await fixture(t); await content(page);
  await page.evaluate(period => { window.holdRead(); window.configure({ path: window.periodHref(period, 'gifts') }); }, december);
  await page.getByTestId('pending').waitFor(); await page.waitForFunction(() => h.pending.size === 1);
  const reads = await payrollReads(page);
  assert.equal(reads.length, 2); assert.equal(reads[1].args.month, '2026-12'); assert.equal(reads[1].args.tab, 'shop');
  await page.evaluate(id => window.releaseRead(id), reads[1].id); await content(page, 'gifts', december.startDate);
  assert.equal(await page.evaluate(scope => window.peek(scope).data.payroll.period.startDate, scopeA), november.startDate);
});

test('tab reuse preserves timestamps and an aged snapshot still revalidates after 30 seconds', options, async t => {
  const page = await fixture(t); await content(page);
  const initial = await page.evaluate(scope => window.peek(scope), scopeA);
  await page.evaluate(() => { window.clockOffset = 29_000; });
  await page.getByTestId('tab-gifts').click(); await content(page, 'gifts');
  assert.equal((await payrollReads(page)).length, 1);
  assert.equal(await page.evaluate(scope => window.peek(scope).verifiedAt, scopeA), initial.verifiedAt);
  await page.evaluate(() => { window.clockOffset = 31_000; window.holdRead(); window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => h.pending.size === 1);
  assert.equal((await payrollReads(page)).length, 2, 'the original freshness deadline still owns revalidation');
  await content(page, 'gifts');
  const held = (await payrollReads(page)).at(-1);
  await page.evaluate(id => window.releaseRead(id), held.id);
  await page.waitForFunction(() => window.state.data?.version === 2 && !window.state.refreshing);
  assert.ok(await page.evaluate(scope => window.peek(scope).verifiedAt, scopeA) > initial.verifiedAt);
});

test('a renewed default period updates aliases without copying or revalidating the old period', options, async t => {
  const page = await fixture(t); await content(page);
  await page.evaluate(async period => { h.defaultPeriod = period; await window.state.refresh(); }, december);
  await content(page, 'shop', december.startDate);
  const args = await page.evaluate(({ scope, old, next }) => ({ old: window.argsFor(scope, window.periodHref(old, 'gifts')), next: window.argsFor(scope, window.periodHref(next, 'gifts')) }), { scope: scopeA, old: november, next: december });
  assert.equal(args.old.month, '2026-11'); assert.deepEqual(args.next, { tab: 'shop' });
  await page.evaluate(() => window.configure({ runtime: true }));
  await page.getByTestId('tab-gifts').click(); await content(page, 'gifts', december.startDate); await page.waitForTimeout(250);
  assert.equal((await payrollReads(page)).length, 2, 'the new default period and its Gift link reuse the renewed cell');
});

test('confirmed denial withdraws the alias and another scope cannot borrow its default', options, async t => {
  const page = await fixture(t); await content(page);
  await page.evaluate(async () => { window.holdRead({ status: 403 }); await window.state.refresh(); });
  await page.waitForFunction(() => window.state.accessDenied === true);
  const denied = await page.evaluate(({ scope, period }) => ({ data: window.peek(scope)?.data, args: window.argsFor(scope, window.periodHref(period, 'gifts')) }), { scope: scopeA, period: november });
  assert.equal(denied.data, undefined); assert.equal(denied.args.month, '2026-11');
  await page.evaluate(({ value, period }) => window.configure({ value, path: window.periodHref(period, 'gifts') }), { value: ownerContext(scopeB), period: november });
  await content(page, 'gifts', november.startDate, scopeB);
  const other = (await payrollReads(page)).filter(row => row.scope === scopeB);
  assert.equal(other.length, 1); assert.equal(other[0].args.month, '2026-11', 'scope B has no accepted default-period alias');
});

test('scope reset rejects an old ignored-abort reply and read-only lookup cannot restore it', options, async t => {
  const page = await fixture(t, { hold: { ignoreAbort: true } });
  await page.waitForFunction(() => h.pending.size === 1);
  const old = (await payrollReads(page))[0];
  await page.evaluate(({ oldScope, value, period }) => { window.resetReads(oldScope); window.configure({ value, path: window.periodHref(period, 'gifts') }); }, { oldScope: scopeA, value: ownerContext(scopeB), period: november });
  await content(page, 'gifts', november.startDate, scopeB);
  await page.evaluate(id => window.releaseRead(id), old.id); await page.waitForTimeout(120);
  await content(page, 'gifts', november.startDate, scopeB);
  assert.equal(await page.evaluate(scope => window.peek(scope), scopeA), undefined);
  const before = await page.evaluate(() => ({ reads: h.reads.length, caches: h.caches.length }));
  const args = await page.evaluate(({ scope, period }) => window.argsFor(scope, window.periodHref(period, 'gifts')), { scope: scopeA, period: november });
  assert.equal(args.month, '2026-11');
  assert.deepEqual(await page.evaluate(() => ({ reads: h.reads.length, caches: h.caches.length })), before, 'peek/resolution cannot create host IO');
});

test('Staff, Tax, Tools and Analytics retain distinct transport reads', options, async t => {
  const page = await fixture(t); await content(page);
  for (const tab of ['staff', 'tax', 'tools', 'analytics']) {
    await page.getByTestId('tab-' + tab).click(); await content(page, tab);
  }
  const reads = await payrollReads(page);
  assert.equal(reads.length, 5);
  assert.deepEqual(reads.map(row => row.args.tab), ['shop', 'staff', 'tax', 'tools', 'analytics']);
  assert.ok(reads.slice(1).every(row => row.args.month === '2026-11' && row.args.preset === 'current_month'));
});

test('production PayrollPage wiring reuses the accepted default and keeps real pending/authorization boundaries', options, async t => {
  const page = await fixture(t, { runtime: true, registry: true }); await content(page);
  await page.getByTestId('tab-gifts').click(); await content(page, 'gifts'); await page.waitForTimeout(250);
  assert.equal((await payrollReads(page)).length, 1, 'actual PayrollPage reference must alias the generated Gift href');
  assert.equal(await page.locator('[data-payroll-pending]').count(), 0);
  await page.evaluate(period => { window.holdRead(); window.configure({ path: window.periodHref(period, 'gifts') }); }, december);
  await page.locator('[data-payroll-pending][aria-busy=true]').waitFor();
  assert.equal(await page.getByTestId('content').count(), 0, 'a different period cannot render the old financial DTO');
  await page.waitForFunction(() => h.pending.size === 1);
  await page.evaluate(id => window.releaseRead(id), (await payrollReads(page)).at(-1).id);
  await content(page, 'gifts', december.startDate);
  const value = ownerContext(); value.access.ownerWorkspace = false;
  await page.evaluate(value => window.configure({ value, runtime: false }), value);
  await page.getByText('Open this page from a Business workspace.', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('content').count(), 0, 'an unavailable workspace never exposes retained financial content');
  assert.equal((await payrollReads(page)).length, 2);
});

test('production explicit Shop keeps the same unsaved input when its default-period alias rolls over', options, async t => {
  const page = await fixture(t, { registry: true }); await content(page);
  await page.getByTestId('tab-shop').click(); await content(page);
  assert.match(new URL(page.url()).search, /month=2026-11/);
  assert.equal((await payrollReads(page)).length, 1, 'explicit Shop A initially aliases the accepted default A');
  await page.getByTestId('financial-draft').fill('QA draft A');
  await page.evaluate(() => { window.originalDraftNode = document.querySelector('[data-testid=financial-draft]'); });
  await page.evaluate(async period => {
    h.committedPeriods = [];
    h.defaultPeriod = period;
    window.holdRead({ args: { month: '2026-11' } });
    await window.registryRefresh();
  }, december);
  await page.waitForFunction(() => h.pending.size === 1);
  const pending = await page.evaluate(() => {
    const input = document.querySelector('[data-testid=financial-draft]');
    return { committedPeriods: h.committedPeriods, content: document.querySelector('[data-testid=content]')?.textContent ?? null, inputMounted: Boolean(input), sameInputNode: input === window.originalDraftNode, draft: input?.value ?? null };
  });
  assert.ok(!pending.committedPeriods.includes(december.startDate), 'a default refresh for period B must never commit B under the explicit period-A URL');
  assert.deepEqual({ inputMounted: pending.inputMounted, sameInputNode: pending.sameInputNode, draft: pending.draft }, { inputMounted: true, sameInputNode: true, draft: 'QA draft A' }, 'default-period rollover must preserve the existing financial editor DOM and unsaved draft while the explicit A read is pending');
  assert.match(pending.content, /^shop\|2026-11-01\|/);
  const held = (await payrollReads(page)).at(-1);
  assert.equal(held.args.month, '2026-11');
  await page.evaluate(id => window.releaseRead(id), held.id); await content(page);
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid=financial-draft]') === window.originalDraftNode), true);
  assert.equal(await page.getByTestId('financial-draft').inputValue(), 'QA draft A');
  assert.equal(await page.evaluate(() => h.committedPeriods.includes('2026-12-01')), false);
});

async function mountedRolloverFallback(page) {
  await content(page); await page.getByTestId('tab-shop').click(); await content(page);
  await page.getByTestId('financial-draft').fill('QA draft A');
  await page.evaluate(async period => {
    window.originalDraftNode = document.querySelector('[data-testid=financial-draft]');
    h.committedPeriods = []; h.defaultPeriod = period;
    window.holdRead({ args: { month: '2026-11' }, ignoreAbort: true });
    await window.registryRefresh();
  }, december);
  await page.waitForFunction(() => h.pending.size === 1);
  await content(page);
  assert.equal(await page.getByTestId('financial-draft').inputValue(), 'QA draft A');
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid=financial-draft]') === window.originalDraftNode), true);
  return (await payrollReads(page)).at(-1).id;
}

test('production rollover fallback withdraws the editor immediately when its explicit read is denied', options, async t => {
  const page = await fixture(t, { registry: true });
  const held = await mountedRolloverFallback(page);
  await page.evaluate(id => window.rejectRead(id, 403), held);
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByTestId('content').count(), 0);
  assert.equal(await page.getByTestId('financial-draft').count(), 0, '403 must override the accepted period-A fallback');
  assert.equal(await page.evaluate(() => window.originalDraftNode.isConnected), false);
  assert.equal(await page.evaluate(() => h.committedPeriods.includes('2026-12-01')), false);
  // A harmless same-path render must not resurrect the captured fallback.
  await page.evaluate(() => window.configure({}));
  assert.equal(await page.getByTestId('financial-draft').count(), 0);
});

test('production rollover fallback withdraws its draft on resource reset or lost Owner access before any new reply', options, async t => {
  for (const action of ['reset', 'owner-unavailable']) {
    const page = await fixture(t, { registry: true });
    const oldHeld = await mountedRolloverFallback(page);
    if (action === 'reset') {
      await page.evaluate(scope => { window.holdRead({ args: { month: '2026-11' } }); window.resetReads(scope); }, scopeA);
      await page.locator('[data-payroll-pending][aria-busy=true]').waitFor();
      await page.waitForFunction(() => h.reads.filter(row => row.name === 'page.owner-payroll' && row.args.month === '2026-11').length === 2);
    } else {
      const value = ownerContext(); value.access.ownerWorkspace = false;
      await page.evaluate(value => window.configure({ value }), value);
      await page.getByText('Open this page from a Business workspace.', { exact: true }).waitFor();
    }
    assert.equal(await page.getByTestId('content').count(), 0, action + ' withdraws financial content while replies are held');
    assert.equal(await page.getByTestId('financial-draft').count(), 0, action + ' withdraws the unsaved fallback editor');
    assert.equal(await page.evaluate(() => window.originalDraftNode.isConnected), false);
    await page.evaluate(id => window.releaseRead(id), oldHeld); await page.waitForTimeout(100);
    assert.equal(await page.getByTestId('financial-draft').count(), 0, action + ' cannot restore the old editor from a late reply');
    if (action === 'reset') {
      const freshHeld = (await payrollReads(page)).at(-1);
      assert.notEqual(freshHeld.id, oldHeld);
      await page.evaluate(id => window.releaseRead(id), freshHeld.id); await content(page);
      assert.equal(await page.getByTestId('financial-draft').inputValue(), '', 'only the fresh admitted read may mount a new editor after reset');
      assert.equal(await page.evaluate(() => document.querySelector('[data-testid=financial-draft]') === window.originalDraftNode), false);
    }
  }
});

test('legacy Gift bootstrap seeds satisfy cold production Gift entry without merging Staff or Tax snapshots', options, async t => {
  const page = await fixture(t, { start: false });
  const seeded = await page.evaluate(({ scope, period }) => {
    const rows = ['gifts', 'staff', 'tax'].map((tab, index) => {
      const path = window.periodHref(period, tab);
      const args = Object.fromEntries(new URL(path, location.origin).searchParams);
      const snapshot = { schemaVersion: 1, status: 200, scope, etag: 'legacy-' + tab, updatedAt: Date.now() - 100, offline: false, data: { payroll: { period }, version: 401 + index, scope } };
      window.seedPayroll(scope, args, snapshot);
      return { path, args, snapshot };
    });
    return rows;
  }, { scope: scopeA, period: november });
  assert.deepEqual(seeded.map(row => row.args.tab), ['gifts', 'staff', 'tax'], 'incoming bootstrap labels are not mutated');
  const unseededDefault = await page.evaluate(scope => window.peek(scope), scopeA);
  assert.equal(unseededDefault?.data, undefined, 'an explicit bootstrap row must not fabricate a default-period snapshot');
  await page.evaluate(cfg => window.configure(cfg), { value: ownerContext(), path: seeded[0].path, registry: true, runtime: true });
  await content(page, 'gifts'); await page.waitForTimeout(300);
  assert.match(await page.getByTestId('content').textContent(), /\|401\|/);
  assert.equal((await payrollReads(page)).length, 0, 'the cold Gift page and prefetch reuse the old host bootstrap DTO');
  const canonical = { ...seeded[0].args, tab: 'shop' };
  const giftSnapshot = await page.evaluate(({ scope, args }) => window.peek(scope, args), { scope: scopeA, args: canonical });
  assert.equal(giftSnapshot.updatedAt, seeded[0].snapshot.updatedAt);
  assert.equal(giftSnapshot.etag, seeded[0].snapshot.etag);
  assert.equal(await page.evaluate(({ scope, args }) => window.peek(scope, args), { scope: scopeA, args: seeded[0].args }), undefined, 'legacy Gift does not create a second resource cell');
  for (const [tab, version] of [['staff', 402], ['tax', 403]]) {
    const original = seeded.find(row => row.args.tab === tab);
    const snapshot = await page.evaluate(({ scope, args }) => window.peek(scope, args), { scope: scopeA, args: original.args });
    assert.equal(snapshot.data.version, version); assert.equal(snapshot.updatedAt, original.snapshot.updatedAt);
    await page.getByTestId('tab-' + tab).click(); await content(page, tab);
    assert.match(await page.getByTestId('content').textContent(), new RegExp('\\|' + version + '\\|'));
  }
  assert.equal((await payrollReads(page)).length, 0, 'the distinct Staff and Tax bootstrap reads stay available under their original keys');
});
