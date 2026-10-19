import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const measurements = [];
after(() => {
  const directory = process.env.IDLE_TRACE_ARTIFACT_DIR || resolve('artifacts/idle-cold-start-trace-20261018');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `web-measurements-${engine}.json`), JSON.stringify({
    engine,
    method: 'Local controlled read transport; real ScopeProvider, Activity, PreparedReadViewRefresh, offline client, persistent cache, resource cache and reset coordinator. SSR/auth backend time is not measured. TTL idle is advanced with Date.now; duration measurements use real performance.now. Reload requests are intercepted, not executed.',
    measurements,
  }, null, 2));
});

let compiled;
function compile() {
  compiled ??= build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{Activity,useEffect,useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';
      import{ExperienceScopeProvider,useExperienceScope}from'./components/experience-scope';
      import{acceptExperienceOfflineGrant,getExperienceDeviceGeneration,getExperienceOfflineGrantForPath}from'./lib/experience-persistent-cache';
      import{refreshExperienceOfflineAuthorization,restoreExperienceOfflineAuthorization,lockExperienceOffline}from'./lib/experience-offline-client';
      import{experienceResourceCache}from'./lib/experience-resource-cache';
      import{getExperienceTraceSnapshot,recordExperienceTrace}from'./lib/experience-trace';
      const options=window.fixtureOptions,current={scope:'synthetic-scope',viewerId:'synthetic-viewer',workspaceId:'synthetic-workspace',salonId:'synthetic-salon',permissionRevision:'synthetic-permission',authenticated:true};
      window.fixture={requests:[],reloads:0,routeRefreshes:0,instances:0,documentIdentity:crypto.randomUUID()};
      const makeGrant=(path=location.pathname,expiresIn=3600000)=>({version:1,scope:current.scope,scopes:[current.scope],viewerId:current.viewerId,workspaceId:current.workspaceId,salonId:current.salonId,grantRevision:'synthetic-revision',generation:getExperienceDeviceGeneration(),issuedAt:Date.now(),expiresAt:Date.now()+expiresIn,path,kind:'owner'});
      window.otherPathGrant=()=>acceptExperienceOfflineGrant(makeGrant('/market'));
      window.pathGrant=path=>getExperienceOfflineGrantForPath(current.scope,path);
      window.deviceGeneration=getExperienceDeviceGeneration;
      window.acceptGrant=extra=>acceptExperienceOfflineGrant({...makeGrant(),...extra});
      window.restoreLease=()=>restoreExperienceOfflineAuthorization(current.scope);
      window.lockLease=()=>lockExperienceOffline({rotateGeneration:false});
      window.startLeasePair=()=>{window.leaseControllers=[new AbortController(),new AbortController()];window.leaseResults=window.leaseControllers.map(controller=>refreshExperienceOfflineAuthorization(location.pathname,current.scope,controller.signal));};
      window.readLease=()=>refreshExperienceOfflineAuthorization(location.pathname,current.scope);
      window.fixtureSnapshot=()=>({trace:getExperienceTraceSnapshot(),requests:window.fixture.requests.map(({kind,trigger,status,aborted,durationMs})=>({kind,trigger,status,aborted,durationMs})),reloads:window.fixture.reloads,routeRefreshes:window.fixture.routeRefreshes,instances:window.fixture.instances,cache:experienceResourceCache.stats()});
      window.fireLifecycle=async name=>{window.fixtureCause=name==='reylumi:foreground'?'foreground':name;window.dispatchEvent(new Event(name));await Promise.resolve();await Promise.resolve();window.fixtureCause=undefined};
      window.captureReload=()=>{window.fixture.reloads++};
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{controller:null,getRegistrations:async()=>[],register:async()=>{throw Error('Fixture worker unavailable')},addEventListener(){}}});
      window.fetch=(input,init={})=>{
        const pathname=new URL(input instanceof Request?input.url:String(input),location.href).pathname;
        const kind=pathname==='/api/experience/context'?'context':pathname==='/api/experience/offline-context'?'lease':'other';
        if(kind==='other')return Promise.resolve(new Response('',{status:200}));
        const request={kind,trigger:window.fixtureCause??'mount',status:null,aborted:false,durationMs:0},began=performance.now();window.fixture.requests.push(request);
        return new Promise((accept,reject)=>{
          let settled=false,timer;
          const abort=()=>{if(settled)return;settled=true;request.aborted=true;request.durationMs=performance.now()-began;clearTimeout(timer);reject(new DOMException('Fixture read cancelled','AbortError'))};
          init.signal?.addEventListener('abort',abort,{once:true});
          request.finish=(status=200,extra={})=>{
            if(settled)return;settled=true;clearTimeout(timer);init.signal?.removeEventListener('abort',abort);request.status=status;request.durationMs=performance.now()-began;
            const body=kind==='context'?{...current,...extra}:makeGrant(location.pathname,options.leaseExpiresIn??3600000);
            accept(new Response(JSON.stringify(status===200?body:{error:'Synthetic unavailable'}),{status,headers:{'Content-Type':'application/json'}}));
          };
          if(kind==='lease')timer=setTimeout(()=>request.finish(options.leaseStatus??503),options.leaseDelay??15);
        });
      };
      window.finishContext=(index=0,status=200,extra={})=>window.fixture.requests.filter(request=>request.kind==='context')[index].finish(status,extra);
      if(options.boot){const boot=document.createElement('script');boot.id='reylumi-offline-boot';boot.type='application/json';boot.textContent=JSON.stringify(options.boot==='valid'?makeGrant():{});document.head.append(boot)}
      experienceResourceCache.seed({scope:current.scope,key:'fixture-read'},{value:'retained-data'});
      function Probe(){const scope=useExperienceScope();const[instance]=useState(()=>++window.fixture.instances);useLayoutEffect(()=>{recordExperienceTrace('data.visible',{source:'web',area:'other'});window.forceValidate=()=>scope.validate(true)},[scope.validate]);return <div data-private data-instance={instance}><p>Authorized local fixture</p><input aria-label="Retained draft" defaultValue="initial"/><details><summary>Detail</summary><p>Retained detail</p></details></div>}
      function App(){const[visible,setVisible]=useState(true);useEffect(()=>{window.fixtureReady=true},[]);return <><button onClick={()=>setVisible(value=>!value)}>{visible?'Hide view':'Show view'}</button><Activity mode={visible?'visible':'hidden'}><ExperienceScopeProvider context={current}><Probe/></ExperienceScopeProvider></Activity></>}
      createRoot(document.getElementById('app')).render(<App/>);
    ` },
    write: false, bundle: true, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'controlled-hosted-boundaries', setup(builder) {
      // Only replace navigation's browser side effect, never gate/auth/cache
      // branches, timings, retry budgets or Activity behavior.
      builder.onLoad({ filter: /components[\\/]experience-scope\.tsx$/ }, ({ path }) => ({
        contents: readFileSync(path, 'utf8').replaceAll('window.location.reload();', 'window.captureReload();'),
        loader: 'tsx', resolveDir: process.cwd(),
      }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `const router={refresh(){window.fixture.routeRefreshes++}};const params=new URLSearchParams();export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>params;`, loader: 'js' }));
      builder.onResolve({ filter: /(?:^|\/)loading-feedback$/ }, () => ({ path: 'loading', namespace: 'presentation' }));
      builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'presentation' }));
      builder.onLoad({ filter: /.*/, namespace: 'presentation' }, ({ path }) => ({ loader: 'tsx', resolveDir: process.cwd(), contents: path === 'loading'
        ? `import React from'react';export const PageLoadingSkeleton=()=> <div data-guard>Checking account</div>;`
        : `import React from'react';export const WorkspaceText=({text})=><>{text}</>;export const WorkspaceElement=({as='span',children,...props})=>React.createElement(as,props,children);` }));
    } }],
  });
  return compiled;
}

async function fixture(options = {}) {
  const output = await compile();
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? output.outputFiles[0].text : `<!doctype html><html><head></head><body><div id="app"></div><script>window.__reylumiDiagnosticsEnabled=${options.enabled !== false};window.fixtureOptions=${JSON.stringify(options)};const originalNow=Date.now.bind(Date);let idle=0;Date.now=()=>originalNow()+idle;window.advanceIdle=ms=>{idle+=ms};</script><script src="/app.js"></script></body></html>`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  server.unref();
  let browser;
  try {
    browser = await (engine === 'webkit' ? webkit : chromium).launch({
      headless: true,
      ...(engine === 'webkit' ? {} : { executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome', args: ['--no-proxy-server'] }),
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}${options.path || '/staff/today'}`);
    await page.waitForFunction(() => window.fixtureReady);
    await page.waitForFunction(() => window.fixture.requests.some(request => request.kind === 'lease' && request.status !== null));
    return { page, async close() { await browser.close(); await new Promise(done => server.close(done)); assert.deepEqual(errors, []); } };
  } catch (error) { await browser?.close(); await new Promise(done => server.close(done)); throw error; }
}
async function record(name, page, extra = {}) {
  const data = await page.evaluate(() => window.fixtureSnapshot());
  const gateIntervalsMs = [];
  let hidden;
  for (const entry of data.trace) {
    if (entry.event === 'gate.hide' && hidden === undefined) hidden = entry.atMs;
    if (entry.event === 'gate.show' && hidden !== undefined) { gateIntervalsMs.push(Math.round((entry.atMs - hidden) * 10) / 10); hidden = undefined; }
  }
  measurements.push({ scenario: name, contextRequests: data.requests.filter(request => request.kind === 'context').length, leaseRequests: data.requests.filter(request => request.kind === 'lease').length, gateIntervalsMs, ...extra, ...data });
  return data;
}
async function idleFocus(page) {
  await page.evaluate(() => { window.advanceIdle(31_000); document.activeElement?.blur(); window.fireLifecycle('focus'); });
  await page.waitForFunction(() => window.fixture.requests.some(request => request.kind === 'context'));
}
async function retainDraft(page) {
  await page.getByLabel('Retained draft').fill('retained edit');
  await page.evaluate(() => { window.originalNode = document.querySelector('[data-private]'); window.originalNode.querySelector('details').open = true; });
}
async function assertRetained(page) {
  assert.equal(await page.getByLabel('Retained draft').inputValue(), 'retained edit');
  assert.equal(await page.evaluate(() => document.querySelector('[data-private]') === window.originalNode && window.originalNode.querySelector('details').open), true);
}

