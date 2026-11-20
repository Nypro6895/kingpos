import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('Settings updates once, closes its top layer, shows progress, preserves input and supports retry on bridge v4', { timeout: 60000 }, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{DeviceInputSettingsButton}from'./app/pos/portable/device-settings-panel';
    createRoot(document.getElementById('root')).render(<React.StrictMode><main><DeviceInputSettingsButton/><label>Receipt note<input defaultValue="QA draft kept"/></label></main></React.StrictMode>);
  ` }, bundle: true, write: false, outdir: 'out', jsx: 'automatic', loader: { '.css': 'css' },
    plugins: [{ name: 'next-navigation-fixture', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `const search=new URLSearchParams();export const useSearchParams=()=>search;export const usePathname=()=>'/pos/portable';export const useRouter=()=>({refresh(){},push(){}});` }));
    } }],
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
  const server = createServer((request, response) => {
    const isJs = request.url === '/app.js', isCss = request.url === '/app.css';
    response.setHeader('Content-Type', isJs ? 'text/javascript' : isCss ? 'text/css' : 'text/html');
    response.end(isJs ? js : isCss ? css : '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{font:14px Arial;background:#f5f7f6}main{padding:28px}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1426, height: 953 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const values = new Map(); window.updateCalls = 0; window.menuCalls = 0; window.updateHadDialog = false;
      window.updateState = { phase: 'available', version: '0.7.6', currentVersion: '0.7.5', scheduledAt: null, message: '' };
      window.updateOperationBusy = true;
      window.addEventListener('kingpos:desktop-flush', event => { event.detail.saved = true; event.detail.operationBusy = window.updateOperationBusy; });
      window.kingposDesktop = { version: 4, storage: { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), remove: key => values.delete(key) },
        windowControls: { action: async () => { window.menuCalls++; }, fullscreen: async () => false, onFullscreen: () => () => {}, menu() {} },
        updates: { state: async () => window.updateState, now: async () => {
          window.updateCalls++;
          window.updateHadDialog ||= !!document.querySelector('dialog[open], [role="dialog"]');
          window.updateState = { ...window.updateState, phase: 'downloading', progress: 42, message: '' };
          return new Promise((resolve, reject) => { window.finishUpdate = value => { window.updateState = { ...window.updateState, ...value }; resolve(window.updateState); }; window.failUpdate = () => reject(Error('IPC unavailable')); });
        } },
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const open = () => page.getByRole('button', { name: 'Device settings', exact: true }).click();
    await open();
    await page.getByRole('button', { name: 'Update & restart', exact: true }).click();
    await page.getByText('Finish the current operation, then choose Retry update.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.updateCalls), 0, 'An in-flight sale must not reach the old host updater');
    await page.evaluate(() => { window.updateOperationBusy = false; });
    await page.getByRole('button', { name: 'Retry update', exact: true }).click();
    await page.getByRole('progressbar', { name: 'Download progress' }).waitFor();
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '42');
    assert.equal(await page.evaluate(() => window.updateCalls), 1, 'Strict Mode must not duplicate the install request');
    assert.equal(await page.evaluate(() => window.menuCalls), 0, 'Must bypass the old download-only menu flow');
    assert.equal(await page.evaluate(() => window.updateHadDialog), false, 'Settings must be closed before host readiness check');
    assert.equal(await page.getByLabel('Receipt note').inputValue(), 'QA draft kept');
    const evidence = resolve(process.env.UPDATE_QA_DIR || 'artifacts/windows-update-qa'); await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: resolve(evidence, 'download-progress.png') });
    await page.evaluate(() => window.finishUpdate({ phase: 'blocked', message: 'Saved tickets are still uploading. Keep KingPOS open, then choose Retry update.' }));
    await page.getByRole('button', { name: 'Retry update', exact: true }).waitFor();
    await page.screenshot({ path: resolve(evidence, 'blocked-retry.png') });
    await page.getByRole('button', { name: 'Retry update', exact: true }).click();
    await page.waitForFunction(() => window.updateCalls === 2);
    await page.evaluate(() => window.failUpdate());
    await page.getByText('Unable to update. Your current version has been kept. Please try again.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retry update', exact: true }).click();
    await page.waitForFunction(() => window.updateCalls === 3);
    await page.evaluate(() => window.finishUpdate({ phase: 'idle', version: '', message: 'KingPOS is up to date.' }));
    await page.getByRole('heading', { name: 'KingPOS is up to date', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close update status', exact: true }).click();
    await open(); await page.getByRole('button', { name: 'Check & update', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.getByRole('dialog', { name: 'Device settings', exact: true }).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.deepEqual(errors, []);
    await writeFile(resolve(evidence, 'ui-result.json'), JSON.stringify({ passed: true, nativeBridge: 4, singleClick: true, progress: true, retry: true, draftPreserved: true, strictMode: true, viewport: [1426, 390] }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
