import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const actionBuild = await build({
  entryPoints: ['app/(app)/admin/market/tax/actions.ts'], bundle: true, write: false, format: 'esm', platform: 'node', alias: { '@': process.cwd() },
  plugins: [{ name: 'tax-action-fixtures', setup(builder) {
    builder.onResolve({ filter: /^(server-only|next\/navigation|next\/cache|@\/lib\/platform-admin\/auth|@\/lib\/market-tax)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path === 'server-only' ? '' : args.path === 'next/navigation' ? `export function notFound(){throw Error('Not found')}` :
      args.path === 'next/cache' ? `export function revalidatePath(path){globalThis.taxRevalidated.push(path)}` :
      args.path.includes('/auth') ? `export async function requirePlatformAdmin(permission){globalThis.taxPermission=permission;return{roleSlug:globalThis.taxRole??'platform_owner'}}` :
      `function check(){if(globalThis.taxError)throw Error(globalThis.taxError)}export async function saveMarketTaxSettings(values){check();globalThis.taxCalls.push({name:'settings',values})}export async function saveMarketTaxProduct(values){check();globalThis.taxCalls.push({name:'product',values})}export async function syncMarketTaxProvider(){check();globalThis.taxCalls.push({name:'sync'});return{message:globalThis.taxCheckMessage??'Stripe Tax status refreshed. Review registrations and product readiness.'}}`,
    }));
  } }],
});
const actions = await import(`data:text/javascript;base64,${Buffer.from(actionBuild.outputFiles[0].text).toString('base64')}`);
function form(values) { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.set(key, String(value)); return result; }
function reset() { globalThis.taxCalls = []; globalThis.taxRevalidated = []; delete globalThis.taxRole; delete globalThis.taxError; delete globalThis.taxCheckMessage; }
const settings = () => form({ version: '3', price_behavior: 'exclusive', tax_code: '' });

test('all automatic-tax mutations require owner authorization before processing any input', async () => {
  for (const action of Object.values(actions)) {
    reset(); globalThis.taxRole = 'platform_admin';
    await assert.rejects(action(new FormData()), /Not found/);
    assert.equal(globalThis.taxPermission, 'admin.team.manage');
    assert.equal(globalThis.taxCalls.length, 0);
  }
});

test('disabled setup preserves explicit pricing choice and forwards only versioned canonical fields', async () => {
  reset(); const input = settings(); input.set('actor_id', 'spoofed'); input.set('secret_key', 'sk_live_do_not_forward');
  assert.equal((await actions.saveAutomaticTaxSettings(input)).ok, true);
  assert.deepEqual(globalThis.taxCalls, [{ name: 'settings', values: { version: 3, enabled: false, price_behavior: 'exclusive', default_tax_code: null } }]);
  assert.ok(globalThis.taxRevalidated.includes('/admin/market/tax'));
  reset(); input.set('enabled', 'on'); input.set('price_behavior', 'inclusive'); input.set('tax_code', 'txcd_10103001');
  const outcome = await actions.saveAutomaticTaxSettings(input);
  assert.equal(outcome.ok, true); assert.equal(globalThis.taxCalls[0].values.enabled, true);
  assert.equal(globalThis.taxCalls[0].values.price_behavior, 'inclusive');
  assert.equal(globalThis.taxCalls[0].values.default_tax_code, 'txcd_10103001');
});

test('invalid tax codes, collection flags, price choices and versions never reach a helper', async () => {
  for (const [key, value] of [['tax_code', 'txcd_invented'], ['tax_code', 'txcd_123456789'], ['version', '0'], ['version', '3.5'], ['version', '2147483648'], ['price_behavior', 'automatic'], ['enabled', 'true']]) {
    reset(); const input = settings(); input.set(key, value);
    assert.equal((await actions.saveAutomaticTaxSettings(input)).ok, false);
    assert.equal(globalThis.taxCalls.length, 0);
  }
  reset(); const input = settings(); input.set('tax_code', new Blob(['txcd_10103001']));
  assert.equal((await actions.saveAutomaticTaxSettings(input)).ok, false);
  assert.equal(globalThis.taxCalls.length, 0);
});

