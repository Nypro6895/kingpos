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

// Real installed entry/provider/host/cache/admission; synthetic native endpoint
// and visual registry only. Neutral context deliberately has NO Staff authority.
const root = process.cwd(), engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe')].find(existsSync);
const entry = readFileSync('app/local-app/entry.tsx', 'utf8'), hash = value => createHash('sha256').update(value).digest('hex');
const parsed = ts.createSourceFile('entry.tsx', entry, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const real = new Set(['react', 'react-dom/client', '@/lib/app-local-host', '@/lib/app-local-resource', '@/lib/app-local-command-client', './scope', './navigation', '@/lib/app-local-scope-id', '@/lib/experience-offline-policy', '@/lib/experience-persistent-cache', '@/lib/experience-state', '@/lib/app-local-context-recovery', '@/lib/app-local-page-admission', '@/lib/experience-trace']);
const imports = new Map();
for (const statement of parsed.statements) if (ts.isImportDeclaration(statement) && !real.has(statement.moduleSpecifier.text)) imports.set(statement.moduleSpecifier.text, statement.importClause?.namedBindings?.elements?.map(item => item.propertyName?.text ?? item.name.text) || []);
const mocks = {
  '@/lib/app-local-page-registry': `import React from'react';import{useAppLocalResource}from'@/lib/app-local-resource';import{useExperienceScope}from'./app/local-app/scope';function Page({context}){const provider=useExperienceScope(),resource=useAppLocalResource(context.context.scope,'staff.my-work',{staffId:'00000000-0000-4000-8000-000000000003'});return <main data-private-page data-provider-scope={provider.context.scope}><output data-private-dto>{resource.data?.value||''}</output></main>}export const getAppLocalPage=p=>['/staff/my-work','/staff/today'].includes(p)?{id:p,title:'My Work',requiresContext:true,Component:Page}:null;`,
  '@/components/app-local-shell': `import React from'react';export function AppLocalShell({context,children}){return <>{context?<nav data-role={context.display.role}/>:<header data-checking/>}{children}</>}`,
  '@/components/app-local-help': `import React from'react';export function AppLocalHelp(){return <main data-public-help>Public Help</main>}`,
  '@/lib/app-local-secondary-registry': 'export const getAppLocalSecondaryPage=()=>null;export const appLocalRouteAlias=()=>null;',
  '@/lib/legal-policies': 'export const legalDocuments={};',
  '@/lib/app-local-reference-content': 'export const APP_LOCAL_REFERENCE_ASSETS=[];',
};
let compiled, browser;
const observations = [];
async function compile() {
  if (compiled) return compiled;
  compiled = await build({ stdin: { contents: entry + `
    window.fixtureNavigate=path=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path}}));
    window.fixtureCommandScope=getAppLocalCommandScope;
  `, loader: 'tsx', resolveDir: root }, bundle: true, write: false, metafile: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': root }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'same-home-real-entry-boundaries', setup(builder) {
    builder.onResolve({ filter: /^\.\/(?:scope|navigation)$/ }, ({ path: name }) => ({ path: path.join(root, 'app/local-app', name + '.tsx') }));
    for (const [name] of imports) builder.onResolve({ filter: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ path: name, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ loader: 'tsx', resolveDir: root, contents: mocks[name] || imports.get(name).map(item => `export const ${item}=${item.startsWith('getAppLocal') ? '()=>null' : item.startsWith('install') ? '()=>()=>{}' : '()=>null'};`).join('\n') }));
  } }] });
  compiled.inputHashes = [...Object.keys(compiled.metafile.inputs).filter(file => !file.startsWith('fixture:') && file !== '<stdin>'), 'app/local-app/entry.tsx', 'tests/app-local-same-home-recovery.test.mjs'].map(file => ({ file: path.resolve(file), sha256: hash(readFileSync(path.resolve(file))) }));
  return compiled;
}
function setup(options) {
  const scope = 'v3:' + 'a'.repeat(64), neutral = 'v3:' + 'b'.repeat(64);
  const viewer = '00000000-0000-4000-8000-000000000001', salon = '00000000-0000-4000-8000-000000000002', staff = '00000000-0000-4000-8000-000000000003';
  window.__reylumiDiagnosticsEnabled = true;
  window.__reylumiAppLocalContext = { version: 1, nonce: '00000000-0000-4000-8000-000000000004', scopeEpoch: 1, generation: 'same-home-fixture-generation-20261021' };
  const state = window.fixtureState = { contexts: [], resources: [], writes: 0, held: [], staffCalls: 0, neutralCalls: 0, destinationReplies: 0, destinationMode: options.destination || 'approved' };
  function envelope(path, kind = 'staff') {
    const now = Date.now(), account = kind === 'customer', selectedScope = account ? neutral : scope;
    const grant = { version: 1, scope: selectedScope, scopes: [selectedScope], viewerId: viewer, workspaceId: account ? 'personal' : 'staff-space', salonId: account ? null : salon, grantRevision: 'fixture-v1', generation: window.__reylumiAppLocalContext.generation, issuedAt: now - 1000, expiresAt: now + 3600000, path: account ? '/my-place' : '/staff/my-work', kind };
    if (!account) grant.staffBinding = { version: 1, staffId: staff, viewerId: viewer, salonId: salon, revision: '00000000-0000-4000-8000-000000000005', approvedAt: new Date(now - 10000).toISOString() };
    return { schemaVersion: 1, contextPath: path, host: { ...window.__reylumiAppLocalContext }, context: { scope: selectedScope, viewerId: viewer, authenticated: true, workspaceId: grant.workspaceId, salonId: grant.salonId, permissionRevision: 'fixture-v1' }, grant, grantStatus: 200, access: { ownerWorkspace: false, staffWorkspace: !account }, display: { role: account ? 'customer' : 'staff' }, onlineValidatedAt: now, offline: false };
  }
  function unconfirmed(path) { return { ...envelope(path), grant: null, grantStatus: 503, offlineState: 'unconfirmed' }; }
  window.fixtureReleaseDestination = () => { for (const done of state.held) done(); state.held = []; };
  window.fixtureLateNeutral = () => window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: { ...envelope('/', 'customer'), home: '/staff/my-work' } }));
  window.__reylumiAppLocalTransport = { request: async request => {
    const { kind, name, args } = request;
    if (kind === 'context') {
      state.contexts.push({ path: args.path, fresh: args.fresh === true });
      if (args.path === '/') {
        state.neutralCalls++;
        const value = envelope('/', 'customer'); value.home = options.home ?? '/staff/my-work';
        if (options.neutralViewerMismatch) value.context.viewerId = '00000000-0000-4000-8000-000000000099';
        if (options.neutralOffline) value.offline = true;
        state.neutralReturned = true; return value;
      }
      if (args.path !== '/staff/my-work') throw Error('Unregistered synthetic private destination');
      state.staffCalls++;
      if (state.staffCalls === 1) return unconfirmed(args.path);
      const value = state.destinationMode === 'unconfirmed' ? unconfirmed(args.path) : envelope(args.path);
      if (state.destinationMode === '403' || state.destinationMode === '409') { value.grant = null; value.grantStatus = Number(state.destinationMode); }
      if (options.holdDestination) await new Promise(resolve => state.held.push(resolve));
      state.destinationReplies++;
      if (state.destinationMode === '401') throw Object.assign(Error('Synthetic destination identity rejected'), { status: 401 });
      return value;
    }
    if (kind === 'cache') return null;
    if (kind === 'read') {
      if (name !== 'staff.my-work' || args.scope !== scope) throw Error('Unexpected synthetic resource');
      state.resources.push({ name, scope: args.scope });
      return { schemaVersion: 1, status: 200, scope, etag: 'fixture', updatedAt: Date.now(), data: { value: 'STAFF_FRESH_PRIVATE_DTO' } };
    }
    state.writes++; throw Error('Commands and external navigation forbidden');
  } };
}
async function fixture(options = {}) {
  const built = await compile(), errors = [], external = [], requests = [];
  const server = createServer((request, response) => {
    requests.push(request.method); assert.equal(request.method, 'GET');
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? built.outputFiles[0].text : '<div id="app"></div><script>(' + setup.toString() + ')(' + JSON.stringify(options) + ')</script><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser ??= engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ headless: true, executablePath: browserPath });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.name));
  await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(new URL(route.request().url()).protocol); return route.abort(); });
  await page.goto(origin + '/staff/my-work');
  return { page, async close() { await context.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); assert.deepEqual(external, []); assert(requests.every(method => method === 'GET')); } };
}
const visible = page => page.locator('[data-private-page]:visible');
async function settled(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function recoveryDecision(page) {
  await page.waitForFunction(() => window.fixtureState.held.length || window.fixtureState.destinationReplies || window.__reylumiDiagnostics?.snapshot().some(row => row.event === 'auth.reject' && row.contextReason === 'workspace-home'));
  await settled(page);
}
async function scenario(name, body, options) {
  const app = await fixture(options); let observed, error;
  try { observed = await body(app.page); } catch (failure) { error = failure; }
  const state = await app.page.evaluate(() => ({ contexts: window.fixtureState.contexts, resources: window.fixtureState.resources, writes: window.fixtureState.writes, trace: window.__reylumiDiagnostics?.snapshot() || [] })).catch(() => null);
  try { await app.close(); } catch (failure) { error ||= failure; }
  observations.push({ name, passed: !error, observed, state, ...(error ? { failure: { name: error.name, message: error.message } } : {}) });
  if (error) throw error;
}

test('same registered server home after transient Staff unconfirmed requires one new fresh destination proof before private display', { timeout: 20000 }, () => scenario('same-home-valid-fresh-destination', async page => {
  await recoveryDecision(page);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('reylumi:foreground')); }); await settled(page);
  assert.deepEqual(await page.evaluate(() => window.fixtureState.contexts.map(row => row.path)), ['/staff/my-work', '/', '/staff/my-work']);
  assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  assert.equal(await page.evaluate(() => window.fixtureState.resources.length), 0, 'Neutral customer context is never Staff page/resource admission');
  assert.deepEqual(await page.evaluate(() => window.fixtureState.contexts.map(row => row.fresh)), [false, true, true]);
  await page.evaluate(() => window.fixtureReleaseDestination());
  await page.locator('[data-private-dto]').filter({ hasText: 'STAFF_FRESH_PRIVATE_DTO' }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCommandScope()), 'v3:' + 'a'.repeat(64));
  await page.evaluate(() => window.fixtureLateNeutral()); await settled(page);
  assert.equal(await page.locator('[data-private-dto]').textContent(), 'STAFF_FRESH_PRIVATE_DTO');
  assert.equal(await page.evaluate(() => window.fixtureCommandScope()), 'v3:' + 'a'.repeat(64));
  assert.equal(await page.evaluate(() => window.fixtureState.contexts.length), 3);
  assert.equal(await page.evaluate(() => window.fixtureState.writes), 0);
  return { privateDisplayRequiresFreshStaffProof: true, contextGets: 3, commands: 0 };
}, { holdDestination: true }));

