import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';

const salonId = '10000000-0000-4000-8000-000000000000';
const bookingHref = `/book/${salonId}?source=explore`;
const contactHref = `/explore/salons/${salonId}`;
const screenshotDirectory = 'work/explore-book-love-report-20261015/qa';

test('nail inspiration uses one Book action in the card and viewer, with booking, contact and guest flows', { timeout: 120000 }, async () => {
  // Keep the real card, provider, booking dispatch, contact dialog and auth prompt.
  // Only framework routing/image boundaries and server actions are replaced.
  const fixture = `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {NailInspirationCard} from './app/explore/nail-inspiration';
    import {ExploreAccountActionsProvider} from './components/explore-account-actions';
    import {nailLookById} from './lib/nail-inspiration-catalog';
    const mode = new URLSearchParams(location.search).get('mode');
    const salon = {
      id: ${JSON.stringify(salonId)}, name: 'DJ Nails', city: 'Calumet City', state: 'IL',
      phone: mode === 'no-phone' ? null : '(708) 555-0100',
      bookingEnabled: mode === 'bookable' || mode === 'guest' || mode === 'missing-href',
      // A disabled salon may still have an old URL. It must open contact details.
      bookingHref: mode === 'missing-href' ? null : ${JSON.stringify(bookingHref)},
      logoImageUrl: null,
    };
    window.bookingEvents = [];
    window.actionCalls = [];
    window.addEventListener('reylumi:quick-book', event => window.bookingEvents.push(event.detail.href));
    const look = {...nailLookById('burgundy-jelly-oval'), imageUrl: '/nails.webp'};
    createRoot(document.getElementById('root')).render(
      <ExploreAccountActionsProvider authenticated={mode !== 'guest'}>
        <main style={{maxWidth: 600, margin: '0 auto', padding: 16}}>
          <NailInspirationCard look={look} salon={salon} initialSaved={false} location="Calumet City, IL" />
        </main>
      </ExploreAccountActionsProvider>
    );
  `;
  const mocks = {
    'next/navigation': "export const usePathname = () => '/explore';",
    'next/link': 'export default function Link({prefetch, children, ...props}) { return <a {...props}>{children}</a>; }',
    'next/image': 'export default function Image({fill, style, ...props}) { return <img {...props} style={fill ? {position:"absolute",width:"100%",height:"100%",inset:0,...style} : style} />; }',
    '@/app/explore/account-actions': `
      export async function salonLoveAction(...args) { window.actionCalls.push(['salon',...args]); return {active:false}; }
      export async function referenceLoveAction(key, active=false) { window.actionCalls.push(['reference',key,active]); return {active}; }
      export async function referenceLoveStatesAction() { return {keys:[]}; }
    `,
    '@/app/saved-post/actions': 'export async function setAccountSavedPostAction(...args) { window.actionCalls.push(["save",...args]); return {active:true}; }',
  };
  const bundle = await build({
    stdin: { contents: fixture, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true, write: false, outdir: 'fixture', jsx: 'automatic',
    plugins: [{ name: 'local-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  const sources = [
    './explore/nail-inspiration.tsx', '../components/explore-account-actions.tsx',
    '../components/content-viewer.tsx', '../components/auth-intent-prompt.tsx',
    '../components/nail-illustration-credit.tsx',
  ].map(path => `@source "${path}";`).join(' ');
  const { css } = await postcss([tailwind()]).process(
    readFileSync('app/globals.css', 'utf8').replace('@import "tailwindcss";', `@import "tailwindcss" source(none); ${sources}`),
    { from: 'app/globals.css' },
  );
  const moduleCss = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const nailImage = readFileSync('public/inspiration/nails/burgundy-jelly-oval.webp');
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  mkdirSync(screenshotDirectory, { recursive: true });
  const errors = [], unexpectedRequests = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://nail-card.test') {
        if (url.pathname === '/explore') return route.fulfill({ contentType: 'text/html', body: `<style>${css}\n${moduleCss}\nbody{margin:0;font-family:Arial;background:#faf9f6}</style><div id="root"></div><script src="/app.js"></script>` });
        if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: javascript });
        if (url.pathname === '/nails.webp') return route.fulfill({ contentType: 'image/webp', body: nailImage });
      }
      unexpectedRequests.push(route.request().url());
      return route.abort();
    });

    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const mode of ['bookable', 'contact', 'no-phone', 'missing-href', 'guest']) {
        await page.goto(`https://nail-card.test/explore?mode=${mode}`);
        const card = page.getByTestId('nail-inspiration-post');
        const cardBook = card.getByRole('button', { name: 'Book DJ Nails', exact: true });
        await cardBook.waitFor();
        await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
        assert.equal(await cardBook.count(), 1, `${width}/${mode}: one Book action on the card`);
        assert.equal(await card.getByText(/^(View salon|Call salon)$/).count(), 0);
        assert.equal(await card.getByRole('link', { name: /DJ Nails/ }).getAttribute('href'), contactHref);
        const bounds = await cardBook.boundingBox();
        assert.ok(bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}/${mode}: visible touch target`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}/${mode}: no horizontal overflow`);
        if (width === 390 && mode === 'bookable') await page.screenshot({ path: `${screenshotDirectory}/nail-book-card-390.png`, fullPage: true });

        // Exercise the same real action from the card and its image viewer.
        for (const surface of ['card', 'viewer']) {
          let target = cardBook;
          if (surface === 'viewer') {
            await card.getByRole('button', { name: 'View Burgundy jelly near DJ Nails', exact: true }).click();
            const viewer = page.getByRole('dialog', { name: 'Burgundy jelly', exact: true });
            await viewer.waitFor();
            assert.equal(await viewer.getByText(/^(View salon|Call salon)$/).count(), 0);
            target = viewer.getByRole('button', { name: 'Book DJ Nails', exact: true });
            assert.equal(await target.count(), 1);
            if (width === 390 && mode === 'bookable') await page.screenshot({ path: `${screenshotDirectory}/nail-book-viewer-390.png` });
          }
          await page.evaluate(() => { window.bookingEvents = []; });
          await target.click();
          if (mode === 'bookable') {
            assert.deepEqual(await page.evaluate(() => window.bookingEvents), [bookingHref], `${width}/${surface}: correct booking destination`);
            assert.equal(await page.getByRole('dialog', { name: 'Contact salon', exact: true }).count(), 0);
          } else if (mode === 'guest') {
            const prompt = page.getByRole('dialog', { name: 'Your next beauty moment ✨', exact: true });
            await prompt.waitFor();
            assert.deepEqual(await page.evaluate(() => window.bookingEvents), []);
            const intent = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reylumi-explore-account-intent')));
            assert.equal(intent.kind, 'book');
            assert.equal(intent.book.href, bookingHref);
            assert.equal(intent.book.contactHref, contactHref);
            assert.equal(await prompt.getByRole('link', { name: 'Login', exact: true }).getAttribute('href'), '/login?next=%2Fexplore%3Fmode%3Dguest');
            await prompt.getByRole('button', { name: 'Close', exact: true }).click();
            assert.equal(await page.evaluate(() => sessionStorage.getItem('reylumi-explore-account-intent')), null);
          } else {
            const contact = page.getByRole('dialog', { name: 'Contact salon', exact: true });
            await contact.waitFor();
            assert.deepEqual(await page.evaluate(() => window.bookingEvents), [], `${width}/${surface}: disabled booking does not dispatch an old URL`);
            assert.match(await contact.innerText(), /hasn’t enabled online booking/);
            assert.equal(await contact.getByRole('link', { name: 'View salon & contact details', exact: true }).getAttribute('href'), contactHref);
            const call = contact.getByRole('link', { name: 'Call salon', exact: true });
            if (mode === 'no-phone') assert.equal(await call.count(), 0, 'salon profile remains available without a phone');
            else assert.equal(await call.getAttribute('href'), 'tel:7085550100');
            if (width === 390 && mode === 'no-phone' && surface === 'card') await page.screenshot({ path: `${screenshotDirectory}/nail-book-contact-no-phone-390.png` });
            await contact.getByRole('button', { name: 'Close', exact: true }).click();
          }
          if (surface === 'viewer') {
            await page.getByRole('dialog', { name: 'Burgundy jelly', exact: true }).waitFor();
            await page.getByRole('button', { name: 'Close nail look', exact: true }).click();
          }
        }
        assert.deepEqual(await page.evaluate(() => window.actionCalls), [], 'booking does not accidentally trigger Love or saved-post actions');
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, [], 'all browser traffic stays within the local fixture');
  } finally {
    await browser.close();
  }
});
