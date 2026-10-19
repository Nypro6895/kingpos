import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';
import { chromium, webkit } from 'playwright-core';
import { commandTraceRouteDependencies } from './fixtures/app-local-command-trace.mjs';

// Real useHiddenPosts + real command route + original hidden-post action.
// Identity/database clients and native HTTP delivery are local fixtures only.
const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = engine === 'chromium' && !existsSync(browserPath);
const policy = JSON.parse(readFileSync('lib/app-local-command-policy.json', 'utf8'));
function load(file, dependencies = {}) {
  const exports = {}, code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected ${file} dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const guestPolicy = load('lib/app-local-guest-read-policy.ts', {
  'server-only': {}, 'node:crypto': { createHash }, './app-local-command-policy.json': policy,
});
const actionName = guestPolicy.APP_LOCAL_GUEST_HIDDEN_POSTS_READ;
const codec = load('lib/app-local-command-codec.ts');
const guestHidden = 'beauty_post:00000000-0000-4000-8000-000000000001';
const accountHidden = 'beauty_post:00000000-0000-4000-8000-000000000002';
const guestScope = 'v3:' + 'a'.repeat(64), accountScope = 'v3:' + 'b'.repeat(64);
const scopeFor = viewerId => viewerId ? accountScope : guestScope;

test('guest read identity matches the reviewed build policy and exact generated original handler', () => {
  assert.ok(policy.modules['app/post-moderation/actions.ts'].includes('loadHiddenPostIdentitiesAction'));
  const generated = readFileSync('lib/app-local-commands-server.generated.ts', 'utf8');
  const alias = generated.match(/import \{loadHiddenPostIdentitiesAction as (\w+)\} from "@\/app\/post-moderation\/actions";/)?.[1];
  assert.ok(alias);
  const mapping = generated.match(new RegExp('"(action\\.[a-f0-9]{24})": \\(values: unknown\\[\\]\\) => \\(' + alias + ' as unknown'))?.[1];
  assert.equal(actionName, mapping);
  assert.equal(actionName, 'action.' + createHash('sha256').update('app/post-moderation/actions.ts#loadHiddenPostIdentitiesAction').digest('hex').slice(0, 24));
});

function commandFixture() {
  let viewerId = null, nextRows;
  const calls = [], untouched = async () => ({ handled: false });
  const rpc = async kind => {
    calls.push({ kind, viewerId, name: 'get_my_hidden_posts' });
    const values = nextRows ?? [viewerId ? accountHidden : guestHidden];
    return { data: values.map(key => { const [source_type, source_id] = key.split(':'); return { source_type, source_id }; }), error: null };
  };
  const action = load('app/post-moderation/actions.ts', {
    '@/lib/owner-campaigns': {}, '@/lib/current-context': {}, '@/lib/abuse-server': {},
    '@/lib/supabase/server': {
      createAuthenticatedSupabaseServerClient: async () => viewerId ? { rpc: async name => { assert.equal(name, 'get_my_hidden_posts'); return rpc('authenticated'); } } : null,
      createSafetySupabaseServerClient: async () => ({ rpc: async name => { assert.equal(name, 'get_my_hidden_posts'); return rpc('signed-safety-device'); } }),
    },
    'next/cache': { revalidatePath() { assert.fail('Hidden-state read must not invalidate or mutate'); } },
    '@/lib/users/current-user': {}, '@/lib/beauty': {}, 'next/headers': {},
  });
  const route = load('app/api/app-local/command/route.ts', {
    ...commandTraceRouteDependencies(),
    'next/server': { connection: async () => {} }, 'next/headers': { headers: async () => new Headers() },
    '@/lib/request-business-context': { getRequestBusinessContext: async () => ({ user: viewerId ? { id: viewerId } : null }) },
    '@/lib/experience-context': { getExperienceContext: () => ({ scope: scopeFor(viewerId), authenticated: Boolean(viewerId) }) },
    '@/lib/staff-portal-identity': {}, '@/lib/current-context': {},
    '@/lib/app-local-commands-server.generated': { runAppLocalCommand: async (name, values) => { assert.equal(name, actionName, 'No other action may reach the original dispatcher'); assert.deepEqual(values, []); return action.loadHiddenPostIdentitiesAction(); } },
    '@/lib/app-local-command-codec': codec,
    '@/lib/app-local-http-server': { runAppLocalHttpCommand: untouched },
    '@/lib/app-local-role-http-server': { runAppLocalRoleHttpCommand: untouched },
    '@/lib/app-local-personal-resources-server': { runAppLocalPersonalCommand: untouched },
    '@/lib/app-local-explore-server': { runAppLocalExploreHttpCommand: untouched },
    '@/lib/app-local-public-server': { runAppLocalPublicHttpCommand: untouched },
    '@/lib/app-local-upload-server': { runAppLocalUploadCommand: untouched, AppLocalUploadError: class extends Error {} },
    '@/lib/app-local-shell-server': { runAppLocalShellCommand: untouched },
    '@/lib/app-local-portable-http-server': {}, '@/lib/app-local-portable-context-server': {},
    '@/lib/app-local-scope-id': { isAppLocalScopeId: value => /^v3:[a-f0-9]{64}$/.test(value), isAppLocalPortableScopeId: () => false },
    '@/lib/app-local-portable-actions.generated.json': {}, '@/lib/app-local-display-server': { authorizeAppLocalDisplayCommand: async () => false },
    '@/lib/app-local-guest-read-policy': guestPolicy,
  });
  return {
    calls,
    rows(value) { nextRows = value; },
    async command(options = {}) {
      viewerId = options.viewerId ?? null;
      return route.POST(new Request('https://reylumi.com/api/app-local/command', {
        method: 'POST', headers: { origin: options.origin ?? 'https://reylumi.com', 'content-type': 'application/json' },
        body: JSON.stringify({ name: options.name ?? actionName, args: options.args ?? { values: [] }, scope: options.scope ?? scopeFor(viewerId), requestId: '00000000-0000-4000-8000-000000000003' }),
      }));
    },
  };
}

test('only the exact zero-argument, current-scope guest read reaches the unchanged safety handler', async () => {
  const f = commandFixture(), result = await f.command();
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, data: { value: [guestHidden] } });
  assert.deepEqual(f.calls, [{ kind: 'signed-safety-device', viewerId: null, name: 'get_my_hidden_posts' }]);
  for (const [options, status] of [
    [{ args: { values: ['other-device'] } }, 400], [{ args: { values: [], device: 'other' } }, 400], [{ args: {} }, 400],
    [{ args: { values: { $reylumi: 'undefined' } } }, 400], [{ args: { values: [null] } }, 400],
    [{ scope: accountScope }, 409], [{ origin: 'https://untrusted.invalid' }, 403],
    [{ name: 'action.aaaaaaaaaaaaaaaaaaaaaaaa' }, 401],
    [{ name: 'action.' + createHash('sha256').update('app/post-moderation/actions.ts#postModerationAction').digest('hex').slice(0, 24) }, 401],
  ]) assert.equal((await f.command(options)).status, status, JSON.stringify(options));
  assert.equal(f.calls.length, 1, 'Invalid authority/arguments and all other actions never reach the original handler');
});