test('a per-plugin override can be cleared to inheritance without inventing a tax classification', async () => {
  reset(); const input = form({ plugin_id: 'booking-deposit', version: '2', tax_code: '' });
  assert.equal((await actions.saveAutomaticTaxProduct(input)).ok, true);
  assert.deepEqual(globalThis.taxCalls[0], { name: 'product', values: { plugin_id: 'booking-deposit', version: 2, tax_code: null } });
  reset(); input.set('version', ''); input.set('tax_code', 'txcd_10103001');
  assert.equal((await actions.saveAutomaticTaxProduct(input)).ok, true);
  assert.equal(globalThis.taxCalls[0].values.version, null);
  reset(); input.set('plugin_id', '../../settings');
  assert.equal((await actions.saveAutomaticTaxProduct(input)).ok, false);
  assert.equal(globalThis.taxCalls.length, 0);
});

test('connection checks invoke only the status helper and never promise registration or remittance', async () => {
  reset(); const result = await actions.checkAutomaticTaxConnection(new FormData());
  assert.equal(result.ok, true); assert.deepEqual(globalThis.taxCalls, [{ name: 'sync' }]);
  assert.match(result.message, /review.*registrations.*readiness/i);
  assert.doesNotMatch(result.message, /remitted|filed|registered automatically/i);
});

test('conflicts and provider errors stay useful without leaking credentials or raw provider details', async () => {
  reset(); globalThis.taxError = 'settings version conflict inside private_schema';
  const conflict = await actions.saveAutomaticTaxSettings(settings());
  assert.match(conflict.message, /another admin changed/i); assert.doesNotMatch(conflict.message, /private_schema/);
  reset(); globalThis.taxError = 'provider raw sk_live_private_key whsec_private_secret';
  const provider = await actions.checkAutomaticTaxConnection(new FormData());
  assert.equal(provider.ok, false); assert.doesNotMatch(provider.message, /sk_live|whsec|private_secret/);
  reset(); globalThis.taxError = 'No active tax registration';
  assert.match((await actions.saveAutomaticTaxSettings(settings())).message, /required tax registrations/i);
  reset(); globalThis.taxCheckMessage = 'raw sk_live_private_key whsec_private_secret';
  assert.doesNotMatch((await actions.checkAutomaticTaxConnection(new FormData())).message, /sk_live|whsec|private_secret/);
});

