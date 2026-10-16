import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
let compiled;
async function bundle() {
  return compiled ??= build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{Activity,createContext,useState}from'react';import{createRoot}from'react-dom/client';
      import{SessionExpiryPrompt}from'./components/session-expiry-prompt';
      window.fixtureScope=createContext(null);window.resets=[];window.invalidations=[];window.authentications=0;
      window.signInAttempts=0;window.signInEvaluations=0;window.rejectNextSignIn=false;
      // Reject one transport attempt deterministically. Successful attempts still
      // execute the component's real split import and fetch a held ESM chunk.
      window.__importSignIn=load=>{window.signInAttempts++;if(window.rejectNextSignIn){window.rejectNextSignIn=false;return Promise.reject(Error('Fixture chunk unavailable'));}return load();};
      function Fixture(){const[scope,setScope]=useState('scope-one'),[visible,setVisible]=useState(true);
        window.hide=()=>setVisible(false);window.show=()=>setVisible(true);window.changeScope=()=>setScope('scope-two');
        return <><main><label>Unsent draft<input id='draft' defaultValue='keep this draft'/></label><p data-visible>{visible?'visible':'hidden'}</p><p data-scope>{scope}</p></main>
          <window.fixtureScope.Provider value={{context:{scope}}}><Activity mode={visible?'visible':'hidden'}><SessionExpiryPrompt authenticated={new URLSearchParams(location.search).get('guest')!=='1'}/></Activity></window.fixtureScope.Provider></>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` },
    bundle: true, write: false, splitting: true, format: 'esm', outdir: 'fixture-assets', jsx: 'automatic', platform: 'browser',
    entryNames: 'entry', chunkNames: '[name]-[hash]', alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'session-fixture-boundaries', setup(builder) {
      builder.onLoad({ filter: /[\\/]components[\\/]session-expiry-prompt\.tsx$/ }, args => ({
        loader: 'tsx', resolveDir: path.dirname(args.path),
        contents: readFileSync(args.path, 'utf8').replace('import("@/app/login/login-form")', 'window.__importSignIn(() => import("@/app/login/login-form"))'),
      }));
      builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)experience-scope$/ }, () => ({ path: 'scope', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)reset-experience-cache$/ }, () => ({ path: 'reset', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)experience-resource-cache$/ }, () => ({ path: 'resource', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)login-form$/ }, () => ({ path: 'login-form', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: process.cwd(), contents:
        args.path === 'language' ? 'export const WorkspaceText=({text})=>text;' :
        args.path === 'scope' ? 'import{useContext}from"react";export const useExperienceScope=()=>useContext(window.fixtureScope);' :
        args.path === 'reset' ? 'export const resetExperienceCaches=options=>window.resets.push(options);' :
        args.path === 'resource' ? 'export const invalidateExperienceResources=options=>window.invalidations.push(options);' :
        `window.signInEvaluations++;export function LoginForm({nextPath,onAuthenticated}){return <form aria-label='Sign in' onSubmit={event=>{event.preventDefault();window.authentications++;window.authNextPath=nextPath;onAuthenticated?.();}}><label>Email<input name='email'/></label><button type='submit'>Sign in</button></form>;}`,
      }));
    } }],
  });
}

async function fixture({ guest = false } = {}) {
  const output = await bundle();
  const assets = new Map(output.outputFiles.map(file => [path.basename(file.path), file.text]));
  const chunks = [], documents = [], sessionReads = [];
  const state = { authenticated: true, holdSession: false };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    if (url.pathname.startsWith('/assets/')) {
      const file = path.basename(url.pathname);
      response.setHeader('Content-Type', 'text/javascript');
      if (file.startsWith('login-form-')) chunks.push({ response, contents: assets.get(file), released: false });
      else response.end(assets.get(file));
    } else if (url.pathname === '/api/auth/session') {
      const row = { response, authenticated: state.authenticated };
      sessionReads.push(row);
      response.setHeader('Content-Type', 'application/json');
      if (!state.holdSession) response.end(JSON.stringify({ authenticated: state.authenticated }));
    } else if (url.pathname === '/fixture-protected') {
      response.statusCode = 401; response.end('{}');
    } else if (url.pathname === '/api/auth/logout') {
      response.setHeader('Content-Type', 'application/json'); response.end('{}');
    } else if (url.pathname === '/favicon.ico') {
      response.statusCode = 204; response.end();
    } else {
      documents.push(request.url);
      response.setHeader('Content-Type', 'text/html');
      response.end('<div id="root"></div><script type="module" src="/assets/entry.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(7000);
  const origin = `http://127.0.0.1:${server.address().port}`, errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/explore?return=kept' + (guest ? '&guest=1' : '') + '#draft');
  await page.locator('[data-scope]').waitFor();
  if (!guest) await page.waitForFunction(() => typeof window.fetch === 'function' && window.resets.length === 0);
  return { page, errors, chunks, documents, state, sessionReads,
    async expire() { state.authenticated = false; await page.evaluate(() => fetch('/fixture-protected')); await page.getByRole('dialog').waitFor(); },
    release() { for (const row of chunks) if (!row.released) { row.released = true; row.response.end(row.contents); } },
    async close() { for (const row of [...chunks, ...sessionReads]) row.response.destroy(); await browser.close(); await new Promise(resolve => server.close(resolve)); },
  };
}

async function waitForChunk(app) {
  await app.page.waitForFunction(() => window.signInAttempts > 0);
  const deadline = Date.now() + 7000;
  while (!app.chunks.length && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.chunks.length, 1, 'one real split sign-in module request');
}

test('anonymous browsing never imports sign-in or starts an authenticated session check', { skip, timeout: 60000 }, async () => {
  const app = await fixture({ guest: true });
  try {
    await app.page.evaluate(async () => { window.dispatchEvent(new Event('focus')); await fetch('/fixture-protected'); });
    assert.equal(app.chunks.length, 0);
    assert.equal(app.sessionReads.length, 0);
    assert.equal(await app.page.evaluate(() => window.signInAttempts), 0);
    assert.equal(await app.page.evaluate(() => window.signInEvaluations), 0);
    assert.equal(await app.page.getByRole('dialog').count(), 0);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('a valid session keeps the monitor active without importing the closed sign-in form', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await app.page.evaluate(() => fetch('/fixture-protected'));
    assert.ok(app.sessionReads.length >= 1);
    assert.equal(app.chunks.length, 0);
    assert.equal(await app.page.evaluate(() => window.signInAttempts), 0);
    assert.equal(await app.page.getByRole('dialog').count(), 0);
    assert.equal(await app.page.locator('#draft').inputValue(), 'keep this draft');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('expiry immediately blocks the retained draft while its real module is held, then preserves the login callback', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await app.expire();
    await waitForChunk(app);
    await app.page.getByRole('status').filter({ hasText: 'Opening sign-in…' }).waitFor();
    assert.equal(await app.page.locator('dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await app.page.evaluate(() => { document.querySelector('#draft').focus(); return document.activeElement?.id; }), '', 'native modal keeps the protected draft inert');
    assert.equal(await app.page.locator('#draft').inputValue(), 'keep this draft');
    assert.equal(await app.page.evaluate(() => window.signInEvaluations), 0);
    app.release();
    await app.page.getByRole('form', { name: 'Sign in' }).waitFor();
    await app.page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
    await app.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await app.page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.deepEqual(await app.page.evaluate(() => window.resets), [
      { reason: 'expired', suspend: true, broadcast: true },
      { reason: 'identity', suspend: true, broadcast: true, preserveBookingHandoff: true },
    ]);
    assert.equal(await app.page.evaluate(() => window.authentications), 1);
    assert.equal(await app.page.evaluate(() => window.authNextPath), '/explore?return=kept#draft');
    assert.equal(await app.page.locator('#draft').inputValue(), 'keep this draft');
    assert.equal(app.documents.length, 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('a failed module needs explicit retry and does not retry on focus or Activity reveal', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await app.page.evaluate(() => { window.rejectNextSignIn = true; });
    await app.expire();
    await app.page.getByRole('alert').filter({ hasText: 'Sign-in could not be opened.' }).waitFor();
    assert.equal(await app.page.evaluate(() => window.signInAttempts), 1);
    await app.page.evaluate(() => window.hide());
    await app.page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await app.page.evaluate(() => window.show());
    await app.page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await app.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await app.page.evaluate(() => window.signInAttempts), 1);
    assert.equal(app.chunks.length, 0);
    await app.page.getByRole('button', { name: 'Try again', exact: true }).click();
    await waitForChunk(app);
    assert.equal(await app.page.evaluate(() => window.signInAttempts), 2);
    app.release();
    await app.page.getByRole('form', { name: 'Sign in' }).waitFor();
    assert.equal(await app.page.evaluate(() => window.authentications), 0, 'chunk retry never submits login');
    assert.equal(app.documents.length, 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('Activity hide guards late import, reuses it on reveal, and preserves a loaded sign-in draft', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await app.expire(); await waitForChunk(app);
    await app.page.evaluate(() => window.hide());
    await app.page.waitForFunction(() => !document.querySelector('dialog[open]'));
    app.release();
    await app.page.waitForFunction(() => window.signInEvaluations === 1);
    assert.equal(await app.page.getByRole('form', { name: 'Sign in' }).count(), 0);
    assert.equal(await app.page.evaluate(() => document.body.style.overflow), '');
    await app.page.evaluate(() => window.show());
    await app.page.getByRole('form', { name: 'Sign in' }).waitFor();
    await app.page.getByLabel('Email', { exact: true }).fill('unsent@example.test');
    await app.page.evaluate(() => window.hide());
    await app.page.waitForFunction(() => !document.querySelector('dialog[open]'));
    await app.page.evaluate(() => window.show());
    await app.page.getByRole('form', { name: 'Sign in' }).waitFor();
    assert.equal(await app.page.getByLabel('Email', { exact: true }).inputValue(), 'unsent@example.test');
    assert.equal(app.chunks.length, 1);
    assert.equal(await app.page.evaluate(() => window.signInAttempts), 1);
    assert.equal(await app.page.evaluate(() => window.authentications), 0);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('logout while the chunk is pending cannot reveal the stale sign-in form or submit it', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await app.expire(); await waitForChunk(app);
    await app.page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
    await app.page.getByRole('dialog').waitFor({ state: 'detached' });
    app.release();
    await app.page.waitForFunction(() => window.signInEvaluations === 1);
    assert.equal(await app.page.getByRole('form', { name: 'Sign in' }).count(), 0);
    assert.equal(await app.page.evaluate(() => window.authentications), 0);
    assert.deepEqual(await app.page.evaluate(() => window.resets.map(item => item.reason)), ['expired', 'logout']);
    assert.equal(app.documents.length, 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('a newly validated scope ignores an old pending import without remounting the protected draft', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await app.expire(); await waitForChunk(app);
    app.state.authenticated = true;
    await app.page.evaluate(() => { window.originalDraft = document.querySelector('#draft'); window.changeScope(); });
    await app.page.locator('[data-scope]').filter({ hasText: 'scope-two' }).waitFor();
    await app.page.getByRole('dialog').waitFor({ state: 'detached' });
    app.release();
    await app.page.waitForFunction(() => window.signInEvaluations === 1);
    assert.equal(await app.page.getByRole('form', { name: 'Sign in' }).count(), 0);
    assert.equal(await app.page.evaluate(() => window.originalDraft === document.querySelector('#draft')), true);
    assert.equal(await app.page.locator('#draft').inputValue(), 'keep this draft');
    assert.equal(await app.page.evaluate(() => window.authentications), 0);
    assert.equal(app.chunks.length, 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
