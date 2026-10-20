import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = engine === 'chromium' && !existsSync(browserPath);
const baseline = process.env.TEST_TODAY_BASELINE === '1';
const artifacts = path.resolve(process.env.TODAY_NATIVE_ARTIFACT_DIR || 'artifacts/today-native-admission-20261019');
const outcomes = [];
const phases = ['shell', 'staff', 'bookings', 'waiting', 'financials', 'extras'];
let browserPromise, bundlePromise;

// The native scope provider, admission policy, host request fences, resource
// cells, durable-cache policy and read engine are real. Only the native bridge
// endpoint and the dashboard's visual surface are replaced with synthetic data.
async function bundle() {
  return bundlePromise ??= build({
    stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React,{Activity,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ExperienceScopeProvider,useExperienceScope} from './app/local-app/scope';
      import {AppLocalTodayClient} from './app/staff/today/today-progressive-client';
      import {refreshAppLocalResource} from './lib/app-local-resource';

      const scope='v3:'+'a'.repeat(64),date='2026-10-19';
      const generation='native-today-fixture-generation-20261019';
      const context={scope,viewerId:'00000000-0000-4000-8000-000000000001',workspaceId:'fixture-owner-workspace',salonId:'00000000-0000-4000-8000-000000000002',permissionRevision:'fixture-owner-v1',authenticated:true};
      const keys=['canViewBookings','canViewDashboard','canViewReports','canViewStaffFinancials','canViewTickets'];
      const all=['staff','bookings','waiting','financials','extras'];
      const durable=new Map();
      const trace=window.fixtureTrace=[];
      window.fixtureState={permissions:Object.fromEntries(keys.map(key=>[key,true])),shuffle:window.fixtureOptions.shuffle!==false,shellOrder:0,validation:'valid',holdValidation:false,holds:new Set(window.fixtureOptions.holdFinancial?['financials']:[]),version:'initial'};
      const state=window.fixtureState;
      let clock=Date.now();
      const now=()=>clock=Math.max(Date.now(),clock+1);
      const cacheKey=(scope,args)=>JSON.stringify([scope,args.date||date,args.phase]);
      window.__reylumiAppLocalContext={version:1,nonce:'00000000-0000-4000-8000-000000000003',scopeEpoch:1,generation};
      const orderedPermissions=(phase)=>{
        const offset=phase==='shell'?state.shellOrder:all.indexOf(phase)+1;
        const order=state.shuffle?keys.slice(offset%keys.length).concat(keys.slice(0,offset%keys.length)):keys;
        return Object.fromEntries(order.map(key=>[key,state.permissions[key]]));
      };
      function dashboard(phase){
        const metric=value=>({label:'Synthetic fixture',value,href:null,chart:null,detail:null});
        return {date,timezone:'UTC',salonName:'Synthetic Owner Salon',generatedAt:new Date(now()).toISOString(),noAccess:false,permissions:orderedPermissions(phase),
          dayView:{isCurrentDate:true,currentDate:date,selectedDate:date},loadErrors:[],attention:[],businessHours:{},
          summary:{staff:metric(phase==='staff'?'3':'--'),customers:metric(phase==='bookings'?'4':'--'),waiting:metric(phase==='waiting'?'2':'--'),sales:metric(phase==='financials'?state.version+' authorized sales':'--')},
          rightNow:{scheduleHref:null,upcomingBookings:[],waitingClients:[]},performance:{bookingStatus:[]},team:[],
          quickAccesses:{available:[],selected:[],canCustomize:true,maxSelected:8},pendingSections:{sections:all,metrics:['staff','customers','waiting','sales'],details:true}};
      }
      window.__reylumiAppLocalTransport={request:async request=>{
        const {kind,name,args}=request;
        if(kind==='context'){
          const row={kind,fresh:args.fresh===true,path:args.path,mode:state.validation};trace.push(row);
          const issuedAt=Date.now()-1000;
          const value={schemaVersion:1,context:{...context},grant:{version:1,scope,scopes:[scope],viewerId:context.viewerId,workspaceId:context.workspaceId,salonId:context.salonId,grantRevision:context.permissionRevision,generation,issuedAt,expiresAt:issuedAt+3600000,path:'/staff/today',kind:'owner'},grantStatus:200,
            access:{ownerWorkspace:true,staffWorkspace:false},display:{name:'Synthetic Owner Salon',role:'owner',language:'en'},onlineValidatedAt:Date.now(),offline:false};
          if(state.validation==='denied')value.grantStatus=403;
          if(state.validation==='unconfirmed')value.offlineState='unconfirmed';
          if(state.validation==='staff-only'){value.grant=null;value.grantStatus=503;value.access={ownerWorkspace:false,staffWorkspace:true};}
          if(state.validation==='other-viewer')value.context.viewerId='00000000-0000-4000-8000-000000000099';
          if(state.validation==='other-scope')value.context.scope='v3:'+'b'.repeat(64);
          if(state.validation==='cached')value.offline=true;
          if(state.validation==='online-only'){value.grant=null;value.grantStatus=503;}
          if(state.holdValidation)await new Promise(resolve=>window.releaseValidation=resolve);
          row.settled=true;
          return value;
        }
        if(kind==='cache'){
          const key=cacheKey(args.scope,args.arguments||{});
          trace.push({kind,op:args.op,phase:args.arguments?.phase,scope:args.scope});
          if(args.op==='remove'){durable.delete(key);return {ok:true};}
          if(args.op==='get')return durable.get(key)||null;
          throw Error('Unexpected synthetic cache operation');
        }
        if(kind==='read'){
          if(name!=='page.owner-today')throw Error('Unexpected private resource');
          const row={kind,name,scope:args.scope,phase:args.phase,date:args.date,order:orderedPermissions(args.phase),version:state.version};trace.push(row);
          const value={schemaVersion:1,status:200,scope:args.scope,etag:'fixture-'+now(),updatedAt:now(),data:{dashboard:dashboard(args.phase),isOwner:true}};
          if(state.holds.has(args.phase))await new Promise(resolve=>(window.pendingReads??=[]).push({phase:args.phase,resolve}));
          durable.set(cacheKey(args.scope,args),value);
          row.settled=true;return value;
        }
        throw Error('Commands and external transport are forbidden in this fixture');
      }};
      window.releaseRead=phase=>{state.holds.delete(phase);for(const item of window.pendingReads||[])if(item.phase===phase)item.resolve();};
      window.refreshPhase=phase=>refreshAppLocalResource(scope,'page.owner-today',{date,phase});
      window.refreshShell=()=>{state.shuffle=true;state.shellOrder++;return window.refreshPhase('shell');};
      function Probe(){const gate=useExperienceScope();window.nativeValidationRevision=()=>gate.getValidationRevision();return <output data-validation-revision>{gate.validationRevision}</output>;}
      function App(){const[visible,show]=useState(true);window.showToday=show;return <Activity mode={visible?'visible':'hidden'}><ExperienceScopeProvider context={context} guardForms={false}><Probe/><AppLocalTodayClient scope={scope} requestedDate={date}/></ExperienceScopeProvider></Activity>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'real-native-admission-test', setup(builder) {
      // Match the installed bundle's exact alias. This is deliberately not a
      // stub validate() callback: Today and Probe share the real provider.
      builder.onResolve({ filter: /^@\/components\/experience-scope$/ }, () => ({ path: path.resolve('app/local-app/scope.tsx') }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.resolve('app/local-app/navigation.tsx') }));
      builder.onResolve({ filter: /(?:^|\/)today-dashboard-view$/ }, () => ({ path: 'visual-probe', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: process.cwd(), loader: 'tsx', contents: `
        import React from 'react';
        export function TodayDashboardView({dashboard}){return <main data-today-dashboard="owner-manager"><p data-sales>{dashboard.summary.sales.value}</p><p data-pending>{dashboard.pendingSections?.sections.join(',')}</p><input aria-label="retained Today draft" defaultValue="draft"/></main>;}
      ` }));
      if (baseline) builder.onLoad({ filter: /[\\/]app[\\/]staff[\\/]today[\\/]today-progressive-client\.tsx$/ }, () => ({
        loader: 'tsx', resolveDir: path.resolve('app/staff/today'),
        contents: execFileSync('git', ['show', '7d9ff2a5fbf51be1b065950b4aaf5ac39e49759f:app/staff/today/today-progressive-client.tsx'], { encoding: 'utf8' }),
      }));
    } }],
  });
}

