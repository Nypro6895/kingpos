import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

// Real installed entry/recovery/policy + real context and offline-context route
// functions. Only auth/database authority, native bridge, registry page content,
// and shell resource chrome are fixtures. No business writes or external calls.
const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = engine === 'chromium' && !existsSync(browserPath);
const generation = 'page-admission-fixture-20261019';
const viewer = '00000000-0000-4000-8000-000000000001';
const salon = '00000000-0000-4000-8000-000000000002';
const staffId = '00000000-0000-4000-8000-000000000003';
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => { assert.ok(name in dependencies, `${file}: unexpected ${name}`); return dependencies[name]; }, exports);
  return exports;
}
const policy = load('lib/experience-offline-policy.ts', { './staff-offline-binding': load('lib/staff-offline-binding.ts') });
function contextHandler(options = {}) {
  const business = role => ({ user: { id: viewer, display_name: 'Fixture', language: 'en', status: 'active' }, salonMode: role === 'owner' ? 'manage' : 'staff', currentSalon: { id: salon }, currentStaffSalon: { id: salon }, currentWorkspace: { id: role + '-workspace' }, defaultRouteForCurrentContext: options.home || (role === 'owner' ? '/staff/today' : '/staff/my-work'), activeRole: { code: role }, accountId: 'fixture-account', permissionCodes: [], permissions: [], workspaceType: 'salon' });
  const root = business(options.role || 'staff');
  const staff = business('staff');
  const experience = load('lib/experience-context.ts', { 'server-only': {}, 'node:crypto': crypto });
  const nextHeaders = { headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) };
  const request = { getRequestBusinessContext: async () => root };
  const current = { isSalonManageContext: value => value.salonMode === 'manage', getCurrentStaffBusinessContext: async () => staff };
  const identity = { getStaffPortalIdentity: async () => ({ context: staff, staff: { id: staffId } }) };
  const scope = { runWithReadContext: read => read() };
  const offline = load('app/api/experience/offline-context/route.ts', {
    'node:crypto': crypto, 'next/headers': nextHeaders, 'next/server': { connection: async () => {} },
    '@/lib/request-business-context': request, '@/lib/experience-context': experience,
    '@/lib/staff-portal-identity': identity, '@/lib/supabase/server': {}, '@/lib/current-context': current,
    '@/lib/staff-workdays': {}, '@/lib/staff-account': {}, '@/lib/experience-offline-policy': policy,
    '@/lib/bounded-get': { runReadWithDeadline: promise => promise },
    '@/lib/staff-offline-binding-server': { getStaffOfflineBindingAuthorization: async () => ({ state: 'authorized', binding: { version: 1, staffId, viewerId: viewer, salonId: salon, revision: '00000000-0000-4000-8000-000000000004', approvedAt: '2026-10-01T00:00:00Z' } }) },
    '@/lib/read-context-scope': scope,
  });
  const timing = { measure: async (_name, read) => read(), measureSync: (_name, read) => read(), finish: response => response };
  const original = load('app/api/app-local/context/route.ts', {
    'next/headers': nextHeaders, 'next/server': { connection: async () => {} },
    '@/lib/request-business-context': request, '@/lib/experience-context': experience,
    '@/lib/experience-offline-policy': policy,
    '@/app/api/experience/offline-context/route': { GET: async request => options.leaseUnavailable ? Response.json({ error: 'Synthetic lease outage' }, { status: 503 }) : offline.GET(request) },
    '@/lib/staff-portal-identity': identity, '@/lib/current-context': current,
    '@/lib/staff-online-access-server': { getStaffOnlineOnlyAccess: async () => null },
    '@/lib/app-local-portable-context-server': { readAppLocalPortableContext: async () => null },
    '@/lib/app-local-display-server': { readAppLocalDisplayContext: async () => null },
    '@/lib/read-context-scope': scope, '@/lib/read-request-timing': { createReadRequestTiming: () => timing },
  });
  return original.GET;
}

