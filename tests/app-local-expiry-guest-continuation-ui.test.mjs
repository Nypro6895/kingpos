import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

// The actual entry, shell, expiry dialog, bridge host, resource store and page
// admission execute together. Only visual business pages/providers and the
// native endpoint are synthetic. No production origin or credentials are used.
const root = process.cwd(), engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const baseline = process.env.TEST_GUEST_CONTINUATION_BASELINE;
const selected = file => baseline && ['app/local-app/entry.tsx', 'components/app-local-shell.tsx'].includes(file) ? path.join(baseline, file) : path.join(root, file);
const entry = readFileSync(selected('app/local-app/entry.tsx'), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const real = new Set(['react', 'react-dom', 'react-dom/client', '@/lib/app-local-host', '@/lib/app-local-resource', '@/lib/app-local-command-client', './scope', './navigation', '@/lib/app-local-scope-id', '@/lib/experience-offline-policy', '@/lib/experience-persistent-cache', '@/lib/experience-state', '@/lib/app-local-context-recovery', '@/lib/app-local-page-admission', '@/lib/experience-trace', '@/components/app-local-shell', './app-local-session-expiry-prompt']);
const imports = new Map();
for (const [filename, text] of [['entry.tsx', entry], ['shell.tsx', readFileSync(selected('components/app-local-shell.tsx'), 'utf8')]]) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const item of source.statements) if (ts.isImportDeclaration(item) && !real.has(item.moduleSpecifier.text)) imports.set(item.moduleSpecifier.text, item.importClause?.namedBindings?.elements?.map(value => value.propertyName?.text ?? value.name.text) || []);
}
const mocks = {
  '@/lib/app-local-page-registry': `import React from'react';import{useAppLocalResource}from'@/lib/app-local-resource';
    function Page({context,path}){const resource=useAppLocalResource(context?.context.scope,'page.fixture-public',{}, {enabled:path==='/explore'&&Boolean(context)});return path==='/explore'?<main data-public-page><output data-public-dto>{resource.data?.value||''}</output></main>:context?.context.authenticated?<main data-private-page><input aria-label="private draft" defaultValue="SYNTHETIC_PRIVATE_DRAFT"/></main>:<main data-protected-placeholder/>}
    export const getAppLocalPage=p=>['/staff/today','/explore'].includes(p)?{id:p==='/explore'?'explore':'owner.today',title:'Today',requiresContext:p!=='/explore',Component:Page}:null;`,
  '@/app/navigation-shell': `import React from'react';export function NavigationShell({children}){return <section data-auth-shell>{children}</section>}`,
  '@/app/guest-navigation-shell': `import React from'react';export function GuestNavigationShell({children}){return <section data-guest-shell>{children}</section>}`,
  '@/components/app-local-help': `import React from'react';export function AppLocalHelp(){return <main data-public-help>Public Help</main>}`,
  './workspace-language': `import React from'react';export function WorkspaceLanguageProvider({children}){return children}export function WorkspaceText({text}){return <>{text}</>}`,
  './campaign-plugin-context': 'export function CampaignPluginProvider({children}){return children}',
  './explore-account-actions': 'export function ExploreAccountActionsProvider({children}){return children}',
  './explore-advertising': 'export function ExploreAdvertising({children}){return children}',
  '@/lib/app-local-secondary-registry': 'export const getAppLocalSecondaryPage=()=>null;export const appLocalRouteAlias=()=>null;',
  '@/lib/legal-policies': 'export const legalDocuments={};',
  '@/lib/app-local-reference-content': 'export const APP_LOCAL_REFERENCE_ASSETS=[];',
  'next/navigation': `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:path=>window.fixtureNavigate(path)});`,
};
imports.set('next/navigation', []);
let compiled, browser;
const observations = [];
async function compile() {
  compiled ??= build({ stdin: { contents: entry + `\nwindow.fixtureCommandScope=getAppLocalCommandScope;`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, metafile: true, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': root }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'actual-entry-shell-expiry-boundaries', setup(builder) {
    builder.onResolve({ filter: /^\.\/(?:scope|navigation)$/ }, ({ path: name }) => ({ path: path.join(root, 'app/local-app', name + '.tsx') }));
    if (baseline) builder.onLoad({ filter: /[\\/]components[\\/]app-local-shell\.tsx$/ }, () => ({ contents: readFileSync(selected('components/app-local-shell.tsx'), 'utf8'), loader: 'tsx', resolveDir: path.join(root, 'components') }));
    for (const [name] of imports) builder.onResolve({ filter: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ path: name, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ loader: 'tsx', resolveDir: root, contents: mocks[name] || imports.get(name).map(item => `export const ${item}=${item.startsWith('getAppLocal') ? '()=>null' : item.startsWith('install') ? '()=>()=>{}' : '()=>null'};`).join('\n') }));
  } }] });
  return compiled;
}
function setup(options) {
  const ownerScope = 'v3:' + 'a'.repeat(64), guestScope = 'v3:' + 'b'.repeat(64);
  const viewerId = '00000000-0000-4000-8000-000000000001', salonId = '00000000-0000-4000-8000-000000000002';
  const generation = 'guest-continuation-fixture-generation-20261021';
  window.__reylumiDiagnosticsEnabled = true;
  window.__reylumiAppLocalContext = { version: 1, nonce: '00000000-0000-4000-8000-000000000003', scopeEpoch: 1, generation };
  const state = window.fixtureState = { guest: options.guest === true, contexts: [], reads: [], commands: 0, login: 0, cookieWrites: 0, cookieHookInstalled: false, logoutResets: 0, holdGuest: false, status: 200, held: [] };
  const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (cookie?.get && cookie?.set) { Object.defineProperty(document, 'cookie', { configurable: true, get() { return cookie.get.call(document); }, set(value) { state.cookieWrites++; cookie.set.call(document, value); } }); state.cookieHookInstalled = true; }
  window.addEventListener('reylumi:app-local-reset', event => { if (event.detail?.reason === 'logout') state.logoutResets++; });
  window.fixtureNavigate = value => window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate', { detail: { path: value } }));
  window.fixtureRefresh = () => window.dispatchEvent(new Event('reylumi:foreground'));
  window.fixtureRelease = () => { const held = state.held.splice(0); state.holdGuest = false; held.forEach(resolve => resolve()); };
  window.__reylumiAppLocalTransport = { request: async request => {
    const { kind, name, args } = request;
    if (kind === 'context') {
      const guest = state.guest, scope = guest ? guestScope : ownerScope, now = Date.now();
      const row = { path: args.path, fresh: args.fresh === true, guest, settled: false }; state.contexts.push(row);
      if (guest && args.path === '/explore' && state.holdGuest) await new Promise(resolve => state.held.push(resolve));
      row.settled = true;
      if (state.status !== 200) throw Object.assign(Error('Synthetic context unavailable'), { status: state.status });
      const denied = guest && args.path !== '/explore';
      return { schemaVersion: 1, contextPath: args.path, host: { ...window.__reylumiAppLocalContext }, context: { scope, authenticated: !guest, viewerId: guest ? null : viewerId, workspaceId: guest ? 'guest' : 'owner-space', salonId: guest ? null : salonId, permissionRevision: guest ? '' : 'owner-v1' }, grant: guest ? null : { version: 1, scope, scopes: [scope], viewerId, workspaceId: 'owner-space', salonId, grantRevision: 'owner-v1', generation, issuedAt: now - 1000, expiresAt: now + 3600000, path: '/staff/today', kind: 'owner' }, grantStatus: denied ? 401 : 200, access: { ownerWorkspace: !guest, staffWorkspace: false }, home: guest ? '/explore' : '/staff/today', display: { name: 'Synthetic fixture', language: 'en', role: guest ? 'Guest' : 'Owner' }, onlineValidatedAt: now, offline: !guest && args.fresh !== true && options.cached !== false };
    }
    if (kind === 'read') {
      if (args.scope !== (state.guest ? guestScope : ownerScope)) throw Object.assign(Error('Synthetic wrong-scope read'), { status: 403 });
      state.reads.push({ name, guest: state.guest });
      let data;
      if (name === 'shell.navigation') data = { scope: args.scope, navigation: {}, audience: state.guest ? 'guest' : 'owner' };
      else if (name === 'shell.configuration') data = { scope: args.scope, language: { enabled: false, portableEnabled: false, expiresAt: null }, campaign: { installed: false, runtime: null } };
      else if (name === 'shell.summary') data = { scope: args.scope, notificationScope: args.scope, summary: {} };
      else if (name === 'shell.notice') data = { scope: args.scope, mode: null };
      else if (name === 'page.fixture-public') data = { value: 'SYNTHETIC_PUBLIC_DATA' };
      else throw Error('Unexpected synthetic read');
      return { schemaVersion: 1, status: 200, scope: args.scope, etag: 'fixed-fixture', updatedAt: Date.now(), data };
    }
    if (kind === 'cache') { if (name === 'cancel' || ['get', 'remove'].includes(args.op)) return null; throw Error('Cache write forbidden'); }
    if (kind === 'command') { state.commands++; throw Error('Commands forbidden'); }
    if (kind === 'online') { state.login++; throw Error('Hosted login forbidden'); }
    throw Error('Unexpected native operation');
  } };
}
async function fixture(options = {}) {
  const output = await compile(), errors = [], external = [];
  const server = createServer((request, response) => {
    assert.equal(request.method, 'GET');
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? output.outputFiles[0].text : '<div id="app"></div><script>(' + setup.toString() + ')(' + JSON.stringify(options) + ')</script><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser ??= engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ headless: true, executablePath: browserPath });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage(), origin = 'http://127.0.0.1:' + server.address().port;
  page.setDefaultTimeout(4500); page.on('pageerror', error => errors.push(error.name + ': ' + error.message));
  await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push('blocked'); return route.abort(); });
  try {
    await page.goto(origin + (options.startPath || '/staff/today'));
    await page.locator(options.guest || options.startPath === '/explore' ? '[data-public-dto]' : '[data-private-page]').waitFor();
    await page.waitForFunction(guest => window.fixtureCommandScope() === 'v3:' + (guest ? 'b' : 'a').repeat(64), options.guest === true);
    return { page, async close() {
      const effects = await page.evaluate(() => ({ commands: window.fixtureState.commands, login: window.fixtureState.login, cookieWrites: window.fixtureState.cookieWrites, cookieHookInstalled: window.fixtureState.cookieHookInstalled, logoutResets: window.fixtureState.logoutResets }));
      await context.close(); await new Promise(resolve => server.close(resolve));
      assert.deepEqual(effects, { commands: 0, login: 0, cookieWrites: 0, cookieHookInstalled: true, logoutResets: 0 }); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    } };
  } catch (error) { await context.close(); await new Promise(resolve => server.close(resolve)); throw error; }
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function scenario(name, body, options) {
  const app = await fixture(options); let error;
  try { await body(app.page); } catch (failure) { error = failure; }
  try { await app.close(); } catch (failure) { error ||= failure; }
  observations.push({ name, passed: !error, ...(error ? { failure: { name: error.name, message: error.message } } : {}) });
  if (error) throw error;
}

test('one outer guest choice acknowledges expiry before a held fresh guest reply and never restores private authority', { timeout: 25000 }, () => scenario('outer-guest-held-reply', async page => {
  assert.match(await page.evaluate(() => window.fixtureCommandScope()), /^v3:/);
  await page.evaluate(() => { window.fixtureState.guest = true; window.fixtureState.holdGuest = true; window.fixtureRefresh(); });
  await page.locator('[data-context-failure="sign-in"]').waitFor();
  assert.equal(await page.locator('[data-private-page]').count(), 0);
  assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await page.waitForFunction(() => window.fixtureState.held.length === 1);
  await settle(page);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('[data-private-page]').count(), 0);
  assert.equal(await page.evaluate(() => window.fixtureCommandScope()), undefined);
  await page.evaluate(() => window.fixtureRelease());
  await page.locator('[data-public-dto]').filter({ hasText: 'SYNTHETIC_PUBLIC_DATA' }).waitFor(); await settle(page);
  assert.equal(await page.locator('dialog[open]').count(), 0, 'a second modal must not require acknowledging the same guest choice again');
  assert.equal(await page.locator('[data-private-page]').count(), 0);
  const calls = await page.evaluate(() => window.fixtureState.contexts);
  assert.deepEqual(calls.map(row => row.path), ['/staff/today', '/staff/today', '/explore']);
  assert.equal(calls[1].fresh, true); assert.equal(calls[0].fresh, false);
  await page.evaluate(() => window.fixtureRefresh());
  await page.waitForFunction(() => window.fixtureState.contexts.length === 4); await settle(page);
  assert.equal(await page.locator('dialog[open]').count(), 0, 'another confirmed guest check cannot re-open an acknowledged expiry');
  assert.equal(await page.locator('[data-private-page]').count(), 0);
}));