test('fresh SSR frame paints without a duplicate context read; lease authorization is separately measured', { timeout: 20000 }, async () => {
  const app = await fixture();
  try {
    assert.equal(await app.page.locator('[data-private]').isVisible(), true);
    const data = await record('fresh-server-frame', app.page);
    assert.equal(data.requests.filter(request => request.kind === 'context').length, 0);
    assert.equal(data.requests.filter(request => request.kind === 'lease').length, 1);
    assert.ok(data.trace.some(entry => entry.event === 'auth.end' && entry.reason === 'grant' && entry.status === 503));
    assert.equal(data.trace.some(entry => entry.event === 'gate.hide'), false);
    assert.equal(data.reloads, 0);
  } finally { await app.close(); }
});

test('logical idle then pointer touch does not reload; focus gates stale authority while retaining actual DOM and data', { timeout: 20000 }, async () => {
  const app = await fixture();
  try {
    await retainDraft(app.page);
    await app.page.evaluate(() => window.advanceIdle(31_000));
    await app.page.locator('[data-private] p').first().click();
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(request => request.kind === 'context').length), 0);
    await app.page.evaluate(() => window.fireLifecycle('focus'));
    await app.page.waitForFunction(() => window.fixture.requests.some(request => request.kind === 'context'));
    await app.page.locator('[data-guard]').waitFor();
    assert.equal(await app.page.locator('[data-private]').isVisible(), false);
    await app.page.waitForTimeout(220);
    await app.page.evaluate(() => window.finishContext());
    await app.page.locator('[data-private]').waitFor({ state: 'visible' });
    await assertRetained(app.page);
    const data = await record('idle-touch-vs-focus-no-lease', app.page, { logicalIdleMs: 31000, controlledHoldMs: 220 });
    assert.equal(data.cache.entries, 1);
    assert.equal(data.reloads, 0);
    assert.equal(data.trace.some(entry => entry.event === 'cache.reset'), false);
    assert.ok(data.trace.some(entry => entry.event === 'gate.hide'));
  } finally { await app.close(); }
});