const entry = process.env.TEST_ENTRY_BASELINE ? execFileSync('git', ['show', (process.env.TEST_ENTRY_BASELINE === '39' ? '62f22d20c5fe9e048a679f9ba6c648d2115cd632' : '1c2628c4df2069de0722874ce8972231945e7146') + ':app/local-app/entry.tsx'], { encoding: 'utf8' }) : readFileSync('app/local-app/entry.tsx', 'utf8');
const parsed = ts.createSourceFile('entry.tsx', entry, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), imports = new Map();
const real = ['react', 'react-dom/client', '@/lib/app-local-context-recovery', '@/lib/app-local-page-admission', '@/lib/experience-offline-policy'];
for (const item of parsed.statements) {
  if (!ts.isImportDeclaration(item) || real.includes(item.moduleSpecifier.text)) continue;
  imports.set(item.moduleSpecifier.text, item.importClause?.namedBindings?.elements?.map(x => x.propertyName?.text ?? x.name.text) ?? []);
}
const replacements = {
  '@/lib/app-local-host': `export const getAppLocalHost=()=>window.fixtureHost;export const appLocalRequestId=()=>crypto.randomUUID();export function appLocalPath(value){if(!value.startsWith('/')||value.startsWith('//')||/[\\\\\\u0000-\\u001f]/.test(value))throw Error('Invalid route');const u=new URL(value,'https://reylumi.com');if(u.origin!=='https://reylumi.com')throw Error('Invalid origin');return u.pathname+u.search+u.hash;}`,
  '@/lib/app-local-command-client': `let scope;export const getAppLocalCommandScope=()=>scope;export const setAppLocalCommandScope=value=>scope=value;`,
  '@/lib/app-local-page-registry': `import React from'react';function Page({context,path}){React.useEffect(()=>{window.fixtureStats.rendered.push({path,role:context?.display.role});},[path,context]);return <main data-private-page data-path={path} data-role={context?.display.role}>{path} {context?.display.role}</main>;}export const getAppLocalPage=p=>['/staff/today','/staff/my-work','/staff/appointments','/settings','/salon-profile','/explore','/market'].includes(p)?{id:p,title:'Workspace',requiresContext:!['/explore','/market'].includes(p),Component:Page}:null;`,
  '@/components/app-local-shell': `import React from'react';export function AppLocalShell({context,children,checkContext}){window.fixtureMinuteCheck=checkContext;return <>{context?<nav data-role-nav={context.display.role}/>:<header data-opening/>}{children}</>;}`,
  './navigation': `export function AppLocalNavigationProvider({children}){return children;}`,
  './scope': `export function ExperienceScopeProvider({children}){return children;}`,
  '@/lib/app-local-scope-id': `export const isAppLocalScopeId=v=>/^v3:[a-f0-9]{64}$/.test(v);export const isAppLocalPortableScopeId=()=>false;`,
  '@/lib/legal-policies': `export const legalDocuments={};`,
  // Keep shell reads synthetic while exercising the real role DTO boundary methods.
  '@/lib/app-local-resource': `export {rememberAppLocalRoleResources,reconcileAppLocalRoleResources,clearAppLocalRoleResources} from './lib/app-local-resource';export const resetAppLocalResources=()=>{};export const useAppLocalResource=()=>({loading:false,refreshing:false,refresh:async()=>{}});`,
  '@/lib/app-local-reference-content': `export const APP_LOCAL_REFERENCE_ASSETS=[];`,
  '@/lib/app-local-secondary-registry': `export const getAppLocalSecondaryPage=p=>p==='/'?{id:'root',title:'Root',requiresContext:true,Component:()=>null}:null;export const appLocalRouteAlias=()=>null;`,
};
let compiled;
async function compile() {
  compiled ??= build({ stdin: { contents: entry, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': process.cwd() }, plugins: [{ name: 'admission-boundaries', setup(b) {
    if (process.env.TEST_ENTRY_BASELINE === '39') b.onLoad({ filter: /[\\/]lib[\\/](?:app-local-context-recovery|app-local-page-admission)\.ts$/ }, args => ({ contents: execFileSync('git', ['show', '62f22d20c5fe9e048a679f9ba6c648d2115cd632:lib/' + args.path.split(/[\\/]/).at(-1)], { encoding: 'utf8' }), loader: 'ts', resolveDir: process.cwd() + '/lib' }));
    for (const [path] of imports) b.onResolve({ filter: new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: replacements[path] ?? (imports.get(path) ?? []).map(name => `export const ${name}=${name.startsWith('getAppLocal') ? '()=>null' : ['clearExperienceSnapshots', 'acceptExperienceOfflineGrant'].includes(name) ? 'async()=>{}' : name.startsWith('install') ? '()=>()=>{}' : '()=>null'};`).join('\n'), loader: 'tsx', resolveDir: process.cwd() }));
  } }] });
  return compiled;
}
async function fixture(options = {}) {
  const built = await compile(), handler = contextHandler(options), calls = [];
  const cached = options.cachedOwner ? await (await contextHandler({ role: 'owner' })(new Request('https://reylumi.com/api/app-local/context?' + new URLSearchParams({ path: '/staff/today', generation })))).json() : null;
  const setup = `
    window.fixtureStats={rendered:[],commands:0,contextRequests:[],hosted:[],diagnosticExports:[]};
    window.fixtureOptions=${JSON.stringify(options)};
    window.fixtureCached=${JSON.stringify(cached)};
    window.__reylumiAppLocalContext={generation:'${generation}',scopeEpoch:1,nonce:'fixture'};
    if(window.fixtureOptions.diagnostics)window.__reylumiExportDiagnostics=(...args)=>window.fixtureStats.diagnosticExports.push(args.length);
    window.fixtureNavigate=path=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path}}));
    const read=async(path,signal)=>{
      const r=await fetch('/fixture-context?'+new URLSearchParams({path,generation:'${generation}'}),{signal});
      if(!r.ok)throw Object.assign(Error('Fixture denied'),{status:r.status});
      return {...await r.json(),offline:false};
    };
    window.fixtureHost={isNative:true,cache:async()=>null,
      command:async()=>{window.fixtureStats.commands++;throw Error('Writes forbidden');},
      openOnline:async path=>{window.fixtureStats.hosted.push(path);if(window.fixtureOptions.hostedUnavailable)throw Error('Synthetic secure handoff unavailable');},
      context:async(path,options)=>{
        window.fixtureStats.contextRequests.push({path,fresh:Boolean(options.fresh)});
        if(window.fixtureStats.contextRequests.length<=(window.fixtureOptions.cancelContextReads??0))throw Object.assign(Error('Discarded fixture response'),{name:'AbortError',status:-999,reason:'cancelled'});
        if(window.fixtureCached&&!options.fresh){
          const value=window.fixtureCached;window.fixtureCached=null;
          setTimeout(async()=>{
            const fresh=await read(path);window.__reylumiAppLocalContext.scopeEpoch++;
            window.dispatchEvent(new CustomEvent('reylumi:app-local-reset',{detail:{...window.__reylumiAppLocalContext,reason:'context'}}));
            window.dispatchEvent(new CustomEvent('reylumi:app-local-context',{detail:{...fresh,contextPath:path}}));
          },80);
          return {...value,offline:true};
        }
        return read(path,options.signal);
      }
    };`;
  const server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/fixture-context?')) {
        const url = new URL(req.url, 'https://reylumi.com'); calls.push(url.searchParams.get('path'));
        const response = await handler(new Request('https://reylumi.com/api/app-local/context?' + url.searchParams));
        const body = await response.json();
        if (options.changeViewerAtRoot && url.searchParams.get('path') === '/') body.context.viewerId = 'other-viewer';
        if (options.explicitStatus) { body.grant = null; body.grantStatus = options.explicitStatus; }
        res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return;
      }
      res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
      res.end(req.url === '/app.js' ? built.outputFiles[0].text : '<div id="app"></div><script>' + setup + '</script><script src="/app.js"></script>');
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); server.unref();
  const browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: browserPath, headless: true }));
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port + (options.start || '/staff/today'));
  return { page, calls, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}

