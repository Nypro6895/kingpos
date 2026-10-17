import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
let compiled;
async function fixture() {
  compiled ??= build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import*as offline from'./lib/experience-offline-client';import*as cache from'./lib/experience-persistent-cache';
Object.defineProperty(AbortSignal,'any',{configurable:true,value:undefined});Object.defineProperty(AbortSignal,'timeout',{configurable:true,value:undefined});
window.api={...offline,...cache};window.authorizedEvents=0;window.accessEvents=[];window.requests=[];
window.addEventListener('reylumi:experience-online-authorized',()=>window.authorizedEvents++);
window.addEventListener('reylumi:experience-access-changed',event=>window.accessEvents.push(event.detail));
const nativeFetch=window.fetch;window.fetch=(url,init)=>{window.requests.push({url:String(url),method:init?.method,cache:init?.cache,credentials:init?.credentials,signal:init?.signal instanceof AbortSignal});return nativeFetch(url,init)};
` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const bundle = (await compiled).outputFiles[0].text;
  const state = { status: 200, lifetime: 3600000, hold: false, bodyHold: false, held: [], waiters: [], hits: [] };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(bundle); }
    if (url.pathname === '/api/experience/offline-context') {
      state.hits.push(request.url);
      const now = Date.now();
      const payload = JSON.stringify({ version: 1, scope: 'scope-a', scopes: ['scope-a'], viewerId: 'viewer-a', workspaceId: 'salon-a', salonId: 'salon-a', grantRevision: 'revision-a', generation: url.searchParams.get('generation'), issuedAt: now, expiresAt: now + state.lifetime, path: url.searchParams.get('path'), kind: 'owner' });
      response.writeHead(state.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      if (state.bodyHold) response.write(payload.slice(0, 12));
      if (state.hold || state.bodyHold) { state.held.push({ response, remainder: state.bodyHold ? payload.slice(12) : payload }); for (const resolve of state.waiters.splice(0)) resolve(); return; }
      return response.end(payload);
    }
    response.setHeader('Content-Type', 'text/html'); response.end('<script id="reylumi-offline-boot" type="application/json">null</script><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/pos`); await page.waitForFunction(() => window.api);
  return { page, state, waitForHeld() { return state.held.length ? Promise.resolve() : new Promise(resolve => state.waiters.push(resolve)); }, release() { for (const item of state.held.splice(0)) if (!item.response.destroyed) item.response.end(item.remainder); }, async close() { for (const item of state.held) item.response.destroy(); await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}

test('Safari-compatible authorization renews and honors revocation without AbortSignal.any or timeout', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    assert.deepEqual(await page.evaluate(() => [typeof AbortSignal.any, typeof AbortSignal.timeout]), ['undefined', 'undefined']);
    const first = await page.evaluate(() => api.refreshExperienceOfflineAuthorization('/pos', 'scope-a', new AbortController().signal));
    assert.ok(first); assert.equal(await page.evaluate(() => api.isExperienceSnapshotAuthorized('scope-a')), true);
    app.state.lifetime = 7200000;
    const renewed = await page.evaluate(() => api.refreshExperienceOfflineAuthorization('/pos', 'scope-a', new AbortController().signal));
    assert.ok(renewed.expiresAt > first.expiresAt);
    assert.equal(await page.evaluate(() => api.getExperienceOfflineGrant('scope-a').expiresAt), renewed.expiresAt);
    assert.equal(await page.evaluate(() => authorizedEvents), 2);
    assert.deepEqual(await page.evaluate(() => requests.map(({ method, cache, credentials, signal }) => ({ method, cache, credentials, signal }))), Array.from({ length: 2 }, () => ({ method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: true })));
    app.state.status = 403;
    assert.equal(await page.evaluate(() => api.refreshExperienceOfflineAuthorization('/pos', 'scope-a', new AbortController().signal)), null);
    assert.equal(await page.evaluate(() => api.isExperienceSnapshotAuthorized('scope-a')), false);
    assert.deepEqual(await page.evaluate(() => accessEvents), [{ scope: 'scope-a', status: 403 }]);
    assert.equal(app.state.hits.length, 3);
  } finally { await app.close(); }
});

test('external cancellation rejects an in-flight or already-cancelled renewal without accepting a late grant', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    const first = await page.evaluate(() => api.refreshExperienceOfflineAuthorization('/pos', 'scope-a'));
    app.state.hold = true;
    await page.evaluate(() => { window.cancel = new AbortController(); window.renewal = api.refreshExperienceOfflineAuthorization('/pos', 'scope-a', cancel.signal); });
    await app.waitForHeld();
    await page.evaluate(() => cancel.abort());
    assert.equal(await page.evaluate(() => renewal), null);
    app.release();
    assert.equal(await page.evaluate(() => api.getExperienceOfflineGrant('scope-a').expiresAt), first.expiresAt);
    assert.equal(await page.evaluate(() => authorizedEvents), 1);
    const calls = await page.evaluate(() => requests.length);
    assert.equal(await page.evaluate(() => { const controller = new AbortController(); controller.abort(); return api.refreshExperienceOfflineAuthorization('/pos', 'scope-a', controller.signal); }), null);
    assert.equal(await page.evaluate(() => requests.length), calls, 'an already-aborted caller cannot send another read');
  } finally { await app.close(); }
});

test('the ten-second single-attempt deadline also aborts a stalled response body', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    const first = await page.evaluate(() => api.refreshExperienceOfflineAuthorization('/pos', 'scope-a'));
    app.state.bodyHold = true;
    await page.clock.install();
    await page.evaluate(() => { window.deadlineSettled = false; window.expiredRenewal = api.refreshExperienceOfflineAuthorization('/pos', 'scope-a', new AbortController().signal).then(value => { deadlineSettled = true; return value; }); });
    await app.waitForHeld();
    await page.clock.fastForward(9999);
    assert.equal(await page.evaluate(() => deadlineSettled), false, 'the existing full ten-second allowance is preserved');
    assert.equal(await page.evaluate(() => authorizedEvents), 1);
    await page.clock.fastForward(2);
    assert.equal(await page.evaluate(() => expiredRenewal), null);
    app.release(); await page.clock.fastForward(10001);
    assert.equal(app.state.hits.length, 2, 'the deadline cannot retry this authorization read');
    assert.equal(await page.evaluate(() => api.getExperienceOfflineGrant('scope-a').expiresAt), first.expiresAt);
    assert.equal(await page.evaluate(() => authorizedEvents), 1);
  } finally { await app.close(); }
});
