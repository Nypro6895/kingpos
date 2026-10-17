import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let script;
async function fixture(start = '/market', retained = false) {
  script ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';import{MarketClient}from'./app/market/market-client';import{AppLocalHelp}from'./components/app-local-help';import{AppLocalNavigationProvider,AppLocalLink}from'./app/local-app/navigation';import{marketBrowseFromQuery}from'./app/market/market-browse';import{clearExperienceState}from'./lib/experience-state';
function App(){const[current,setCurrent]=useState(location.pathname+location.search),[scope,setScope]=useState(window.start.public?undefined:'scope-a'),[lastMarket,setLastMarket]=useState(current.startsWith('/market')?current:'/market');window.changeScope=setScope;function navigate(href,replace=false){(replace?history.replaceState:history.pushState).call(history,{},'',href);setCurrent(href);if(href.startsWith('/market'))setLastMarket(href)}window.navigate=navigate;window.onpopstate=()=>{const href=location.pathname+location.search;setCurrent(href);if(href.startsWith('/market'))setLastMarket(href)};const url=new URL(lastMarket,location.origin),query=Object.fromEntries(url.searchParams),market=<MarketClient experienceScope={scope} paymentsAvailable={false} initialBrowse={marketBrowseFromQuery(query)}/>;return <AppLocalNavigationProvider value={{path:current,navigate,refresh(){}}}><nav aria-label='Fixture menu'><AppLocalLink href='/market'>Open Market</AppLocalLink><AppLocalLink href='/help?lang=en'>Open Help</AppLocalLink><AppLocalLink href='/more'>Open More</AppLocalLink></nav>{window.start.retained?<Activity mode={current.startsWith('/market')?'visible':'hidden'}>{market}</Activity>:current.startsWith('/market')?market:null}{current.startsWith('/help')?<AppLocalHelp language='en' experienceScope={scope} slug={new URL(current,location.origin).pathname.split('/')[2]} navigate={navigate}/>:null}{current.startsWith('/more')?<main>More destination</main>:null}</AppLocalNavigationProvider>};for(const event of ['reylumi:app-local-reset','reylumi:app-local-access-changed','reylumi:experience-access-changed','reylumi:offline-clear'])window.addEventListener(event,()=>clearExperienceState());createRoot(document.getElementById('app')).render(<App/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '""', 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '""' }, plugins: [{ name: 'original-browse-controls-no-business-actions', setup(b) {
    const fixtures = {
      'next/navigation': `export*from'./app/local-app/navigation'`, 'next/link': `export{AppLocalLink as default,useLinkStatus}from'./app/local-app/navigation'`, 'next/image': `export{AppLocalImage as default}from'./app/local-app/navigation'`,
      '@/components/workspace-language': 'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;',
    };
    const optional = ['./booksms-panel', './tax-company-panel', './booking-deposit-panel', './booking-policy-panel', './card-checkout-panel', './campaign-preview', './vietnamese-preview', './tax-company-preview', './vietnamese-plugin-panel', '../(legal)/contact-support/contact-form'];
    const optionalExports = ['BookSmsPanel', 'TaxCompanyMarketPanel', 'BookingDepositPanel', 'BookingPolicyPanel', 'CardCheckoutPanel', 'CampaignPreview', 'VietnamesePreview', 'TaxCompanyPreview', 'VietnamesePluginPanel', 'ContactSupportForm'];
    optional.forEach((name, i) => { fixtures[name] = `export const ${optionalExports[i]}=()=>null;`; });
    b.onResolve({ filter: /.*/ }, a => { if (a.path in fixtures) return { path: a.path, namespace: 'fixture' }; if (a.path.endsWith('.css')) return { path: a.path, namespace: 'css' }; if (!a.path.startsWith('@/') && !a.path.startsWith('.')) return; const base = a.path.startsWith('@/') ? path.resolve(a.path.slice(2)) : path.resolve(path.dirname(a.importer), a.path), file = ['.ts', '.tsx'].map(x => base + x).find(existsSync); if (file && /^\s*["']use server["']/.test(readFileSync(file, 'utf8'))) return { path: file, namespace: 'action' }; });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: fixtures[a.path], loader: 'tsx', resolveDir: process.cwd() }));
    b.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default new Proxy({},{get:(_,key)=>key});' }));
    b.onLoad({ filter: /.*/, namespace: 'action' }, a => ({ contents: [...readFileSync(a.path, 'utf8').matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(([, name]) => `export async function ${name}(){throw Error('No business action allowed')}`).join('\n') }));
  } }] });
  const built = await script, requests = [];
  const server = createServer((req, res) => { requests.push(req.url); res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/fixture.js' ? built.outputFiles[0].text : '<!doctype html><style>[hidden]{display:none!important}button,input{min-height:32px}</style><div id="app"></div><script>window.start=' + JSON.stringify({ retained, public: start.startsWith('/help') }) + '</script><script src="/fixture.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] }), page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().resourceType() === 'document' || new URL(route.request().url()).pathname === '/fixture.js' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port + start);
  return { page, requests, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}

test('actual Market and Help controls retain searches on forward menu return and Back after true page unmount', { skip: !existsSync(browserPath), timeout: 30000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    await page.getByRole('textbox', { name: 'Search features', exact: true }).fill('Payroll');
    await page.getByRole('button', { name: 'Payroll', exact: true }).click();
    await page.getByRole('link', { name: 'Open Help', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search the guides', exact: true }).fill('payroll'); await page.getByRole('button', { name: 'Salon owners', exact: true }).click();
    await page.getByRole('link', { name: 'Open More', exact: true }).click(); await page.getByText('More destination', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Open Help', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#app-local-help-search')?.value === 'payroll');
    assert.equal(await page.getByRole('button', { name: 'Salon owners', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('link', { name: 'Open Market', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[aria-label="Search features"]')?.value === 'Payroll');
    assert.equal(await page.getByRole('button', { name: 'Payroll', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.goBack(); await page.waitForFunction(() => document.querySelector('#app-local-help-search')?.value === 'payroll');
    assert.equal(await page.getByRole('button', { name: 'Salon owners', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.goForward(); await page.waitForFunction(() => document.querySelector('input[aria-label="Search features"]')?.value === 'Payroll');
    assert.ok(!app.requests.some(url => url.startsWith('/api/')));
  } finally { await app.close(); }
});

test('retained Market honors explicit URL including empty query and isolates same-instance account changes/reset', { skip: !existsSync(browserPath), timeout: 30000 }, async () => {
  const app = await fixture('/market', true); const { page } = app;
  try {
    const search = page.getByRole('textbox', { name: 'Search features', exact: true }); await search.fill('Payroll'); await search.evaluate(node => window.originalMarketSearch = node);
    await page.getByRole('link', { name: 'Open More', exact: true }).click(); await page.getByRole('link', { name: 'Open Market', exact: true }).click();
    assert.equal(await search.evaluate(node => node === window.originalMarketSearch), true); assert.equal(await search.inputValue(), 'Payroll');
    await page.evaluate(() => window.navigate('/market?q=Hair')); await page.waitForFunction(() => document.querySelector('input[aria-label="Search features"]')?.value === 'Hair');
    await page.evaluate(() => window.navigate('/market?q=')); await page.waitForFunction(() => document.querySelector('input[aria-label="Search features"]')?.value === '');
    await page.evaluate(() => window.navigate('/market')); await search.fill('scope-a-only'); await page.evaluate(() => window.changeScope('scope-b')); await page.waitForFunction(() => document.querySelector('input[aria-label="Search features"]')?.value === '');
    await search.fill('scope-b-only'); await page.evaluate(() => window.dispatchEvent(new Event('reylumi:app-local-reset'))); await page.waitForFunction(() => document.querySelector('input[aria-label="Search features"]')?.value === '');
    await page.evaluate(() => window.changeScope('scope-a')); await page.getByRole('link', { name: 'Open More', exact: true }).click(); await page.getByRole('link', { name: 'Open Market', exact: true }).click(); assert.equal(await search.inputValue(), '');
  } finally { await app.close(); }
});

test('cold Help remains zero API, bounds search, and separates public generation and verified-account UI state', { skip: !existsSync(browserPath), timeout: 30000 }, async () => {
  const app = await fixture('/help?lang=en'); const { page } = app;
  try {
    const search = page.getByRole('searchbox', { name: 'Search the guides', exact: true }); await search.fill('public only');
    await page.evaluate(() => window.changeScope('scope-a')); await page.waitForFunction(() => document.querySelector('#app-local-help-search')?.value === '');
    await search.fill('payroll'); await page.getByRole('button', { name: 'Salon owners', exact: true }).click(); await page.evaluate(() => window.changeScope('scope-b')); await page.waitForFunction(() => document.querySelector('#app-local-help-search')?.value === '');
    assert.equal(await page.getByRole('button', { name: 'All roles', exact: true }).getAttribute('aria-pressed'), 'true');
    await search.fill('x'.repeat(500)); assert.equal((await search.inputValue()).length, 200);
    await page.evaluate(() => window.dispatchEvent(new Event('reylumi:app-local-reset'))); await page.waitForFunction(() => document.querySelector('#app-local-help-search')?.value === '');
    await page.getByRole('link', { name: 'Open More', exact: true }).click(); await page.getByRole('link', { name: 'Open Help', exact: true }).click(); assert.equal(await search.inputValue(), '');
    assert.ok(!app.requests.some(url => url.startsWith('/api/')));
  } finally { await app.close(); }
});

test('native reset followed by immediate unmount cannot write an outgoing search back after storage was cleared', { skip: !existsSync(browserPath), timeout: 30000 }, async () => {
  for (const event of ['reylumi:app-local-reset', 'reylumi:app-local-access-changed', 'reylumi:experience-access-changed', 'reylumi:offline-clear']) {
   const app = await fixture('/help?lang=en'); const { page } = app;
   try {
    const search = page.getByRole('searchbox', { name: 'Search the guides', exact: true }); await search.fill('outgoing-private-query');
    await page.evaluate(event => { window.dispatchEvent(new Event(event)); window.navigate('/more'); }, event);
    await page.getByText('More destination', { exact: true }).waitFor();
    const saved = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('reylumi:experience:v1:')).map(key => sessionStorage.getItem(key)));
    assert.ok(saved.every(value => !value.includes('outgoing-private-query')));
    await page.getByRole('link', { name: 'Open Help', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#app-local-help-search'));
    assert.equal(await search.inputValue(), '');
   } finally { await app.close(); }
  }
});