test('real denied Owner Today handler cannot render Staff under Owner route; resolves selected home once with no writes', { skip, timeout: 15000 }, async () => {
  const f = await fixture(); try {
    await f.page.locator('[data-private-page][data-path="/staff/my-work"][data-role="staff"]:visible').waitFor({ timeout: 5000 });
    const stats = await f.page.evaluate(() => window.fixtureStats);
    assert.equal(stats.rendered.some(x => x.path === '/staff/today'), false);
    assert.deepEqual(f.calls, ['/staff/today', '/', '/staff/my-work']);
    assert.equal(stats.commands, 0);
  } finally { await f.close(); }
});

test('cached Owner launch is withdrawn on actual background Staff denial and recovers without a pending entry request', { skip, timeout: 15000 }, async () => {
  const f = await fixture({ cachedOwner: true }); try {
    await f.page.locator('[data-private-page][data-path="/staff/my-work"][data-role="staff"]:visible').waitFor({ timeout: 5000 });
    const stats = await f.page.evaluate(() => window.fixtureStats);
    assert.equal(stats.rendered.some(x => x.path === '/staff/today' && x.role === 'staff'), false);
    assert.deepEqual(f.calls, ['/staff/today', '/', '/staff/my-work']);
    assert.equal(stats.commands, 0);
  } finally { await f.close(); }
});

