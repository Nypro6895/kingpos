import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';
import { chromium, webkit } from 'playwright-core';
import { commandTraceRouteDependencies } from './fixtures/app-local-command-trace.mjs';

// Exercise the real component and command-route authentication boundary. Only
// database authority, original action results and presentation helpers are fake.
// All requests stay on this local fixture; no business records are changed.
const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = engine === 'chromium' && !existsSync(browserPath);
const scope = 'v3:' + 'a'.repeat(64);
const readAction = 'action.40084b43686b6b73dc4dc79b';
const target = { salonId: null, sourceType: 'beauty_post', sourceId: '00000000-0000-4000-8000-000000000001' };
const stateKey = target.sourceType + ':' + target.sourceId;

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected ${file} dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

test('original web state getter treats guests as signed out and only reads public counts', async () => {
  const calls = [], types = load('types/saved-post.ts');
  const social = load('lib/account-social.ts', {
    'server-only': {}, '@/lib/beauty-media': {}, '@/lib/salon-profile': {},
    '@/lib/current-context': { getCurrentBusinessContext: async () => ({ user: null }) },
    '@/lib/supabase/server': {
      createAuthenticatedSupabaseServerClient: async () => null,
      createSupabaseServerClient: () => ({
        from() { assert.fail('Guest state must not query private saved-post tables'); },
        async rpc(name, args) {
          calls.push({ name, args });
          return { data: [{ source_id: target.sourceId, source_type: target.sourceType, save_count: 3 }], error: null };
        },
      }),
    },
    '@/types/saved-post': types,
  });
  const actions = load('app/saved-post/actions.ts', {
    '@/lib/account-social': social, '@/types/saved-post': types,
    'next/cache': { revalidatePath() { assert.fail('State getter must not invalidate or mutate'); } },
  });
  const result = await actions.getAccountSavedPostStatesAction([target]);
  assert.deepEqual(result, { canSave: false, error: null, savedKeys: [], saveCountsByKey: { [stateKey]: 3 } });
  assert.deepEqual(calls, [{ name: 'get_account_post_save_counts', args: { p_targets: [{ source_id: target.sourceId, source_type: target.sourceType }] } }]);
});

function commandRoute() {
  const exports = {}, untouched = async () => ({ handled: false });
  let authenticated = false;
  const dependencies = {
    ...commandTraceRouteDependencies(),
    'next/server': { connection: async () => {} },
    'next/headers': { headers: async () => new Headers() },
    '@/lib/request-business-context': { getRequestBusinessContext: async () => ({ user: authenticated ? { id: 'synthetic-viewer' } : null }) },
    '@/lib/experience-context': { getExperienceContext: () => ({ scope }) },
    '@/lib/staff-portal-identity': {}, '@/lib/current-context': {},
    '@/lib/app-local-commands-server.generated': { runAppLocalCommand: async (name, values) => name === readAction
      ? { canSave: true, savedKeys: [], saveCountsByKey: { [stateKey]: 3 } }
      : { active: values[1], saveCount: values[1] ? 4 : 3 } },
    '@/lib/app-local-command-codec': { decodeAppLocalValue: value => value },
    '@/lib/app-local-http-server': { runAppLocalHttpCommand: untouched },
    '@/lib/app-local-role-http-server': { runAppLocalRoleHttpCommand: untouched },
    '@/lib/app-local-personal-resources-server': { runAppLocalPersonalCommand: untouched },
    '@/lib/app-local-explore-server': { runAppLocalExploreHttpCommand: untouched },
    '@/lib/app-local-public-server': { runAppLocalPublicHttpCommand: untouched },
    '@/lib/app-local-upload-server': { runAppLocalUploadCommand: untouched, AppLocalUploadError: class extends Error {} },
    '@/lib/app-local-shell-server': { runAppLocalShellCommand: untouched },
    '@/lib/app-local-portable-http-server': {}, '@/lib/app-local-portable-context-server': {},
    '@/lib/app-local-scope-id': { isAppLocalScopeId: value => value === scope, isAppLocalPortableScopeId: () => false },
    '@/lib/app-local-portable-actions.generated.json': {},
    '@/lib/app-local-display-server': { authorizeAppLocalDisplayCommand: async () => false },
    '@/lib/app-local-guest-read-policy': { APP_LOCAL_GUEST_HIDDEN_POSTS_READ: 'action.' + createHash('sha256').update('app/post-moderation/actions.ts#loadHiddenPostIdentitiesAction').digest('hex').slice(0, 24) },
  };
  const code = ts.transpileModule(readFileSync('app/api/app-local/command/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected command dependency ${name}`);
    return dependencies[name];
  }, exports);
  return async (input, signedIn) => {
    authenticated = signedIn;
    return exports.POST(new Request('https://reylumi.com/api/app-local/command', {
      method: 'POST', headers: { origin: 'https://reylumi.com', 'content-type': 'application/json' }, body: JSON.stringify(input),
    }));
  };
}