test('repeated same-home unconfirmed stops after its fresh destination check without automatic recovery loop', { timeout: 20000 }, () => scenario('same-home-still-unconfirmed', async page => {
  await recoveryDecision(page); await page.locator('[data-context-failure]').waitFor(); await settled(page);
  assert.deepEqual(await page.evaluate(() => window.fixtureState.contexts.map(row => row.path)), ['/staff/my-work', '/', '/staff/my-work']);
  assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  assert.equal(await page.evaluate(() => window.fixtureState.resources.length), 0); assert.equal(await page.evaluate(() => window.fixtureState.writes), 0);
  return { contextGets: 3, neutralGets: 1, privateVisible: false };
}, { destination: 'unconfirmed' }));

test('manual Try again after bounded same-home failure checks fresh Staff once without replaying neutral or a command', { timeout: 20000 }, () => scenario('manual-retry-after-bounded-denial', async page => {
  await recoveryDecision(page); await page.locator('[data-context-failure]').waitFor();
  assert.equal(await page.evaluate(() => window.fixtureState.contexts.length), 3);
  await page.evaluate(() => { window.fixtureState.destinationMode = 'approved'; });
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('[data-private-dto]').filter({ hasText: 'STAFF_FRESH_PRIVATE_DTO' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.fixtureState.contexts.map(row => row.path)), ['/staff/my-work', '/', '/staff/my-work', '/staff/my-work']);
  assert.equal(await page.evaluate(() => window.fixtureState.contexts.at(-1).fresh), true);
  assert.equal(await page.evaluate(() => window.fixtureState.writes), 0);
  return { explicitRetryFreshRouteGets: 1, repeatedNeutralGets: 0, commands: 0 };
}, { destination: 'unconfirmed' }));