test('real fresh Owner page remains usable during lease-service 503; mismatched Staff may not borrow that fallback', { skip, timeout: 15000 }, async () => {
  const owner = await fixture({ role: 'owner', leaseUnavailable: true }); try {
    await owner.page.locator('[data-private-page][data-path="/staff/today"][data-role="owner"]:visible').waitFor({ timeout: 4000 });
    assert.deepEqual(owner.calls, ['/staff/today']);
  } finally { await owner.close(); }
  const staff = await fixture({ leaseUnavailable: true }); try {
    await staff.page.locator('[data-private-page][data-path="/staff/my-work"][data-role="staff"]:visible').waitFor({ timeout: 4000 });
    assert.equal((await staff.page.evaluate(() => window.fixtureStats.rendered)).some(x => x.path === '/staff/today'), false);
    assert.deepEqual(staff.calls, ['/staff/today', '/', '/staff/my-work']);
  } finally { await staff.close(); }
});

test('explicit 401/403/409 envelopes and unknown or repeated denied home stop without private render or recovery loops', { skip, timeout: 25000 }, async () => {
  for (const options of [{ explicitStatus: 401 }, { explicitStatus: 409 }, { home: '/unknown-private' }, { home: '/staff/today' }, { changeViewerAtRoot: true }]) {
    const f = await fixture(options); try {
      await f.page.locator('[data-context-failure]').waitFor({ timeout: 2500 });
      assert.equal(await f.page.locator('[data-private-page]:visible').count(), 0);
      assert.ok(f.calls.length <= 3, JSON.stringify(f.calls));
      assert.equal(await f.page.evaluate(() => window.fixtureStats.commands), 0);
    } finally { await f.close(); }
  }
});

test('generic Explore still opens in selected Staff workspace without requiring Owner or Staff page authority', { skip, timeout: 10000 }, async () => {
  const f = await fixture({ start: '/explore' }); try {
    await f.page.locator('[data-private-page][data-path="/explore"][data-role="staff"]:visible').waitFor({ timeout: 4000 });
    assert.deepEqual(f.calls, ['/explore']);
  } finally { await f.close(); }
});

test('typed401 offers existing HTTPS sign-in while403 and409 stay distinct and never render a denied private page', { skip, timeout: 20000 }, async () => {
  for (const [status, category] of [[401, 'sign-in'], [403, 'access'], [409, 'workspace']]) {
    const f = await fixture({ role: 'owner', explicitStatus: status }); try {
      await f.page.locator(`[data-context-failure="${category}"]`).waitFor({ timeout: 4000 });
      assert.equal(await f.page.locator('[data-private-page]:visible').count(), 0);
      if (status === 401) {
        await f.page.getByRole('button', { name: 'Sign in', exact: true }).click();
        assert.deepEqual(await f.page.evaluate(() => window.fixtureStats.hosted), ['/login?next=%2Fstaff%2Ftoday']);
      } else assert.equal(await f.page.getByRole('button', { name: 'Sign in', exact: true }).count(), 0);
      assert.equal(await f.page.evaluate(() => window.fixtureStats.commands), 0);
    } finally { await f.close(); }
  }
});

