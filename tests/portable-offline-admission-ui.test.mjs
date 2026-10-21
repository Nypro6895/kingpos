import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const measurements = [];
const artifactDirectory = process.env.PORTABLE_ADMISSION_ARTIFACT_DIR;
after(() => {
  if (!artifactDirectory) return;
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(resolve(artifactDirectory, 'measurements.json'), JSON.stringify(measurements, null, 2));
});

// Keep the real provider, lease client, persistent cache, Activity lifecycle and
// PortableOfflineShell. Only server transport, presentation and POS context are
// fixtures. No real sign-in, native vault, server mutation or production request.
async function compile(captureReload = true) {
  return build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{ExperienceScopeProvider,useExperienceScope}from'./components/experience-scope';
    import{PortableOfflineShell}from'./app/pos/portable/portable-offline-shell';
    import{getExperienceDeviceGeneration}from'./lib/experience-persistent-cache';
    const options=window.fixtureOptions;
    const guest={scope:options.account?'owner-fixture':'guest-fixture',viewerId:options.account?'fixture-account':null,workspaceId:'personal:personal',salonId:null,permissionRevision:'[null,[],null,null,null,null,null]',authenticated:!!options.account};
    window.posSignedIn=!!options.signedIn;window.portableScope='fixture-salon:fixture-pos-a';
    window.fixture={requests:[],reloads:0,locks:0,workerRegistrations:0,documentIdentity:crypto.randomUUID()};
    window.captureReload=()=>window.fixture.reloads++;
    window.addEventListener('reylumi:offline-clear',()=>window.fixture.locks++);
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{controller:null,getRegistrations:async()=>[],register:async()=>{window.fixture.workerRegistrations++;throw Error('Fixture worker unavailable')},addEventListener(){}}});
    window.fetch=(input,init={})=>{
      const url=new URL(input instanceof Request?input.url:String(input),location.href);
      const kind=url.pathname==='/api/experience/context'?'context':url.pathname==='/api/experience/offline-context'?'lease':'other';
      const row={kind,status:null,aborted:false,scope:window.portableScope};window.fixture.requests.push(row);
      const portable=location.pathname.startsWith('/pos/portable');
      const status=kind==='lease'?(portable&&!window.posSignedIn?401:options.leaseStatus??200):200;
      return new Promise((accept,reject)=>{
        let settled=false,timer;
        const abort=()=>{if(settled)return;settled=true;row.aborted=true;clearTimeout(timer);reject(new DOMException('Cancelled fixture read','AbortError'))};
        init.signal?.addEventListener('abort',abort,{once:true});
        row.finish=()=>{
          if(settled)return;settled=true;clearTimeout(timer);init.signal?.removeEventListener('abort',abort);row.status=status;
          const grant={version:1,scope:portable?row.scope:guest.scope,scopes:portable?[row.scope,guest.scope]:[guest.scope],viewerId:null,workspaceId:portable?'fixture-pos':'personal:personal',salonId:portable?'fixture-salon':null,grantRevision:'fixture-grants',generation:url.searchParams.get('generation')??getExperienceDeviceGeneration(),issuedAt:Date.now(),expiresAt:Date.now()+3600000,path:location.pathname,kind:portable?'portable':'public',localCommands:false};
          accept(new Response(JSON.stringify(status===200?(kind==='context'?guest:grant):{error:'Access must be checked again.'}),{status,headers:{'Content-Type':'application/json'}}));
        };
        if(kind!=='lease'||!options.holdLease)timer=setTimeout(row.finish,kind==='context'?20:10);
      });
    };
    window.snapshot=()=>({...window.fixture,requests:window.fixture.requests.map(({kind,status,aborted,scope})=>({kind,status,aborted,scope}))});
    window.lifecycle=name=>window.dispatchEvent(new Event(name));
    function ContextProbe(){const scope=useExperienceScope();useEffect(()=>{window.validateRequired=()=>scope.validate(true)},[scope.validate]);return null}
    function App(){
      const[signedIn,setSignedIn]=useState(window.posSignedIn),[identity,setIdentity]=useState('fixture-salon:fixture-pos-a'),[visible,setVisible]=useState(true);
      window.setPOS=value=>{window.posSignedIn=value;setSignedIn(value)};
      window.replacePOS=()=>{window.portableScope='fixture-salon:fixture-pos-b';setIdentity(window.portableScope)};
      window.setVisible=setVisible;
      useEffect(()=>{window.fixtureReady=true},[]);
      const portable=location.pathname.startsWith('/pos/portable');
      return <><h1>Portable authorization QA fixture</h1><button onClick={()=>window.setPOS(true)}>Fixture sign in</button><button onClick={()=>{window.dispatchEvent(new Event('kingpos:portable-lock'));window.setPOS(false)}}>Fixture sign out</button><Activity mode={visible?'visible':'hidden'}><ExperienceScopeProvider context={guest}><ContextProbe/>{portable?(signedIn?<main data-portable-pos-shell data-private><p>Authorized synthetic POS {identity}</p><input aria-label="POS draft" defaultValue="retained draft"/><PortableOfflineShell/></main>:<main data-portable-login><label>POS ID<input aria-label="POS ID" defaultValue=""/></label><label>Passcode<input aria-label="Passcode" type="password"/></label></main>):<main data-public>Guest Explore</main>}</ExperienceScopeProvider></Activity></>;
    }
    createRoot(document.getElementById('app')).render(<App/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'portable-admission-boundaries', setup(builder) {
    if (captureReload) builder.onLoad({ filter: /components[\\/]experience-scope\.tsx$/ }, ({ path }) => ({ contents: readFileSync(path, 'utf8').replaceAll('window.location.reload();', 'window.captureReload();'), loader: 'tsx', resolveDir: process.cwd() }));
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)portable-workspace-state$/ }, () => ({ path: 'workspace', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)portable-device-storage$/ }, () => ({ path: 'device', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)loading-feedback$/ }, () => ({ path: 'loading', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: process.cwd(), contents:
      path==='navigation'?`const router={refresh(){}};const params=new URLSearchParams();export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>params;`
      :path==='workspace'?`export const usePortableWorkspaceState=()=>({scope:window.portableScope,offlineEnabled:window.fixtureOptions.offlineEnabled===true});`
      :path==='device'?`export const desktopDevice=()=>undefined;`
      :path==='loading'?`export const PageLoadingSkeleton=()=> <p data-guard>Checking context</p>;`
      :`import React from'react';export const WorkspaceText=({text})=><>{text}</>;export const WorkspaceElement=({as='span',children,...props})=>React.createElement(as,props,children);`
    }));
  } }] });
}