test('an explicit outer guest choice does not suppress a later genuine authenticated-to-guest expiry', { timeout: 25000 }, () => scenario('outer-guest-later-expiry', async page => {
  await page.evaluate(() => { window.fixtureState.guest = true; window.fixtureRefresh(); });
  await page.locator('[data-context-failure="sign-in"]').waitFor();
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await page.locator('[data-public-dto]').filter({ hasText: 'SYNTHETIC_PUBLIC_DATA' }).waitFor(); await settle(page);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.evaluate(() => { window.fixtureState.guest = false; window.fixtureRefresh(); });
  await page.waitForFunction(() => window.fixtureCommandScope() === 'v3:' + 'a'.repeat(64)); await settle(page);
  await page.evaluate(() => { window.fixtureState.guest = true; window.fixtureRefresh(); });
  await page.getByRole('dialog', { name: 'Session expired', exact: true }).waitFor();
  assert.equal(await page.locator('[data-private-page]').count(), 0);
}));

test('ordinary expiry still opens the real modal and its guest choice remains a presentation-only public continuation', { timeout: 25000 }, () => scenario('modal-guest-and-rearm', async page => {
  await page.evaluate(() => { window.fixtureState.guest = true; window.fixtureRefresh(); });
  const dialog = page.getByRole('dialog', { name: 'Session expired', exact: true }); await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Continue as guest', exact: true }).click(); await settle(page);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.evaluate(() => { window.fixtureState.guest = false; window.fixtureRefresh(); });
  await page.waitForFunction(() => window.fixtureCommandScope() === 'v3:' + 'a'.repeat(64));
  await page.evaluate(() => { window.fixtureState.guest = true; window.fixtureRefresh(); }); await dialog.waitFor();
  await dialog.evaluate(element => element.dispatchEvent(new Event('cancel', { cancelable: true }))); await settle(page);
  assert.equal(await page.locator('dialog[open]').count(), 0);
}, { startPath: '/explore', cached: false }));

