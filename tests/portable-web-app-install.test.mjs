import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const ipadUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const desktopUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const browserPath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path));

async function loadModule(file) {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

test('main and Portable manifests keep distinct stable identities and cacheable manifest responses', async () => {
  const { webAppManifest } = await loadModule('lib/web-app-manifest.ts');
  const general = webAppManifest(), portable = webAppManifest(true);
  assert.equal(general.id, '/');
  assert.equal(general.start_url, '/');
  assert.equal(general.scope, '/');
  assert.equal(general.name, 'Reylumi');
  assert.equal(portable.id, '/pos/portable');
  assert.equal(portable.start_url, '/pos/portable');
  assert.equal(portable.scope, '/pos/portable');
  assert.equal(portable.name, 'Reylumi POS Portable');
  assert.equal(portable.short_name, 'Reylumi POS');
  assert.equal(portable.display, 'standalone');
  for (const app of [general, portable]) {
    for (const icon of app.icons) assert.ok(existsSync(resolve('public', '.' + icon.src)));
  }
  for (const [file, expected] of [['app/manifest.webmanifest/route.ts', general], ['app/pos/portable/manifest.webmanifest/route.ts', portable]]) {
    const { GET } = await loadModule(file);
    const response = GET();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/manifest\+json/);
    assert.match(response.headers.get('cache-control'), /public/);
    assert.deepEqual(await response.json(), expected);
  }
});

test('install availability distinguishes iPad desktop UA, iPhone, desktop, standalone and native hosts', async () => {
  const { portableInstallEnvironment: detect } = await loadModule('lib/portable-install-environment.ts');
  const base = { userAgent: desktopUserAgent, platform: 'Win32', maxTouchPoints: 0, standalone: false, native: false };
  assert.equal(detect(base), 'browser');
  assert.equal(detect({ ...base, userAgent: ipadUserAgent, platform: 'MacIntel', maxTouchPoints: 5 }), 'ios');
  assert.equal(detect({ ...base, userAgent: 'iPhone' }), 'ios');
  assert.equal(detect({ ...base, userAgent: ipadUserAgent, platform: 'MacIntel' }), 'browser');
  assert.equal(detect({ ...base, standalone: true }), 'hidden');
  assert.equal(detect({ ...base, native: true }), 'hidden');
  assert.equal(detect({ ...base, userAgent: ipadUserAgent + ' ReylumiIOS/1.0' }), 'hidden');
});

