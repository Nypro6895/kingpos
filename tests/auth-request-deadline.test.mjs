import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync('lib/bounded-get.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { fetchWithDeadline, ReadConnectionError } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute the installed SDK itself. Its support-script challenge stays pending;
// all native fetches below are local functions, never real auth/network calls.
function pendingBotId() {
  const sandbox = {
    exports: {}, URL, Request, Headers, Promise,
    location: { origin: 'https://fixture.invalid', href: 'https://fixture.invalid/login', host: 'fixture.invalid' },
    document: { hidden: false, querySelector: () => ({}), addEventListener() {}, removeEventListener() {} },
    XMLHttpRequest: class { open() {} send() {} }, addEventListener() {}, console: { error() {} },
  };
  let delegates = 0, wire = 0, child;
  sandbox.fetch = async (_input, init) => {
    delegates++; child = init.signal;
    if (child.aborted) throw child.reason;
    wire++; return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  };
  sandbox.window = sandbox; vm.createContext(sandbox);
  vm.runInContext(readFileSync(require.resolve('botid/client/core'), 'utf8'), sandbox);
  sandbox.exports.initBotId({ protect: [{ path: '/*', method: 'POST' }] });
  let calls = 0, supplied;
  return {
    fetcher: (input, init) => { calls++; supplied = init.signal; return sandbox.fetch(input, init); },
    release: () => sandbox.V_C.push({ b: 1, d: 0, v: 'fixture', e: 'fixture' }),
    facts: () => ({ calls, delegates, wire, child, supplied }),
  };
}

test('actual BotID preflight cannot hold a POST past its deadline or send it after late challenge completion', async () => {
  const sdk = pendingBotId(), parent = new AbortController();
  await assert.rejects(fetchWithDeadline('/api/auth/login', { method: 'POST', signal: parent.signal, body: 'fixture-only' }, {
    fetcher: sdk.fetcher, timeoutMs: 15, totalTimeoutMs: 15, maxAttempts: 2,
  }), error => error instanceof ReadConnectionError && error.kind === 'timeout');
  assert.equal(parent.signal.aborted, false);
  assert.equal(sdk.facts().calls, 1); assert.equal(sdk.facts().supplied.aborted, true);
  sdk.release(); await tick();
  assert.equal(sdk.facts().delegates, 1); assert.equal(sdk.facts().wire, 0);
  assert.equal(sdk.facts().child.aborted, true);
});

test('auth response-body stalls are bounded and error HTTP responses never replay a POST', async () => {
  let calls = 0, cancelled = 0, child;
  const parent = new AbortController();
  await assert.rejects(fetchWithDeadline('/api/auth/mfa/verify', { method: 'POST', signal: parent.signal }, {
    timeoutMs: 15, totalTimeoutMs: 15, maxAttempts: 2,
    fetcher: async (_input, init) => {
      calls++; child = init.signal;
      return new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel() { cancelled++; } }), { headers: { 'Content-Type': 'application/json' } });
    },
  }), error => error.kind === 'timeout');
  await tick();
  assert.equal(calls, 1); assert.equal(cancelled, 1); assert.equal(child.aborted, true); assert.equal(parent.signal.aborted, false);
  const response = await fetchWithDeadline('/api/auth/login', { method: 'POST', signal: parent.signal }, {
    maxAttempts: 2, fetcher: async () => { calls++; return new Response('{"error":"fixture"}', { status: 503, headers: { 'Content-Type': 'application/json' } }); },
  });
  assert.equal(calls, 2); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'fixture' });
});

test('unmount cancellation settles SDK preflight with the original abort reason and vetoes its later POST', async () => {
  const sdk = pendingBotId(), parent = new AbortController(), reason = new DOMException('fixture cancellation', 'AbortError');
  const pending = fetchWithDeadline('/api/auth/login', { method: 'POST', signal: parent.signal }, { fetcher: sdk.fetcher, timeoutMs: 1000 });
  await tick(); parent.abort(reason);
  await assert.rejects(pending, error => error === reason);
  sdk.release(); await tick(); assert.equal(sdk.facts().wire, 0); assert.equal(sdk.facts().calls, 1);
});

const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = engine === 'chromium' && !existsSync(browserPath);
let uiBuild;
async function fixture() {
  uiBuild ??= build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{LoginForm}from'./app/login/login-form';
    const originalTimer=window.setTimeout.bind(window);window.testDeadline=80;
    window.setTimeout=(fn,ms,...args)=>originalTimer(fn,ms===30000?window.testDeadline:ms,...args);
    window.requests=[];window.routes=[];window.refreshes=0;window.mode='hold';window.bodyCancelled=0;
    window.fetch=(input,init)=>{let resolve;const row={path:String(input),method:init.method,accept:new Headers(init.headers).get('Accept'),body:Object.fromEntries(init.body),signal:init.signal};
      window.requests.push(row);const pending=new Promise(done=>resolve=done);row.finish=value=>resolve(new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}));
      if(window.mode==='mfa'&&window.requests.length===1)row.finish({mfa:{factorId:'fixture-factor',challengeId:'fixture-challenge',factorType:'totp',phone:null,expiresAt:null}});
      if(window.mode==='body')resolve(new Response(new ReadableStream({cancel(){window.bodyCancelled++;}}),{headers:{'Content-Type':'application/json'}}));
      return pending;};
    const root=createRoot(document.getElementById('root'));let key=0;window.mount=()=>root.render(<LoginForm key={++key} nextPath='/fixture-next'/>);window.unmount=()=>root.render(null);window.mount();
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': process.cwd() }, plugins: [{ name: 'auth-ui-boundaries', setup(b) {
    for (const [filter, path] of [[/(?:^|\/)workspace-language$/, 'language'], [/(?:^|\/)touch-keyboard$/, 'keyboard'], [/^next\/navigation$/, 'router'], [/^next\/link$/, 'link']]) b.onResolve({ filter }, () => ({ path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'tsx', resolveDir: process.cwd(), contents: {
      language: 'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;',
      keyboard: 'export const PortableTouchKeyboard=()=>null;',
      router: 'export const useRouter=()=>({push:path=>window.routes.push(path),refresh:()=>window.refreshes++});',
      link: 'export default function Link({children,...props}){return <a {...props}>{children}</a>;}',
    }[path] }));
  } }] });
  const built = await uiBuild;
  const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? built.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); server.unref();
  const browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: browserPath, headless: true }));
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(2500);
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port); await page.locator('input[name=email]').waitFor();
  return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}
