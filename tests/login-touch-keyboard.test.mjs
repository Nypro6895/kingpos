import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);
const { build } = require(process.env.ESBUILD_MODULE_PATH || 'esbuild');
const { chromium } = require('playwright-core');

test('Windows login keyboard enters credentials and MFA; browser login keeps native input', async () => {
  const result = await build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{LoginForm}from'./app/login/login-form';createRoot(document.getElementById('root')).render(<LoginForm/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, outdir: 'out', jsx: 'automatic', loader: { '.css': 'css' },
    plugins: [{ name: 'next-test', setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'next-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'next-test' }, args => ({ contents: args.path === 'next/link' ? `import React from 'react';export default function Link(p){return <a {...p}/>}` : `export const useRouter=()=>({push(){},refresh(){}});`, loader: 'jsx', resolveDir: process.cwd() }));
    } }],
  });
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : req.url === '/app.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/app.js' ? js : req.url === '/app.css' ? css : '<link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    for (const desktop of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if (desktop) await page.addInitScript(() => { window.kingposDesktop = { version: 3 }; });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const keyboard = page.getByRole('group', { name: 'Touch keyboard' });
      await page.getByLabel('Email', { exact: true }).click();
      if (!desktop) {
        assert.equal(await keyboard.count(), 0);
        await page.close();
        continue;
      }
      const key = name => keyboard.getByRole('button', { name, exact: true }).click();
      await key('a'); await key('123 / @'); await key('@'); await key('ABC');
      await key('b'); await key('123 / @'); await key('.'); await key('ABC');
      await key('c'); await key('o'); await key('m');
      assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'a@b.com');
      await page.getByLabel('Password', { exact: true }).click();
      await key('Shift'); await key('A'); await key('Shift'); await key('b');
      await key('123 / @'); await key('1'); await key('!'); await key('Backspace'); await key('^');
      assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), 'Ab1^');
      assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('type'), 'password');
      await key('Hide keyboard');
      assert.equal(await keyboard.count(), 0);
      await page.getByLabel('Password', { exact: true }).click();
      await keyboard.waitFor();
      await key('Done');
      await page.route('**/api/auth/login', async route => {
        const body = route.request().postData();
        assert.ok(body.includes('a@b.com')); assert.ok(body.includes('Ab1^'));
        await route.fulfill({ json: { mfa: { factorId: 'factor', challengeId: 'challenge', factorType: 'totp' } } });
      });
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await page.getByLabel('Security code').click();
      for (let index = 0; index < 9; index++) await key('1');
      assert.equal(await page.getByLabel('Security code').inputValue(), '11111111');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