test('failed secure sign-in handoff remains actionable and never exposes a private page', { skip, timeout: 10000 }, async () => {
  const f = await fixture({ role: 'owner', explicitStatus: 401, hostedUnavailable: true }); try {
    await f.page.locator('[data-context-failure="sign-in"]').waitFor({ timeout: 4000 });
    await f.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await f.page.getByRole('alert').filter({ hasText: 'Sign-in could not be opened' }).waitFor({ timeout: 2000 });
    assert.equal(await f.page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true);
    assert.equal(await f.page.locator('[data-private-page]:visible').count(), 0);
    assert.equal(await f.page.evaluate(() => window.fixtureStats.commands), 0);
  } finally { await f.close(); }
});

test('generic native reset withdraws a real authorized page without claiming denied access and exposes only user-clicked local diagnostics', { skip, timeout: 10000 }, async () => {
  const f = await fixture({ role: 'owner', diagnostics: true }); try {
    await f.page.locator('[data-private-page]:visible').waitFor({ timeout: 4000 });
    await f.page.evaluate(() => window.dispatchEvent(new Event('reylumi:app-local-reset')));
    await f.page.locator('[data-context-failure="reset"]').waitFor({ timeout: 2000 });
    assert.equal(await f.page.locator('[data-private-page]:visible').count(), 0);
    assert.equal(await f.page.evaluate(() => window.fixtureStats.contextRequests.length), 1);
    assert.deepEqual(await f.page.evaluate(() => window.fixtureStats.diagnosticExports), []);
    await f.page.getByRole('button', { name: 'Save diagnostic report', exact: true }).click();
    assert.deepEqual(await f.page.evaluate(() => window.fixtureStats.diagnosticExports), [0]);
    await f.page.getByRole('button', { name: 'Try again', exact: true }).click();
    await f.page.locator('[data-private-page]:visible').waitFor({ timeout: 4000 });
    assert.equal(await f.page.evaluate(() => window.fixtureStats.contextRequests.length), 2);
    assert.equal(await f.page.evaluate(() => window.fixtureStats.commands), 0);
  } finally { await f.close(); }
});

test('native cancellation joins one fresh current-path GET; repeated cancellation settles with verification instead of endless Opening', { skip, timeout: 15000 }, async () => {
  for (const cancelContextReads of [1, 2]) {
    const f = await fixture({ role: 'owner', cancelContextReads }); try {
      if (cancelContextReads === 1) await f.page.locator('[data-private-page]:visible').waitFor({ timeout: 4000 });
      else {
        await f.page.locator('[data-context-failure="verification"]').waitFor({ timeout: 4000 });
        assert.equal(await f.page.locator('[data-private-page]:visible').count(), 0);
        assert.equal(await f.page.getByRole('button', { name: 'Try again', exact: true }).count(), 1);
        assert.equal(await f.page.getByRole('button', { name: 'Save diagnostic report', exact: true }).count(), 0);
      }
      await f.page.waitForTimeout(150);
      assert.deepEqual(await f.page.evaluate(() => window.fixtureStats.contextRequests), [{ path: '/staff/today', fresh: false }, { path: '/staff/today', fresh: true }]);
      assert.equal(await f.page.evaluate(() => window.fixtureStats.commands), 0);
    } finally { await f.close(); }
  }
});

test('Staff Post salon-profile keeps its shared salon workspace contract with the actual context handler', { skip, timeout: 10000 }, async () => {
  const f = await fixture({ start: '/salon-profile' }); try {
    await f.page.locator('[data-private-page][data-path="/salon-profile"][data-role="staff"]:visible').waitFor({ timeout: 3500 });
    assert.deepEqual(f.calls, ['/salon-profile']);
    assert.equal(await f.page.evaluate(() => window.fixtureStats.commands), 0);
  } finally { await f.close(); }
});
