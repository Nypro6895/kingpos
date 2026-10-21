import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const measurements = [];
after(() => {
  const directory = process.env.OWNER_ADMISSION_ARTIFACT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'measurements.json'), JSON.stringify(measurements, null, 2));
});

// Real provider, lease client, cache and Activity. Transport, presentation and
// route commits are synthetic; this does not exercise Next's server redirect.
async function compile() {
  return build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{ExperienceScopeProvider,useExperienceScope}from'./components/experience-scope';
    import{getExperienceDeviceGeneration,getExperienceOfflineGrantForPath}from'./lib/experience-persistent-cache';
    const options=window.fixtureOptions;
    const account=(authenticated,id='a')=>({scope:authenticated?'owner-'+id:'guest',viewerId:authenticated?'viewer-'+id:null,workspaceId:authenticated?'salon-'+id:'personal:personal',salonId:authenticated?'salon-'+id:null,permissionRevision:'fixture-permissions',authenticated});
    window.accountContext=account(!!options.authenticated);window.serverContext=window.accountContext;
    window.fixture={requests:[],reloads:0,locks:0,workerRegistrations:0,documentIdentity:crypto.randomUUID()};
    window.captureReload=()=>window.fixture.reloads++;
    window.addEventListener('reylumi:offline-clear',()=>window.fixture.locks++);
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{controller:null,getRegistrations:async()=>[],register:async()=>{window.fixture.workerRegistrations++;throw Error('Fixture worker unavailable')},addEventListener(){}}});
    window.fetch=(input,init={})=>{
      const url=new URL(input instanceof Request?input.url:String(input),location.href);
      const kind=url.pathname==='/api/experience/context'?'context':url.pathname==='/api/experience/offline-context'?'lease':'other';
      const current=window.accountContext,path=url.searchParams.get('path')??location.pathname;
      const publicPath=path==='/explore'||path==='/market';
      const status=kind==='lease'?(!current.authenticated&&!publicPath?401:options.leaseStatus??200):options.contextStatus??200;
      const row={kind,path,status:null,aborted:false,scope:current.scope};window.fixture.requests.push(row);
      return new Promise((accept,reject)=>{
        let settled=false,timer;
        const abort=()=>{if(settled)return;settled=true;row.aborted=true;clearTimeout(timer);reject(new DOMException('Cancelled fixture read','AbortError'))};
        init.signal?.addEventListener('abort',abort,{once:true});
        row.finish=(override=status)=>{
          if(settled)return;settled=true;clearTimeout(timer);init.signal?.removeEventListener('abort',abort);row.status=override;
          const grant={version:1,scope:current.scope,scopes:[current.scope],viewerId:current.viewerId,workspaceId:current.workspaceId,salonId:current.salonId,grantRevision:'fixture-grants',generation:url.searchParams.get('generation')??getExperienceDeviceGeneration(),issuedAt:Date.now(),expiresAt:Date.now()+3600000,path,kind:publicPath&&!current.authenticated?'public':'owner'};
          accept(new Response(JSON.stringify(override===200?(kind==='context'?window.serverContext:grant):{error:'Access must be checked again.'}),{status:override,headers:{'Content-Type':'application/json'}}));
        };
        if(kind!=='lease'||!options.holdLease)timer=setTimeout(row.finish,kind==='context'?20:10);
      });
    };
    window.snapshot=()=>({...window.fixture,requests:window.fixture.requests.map(({kind,path,status,aborted,scope})=>({kind,path,status,aborted,scope})),acceptedScope:getExperienceOfflineGrantForPath(window.accountContext.scope,location.pathname)?.scope??null});
    window.lifecycle=name=>window.dispatchEvent(new Event(name));
    function ContextProbe(){const value=useExperienceScope();useEffect(()=>{window.validateRequired=()=>value.validate(true)},[value.validate]);return null}
    function App(){
      const[current,setCurrent]=useState(window.accountContext),[visible,setVisible]=useState(true),[path,setPath]=useState(location.pathname);
      window.setAccount=(authenticated,id='a')=>{const value=account(authenticated,id);window.accountContext=value;window.serverContext=value;setCurrent(value)};
      window.setVisible=setVisible;
      window.commitRoute=path=>{history.replaceState(null,'',path);setPath(location.pathname)};
      useEffect(()=>{window.fixtureReady=true},[]);
      return <Activity mode={visible?'visible':'hidden'}><ExperienceScopeProvider key={current.scope} context={current}><ContextProbe/><main data-route={path}>{path==='/login'?<p data-login>Sign in</p>:current.authenticated?<section data-private><label>Owner draft<input aria-label="Owner draft" defaultValue="retained owner input"/></label></section>:<p data-guest>{path==='/pos'||path.startsWith('/pos/')?'Redirecting to sign in':'Public workspace'}</p>}</main></ExperienceScopeProvider></Activity>;
    }
    createRoot(document.getElementById('app')).render(<App/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'owner-admission-boundaries', setup(builder) {
    builder.onLoad({ filter: /components[\\/]experience-scope\.tsx$/ }, ({ path }) => ({ contents: readFileSync(path, 'utf8').replaceAll('window.location.reload();', 'window.captureReload();'), loader: 'tsx', resolveDir: process.cwd() }));
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)loading-feedback$/ }, () => ({ path: 'loading', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: process.cwd(), contents:
      path==='navigation'?`const router={refresh(){}};const params=new URLSearchParams();export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>params;`
      :path==='loading'?`export const PageLoadingSkeleton=()=> <p data-guard>Checking context</p>;`
      :`import React from'react';export const WorkspaceText=({text})=><>{text}</>;export const WorkspaceElement=({as='span',children,...props})=>React.createElement(as,props,children);`
    }));
  } }] });
}