let compiled;
function compile() {
  const replacements = {
    '@/app/post-moderation/actions': `export const loadHiddenPostIdentitiesAction=()=>window.fixtureCommand();export const postModerationAction=()=>{throw Error('No mutations authorized')};`,
    '@/components/workspace-language': `export const useWorkspaceTranslation=()=>value=>value;export const WorkspaceText=()=>null;`,
    '@/components/post-change-state': `export const POST_CHANGED_EVENT='fixture-post-changed';export const announcePostChange=()=>{};`,
    'next/link': `export default function Link(){return null;}`,
  };
  compiled ??= build({
    stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{useHiddenPosts}from'./components/post-safety';const root=createRoot(document.getElementById('app'));function Probe({id}){const hidden=useHiddenPosts(window.fixtureViewer);return <output data-hook={id}>{hidden.join(',')}</output>;}function App(){React.useEffect(()=>{requestAnimationFrame(()=>window.fixtureReady++);});return Array.from({length:window.fixtureOptions.probes??1},(_,id)=><Probe key={window.fixtureViewer+':'+id} id={id}/>);}window.fixtureSetViewer=id=>{window.fixtureViewer=id;root.render(<App/>);};window.fixtureSetViewer(window.fixtureViewer);`, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'hidden-post-boundaries', setup(builder) {
      for (const path of Object.keys(replacements)) builder.onResolve({ filter: new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: replacements[path], loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  return compiled;
}

async function browserFixture(options = {}) {
  const output = await compile(), api = commandFixture(), requests = [], held = [];
  let resolveFirstRequest;
  const firstRequest = new Promise(resolve => { resolveFirstRequest = resolve; });
  const setup = `window.fixtureOptions=${JSON.stringify(options)};window.fixtureViewer=${JSON.stringify(options.viewerId ?? null)};window.fixtureReady=0;window.fixtureStatuses=[];window.fixtureCommand=async()=>{const viewerId=window.fixtureViewer;const response=await fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({viewerId})});window.fixtureStatuses.push(response.status);const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error),{status:response.status});return result.data.value;};`;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/command') {
        let body = ''; for await (const chunk of request) body += chunk;
        const input = JSON.parse(body), result = await api.command(input), text = await result.text();
        requests.push({ viewerId: input.viewerId, status: result.status });
        resolveFirstRequest();
        const finish = () => { response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(text); };
        if (options.holdFirst && requests.length === 1) held.push(finish); else finish();
      } else {
        response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
        response.end(request.url === '/app.js' ? output.outputFiles[0].text : `<div id="app"></div><script>${setup}</script><script src="/app.js"></script>`);
      }
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); server.unref();
  let browser;
  try {
    browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: browserPath, headless: true }));
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.fixtureReady > 0);
    return { page, api, requests, firstRequest, release() { held.splice(0).forEach(finish => finish()); }, async close() { held.splice(0).forEach(finish => finish()); await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
  } catch (error) { await browser?.close(); held.splice(0).forEach(finish => finish()); await new Promise(resolve => server.close(resolve)); throw error; }
}

test('cold guest hook restores server hidden posts without 401 and joins simultaneous mount reads', { skip, timeout: 20000 }, async () => {
  const f = await browserFixture({ probes: 2 });
  try {
    await f.page.waitForFunction(() => window.fixtureStatuses.length > 0);
    assert.deepEqual(await f.page.evaluate(() => window.fixtureStatuses), [200]);
    assert.deepEqual(await f.page.locator('[data-hook]').allTextContents(), [guestHidden, guestHidden]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.api.calls[0].kind, 'signed-safety-device');
  } finally { await f.close(); }
});

test('signed-in hook retains account hiding and a focus refresh updates the current list', { skip, timeout: 20000 }, async () => {
  const f = await browserFixture({ viewerId: 'synthetic-account' });
  try {
    await f.page.waitForFunction(() => document.querySelector('[data-hook]').textContent.includes('000000000002'));
    assert.equal(f.requests.length, 1); assert.equal(f.api.calls[0].kind, 'authenticated');
    f.api.rows([]);
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.page.waitForFunction(() => window.fixtureStatuses.length === 2 && !document.querySelector('[data-hook]').textContent);
    assert.deepEqual(f.requests.map(row => row.status), [200, 200]);
  } finally { await f.close(); }
});

test('guest-account-guest remounts keep hidden lists separate and reuse only the matching viewer cache', { skip, timeout: 20000 }, async () => {
  const f = await browserFixture();
  try {
    await f.page.waitForFunction(() => document.querySelector('[data-hook]').textContent.includes('000000000001'));
    await f.page.evaluate(() => window.fixtureSetViewer('synthetic-account'));
    await f.page.waitForFunction(() => document.querySelector('[data-hook]').textContent.includes('000000000002'));
    await f.page.evaluate(() => window.fixtureSetViewer(null));
    await f.page.waitForFunction(() => document.querySelector('[data-hook]').textContent.includes('000000000001'));
    assert.equal(await f.page.locator('[data-hook]').textContent(), guestHidden);
    assert.deepEqual(f.requests.map(row => row.viewerId), [null, 'synthetic-account']);
    assert.deepEqual(f.requests.map(row => row.status), [200, 200]);
    assert.equal(await f.page.evaluate(() => localStorage.getItem('reylumi-hidden-posts:guest')), null);
    assert.deepEqual(await f.page.evaluate(() => JSON.parse(localStorage.getItem('reylumi-hidden-posts:synthetic-account'))), [accountHidden]);
  } finally { await f.close(); }
});

test('account-to-guest remount discards delayed private replies and uses guest authority only', { skip, timeout: 20000 }, async () => {
  const f = await browserFixture({ viewerId: 'synthetic-account', holdFirst: true });
  try {
    await f.firstRequest;
    await f.page.evaluate(() => window.fixtureSetViewer(null));
    await f.page.waitForFunction(() => window.fixtureStatuses.length === 1);
    assert.deepEqual(await f.page.evaluate(() => window.fixtureStatuses), [200]);
    await f.page.waitForFunction(() => document.querySelector('[data-hook]').textContent.includes('000000000001'));
    f.release();
    await f.page.waitForFunction(() => window.fixtureStatuses.length === 2);
    assert.equal(await f.page.locator('[data-hook]').textContent(), guestHidden);
    assert.deepEqual(f.api.calls.map(row => row.kind), ['authenticated', 'signed-safety-device']);
  } finally { await f.close(); }
});