async function fixture(options = {}) {
  const output = await bundle();
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? output.outputFiles[0].text : '<div id="root"></div><script>window.fixtureOptions=' + JSON.stringify(options) + '</script><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); server.unref();
  let context;
  try {
    const browser = await (browserPromise ??= engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: browserPath, headless: true }));
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = [], external = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/')) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.goto(origin + '/staff/today');
    return { page, errors, external, async close() { await context.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, [], 'No JavaScript exceptions'); assert.deepEqual(external, [], 'No production or external requests'); } };
  } catch (error) { await context?.close(); await new Promise(resolve => server.close(resolve)); throw error; }
}

async function scenario(name, body, options) {
  const app = await fixture(options), { page } = app;
  let failure, closeFailure, trace = [], ui;
  try {
    await body(page);
  } catch (error) {
    failure = error;
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, engine + (baseline ? '-baseline' : '') + '-' + name + '-failure.png') }).catch(() => {});
  } finally {
    trace = await page.evaluate(() => window.fixtureTrace).catch(() => []);
    ui = await page.evaluate(() => ({ blocked: document.body.textContent.includes('Your workspace access must be checked again.'), dashboard: Boolean(document.querySelector('[data-today-dashboard]')), draft: document.querySelector('input')?.value })).catch(() => undefined);
    try { await app.close(); } catch (error) { closeFailure = error; failure ??= error; }
  }
  // Teardown verifies that this graph produced no JavaScript exception or
  // external traffic. Its assertions are part of the result, not post-report.
  outcomes.push({ name, passed: !failure, ...(failure ? { error: failure.message } : {}), ...(closeFailure ? { closeError: closeFailure.message } : {}), ui, trace });
  if (failure) throw failure;
}

