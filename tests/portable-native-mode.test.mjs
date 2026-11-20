import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
  import{PortableNativeModeSettings}from'./app/pos/portable/portable-native-mode-settings';
  function App(){useEffect(()=>{
    const flush=event=>{const state=window.modeFixture;state.trace.push({kind:'flush',saved:state.flushSaved,busy:state.ticketBusy});event.detail.saved=state.flushSaved;event.detail.busy=state.ticketBusy};
    window.addEventListener('kingpos:desktop-flush',flush);return()=>window.removeEventListener('kingpos:desktop-flush',flush);
  },[]);return <main><label>Open ticket<input defaultValue=""/></label><PortableNativeModeSettings/></main>}
  createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', plugins: [{ name: 'portable-native-mode-fixture', setup(builder) {
  builder.onResolve({ filter: /workspace-language$|app-local-host$/ }, ({ path }) => ({ path, namespace: 'portable-mode-fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'portable-mode-fixture' }, ({ path }) => ({ contents: path.endsWith('workspace-language')
    ? 'export const WorkspaceText=({text})=>text;'
    : `export const getAppLocalHost=()=>({isNative:true,async openOnline(path){window.modeFixture.trace.push({kind:'openOnline',path});if(window.modeFixture.failNavigation)throw Error('Synthetic host navigation failure')}});` }));
} }] });

