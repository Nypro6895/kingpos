import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

// Real entry, provider, bridge host, resource/cache, admission and workspace
// handoff code execute. Only visual pages/shell and the native endpoint are
// synthetic. This audits JS lifecycle/cache ownership, not Swift or app speed.
const root = process.cwd(), engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe')].find(existsSync);
const entry = readFileSync('app/local-app/entry.tsx', 'utf8');
const parsed = ts.createSourceFile('entry.tsx', entry, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const real = new Set(['react', 'react-dom/client', '@/lib/app-local-host', '@/lib/app-local-resource', '@/lib/app-local-command-client', './scope', './navigation', '@/lib/app-local-scope-id', '@/lib/experience-offline-policy', '@/lib/experience-persistent-cache', '@/lib/experience-state', '@/lib/app-local-context-recovery', '@/lib/app-local-page-admission', '@/lib/experience-trace']);
const imports = new Map();
for (const statement of parsed.statements) if (ts.isImportDeclaration(statement) && !real.has(statement.moduleSpecifier.text)) imports.set(statement.moduleSpecifier.text, statement.importClause?.namedBindings?.elements?.map(item => item.propertyName?.text ?? item.name.text) || []);
const mocks = {
  '@/lib/app-local-page-registry': `import React,{useRef} from 'react';import{useAppLocalResource}from'@/lib/app-local-resource';import{useExperienceScope}from'./app/local-app/scope';import{ContactSupportForm}from'./app/(legal)/contact-support/contact-form';
    function Page({context,path}){const id=useRef(crypto.randomUUID()),provider=useExperienceScope(),actual=context?.context??provider.context,resource=useAppLocalResource(context?.context.scope,path==='/staff/my-work'&&window.fixtureStaffId?'staff.my-work':'page.settings',path==='/staff/my-work'&&window.fixtureStaffId?{staffId:window.fixtureStaffId,tab:'daily'}:{panel:'fixed'},{enabled:Boolean(context?.context.authenticated)});return <main data-private-page data-path={path} data-scope={actual.scope} data-provider-scope={provider.context.scope} data-node={id.current}><input aria-label="retained draft" defaultValue="initial"/><output data-private-dto>{actual.authenticated?resource.data?.staffDisplayName||resource.data?.value||'':'PUBLIC_SYNTHETIC'}</output>{path==='/market'?<ContactSupportForm/>:null}</main>}
    export const getAppLocalPage=p=>['/staff/today','/staff/my-work','/my-place','/market','/explore'].includes(p)?{id:p==='/explore'?'explore':p==='/market'?'market':p,title:'Fixture',requiresContext:!['/market','/explore'].includes(p),Component:Page}:null;`,
  '@/components/app-local-shell': `import React from 'react';export function AppLocalShell({context,children}){return <>{context?<nav data-role={context.display.role}/>:<header data-checking/>}{children}</>}`,
  '@/components/app-local-help': `import React from 'react';export function AppLocalHelp(){return <main data-public-help>Public Help</main>}`,
  '@/app/pos/owner-local-workspace': `import React from 'react';export function OwnerLocalWorkspace({children}){return <section data-owner-workspace>{children}</section>}`,
  '@/app/pos/owner-pos-client': `import React,{useRef}from'react';import{useExperienceScope}from'./app/local-app/scope';export function OwnerPosClient(){const provider=useExperienceScope(),node=useRef(crypto.randomUUID());return <main data-private-page data-owner-pos data-scope={provider.context.scope} data-node={node.current}><input aria-label="retained draft" defaultValue="initial"/><output data-private-dto>OWNER_SYNTHETIC_1</output></main>}`,
  '@/lib/app-local-secondary-registry': 'export const getAppLocalSecondaryPage=()=>null;export const appLocalRouteAlias=()=>null;',
  '@/lib/legal-policies': 'export const legalDocuments={};',
  '@/lib/app-local-reference-content': 'export const APP_LOCAL_REFERENCE_ASSETS=[];',
  '@/components/workspace-language': `import React from'react';export const WorkspaceText=({text})=><>{text}</>;export const useWorkspaceTranslation=()=>value=>value;`,
  'next/link': `import React from'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
};
let compiled, browser;
const observations = [];
const hash = value => createHash('sha256').update(value).digest('hex');
async function compile() {
  if (compiled) return compiled;
  compiled = await build({ stdin: { contents: entry + `
    import{navigateToWorkspace}from'./lib/app-local-shell-workspace-navigation';
    import{appLocalResourceCache,refreshAppLocalResource,seedAppLocalResource,discardAppLocalResources}from'./lib/app-local-resource';
    window.fixtureSwitch=role=>navigateToWorkspace(role==='owner'?'owner-space':role==='staff'?'staff-space':'personal');
    window.fixtureNavigate=path=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path}}));
    window.fixtureRefresh=()=>refreshAppLocalResource(window.fixtureScope(),location.pathname==='/staff/my-work'&&window.fixtureStaffId?'staff.my-work':'page.settings',location.pathname==='/staff/my-work'&&window.fixtureStaffId?{staffId:window.fixtureStaffId,tab:'daily'}:{panel:'fixed'});
    window.fixtureDiscard=()=>discardAppLocalResources(window.fixtureScope(),'page.settings',[{panel:'fixed'}]);
    window.fixtureCachePresent=scope=>Boolean(appLocalResourceCache.get({scope,key:'app-local:'+JSON.stringify(['page.settings',{panel:'fixed'}])}));
    window.fixtureSeedOther=()=>seedAppLocalResource(window.fixtureOtherScope,'page.settings',{panel:'fixed'},{schemaVersion:1,status:200,scope:window.fixtureOtherScope,etag:'other',updatedAt:Date.now(),data:{value:'OTHER_SYNTHETIC'}});
    window.fixtureCommandScope=getAppLocalCommandScope;
  `, loader: 'tsx', resolveDir: root }, bundle: true, write: false, metafile: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': root }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'real-entry-cache-boundaries', setup(builder) {
    builder.onResolve({ filter: /^\.\/(?:scope|navigation)$/ }, ({ path: name }) => ({ path: path.join(root, 'app/local-app', name + '.tsx') }));
    builder.onResolve({ filter: /^(?:@\/components\/workspace-language|next\/link)$/ }, ({ path: name }) => ({ path: name, namespace: 'fixture' }));
    for (const [name] of imports) builder.onResolve({ filter: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ path: name, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ loader: 'tsx', resolveDir: root, contents: mocks[name] || imports.get(name).map(item => `export const ${item}=${item.startsWith('getAppLocal') ? '()=>null' : item.startsWith('install') ? '()=>()=>{}' : '()=>null'};`).join('\n') }));
  } }] });
  compiled.inputHashes = [...Object.keys(compiled.metafile.inputs).filter(file => !file.startsWith('fixture:') && file !== '<stdin>'), 'app/local-app/entry.tsx', 'tests/app-local-read-auth-rejection.test.mjs'].map(file => ({ file: path.resolve(file), sha256: hash(readFileSync(path.resolve(file))) }));
  return compiled;
}
function setup(options) {
  const owner = 'v3:' + 'a'.repeat(64), personal = options.staffScope || 'v3:' + 'b'.repeat(64), other = 'v3:' + 'c'.repeat(64);
  const viewer = options.viewer || '00000000-0000-4000-8000-000000000001', salon = options.salon || '00000000-0000-4000-8000-000000000002'; window.fixtureStaffId = options.staffId;
  window.__reylumiDiagnosticsEnabled = true;
  window.__reylumiAppLocalContext = { version: 1, nonce: '00000000-0000-4000-8000-000000000003', scopeEpoch: 1, generation: 'role-cache-fixture-generation-20261021' };
  const state = window.fixtureState = { role: 'owner', guest: options.guest === true, reads: [], contexts: [], commands: [], cache: [], holds: [], version: 1, holdContext: false, holdRead: false, holdCacheGet: options.holdInitialCache === true, readStatus: 200, contextStatus: options.initialContextStatus || 200, oldReadStatus: 200, denied: false, otherViewer: false, otherWorkspace: false };
  const disk = new Map();
  window.fixtureOtherScope = other;
  window.fixtureScope = () => state.guest ? 'v3:' + 'd'.repeat(64) : state.otherViewer || state.otherWorkspace ? other : state.role === 'owner' ? owner : personal;
  window.fixtureEnvelope = (requestedPath = location.pathname) => {
    const scope = window.fixtureScope(), now = Date.now(), isOwner = !state.guest && state.role === 'owner', isStaff = !state.guest && state.role === 'staff', id = state.guest ? null : state.otherViewer ? '00000000-0000-4000-8000-000000000099' : viewer;
    const workspaceId = state.guest ? 'guest' : state.otherWorkspace ? 'other-owner-space' : isOwner ? 'owner-space' : isStaff ? 'staff-space' : 'personal', salonId = state.guest ? null : state.otherWorkspace ? '00000000-0000-4000-8000-000000000004' : isOwner || isStaff ? salon : null;
    return { schemaVersion: 1, contextPath: requestedPath, host: { ...window.__reylumiAppLocalContext }, context: { scope, authenticated: !state.guest, viewerId: id, workspaceId, salonId, permissionRevision: isOwner ? 'owner-v1' : 'personal-v1' }, grant: state.denied || options.initialUnconfirmed ? null : { version: 1, scope, scopes: [scope], viewerId: id, workspaceId, salonId, grantRevision: isOwner ? 'owner-v1' : 'personal-v1', generation: window.__reylumiAppLocalContext.generation, issuedAt: now - 1000, expiresAt: now + 3600000, path: state.guest ? '/market' : isOwner ? '/staff/today' : isStaff ? '/staff/my-work' : '/my-place', kind: state.guest ? 'public' : isOwner ? 'owner' : isStaff ? 'staff' : 'customer' }, grantStatus: state.denied ? 403 : options.initialUnconfirmed ? 503 : 200, ...(options.initialUnconfirmed ? {offlineState:'unconfirmed'} : {}), access: { ownerWorkspace: isOwner && !state.denied, staffWorkspace: isStaff && !state.denied }, home: state.guest ? '/market' : isOwner ? '/staff/today' : isStaff ? '/staff/my-work' : '/my-place', display: { role: isOwner ? 'owner' : 'customer' }, onlineValidatedAt: now, offline: false };
  };
  window.fixtureRelease = kind => { for (const held of state.holds.filter(item => item.kind === kind)) held.resolve(); state.holds = state.holds.filter(item => item.kind !== kind); };
  const hold = async kind => new Promise(resolve => state.holds.push({ kind, resolve }));
  window.__reylumiAppLocalTransport = { request: async request => {
    const { kind, name, args } = request;
    if (kind === 'context') {
      const value = window.fixtureEnvelope(args.path); state.contexts.push({ path: args.path, fresh: args.fresh === true, scope: value.context.scope });
      if (state.holdContext) await hold('context');
      if (state.contextStatus !== 200) throw Object.assign(Error('Synthetic fresh context denied'), { status: state.contextStatus });
      return value;
    }
    if (kind === 'command') {
      if (name !== 'shell.switch-workspace') throw Error('Synthetic command forbidden');
      state.commands.push({ name, scope: args.scope, workspaceId: args.workspaceId });
      state.role = args.workspaceId === 'owner-space' ? 'owner' : args.workspaceId === 'staff-space' ? 'staff' : 'customer';
      return { path: state.role === 'owner' ? '/staff/today' : state.role === 'staff' ? '/staff/my-work' : '/my-place' };
    }
    if (kind === 'cache') {
      if (name === 'cancel') { state.cache.push({ op: 'cancel' }); return null; }
      const key = JSON.stringify([args.scope, name, args.arguments]);
      const row = { op: args.op, scope: args.scope, authorized: args.scope === window.fixtureScope() && !state.denied, settled: false }; state.cache.push(row);
      if (args.op === 'remove') { disk.delete(key); return null; }
      if (args.op !== 'get') throw Error('Synthetic cache writes forbidden');
      if (state.holdCacheGet) {
        const old = { schemaVersion: 1, status: 200, scope: args.scope, etag: 'old-held-cache', updatedAt: Date.now(), data: { value: 'OLD_PRIVATE_CACHE' } };
        await hold('cache'); row.settled = true; return old;
      }
      // This is an endpoint fixture, not a model of Swift's encrypted store.
      return options.durable && args.scope === window.fixtureScope() && !state.denied ? disk.get(key) || null : null;
    }
    if (kind === 'read') {
      if (!['page.settings', 'owner.workspace', 'staff.my-work'].includes(name) || args.scope !== window.fixtureScope() || state.denied) throw Object.assign(Error('Synthetic denied read'), { status: 403 });
      const row = { scope: args.scope, version: state.version, settled: false }; state.reads.push(row);
      if (state.readStatus !== 200) { row.settled = true; throw Object.assign(Error('Synthetic fresh resource denied'), { status: state.readStatus }); }
      if (name === 'staff.my-work') { try { const result = await window.fixtureBackendRead(args); if (result.status !== 200) throw Object.assign(Error('Actual backend denied new DTO'), { status: result.status }); return result.body; } finally { row.settled = true; } }
      const value = { schemaVersion: 1, status: 200, scope: args.scope, etag: 'fixture-' + state.version, updatedAt: Date.now(), data: name === 'owner.workspace' ? { view: 'workspace', props: { salonName: 'Synthetic fixture', preferences: {} } } : { value: (state.role === 'owner' ? 'OWNER' : state.role === 'staff' ? 'STAFF' : 'PERSONAL') + '_SYNTHETIC_' + state.version } };
      const oldStatus = state.oldReadStatus; if (state.holdRead) await hold('read'); if (oldStatus === 304) { row.settled = true; return { ...value, status: 304, data: undefined }; }
      if (options.durable) disk.set(JSON.stringify([args.scope, name, { panel: 'fixed' }]), value);
      row.settled = true; return value;
    }
    throw Error('External native operation forbidden');
  } };
}
async function fixture(options = {}) {
  const built = await compile(), failures = [], external = [], requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: new URL(request.url, 'http://127.0.0.1').pathname });
    assert.equal(request.method, 'GET');
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? built.outputFiles[0].text : '<div id="app"></div><script>(' + setup.toString() + ')(' + JSON.stringify(options) + ')</script><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser ??= engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ headless: true, executablePath: browserPath });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
  page.setDefaultTimeout(6000); page.on('pageerror', error => failures.push(error.name));
  await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(new URL(route.request().url()).protocol); return route.abort(); });
  try {
    if (options.staffId) await page.exposeFunction('fixtureBackendRead', async args => { const response = await activeBackend.run({ scope: args.scope }); const body = await response.json(); backendObservations.push({status:response.status,hasData:body.data!==undefined}); return {status:response.status,body}; });
    await page.goto(origin + (options.startPath || '/staff/today'));
    if (options.initialContextStatus || options.initialUnconfirmed) await page.locator('[data-context-failure]').waitFor();
    else if (options.holdInitialCache) await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'cache'));
    else await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: options.guest ? 'PUBLIC_SYNTHETIC' : 'OWNER_SYNTHETIC_1' }).waitFor();
    return { page, async close() { await context.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(failures, []); assert.deepEqual(external, []); assert(requests.every(row => row.method === 'GET')); } };
  } catch (error) { await context.close(); await new Promise(resolve => server.close(resolve)); throw error; }
}
const visible = page => page.locator('[data-private-page]:visible');
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function scenario(name, body, options) {
  const app = await fixture(options); let observed, error;
  try { observed = await body(app.page); } catch (failure) { error = failure; }
  try { await app.close(); } catch (failure) { error ||= failure; }
  observations.push({ name, passed: !error, ...(observed ? { observed } : {}), ...(error ? { failure: { name: error.name, message: error.message } } : {}) });
  if (error) throw error;
}


import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(path.join(root,'package.json'));
const {createClient,isAuthSessionMissingError}=require('@supabase/supabase-js');
const realReact=require('next/dist/server/route-modules/app-page/vendored/rsc/react');
const backendInputs=new Set();
const trackedRead=(file,...args)=>{if(typeof file==='string'&&!path.isAbsolute(file))backendInputs.add(file);return readFileSync(file,...args);};
let fixtureSource=readFileSync('tests/staff-my-work-critical-path.test.mjs','utf8');
fixtureSource=fixtureSource.slice(fixtureSource.indexOf('const tick ='),fixtureSource.indexOf("test('independent timezone"));
function adapt(before,after){assert.equal(fixtureSource.split(before).length,2,before);fixtureSource=fixtureSource.replace(before,after);}
adapt('populated = false, now } = {})','populated = false, now, hooks = {} } = {})');
adapt('const react = { cache: read => read };','const react = realReact;');
adapt('return Response.json(data);','return Response.json(hooks.data ? hooks.data(kind, data, events) : data);');
const backendFixture=new Function('assert','AsyncLocalStorage','crypto','readFileSync','ts','createClient','isAuthSessionMissingError','origin','codeCache','realReact',fixtureSource+'\nreturn fixture;')(
 assert,AsyncLocalStorage,crypto,trackedRead,ts,createClient,isAuthSessionMissingError,'https://staff-critical-path.invalid',new Map(),realReact);
let activeBackend; const backendObservations=[];
const savedFetch=globalThis.fetch;
const configKeys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const savedConfig=configKeys.map(key=>process.env[key]);
let externalAttempts=0;
globalThis.fetch=()=>{externalAttempts++;throw Error('Uninjected network forbidden');};
process.env.NEXT_PUBLIC_SUPABASE_URL='https://staff-critical-path.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-public-key';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function until(predicate){const deadline=Date.now()+5000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Held backend stage not reached');}
const dto=page=>visible(page).locator('[data-private-dto]');


function backendWithLateRejection() {
  const hold = {}; let revoked = false;
  const backend = backendFixture({ hold, populated: true, hooks: { data: (kind, data) => kind === 'session' && revoked ? { revoked_at: '2000-01-01T00:00:00Z' } : data } });
  activeBackend = backend;
  return { backend, hold, revoke: () => { revoked = true; } };
}
const backendOptions = backend => { const ids = backend.ids('1'); return { staffId: ids.staff, staffScope: backend.scopeFor('1'), viewer: ids.viewer, salon: ids.salon }; };
async function waitReads(page) { await page.waitForFunction(() => window.fixtureState.reads.every(row => row.settled)); await settle(page); }
async function assertWithdrawn(page) {
  assert.equal(await visible(page).count(), 0, 'Confirmed backend rejection must withdraw old private DOM before recovery context finishes');
  assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  assert.equal(await page.evaluate(() => window.fixtureState.contextStatus), 200, 'No separate synthetic context403 is used to force withdrawal');
  assert.ok(await page.evaluate(() => window.fixtureState.holds.some(row => row.kind === 'context')), 'Recovery context remains held');
}
for (const restored of [false, true]) test('actual late revoked backend401 withdraws ' + (restored ? 'fresh-admitted role-restored' : 'mounted') + ' DTO before context recovery', { timeout: 20000 }, async () => {
  const f = backendWithLateRejection();
  await scenario(restored ? 'restored-known-rejection' : 'mounted-known-rejection', async page => {
    await page.evaluate(() => window.fixtureSwitch('staff')); await dto(page).filter({ hasText: 'Synthetic Staff' }).waitFor();
    if (restored) { await page.evaluate(() => window.fixtureSwitch('owner')); await dto(page).filter({ hasText: 'OWNER_SYNTHETIC_1' }).waitFor(); }
    const snapshot = deferred(); f.hold.snapshot = snapshot; const before = f.backend.count('snapshot');
    if (restored) await page.evaluate(() => window.fixtureSwitch('staff')); else await page.evaluate(() => { void window.fixtureRefresh(); });
    await until(() => f.backend.count('snapshot') === before + 1);
    await dto(page).filter({ hasText: 'Synthetic Staff' }).waitFor();
    await page.evaluate(() => { window.fixtureState.holdContext = true; });
    f.revoke(); snapshot.resolve(); await waitReads(page);
    await assertWithdrawn(page);
    assert.deepEqual(backendObservations.at(-1), { status: 401, hasData: false });
    assert.equal(await page.evaluate(() => window.fixtureCachePresent('v3:' + 'a'.repeat(64))), false);
    return { backendStatus: 401, newPrivateDto: false, priorDtoVisible: false, recoveryContextStillHeld: true, context403Injected: false };
  }, backendOptions(f.backend));
});

for (const area of ['status', 'session']) test('genuine backend ' + area + ' unavailability503 retains mounted and freshly admitted restored DTOs', { timeout: 20000 }, async () => {
  const fail = {}; activeBackend = backendFixture({ populated: true, fail });
  await scenario('genuine-unavailability-retention', async page => {
    await page.evaluate(() => window.fixtureSwitch('staff')); await dto(page).filter({ hasText: 'Synthetic Staff' }).waitFor();
    fail[area] = 503; await page.evaluate(() => { void window.fixtureRefresh(); }); await waitReads(page);
    assert.equal(backendObservations.at(-1).status, 503); assert.equal(await dto(page).innerText(), 'Synthetic Staff');
    assert.ok(await page.evaluate(() => window.fixtureCommandScope()));
    await page.evaluate(() => window.fixtureSwitch('owner')); await dto(page).filter({ hasText: 'OWNER_SYNTHETIC_1' }).waitFor();
    await page.evaluate(() => window.fixtureSwitch('staff')); await dto(page).filter({ hasText: 'Synthetic Staff' }).waitFor(); await waitReads(page);
    assert.equal(backendObservations.at(-1).status, 503); assert.equal(await dto(page).innerText(), 'Synthetic Staff');
    assert.ok(await page.evaluate(() => window.fixtureCommandScope()));
    return { backendStatus: 503, mountedAndRestoredDtoRetained: true, commandsReplayed: false };
  }, backendOptions(activeBackend));
});

for (const oldStatus of [200, 304]) test('late old-scope ' + oldStatus + ' cannot revive private data after actual backend401', { timeout: 20000 }, async () => {
  const f = backendWithLateRejection();
  await scenario('late-old-read-' + oldStatus, async page => {
    await page.evaluate(status => { window.fixtureState.holdRead = true; window.fixtureState.oldReadStatus = status; void window.fixtureRefresh(); }, oldStatus);
    await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'read'));
    const snapshot = deferred(); f.hold.snapshot = snapshot;
    await page.evaluate(() => { window.fixtureState.holdRead = false; window.fixtureSwitch('staff'); });
    await until(() => f.backend.count('snapshot') === 1);
    await page.evaluate(() => { window.fixtureState.holdContext = true; });
    f.revoke(); snapshot.resolve();
    await page.waitForFunction(() => window.fixtureState.contexts.length >= 3 && window.fixtureState.holds.some(row => row.kind === 'context'));
    await settle(page); await assertWithdrawn(page);
    await page.evaluate(() => window.fixtureRelease('read')); await waitReads(page); await assertWithdrawn(page);
    assert.deepEqual(backendObservations.at(-1), { status: 401, hasData: false });
    return { oldReplyStatus: oldStatus, backendStatus: 401, priorDtoRevived: false };
  }, backendOptions(f.backend));
});

test('late durable hydration cannot revive old scope after actual backend401', { timeout: 20000 }, async () => {
  const f = backendWithLateRejection();
  await scenario('late-durable-hydration', async page => {
    await page.evaluate(() => { window.fixtureState.holdCacheGet = true; window.fixtureSwitch('staff'); });
    await page.waitForFunction(() => location.pathname === '/staff/my-work' && window.fixtureState.holds.some(row => row.kind === 'cache'));
    const snapshot = deferred(); f.hold.snapshot = snapshot;
    await page.evaluate(() => { void window.fixtureRefresh(); }); await until(() => f.backend.count('snapshot') === 1);
    await page.evaluate(() => { window.fixtureState.holdContext = true; }); f.revoke(); snapshot.resolve();
    await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'context')); await settle(page); await assertWithdrawn(page);
    await page.evaluate(() => window.fixtureRelease('cache')); await waitReads(page); await assertWithdrawn(page);
    assert.equal(await page.getByText('OLD_PRIVATE_CACHE', { exact: true }).count(), 0);
    return { backendStatus: 401, lateHydrationVisible: false };
  }, { ...backendOptions(f.backend), durable: true });
});

test('a late old-principal backend401 cannot withdraw a newer accepted principal', { timeout: 20000 }, async () => {
  const f = backendWithLateRejection(), snapshot = deferred(); f.hold.snapshot = snapshot;
  await scenario('late-old-principal-rejection', async page => {
    await page.evaluate(() => window.fixtureSwitch('staff')); await until(() => f.backend.count('snapshot') === 1);
    await page.evaluate(() => { window.fixtureState.otherViewer = true; window.fixtureState.role = 'owner'; window.fixtureNavigate('/staff/today'); });
    await dto(page).filter({ hasText: 'OWNER_SYNTHETIC_1' }).waitFor(); const accepted = await page.evaluate(() => window.fixtureCommandScope()); assert.ok(accepted);
    f.revoke(); snapshot.resolve(); await waitReads(page);
    assert.deepEqual(backendObservations.at(-1), { status: 401, hasData: false });
    assert.equal(await dto(page).innerText(), 'OWNER_SYNTHETIC_1');
    assert.deepEqual(await page.evaluate(() => window.fixtureCommandScope()), accepted);
    return { backendStatus: 401, newerPrincipalVisible: true, newerCommandScopePreserved: true };
  }, backendOptions(f.backend));
});

test('unknown fresh context503 cannot admit private pages or command scope', { timeout: 10000 }, async () => {
  await scenario('unknown-context503-denied', async page => {
    assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
    assert.deepEqual(await page.evaluate(() => window.fixtureState.reads), []);
    return { contextStatus: 503, privateDtoVisible: false, commandScopePresent: false };
  }, { initialContextStatus: 503 });
});

test('explicit unconfirmed context503 cannot admit private pages from a successful context transport', { timeout: 10000 }, async () => {
  await scenario('unconfirmed-context503-denied', async page => {
    assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
    assert.deepEqual(await page.evaluate(() => window.fixtureState.reads), []);
    return { contextHTTPStatus: 200, grantStatus: 503, offlineState: 'unconfirmed', privateDtoVisible: false };
  }, { initialUnconfirmed: true });
});

after(async () => {
  globalThis.fetch = savedFetch; configKeys.forEach((key, i) => { if (savedConfig[i] === undefined) delete process.env[key]; else process.env[key] = savedConfig[i]; });
  await browser?.close(); assert.equal(externalAttempts, 0);
  const inputs = new Map((compiled?.inputHashes ?? []).map(row => [row.file, row.sha256]));
  for (const file of backendInputs) inputs.set(path.resolve(file), hash(readFileSync(file)));
  const folder = process.env.AUTH_REJECTION_RESULTS_DIR;
  if (folder) writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ engine, observations, backendObservations, sourceInputs: [...inputs].map(([file, sha256]) => ({ file, sha256 })), limits: { actualFrontendAndBackendModules: true, syntheticMembershipAndNativeTransport: true, realNative: false, network: 'loopback browser and fully intercepted backend only', performanceMeasured: false } }, null, 2) + '\n', { flag: 'wx' });
});