test('an exact-path valid lease keeps warm content visible during held background auth', { timeout: 20000 }, async () => {
  const app = await fixture({ leaseStatus: 200 });
  try {
    await retainDraft(app.page);
    await idleFocus(app.page);
    await app.page.waitForTimeout(220);
    assert.equal(await app.page.locator('[data-private]').isVisible(), true);
    await app.page.evaluate(() => window.finishContext());
    await app.page.waitForTimeout(30);
    await assertRetained(app.page);
    const data = await record('idle-focus-exact-path-lease', app.page, { logicalIdleMs: 31000, controlledHoldMs: 220 });
    assert.equal(data.trace.some(entry => entry.event === 'gate.hide'), false);
    assert.equal(data.reloads, 0);
  } finally { await app.close(); }
});

test('a valid cached document paints while its cold launch performs context and lease checks', { timeout: 20000 }, async () => {
  const app = await fixture({ boot: 'valid' });
  try {
    await app.page.waitForFunction(() => window.fixture.requests.some(request => request.kind === 'context'));
    assert.equal(await app.page.locator('[data-private]').isVisible(), true);
    await app.page.waitForTimeout(220);
    await app.page.evaluate(() => window.finishContext());
    await app.page.waitForTimeout(30);
    const data = await record('cached-document-cold-launch', app.page, { controlledHoldMs: 220 });
    assert.equal(data.requests.filter(request => request.kind === 'context').length, 1);
    assert.equal(data.requests.filter(request => request.kind === 'lease').length, 1);
    assert.equal(data.trace.some(entry => entry.event === 'gate.hide'), false);
    assert.equal(data.reloads, 0);
  } finally { await app.close(); }
});