let compiled;
async function fixture(options = {}) {
  compiled ??= compile();
  const output = await compiled;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? output.outputFiles[0].text : `<!doctype html><html><head><meta charset="utf-8"><title>Owner admission QA</title></head><body><div id="app"></div><script>window.fixtureOptions=${JSON.stringify(options)};</script><script src="/app.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome', args: ['--no-proxy-server'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}${options.path ?? '/pos'}`);
    await page.waitForFunction(() => window.fixtureReady);
    return { page, async close(name) { measurements.push({ name, ...await page.evaluate(() => window.snapshot()) }); await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
  } catch (error) { await browser?.close(); await new Promise(resolve => server.close(resolve)); throw error; }
}

test('anonymous Owner POS waits for login redirect without optional lease checks, reload or delayed preparation', { timeout: 20000 }, async () => {
  for (const path of ['/pos', '/pos/settings']) {
    const app = await fixture({ path });
    try {
      await app.page.evaluate(() => { window.lifecycle('focus'); window.lifecycle('online'); window.lifecycle('reylumi:foreground'); });
      await app.page.waitForTimeout(3800);
      const before = await app.page.evaluate(() => window.snapshot());
      assert.equal(before.reloads, 0, 'expected anonymous lease401 must not compete with the normal login redirect');
      assert.equal(before.requests.filter(row => row.kind === 'lease').length, 0);
      assert.equal(before.workerRegistrations, 0);
      await app.page.evaluate(() => window.commitRoute('/login'));
      await app.page.locator('[data-login]').waitFor();
      assert.equal(await app.page.evaluate(() => window.fixture.reloads), 0);
      assert.equal(await app.page.getByText('Your access has changed. Reload to continue.').count(), 0);
    } finally { await app.close(`anonymous-${path}`); }
  }
});

for (const status of [401, 403]) test(`authenticated Owner POS lease ${status} still locks and recovers`, { timeout: 15000 }, async () => {
  const app = await fixture({ authenticated: true, leaseStatus: status });
  try {
    await app.page.waitForFunction(() => window.fixture.reloads === 1);
    const state = await app.page.evaluate(() => window.snapshot());
    assert.ok(state.requests.some(row => row.kind === 'lease' && row.status === status));
    assert.ok(state.requests.some(row => row.kind === 'context' && row.status === 200));
    assert.ok(state.locks >= 1);
    assert.equal(await app.page.locator('[data-private]').isVisible(), false);
    assert.equal(await app.page.evaluate(() => JSON.parse(sessionStorage.getItem('reylumi:experience-reload:v1')).reason), 'resource');
  } finally { await app.close(`authenticated-denial-${status}`); }
});