test('a cold guest and unavailable auth checks never manufacture an expired session', { timeout: 25000 }, () => scenario('cold-guest-unavailable', async page => {
  await page.locator('[data-public-dto]').filter({ hasText: 'SYNTHETIC_PUBLIC_DATA' }).waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  const count = await page.evaluate(() => window.fixtureState.contexts.length);
  await page.evaluate(() => { window.fixtureState.status = 503; window.fixtureRefresh(); });
  await page.waitForFunction(before => window.fixtureState.contexts.length > before && window.fixtureState.contexts.at(-1).settled, count); await settle(page);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('[data-private-page]').count(), 0);
}, { startPath: '/explore', guest: true }));

after(async () => {
  if (browser) await browser.close();
  if (process.env.TEST_GUEST_CONTINUATION_REPORT) {
    const output = path.resolve(process.env.TEST_GUEST_CONTINUATION_REPORT); mkdirSync(path.dirname(output), { recursive: true });
    const files = ['app/local-app/entry.tsx', 'components/app-local-shell.tsx', 'components/app-local-session-expiry-prompt.tsx'];
    writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), engine, baseline: Boolean(baseline), passed: observations.length === 4 && observations.every(row => row.passed), total: observations.length, failed: observations.filter(row => !row.passed).length, skipped: 0, sourceFiles: files.map(file => ({ file, sha256: hash(readFileSync(selected(file))) })), testSha256: hash(readFileSync(import.meta.filename)), observations, syntheticBackendOnly: true, liveNetwork: false, actualEntry: true, actualShell: true, actualExpiryPrompt: true, nativeRuntimeTested: false }, null, 2) + '\n');
  }
});