test('a newer other-path lease never hides a retained page with its own valid display lease', { timeout: 20000 }, async () => {
  const app = await fixture({ leaseStatus: 200 });
  try {
    await retainDraft(app.page);
    await app.page.evaluate(() => window.otherPathGrant());
    // Keep the focus lease reply unavailable so it cannot replace the other-path
    // grant before the context check makes its independent gate decision.
    await app.page.evaluate(() => { window.fixtureOptions.leaseStatus = 503; });
    await idleFocus(app.page);
    assert.equal(await app.page.locator('[data-private]').isVisible(), true);
    await app.page.waitForTimeout(220);
    await app.page.evaluate(() => window.finishContext());
    await app.page.locator('[data-private]').waitFor({ state: 'visible' });
    await assertRetained(app.page);
    const data = await record('idle-focus-other-path-lease', app.page, { logicalIdleMs: 31000, controlledHoldMs: 220 });
    assert.equal(data.trace.some(entry => entry.event === 'gate.hide'), false);
    assert.equal(data.cache.entries, 1);
    assert.equal(data.reloads, 0);
  } finally { await app.close(); }
});

test('a transient 503 uses the real retry timer without resetting cached data or document', { timeout: 20000 }, async () => {
  const app = await fixture();
  try {
    await retainDraft(app.page);
    await idleFocus(app.page);
    await app.page.evaluate(() => window.finishContext(0, 503));
    await app.page.waitForFunction(() => window.fixture.requests.filter(request => request.kind === 'context').length === 2);
    await app.page.evaluate(() => window.finishContext(1));
    await app.page.locator('[data-private]').waitFor({ state: 'visible' });
    await assertRetained(app.page);
    const data = await record('idle-focus-503-recovery', app.page, { logicalIdleMs: 31000 });
    assert.equal(data.cache.entries, 1);
    assert.equal(data.reloads, 0);
    assert.equal(data.trace.some(entry => entry.event === 'cache.reset'), false);
    assert.ok(data.trace.some(entry => entry.event === 'timer.schedule' && entry.reason === 'transient' && entry.durationMs === 1000));
    assert.ok(data.trace.some(entry => entry.event === 'timer.fire' && entry.reason === 'transient'));
  } finally { await app.close(); }
});