let compiled;
function compile() {
  const replacements = {
    '@/app/saved-post/actions': `export const getAccountSavedPostStatesAction=targets=>window.fixtureCommand('${readAction}',[targets]);export const setAccountSavedPostAction=(target,active)=>window.fixtureCommand('action.aaaaaaaaaaaaaaaaaaaaaaaa',[target,active]);`,
    '@/components/workspace-language': `import React from'react';export const useWorkspaceTranslation=()=>value=>value;export const WorkspaceText=({text})=><>{text}</>;`,
    '@/components/auth-intent-prompt': `import React from'react';export const AuthIntentPrompt=({title,children,onClose})=><section role="dialog" aria-label={title}>{children}<button onClick={onClose}>Close</button></section>;`,
    '@/components/explore-account-actions': `export const ExploreReferenceLove=()=>null;export const rememberExploreIntent=value=>window.fixtureStats.intents.push(value);export const clearExploreIntent=()=>window.fixtureStats.cleared++;`,
  };
  compiled ??= build({
    stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{SavePostButton,SavePostAuthProvider}from'./app/saved-post/save-post-button';const root=createRoot(document.getElementById('app'));function App(){React.useEffect(()=>{requestAnimationFrame(()=>window.fixtureReady++);});const button=<SavePostButton {...window.fixtureProps} target={window.fixtureTarget} size="toolbar" showZeroCount onSavedChange={value=>window.fixtureStats.changes.push(value)}/>;return window.fixtureOptions.provider===undefined?button:<SavePostAuthProvider isAuthenticated={window.fixtureOptions.provider}>{button}</SavePostAuthProvider>;}window.fixtureRender=props=>{Object.assign(window.fixtureProps,props);root.render(<App/>);};window.fixtureRender({});`, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'saved-post-boundaries', setup(builder) {
      for (const path of Object.keys(replacements)) builder.onResolve({ filter: new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: replacements[path], loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  return compiled;
}

async function fixture(options = {}) {
  const output = await compile(), route = commandRoute(), requests = [];
  const setup = `window.fixtureTarget=${JSON.stringify(target)};window.fixtureOptions=${JSON.stringify(options)};window.fixtureProps=${JSON.stringify(options.props || {})};window.fixtureReady=0;window.fixtureStats={reads:0,writes:0,statuses:[],intents:[],cleared:0,changes:[]};window.fixtureCommand=async(name,values)=>{window.fixtureStats[name==='${readAction}'?'reads':'writes']++;const response=await fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,args:{values},scope:'${scope}',requestId:crypto.randomUUID(),signedIn:window.fixtureProps.isAuthenticated??window.fixtureOptions.provider??true})});window.fixtureStats.statuses.push(response.status);const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error),{status:response.status});return result.data.value;};`;
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/command') {
        let body = ''; for await (const chunk of request) body += chunk;
        const { signedIn, ...input } = JSON.parse(body), result = await route(input, signedIn);
        requests.push({ name: input.name, status: result.status });
        response.writeHead(result.status, { 'content-type': 'application/json' }); response.end(await result.text());
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
    const page = await browser.newPage({ reducedMotion: 'reduce' }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.fixtureReady > 0);
    return { page, requests, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
  } catch (error) { await browser?.close(); await new Promise(resolve => server.close(resolve)); throw error; }
}

test('guest mount never requests private saved state, with explicit or inherited authentication', { skip, timeout: 30000 }, async () => {
  for (const options of [{ props: { isAuthenticated: false } }, { provider: false }]) {
    const app = await fixture(options);
    try {
      assert.equal(await app.page.evaluate(() => window.fixtureStats.reads), 0, 'guest mount must not issue a command that returns 401');
      assert.equal(app.requests.length, 0);
      await app.page.getByRole('button', { name: 'Sign in to save post', exact: true }).click();
      await app.page.getByRole('dialog', { name: 'Save this look?', exact: true }).waitFor();
      const stats = await app.page.evaluate(() => window.fixtureStats);
      assert.equal(stats.reads, 0); assert.equal(stats.writes, 0); assert.deepEqual(stats.statuses, []);
      assert.deepEqual(stats.intents, [{ kind: 'save', target }]);
      await app.page.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal(await app.page.evaluate(() => window.fixtureStats.cleared), 1);
    } finally { await app.close(); }
  }
});

test('signing in after guest mount reads once and keeps the original save/update behavior', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ props: { isAuthenticated: false } });
  try {
    await app.page.evaluate(() => window.fixtureRender({ isAuthenticated: true }));
    await app.page.waitForFunction(() => window.fixtureStats.statuses.length === 1);
    assert.deepEqual(app.requests.map(row => row.status), [200]);
    await app.page.getByRole('button', { name: 'Save post', exact: true }).click();
    await app.page.getByRole('button', { name: 'Remove from Saved Post', exact: true }).waitFor();
    await app.page.waitForFunction(() => window.fixtureStats.statuses.length === 2);
    const stats = await app.page.evaluate(() => window.fixtureStats);
    assert.equal(stats.reads, 1); assert.equal(stats.writes, 1); assert.deepEqual(stats.statuses, [200, 200]);
    assert.deepEqual(stats.changes, [true, true]);
    assert.equal(await app.page.locator('[data-post-action-count]').textContent(), '4');
  } finally { await app.close(); }
});

test('authenticated known saved state avoids a duplicate read and still removes the saved post', { skip, timeout: 20000 }, async () => {
  const app = await fixture({ props: { isAuthenticated: true, initialSaved: true, saveCount: 4 } });
  try {
    assert.equal(await app.page.evaluate(() => window.fixtureStats.reads), 0);
    await app.page.getByRole('button', { name: 'Remove from Saved Post', exact: true }).click();
    await app.page.getByRole('button', { name: 'Save post', exact: true }).waitFor();
    await app.page.waitForFunction(() => window.fixtureStats.statuses.length === 1);
    const stats = await app.page.evaluate(() => window.fixtureStats);
    assert.equal(stats.reads, 0); assert.equal(stats.writes, 1); assert.deepEqual(stats.statuses, [200]);
    assert.equal(await app.page.locator('[data-post-action-count]').textContent(), '3');
  } finally { await app.close(); }
});

test('unknown authentication retains the existing state discovery and the command route still rejects guests', { skip, timeout: 20000 }, async () => {
  const app = await fixture();
  try {
    await app.page.waitForFunction(() => window.fixtureStats.statuses.length === 1);
    assert.deepEqual(app.requests.map(row => row.status), [200]);
    assert.equal(await app.page.evaluate(() => window.fixtureStats.reads), 1);
    const denied = await commandRoute()({ name: readAction, args: { values: [[target]] }, scope, requestId: '00000000-0000-4000-8000-000000000002' }, false);
    assert.equal(denied.status, 401, 'the fix must preserve private-command authentication');
  } finally { await app.close(); }
});
