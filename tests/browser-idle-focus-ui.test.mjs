import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

test('ordinary browser focus preserves the admitted view while real resume and revocation keep their gates', { timeout: 90_000 }, async t => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{ExperienceScopeProvider}from'./components/experience-scope';
    import{ExperiencePageBoundary}from'./components/experience-page-boundary';
    window.fixturePath=new URLSearchParams(location.search).get('view')||'/salon-profile';
    window.diag={mounts:0,cleanups:0,refreshes:0,reloads:0,resumes:[],resets:[],traces:[]};
    window.captureReload=()=>window.diag.reloads++;
    window.current={scope:'account-one',viewerId:'one',workspaceId:'manage:one',salonId:'one',permissionRevision:'one',authenticated:true};
    window.requests=[];window.fetch=(url,options)=>new Promise((resolve,reject)=>window.requests.push({url,options,resolve,reject}));
    window.finish=(index,status=200,changes={})=>window.requests[index].resolve(new Response(JSON.stringify({...window.current,...changes}),{status,headers:{'Content-Type':'application/json'}}));
    window.clock=Date.now();Date.now=()=>window.clock;window.advance=ms=>window.clock+=ms;
    window.testVisibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.testVisibility});
    window.setVisibility=(state,notify=true)=>{window.testVisibility=state;if(notify)document.dispatchEvent(new Event('visibilitychange'))};
    window.testOnline=true;Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.testOnline});
    function Probe(){useEffect(()=>{window.diag.mounts++;return()=>window.diag.cleanups++},[]);return <section data-private><input aria-label="Draft" defaultValue="saved"/><details><summary>Detail</summary><p>Retained detail</p></details></section>}
    function App(){const[visible,setVisible]=useState(true);useEffect(()=>{window.setRouteVisible=setVisible;window.ready=true},[]);return <Activity mode={visible?'visible':'hidden'}><ExperienceScopeProvider context={window.current}><ExperiencePageBoundary renderRevision="server-one"><Probe/></ExperiencePageBoundary></ExperienceScopeProvider></Activity>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: 'bundle.js', bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'browser-focus-fixture', setup(b) {
    // Exercise the actual provider, boundary, route policy and bounded GET. Only
    // external transports/UI are substituted; capture navigation instead of
    // replacing the document and shorten retry delays for deterministic tests.
    b.onLoad({ filter: /components[\\/]experience-scope\.tsx$/ }, args => ({ resolveDir: process.cwd(), loader: 'tsx', contents: readFileSync(args.path, 'utf8')
      .replaceAll('window.location.reload();', 'window.captureReload();')
      .replace('const RETRY_DELAYS = [1_000, 3_000, 8_000];', 'const RETRY_DELAYS = [20, 40, 60];')
      .replaceAll('timeoutMs: 8_000', 'timeoutMs: 500').replaceAll('totalTimeoutMs: 8_000', 'totalTimeoutMs: 500') }));
    b.onResolve({ filter: /^(next\/navigation|.*reset-experience-cache|.*experience-resource-cache|.*loading-feedback|.*workspace-language|.*experience-offline-client|.*experience-persistent-cache|.*offline-network-form-guard|.*prepared-read-view-refresh|.*experience-trace|.*portable-offline-admission)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir: process.cwd(), loader: 'tsx', contents:
      path === 'next/navigation' ? `const router={refresh(){window.diag.refreshes++}};const search=new URLSearchParams();export const useRouter=()=>router;export const usePathname=()=>window.fixturePath;export const useSearchParams=()=>search;`
      : path.endsWith('reset-experience-cache') ? `export const resetExperienceCaches=options=>{window.diag.resets.push(options);window.testLease=null;};`
      : path.endsWith('experience-resource-cache') ? `export const resumeExperienceResources=scope=>window.diag.resumes.push(scope);`
      : path.endsWith('loading-feedback') ? `export const PageLoadingSkeleton=()=> <div data-guard>Checking access</div>;`
      : path.endsWith('workspace-language') ? `export const WorkspaceText=({text})=><>{text}</>;`
      : path.endsWith('experience-offline-client') ? `
        export const getExperienceOfflineAuthorizationPath=()=>window.testLease?window.fixturePath:null;
        export const installExperienceOfflineNavigation=()=>()=>{};
        export const lockExperienceOffline=()=>{window.testLease=null;return Promise.resolve(true)};
        export const prepareExperienceOfflinePath=()=>Promise.resolve(null);
        export const readExperienceOfflineBootGrant=()=>({present:false,grant:null});
        export const refreshExperienceOfflineAuthorization=()=>Promise.resolve(null);
        export const releaseExperienceOfflineBootGuard=()=>{};
        export const restoreExperienceOfflineAuthorization=()=>Promise.resolve(window.testLease??null);
        export const waitForExperienceOfflineLock=()=>Promise.resolve(true);`
      : path.endsWith('experience-persistent-cache') ? `export const EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT='fixture-offline-authorization';export const getExperienceOfflineGrantForPath=()=>window.testLease?.expiresAt>Date.now()?window.testLease:null;export const markExperienceScopeOnlineValidated=()=>{};`
      : path.endsWith('offline-network-form-guard') ? `export const OfflineNetworkFormGuard=()=>null;`
      : path.endsWith('prepared-read-view-refresh') ? `export const PreparedReadViewRefresh=()=>null;`
      : path.endsWith('experience-trace') ? `export const installExperienceTraceLifecycle=()=>{};export const nextExperienceTraceOperation=()=>1;export const recordExperienceTrace=(kind,detail)=>window.diag.traces.push({kind,...detail});`
      : `export const getPortableOfflineAdmission=()=>null;export const getServerPortableOfflineAdmission=()=>null;export const subscribePortableOfflineAdmission=()=>()=>{};`
    }));
  } }] });
  const js = result.outputFiles[0].text;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? js : '<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const useWebKit = process.env.TEST_BROWSER_ENGINE === 'webkit';
  const browser = await (useWebKit ? webkit : chromium).launch({ executablePath: process.env.TEST_BROWSER_PATH, ...(useWebKit ? {} : { args: ['--no-proxy-server'], channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome' }), headless: true });
  const errors = [];
  const open = async (view = '/salon-profile') => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/?view=${encodeURIComponent(view)}`);
    await page.waitForFunction(() => window.ready && window.diag.mounts === 1);
    await page.getByLabel('Draft').fill('unsaved draft');
    await page.evaluate(() => { window.original = document.querySelector('[data-private]'); window.original.querySelector('details').open = true; });
    return page;
  };
  const settle = page => page.waitForTimeout(40);
  const retained = async page => {
    assert.equal(await page.locator('[data-private]').isVisible(), true);
    assert.equal(await page.getByLabel('Draft').inputValue(), 'unsaved draft');
    assert.deepEqual(await page.evaluate(() => ({ same: window.original === document.querySelector('[data-private]'), detail: window.original.querySelector('details').open, mounts: window.diag.mounts, cleanups: window.diag.cleanups, refreshes: window.diag.refreshes, reloads: window.diag.reloads })), { same: true, detail: true, mounts: 1, cleanups: 0, refreshes: 0, reloads: 0 });
  };
  try {
    for (const view of ['/salon-profile', '/account/edit']) await t.test(`31-second continuously visible focus retains ${view} before and after matching authority`, async () => {
      const page = await open(view);
      try {
        await page.evaluate(() => { window.advance(31_000); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
        await page.waitForFunction(() => window.requests.length === 1);
        await retained(page);
        assert.deepEqual(await page.evaluate(() => ({ url: window.requests[0].url, method: window.requests[0].options.method ?? 'GET', cache: window.requests[0].options.cache, credentials: window.requests[0].options.credentials })), { url: '/api/experience/context', method: 'GET', cache: 'no-store', credentials: 'same-origin' });
        await page.evaluate(() => window.finish(0));
        await settle(page);
        await retained(page);
        assert.equal(await page.evaluate(() => window.requests.length), 1);
      } finally { await page.close(); }
    });

    for (const first of ['focus', 'visible']) await t.test(`actual hidden resume stays gated with ${first} first`, async () => {
      const page = await open('/staff/today');
      try {
        await page.evaluate(first => {
          window.advance(31_000); window.setVisibility('hidden'); window.setVisibility('visible', false);
          if (first === 'focus') { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }
          else { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); }
        }, first);
        await page.waitForFunction(() => window.requests.length === 1);
        assert.equal(await page.locator('[data-private]').isVisible(), false);
        await page.evaluate(() => window.finish(0)); await settle(page);
        assert.equal(await page.locator('[data-private]').isVisible(), true);
        assert.equal(await page.getByLabel('Draft').inputValue(), 'unsaved draft');
        assert.equal(await page.evaluate(() => window.diag.reloads), 0);
      } finally { await page.close(); }
    });

    await t.test('hidden resume promotes a pending focus GET to a blocking joined check', async () => {
      const page = await open('/staff/today');
      try {
        await page.evaluate(() => { window.advance(31_000); window.dispatchEvent(new Event('focus')); });
        await page.waitForFunction(() => window.requests.length === 1); await retained(page);
        await page.evaluate(() => { window.setVisibility('hidden'); window.setVisibility('visible'); window.dispatchEvent(new Event('focus')); });
        await settle(page);
        assert.equal(await page.locator('[data-private]').isVisible(), false);
        assert.equal(await page.evaluate(() => window.requests.length), 1, 'resume joins the pending GET instead of duplicating it');
        await page.evaluate(() => window.finish(0)); await settle(page);
        assert.equal(await page.locator('[data-private]').isVisible(), true);
      } finally { await page.close(); }
    });

    await t.test('native foreground and retained route reveal do not take the ordinary focus path', async () => {
      const page = await open('/staff/today');
      try {
        await page.evaluate(() => { window.advance(31_000); window.dispatchEvent(new Event('focus')); });
        await page.waitForFunction(() => window.requests.length === 1);
        await page.evaluate(() => window.dispatchEvent(new Event('reylumi:foreground'))); await settle(page);
        assert.equal(await page.locator('[data-private]').isVisible(), false);
        assert.equal(await page.evaluate(() => window.requests.length), 1);
        await page.evaluate(() => window.finish(0)); await settle(page);
        await page.evaluate(() => window.setRouteVisible(false)); await settle(page);
        await page.evaluate(() => window.setRouteVisible(true));
        await page.waitForFunction(() => window.requests.length === 2);
        assert.equal(await page.locator('[data-private]').isVisible(), false);
        await page.evaluate(() => window.finish(1)); await settle(page);
        assert.equal(await page.locator('[data-private]').isVisible(), true);
      } finally { await page.close(); }
    });

    for (const failure of [401, 403, 'identity']) await t.test(`ordinary focus still revokes immediately for ${failure}`, async () => {
      const page = await open();
      try {
        await page.evaluate(() => { window.advance(31_000); window.dispatchEvent(new Event('focus')); });
        await page.waitForFunction(() => window.requests.length === 1); await retained(page);
        await page.evaluate(failure => window.finish(0, typeof failure === 'number' ? failure : 200, failure === 'identity' ? { scope: 'new-account', permissionRevision: 'new-grants' } : {}), failure);
        await page.waitForFunction(() => window.diag.reloads === 1);
        assert.equal(await page.locator('[data-private]').isVisible(), false);
        assert.equal(await page.evaluate(() => window.diag.resumes.length), 0);
        assert.equal(await page.evaluate(() => window.diag.resets.at(-1).reason), failure === 'identity' ? 'identity' : 'permissions');
      } finally { await page.close(); }
    });

    await t.test('temporary focus failure retains the view; a later real resume remains blocking within its retry budget', async () => {
      const page = await open('/staff/today');
      try {
        await page.evaluate(() => { window.advance(31_000); window.dispatchEvent(new Event('focus')); });
        await page.waitForFunction(() => window.requests.length === 1);
        await page.evaluate(() => window.finish(0, 503)); await settle(page); await retained(page);
        assert.equal(await page.evaluate(() => window.requests.length), 1, 'background failure does not start a retry loop');
        await page.evaluate(() => { window.setVisibility('hidden'); window.setVisibility('visible'); });
        await page.waitForFunction(() => window.requests.length === 2);
        assert.equal(await page.locator('[data-private]').isVisible(), false);
        await page.evaluate(() => window.finish(1, 503));
        await page.waitForFunction(() => window.diag.traces.some(row => row.kind === 'timer.schedule' && row.reason === 'transient'));
        await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await settle(page);
        assert.equal(await page.locator('[data-private]').isVisible(), false, 'focus cannot downgrade the existing retry gate');
        await page.waitForFunction(() => window.requests.length === 3);
        await page.evaluate(() => window.finish(2)); await settle(page);
        assert.equal(await page.locator('[data-private]').isVisible(), true);
        assert.equal(await page.evaluate(() => window.diag.reloads), 0);
      } finally { await page.close(); }
    });

    for (const event of ['reylumi:experience-reset', 'reylumi:experience-access-changed']) await t.test(`late focus result cannot release ${event}`, async () => {
      const page = await open('/staff/today');
      try {
        await page.evaluate(() => { window.advance(31_000); window.dispatchEvent(new Event('focus')); });
        await page.waitForFunction(() => window.requests.length === 1);
        await page.evaluate(event => { window.dispatchEvent(new CustomEvent(event, { detail: { scope: window.current.scope } })); window.dispatchEvent(new Event('focus')); }, event);
        await page.waitForFunction(() => window.requests.length === 2);
        assert.equal(await page.locator('[data-private]').isVisible(), false);
        assert.equal(await page.evaluate(() => window.requests[0].options.signal.aborted), true);
        await page.evaluate(() => window.finish(0, 200, { scope: 'stale-other-account' })); await settle(page);
        assert.deepEqual(await page.evaluate(() => ({ reloads: window.diag.reloads, resumes: window.diag.resumes })), { reloads: 0, resumes: [] });
        assert.equal(await page.locator('[data-private]').isVisible(), false);
        await page.evaluate(() => window.finish(1)); await settle(page);
        if (event.endsWith('access-changed')) {
          assert.equal(await page.evaluate(() => window.diag.reloads), 1);
          assert.equal(await page.locator('[data-private]').isVisible(), false);
        } else assert.equal(await page.locator('[data-private]').isVisible(), true);
      } finally { await page.close(); }
    });

    await t.test('a stale pre-mutation focus result cannot invalidate the new validation epoch', async () => {
      const page = await open('/staff/today');
      try {
        await page.evaluate(() => { window.advance(31_000); window.dispatchEvent(new Event('focus')); });
        await page.waitForFunction(() => window.requests.length === 1);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:experience-mutation', { detail: { scope: window.current.scope } })));
        await page.waitForFunction(() => window.requests.length === 2); await retained(page);
        await page.evaluate(() => window.finish(0, 200, { scope: 'old-epoch' })); await settle(page);
        assert.equal(await page.evaluate(() => window.diag.reloads), 0);
        await page.evaluate(() => window.finish(1)); await settle(page); await retained(page);
        assert.deepEqual(await page.evaluate(() => window.diag.resumes), ['account-one']);
      } finally { await page.close(); }
    });

    await t.test('existing display-lease and offline checks keep their original admission behavior', async () => {
      const page = await open('/staff/today');
      try {
        await page.evaluate(() => { window.testLease = { expiresAt: Date.now() + 60_000 }; window.advance(31_000); window.setVisibility('hidden'); window.setVisibility('visible'); });
        await page.waitForFunction(() => window.requests.length === 1); await retained(page);
        await page.evaluate(() => window.finish(0)); await settle(page); await retained(page);
        await page.evaluate(() => { window.testOnline = false; window.advance(31_000); window.dispatchEvent(new Event('focus')); });
        await settle(page); await retained(page);
        assert.equal(await page.evaluate(() => window.requests.length), 1, 'offline focus does not send a GET');
        await page.evaluate(() => { window.testOnline = true; window.testLease = null; window.setVisibility('hidden'); window.setVisibility('visible'); });
        await page.waitForFunction(() => window.requests.length === 2);
        assert.equal(await page.locator('[data-private]').isVisible(), false, 'a missing lease does not grant a resumed private view');
        await page.evaluate(() => window.finish(1)); await settle(page);
      } finally { await page.close(); }
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
