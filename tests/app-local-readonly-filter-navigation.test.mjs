import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

let browser, server, base;
const observations = [], requests = [];
const evidence = process.env.READ_FILTER_QA_DIR;
before(async () => {
  const data = { source: 'live', period: { startDate: '2026-11-01', endDate: '2026-11-30', preset: 'monthly', cycleType: 'monthly', label: 'SYNTHETIC November 2026' }, periodOptions: [], scheduleSetup: { needsBiweeklyAnchor: false }, salonPayrollSetting: { cycle_type: 'monthly' }, latestStatement: null, lines: [], summary: { totalTaxCompanyTaxableGross: 0 }, access: { canManagePayroll: false, canViewTaxCompany: true, canViewAllPayroll: true } };
  const source = `import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{AppLocalPayrollTax}from'./components/app-local-payroll-tax';import{AppLocalPortableReport}from'./components/app-local-portable-report';
import{NavigationForm,NavigationSubmitButton}from'./components/navigation-form';import{OfflineNetworkFormGuard}from'./components/offline-network-form-guard';
import{AppLocalNavigationProvider}from'./app/local-app/navigation';import{installAppLocalLinkNavigation}from'./lib/app-local-link-navigation';
const config=new URLSearchParams(location.search),portable=location.pathname.includes('/pos/portable');
window.fixtureState={calls:[],hosted:[],errors:[],violations:[],events:[],scope:'synthetic-owner-A',mode:'normal',deferred:[],cancel:false};
document.addEventListener('securitypolicyviolation',event=>window.fixtureState.violations.push({directive:event.effectiveDirective}));
document.addEventListener('reylumi:app-local-search-navigation',event=>window.fixtureState.events.push(event.detail),true);
window.NativeFormData=FormData;if(config.has('legacyFormData')){window.FormData=class extends window.NativeFormData{constructor(form){super(form)}}}
if(config.has('offline'))Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});
function App(){const[route,setRoute]=useState(location.pathname+location.search);const commit=destination=>{history.pushState({},'',destination);setRoute(destination)};
const navigate=destination=>{window.fixtureState.calls.push(destination);if(window.fixtureState.mode==='throw')throw Error('synthetic navigation failed');if(window.fixtureState.mode==='reject')return Promise.reject(Error('synthetic navigation rejected'));if(window.fixtureState.mode==='hold')return new Promise(resolve=>window.fixtureState.deferred.push({destination,resolve:accepted=>{if(accepted)commit(destination);resolve()}}));commit(destination)};
useEffect(()=>{const pop=()=>setRoute(location.pathname+location.search);window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[]);
useEffect(()=>{const install=()=>installAppLocalLinkNavigation({navigate,isLocalRoute:path=>!window.fixtureState.notLocal,getScope:config.has('noScopeReader')?undefined:()=>window.fixtureState.scope,openOnline:path=>window.fixtureState.hosted.push(path),onError:error=>window.fixtureState.errors.push(String(error))});let cleanup=install();window.cleanupHelper=()=>cleanup();window.reinstallHelper=()=>{cleanup();cleanup=install()};window.fixtureReady=true;return()=>cleanup()},[]);
const guarded=config.has('guarded');return <AppLocalNavigationProvider value={{path:route,navigate,refresh(){}}}>{config.has('offline')?<OfflineNetworkFormGuard/>:null}<p>SYNTHETIC READONLY FILTER QA</p><textarea aria-label="Retained draft" defaultValue="keep this draft"/>{guarded?<NavigationForm id="guarded" action="/payroll/tax-company" data-app-local-read-filter="payroll-tax-period" onSubmit={event=>{if(window.fixtureState.cancel)event.preventDefault()}}><input name="month" defaultValue="2026-11"/><NavigationSubmitButton>Apply guarded</NavigationSubmitButton></NavigationForm>:portable?<AppLocalPortableReport data={{salonName:'SYNTHETIC QA',reportDate:'2026-11-19',timezone:'America/Chicago',setupMessage:null}}/>:<AppLocalPayrollTax data={${JSON.stringify(data)}} params={{}}/>}</AppLocalNavigationProvider>};
createRoot(document.getElementById('root')).render(<App/>);`;
  const stubs = {
    '@/components/workspace-language': 'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;',
    '@/app/payroll/tax-company-table': 'export const TaxCompanyLinesTable=()=>null;export const TaxCompanyCalculationGuide=()=>null;',
    '@/app/pos/portable/report/portable-report-closing-form': 'export const PortableReportClosingForm=()=>null;',
  };
  const result = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, write: false, bundle: true, platform: 'browser', format: 'iife', target: ['safari16'], jsx: 'automatic', plugins: [{ name: 'actual-installed-read-filter-boundaries', setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'inert-style', namespace: 'inert-css' }));
    builder.onLoad({ filter: /.*/, namespace: 'inert-css' }, () => ({ contents: 'export default {};', loader: 'js' }));
    builder.onResolve({ filter: /^next\/(?:navigation|link|image)$/ }, args => ({ path: args.path, namespace: 'native-next' }));
    builder.onLoad({ filter: /.*/, namespace: 'native-next' }, args => ({ contents: args.path === 'next/navigation' ? `export * from ${JSON.stringify(path.resolve('app/local-app/navigation.tsx'))}` : args.path === 'next/link' ? `export {AppLocalLink as default,useLinkStatus}from ${JSON.stringify(path.resolve('app/local-app/navigation.tsx'))}` : `export {AppLocalImage as default}from ${JSON.stringify(path.resolve('app/local-app/navigation.tsx'))}`, loader: 'tsx', resolveDir: process.cwd() }));
    builder.onResolve({ filter: /^@\// }, args => {
      if (args.path in stubs) return { path: args.path, namespace: 'inert-below-read-filter' };
      for (const suffix of ['.tsx', '.ts', '/index.tsx', '/index.ts']) { const target = path.resolve(args.path.slice(2) + suffix); if (fs.existsSync(target)) return { path: target }; }
    });
    builder.onLoad({ filter: /.*/, namespace: 'inert-below-read-filter' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: process.cwd() }));
  } }] });
  const js = result.outputFiles[0].text;
  server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    if (req.url === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(js); return; }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" });
    res.end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
});
after(async () => {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  assert.ok(requests.every(row => row.method === 'GET'), 'Read-only fixture must never submit a financial/provider write');
  if (evidence) { fs.mkdirSync(evidence, { recursive: true }); fs.writeFileSync(path.join(evidence, 'fixture-result.json'), JSON.stringify({ observations, requests, syntheticMetadataOnly: true, nativeOrProviderAcceptance: false }, null, 2) + '\n'); }
});
async function open(kind = 'tax', query = '') {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort('blockedbyclient'));
  await page.goto(base + (kind === 'portable' ? '/pos/portable/report?date=2026-11-19' : '/payroll/tax-company?month=2026-11&report=1') + (query ? '&' + query : ''));
  await page.waitForFunction(() => window.fixtureReady);
  if (kind === 'tax' && !query.includes('guarded')) await page.getByRole('button', { name: 'Payroll filters', exact: true }).click();
  return page;
}
async function settled(page) { await page.waitForFunction(() => [...document.querySelectorAll('form[data-app-local-read-filter]')].every(form => form.getAttribute('aria-busy') === 'false')); }
async function state(page) { return page.evaluate(() => ({ ...window.fixtureState, deferred: window.fixtureState.deferred.length, route: location.pathname + location.search })); }
async function month(page, value) { await page.locator('input[name=month]').fill(value); await page.getByRole('button', { name: 'Apply', exact: true }).click({ noWaitAfter: true }); await settled(page); }
async function capture(page, scenario) { const value = await state(page); observations.push({ scenario, ...value }); if (evidence) { fs.mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, scenario + '.png') }); } return value; }

