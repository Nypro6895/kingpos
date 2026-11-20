import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('Beauty shortcuts preserve content priority; quick QR handles expiry, failure, account mismatch and closing', { timeout: 60000 }, async () => {
  const bundle = await build({ bundle: true, write: false, outdir: 'fixture', format: 'iife', jsx: 'automatic', stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {BeautyHome} from './app/beauty/beauty-home';
    import {ROLE_NAVIGATION,ROLE_MORE_ITEMS} from './app/role-navigation';
    window.fail=false; window.wrongUser=false; window.delay=0; window.calls=[];
    window.expiresIn=60000; window.compose=[];
    const profile={displayName:'Linh',initials:'L',avatarUrl:null,isSelf:true,id:'profile1'};
    createRoot(document.getElementById('root')).render(<><BeautyHome profile={profile} posts={[]} viewerId="user1" onCompose={photo=>window.compose.push(photo)} appointment={<a className="beauty-home-booking" href="/my-bookings/one"><div className="beauty-home-booking-copy"><p>Next appointment</p><h3>Oct 30, 2:00 PM</h3><p>Gel manicure</p><p>Lumi Nail Studio</p></div></a>} favorites={<p className="beauty-home-empty">Save a look you love to see it here.</p>}/><nav>{ROLE_NAVIGATION.personal.links.map(link=><a key={link.id} href={link.href}>{link.label}</a>)}</nav><aside hidden>{ROLE_MORE_ITEMS.personal.map(link=><a key={link.id} href={link.href}>{link.label}</a>)}</aside></>);
  ` }, plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^next\/(link|image)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onResolve({ filter: /workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
    b.onResolve({ filter: /app\/qr\/actions$/ }, () => ({ path: 'actions', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'tsx', resolveDir: process.cwd(), contents:
      a.path === 'next/link' ? 'export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}' :
      a.path === 'next/image' ? 'export default function Image(props){return <img {...props}/>}' :
      a.path === 'language' ? 'export const WorkspaceText=({text})=>text; export const useWorkspaceTranslation=()=>text=>text;' :
      `export async function loadPersonalQr(viewer){window.calls.push(viewer);await new Promise(r=>setTimeout(r,window.delay));if(window.fail)throw Error('offline');return {data:{userId:window.wrongUser?'other':viewer,code:'reylumi:personal:00000000-0000-4000-8000-000000000100',expiresAt:new Date(Date.now()+window.expiresIn).toISOString()}}}`
    }));
  } }] });
  const js = bundle.outputFiles.find(f => f.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:24px 16px 85px;font:15px Arial;background:#fcfaf8;--surface:#fff;--text-primary:#383735;--text-secondary:#72716f;--brand-orange:#f8793f;--brand-teal:#287f83;--brand-orange-soft:#fff0e8;--brand-teal-soft:#eaf6f3;--border-subtle:#eee9e5}button,a{-webkit-tap-highlight-color:transparent}button{font:inherit;border:0;background:none;cursor:pointer}a{color:inherit;text-decoration:none}nav{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-around;background:white;padding:20px;border-top:1px solid #eee}${css}</style><div id="root"></div><script>${js}</script></html>`); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const output = 'artifacts/beauty-shortcut-home'; mkdirSync(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('heading', { name: 'My Rewards' }).waitFor();
    const titles = await page.locator('[data-beauty-home] h2').filter({ visible: true }).allTextContents();
    assert.deepEqual(titles, ['My Rewards', 'My Bookings', 'My Favorites', 'My Beauty Library']);
    assert.equal(await page.locator('nav a[href="/qr"]').count(), 0);
    assert.equal(await page.locator('aside a[href="/qr"]').count(), 1);
    assert.equal(await page.locator('aside a[href="/beauty/library"]').count(), 0);
    assert.equal(await page.getByRole('link', { name: /My Beauty Library/ }).getAttribute('href'), '/beauty/library');
    await page.getByRole('button', { name: 'Write a Beauty post' }).click();
    await page.getByRole('button', { name: 'Post a Beauty photo' }).click();
    assert.deepEqual(await page.evaluate(() => window.compose), [false, true]);
    for (const width of [320, 375, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: output + '/beauty-home-390.png', fullPage: true });
    const trigger = page.getByRole('button', { name: 'My QR', exact: true });
    await trigger.click(); await page.getByRole('img', { name: 'Your Personal ID QR' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.calls), ['user1']);
    await page.screenshot({ path: output + '/quick-qr-390.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    await page.evaluate(() => { window.expiresIn = 600; });
    await trigger.click(); await page.getByRole('img', { name: 'Your Personal ID QR' }).waitFor();
    await page.getByRole('button', { name: 'Refresh QR', exact: true }).waitFor();
    assert.equal(await page.getByRole('img', { name: 'Your Personal ID QR' }).count(), 0);
    await page.getByRole('button', { name: 'Close My QR' }).click();
    await page.evaluate(() => { window.fail = true; });
    await trigger.click(); await page.getByText('Reconnect and try again.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close My QR' }).click();
    await page.evaluate(() => { window.fail = false; window.wrongUser = true; window.expiresIn = 60000; });
    await trigger.click(); await page.getByRole('button', { name: 'Refresh QR', exact: true }).waitFor();
    assert.equal(await page.getByRole('img', { name: 'Your Personal ID QR' }).count(), 0, 'Another account QR is never rendered');
    await page.getByRole('button', { name: 'Close My QR' }).click();
    await page.evaluate(() => { window.wrongUser = false; window.delay = 400; });
    await trigger.click(); await page.getByRole('button', { name: 'Close My QR' }).click();
    await page.waitForTimeout(500);
    assert.equal(await page.getByRole('dialog').count(), 0, 'Late response does not reopen a closed sheet');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
});

test('Library preserves existing profile UI and composer; appointment exists only on shortcut home', () => {
  const library = readFileSync('app/(app)/beauty/library/page.tsx', 'utf8');
  assert.match(library, /BeautyProfileClient/);
  assert.doesNotMatch(library, /BeautyAppointment|appointment=/);
  const client = readFileSync('app/beauty/beauty-profile-client.tsx', 'utf8');
  assert.match(client, /\["overview", "posts", "library"\]/);
  assert.match(client, /flushSync\(\(\) => openComposer\("regular"\)\)/);
  assert.match(client, /if \(photo\) normalFileInputRef.current\?\.click\(\)/);
});
