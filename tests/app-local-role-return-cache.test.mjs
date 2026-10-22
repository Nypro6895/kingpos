import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const real = new Set(['react', 'react-dom/client', '@/lib/app-local-host', '@/lib/app-local-resource', '@/lib/app-local-command-client', './scope', './navigation', '@/lib/app-local-scope-id', '@/lib/experience-offline-policy', '@/lib/experience-persistent-cache', '@/lib/experience-state', '@/lib/app-local-context-recovery', '@/lib/app-local-page-admission', '@/lib/experience-trace', '@/lib/read-request-trace-protocol']);
const imports = new Map();
for (const statement of parsed.statements) if (ts.isImportDeclaration(statement) && !real.has(statement.moduleSpecifier.text)) imports.set(statement.moduleSpecifier.text, statement.importClause?.namedBindings?.elements?.map(item => item.propertyName?.text ?? item.name.text) || []);
const mocks = {
  '@/lib/app-local-page-registry': `import React,{useRef} from 'react';import{useAppLocalResource}from'@/lib/app-local-resource';import{useExperienceScope}from'./app/local-app/scope';import{ContactSupportForm}from'./app/(legal)/contact-support/contact-form';
    function Page({context,path}){const id=useRef(crypto.randomUUID()),provider=useExperienceScope(),actual=context?.context??provider.context,resource=useAppLocalResource(context?.context.scope,'page.settings',{panel:'fixed'},{enabled:Boolean(context?.context.authenticated)});return <main data-private-page data-path={path} data-scope={actual.scope} data-provider-scope={provider.context.scope} data-node={id.current}><input aria-label="retained draft" defaultValue="initial"/><output data-private-dto>{actual.authenticated?resource.data?.value||'':'PUBLIC_SYNTHETIC'}</output>{path==='/market'?<ContactSupportForm/>:null}</main>}
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
    window.fixtureRefresh=()=>refreshAppLocalResource(window.fixtureScope(),'page.settings',{panel:'fixed'});
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
  compiled.inputHashes = [...Object.keys(compiled.metafile.inputs).filter(file => !file.startsWith('fixture:') && file !== '<stdin>'), 'app/local-app/entry.tsx', 'tests/app-local-role-return-cache.test.mjs'].map(file => ({ file: path.resolve(file), sha256: hash(readFileSync(path.resolve(file))) }));
  return compiled;
}
function setup(options) {
  const owner = 'v3:' + 'a'.repeat(64), personal = 'v3:' + 'b'.repeat(64), other = 'v3:' + 'c'.repeat(64);
  const viewer = '00000000-0000-4000-8000-000000000001', salon = '00000000-0000-4000-8000-000000000002';
  window.__reylumiDiagnosticsEnabled = true;
  window.__reylumiAppLocalContext = { version: 1, nonce: '00000000-0000-4000-8000-000000000003', scopeEpoch: 1, generation: 'role-cache-fixture-generation-20261021' };
  const state = window.fixtureState = { role: 'owner', guest: options.guest === true, reads: [], contexts: [], commands: [], cache: [], holds: [], version: 1, holdContext: false, holdRead: false, holdCacheGet: options.holdInitialCache === true, readStatus: 200, contextStatus: 200, denied: false, otherViewer: false, otherWorkspace: false };
  const disk = new Map();
  window.fixtureOtherScope = other;
  window.fixtureScope = () => state.guest ? 'v3:' + 'd'.repeat(64) : state.otherViewer || state.otherWorkspace ? other : state.role === 'owner' ? owner : personal;
  window.fixtureEnvelope = (requestedPath = location.pathname) => {
    const scope = window.fixtureScope(), now = Date.now(), isOwner = !state.guest && state.role === 'owner', isStaff = !state.guest && state.role === 'staff', id = state.guest ? null : state.otherViewer ? '00000000-0000-4000-8000-000000000099' : viewer;
    const workspaceId = state.guest ? 'guest' : state.otherWorkspace ? 'other-owner-space' : isOwner ? 'owner-space' : isStaff ? 'staff-space' : 'personal', salonId = state.guest ? null : state.otherWorkspace ? '00000000-0000-4000-8000-000000000004' : isOwner || isStaff ? salon : null;
    return { schemaVersion: 1, contextPath: requestedPath, host: { ...window.__reylumiAppLocalContext }, context: { scope, authenticated: !state.guest, viewerId: id, workspaceId, salonId, permissionRevision: isOwner ? 'owner-v1' : 'personal-v1' }, grant: state.denied ? null : { version: 1, scope, scopes: [scope], viewerId: id, workspaceId, salonId, grantRevision: isOwner ? 'owner-v1' : 'personal-v1', generation: window.__reylumiAppLocalContext.generation, issuedAt: now - 1000, expiresAt: now + 3600000, path: state.guest ? '/market' : isOwner ? '/staff/today' : isStaff ? '/staff/my-work' : '/my-place', kind: state.guest ? 'public' : isOwner ? 'owner' : isStaff ? 'staff' : 'customer' }, grantStatus: state.denied ? 403 : 200, access: { ownerWorkspace: isOwner && !state.denied, staffWorkspace: isStaff && !state.denied }, home: state.guest ? '/market' : isOwner ? '/staff/today' : isStaff ? '/staff/my-work' : '/my-place', display: { role: isOwner ? 'owner' : 'customer' }, onlineValidatedAt: now, offline: false };
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
      if (!['page.settings', 'owner.workspace'].includes(name) || args.scope !== window.fixtureScope() || state.denied) throw Object.assign(Error('Synthetic denied read'), { status: 403 });
      const row = { scope: args.scope, version: state.version, settled: false }; state.reads.push(row);
      if (state.readStatus !== 200) { row.settled = true; throw Object.assign(Error('Synthetic fresh resource denied'), { status: state.readStatus }); }
      const value = { schemaVersion: 1, status: 200, scope: args.scope, etag: 'fixture-' + state.version, updatedAt: Date.now(), data: name === 'owner.workspace' ? { view: 'workspace', props: { salonName: 'Synthetic fixture', preferences: {} } } : { value: (state.role === 'owner' ? 'OWNER' : state.role === 'staff' ? 'STAFF' : 'PERSONAL') + '_SYNTHETIC_' + state.version } };
      if (state.holdRead) await hold('read');
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
    await page.goto(origin + (options.startPath || '/staff/today'));
    if (options.holdInitialCache) await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'cache'));
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

test('same-role Help return retains actual entry DOM/draft and scoped memory without another read', { timeout: 20000 }, () => scenario('same-role-warm', async page => {
  const node = await visible(page).getAttribute('data-node'); await page.getByLabel('retained draft').fill('unsaved synthetic draft');
  await page.evaluate(() => window.fixtureNavigate('/help')); await page.locator('[data-public-help]').waitFor(); assert.equal(await visible(page).count(), 0);
  await page.evaluate(() => window.fixtureNavigate('/staff/today')); await visible(page).waitFor();
  assert.equal(await visible(page).getAttribute('data-node'), node); assert.equal(await page.getByLabel('retained draft').inputValue(), 'unsaved synthetic draft');
  const reads = await page.evaluate(() => window.fixtureState.reads.length); assert.equal(reads, 1);
  assert.equal(await visible(page).getAttribute('data-provider-scope'), await visible(page).getAttribute('data-scope'));
  return { phaseReadCount: reads, domAndDraftRetained: true };
}));

for (const durable of [false, true]) test(`actual A→B→A handoff withdraws memory/DOM; authorized native endpoint durable=${durable}`, { timeout: 20000 }, () => scenario('role-return-durable-' + durable, async page => {
  const node = await visible(page).getAttribute('data-node'); await page.getByLabel('retained draft').fill('unsaved synthetic draft');
  await page.evaluate(() => window.fixtureSwitch('customer'));
  await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: 'PERSONAL_SYNTHETIC_1' }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCachePresent('v3:' + 'a'.repeat(64))), false);
  await page.evaluate(() => { window.fixtureState.holdContext = true; window.fixtureSwitch('owner'); });
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'context'));
  assert.equal(await visible(page).count(), 0, 'Retained DTO cannot authorize its own destination before fresh admission');
  assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  await page.evaluate(() => { window.fixtureState.holdContext = false; window.fixtureRelease('context'); });
  await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_1' }).waitFor();
  assert.notEqual(await visible(page).getAttribute('data-node'), node); assert.equal(await visible(page).getByLabel('retained draft').inputValue(), 'initial');
  const stats = await page.evaluate(() => ({ readsA: window.fixtureState.reads.filter(row => row.scope === 'v3:' + 'a'.repeat(64)).length, readsB: window.fixtureState.reads.filter(row => row.scope === 'v3:' + 'b'.repeat(64)).length, commands: window.fixtureState.commands.length, nativeCacheGets: window.fixtureState.cache.filter(row => row.op === 'get').length }));
  assert.equal(stats.readsA, 2, 'Quarantined DTOs require fresh revalidation even when a durable endpoint also has a copy'); assert.equal(stats.readsB, 1); assert.equal(stats.commands, 2);
  return { ...stats, jsMemoryDiscarded: true, draftDiscarded: true, destinationAuthorityRequired: true, nativeStoreExecuted: false };
}, { durable }));

test('late A read cancelled by actual handoff cannot restore A cache or appear under B', { timeout: 20000 }, () => scenario('late-old-response', async page => {
  await page.evaluate(() => { window.fixtureState.version = 2; window.fixtureState.holdRead = true; void window.fixtureRefresh(); });
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'read'));
  await page.evaluate(() => { window.fixtureState.holdRead = false; window.fixtureState.version = 3; window.fixtureSwitch('customer'); });
  await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: 'PERSONAL_SYNTHETIC_3' }).waitFor();
  await page.evaluate(() => window.fixtureRelease('read')); await page.waitForFunction(() => window.fixtureState.reads.every(row => row.settled)); await settle(page);
  assert.equal(await page.evaluate(() => window.fixtureCachePresent('v3:' + 'a'.repeat(64))), false);
  assert.equal(await visible(page).locator('[data-private-dto]').textContent(), 'PERSONAL_SYNTHETIC_3');
  await page.evaluate(() => window.fixtureSwitch('owner')); await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_3' }).waitFor();
  return { lateOldResponseRejected: true, commandCount: await page.evaluate(() => window.fixtureState.commands.length) };
}));

test('fresh explicit permission denial withdraws an already warm page instead of admitting its DTO', { timeout: 20000 }, () => scenario('permission-denied', async page => {
  await page.evaluate(() => { window.fixtureState.denied = true; window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() })); });
  await page.locator('[data-context-failure]').waitFor();
  assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCachePresent('v3:' + 'a'.repeat(64))), false); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  return { oldPrivateDtoVisible: false, warmCacheWithdrawn: true };
}));

test('different viewer on the same route cannot inherit the former viewer unsaved page draft', { timeout: 20000 }, () => scenario('same-route-viewer-draft-isolation', async page => {
  await page.evaluate(() => window.fixtureSeedOther()); assert.equal(await page.evaluate(() => window.fixtureCachePresent(window.fixtureOtherScope)), true);
  const node = await visible(page).getAttribute('data-node');
  await visible(page).getByLabel('retained draft').fill('FORMER_VIEWER_PRIVATE_DRAFT');
  await page.evaluate(() => { window.fixtureState.otherViewer = true; window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() })); });
  await page.locator('[data-private-page]:visible[data-scope="v3:' + 'c'.repeat(64) + '"]').waitFor();
  assert.equal(await visible(page).getByLabel('retained draft').inputValue(), 'initial', 'An accepted different viewer must not inherit the former account private draft');
  assert.notEqual(await visible(page).getAttribute('data-node'), node); assert.equal(await page.evaluate(() => window.fixtureCachePresent('v3:' + 'a'.repeat(64))), false);
  return { formerViewerDraftVisible: false, oldScopeCachePresent: false };
}));

test('generation withdrawal removes every private page and command scope', { timeout: 20000 }, () => scenario('generation-withdrawal', async page => {
  await page.evaluate(() => window.fixtureSeedOther());
  await page.evaluate(() => { window.__reylumiAppLocalContext.generation = 'other-fixture-generation-20261021'; window.dispatchEvent(new CustomEvent('reylumi:app-local-reset', { detail: { reason: 'logout' } })); });
  await page.locator('[data-context-failure="sign-in"]').waitFor();
  assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCachePresent(window.fixtureOtherScope)), false); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  return { generationReset: true, privateDtoVisibleAfterWithdrawal: false };
}));

test('fresh same-identity context and grant renewal retain the current private DOM/draft', { timeout: 20000 }, () => scenario('same-identity-refresh', async page => {
  const node = await visible(page).getAttribute('data-node'); await visible(page).getByLabel('retained draft').fill('same-identity draft');
  await page.evaluate(() => { const value = window.fixtureEnvelope(); value.grant.issuedAt += 100; value.grant.expiresAt += 100; value.onlineValidatedAt += 1; window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: value })); });
  await settle(page);
  assert.equal(await visible(page).getAttribute('data-node'), node); assert.equal(await visible(page).getByLabel('retained draft').inputValue(), 'same-identity draft');
  assert.equal(await page.evaluate(() => window.fixtureState.reads.length), 1);
  return { sameIdentityDraftRetained: true, phaseReads: 1 };
}));

test('same viewer selecting another workspace on the same route cannot inherit its private draft', { timeout: 20000 }, () => scenario('same-route-workspace-isolation', async page => {
  const node = await visible(page).getAttribute('data-node'); await visible(page).getByLabel('retained draft').fill('FORMER_WORKSPACE_PRIVATE_DRAFT');
  await page.evaluate(() => { window.fixtureState.otherWorkspace = true; window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() })); });
  await page.locator('[data-private-page]:visible[data-scope="v3:' + 'c'.repeat(64) + '"]').waitFor();
  assert.equal(await visible(page).getByLabel('retained draft').inputValue(), 'initial'); assert.notEqual(await visible(page).getAttribute('data-node'), node);
  return { formerWorkspaceDraftVisible: false };
}));

test('batched native reset and different-viewer admission cannot preserve the former current-page DOM', { timeout: 20000 }, () => scenario('batched-reset-and-identity', async page => {
  await visible(page).getByLabel('retained draft').fill('FORMER_BATCHED_DRAFT');
  await page.evaluate(() => {
    window.fixtureState.otherViewer = true; window.__reylumiAppLocalContext.scopeEpoch++;
    window.dispatchEvent(new CustomEvent('reylumi:app-local-reset', { detail: { reason: 'context', scopeEpoch: window.__reylumiAppLocalContext.scopeEpoch } }));
    window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() }));
  });
  await page.locator('[data-private-page]:visible[data-scope="v3:' + 'c'.repeat(64) + '"]').waitFor();
  assert.equal(await visible(page).getByLabel('retained draft').inputValue(), 'initial');
  return { batchedFormerViewerDraftVisible: false };
}));

test('separate OwnerPages/POS subtree is also fenced by its own accepted identity', { timeout: 20000 }, () => scenario('owner-pos-identity-isolation', async page => {
  const node = await visible(page).getAttribute('data-node'); await visible(page).getByLabel('retained draft').fill('FORMER_POS_DRAFT');
  await page.evaluate(() => { window.fixtureState.otherViewer = true; window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() })); });
  await page.locator('[data-owner-pos]:visible[data-scope="v3:' + 'c'.repeat(64) + '"]').waitFor();
  assert.equal(await visible(page).getByLabel('retained draft').inputValue(), 'initial'); assert.notEqual(await visible(page).getAttribute('data-node'), node);
  return { formerOwnerPosDraftVisible: false };
}, { startPath: '/pos' }));

// Market's real developer panel embeds this actual uncontrolled support form.
// No submit/payment/plugin action runs: only local message fields are edited.
test('authenticated optional-public Market clears actual contact form when accepted viewer changes', { timeout: 20000 }, () => scenario('optional-public-viewer-isolation', async page => {
  await visible(page).locator('textarea[name="message"]').fill('FORMER_MARKET_VIEWER_MESSAGE');
  await page.evaluate(() => { window.fixtureState.otherViewer = true; window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() })); });
  await page.locator('[data-private-page]:visible[data-scope="v3:' + 'c'.repeat(64) + '"]').waitFor();
  assert.equal(await visible(page).locator('textarea[name="message"]').inputValue(), '');
  return { actualContactFormMessageFromFormerViewer: false, requiresContext: false };
}, { startPath: '/market' }));

test('guest optional-public Market does not carry its contact message into first authenticated admission', { timeout: 20000 }, () => scenario('optional-public-guest-to-auth', async page => {
  await page.waitForFunction(() => window.fixtureState.contexts.length > 0);
  await visible(page).locator('textarea[name="message"]').fill('GUEST_MARKET_MESSAGE');
  await page.evaluate(() => { window.fixtureState.guest = false; window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() })); });
  await page.locator('[data-private-page]:visible[data-scope="v3:' + 'a'.repeat(64) + '"]').waitFor();
  assert.equal(await visible(page).locator('textarea[name="message"]').inputValue(), '');
  return { guestMessageCarriedIntoAuthenticatedView: false };
}, { startPath: '/market', guest: true }));

test('authenticated optional-public Market removes its contact message when returning to guest', { timeout: 20000 }, () => scenario('optional-public-auth-to-guest', async page => {
  await visible(page).locator('textarea[name="message"]').fill('PRIVATE_MARKET_MESSAGE');
  await page.evaluate(() => { window.fixtureState.guest = true; window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() })); });
  await page.locator('[data-private-page]:visible[data-scope="v3:' + 'd'.repeat(64) + '"]').waitFor();
  assert.equal(await visible(page).locator('textarea[name="message"]').inputValue(), '');
  return { authenticatedMessageExposedToGuest: false };
}, { startPath: '/market' }));

test('pure guest optional-public Market retains its actual form on guest refresh and Help revisit', { timeout: 20000 }, () => scenario('optional-public-guest-warm', async page => {
  await page.locator('[data-private-page]:visible[data-scope="v3:' + 'd'.repeat(64) + '"]').waitFor();
  const node = await visible(page).getAttribute('data-node'); await visible(page).locator('textarea[name="message"]').fill('PUBLIC_GUEST_DRAFT');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() }))); await settle(page);
  assert.equal(await visible(page).getAttribute('data-node'), node);
  await page.evaluate(() => window.fixtureNavigate('/help')); await page.locator('[data-public-help]').waitFor();
  await page.evaluate(() => window.fixtureNavigate('/market')); await visible(page).waitFor();
  assert.equal(await visible(page).getAttribute('data-node'), node); assert.equal(await visible(page).locator('textarea[name="message"]').inputValue(), 'PUBLIC_GUEST_DRAFT');
  return { pureGuestDraftRetained: true };
}, { startPath: '/market', guest: true }));

test('authenticated optional-public Market retains actual contact message on same-identity refresh', { timeout: 20000 }, () => scenario('optional-public-auth-warm', async page => {
  const node = await visible(page).getAttribute('data-node'); await visible(page).locator('textarea[name="message"]').fill('SAME_MARKET_IDENTITY_DRAFT');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: window.fixtureEnvelope() }))); await settle(page);
  assert.equal(await visible(page).getAttribute('data-node'), node); assert.equal(await visible(page).locator('textarea[name="message"]').inputValue(), 'SAME_MARKET_IDENTITY_DRAFT');
  return { sameAuthenticatedIdentityDraftRetained: true };
}, { startPath: '/market' }));

test('fresh401 withdraws actual entry authority before a late initial durable-cache reply can restore private DTO', { timeout: 20000 }, () => scenario('entry-401-before-late-initial-cache', async page => {
  assert.equal(await visible(page).locator('[data-private-dto]').textContent(), '');
  await page.evaluate(() => {
    window.fixtureState.readStatus = 401; window.fixtureState.contextStatus = 401;
    window.fixtureState.holdContext = true; void window.fixtureRefresh();
  });
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'context'));
  await page.locator('[data-private-page]').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  await page.evaluate(() => { window.fixtureState.holdCacheGet = false; window.fixtureRelease('cache'); });
  await page.waitForFunction(() => window.fixtureState.cache.some(row => row.op === 'get' && row.settled)); await settle(page);
  assert.equal(await visible(page).count(), 0); assert.equal(await page.getByText('OLD_PRIVATE_CACHE', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.fixtureCachePresent('v3:' + 'a'.repeat(64))), false);
  assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  await page.evaluate(() => { window.fixtureState.holdContext = false; window.fixtureRelease('context'); });
  await page.locator('[data-context-failure="sign-in"]').waitFor(); await settle(page);
  const stats = await page.evaluate(() => ({ resourceGets: window.fixtureState.reads.length, contextGets: window.fixtureState.contexts.length, commands: window.fixtureState.commands.length }));
  assert.deepEqual(stats, { resourceGets: 1, contextGets: 2, commands: 0 });
  assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCachePresent('v3:' + 'a'.repeat(64))), false);
  return { ...stats, oldPrivateCacheRevealed: false, authorityManufacturedByFixture: false };
}, { holdInitialCache: true }));

test('same-account same-salon role return restores only DTO after fresh admission then revalidates without old DOM or draft', { timeout: 20000 }, () => scenario('same-tenant-role-dto-return', async page => {
  const node = await visible(page).getAttribute('data-node');
  await page.getByLabel('retained draft').fill('owner unsaved draft');
  await page.evaluate(() => window.fixtureSwitch('staff'));
  await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: 'STAFF_SYNTHETIC_1' }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCachePresent('v3:' + 'a'.repeat(64))), false, 'Old role live cells were withdrawn');
  await page.evaluate(() => { window.fixtureState.version = 2; window.fixtureState.holdContext = true; window.fixtureState.holdRead = true; window.fixtureSwitch('owner'); });
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'context'));
  assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  await page.evaluate(() => { window.fixtureState.holdContext = false; window.fixtureRelease('context'); });
  await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_1' }).waitFor();
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'read'));
  assert.notEqual(await visible(page).getAttribute('data-node'), node);
  assert.equal(await visible(page).getByLabel('retained draft').inputValue(), 'initial');
  await page.evaluate(() => { window.fixtureState.holdRead = false; window.fixtureRelease('read'); });
  await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_2' }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureState.commands.length), 2);
  return { freshAdmissionBeforeDTO: true, backgroundRevalidationObserved: true, oldDomAndDraftWithdrawn: true, realCommandsTransmitted: 0 };
}));

test('a business mutation in role B purges inactive role A DTO before a fresh authorized return', { timeout: 20000 }, () => scenario('cross-role-mutation-purge', async page => {
  await page.evaluate(() => window.fixtureSwitch('staff'));
  await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: 'STAFF_SYNTHETIC_1' }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:app-local-command-complete', { detail: { scope: window.fixtureScope(), source: 'fixture/unknown-business-command' } })));
  await settle(page);
  await page.evaluate(() => { window.fixtureState.version = 2; window.fixtureState.holdRead = true; window.fixtureSwitch('owner'); });
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'read'));
  assert.equal(await page.locator('[data-private-page]:visible [data-private-dto]').innerText(), '', 'A business write must not resurrect inactive role DTO');
  await page.evaluate(() => { window.fixtureState.holdRead = false; window.fixtureRelease('read'); });
  await page.locator('[data-private-page]:visible [data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_2' }).waitFor();
  return { inactiveRolePurgedByBusinessMutation: true, freshDataRequired: true };
}));

test('explicit DTO discard prevents the previously quarantined role copy returning while its replacement is pending', { timeout: 20000 }, () => scenario('discard-purges-previous-role-copy', async page => {
  await page.evaluate(() => window.fixtureSwitch('staff'));
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'STAFF_SYNTHETIC_1' }).waitFor();
  await page.evaluate(() => { window.fixtureState.version = 2; window.fixtureState.holdRead = true; window.fixtureSwitch('owner'); });
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_1' }).waitFor();
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'read'));
  assert.equal(await page.evaluate(() => window.fixtureDiscard()), true);
  await page.evaluate(() => { window.fixtureState.version = 3; window.fixtureState.holdRead = false; window.fixtureSwitch('staff'); });
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'STAFF_SYNTHETIC_3' }).waitFor();
  await page.evaluate(() => window.fixtureRelease('read')); await settle(page);
  await page.evaluate(() => { window.fixtureState.holdRead = true; window.fixtureSwitch('owner'); });
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'read'));
  assert.equal(await visible(page).locator('[data-private-dto]').innerText(), '');
  assert.equal(await page.getByText('OWNER_SYNTHETIC_1', { exact: true }).count(), 0);
  await page.evaluate(() => { window.fixtureState.holdRead = false; window.fixtureRelease('read'); });
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_3' }).waitFor();
  return { actualDiscardExecuted: true, quarantinedRejectedDtoRestored: false, lateReplacementFromFormerScopeIgnored: true };
}));

test('an external conflict withdraws its admitted role but preserves another quarantined role before fresh return', { timeout: 20000 }, () => scenario('external-scope-conflict-purges-vault', async page => {
  await page.evaluate(() => window.fixtureSwitch('staff'));
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'STAFF_SYNTHETIC_1' }).waitFor();
  await page.evaluate(() => {
    window.fixtureState.holdContext = true;
    window.dispatchEvent(new CustomEvent('reylumi:app-local-scope-conflict', { detail: { scope: window.fixtureScope(), generation: window.__reylumiAppLocalContext.generation } }));
  });
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'context'));
  assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  await page.evaluate(() => { window.fixtureState.holdContext = false; window.fixtureRelease('context'); });
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'STAFF_SYNTHETIC_1' }).waitFor();
  await page.evaluate(() => { window.fixtureState.version = 2; window.fixtureState.holdRead = true; window.fixtureSwitch('owner'); });
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'read'));
  assert.equal(await visible(page).locator('[data-private-dto]').innerText(), 'OWNER_SYNTHETIC_1', 'Unaffected role DTO still requires fresh Owner admission');
  await page.evaluate(() => { window.fixtureState.holdRead = false; window.fixtureRelease('read'); });
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_2' }).waitFor();
  assert.ok(await page.evaluate(() => window.fixtureState.contexts.length) <= 5, 'Conflict recovery must remain bounded');
  return { externalCurrentScopeConflict: true, unaffectedRoleQuarantineRetained: true, freshRecoveryBounded: true };
}));

test('accepted offline authority from another principal purges the former principal role vault', { timeout: 20000 }, () => scenario('offline-principal-change-purges-vault', async page => {
  await page.evaluate(() => window.fixtureSwitch('staff'));
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'STAFF_SYNTHETIC_1' }).waitFor();
  await page.evaluate(() => { window.fixtureState.version = 2; window.fixtureState.holdRead = true; window.fixtureSwitch('owner'); });
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_1' }).waitFor();
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'read'));
  await page.evaluate(() => {
    window.fixtureState.otherViewer = true;
    const value = window.fixtureEnvelope(); value.offline = true;
    window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: value }));
  });
  await page.locator('[data-private-page]:visible[data-scope="v3:' + 'c'.repeat(64) + '"]').waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCommandScope()), 'v3:' + 'c'.repeat(64));
  await page.evaluate(() => {
    window.fixtureState.holdRead = false; window.fixtureState.otherViewer = false; window.fixtureState.role = 'staff';
    window.fixtureNavigate('/staff/my-work');
  });
  await page.locator('[data-private-page]:visible[data-scope="v3:' + 'b'.repeat(64) + '"] [data-private-dto]').filter({ hasText: 'STAFF_SYNTHETIC_2' }).waitFor();
  await page.evaluate(() => window.fixtureRelease('read')); await settle(page);
  await page.evaluate(() => { window.fixtureState.version = 2; window.fixtureState.holdRead = true; window.fixtureSwitch('owner'); });
  await page.waitForFunction(() => window.fixtureState.holds.some(row => row.kind === 'read'));
  assert.equal(await visible(page).locator('[data-private-dto]').innerText(), '');
  assert.equal(await page.getByText('OWNER_SYNTHETIC_1', { exact: true }).count(), 0);
  await page.evaluate(() => { window.fixtureState.holdRead = false; window.fixtureRelease('read'); });
  await visible(page).locator('[data-private-dto]').filter({ hasText: 'OWNER_SYNTHETIC_2' }).waitFor();
  return { acceptedOfflinePrincipalChange: true, formerPrincipalDtoRestored: false, offlineNativeStoreExecuted: false };
}));

after(async () => {
  await browser?.close();
  if (!compiled) return;
  for (const row of compiled.inputHashes) assert.equal(hash(readFileSync(row.file)), row.sha256, 'Fixture input changed during observations');
  const folder = process.env.ROLE_CACHE_ARTIFACT_DIR;
  if (folder) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, engine + '-role-cache-observations.json'), JSON.stringify({ at: new Date().toISOString(), passed: observations.length === 22 && observations.every(row => row.passed), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceInputs: compiled.inputHashes, testSha256: hash(readFileSync('tests/app-local-role-return-cache.test.mjs')), observations, boundaries: { actualEntryProviderHostResourceAndAdmission: true, syntheticVisualsAndNativeEndpoint: true, nativeSwiftExecuted: false, appSpeedMeasured: false, externalRequestsAllowed: false, realCommandsTransmitted: 0 } }, null, 2) + '\n', { flag: 'wx' });
  }
});
