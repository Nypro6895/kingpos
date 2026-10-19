import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, posix, relative, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

const cwd = process.cwd(), engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const evidenceDirectory = resolve(process.env.CACHE_HISTORY_ARTIFACT_DIR || 'artifacts/auth-workspace-cache-repair-20261018');
const preCache = 'cc53062ca58795e37ab62269655bea73f4902241';
const firstCache = '0dbd5f8d747c04d5e5454dc42fbf3ee64212816f';
const variants = [
  { name: 'first-cache', revision: firstCache },
  { name: 'shipped-build37', revision: 'ea618840b71e35fbd54bd31532f2676d6fd895a6' },
  { name: 'instrumented-before-repair', revision: '2ef993bb88d368d7e318b0965f5193db2a9f6ec0' },
  { name: 'repair-working-source', revision: null },
];
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const historyAvailable = [preCache, ...variants.map(variant => variant.revision).filter(Boolean)].every(revision => {
  try { execFileSync('git', ['cat-file', '-e', revision], { cwd, stdio: 'ignore' }); return true; } catch { return false; }
});
const skipBrowser = !historyAvailable ? 'Historical comparison requires the exact Git revisions (not a shallow source-only checkout)' : !existsSync(engine === 'webkit' ? webkit.executablePath() : browserPath) ? `No ${engine} browser installed` : false;
const results = [];
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const hash = text => createHash('sha256').update(text).digest('hex');

after(() => {
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(resolve(evidenceDirectory, `cache-history-${engine}.json`), JSON.stringify({
    engine, capturedAt: new Date().toISOString(), preCache, firstCache,
    method: 'Exact historical browser modules via git show, current React/browser for all variants, identical pre-authorized SSR fixture and controlled read transport. Actual provider, retained boundary, resource hook, offline runtime/persistent cache and refresh scheduler remain real. Only Next navigation side effects, presentation, service-worker registration and upstream network are fixtures.',
    controlledNetwork: { contextDelayMs: 220, leaseDelayMs: 50, leaseStatus: 503, dataDelayMs: 35 },
    limitations: [
      'Durations start after the local document is delivered; no historical SSR, Supabase, production auth, financial calculation or full app bundle performance is measured.',
      'The small synthetic read consumer tests shared loading/cache mechanics, not historical Today server report cost or every legacy page client.',
      'Pre-cache parent has no comparable scoped cache/provider/boundary. Its missing implementation is recorded, not simulated.',
      'Activity reveal is controlled; this is not a full Next router navigation benchmark.',
      'Logical idle advances Date.now only; durations and transport waits use real performance.now.',
      'Browser evidence is not physical iPhone, WebKit memory termination, native cold-start or production performance evidence.',
      'Repair-working-source hashes freeze the tested modules only; a later edit requires rerunning this comparison.',
    ],
    results,
  }, null, 2));
});

