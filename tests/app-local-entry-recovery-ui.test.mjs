import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';
import { chromium, webkit } from 'playwright-core';

const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = engine === 'chromium' && !existsSync(browserPath);
const source = readFileSync('app/local-app/entry.tsx', 'utf8');
const parsed = ts.createSourceFile('entry.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const imports = new Map();
for (const declaration of parsed.statements) {
  if (!ts.isImportDeclaration(declaration)) continue;
  const path = declaration.moduleSpecifier.text;
  // The actual recovery implementation stays in the bundle. These mocks only
  // isolate the existing host, shell, page registry and business adapters.
  if (['react', 'react-dom/client', '@/lib/app-local-context-recovery', '@/lib/app-local-page-admission'].includes(path)) continue;
  const names = declaration.importClause?.namedBindings?.elements?.map(element => element.propertyName?.text ?? element.name.text) ?? [];
  imports.set(path, names);
}

test('scope conflict withdraws cached private UI without cancelling the pending current context', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ hold: [1, 2] });
  try {
    await app.page.waitForFunction(() => window.fixtureStats.attempts === 1);
    await app.page.evaluate(() => window.resolveContext(1, { offline: true }));
    await app.page.locator('[data-private-page]:visible').waitFor();
    await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:foreground')));
    await app.page.waitForFunction(() => window.fixtureStats.attempts === 2);
    await app.page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:app-local-scope-conflict', { detail: { scope: 'v3:' + 'a'.repeat(64), status: 409, reason: 'stale-scope' } })));
    await app.page.waitForFunction(() => !document.querySelector('[data-private-page]'));
    assert.equal(await app.page.evaluate(() => window.fixtureStats.aborted), 0);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 2);
    await app.page.evaluate(() => {
      const scope = 'v3:' + 'b'.repeat(64);
      window.resolveContext(2, { context: { scope, authenticated: true, viewerId: 'synthetic-viewer', workspaceId: 'current-workspace', salonId: 'synthetic-salon', permissionRevision: 'current-permission' }, grant: { scope, generation: window.__reylumiAppLocalContext.generation, kind: 'owner', viewerId: 'synthetic-viewer', expiresAt: Date.now() + 3600000 } });
    });
    await app.page.locator('[data-private-scope="v3:' + 'b'.repeat(64) + '"]:visible').waitFor();
    assert.equal(await app.page.locator('[data-context-failure]').count(), 0);
    // A late read from the discarded scope cannot destroy the new workspace.
    await app.page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:app-local-scope-conflict', { detail: { scope: 'v3:' + 'a'.repeat(64), status: 409 } })));
    assert.equal(await app.page.locator('[data-private-scope="v3:' + 'b'.repeat(64) + '"]:visible').count(), 1);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 2);
  } finally { await app.close(); }
});

test('scope conflict starts one fresh recovery and repeated same-scope conflicts settle at manual retry', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ hold: [2] });
  try {
    await app.page.locator('[data-private-page]:visible').waitFor();
    const conflict = () => app.page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:app-local-scope-conflict', { detail: { scope: 'v3:' + 'a'.repeat(64), status: 409 } })));
    await conflict();
    await app.page.waitForFunction(() => window.fixtureStats.attempts === 2);
    assert.equal(await app.page.locator('[data-private-page]').count(), 0);
    await app.page.evaluate(() => window.resolveContext(2));
    await app.page.locator('[data-private-page]:visible').waitFor();
    await conflict();
    await app.page.locator('[data-context-failure="workspace"]').waitFor();
    assert.equal(await app.page.locator('[data-private-page]').count(), 0);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 2);
    await app.page.getByRole('button', { name: 'Try again', exact: true }).click();
    await app.page.locator('[data-private-page]:visible').waitFor();
    assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 3);
  } finally { await app.close(); }
});

test('fresh confirmed expiry withdraws a warm private lease and exposes a guest route', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ hold: [2] });
  try {
    await app.page.locator('[data-private-page]:visible').waitFor();
    await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:foreground')));
    await app.page.waitForFunction(() => window.fixtureStats.attempts === 2);
    await app.page.evaluate(() => window.resolveContext(2, { grant: null, grantStatus: 401, context: { scope: 'v3:' + 'b'.repeat(64), authenticated: false, viewerId: null, workspaceId: 'public', salonId: null, permissionRevision: '' } }));
    await app.page.locator('[data-context-failure="sign-in"]').waitFor();
    assert.equal(await app.page.locator('[data-private-page]').count(), 0);
    assert.equal(await app.page.locator('[data-owner-nav]').count(), 0);
    await app.page.getByRole('button', { name: 'Continue as guest', exact: true }).waitFor();
    assert.equal(await app.page.evaluate(() => window.fixtureStats.commands), 0);
  } finally { await app.close(); }
});