test('real desktop and mobile forms preserve tax-off readiness, classifications, month dates and export scope', { timeout: 120_000 }, async t => {
  const chrome = process.env.MARKET_QA_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  try { await access(chrome); } catch { t.skip('Set MARKET_QA_BROWSER to an installed Chromium executable for browser QA.'); return; }
  const [{ default: postcss }, { default: tailwind }, { chromium }] = await Promise.all([import('postcss'), import('@tailwindcss/postcss'), import('playwright-core')]);
  const directory = path.resolve('artifacts/market-tax-admin-qa'); await mkdir(directory, { recursive: true });
  const state = {
    settings: { enabled: false, price_behavior: 'exclusive', default_tax_code: null, version: 1 },
    products: [ { plugin_id: 'booking-deposit', name: 'Booking Deposit', version: null, tax_code: null }, { plugin_id: 'booking-policy', name: 'Booking Policy', version: 2, tax_code: 'txcd_10103001' } ],
    provider: { connected: false, account_id: null, mode: null, status: 'unavailable', head_office: null, registrations: [], checked_at: null, error: 'raw sk_live_private whsec_private_do_not_display' },
    readiness_local: false, filters: { from: '2026-10-01', to: '2026-10-31' }, row_count: 300, truncated: true,
    summary: { sale_tax_cents: 1000, refunded_tax_cents: 250, net_tax_cents: 750, invoice_count: 30, reconciliation_required_count: 1, by_jurisdiction: [{ country: 'US', state: 'WA', jurisdiction: 'Seattle', sale_tax_cents: 1000, refunded_tax_cents: 250, net_tax_cents: 750 }] },
    ledger: Array.from({length: 30}, (_, index) => ({ id: `entry-${index}`, invoice_id: `in_example${index}`, purchase_id: `purchase-${index}`, kind: index === 0 ? 'refund' : 'sale', country: 'US', state: 'WA', jurisdiction: 'Seattle', tax_cents: index === 0 ? -250 : 100, occurred_at: '2026-10-08T15:00:00Z', created_at: '2026-10-08T15:01:00Z' })),
  };
  const built = await build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MarketTaxWorkspace}from'./app/(app)/admin/market/tax/tax-workspace';const state=${JSON.stringify(state)};if(location.search.includes('ready')){state.provider={connected:true,account_id:'acct_example',mode:'live',status:'active',head_office:{country:'US',state:'WI',city:'Madison',postal_code:'53703',line1:'123 Example Avenue'},registrations:[{id:'taxreg_example',country:'US',state:'WA',status:'active',active_from:1780000000,expires_at:null}],checked_at:'2026-10-10T15:00:00Z',error:null};state.readiness_local=true;state.settings.default_tax_code='txcd_10103001'}if(location.search.includes('test'))state.provider.mode='test';window.__taxActions=[];createRoot(document.getElementById('root')).render(<main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8"><header className="mb-6"><h1 className="text-3xl font-semibold">Automatic tax</h1></header><MarketTaxWorkspace state={state}/></main>);`, resolveDir: process.cwd(), loader: 'tsx' },
    jsx: 'automatic', bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'tax-browser-fixture', setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\/actions$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
        args.path === 'next/link' ? `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}` :
        args.path === 'next/navigation' ? `export function useRouter(){return{refresh(){},push(){}}}` :
        ['saveAutomaticTaxSettings','saveAutomaticTaxProduct','checkAutomaticTaxConnection'].map(name => `export async function ${name}(form){window.__taxActions.push({name:'${name}',values:Object.fromEntries(form.entries())});return{ok:true,message:'Fixture action completed.'}}`).join('\n'), loader: 'tsx', resolveDir: process.cwd(),
      }));
    } }],
  });
  const css = (await postcss([tailwind({ base: process.cwd() })]).process(await readFile('app/globals.css', 'utf8'), { from: path.resolve('app/globals.css') })).css;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Automatic tax QA</title><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
  const server = createServer((request, response) => { const route = request.url?.split('?')[0]; response.setHeader('Content-Type', route === '/styles.css' ? 'text/css' : route === '/app.js' ? 'text/javascript' : 'text/html'); response.end(route === '/styles.css' ? css : route === '/app.js' ? built.outputFiles[0].text : html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    async function capture(name) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: page overflow`);
      await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true }); results.push(name);
    }
    await page.goto(url);
    await page.getByRole('heading', {name:'Collection settings'}).waitFor();
    const enable = page.getByRole('checkbox', {name:'Enable automatic tax collection'});
    assert.equal(await enable.isChecked(), false); assert.equal(await enable.isDisabled(), true);
    const initialConfig = page.locator('form').filter({ has: page.getByRole('button', {name:'Save tax configuration'}) });
    assert.equal(await initialConfig.getByRole('combobox', {name:'Product classification'}).inputValue(), '');
    assert.equal(await page.getByText('No registrations confirmed yet', {exact:true}).isVisible(), true);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /sk_live|whsec|raw provider/);
    await capture('desktop-setup-incomplete');
    await page.getByRole('button', {name:'Check Stripe Tax status'}).click();
    await page.getByText('Fixture action completed.', {exact:true}).waitFor();
    assert.equal((await page.evaluate(() => window.__taxActions.at(-1))).name, 'checkAutomaticTaxConnection');
    await page.goto(`${url}?ready`);
    await page.getByRole('heading', {name:'Collection settings'}).waitFor();
    const config = page.locator('form').filter({ has: page.getByRole('button', {name:'Save tax configuration'}) });
    assert.equal(await enable.isEnabled(), true);
    await enable.check(); await config.getByRole('radio', {name:/Include tax in the price/}).check();
    await config.getByRole('button', {name:'Save tax configuration'}).click();
    await config.getByText('Fixture action completed.', {exact:true}).waitFor();
    assert.deepEqual((await page.evaluate(() => window.__taxActions.at(-1))).values, {version:'1',enabled:'on',price_behavior:'inclusive',tax_code:'txcd_10103001'});
    const product = page.locator('form').filter({ has: page.getByRole('button', {name:'Save classification for Booking Policy'}) });
    await product.getByRole('combobox', {name:'Product classification'}).selectOption('');
    await product.getByRole('button', {name:'Save classification for Booking Policy'}).click();
    await product.getByText('Fixture action completed.', {exact:true}).waitFor();
    assert.equal((await page.evaluate(() => window.__taxActions.at(-1))).values.tax_code, '');
    await capture('desktop-setup-ready');
    await page.getByRole('tab', {name:'Setup & readiness'}).focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', {name:'Tax ledger'}).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('link', {name:'Export current ledger CSV'}).getAttribute('href'), '/admin/market/tax/export?from=2026-10-01&to=2026-10-31');
    await page.getByLabel('Choose tax month').fill('2026-02');
    assert.equal(await page.locator('[name="from"]').inputValue(), '2026-02-01');
    assert.equal(await page.locator('[name="to"]').inputValue(), '2026-02-28');
    assert.equal(await page.getByRole('link', {name:'Export current ledger CSV'}).getAttribute('href'), '/admin/market/tax/export?from=2026-10-01&to=2026-10-31');
    assert.equal(await page.locator('[name="view"]').inputValue(), 'ledger');
    assert.equal(await page.getByText(/Showing the latest 30 entries/).isVisible(), true);
    assert.equal(await page.getByText(/refunded invoice\(s\) need tax reconciliation/).isVisible(), true);
    assert.equal(await page.getByRole('link', {name:'Open Stripe Tax reports'}).getAttribute('href'), 'https://dashboard.stripe.com/tax/locations');
    assert.equal(await page.getByText(/Stripe may already have adjusted tax in its reports for a direct refund/).isVisible(), true);
    assert.equal(await page.getByText(/They can include finalized invoices before payment/).isVisible(), true);
    await page.getByRole('button', {name:'Next',exact:true}).click();
    assert.equal(await page.getByText('Page 2 of 2', {exact:true}).isVisible(), true);
    await capture('desktop-ledger');
    await page.setViewportSize({width:768,height:1024});
    await capture('tablet-ledger');
    await page.getByRole('tab', {name:'Setup & readiness'}).click();
    await capture('tablet-setup-ready');
    await page.getByRole('tab', {name:'Tax ledger'}).click();
    await page.setViewportSize({width:390,height:844});
    await capture('mobile-ledger');
    await page.getByRole('tab', {name:'Setup & readiness'}).click();
    await capture('mobile-setup-ready');
    await page.goto(url);
    await page.getByRole('heading', {name:'Collection settings'}).waitFor();
    await capture('mobile-setup-incomplete');
    await page.goto(`${url}?ready&test`);
    await page.getByRole('heading', {name:'Collection settings'}).waitFor();
    assert.equal(await enable.isDisabled(), true);
    assert.equal(await page.getByText('Test mode', {exact:true}).isVisible(), true);
    assert.deepEqual(errors, []);
    await writeFile(path.join(directory, 'receipt.json'), JSON.stringify({screenshots:results,browserErrors:errors,desktop:'1440×1000',tablet:'768×1024',mobile:'390×844',checks:['tax-off default','provider readiness gate','live-mode gate','no credentials in form or notices','versioned settings submit','classification inheritance','keyboard tabs','month boundaries','applied export range','refund reconciliation','pagination','no page overflow']},null,2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