async function compile(variant) {
  const tree = variant.revision ? new Set(git('ls-tree', '-r', '--name-only', variant.revision).split('\n')) : null;
  const hasOffline = tree ? tree.has('lib/experience-persistent-cache.ts') : existsSync(resolve(cwd, 'lib/experience-persistent-cache.ts'));
  const loaded = new Map();
  const read = file => variant.revision ? git('show', `${variant.revision}:${file}`) : readFileSync(resolve(cwd, file), 'utf8');
  const output = await build({
    stdin: { loader: 'tsx', resolveDir: cwd, contents: `
      import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
      import{ExperienceScopeProvider}from'./components/experience-scope';
      import{ExperiencePageBoundary}from'./components/experience-page-boundary';
      import{useExperienceResource}from'./lib/use-experience-resource';
      import{experienceResourceCache}from'./lib/experience-resource-cache';
      ${hasOffline ? "import{acceptExperienceOfflineGrant,getExperienceDeviceGeneration}from'./lib/experience-persistent-cache';" : ''}
      const context={scope:'synthetic-scope',viewerId:'synthetic-viewer',workspaceId:'synthetic-workspace',salonId:'synthetic-salon',permissionRevision:'synthetic-permission',authenticated:true};
      window.measurement={requests:[],frames:[],instances:0,reloads:0,routeRefreshes:0};
      const begun=performance.now();
      const grant=(path,generation)=>({version:1,scope:context.scope,scopes:[context.scope],viewerId:context.viewerId,workspaceId:context.workspaceId,salonId:context.salonId,grantRevision:'synthetic-revision',generation,issuedAt:Date.now(),expiresAt:Date.now()+3600000,path,kind:'owner'});
      ${hasOffline ? "window.seedOtherPath=()=>acceptExperienceOfflineGrant(grant('/market',getExperienceDeviceGeneration()));" : ''}
      const loop=()=>{const node=document.querySelector('[data-useful]');const visible=Boolean(node&&node.getClientRects().length);const last=window.measurement.frames.at(-1);if(!last||last.visible!==visible)window.measurement.frames.push({atMs:performance.now()-begun,visible});requestAnimationFrame(loop)};requestAnimationFrame(loop);
      window.fetch=(input,init={})=>{
        const url=new URL(input instanceof Request?input.url:String(input),location.href);
        const kind=url.pathname==='/api/experience/context'?'context':url.pathname==='/api/experience/offline-context'?'lease':url.pathname==='/fixture-data'?'data':'other';
        const entry={kind,atMs:performance.now()-begun,status:null,aborted:false};window.measurement.requests.push(entry);
        return new Promise((accept,reject)=>{
          let settled=false;
          const abort=()=>{if(settled)return;settled=true;clearTimeout(timer);entry.aborted=true;entry.durationMs=performance.now()-begun-entry.atMs;reject(new DOMException('Synthetic cancellation','AbortError'))};
          const timer=setTimeout(()=>{if(settled)return;settled=true;init.signal?.removeEventListener('abort',abort);entry.status=kind==='lease'?window.historyNetwork.leaseStatus:200;entry.durationMs=performance.now()-begun-entry.atMs;accept(new Response(JSON.stringify(kind==='context'?context:kind==='data'?{value:'same-authorized-data'}:entry.status===200?grant(url.searchParams.get('path'),url.searchParams.get('generation')):{error:'Synthetic unavailable'}),{status:entry.status,headers:{'content-type':'application/json'}}));},kind==='context'?220:kind==='lease'?50:kind==='data'?35:1);
          if(init.signal?.aborted)abort();else init.signal?.addEventListener('abort',abort,{once:true});
        });
      };
      Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{controller:null,getRegistrations:async()=>[],register:async()=>{throw Error('Synthetic worker unavailable')},addEventListener(){}}});
      const initialData={value:'same-authorized-data'},updatedAt=Date.now();
      function Probe(){
        const[instance]=useState(()=>++window.measurement.instances);
        const resource=useExperienceResource({scope:context.scope,key:'fixture-history-read',initialData,initialUpdatedAt:updatedAt,freshForMs:10000,retainForMs:1800000,fetcher:async({signal})=>({data:await(await fetch('/fixture-data',{signal})).json()})});
        useEffect(()=>{window.fixtureReady=true},[]);
        return resource.data?<section data-useful data-instance={instance}><p>{resource.data.value}</p><input aria-label='Retained draft' defaultValue='initial'/><details><summary>Details</summary><p>Preserved detail</p></details></section>:<p data-missing>Waiting for data</p>;
      }
      function App(){const[visible,show]=useState(true);window.show=show;return <ExperienceScopeProvider context={context}><Activity mode={visible?'visible':'hidden'}><ExperiencePageBoundary renderRevision='synthetic-ssr-frame'><Probe/></ExperiencePageBoundary></Activity></ExperienceScopeProvider>}
      window.snapshot=()=>({...window.measurement,cache:experienceResourceCache.stats()});
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': cwd },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'exact-historical-modules', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'boundary' }));
      builder.onResolve({ filter: /(?:^|\/)loading-feedback$/ }, () => ({ path: 'loading', namespace: 'boundary' }));
      builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'boundary' }));
      builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({ loader: 'tsx', resolveDir: cwd, contents: path === 'navigation'
        ? `const router={refresh(){window.measurement.routeRefreshes++}};const query=new URLSearchParams();export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>query;`
        : path === 'loading' ? `import React from'react';export const PageLoadingSkeleton=()=> <div data-gate>Checking account</div>;`
          : `import React from'react';export const WorkspaceText=({text})=><>{text}</>;export const WorkspaceElement=({as='span',children,...props})=>React.createElement(as,props,children);` }));
      builder.onResolve({ filter: /^(?:@\/|\.)/ }, args => {
        if (!tree || args.importer.includes(`${sep}node_modules${sep}`)) return;
        const importer = args.importer ? relative(cwd, args.importer).split(sep).join('/') : '';
        const base = args.path.startsWith('@/') ? args.path.slice(2) : posix.join(dirname(importer).split(sep).join('/'), args.path);
        const file = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`, `${base}/index.ts`, `${base}/index.tsx`].find(candidate => tree.has(candidate));
        return file ? { path: resolve(cwd, file) } : undefined;
      });
      builder.onLoad({ filter: /\.(?:tsx?|js)$/ }, ({ path }) => {
        const file = relative(cwd, path).split(sep).join('/');
        if (file.startsWith('node_modules/') || file.startsWith('..') || tree && !tree.has(file)) return;
        const original = read(file); loaded.set(file, hash(original));
        return { contents: original.replaceAll('window.location.reload();', 'window.measurement.reloads++;'), loader: file.endsWith('.tsx') ? 'tsx' : file.endsWith('.ts') ? 'ts' : 'js', resolveDir: dirname(path) };
      });
    } }],
  });
  return { script: output.outputFiles[0].text, sourceHashes: Object.fromEntries(loaded), bundleBytes: output.outputFiles[0].contents.length, hasOffline };
}

