import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright-core';

test('built Next app has an interactive first screen while its document stream remains incomplete', { timeout: 45000, skip: !process.env.TEST_APP_URL || !process.env.TEST_BROWSER_PATH }, async () => {
  const origin = new URL(process.env.TEST_APP_URL);
  let release;
  const tail = new Promise(resolve => { release = resolve; });
  const streams = new Set();
  const proxy = createServer((request, response) => {
    const headers = { ...request.headers, host: origin.host }; delete headers['accept-encoding'];
    const upstream = httpRequest(new URL(request.url, origin), { method: request.method, headers }, result => {
      const headers = { ...result.headers }; delete headers['content-length']; delete headers['transfer-encoding'];
      response.writeHead(result.statusCode, headers);
      result.on('data', chunk => { if (!response.destroyed) response.write(chunk); });
      result.on('end', async () => {
        if (request.url === '/market') await tail;
        if (!response.destroyed) response.end();
      });
    });
    streams.add(upstream); upstream.on('close', () => streams.delete(upstream));
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ['--no-proxy-server'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.fullLoad = false; window.firstReady = null; window.addEventListener('load', () => { window.fullLoad = true; }); window.addEventListener('reylumi:screen-ready', () => { window.firstReady ??= { at: performance.now(), loaded: window.fullLoad }; }); });
    await page.goto(`http://127.0.0.1:${proxy.address().port}/market`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.firstReady);
    assert.equal(await page.evaluate(() => window.fullLoad), false, 'the first usable UI cannot wait for the full response');
    const ready = await page.evaluate(() => window.firstReady);
    assert.equal(ready.loaded, false);
    const activeInput = page.locator('input:not([type=hidden])').first();
    await activeInput.fill('Payroll');
    assert.equal(await activeInput.inputValue(), 'Payroll');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    release();
    await page.waitForLoadState('load');
    assert.deepEqual(errors, []);
    mkdirSync('artifacts/startup-progressive', { recursive: true });
    writeFileSync('artifacts/startup-progressive/production-first-frame.json', JSON.stringify({ environment: 'desktop Chromium, 390px viewport, local production Next app, delayed document tail', readyBeforeDocumentCompleted: true, firstReadyMs: Math.round(ready.at), physicalPhone: false }, null, 2));
  } finally { release(); await browser.close(); for (const stream of streams) stream.destroy(); proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
});
