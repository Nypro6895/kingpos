import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const h = React.createElement;
let pathname = '/payroll';
let session = true;
const nothing = () => null;
const domProps = (props, omitted) => Object.fromEntries(Object.entries(props).filter(([key]) => !omitted.includes(key)));
const stubs = {
  'next/navigation': { usePathname: () => pathname, useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
  'next/link': props => h('a', domProps(props, ['prefetch', 'onNavigate'])),
  'next/image': props => h('img', domProps(props, ['priority'])),
  '@/components/workspace-language': { WorkspaceText: ({ text }) => text, useWorkspaceTranslation: () => value => value },
  '@/components/campaign-plugin-context': { useCampaignPlugin: () => false },
  '@/components/settings-icon': { SettingsIconShape: nothing },
  '@/app/account/logout-button': { LogoutButton: nothing },
  '@/components/explore-advertising': { ExploreAdSlot: nothing },
  '@/app/action-dialog': { ActionDialog: nothing },
  '@/app/notifications/notification-list': { NotificationFeedList: nothing },
  '@/app/quick-workspace-panel': { QuickWorkspacePanel: nothing },
  '@/lib/account-avatar': { safeAccountAvatarUrl: () => null },
  '@/lib/supabase/browser': { createSupabaseBrowserClient: () => null },
  '@/app/salons/actions': { setCurrentWorkspace: nothing, switchWorkspaceDestination: nothing, switchWorkspaceLanding: nothing },
  '@/lib/notification-client': { markAllCenterViewed: nothing, NOTIFICATIONS_REFRESH: 'notifications-refresh', useNotificationSummary: value => value },
  '@/components/legal-footer': { LegalFooter: nothing },
  '@/app/explore/explore-search-input': { ExploreSearchInput: props => h('input', domProps(props, ['onSuggestionSelect', 'category', 'location'])) },
  '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async () => { if (session instanceof Error) throw session; return session ? {} : null; } },
};
const cache = new Map();
function load(file) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);
  const module = { exports: {} };
  const code = transformSync(readFileSync(absolute, 'utf8'), { loader: absolute.endsWith('tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs' }).code;
  const localRequire = specifier => {
    if (specifier in stubs) return stubs[specifier];
    if (specifier.endsWith('.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    if (specifier.startsWith('@/')) {
      const target = specifier.slice(2);
      for (const extension of ['.tsx', '.ts']) {
        try { return load(target + extension); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      throw new Error(`Missing fixture dependency ${specifier}`);
    }
    return require(specifier);
  };
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  cache.set(absolute, module.exports);
  return module.exports;
}

const { LegalNavigationShell } = load('app/legal/legal-navigation-shell.tsx');
const { NavigationShell } = load('app/navigation-shell.tsx');
const { GuestNavigationShell } = load('app/guest-navigation-shell.tsx');

test('legal headers use the server session and never flash guest actions while unknown', async () => {
  for (const route of ['/community', '/help', '/help/owner-tips']) {
  pathname = route;
  for (const value of [true, false, new Error('offline')]) {
    session = value;
    const html = renderToStaticMarkup(await LegalNavigationShell({ children: h('main', {}, 'Community Standards') }));
    assert.ok(html.includes('Community Standards'));
    assert.equal(html.includes('href="/account"'), value === true);
    assert.equal(html.includes('>Login<'), value === false);
    assert.equal(html.includes('>Create account<'), value === false);
    if (value === false) assert.ok(html.includes('/login?next=' + encodeURIComponent(route)));
  }
  }
  const pending = renderToStaticMarkup(h(GuestNavigationShell, { authenticated: null }, 'Policy content'));
  assert.ok(pending.includes('Policy content'));
  assert.ok(!pending.includes('>Login<') && !pending.includes('>Create account<'));
});

test('phone rotation keeps payout in document flow and navigation/popovers within the viewport', {
  skip: !process.env.TEST_BROWSER_PATH,
  timeout: 60000,
}, async () => {
  pathname = '/payroll';
  const workspace = { id: 'salon:fixture', type: 'salon', salonMode: 'manage', salonId: 'fixture', salonName: 'QA Salon', label: 'QA Salon', roleLabel: 'Owner', menuActions: [] };
  const footer = h('footer', { className: 'output', id: 'payout' },
    h('div', { className: 'mb-2 flex items-center justify-between' }, h('span', {}, 'Total staff payout'), h('strong', {}, '$83.48')),
    h('fieldset', {}, h('div', {}, h('form', {}, h('button', { type: 'button' }, 'Save Statement')), h('form', {}, h('button', { type: 'button' }, 'Mark Paid')))));
  const main = h('main', { className: 'page mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8' },
    h('h1', {}, 'Payroll'), ...Array.from({ length: 16 }, (_, i) => h('section', { key: i, className: 'panel', style: { minHeight: 90 } }, `Payroll detail ${i + 1}`)), footer);
  const html = renderToStaticMarkup(h(NavigationShell, {
    accountAvatarUrl: null, accountEmail: 'test@example.test', accountLabel: 'QA Owner', currentAccountName: 'QA Owner', currentUserId: 'fixture',
    currentWorkspace: workspace, workspaceType: 'salon', salonMode: 'manage', workspaceOptions: [workspace], workspaceSections: [],
    notificationSummary: { items: [], total: 1, bookingNotifications: 0, previewItems: [], reviewHref: '/notifications' },
  }, main));
  const globalSource = readFileSync('app/globals.css', 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./navigation-shell.tsx";\n@source "./guest-navigation-shell.tsx";\n@source "../tests/mobile-landscape-legal-runtime.test.mjs";');
  const { css } = await postcss([tailwind()]).process(globalSource, { from: path.resolve('app/globals.css') });
  const document = body => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${readFileSync('app/payroll/payroll-mobile.module.css', 'utf8')}</style></head><body>${body}</body></html>`;
  const fixture = document(html);
  pathname = '/community';
  const legalFixtures = Object.fromEntries([true, false].map(authenticated => [String(authenticated), document(renderToStaticMarkup(h(GuestNavigationShell, { authenticated }, h('main', { className: 'p-4' }, h('h1', {}, 'Community Standards')))))]));
  const server = createServer((req, res) => {
    if (req.url === '/brand/reylumi-logo-horizontal.png') {
      res.setHeader('Content-Type', 'image/png');
      res.end(readFileSync('public/brand/reylumi-logo-horizontal.png'));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(req.url.startsWith('/legal/') ? legalFixtures[req.url.split('/').at(-1)] : fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const evidence = [];
    for (const [width, height] of [[320,568], [390,844], [430,932], [667,375], [844,390], [932,430], [390,844], [1024,768], [1280,800]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { document.querySelectorAll('details').forEach(el => { el.open = false; }); scrollTo(0, 0); });
      const start = await page.locator('#payout').boundingBox();
      assert.ok(start.y >= height, 'Payout does not float above unfinished content');
      await page.evaluate(() => scrollTo(0, 200));
      const after = await page.locator('#payout').boundingBox();
      assert.equal(Math.round(start.y - after.y), 200, 'Payout scrolls with the document');
      assert.equal(await page.locator('#payout').evaluate(el => getComputedStyle(el).position), 'static');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}x${height}`);
      const nav = page.locator('.workspace-mobile-nav');
      const mobile = width < 1280;
      assert.equal(await nav.isVisible(), mobile);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const payout = await page.locator('#payout').boundingBox();
      if (mobile) {
        const navBox = await nav.boundingBox();
        assert.ok(payout.y + payout.height <= navBox.y + 1, 'Last payout actions clear the fixed navigation');
        const landscapePhone = width > height && height <= 500 && width < 1024;
        if (landscapePhone) assert.ok(navBox.height <= 54, 'Landscape bar recovers vertical space');
        const targets = await nav.locator(':scope > a, :scope > details > summary').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
        assert.ok(targets.every(size => size >= 44), 'All navigation targets remain touch sized');
        for (const label of ['More', 'Notifications']) {
          await nav.locator('summary').filter({ hasText: label }).click();
          const panel = nav.locator('details[open] > .workspace-mobile-panel');
          const box = await panel.boundingBox();
          assert.ok(box && box.y >= 0 && box.y + box.height <= navBox.y, `${label} fits ${width}x${height}`);
          await nav.locator('summary').filter({ hasText: label }).click();
        }
        evidence.push({ width, height, navHeight: navBox.height, payoutBottom: payout.y + payout.height, navTop: navBox.y });
      }
      if (width === 844) {
        mkdirSync('artifacts/mobile-landscape-legal-qa', { recursive: true });
        await page.screenshot({ path: 'artifacts/mobile-landscape-legal-qa/payroll-landscape.png' });
      }
    }
    writeFileSync('artifacts/mobile-landscape-legal-qa/measurements.json', JSON.stringify(evidence, null, 2));
    for (const authenticated of [true, false]) {
      await page.goto(`http://127.0.0.1:${server.address().port}/legal/${authenticated}`);
      for (const [width, height] of [[320,568], [390,844], [667,375], [844,390], [1280,800]]) {
        await page.setViewportSize({ width, height });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Legal header fits ${width}x${height}`);
        assert.equal(await page.getByRole('link', { name: 'My account', exact: true }).count(), authenticated ? 1 : 0);
        assert.equal(await page.getByRole('link', { name: 'Login', exact: true }).count(), authenticated ? 0 : 1);
        for (const box of await page.locator('header a').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right }; }))) {
          assert.ok(box.x >= 0 && box.right <= width, 'Header links stay visible');
        }
        if (authenticated && width === 390) await page.screenshot({ path: 'artifacts/mobile-landscape-legal-qa/legal-authenticated.png' });
      }
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