test('an actual context timeout leaves the current exact-path lease and retained view usable after another path was admitted', { timeout: 20000 }, async () => {
  const app = await fixture({ leaseStatus: 200 });
  try {
    await retainDraft(app.page);
    await app.page.evaluate(async () => { await window.otherPathGrant(); window.fixtureOptions.leaseStatus = 503; });
    await idleFocus(app.page);
    await app.page.waitForFunction(() => window.fixture.requests.some(request => request.kind === 'context' && request.aborted), undefined, { timeout: 11000 });
    await app.page.waitForTimeout(50);
    assert.equal(await app.page.locator('[data-private]').isVisible(), true);
    await assertRetained(app.page);
    const data = await record('valid-other-path-context-timeout', app.page, { logicalIdleMs: 31000, configuredContextDeadlineMs: 8000 });
    assert.equal(data.requests.filter(request => request.kind === 'context').length, 1);
    assert.equal(data.trace.some(entry => entry.event === 'gate.hide' || entry.event === 'cache.reset'), false);
    assert.equal(data.cache.entries, 1); assert.equal(data.reloads, 0);
  } finally { await app.close(); }
});

test('one cancelled lease subscriber cannot abort another; all cancelled subscribers abort and allow a fresh subsequent read', { timeout: 20000 }, async () => {
  const app = await fixture({ leaseStatus: 200 });
  try {
    await app.page.evaluate(async () => { await window.readLease(); window.leaseBaseline = window.fixture.requests.filter(request => request.kind === 'lease').length; });
    await app.page.evaluate(() => { window.fixtureOptions.leaseDelay = 250; window.startLeasePair(); });
    await app.page.waitForFunction(() => window.fixture.requests.filter(request => request.kind === 'lease').length === window.leaseBaseline + 1);
    await app.page.evaluate(() => window.leaseControllers[0].abort());
    assert.deepEqual(await app.page.evaluate(async () => (await Promise.all(window.leaseResults)).map(Boolean)), [false, true]);
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(request => request.kind === 'lease' && request.aborted).length), 0);
    await app.page.evaluate(() => window.startLeasePair());
    await app.page.waitForFunction(() => window.fixture.requests.filter(request => request.kind === 'lease').length === window.leaseBaseline + 2);
    await app.page.evaluate(() => window.leaseControllers.forEach(controller => controller.abort()));
    assert.deepEqual(await app.page.evaluate(async () => (await Promise.all(window.leaseResults)).map(Boolean)), [false, false]);
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(request => request.kind === 'lease' && request.aborted).length), 1);
    assert.equal(await app.page.evaluate(async () => Boolean(await window.readLease())), true);
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(request => request.kind === 'lease').length - window.leaseBaseline), 3);
    await record('lease-subscriber-cancellation', app.page);
  } finally { await app.close(); }
});