test('same-path Owner login starts optional reads and logout cancels held reads without accepting a late denial', { timeout: 15000 }, async () => {
  const app = await fixture({ holdLease: true });
  try {
    await app.page.waitForTimeout(80);
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length), 0);
    await app.page.evaluate(() => window.setAccount(true));
    await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease' && row.scope === 'owner-a'));
    await app.page.evaluate(() => window.setAccount(false));
    await app.page.waitForFunction(() => window.fixture.requests.filter(row => row.kind === 'lease').every(row => row.aborted));
    const count = await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length);
    await app.page.evaluate(() => { for (const row of window.fixture.requests.filter(row => row.kind === 'lease')) row.finish(401); window.lifecycle('focus'); window.lifecycle('online'); });
    await app.page.waitForTimeout(100);
    const state = await app.page.evaluate(() => window.snapshot());
    assert.equal(state.requests.filter(row => row.kind === 'lease').length, count);
    assert.equal(state.reloads, 0);
    assert.equal(state.locks, 0);
    assert.equal(state.acceptedScope, null);
    assert.equal(await app.page.locator('[data-guest]').isVisible(), true);
  } finally { await app.close('same-path-login-logout'); }
});

test('Owner identity replacement and Activity hide abort stale reads; reveal admits only the current account', { timeout: 15000 }, async () => {
  const app = await fixture({ authenticated: true, holdLease: true });
  try {
    await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease'));
    await app.page.evaluate(() => window.setAccount(true, 'b'));
    await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease' && row.scope === 'owner-a' && row.aborted) && window.fixture.requests.some(row => row.kind === 'lease' && row.scope === 'owner-b'));
    await app.page.getByLabel('Owner draft').fill('owner B retained input');
    await app.page.evaluate(() => window.setVisible(false));
    await app.page.waitForFunction(() => window.fixture.requests.filter(row => row.kind === 'lease').every(row => row.aborted));
    await app.page.evaluate(() => { for (const row of window.fixture.requests.filter(row => row.kind === 'lease')) row.finish(403); window.setVisible(true); });
    await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease' && row.scope === 'owner-b' && !row.aborted));
    await app.page.evaluate(() => { for (const row of window.fixture.requests.filter(row => row.kind === 'lease' && !row.aborted)) row.finish(200); });
    await app.page.waitForFunction(() => window.snapshot().acceptedScope === 'owner-b');
    await app.page.getByLabel('Owner draft').waitFor();
    assert.equal(await app.page.getByLabel('Owner draft').inputValue(), 'owner B retained input');
    assert.equal(await app.page.evaluate(() => window.fixture.reloads), 0);
    await app.page.evaluate(() => { window.setVisible(false); window.setAccount(false); });
    await app.page.waitForTimeout(40);
    const count = await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length);
    await app.page.evaluate(() => { window.setVisible(true); window.lifecycle('online'); });
    await app.page.waitForTimeout(100);
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length), count);
  } finally { await app.close('identity-activity'); }
});

test('anonymous Owner optional gating does not suppress required context rejection', { timeout: 15000 }, async () => {
  const app = await fixture({ contextStatus: 401 });
  try {
    await app.page.evaluate(() => window.validateRequired());
    await app.page.waitForFunction(() => window.fixture.reloads === 1);
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length), 0);
    assert.equal(await app.page.evaluate(() => JSON.parse(sessionStorage.getItem('reylumi:experience-reload:v1')).reason), 'permissions');
    assert.equal(await app.page.locator('[data-guest]').isVisible(), false);
  } finally { await app.close('required-context-denial'); }
});

test('public anonymous Explore and Market remain eligible for public leases', { timeout: 15000 }, async () => {
  for (const path of ['/explore', '/market']) {
    const app = await fixture({ path });
    try {
      await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease' && row.status === 200));
      assert.equal(await app.page.locator('[data-guest]').isVisible(), true);
      assert.equal(await app.page.evaluate(() => window.fixture.reloads), 0);
    } finally { await app.close(`public-${path}`); }
  }
});