test('an online same-scope context captured before conflict cannot revive private UI before a new verification', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ hold: [2, 3] });
  try {
    await app.page.locator('[data-private-page]:visible').waitFor();
    await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:foreground')));
    await app.page.waitForFunction(() => window.fixtureStats.attempts === 2);
    await app.page.evaluate(() => {
      const scope = 'v3:' + 'a'.repeat(64);
      window.dispatchEvent(new CustomEvent('reylumi:app-local-scope-conflict', { detail: { scope, status: 409 } }));
      // Native events may precede the bridge reply. This is still the old read.
      window.dispatchEvent(new CustomEvent('reylumi:app-local-context', { detail: { schemaVersion: 1, contextPath: '/staff/today', context: { scope, authenticated: true, viewerId: 'synthetic-viewer', workspaceId: 'synthetic-workspace', salonId: 'synthetic-salon', permissionRevision: 'synthetic-permission' }, grant: { scope, generation: window.__reylumiAppLocalContext.generation, kind: 'owner', viewerId: 'synthetic-viewer', expiresAt: Date.now() + 3600000 }, onlineValidatedAt: Date.now(), offline: false, access: { ownerWorkspace: true } } }));
      window.resolveContext(2);
    });
    await app.page.waitForFunction(() => window.fixtureStats.attempts === 3);
    assert.equal(await app.page.locator('[data-private-page]').count(), 0);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.aborted), 0);
    await app.page.evaluate(() => window.resolveContext(3));
    await app.page.locator('[data-private-page]:visible').waitFor();
    assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 3);
  } finally { await app.close(); }
});
const replacements = {
  '@/lib/app-local-host': `export const getAppLocalHost=()=>window.fixtureHost;export const appLocalPath=value=>value;export const appLocalRequestId=()=>crypto.randomUUID();`,
  '@/lib/app-local-page-registry': `
    import React from 'react';
    const Page=({context,path})=>{window.fixtureStats.pageRenders++;return <main data-private-page data-private-path={path} data-private-scope={context.context.scope}>Authorized synthetic page</main>};
    export const getAppLocalPage=path=>['/staff/today','/settings'].includes(path.split('?')[0])?{id:path,title:path==='/staff/today'?'Today':'Settings',requiresContext:true,Component:Page}:null;`,
  '@/components/app-local-shell': `
    import React from 'react';
    export function AppLocalShell({context,children}){return <>{context?<nav data-owner-nav>Today Book POS More</nav>:<header data-guest-shell>Reylumi Search salons, cities, or nail ideas</header>}{children}{!context&&<footer>Report / Contact Help Terms Privacy</footer>}</>}`,
  './navigation': `export function AppLocalNavigationProvider({children}){return children}`,
  './scope': `export function ExperienceScopeProvider({children}){return children}`,
  '@/lib/app-local-command-client': `let scope;export const getAppLocalCommandScope=()=>scope;export const setAppLocalCommandScope=value=>scope=value`,
  '@/lib/app-local-scope-id': `export const isAppLocalScopeId=value=>/^v3:[a-f0-9]{64}$/.test(value);export const isAppLocalPortableScopeId=()=>false`,
  '@/lib/experience-offline-policy': `export const getExperienceOfflinePath=path=>path;export const isExperienceOfflineGrant=(grant,options,now=Date.now())=>grant?.scope===options.scope&&grant.expiresAt>now&&(!options.generation||grant.generation===options.generation)`,
  '@/lib/legal-policies': `export const legalDocuments={}`,
  '@/lib/app-local-reference-content': `export const APP_LOCAL_REFERENCE_ASSETS=[]`,
  '@/lib/app-local-resource': `export const resetAppLocalResources=()=>{};export const useAppLocalResource=()=>({loading:false,refreshing:false,refresh:async()=>{}})`,
  '@/lib/app-local-secondary-registry': `export const getAppLocalSecondaryPage=()=>null;export const appLocalRouteAlias=()=>null`,
  '@/lib/app-local-link-navigation': `export const installAppLocalLinkNavigation=()=>()=>{}`,
};
const mock = (path, names) => replacements[path] ?? names.map(name => `export const ${name}=${name.startsWith('getAppLocal') ? '()=>null' : ['clearExperienceSnapshots', 'acceptExperienceOfflineGrant'].includes(name) ? 'async()=>{}' : name.startsWith('install') ? '()=>()=>{}' : '()=>null'};`).join('\n');
let compiled;
function compile() {
  compiled ??= build({
    stdin: { contents: source, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'entry-fixture-boundaries', setup(builder) {
      for (const [path] of imports) builder.onResolve({ filter: new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ path, namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\/experience-offline-policy$/ }, () => ({ path: '@/lib/experience-offline-policy', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: mock(path, imports.get(path)), loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  return compiled;
}

async function fixture(options = {}) {
  const output = await compile();
  const setup = `
    window.fixtureOptions=${JSON.stringify(options)};
    window.fixtureStats={attempts:0,aborted:0,pageRenders:0,commands:0,rejected:0,calls:[],retryQueued:0,retryCancelled:0};window.fixtureHeld=new Map();
    // Only cancellation tests hold the real recovery's 300ms retry boundary.
    // Separate browser-control calls may arrive after 300ms on a busy build host.
    // Keep every other timer real, and retain cancelled callbacks to prove a
    // late delivery cannot resurrect the cancelled read.
    window.fixtureRetryTimers=new Map();window.fixtureCancelledRetries=[];
    const fixtureSetTimeout=window.setTimeout.bind(window),fixtureClearTimeout=window.clearTimeout.bind(window);
    if(window.fixtureOptions.holdRetry){
      window.setTimeout=(callback,delay,...args)=>{if(delay!==300)return fixtureSetTimeout(callback,delay,...args);const id=fixtureSetTimeout(()=>{},60000);window.fixtureRetryTimers.set(id,()=>callback(...args));window.fixtureStats.retryQueued++;return id;};
      window.clearTimeout=id=>{const callback=window.fixtureRetryTimers.get(id);if(callback){window.fixtureRetryTimers.delete(id);window.fixtureCancelledRetries.push(callback);window.fixtureStats.retryCancelled++;}fixtureClearTimeout(id);};
    }
    window.fixtureDeliverCancelledRetries=()=>window.fixtureCancelledRetries.splice(0).forEach(callback=>callback());
    window.__reylumiAppLocalContext={generation:'fixture-generation-20261018',scopeEpoch:1,nonce:'fixture-nonce'};
    const makeContext=(path,extra={})=>{
      const scope='v3:'+(path==='/settings'?'b':'a').repeat(64),generation=window.__reylumiAppLocalContext.generation;
      return{schemaVersion:1,context:{scope,authenticated:true,viewerId:'synthetic-viewer',workspaceId:'synthetic-workspace',salonId:'synthetic-salon',permissionRevision:'synthetic-permission'},grant:{scope,generation,kind:'owner',viewerId:'synthetic-viewer',expiresAt:Date.now()+3600000},onlineValidatedAt:Date.now(),offline:false,access:{ownerWorkspace:true},...extra};
    };
    window.resolveContext=(id,extra={})=>window.fixtureHeld.get(id)?.resolve(extra);
    window.fixtureNavigate=path=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path}}));
    window.fixtureReset=()=>{window.__reylumiAppLocalContext={...window.__reylumiAppLocalContext,generation:'fixture-new-generation-20261018',scopeEpoch:2};window.dispatchEvent(new CustomEvent('reylumi:app-local-reset',{detail:{reason:'logout',scopeEpoch:2}}))};
    window.fixtureHost={isNative:true,cache:async()=>null,command:()=>{window.fixtureStats.commands++;throw Error('No commands authorized')},openOnline:()=>{throw Error('No hosted navigation authorized')},context:async(path,request)=>{
      const id=++window.fixtureStats.attempts,plan=window.fixtureOptions.statuses||[200];window.fixtureStats.calls.push({id,path,fresh:Boolean(request.fresh)});
      const captured=makeContext(path);
      return new Promise((resolve,reject)=>{
        let settled=false;
        const abort=()=>{if(settled)return;window.fixtureStats.aborted++;if(window.fixtureOptions.ignoreAbort?.includes(id))return;settled=true;reject(new DOMException('Synthetic cancelled read','AbortError'))};
        request.signal.addEventListener('abort',abort,{once:true});
        const finish=(extra={})=>{
          if(settled)return;settled=true;request.signal.removeEventListener('abort',abort);
          const status=path==='/settings'?200:plan[Math.min(id-1,plan.length-1)];
          if(status!==200){window.fixtureStats.rejected++;reject(Object.assign(new Error('Synthetic context failure'),{status}));return}
          if(window.fixtureOptions.invalidScope)captured.context.scope='invalid-proof';
          resolve({...captured,...extra});
        };
        if(window.fixtureOptions.hold?.includes(id))window.fixtureHeld.set(id,{resolve:finish});else setTimeout(finish,25);
      });
    }};`;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? output.outputFiles[0].text : `<div id="app"></div><script>${setup}</script><script src="/app.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  let browser;
  try {
    browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: browserPath, headless: true }));
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/staff/today');
    return { page, async close() { const commands = await page.evaluate(() => window.fixtureStats.commands); await browser.close(); await new Promise(resolve => server.close(resolve)); assert.equal(commands, 0); assert.deepEqual(errors, []); } };
  } catch (error) { await browser?.close(); await new Promise(resolve => server.close(resolve)); throw error; }
}

test('cold context 503 retries once and admits the real entry without a user action', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ statuses: [503, 200] });
  try {
    await app.page.locator('[data-private-page]').waitFor();
    const observed = await app.page.evaluate(() => ({ ...window.fixtureStats }));
    assert.equal(observed.attempts, 2); assert.equal(observed.aborted, 0);
    assert.equal(await app.page.locator('[data-owner-nav]').count(), 1);
    assert.equal(await app.page.locator('[data-context-failure]').count(), 0);
  } finally { await app.close(); }
});

test('two transient failures stop at a classified manual retry; explicit retry can recover', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ statuses: [503, 503, 200] });
  try {
    await app.page.locator('[data-context-failure]').waitFor();
    await app.page.waitForTimeout(1100);
    const before = await app.page.evaluate(() => ({ ...window.fixtureStats }));
    assert.equal(before.attempts, 2); assert.equal(before.pageRenders, 0);
    await app.page.getByRole('button', { name: 'Try again', exact: true }).click();
    await app.page.locator('[data-private-page]').waitFor();
    assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 3);
  } finally { await app.close(); }
});

test('confirmed access denial never automatically retries or renders a private page', { skip, timeout: 30000 }, async () => {
  for (const status of [401, 403, 409]) {
    const app = await fixture({ statuses: [status, 200] });
    try {
      await app.page.locator('[data-context-failure]').waitFor();
      await app.page.waitForTimeout(900);
      const stats = await app.page.evaluate(() => ({ ...window.fixtureStats }));
      assert.equal(stats.attempts, 1, String(status)); assert.equal(stats.pageRenders, 0);
      assert.equal(await app.page.locator('[data-owner-nav]').count(), 0);
    } finally { await app.close(); }
  }
});

test('same-path foreground joins pending admission; cached authority paints before one fresh upgrade', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ hold: [1, 2] });
  try {
    await app.page.waitForFunction(() => window.fixtureStats.attempts === 1);
    await app.page.evaluate(() => { window.dispatchEvent(new Event('reylumi:foreground')); window.dispatchEvent(new Event('online')); });
    await app.page.waitForTimeout(100);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 1);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.aborted), 0);
    await app.page.evaluate(() => window.resolveContext(1, { offline: true }));
    await app.page.locator('[data-private-page]').waitFor();
    await app.page.waitForFunction(() => window.fixtureStats.attempts === 2);
    const calls = await app.page.evaluate(() => window.fixtureStats.calls);
    assert.deepEqual(calls.map(call => call.fresh), [false, true]);
    assert.equal(await app.page.locator('[data-context-failure]').count(), 0);
    await app.page.evaluate(() => window.resolveContext(2));
    await app.page.waitForTimeout(100);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 2);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.aborted), 0);
  } finally { await app.close(); }
});

test('navigation cancels backoff or pending admission and cannot admit a late former scope', { skip, timeout: 25000 }, async () => {
  for (const delayed of [false, true]) {
    const app = await fixture(delayed ? { hold: [1], ignoreAbort: [1] } : { statuses: [503, 200], holdRetry: true });
    try {
      await app.page.waitForFunction(delayed ? () => window.fixtureStats.attempts === 1 : () => window.fixtureRetryTimers.size === 1);
      await app.page.evaluate(() => window.fixtureNavigate('/settings'));
      if (!delayed) {
        assert.equal(await app.page.evaluate(() => window.fixtureStats.retryCancelled), 1);
        assert.equal(await app.page.evaluate(() => window.fixtureRetryTimers.size), 0);
        await app.page.evaluate(() => window.fixtureDeliverCancelledRetries());
      }
      await app.page.locator('[data-private-page][data-private-path="/settings"][data-private-scope="v3:' + 'b'.repeat(64) + '"]:visible').waitFor();
      if (delayed) await app.page.evaluate(() => window.resolveContext(1));
      await app.page.waitForTimeout(1100);
      const calls = await app.page.evaluate(() => window.fixtureStats.calls);
      assert.deepEqual(calls.map(call => call.path), ['/staff/today', '/settings']);
      assert.equal(await app.page.locator('[data-private-scope="v3:' + 'a'.repeat(64) + '"]').count(), 0);
    } finally { await app.close(); }
  }
});

test('reset cancels cold backoff and a late cancelled context cannot restore its old authority', { skip, timeout: 20000 }, async () => {
  for (const delayed of [false, true]) {
    const app = await fixture(delayed ? { hold: [1], ignoreAbort: [1] } : { statuses: [503, 200], holdRetry: true });
    try {
      await app.page.waitForFunction(delayed ? () => window.fixtureStats.attempts === 1 : () => window.fixtureRetryTimers.size === 1);
      await app.page.evaluate(() => window.fixtureReset());
      if (!delayed) {
        assert.equal(await app.page.evaluate(() => window.fixtureStats.retryCancelled), 1);
        assert.equal(await app.page.evaluate(() => window.fixtureRetryTimers.size), 0);
        await app.page.evaluate(() => window.fixtureDeliverCancelledRetries());
      }
      if (delayed) await app.page.evaluate(() => window.resolveContext(1));
      await app.page.waitForTimeout(1100);
      assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 1);
      assert.equal(await app.page.locator('[data-private-page]').count(), 0);
      assert.equal(await app.page.locator('[data-owner-nav]').count(), 0);
    } finally { await app.close(); }
  }
});

test('a successful transport with invalid admission proof is not retried or rendered', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ invalidScope: true });
  try {
    await app.page.locator('[data-context-failure]').waitFor();
    await app.page.waitForTimeout(900);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 1);
    assert.equal(await app.page.locator('[data-private-page]').count(), 0);
  } finally { await app.close(); }
});

test('only an otherwise-valid expired cached lease can advance to an already queued fresh check', { skip, timeout: 30000 }, async () => {
  for (const scenario of ['expired', 'no-foreground', 'malformed', 'unconfirmed', 'access-denied']) {
    const app = await fixture({ hold: [1, 2] });
    try {
      await app.page.waitForFunction(() => window.fixtureStats.attempts === 1);
      if (scenario !== 'no-foreground') await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:foreground')));
      await app.page.evaluate(value => {
        const grant = {
          scope: 'v3:' + 'a'.repeat(64), viewerId: 'synthetic-viewer',
          generation: value === 'malformed' ? 'fixture-wrong-generation' : window.__reylumiAppLocalContext.generation,
          expiresAt: Date.now() - 1,
        };
        window.resolveContext(1, { offline: true, grant,
          ...(value === 'unconfirmed' ? { offlineState: 'unconfirmed' } : {}),
          ...(value === 'access-denied' ? { grantStatus: 403 } : {}),
        });
      }, scenario);
      if (scenario === 'expired') {
        await app.page.waitForFunction(() => window.fixtureStats.attempts === 2);
        assert.equal(await app.page.evaluate(() => window.fixtureStats.pageRenders), 0, 'an expired lease cannot admit even one private frame');
        assert.equal(await app.page.locator('[data-owner-nav]').count(), 0);
        assert.deepEqual(await app.page.evaluate(() => window.fixtureStats.calls.map(call => call.fresh)), [false, true]);
        await app.page.evaluate(() => window.resolveContext(2));
        await app.page.locator('[data-private-page]').waitFor();
        assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 2);
      } else {
        await app.page.locator('[data-context-failure]').waitFor();
        await app.page.waitForTimeout(900);
        assert.equal(await app.page.evaluate(() => window.fixtureStats.attempts), 1, scenario);
        assert.equal(await app.page.evaluate(() => window.fixtureStats.pageRenders), 0, scenario);
        assert.equal(await app.page.locator('[data-owner-nav]').count(), 0);
      }
    } finally { await app.close(); }
  }
});