test('a denied lease settles one replacement context check after synchronous lock and access notifications', { timeout: 20000 }, async () => {
  const app = await fixture({ leaseStatus: 200 });
  try {
    // Await the real serialized grant write, so this denial is a new request
    // rather than legitimately joining the still-settling initial admission.
    await app.page.evaluate(() => window.otherPathGrant());
    await app.page.evaluate(() => { window.fixtureOptions.leaseStatus = 403; });
    await idleFocus(app.page);
    await app.page.waitForFunction(() => window.fixture.requests.some(request => request.kind === 'lease' && request.status === 403));
    await app.page.waitForTimeout(60);
    const data = await record('lease-denial-reset-coalescing', app.page, { logicalIdleMs: 31000 });
    assert.equal(data.requests.filter(request => request.kind === 'context').length, 2, 'initial foreground read plus one replacement; lock and access notifications must coalesce');
    assert.equal(await app.page.locator('[data-private]').isVisible(), false);
    assert.equal(await app.page.evaluate(() => Boolean(window.pathGrant('/staff/today'))), false);
    await app.page.evaluate(() => window.finishContext(1));
    await app.page.waitForFunction(() => window.fixture.reloads === 1);
    assert.equal(await app.page.locator('[data-private]').isVisible(), false, 'a root context cannot revive markup whose path admission was rejected');
  } finally { await app.close(); }
});

test('lock fences a delayed lease read and clears all path authority without accepting its late response', { timeout: 20000 }, async () => {
  const app = await fixture({ leaseStatus: 200 });
  try {
    await app.page.evaluate(async () => { await window.otherPathGrant(); window.fixtureOptions.leaseDelay = 250; window.startLeasePair(); });
    await app.page.waitForFunction(() => window.fixture.requests.filter(request => request.kind === 'lease').length === 2);
    await app.page.evaluate(() => window.lockLease());
    assert.deepEqual(await app.page.evaluate(async () => (await Promise.all(window.leaseResults)).map(Boolean)), [false, false]);
    await app.page.waitForTimeout(300);
    assert.equal(await app.page.evaluate(() => Boolean(window.pathGrant('/staff/today') || window.pathGrant('/market'))), false);
    assert.equal(await app.page.locator('[data-private]').isVisible(), false);
    const data = await record('lease-lock-cancellation', app.page);
    assert.equal(data.requests.filter(request => request.kind === 'lease' && request.aborted).length, 1);
  } finally { await app.close(); }
});

test('grant revision changes revoke every retained path; path storage never broadens scope or expiry', { timeout: 20000 }, async () => {
  const app = await fixture({ leaseStatus: 200 });
  try {
    await app.page.evaluate(() => window.otherPathGrant());
    assert.equal(await app.page.evaluate(() => Boolean(window.pathGrant('/staff/today') && window.pathGrant('/market'))), true);
    assert.equal(await app.page.evaluate(() => window.pathGrant('/customers')), null);
    assert.equal(await app.page.evaluate(() => window.acceptGrant({ grantRevision: 'changed-revision' })), false);
    assert.equal(await app.page.evaluate(() => Boolean(window.pathGrant('/staff/today') || window.pathGrant('/market'))), false);
    assert.equal(await app.page.locator('[data-private]').isVisible(), false);
    await record('path-lease-revision-revocation', app.page);
  } finally { await app.close(); }
});

test('a lock without generation rotation rejects the old DOM boot proof while a fresh endpoint grant can recover', { timeout: 20000 }, async () => {
  const app = await fixture({ boot: 'valid' });
  try {
    await app.page.evaluate(() => window.restoreLease());
    const generation = await app.page.evaluate(() => window.deviceGeneration());
    await app.page.evaluate(() => window.lockLease());
    assert.equal(await app.page.evaluate(() => window.deviceGeneration()), generation);
    assert.equal(await app.page.evaluate(() => window.restoreLease()), null);
    assert.equal(await app.page.evaluate(() => window.pathGrant('/staff/today')), null);
    assert.equal(await app.page.locator('[data-private]').isVisible(), false);
    await app.page.evaluate(() => { window.fixtureOptions.leaseStatus = 200; });
    assert.equal(await app.page.evaluate(async () => Boolean(await window.readLease())), true);
    assert.equal(await app.page.evaluate(async () => Boolean(await window.restoreLease())), true);
    await app.page.waitForFunction(() => window.fixture.requests.filter(request => request.kind === 'context').length === 2);
    await app.page.evaluate(() => window.finishContext(1));
    await app.page.locator('[data-private]').waitFor({ state: 'visible' });
    const data = await record('boot-lock-proof-fence', app.page);
    assert.equal(data.reloads, 0);
  } finally { await app.close(); }
});