test('real install help opens and closes on iPad; desktop guidance, one-use prompts, and installed/native suppression', { timeout: 60000 }, async t => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';
      import {PortableInstallHelp} from './app/pos/portable/portable-install-help';
      function App(){useEffect(()=>{window.fixtureReady=true},[]);return <PortableInstallHelp compact={location.search.includes('compact')}/>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outdir: 'out', jsx: 'automatic', loader: { '.css': 'css' },
    plugins: [{ name: 'next-browser-fixture', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'next-navigation', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const usePathname=()=>'/pos/portable';export const useSearchParams=()=>new URLSearchParams();` }));
    } }],
  });
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : req.url === '/app.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/app.js' ? js : req.url === '/app.css' ? css : '<style>*{box-sizing:border-box}body{font-family:Arial;margin:20px}button{font-family:inherit;cursor:pointer;border:0;background:none}h2,p{margin:0}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    await t.test('iPad desktop Safari UA gets Home Screen steps and a centered accessible dialog in both orientations', async () => {
      const context = await browser.newContext({ userAgent: ipadUserAgent, viewport: { width: 1024, height: 768 } });
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', { value: 'MacIntel' });
        Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
      });
      const page = await context.newPage();
      const errors = [];page.on('pageerror', error => errors.push(error.message));
      await page.goto(url + '?compact');
      const trigger = page.getByRole('button', { name: 'Install Reylumi POS' });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Install Reylumi POS' });
      assert.match(await dialog.innerText(), /Safari/);
      assert.match(await dialog.innerText(), /Add to Home Screen/);
      assert.match(await dialog.innerText(), /existing Reylumi icon keeps its original destination/);
      assert.doesNotMatch(await dialog.innerText(), /Chrome or Edge/);
      for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        const box = await dialog.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height);
        assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 1);
        assert.ok(Math.abs(box.y + box.height / 2 - viewport.height / 2) < 1);
        if (process.env.PORTABLE_PWA_QA_DIR) {
          await mkdir(process.env.PORTABLE_PWA_QA_DIR, { recursive: true });
          await page.screenshot({ path: resolve(process.env.PORTABLE_PWA_QA_DIR, 'install-help-' + viewport.width + '.png') });
        }
      }
      await page.keyboard.press('Escape');assert.equal(await dialog.count(), 0);
      await trigger.click();await dialog.getByRole('button', { name: 'Close install help' }).click();assert.equal(await dialog.count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    });
    await t.test('desktop has browser instructions; dismissed or failed prompts cannot run twice', async () => {
      const context = await browser.newContext({ userAgent: desktopUserAgent });
      const page = await context.newPage();await page.goto(url);
      const trigger = page.getByRole('button', { name: 'Install Reylumi POS' });await trigger.click();
      const dialog = page.getByRole('dialog');
      assert.match(await dialog.innerText(), /Chrome or Edge/);assert.doesNotMatch(await dialog.innerText(), /Safari|Tap Share/);
      await page.evaluate(() => {
        window.promptCount = 0;
        const event = new Event('beforeinstallprompt');
        event.prompt = async () => { window.promptCount++; };
        event.userChoice = Promise.resolve({ outcome: 'dismissed' });
        dispatchEvent(event);
      });
      await dialog.getByRole('button', { name: 'Install POS app' }).click();
      assert.equal(await page.evaluate(() => window.promptCount), 1);
      assert.equal(await dialog.getByRole('button', { name: 'Install POS app' }).count(), 0);
      assert.match(await dialog.innerText(), /Chrome or Edge/);
      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt');
        event.prompt = async () => { throw Error('unavailable'); };
        event.userChoice = Promise.resolve({ outcome: 'dismissed' });
        dispatchEvent(event);
      });
      await dialog.getByRole('button', { name: 'Install POS app' }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Install POS app' }).count(), 0);
      await page.evaluate(() => dispatchEvent(new Event('appinstalled')));
      await trigger.waitFor({ state: 'detached' });
      assert.equal(await trigger.count(), 0);assert.equal(await dialog.count(), 0);
      await context.close();
    });
    await t.test('accepted browser prompt hides the install control', async () => {
      const context = await browser.newContext();const page = await context.newPage();await page.goto(url);
      const trigger = page.getByRole('button', { name: 'Install Reylumi POS' });await trigger.click();
      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt');
        event.prompt = async () => {};
        event.userChoice = Promise.resolve({ outcome: 'accepted' });
        dispatchEvent(event);
      });
      await page.getByRole('button', { name: 'Install POS app' }).click();
      assert.equal(await trigger.count(), 0);assert.equal(await page.getByRole('dialog').count(), 0);
      await context.close();
    });
    await t.test('iOS standalone, native Reylumi and Windows installed hosts have no redundant install control', async () => {
      for (const host of ['standalone', 'native', 'desktop']) {
        const context = await browser.newContext({ userAgent: ipadUserAgent + (host === 'native' ? ' ReylumiIOS/1.0' : '') });
        await context.addInitScript(host => {
          if (host === 'standalone') Object.defineProperty(navigator, 'standalone', { value: true });
          if (host === 'desktop') window.kingposDesktop = { version: 1 };
        }, host);
        const page = await context.newPage();await page.goto(url);
        await page.waitForFunction(() => window.fixtureReady);
        assert.equal(await page.getByRole('button', { name: 'Install Reylumi POS' }).count(), 0);
        await context.close();
      }
    });
  } finally { await browser.close();await new Promise(done => server.close(done)); }
});

test('actual Next server initial HTML has exactly one context manifest before client JavaScript', {
  skip: !process.env.PORTABLE_PWA_QA_URL,
  timeout: 120000,
}, async () => {
  const origin = process.env.PORTABLE_PWA_QA_URL;
  for (const [route, manifest, appleTitle] of [
    ['/pos/portable', '/pos/portable/manifest.webmanifest', 'Reylumi POS'],
    ['/pos/portable/ticket', '/pos/portable/manifest.webmanifest', 'Reylumi POS'],
    ['/explore', '/manifest.webmanifest', 'Reylumi'],
  ]) {
    const response = await fetch(new URL(route, origin), { headers: { 'User-Agent': ipadUserAgent } });
    assert.equal(response.status, 200, route);
    const html = await response.text(), head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
    const links = [...head.matchAll(/<link\b[^>]*rel="manifest"[^>]*>/gi)].map(match => match[0]);
    assert.equal(links.length, 1, route + ' must not inherit duplicate/general manifest');
    assert.match(links[0], new RegExp('href="' + manifest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'));
    assert.ok(head.includes('name="apple-mobile-web-app-title" content="' + appleTitle + '"'), route + ' Apple title is in the first HTML head');
  }
});