const ready = page => page.waitForFunction(() => document.querySelector('[data-sales]')?.textContent === window.fixtureState.version + ' authorized sales' && document.querySelector('[data-pending]')?.textContent === '');
const blocked = page => page.getByText('Your workspace access must be checked again.', { exact: true }).waitFor();
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const readCount = page => page.evaluate(() => window.fixtureTrace.filter(row => row.kind === 'read').length);
async function changePermission(page) {
  await page.evaluate(async () => { window.fixtureState.permissions.canViewTickets = false; await window.refreshPhase('financials'); });
  await blocked(page);
  assert.equal(await page.locator('[data-today-dashboard]').count(), 0, 'A genuine changed permission withdraws already merged private sections');
}

test('real native provider: shuffled equal permissions load every phase with only successful reads', { skip, timeout: 30000 }, () => scenario('shuffled-load', async page => {
  await page.waitForFunction(() => document.querySelector('[data-pending]')?.textContent === '' || document.body.textContent.includes('Your workspace access must be checked again.'));
  assert.equal(await page.getByText('Your workspace access must be checked again.', { exact: true }).count(), 0, 'Equivalent permission booleans must not render the workspace recheck screen');
  await ready(page);
  const reads = await page.evaluate(() => window.fixtureTrace.filter(row => row.kind === 'read'));
  assert.equal(reads.length, 6);
  for (const phase of phases) assert.equal(reads.filter(row => row.phase === phase).length, 1, phase);
  assert.ok(new Set(reads.map(row => JSON.stringify(row.order))).size > 1, 'The fixture actually crosses differently ordered permission objects');
  assert.equal(await page.getByText('Your workspace access must be checked again.', { exact: true }).count(), 0);
}));

test('real native provider: reordered shell permissions retain Today and its draft while a financial section is held', { skip, timeout: 30000 }, () => scenario('shell-order-retains-draft', async page => {
  await page.waitForFunction(() => document.querySelector('[data-pending]')?.textContent === 'financials');
  await page.getByRole('textbox', { name: 'retained Today draft' }).fill('unsaved real-native draft');
  await page.locator('[data-today-dashboard]').evaluate(node => window.originalToday = node);
  await page.evaluate(() => window.refreshShell()); await settle(page);
  assert.equal(await page.locator('[data-today-dashboard]').evaluate(node => node === window.originalToday), true, 'Permission key order is not a new authority/page identity');
  assert.equal(await page.getByRole('textbox', { name: 'retained Today draft' }).inputValue(), 'unsaved real-native draft');
  assert.equal(await readCount(page), 7, 'Refreshing a semantically unchanged shell does not refetch its five sections');
  assert.equal(await page.locator('[data-sales]').textContent(), '--', 'The held financial response has not been invented');
  assert.equal(await page.evaluate(() => window.fixtureTrace.filter(row => row.kind === 'read' && row.phase === 'financials').length), 1);
  await page.evaluate(() => window.releaseRead('financials')); await ready(page);
  assert.equal(await page.locator('[data-today-dashboard]').evaluate(node => node === window.originalToday), true);
  assert.equal(await page.getByRole('textbox', { name: 'retained Today draft' }).inputValue(), 'unsaved real-native draft');
}, { shuffle: false, holdFinancial: true }));