test('actual monthly filter navigates with unchanged form-action none CSP after CompactFilters hides its popover', async () => {
  const page = await open(); await page.locator('textarea').fill('keep my unsubmitted draft');
  await page.evaluate(() => { window.draftNode = document.querySelector('textarea'); });
  await month(page, '2026-10'); const result = await capture(page, 'tax-month');
  assert.deepEqual(result.calls, ['/payroll/tax-company?report=1&month=2026-10']); assert.deepEqual(result.violations, []); assert.deepEqual(result.hosted, []);
  assert.equal(await page.locator('[popover]').evaluate(node => node.matches(':popover-open')), false);
  assert.equal(await page.locator('textarea').inputValue(), 'keep my unsubmitted draft'); assert.equal(await page.evaluate(() => window.draftNode === document.querySelector('textarea')), true);
  await page.close();
});
test('actual advanced custom filter preserves its successful period controls and replaces the old month query', async () => {
  const page = await open(); await page.getByText('Advanced custom range', { exact: true }).click(); await page.locator('input[name=start]').fill('2026-10-01'); await page.locator('input[name=end]').fill('2026-10-31');
  await page.getByRole('button', { name: 'Apply Custom', exact: true }).click({ noWaitAfter: true }); await settled(page); const result = await capture(page, 'tax-custom');
  assert.deepEqual(result.calls, ['/payroll/tax-company?preset=custom&report=1&start=2026-10-01&end=2026-10-31']); assert.deepEqual(result.violations, []); await page.close();
});
test('actual Portable date GET supports same-date repeat, clear and Back without a new document or draft loss', async () => {
  const page = await open('portable'); await page.locator('textarea').fill('portable draft remains');
  await page.getByRole('button', { name: 'Load', exact: true }).click({ noWaitAfter: true }); await settled(page);
  await page.getByRole('button', { name: 'Load', exact: true }).click({ noWaitAfter: true }); await settled(page);
  await page.locator('input[name=date]').fill(''); await page.getByRole('button', { name: 'Load', exact: true }).click({ noWaitAfter: true }); await settled(page);
  await page.goBack(); await page.waitForFunction(() => location.search === '?date=2026-11-19');
  const result = await capture(page, 'portable-today'); assert.deepEqual(result.calls, ['/pos/portable/report?date=2026-11-19', '/pos/portable/report?date=2026-11-19', '/pos/portable/report?date=']); assert.deepEqual(result.violations, []);
  assert.equal(await page.locator('textarea').inputValue(), 'portable draft remains'); await page.close();
});
test('a retained month form accepts a second query, Back and same-query repeat', async () => {
  const page = await open(); await month(page, '2026-10'); await page.getByRole('button', { name: 'Payroll filters', exact: true }).click(); await month(page, '2026-09');
  await page.goBack(); await page.waitForFunction(() => location.search === '?report=1&month=2026-10'); await page.getByRole('button', { name: 'Payroll filters', exact: true }).click(); await month(page, '2026-10');
  assert.equal((await state(page)).calls.length, 3); await page.close();
});
test('scope or current-query changes before queued navigation cancel the old private form attempt', async () => {
  for (const change of ['scope', 'query', 'route']) {
    const page = await open(); const initial = await page.evaluate(() => location.pathname + location.search);
    await page.evaluate(change => { const form = document.querySelector('form[data-app-local-read-filter]'); form.requestSubmit(form.querySelector('button')); if (change === 'scope') window.fixtureState.scope = 'synthetic-new-workspace'; else { history.pushState({}, '', change === 'query' ? '/payroll/tax-company?month=2026-12' : '/settings'); window.dispatchEvent(new PopStateEvent('popstate')); } }, change);
    await settled(page); const result = await state(page); assert.deepEqual(result.calls, []); assert.deepEqual(result.hosted, []); assert.deepEqual(result.violations, []);
    assert.equal(result.route, change === 'scope' ? initial : change === 'query' ? '/payroll/tax-company?month=2026-12' : '/settings'); await page.close();
  }
});
test('original form cancellation and the actual offline guard keep ownership and preserve entries', async () => {
  const guarded = await open('tax', 'guarded=1'); await guarded.evaluate(() => { window.fixtureState.cancel = true; }); await guarded.getByRole('button', { name: 'Apply guarded' }).click({ noWaitAfter: true });
  assert.deepEqual((await state(guarded)).calls, []); assert.equal(await guarded.locator('#guarded').getAttribute('aria-busy'), 'false'); await guarded.close();
  const offline = await open('tax', 'offline=1'); await offline.locator('textarea').fill('offline entries stay'); await offline.getByRole('button', { name: 'Apply', exact: true }).click({ noWaitAfter: true });
  assert.deepEqual((await state(offline)).calls, []); assert.equal(await offline.locator('form[data-app-local-read-filter]').first().getAttribute('aria-busy'), 'false'); assert.equal(await offline.locator('textarea').inputValue(), 'offline entries stay');
  await offline.getByText("You're offline. Your entries are kept. Reconnect to continue.", { exact: true }).waitFor(); await offline.close();
});
test('held private navigation blocks duplicates and failure permits one explicit retry', async () => {
  const page = await open(); await page.evaluate(() => { window.fixtureState.mode = 'hold'; const form = document.querySelector('form[data-app-local-read-filter]'); form.requestSubmit(form.querySelector('button')); form.requestSubmit(form.querySelector('button')); });
  await page.waitForFunction(() => window.fixtureState.deferred.length === 1); assert.equal((await state(page)).calls.length, 1); assert.equal(await page.locator('form[data-app-local-read-filter]').first().getAttribute('aria-busy'), 'true');
  await page.evaluate(() => window.fixtureState.deferred[0].resolve(true)); await settled(page);
  await page.getByRole('button', { name: 'Payroll filters', exact: true }).click(); await page.evaluate(() => { window.fixtureState.mode = 'reject'; }); await month(page, '2026-10'); assert.equal((await state(page)).errors.length, 1);
  await page.getByRole('button', { name: 'Payroll filters', exact: true }).click(); await page.evaluate(() => { window.fixtureState.mode = 'normal'; }); await month(page, '2026-09'); assert.equal((await state(page)).calls.length, 3); await page.close();
});
test('only exact marked current-page read GETs with safe actions, control names and original target/encoding are admitted', async () => {
  const variants = ['unknown-marker', 'wrong-marker-route', 'no-marker', 'post', 'multipart', 'target', 'external', 'credentials', 'other-action', 'declared-other-action', 'workspace-field', 'duplicate-month', 'server-submitter', 'image-submitter', 'unvalued-input', 'not-local', 'no-scope-reader'];
  for (const variant of variants) {
    const page = await open('tax', variant === 'no-scope-reader' ? 'noScopeReader=1' : '');
    const prevented = await page.evaluate(variant => {
      const form = document.querySelector('form[data-app-local-read-filter]'); let button = form.querySelector('button');
      if (variant === 'unknown-marker') form.dataset.appLocalReadFilter = 'all-navigation';
      if (variant === 'wrong-marker-route') form.dataset.appLocalReadFilter = 'portable-report-date';
      if (variant === 'no-marker') form.removeAttribute('data-app-local-read-filter');
      if (variant === 'post') button.setAttribute('formmethod', 'post'); if (variant === 'multipart') button.setAttribute('formenctype', 'multipart/form-data'); if (variant === 'target') button.setAttribute('formtarget', '_blank');
      if (variant === 'external') button.setAttribute('formaction', 'https://outside.invalid/payroll/tax-company'); if (variant === 'credentials') button.setAttribute('formaction', 'https://user@reylumi.com/payroll/tax-company');
      if (variant === 'other-action') button.setAttribute('formaction', '/workspace/open'); if (variant === 'declared-other-action') { form.action = '/workspace/open'; button.setAttribute('formaction', '/payroll/tax-company'); }
      if (variant === 'workspace-field' || variant === 'duplicate-month') { const field = document.createElement('input'); field.name = variant === 'workspace-field' ? 'workspace_id' : 'month'; field.value = 'synthetic'; form.append(field); }
      if (variant === 'server-submitter') button.name = '$ACTION_ID_synthetic';
      if (variant === 'image-submitter' || variant === 'unvalued-input') { button = document.createElement('input'); button.type = variant === 'image-submitter' ? 'image' : 'submit'; button.name = 'month'; form.append(button); }
      if (variant === 'not-local') window.fixtureState.notLocal = true;
      const event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }); form.dispatchEvent(event); return event.defaultPrevented;
    }, variant);
    assert.equal(prevented, false, variant); assert.deepEqual((await state(page)).calls, [], variant); assert.deepEqual((await state(page)).hosted, [], variant); await page.close();
  }
});
test('native successful submitter values survive the legacy Safari serializer and absolute same-site actions', async () => {
  const page = await open('tax', 'legacyFormData=1');
  const expected = await page.evaluate(() => {
    const form = document.querySelector('form[data-app-local-read-filter]'), button = form.querySelector('button'); form.action = 'https://reylumi.com/payroll/tax-company?old=discard'; button.name = 'segment'; button.value = 'first';
    return '/payroll/tax-company?' + new URLSearchParams(new window.NativeFormData(form, button));
  });
  await page.getByRole('button', { name: 'Apply', exact: true }).click({ noWaitAfter: true }); await settled(page);
  assert.deepEqual((await state(page)).calls, [expected]); assert.equal(await page.locator('[data-app-local-search-submitter]').count(), 0); await page.close();
});
test('implicit Portable action is accepted only on its exact page and replaces existing query fields', async () => {
  const page = await open('portable'); await page.evaluate(() => { history.replaceState({}, '', '/pos/portable/report?date=2026-11-19&q=old&error=old'); });
  await page.getByRole('button', { name: 'Load', exact: true }).click({ noWaitAfter: true }); await settled(page); assert.deepEqual((await state(page)).calls, ['/pos/portable/report?date=2026-11-19']); await page.close();
});