async function start(variant, browser, network = { leaseStatus: 503 }) {
  const compiled = await compile(variant);
  const server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
    // The cache captures Date.now while its module initializes. Advance the
    // shared clock before imports so auth and resource TTLs see the same idle.
    res.end(req.url === '/app.js' ? compiled.script : `<!doctype html><html><body><div id="root"></div><script>window.historyNetwork=${JSON.stringify(network)};const originalClock=Date.now.bind(Date);let fixtureIdle=0;Date.now=()=>originalClock()+fixtureIdle;window.advanceIdle=ms=>fixtureIdle+=ms;</script><script src="/app.js"></script></body></html>`);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done)); server.unref();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/staff/today`);
    await page.waitForFunction(() => window.fixtureReady);
    await page.locator('[data-useful]').waitFor({ state: 'visible' });
    return { page, compiled, async close() { await page.close(); await new Promise(done => server.close(done)); assert.deepEqual(errors, []); } };
  } catch (error) { await page.close(); await new Promise(done => server.close(done)); throw error; }
}

test('historical boundary has exact pre-cache parent and absent comparable native/scoped clients', { skip: !historyAvailable && 'Exact historical Git revisions unavailable' }, () => {
  assert.equal(git('rev-parse', `${firstCache}^`).trim(), preCache);
  const parentTree = new Set(git('ls-tree', '-r', '--name-only', preCache).split('\n'));
  for (const file of ['components/experience-scope.tsx', 'lib/experience-resource-cache.ts', 'lib/use-experience-resource.ts', 'app/local-app/entry.tsx']) assert.equal(parentTree.has(file), false, file);
  results.push({ variant: 'pre-cache-parent', revision: preCache, browserComparison: 'incompatible: no scoped provider/resource hook/retained boundary; historical SSR costs not measured', nativeComparison: 'incompatible: installed local-app entry absent' });
});

for (const variant of variants) test(`${variant.name}: first frame, fresh revisit, visible idle touch and lifecycle burst`, { timeout: 70000, skip: skipBrowser }, async () => {
  const browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] }));
  let app;
  try {
    app = await start(variant, browser);
    const { page } = app;
    await page.waitForTimeout(100);
    const first = await page.evaluate(() => window.snapshot());
    assert.equal(first.requests.filter(row => row.kind === 'context').length, 0, 'Fresh SSR authority does not need another context HTTP read');
    assert.equal(first.requests.filter(row => row.kind === 'data').length, 0, 'Already loaded fresh data is reused');
    await page.getByLabel('Retained draft').fill('preserved edit');
    await page.evaluate(() => { window.originalNode = document.querySelector('[data-useful]'); window.originalNode.querySelector('details').open = true; window.show(false); });
    await page.waitForTimeout(30); await page.evaluate(() => window.show(true));
    await page.locator('[data-useful]').waitFor({ state: 'visible' }); await page.waitForTimeout(90);
    const revisit = await page.evaluate(() => ({ ...window.snapshot(), retained: window.originalNode === document.querySelector('[data-useful]'), draft: document.querySelector('input').value, detail: document.querySelector('details').open }));
    assert.equal(revisit.retained, true); assert.equal(revisit.draft, 'preserved edit'); assert.equal(revisit.detail, true);
    assert.equal(revisit.requests.filter(row => row.kind === 'context').length, 0);
    assert.equal(revisit.requests.filter(row => row.kind === 'data').length, 0);
    await page.evaluate(() => { window.advanceIdle(31000); document.querySelector('[data-useful] p').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await page.waitForTimeout(40);
    const touch = await page.evaluate(() => window.snapshot());
    assert.equal(touch.requests.filter(row => row.kind === 'context').length, 0, 'Visible idle touch is not a foreground authorization event');
    await page.evaluate(() => { window.burstStartedAt = performance.now(); for (const name of ['focus', 'online', 'reylumi:foreground']) window.dispatchEvent(new Event(name)); });
    await page.waitForTimeout(120);
    const during = await page.locator('[data-useful]').isVisible();
    await page.waitForTimeout(400); await page.locator('[data-useful]').waitFor({ state: 'visible' });
    const after = await page.evaluate(() => ({ ...window.snapshot(), retained: window.originalNode === document.querySelector('[data-useful]'), draft: document.querySelector('input').value }));
    assert.equal(after.retained, true); assert.equal(after.draft, 'preserved edit'); assert.equal(after.reloads, 0);
    const count = snapshot => Object.fromEntries(['context', 'lease', 'data'].map(kind => [kind, snapshot.requests.filter(row => row.kind === kind).length]));
    assert.equal(during, false, 'Missing lease continues to gate stale authority');
    assert.deepEqual(count(after), { context: 1, lease: variant.name === 'first-cache' ? 0 : variant.revision ? 4 : 2, data: 1 }, 'One stale-data read, joined context and version-specific lease fan-out');
    results.push({ scenario: 'fresh-SSR-revisit-idle-lifecycle', variant: variant.name, revision: variant.revision ?? git('rev-parse', 'HEAD').trim(), workingSource: variant.revision === null, sourceHashes: app.compiled.sourceHashes, fixtureBundleBytes: app.compiled.bundleBytes, firstUsefulMs: first.frames.find(row => row.visible)?.atMs ?? null, visibleDuringHeldAuth: during, firstCounts: count(first), freshRevisitCounts: count(revisit), idleTouchCounts: count(touch), lifecycleBurstCounts: count(after), draftRetained: after.retained && after.draft === 'preserved edit', after });
  } finally { await app?.close(); await browser.close(); }
});

for (const variant of variants.slice(1)) test(`${variant.name}: an existing exact Today lease survives a newer same-scope other-path lease`, { timeout: 70000, skip: skipBrowser }, async () => {
  const browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] }));
  let app;
  try {
    app = await start(variant, browser, { leaseStatus: 200 });
    const { page } = app;
    await page.waitForTimeout(150);
    await page.getByLabel('Retained draft').fill('preserved edit');
    await page.evaluate(async () => { await window.seedOtherPath(); window.historyNetwork.leaseStatus = 503; window.advanceIdle(31000); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(120);
    const visibleDuringHeldAuth = await page.locator('[data-useful]').isVisible();
    assert.equal(visibleDuringHeldAuth, variant.revision === null, 'Historical latest-only lease gates; repair retains the still-valid exact-path authority');
    await page.waitForTimeout(400); await page.locator('[data-useful]').waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Retained draft').inputValue(), 'preserved edit');
    const after = await page.evaluate(() => window.snapshot());
    assert.equal(after.reloads, 0);
    results.push({ scenario: 'valid-Today-lease-then-other-path', variant: variant.name, revision: variant.revision ?? git('rev-parse', 'HEAD').trim(), workingSource: variant.revision === null, sourceHashes: app.compiled.sourceHashes, visibleDuringHeldAuth, after });
  } finally { await app?.close(); await browser.close(); }
});