for (const status of ['401', '403', '409']) test(`same-home fresh destination ${status} stays fail-closed and never inherits neutral grant`, { timeout: 20000 }, () => scenario('same-home-denied-' + status, async page => {
  await recoveryDecision(page); await page.locator('[data-context-failure]').waitFor(); await settled(page);
  assert.equal(await page.evaluate(() => window.fixtureState.contexts.length), 3);
  assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  assert.equal(await page.evaluate(() => window.fixtureState.resources.length), 0); assert.equal(await page.evaluate(() => window.fixtureState.writes), 0);
  return { freshDestinationStatus: Number(status), privateVisible: false, commands: 0 };
}, { destination: status }));

test('invalid neutral homes and mismatched or offline neutral identity cannot trigger destination authorization', { timeout: 20000 }, async () => {
  for (const options of [{ home: '/' }, { home: '/unregistered-private' }, { home: 'https://outside.invalid/' }, { neutralViewerMismatch: true }, { neutralOffline: true }]) await scenario('invalid-neutral-' + Object.keys(options)[0] + String(Object.values(options)[0]), async page => {
    await page.locator('[data-context-failure]').waitFor(); await settled(page);
    assert.equal(await page.evaluate(() => window.fixtureState.contexts.length), 2); assert.equal(await visible(page).count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureState.resources.length), 0); assert.equal(await page.evaluate(() => window.fixtureState.writes), 0);
    return { destinationContextRequested: false };
  }, options);
});