function html(options = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Portable authorization QA</title></head><body><div id="app"></div><script>window.fixtureOptions=${JSON.stringify(options)};</script><script src="/app.js"></script></body></html>`;
}
if (process.env.PORTABLE_ADMISSION_FIXTURE_DIR) {
  const directory = resolve(process.env.PORTABLE_ADMISSION_FIXTURE_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'index.html'), html());
  writeFileSync(resolve(directory, 'app.js'), (await compile(false)).outputFiles[0].text);
  writeFileSync(resolve(directory, 'README.txt'), 'Synthetic local QA only. Serve index.html for /pos/portable and app.js for /app.js. Real candidate provider/offline client/PortableOfflineShell; mock guest/POS endpoints and no native vault. Document reload is not intercepted in this export. Fixture sign-in/out changes local state only. Never serve this as a product release.\n');
}

let compiled;
async function fixture(options = {}) {
  compiled ??= compile();
  const output = await compiled;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? output.outputFiles[0].text : html(options));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome', args: ['--no-proxy-server'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}${options.path ?? '/pos/portable'}`);
    await page.waitForFunction(() => window.fixtureReady);
    return { page, async close(name) { measurements.push({ name, ...await page.evaluate(() => window.snapshot()) }); await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
  } catch (error) { await browser?.close(); await new Promise(resolve => server.close(resolve)); throw error; }
}
const skip = process.env.PORTABLE_ADMISSION_FIXTURE_ONLY === '1';

test('fresh Portable guest retains sign-in inputs without protected lease checks or delayed preparation', { skip, timeout: 20000 }, async () => {
  const app = await fixture();
  try {
    // Set before checking visibility so the broken baseline reports its reload
    // count instead of timing out trying to fill a form already hidden by Activity.
    await app.page.getByLabel('POS ID').evaluate(input => { input.value = 'fixture-unsaved-pos'; });
    await app.page.evaluate(() => { window.lifecycle('focus'); window.lifecycle('online'); window.lifecycle('reylumi:foreground'); });
    await app.page.waitForTimeout(3900);
    const state = await app.page.evaluate(() => window.snapshot());
    assert.equal(state.reloads, 0, 'expected missing POS credentials must not become a resource-recovery reload');
    assert.equal(state.requests.filter(row => row.kind === 'lease').length, 0);
    assert.equal(state.workerRegistrations, 0, 'delayed worker preparation must be gated too');
    assert.equal(await app.page.getByLabel('POS ID').inputValue(), 'fixture-unsaved-pos');
    assert.equal(await app.page.getByText('Your access has changed. Reload to continue.').count(), 0);
  } finally { await app.close('fresh-guest'); }
});