test('real native provider: changed permission withdraws Today; fresh admission discards old DTOs before one progressive recovery', { skip, timeout: 30000 }, () => scenario('permission-recovery', async page => {
  await ready(page); await changePermission(page);
  await page.evaluate(() => { window.fixtureState.version = 'recovered'; window.fixtureState.holds.add('shell'); });
  await page.getByRole('button', { name: 'Open Today', exact: true }).click();
  await page.waitForFunction(() => window.fixtureTrace.filter(row => row.kind === 'read' && row.phase === 'shell').length === 2);
  assert.equal(await page.locator('[data-today-dashboard]').count(), 0, 'The formerly authorized merged page remains withdrawn while the new shell is held');
  const trace = await page.evaluate(() => window.fixtureTrace);
  const authority = trace.findIndex(row => row.kind === 'context');
  assert.equal(trace[authority].fresh, true);
  assert.equal(trace[authority].path, '/staff/today');
  const removals = trace.map((row, index) => ({ row, index })).filter(({ row }) => row.kind === 'cache' && row.op === 'remove');
  assert.equal(removals.length, 6);
  assert.deepEqual(removals.map(({ row }) => row.phase).sort(), [...phases].sort());
  assert.ok(removals.every(({ index }) => index > authority));
  const recoveryShell = trace.findLastIndex(row => row.kind === 'read' && row.phase === 'shell');
  assert.ok(removals.every(({ index }) => index < recoveryShell), 'No fresh shell can race deletion of a rejected durable snapshot');
  await page.evaluate(() => window.releaseRead('shell')); await ready(page);
  assert.equal(await page.evaluate(() => window.nativeValidationRevision()), 1, 'The real scope provider accepted fresh online Owner authority');
  const reads = await page.evaluate(() => window.fixtureTrace.filter(row => row.kind === 'read'));
  for (const phase of phases) assert.equal(reads.filter(row => row.phase === phase).length, phase === 'financials' ? 3 : 2, phase);
  assert.equal(await page.getByText('Your workspace access must be checked again.', { exact: true }).count(), 0);
}));

for (const mode of ['denied', 'unconfirmed', 'staff-only', 'other-viewer', 'other-scope', 'cached']) {
  test('real native provider: ' + mode + ' validation keeps Today withdrawn and starts no recovery reads', { skip, timeout: 30000 }, () => scenario('validation-' + mode, async page => {
    await ready(page); await changePermission(page);
    const before = await readCount(page);
    await page.evaluate(mode => window.fixtureState.validation = mode, mode);
    await page.getByRole('button', { name: 'Open Today', exact: true }).click();
    await page.getByText('Access could not be confirmed. Please try again.', { exact: true }).waitFor();
    assert.equal(await readCount(page), before);
    assert.equal(await page.locator('[data-today-dashboard]').count(), 0);
    assert.equal(await page.evaluate(() => window.nativeValidationRevision()), 0);
    assert.equal(await page.evaluate(() => window.fixtureTrace.filter(row => row.kind === 'cache' && row.op === 'remove').length), 0);
  }));
}

for (const change of ['hidden', 'path', 'generation']) {
  test('real native provider: late validation after ' + change + ' cannot restore Today or start private reads', { skip, timeout: 30000 }, () => scenario('late-' + change, async page => {
    await ready(page); await changePermission(page);
    const before = await readCount(page);
    await page.evaluate(() => window.fixtureState.holdValidation = true);
    await page.getByRole('button', { name: 'Open Today', exact: true }).click();
    await page.waitForFunction(() => typeof window.releaseValidation === 'function');
    await page.evaluate(change => {
      if (change === 'hidden') window.showToday(false);
      else if (change === 'path') history.pushState({}, '', '/explore');
      else window.__reylumiAppLocalContext = { ...window.__reylumiAppLocalContext, generation: 'changed-fixture-generation-20261019' };
    }, change);
    await settle(page); await page.evaluate(() => window.releaseValidation()); await settle(page);
    assert.equal(await readCount(page), before);
    assert.equal(await page.evaluate(() => window.nativeValidationRevision()), 0);
    assert.equal(await page.evaluate(() => window.fixtureTrace.filter(row => row.kind === 'cache' && row.op === 'remove').length), 0);
    if (change === 'hidden') {
      await page.evaluate(() => { window.fixtureState.holdValidation = false; window.showToday(true); }); await settle(page);
      assert.equal(await page.getByRole('button', { name: 'Open Today', exact: true }).isEnabled(), true);
      await page.getByRole('button', { name: 'Open Today', exact: true }).click(); await ready(page);
    }
  }));
}

after(async () => {
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(path.join(artifacts, engine + (baseline ? '-baseline' : '') + '-native-integration.json'), JSON.stringify({ checkedAt: new Date().toISOString(), engine, baseline, passed: outcomes.length === 12 && outcomes.every(row => row.passed), tests: outcomes.length, failed: outcomes.filter(row => !row.passed).length, realModules: ['AppLocalTodayClient', 'app/local-app/scope.tsx', 'app-local-page-admission', 'app-local-host', 'app-local-resource', 'experience-resource-cache', 'experience-persistent-cache', 'app-local-data-policy'], boundaries: ['synthetic native transport only', 'visual dashboard probe'], physicalIPhoneVerified: false, outcomes }, null, 2));
  await (await browserPromise)?.close();
});