test('a late fresh same-home reply after navigation or generation withdrawal cannot reopen private Staff', { timeout: 20000 }, async () => {
  for (const change of ['navigation', 'generation']) await scenario('late-destination-' + change, async page => {
    await recoveryDecision(page);
    assert.equal(await page.evaluate(() => window.fixtureState.held.length), 1);
    if (change === 'navigation') { await page.evaluate(() => window.fixtureNavigate('/help')); await page.locator('[data-public-help]').waitFor(); }
    else { await page.evaluate(() => { window.__reylumiAppLocalContext.generation = 'withdrawn-generation-20261021'; window.dispatchEvent(new CustomEvent('reylumi:app-local-reset', { detail: { reason: 'logout' } })); }); await page.locator('[data-context-failure="sign-in"]').waitFor(); }
    await page.evaluate(() => window.fixtureReleaseDestination()); await page.waitForFunction(() => window.fixtureState.destinationReplies === 1); await settled(page);
    assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined); assert.equal(await page.evaluate(() => window.fixtureState.resources.length), 0);
    return { latePrivateDisplay: false };
  }, { holdDestination: true });
});

test('a new user navigation may try same-home recovery again while each navigation stays bounded', { timeout: 20000 }, () => scenario('new-navigation-new-bounded-attempt', async page => {
  await recoveryDecision(page); await page.locator('[data-context-failure]').waitFor();
  assert.equal(await page.evaluate(() => window.fixtureState.contexts.length), 3);
  await page.evaluate(() => window.fixtureNavigate('/help')); await page.locator('[data-public-help]').waitFor();
  await page.evaluate(() => window.fixtureNavigate('/staff/my-work')); await page.locator('[data-context-failure]').waitFor(); await settled(page);
  assert.equal(await page.evaluate(() => window.fixtureState.contexts.length), 6);
  assert.equal(await visible(page).count(), 0); assert.equal(await page.evaluate(() => window.fixtureState.writes), 0);
  return { boundedContextGetsPerNavigation: 3, navigations: 2 };
}, { destination: 'unconfirmed' }));

after(async () => {
  await browser?.close();
  if (!compiled) return;
  for (const row of compiled.inputHashes) assert.equal(hash(readFileSync(row.file)), row.sha256, 'Input changed during same-home observation');
  if (process.env.SAME_HOME_ARTIFACT_DIR) {
    mkdirSync(process.env.SAME_HOME_ARTIFACT_DIR, { recursive: true });
    writeFileSync(path.join(process.env.SAME_HOME_ARTIFACT_DIR, engine + '-same-home-observations.json'), JSON.stringify({ at: new Date().toISOString(), passed: observations.length === 14 && observations.every(row => row.passed), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), testSha256: hash(readFileSync('tests/app-local-same-home-recovery.test.mjs')), sourceInputs: compiled.inputHashes, observations, boundaries: { actualEntryProviderHostResourceAndAdmission: true, syntheticNativeEndpointAndViews: true, neutralContextHasNoStaffAuthority: true, runtimePhoneSameHomeCauseProven: false, realWrites: 0, noExternalRequests: true } }, null, 2) + '\n', { flag: 'wx' });
  }
});