async function withModeUI(work, options = {}) {
  const script = built.outputFiles[0].text;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? script : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, timezoneId: 'America/Chicago' });
    await context.addInitScript(({ mode }) => {
      const savedMode = localStorage.getItem('fixture-native-launch-mode') || mode;
      window.modeFixture = { mode: savedMode, trace: [], flushSaved: true, ticketBusy: false, holdMode: false, failMode: false, failNavigation: false, modeReplies: [],
        readiness: { ok: true, prepared: true, storage: 'native', offlineReady: false, pending: 0, expiresAt: new Date(Date.now() + 3600000).toISOString() },
        release() { this.modeReplies.shift()?.(); },
      };
      const fixture = window.modeFixture;
      window.__reylumiPortableDevice = { version: 1, platform: 'ios', storage: {
        get() { throw Error('This settings fixture forbids ticket storage access'); },
        set() { throw Error('This settings fixture forbids ticket storage access'); },
        remove() { throw Error('This settings fixture forbids ticket storage access'); },
      }, async request(input) {
        fixture.trace.push({ kind: 'native', ...structuredClone(input) });
        if (input.action === 'mode.get') return { mode: fixture.mode };
        if (input.action === 'offline.status') return structuredClone(fixture.readiness);
        if (input.action === 'mode.set') {
          if (fixture.failMode) throw Error('Synthetic preference persistence failure');
          if (fixture.holdMode) await new Promise(resolve => fixture.modeReplies.push(resolve));
          fixture.mode = input.mode;
          localStorage.setItem('fixture-native-launch-mode', input.mode);
          return { mode: input.mode };
        }
        throw Error('The settings fixture forbids business actions');
      } };
    }, { mode: options.mode || 'personal' });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/pos/portable`);
    await page.getByRole('region', { name: 'iPad POS' }).waitFor();
    await work(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [], 'settings QA never calls a business API');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

const toggle = page => page.getByRole('region', { name: 'iPad POS' }).getByRole('button', { name: /^Turn (on|off)$/ });

test('launch-mode toggle persists and never navigates, flushes, or discards the current ticket', { timeout: 30000 }, async () => {
  await withModeUI(async page => {
    const currentURL = page.url();
    await page.getByLabel('Open ticket').fill('Synthetic ticket 127.50');
    assert.equal(await toggle(page).getAttribute('aria-pressed'), 'false');
    await toggle(page).click();
    await page.getByRole('button', { name: 'Turn off', exact: true }).waitFor();
    assert.equal(await toggle(page).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByLabel('Open ticket').inputValue(), 'Synthetic ticket 127.50');
    assert.equal(page.url(), currentURL);
    let trace = await page.evaluate(() => window.modeFixture.trace);
    assert.deepEqual(trace.filter(item => item.action === 'mode.set').map(item => item.mode), ['portable']);
    assert.equal(trace.some(item => item.kind === 'flush' || item.kind === 'openOnline'), false);
    // The fake models native device preference across a fresh document. The
    // production Swift preference has its own isolated persistence XCTest.
    await page.reload();
    await page.getByRole('button', { name: 'Turn off', exact: true }).waitFor();
    assert.equal(await toggle(page).getAttribute('aria-pressed'), 'true');
    await page.getByLabel('Open ticket').fill('Another unsubmitted ticket');
    await toggle(page).click();
    await page.getByRole('button', { name: 'Turn on', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Open ticket').inputValue(), 'Another unsubmitted ticket');
    assert.equal(page.url(), currentURL);
    trace = await page.evaluate(() => window.modeFixture.trace);
    assert.equal(trace.some(item => item.kind === 'flush' || item.kind === 'openOnline'), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('fixture-native-launch-mode')), 'personal');
  });
});

test('explicit return refuses failed/busy ticket flush and only navigates after confirmed save then personal-mode persistence', { timeout: 30000 }, async () => {
  await withModeUI(async page => {
    const currentURL = page.url();
    await page.getByLabel('Open ticket').fill('Unsubmitted synthetic ticket');
    const returnButton = page.getByRole('button', { name: 'Return to Reylumi', exact: true });
    for (const failure of [{ saved: false, busy: false }, { saved: true, busy: true }]) {
      await page.evaluate(value => { window.modeFixture.flushSaved = value.saved; window.modeFixture.ticketBusy = value.busy; window.modeFixture.trace = []; }, failure);
      await returnButton.click();
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').textContent(), /Keep POS open until your ticket is saved/);
      assert.deepEqual(await page.evaluate(() => window.modeFixture.trace), [{ kind: 'flush', ...failure }]);
      assert.equal(await toggle(page).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.getByLabel('Open ticket').inputValue(), 'Unsubmitted synthetic ticket');
      assert.equal(page.url(), currentURL);
    }
    await page.evaluate(() => { window.modeFixture.flushSaved = true; window.modeFixture.ticketBusy = false; window.modeFixture.holdMode = true; window.modeFixture.trace = []; });
    await returnButton.click();
    await page.waitForFunction(() => window.modeFixture.modeReplies.length === 1);
    assert.equal(await returnButton.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.modeFixture.trace.some(item => item.kind === 'openOnline')), false, 'navigation must await the durable native preference result');
    await page.evaluate(() => window.modeFixture.release());
    await page.waitForFunction(() => window.modeFixture.trace.some(item => item.kind === 'openOnline'));
    assert.deepEqual(await page.evaluate(() => window.modeFixture.trace), [
      { kind: 'flush', saved: true, busy: false },
      { kind: 'native', action: 'mode.set', mode: 'personal' },
      { kind: 'openOnline', path: '/' },
    ]);
    assert.equal(await toggle(page).getAttribute('aria-pressed'), 'false');
    assert.equal(await page.getByLabel('Open ticket').inputValue(), 'Unsubmitted synthetic ticket');
  }, { mode: 'portable' });
});

test('offline readiness displays the reported deadline and pending count; preference persistence failure keeps ticket and mode', { timeout: 30000 }, async () => {
  await withModeUI(async page => {
    await page.getByText('Connect and keep POS open to finish preparing offline work.').waitFor();
    assert.equal(await page.getByText('Reconnect before', { exact: false }).count(), 0);
    const expiresAt = new Date(Date.now() + 7200000).toISOString();
    await page.evaluate(expiresAt => {
      window.modeFixture.readiness = { ok: true, prepared: true, storage: 'native', offlineReady: true, pending: 3, expiresAt };
      window.dispatchEvent(new Event('kingpos:native-readiness'));
    }, expiresAt);
    await page.locator('[data-portable-native-offline="ready"]').waitFor();
    const status = await page.getByRole('status').textContent();
    assert.match(status, /Ready for offline work on this device\./);
    assert.match(status, /Waiting to sync: 3/);
    const deadline = await page.evaluate(expiresAt => new Date(expiresAt).toLocaleString(), expiresAt);
    assert.ok((await page.getByText('Reconnect before', { exact: false }).textContent()).includes(deadline));
    await page.getByLabel('Open ticket').fill('Saved-on-device synthetic cart');
    await page.evaluate(() => { window.modeFixture.failMode = true; window.modeFixture.trace = []; });
    await toggle(page).click();
    await page.getByRole('alert').waitFor();
    assert.match(await page.getByRole('alert').textContent(), /Unable to save this device setting/);
    assert.equal(await toggle(page).getAttribute('aria-pressed'), 'false');
    assert.equal(await page.getByLabel('Open ticket').inputValue(), 'Saved-on-device synthetic cart');
    assert.equal(await page.evaluate(() => window.modeFixture.trace.some(item => item.kind === 'openOnline' || item.kind === 'flush')), false);
    await page.evaluate(() => { window.modeFixture.readiness.offlineReady = false; window.modeFixture.readiness.pending = 0; window.dispatchEvent(new Event('kingpos:native-readiness')); });
    await page.locator('[data-portable-native-offline="preparing"]').waitFor();
    assert.equal(await page.getByText('Reconnect before', { exact: false }).count(), 0);
    assert.doesNotMatch(await page.getByRole('status').textContent(), /Waiting to sync/);
  });
});