async function fillLogin(page) { await page.locator('input[name=email]').fill('fixture@example.invalid'); await page.locator('input[name=password]').fill('fixture-only'); }
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('real LoginForm timeout re-enables submission; a late old completion cannot overwrite a newer request', { skip, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await fillLogin(f.page); await f.page.locator('button[type=submit]').click(); await f.page.getByRole('alert').waitFor();
    assert.equal(await f.page.locator('button[type=submit]').isEnabled(), true);
    assert.deepEqual(await f.page.evaluate(() => window.requests.map(r => ({ path: r.path, method: r.method, accept: r.accept, body: r.body, aborted: r.signal.aborted }))), [{ path: '/api/auth/login', method: 'POST', accept: 'application/json', body: { next: '/fixture-next', email: 'fixture@example.invalid', password: 'fixture-only' }, aborted: true }]);
    assert.equal(await f.page.getByRole('checkbox', { name: 'Remember me' }).isChecked(), false);
    await f.page.evaluate(() => window.testDeadline = 5000); await f.page.locator('button[type=submit]').click(); await f.page.waitForFunction(() => window.requests.length === 2);
    await f.page.evaluate(() => window.requests[0].finish({ redirectTo: '/obsolete' })); await settle(f.page);
    assert.equal(await f.page.locator('button[type=submit]').isEnabled(), false); assert.deepEqual(await f.page.evaluate(() => window.routes), []);
    await f.page.evaluate(() => window.requests[1].finish({ redirectTo: '/current' })); await f.page.waitForFunction(() => window.routes.length === 1);
    assert.deepEqual(await f.page.evaluate(() => window.routes), ['/current']); assert.equal(await f.page.evaluate(() => window.refreshes), 1);
  } finally { await f.close(); }
});

test('real MFA request keeps challenge/code/next payload and remembered login choice while timing out safely', { skip, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => window.mode = 'mfa'); await fillLogin(f.page); await f.page.getByRole('checkbox', { name: 'Remember me' }).check();
    await f.page.locator('button[type=submit]').click(); await f.page.locator('input[name=code]').waitFor();
    await f.page.locator('input[name=code]').fill('123456'); await f.page.locator('button[type=submit]').click(); await f.page.getByRole('alert').waitFor();
    assert.equal(await f.page.locator('button[type=submit]').isEnabled(), true);
    assert.deepEqual(await f.page.evaluate(() => window.requests.map(r => ({ path: r.path, method: r.method, accept: r.accept, body: r.body, aborted: r.signal.aborted }))), [
      { path: '/api/auth/login', method: 'POST', accept: 'application/json', body: { next: '/fixture-next', email: 'fixture@example.invalid', password: 'fixture-only', remember_me: 'on' }, aborted: false },
      { path: '/api/auth/mfa/verify', method: 'POST', accept: 'application/json', body: { code: '123456', factor_id: 'fixture-factor', challenge_id: 'fixture-challenge', next: '/fixture-next' }, aborted: true },
    ]);
    assert.deepEqual(await f.page.evaluate(() => window.routes), []);
  } finally { await f.close(); }
});

test('real LoginForm bounds a stalled response stream without replaying the submitted login', { skip, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => window.mode = 'body'); await fillLogin(f.page); await f.page.locator('button[type=submit]').click(); await f.page.getByRole('alert').waitFor();
    assert.equal(await f.page.locator('button[type=submit]').isEnabled(), true);
    assert.deepEqual(await f.page.evaluate(() => ({ calls: window.requests.length, aborted: window.requests[0].signal.aborted, cancelled: window.bodyCancelled, routes: window.routes })), { calls: 1, aborted: true, cancelled: 1, routes: [] });
  } finally { await f.close(); }
});

test('unmount aborts the old LoginForm and its late completion cannot affect a fresh mounted form', { skip, timeout: 15000 }, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => window.testDeadline = 5000); await fillLogin(f.page); await f.page.locator('button[type=submit]').click(); await f.page.waitForFunction(() => window.requests.length === 1);
    await f.page.evaluate(() => window.unmount()); await f.page.locator('input[name=email]').waitFor({ state: 'detached' });
    assert.equal(await f.page.evaluate(() => window.requests[0].signal.aborted), true);
    await f.page.evaluate(() => window.mount()); await f.page.locator('input[name=email]').waitFor();
    await f.page.evaluate(() => window.requests[0].finish({ redirectTo: '/obsolete' })); await settle(f.page);
    assert.equal(await f.page.getByRole('alert').count(), 0); assert.equal(await f.page.locator('button[type=submit]').isEnabled(), true);
    assert.deepEqual(await f.page.evaluate(() => window.routes), []);
  } finally { await f.close(); }
});