test('the real 8s context deadline plus retry delay can hide a cached view for about 9s', { timeout: 25000 }, async () => {
  const app = await fixture();
  try {
    await retainDraft(app.page);
    await idleFocus(app.page);
    await app.page.waitForFunction(() => window.fixture.requests.filter(request => request.kind === 'context').length === 2, undefined, { timeout: 12000 });
    await app.page.evaluate(() => window.finishContext(1));
    await app.page.locator('[data-private]').waitFor({ state: 'visible' });
    await assertRetained(app.page);
    const data = await record('idle-focus-timeout-recovery', app.page, { logicalIdleMs: 31000, configuredContextDeadlineMs: 8000 });
    assert.equal(data.requests.filter(request => request.kind === 'context' && request.aborted).length, 1);
    assert.equal(data.cache.entries, 1);
    assert.equal(data.reloads, 0);
    assert.equal(data.trace.some(entry => entry.event === 'cache.reset'), false);
    assert.ok(data.trace.some(entry => entry.event === 'auth.end' && entry.reason === 'transient' && entry.durationMs >= 7900));
    assert.ok(data.trace.some(entry => entry.event === 'timer.fire' && entry.reason === 'transient'));
  } finally { await app.close(); }
});

test('confirmed changed scope and denial produce an explicit fail-closed reset and reload request', { timeout: 30000 }, async () => {
  for (const scenario of ['scope', 'denial']) {
    const app = await fixture();
    try {
      await idleFocus(app.page);
      await app.page.evaluate(kind => window.finishContext(0, kind === 'denial' ? 403 : 200, kind === 'scope' ? { scope: 'changed-synthetic-scope' } : {}), scenario);
      await app.page.waitForFunction(() => window.fixture.reloads === 1);
      assert.equal(await app.page.locator('[data-private]').isVisible(), false);
      const data = await record(`confirmed-${scenario}`, app.page, { logicalIdleMs: 31000 });
      assert.equal(data.cache.entries, 0);
      assert.equal(data.requests.filter(request => request.kind === 'context').length, 1, 'confirmed denial must not start a reentrant context request while locking');
      assert.ok(data.trace.some(entry => entry.event === 'cache.reset'));
      assert.ok(data.trace.some(entry => entry.event === 'document.reload.request' && entry.reason === (scenario === 'scope' ? 'identity' : 'permissions')));
    } finally { await app.close(); }
  }
});

test('current-path lease expires and remains fail-closed even when another path has a longer lease', { timeout: 20000 }, async () => {
  const app = await fixture({ leaseStatus: 200, leaseExpiresIn: 1000 });
  try {
    await app.page.evaluate(() => window.otherPathGrant());
    await app.page.waitForFunction(() => window.fixture.requests.some(request => request.kind === 'context'));
    await app.page.evaluate(() => window.finishContext());
    await app.page.waitForFunction(() => window.fixture.reloads === 1);
    const data = await record('lease-expiry-no-touch', app.page, { configuredLeaseMs: 1000 });
    assert.ok(data.trace.some(entry => entry.event === 'timer.fire' && entry.reason === 'expired'));
    assert.ok(data.trace.some(entry => entry.event === 'cache.reset' && entry.reason === 'grant'));
    assert.ok(data.trace.some(entry => entry.event === 'document.reload.request' && entry.reason === 'resource'));
    assert.equal(await app.page.locator('[data-private]').isVisible(), false);
  } finally { await app.close(); }
});