test('same-path POS login activates optional checks under guest root identity and sign-out stops them', { skip, timeout: 20000 }, async () => {
  const app = await fixture();
  try {
    await app.page.getByRole('button', { name: 'Fixture sign in', exact: true }).click();
    await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease' && row.status === 200));
    await app.page.getByLabel('POS draft').fill('retained POS input');
    await app.page.evaluate(() => window.validateRequired());
    await app.page.waitForFunction(() => !!document.querySelector('[data-private]') && document.querySelector('[data-private]').checkVisibility());
    assert.equal(await app.page.getByLabel('POS draft').inputValue(), 'retained POS input');
    await app.page.getByRole('button', { name: 'Fixture sign out', exact: true }).click();
    await app.page.getByLabel('POS ID').waitFor();
    const previous = await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length);
    await app.page.evaluate(() => { window.lifecycle('focus'); window.lifecycle('online'); });
    await app.page.waitForTimeout(100);
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length), previous);
    assert.equal(await app.page.evaluate(() => window.fixture.reloads), 0);
  } finally { await app.close('same-path-login-signout'); }
});

for (const status of [401, 403]) test(`admitted Portable ${status} still locks and recovers even before its first accepted lease`, { skip, timeout: 15000 }, async () => {
  const app = await fixture({ signedIn: true, leaseStatus: status });
  try {
    await app.page.waitForFunction(() => window.fixture.reloads === 1);
    const state = await app.page.evaluate(() => window.snapshot());
    assert.ok(state.locks >= 1);
    assert.ok(state.requests.some(row => row.kind === 'context' && row.status === 200));
    assert.equal(await app.page.locator('[data-private]').isVisible(), false);
    assert.equal(await app.page.evaluate(() => JSON.parse(sessionStorage.getItem('reylumi:experience-reload:v1')).reason), 'resource');
  } finally { await app.close(`admitted-denial-${status}`); }
});

test('same-path POS scope replacement aborts stale optional authorization; online lock survives Activity reveal', { skip, timeout: 15000 }, async () => {
  const app = await fixture({ signedIn: true, holdLease: true });
  try {
    await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease'));
    await app.page.evaluate(() => window.replacePOS());
    await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease' && row.scope.endsWith('pos-a') && row.aborted) && window.fixture.requests.some(row => row.kind === 'lease' && row.scope.endsWith('pos-b')));
    await app.page.evaluate(() => window.dispatchEvent(new Event('kingpos:portable-lock')));
    await app.page.waitForFunction(() => window.fixture.requests.filter(row => row.kind === 'lease').every(row => row.aborted));
    const count = await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length);
    await app.page.evaluate(() => window.setVisible(false));
    await app.page.waitForTimeout(30);
    await app.page.evaluate(() => window.setVisible(true));
    await app.page.waitForTimeout(100);
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length), count);
  } finally { await app.close('scope-replacement-lock'); }
});

test('nonportable public guest Explore remains eligible for its public offline lease', { skip, timeout: 15000 }, async () => {
  const app = await fixture({ path: '/explore' });
  try {
    await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease' && row.status === 200));
    assert.equal(await app.page.locator('[data-public]').isVisible(), true);
    assert.equal(await app.page.evaluate(() => window.fixture.reloads), 0);
  } finally { await app.close('public-guest'); }
});

test('owner account without POS admission and a public display token do not request private POS leases', { skip, timeout: 15000 }, async () => {
  for (const options of [{ account: true }, { path: '/pos/customer-display?token=synthetic-public-display' }]) {
    const app = await fixture(options);
    try {
      await app.page.evaluate(() => { window.lifecycle('focus'); window.lifecycle('online'); });
      await app.page.waitForTimeout(150);
      assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(row => row.kind === 'lease').length), 0);
      assert.equal(await app.page.evaluate(() => window.fixture.reloads), 0);
      assert.equal(await app.page.locator(options.account ? '[data-portable-login]' : '[data-public]').isVisible(), true);
    } finally { await app.close(options.account ? 'owner-without-pos' : 'public-display'); }
  }
});

test('revoked offline-enabled POS does not rearm preparation after Activity hides and reveals the same shell', { skip, timeout: 15000 }, async () => {
  const app = await fixture({ signedIn: true, offlineEnabled: true });
  try {
    await app.page.waitForFunction(() => window.fixture.requests.some(row => row.kind === 'lease' && row.status === 200));
    await app.page.evaluate(() => window.dispatchEvent(new Event('kingpos:portable-lock')));
    await app.page.waitForTimeout(100);
    await app.page.evaluate(() => window.setVisible(false));
    await app.page.waitForTimeout(30);
    await app.page.evaluate(() => window.setVisible(true));
    await app.page.waitForTimeout(100);
    const before = await app.page.evaluate(() => window.snapshot());
    await app.page.evaluate(() => window.lifecycle('online'));
    await app.page.waitForTimeout(3800);
    const after = await app.page.evaluate(() => window.snapshot());
    assert.equal(after.workerRegistrations, before.workerRegistrations, 'a revoked old scope must not prepare again on online or its rearmed timer');
    assert.equal(after.requests.filter(row => row.kind === 'lease').length, before.requests.filter(row => row.kind === 'lease').length);
    assert.equal(after.reloads, 0);
  } finally { await app.close('revoked-offline-preparation'); }
});