test('a former path expiry timer cannot lock the current path with a valid longer lease', { timeout: 20000 }, async () => {
  const app = await fixture({ leaseStatus: 200, leaseExpiresIn: 1000 });
  try {
    await retainDraft(app.page);
    await app.page.evaluate(async () => { await window.otherPathGrant(); history.replaceState(null, '', '/market'); });
    await app.page.waitForTimeout(1200);
    assert.equal(await app.page.evaluate(() => window.pathGrant('/staff/today')), null);
    assert.equal(await app.page.evaluate(() => Boolean(window.pathGrant('/market'))), true);
    assert.equal(await app.page.locator('[data-private]').isVisible(), true);
    await assertRetained(app.page);
    const data = await record('former-path-expiry-current-valid', app.page, { configuredFormerLeaseMs: 1000, controlledWaitMs: 1200 });
    assert.ok(data.trace.some(entry => entry.event === 'timer.fire' && entry.reason === 'expired'));
    assert.equal(data.trace.some(entry => entry.event === 'cache.reset' || entry.event === 'gate.hide'), false);
    assert.equal(data.requests.filter(request => request.kind === 'context').length, 0);
    assert.equal(data.reloads, 0);
  } finally { await app.close(); }
});

test('lifecycle burst joins both context validation and equivalent pending lease reads', { timeout: 20000 }, async () => {
  const app = await fixture();
  try {
    await app.page.evaluate(async () => { window.advanceIdle(31_000); for (const name of ['focus', 'online', 'reylumi:foreground']) await window.fireLifecycle(name); });
    await app.page.waitForFunction(() => window.fixture.requests.filter(request => request.kind === 'lease' && request.status !== null).length === 2);
    assert.equal(await app.page.evaluate(() => window.fixture.requests.filter(request => request.kind === 'context').length), 1);
    await app.page.evaluate(() => window.finishContext());
    await app.page.locator('[data-private]').waitFor({ state: 'visible' });
    const data = await record('lifecycle-burst', app.page, { logicalIdleMs: 31000 });
    assert.equal(data.requests.filter(request => request.aborted).length, 0);
    assert.ok(data.trace.some(entry => entry.event === 'auth.join'));
    assert.equal(data.requests.filter(request => request.kind === 'lease').length, 2);
    assert.deepEqual(data.requests.filter(request => request.kind === 'lease').map(request => request.trigger), ['mount', 'focus']);
    assert.ok(data.trace.filter(entry => entry.event === 'cache.join' && entry.reason === 'grant').length >= 2);
  } finally { await app.close(); }
});

test('prepared read view emits a router refresh rather than a document reload after online validation', { timeout: 20000 }, async () => {
  const app = await fixture({ path: '/my-bookings' });
  try {
    await idleFocus(app.page);
    await app.page.evaluate(() => window.finishContext());
    await app.page.waitForFunction(() => window.fixture.routeRefreshes === 1);
    const data = await record('prepared-read-router-refresh', app.page, { logicalIdleMs: 31000 });
    assert.equal(data.reloads, 0);
    assert.ok(data.trace.some(entry => entry.event === 'cache.refresh' && entry.area === 'other'));
    assert.equal(data.trace.some(entry => entry.event === 'document.reload.request'), false);
  } finally { await app.close(); }
});

test('diagnostics disabled preserves the gate and read behavior without a trace buffer', { timeout: 20000 }, async () => {
  const app = await fixture({ enabled: false });
  try {
    await retainDraft(app.page);
    await idleFocus(app.page);
    await app.page.locator('[data-guard]').waitFor();
    await app.page.evaluate(() => window.finishContext());
    await app.page.locator('[data-private]').waitFor({ state: 'visible' });
    await assertRetained(app.page);
    const data = await record('diagnostics-disabled-parity', app.page, { logicalIdleMs: 31000 });
    assert.deepEqual(data.trace, []);
    assert.equal(data.requests.filter(request => request.kind === 'context').length, 1);
    assert.equal(data.reloads, 0);
    assert.equal(await app.page.evaluate(() => window.__reylumiDiagnostics === undefined), true);
  } finally { await app.close(); }
});
