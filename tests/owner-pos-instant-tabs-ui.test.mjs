import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const skip = !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH;

// A push does not commit the pathname or replace the server children until the
// test releases it. Superseded responses are discarded, as in the Next router.
const navigationFixture = `
import{useSyncExternalStore}from'react';
let current=location.pathname+location.search,serial=0,latest=0;
const requests=[];const listeners=new Set();
function emit(){for(const listener of listeners)listener();}
function push(href){const request={id:++serial,href};latest=request.id;requests.push(request);return undefined;}
window.transport={requests,get current(){return current},commit(id){const request=requests.find(item=>item.id===id);if(!request)throw Error('Unknown request');if(id!==latest)return false;history.pushState({},'',request.href);current=request.href;emit();return true;}};
window.addEventListener('popstate',()=>{latest=++serial;current=location.pathname+location.search;emit();});
function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function usePathname(){return useSyncExternalStore(subscribe,()=>current.split(/[?#]/)[0]);}
export function useSearchParams(){const href=useSyncExternalStore(subscribe,()=>current);return new URLSearchParams(href.split('?')[1]?.split('#')[0]??'');}
export function useRouter(){return{push,replace:push,refresh(){window.refreshes=(window.refreshes??0)+1;}};}
`;

const linkFixture = `
import React from'react';import{useRouter}from'next/navigation';
export default function Link({href,onClick,onNavigate,prefetch,replace,scroll,...props}){
 const router=useRouter();
 return <a {...props} href={href} onClick={event=>{
  onClick?.(event);if(event.defaultPrevented)return;
  if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||props.target||props.download!==undefined){event.preventDefault();return;}
  event.preventDefault();let cancelled=false;onNavigate?.({preventDefault(){cancelled=true;}});if(!cancelled)router.push(href);
 }}/>;
}
`;

async function fixture({ actualCheckout = false } = {}) {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const root = resolve('.').replaceAll('\\', '/');
  const contents = `
import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{usePathname}from'next/navigation';
import{OwnerWorkspaceFrame}from'${root}/app/pos/owner-workspace-frame';
import{OwnerPosTabs}from'${root}/app/pos/owner-pos-tabs';
${actualCheckout ? `import{OwnerPosClient}from'${root}/app/pos/owner-pos-client';import*as operations from'${root}/lib/portable-operations';window.operations=operations;` : ''}
function CheckoutProbe(){const[value,setValue]=useState('50');const[busy,setBusy]=useState(false);useEffect(()=>{window.checkoutMounts=(window.checkoutMounts??0)+1;},[]);return <div data-checkout-probe><OwnerPosTabs active="pos"/><input aria-label="Draft amount" value={value} onChange={event=>setValue(event.target.value)}/><button disabled={busy} onClick={()=>setBusy(true)}>Checkout work</button></div>;}
function Panel({route}){const[draft,setDraft]=useState('');const[busy,setBusy]=useState(false);return <article data-route-probe={route}><h1>{route} content</h1><input aria-label={'Draft '+route} value={draft} onChange={event=>setDraft(event.target.value)}/><button disabled={busy} onClick={()=>setBusy(true)}>Work {route}</button><a href="/pos-tickets?date=2026-10-06">Legacy ticket date</a><form action="/reports" method="get"><input name="date" defaultValue="2026-10-06"/><button>Filter report</button></form><a href="/pos/book" download>Download bypass</a><a href="https://example.invalid/pos/report">External bypass</a></article>;}
function App(){const path=usePathname();return <OwnerWorkspaceFrame salonName="Fixture salon" checkout={${actualCheckout ? '<OwnerPosClient scope="owner:fixture:viewer" salonId="fixture" salonName="Fixture salon" initial={{staff:[],services:[],today:"2026-10-15",defaults:{staffCheckInEnabled:false,largeTurnThreshold:25,tipSuggestions:[10,15,20,25]}}}/>' : '<CheckoutProbe/>'}}><div data-route-outlet>{['/pos/ticket','/pos/book','/pos/check-in','/pos/report'].map(route=><Activity key={route} mode={path===route?'visible':'hidden'}><Panel route={route}/></Activity>)}</div></OwnerWorkspaceFrame>;}
document.addEventListener('click',event=>{if(event.target.closest?.('[data-owner-more-popover],a[download],a[href^="https:"]'))event.preventDefault();});
createRoot(document.getElementById('root')).render(<App/>);
`;
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents },
    jsx: 'automatic', bundle: true, write: false, platform: 'browser',
    plugins: [{ name: 'delayed-pos-transport', setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)role-more-content$/ }, () => ({ path: 'more', namespace: 'fixture' }));
      builder.onResolve({ filter: /pos-workspace-sync$/ }, () => ({ path: 'refresh', namespace: 'fixture' }));
      builder.onResolve({ filter: /service-relay\/desk-relay$/ }, () => ({ path: 'relay', namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\/actions$/ }, args => args.importer.endsWith('owner-pos-client.tsx') ? { path: 'actions', namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: root, contents: ({
        'next/navigation': navigationFixture,
        'next/link': linkFixture,
        css: '',
        language: 'export const WorkspaceText=({text})=>text;export function useWorkspaceTranslation(){return value=>value;}',
        more: 'export function RoleMoreContent(){return <a href="/pos/report">More report</a>;}',
        refresh: 'export function usePosResourceRefresh(){}',
        relay: 'export function DeskRelay(){return null;}',
        actions: 'export async function searchPosDeskCustomers(){return[];}',
      })[args.path] }));
    } }],
  });
  const css = readFileSync('app/pos/owner-pos.css', 'utf8');
  const apiRequests = [];
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(bundle.outputFiles[0].text);
    } else if (request.url.startsWith('/api/')) {
      apiRequests.push({ method: request.method, url: request.url });
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end('{}');
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<style>:root{--surface-muted:#f5f5f5;--brand-orange-soft:#fff3e9;--border-subtle:#ddd;--text-secondary:#555;--brand-black:#111;--brand-orange:#f26f3d;--text-primary:#111}body{margin:0}button,input{font:inherit}' + css + '</style><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ['--no-proxy-server'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Browser storage and checkout are real; the fixture stays offline so a
  // locally queued receipt can never become an external money operation.
  if (actualCheckout) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/pos');
  return { page, errors, apiRequests, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

function tab(page, name) { return page.locator('.owner-top-nav:visible').getByRole('link', { name, exact: true }); }
async function frames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function lastRequest(page) { return page.evaluate(() => window.transport.requests.at(-1)); }
async function commit(page, id) { return page.evaluate(id => window.transport.commit(id), id); }
async function expectActive(page, label) { assert.equal(await page.locator('.owner-top-nav:visible a[aria-current=page]').textContent(), label); }

test('POS tab intent paints before delayed route data, supersedes races, and preserves checkout and panel work', { skip, timeout: 60_000 }, async () => {
  const app = await fixture();
  const { page } = app;
  try {
    await page.getByLabel('Draft amount', { exact: true }).fill('125.75');
    await page.evaluate(() => { window.checkoutInput = document.querySelector('[aria-label="Draft amount"]'); });
    await page.getByRole('button', { name: 'Checkout work', exact: true }).click();
    await tab(page, 'Book').click();
    const book = await lastRequest(page);
    await frames(page);
    assert.equal(await page.evaluate(() => window.transport.current), '/pos', 'the server route is deliberately still unresolved');
    await expectActive(page, 'Book');
    assert.equal(await page.locator('[data-owner-tab-pending="book"] [data-pos-tab-placeholder="book"][aria-busy="true"]').isVisible(), true);
    assert.equal(await page.getByLabel('Draft amount', { exact: true }).isVisible(), false);
    assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Draft amount"]') === window.checkoutInput), true);

    await tab(page, 'POS').click();
    await frames(page);
    await expectActive(page, 'POS');
    assert.equal(await page.getByLabel('Draft amount', { exact: true }).inputValue(), '125.75');
    assert.equal(await page.getByRole('button', { name: 'Checkout work', exact: true }).isDisabled(), true, 'checkout busy state stays local and intact');
    assert.equal(await commit(page, book.id), false, 'the transport discards the superseded Book response');
    assert.equal(await page.locator('[data-owner-tab-pending]').count(), 0);

    await tab(page, 'Ticket').click();
    const ticket = await lastRequest(page);
    await tab(page, 'Report').click();
    const report = await lastRequest(page);
    await frames(page);
    await expectActive(page, 'Report');
    assert.equal(await page.locator('[data-owner-tab-pending="report"]').isVisible(), true);
    assert.equal(await commit(page, ticket.id), false);
    assert.equal(await commit(page, report.id), true);
    await page.locator('[data-route-probe="/pos/report"]:visible').waitFor();
    assert.equal(await page.locator('[data-owner-tab-pending]').count(), 0);
    await page.getByLabel('Draft /pos/report', { exact: true }).fill('unsubmitted report filter');
    await page.getByRole('button', { name: 'Work /pos/report', exact: true }).click();
    await page.evaluate(() => { window.reportInput = document.querySelector('[aria-label="Draft /pos/report"]'); });

    await tab(page, 'Book').click();
    const committedBook = await lastRequest(page);
    await frames(page);
    assert.equal(await page.getByLabel('Draft /pos/report', { exact: true }).isVisible(), false, 'old content is not mislabeled as the requested tab');
    assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Draft /pos/report"]') === window.reportInput), true, 'pending navigation does not unmount the current children');
    assert.equal(await tab(page, 'POS').isEnabled(), true, 'a busy route does not lock the navigation');
    assert.equal(await commit(page, committedBook.id), true);
    await page.getByRole('button', { name: 'Work /pos/book', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Work /pos/book', exact: true }).isEnabled(), true, 'destination work is independent from the previous panel busy state');

    await page.evaluate(() => history.back());
    await page.getByLabel('Draft /pos/report', { exact: true }).waitFor();
    await expectActive(page, 'Report');
    assert.equal(await page.getByLabel('Draft /pos/report', { exact: true }).inputValue(), 'unsubmitted report filter');
    assert.equal(await page.getByRole('button', { name: 'Work /pos/report', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Draft /pos/report"]') === window.reportInput), true);
    await page.evaluate(() => history.forward());
    await page.locator('[data-route-probe="/pos/book"]:visible').waitFor();
    await expectActive(page, 'Book');

    await tab(page, 'Ticket').click();
    const abandoned = await lastRequest(page);
    await page.evaluate(() => history.back());
    await page.getByLabel('Draft /pos/report', { exact: true }).waitFor();
    await expectActive(page, 'Report');
    assert.equal(await page.locator('[data-owner-tab-pending]').count(), 0, 'history navigation cancels stale optimistic intent');
    assert.equal(await commit(page, abandoned.id), false);
    await tab(page, 'POS').click();
    await page.getByLabel('Draft amount', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Draft amount', { exact: true }).inputValue(), '125.75');
    assert.equal(await page.evaluate(() => window.checkoutMounts), 1);
    assert.deepEqual(app.apiRequests, []);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('POS optimistic tabs preserve native link gestures, More links, and scoped legacy GET navigation', { skip, timeout: 60_000 }, async () => {
  const app = await fixture();
  const { page } = app;
  try {
    const before = await page.evaluate(() => window.transport.requests.length);
    await tab(page, 'Book').dispatchEvent('click', { ctrlKey: true, button: 0 });
    await tab(page, 'Report').dispatchEvent('click', { metaKey: true, button: 0 });
    await frames(page);
    assert.equal(await page.evaluate(() => window.transport.requests.length), before);
    assert.equal(await page.locator('[data-owner-tab-pending]').count(), 0);
    await expectActive(page, 'POS');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('link', { name: 'More report', exact: true }).click();
    assert.equal(await page.locator('[data-owner-tab-pending]').count(), 0, 'More navigation is not treated as a workspace tab intent');
    assert.equal(await page.evaluate(() => window.transport.requests.length), before);
    await page.keyboard.press('Escape');

    await tab(page, 'Ticket').click();
    await commit(page, (await lastRequest(page)).id);
    await page.getByRole('link', { name: 'Legacy ticket date', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Download bypass', exact: true }).click();
    await page.getByRole('link', { name: 'External bypass', exact: true }).click();
    assert.equal(await page.locator('[data-owner-tab-pending]').count(), 0);
    await page.getByRole('link', { name: 'Legacy ticket date', exact: true }).click();
    const dated = await lastRequest(page);
    assert.equal(dated.href, '/pos/ticket?date=2026-10-06');
    await commit(page, dated.id);
    await frames(page);
    assert.equal(await page.locator('[data-owner-tab-pending]').count(), 0, 'a same-tab query commit cannot leave the tab stuck pending');
    await page.getByRole('button', { name: 'Filter report', exact: true }).click();
    const filtered = await lastRequest(page);
    assert.equal(filtered.href, '/pos/report?date=2026-10-06');
    await frames(page);
    await expectActive(page, 'Report');
    await commit(page, filtered.id);
    await page.locator('[data-route-probe="/pos/report"]:visible').waitFor();
    assert.deepEqual(app.apiRequests, []);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('real POS checkout retains exact money draft and one durable receipt across delayed tab navigation', { skip, timeout: 60_000 }, async () => {
  const app = await fixture({ actualCheckout: true });
  const { page } = app;
  try {
    const amount = page.locator('[aria-label="Amount"]:visible');
    await amount.fill('50');
    const originalCartId = await page.evaluate(() => JSON.parse(localStorage.getItem('kingpos:owner-cart:v1:owner:fixture:viewer')).cart.id);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.waitForFunction(async () => (await window.operations.listPortableOperations('owner:fixture:viewer')).length === 1);
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Amount"]')].some(input => input.getBoundingClientRect().width && input.value === ''));
    const receipt = await page.evaluate(async () => (await window.operations.listPortableOperations('owner:fixture:viewer'))[0]);
    assert.equal(receipt.payload.ownerCartId, originalCartId);
    assert.equal(receipt.payload.lines[0].total, 50);
    await amount.fill('125.75');
    const secondDraft = await page.evaluate(() => { window.moneyInput = [...document.querySelectorAll('[aria-label="Amount"]')].find(input => input.getBoundingClientRect().width); return JSON.parse(localStorage.getItem('kingpos:owner-cart:v1:owner:fixture:viewer')).cart; });

    await tab(page, 'Book').click();
    const book = await lastRequest(page);
    await frames(page);
    await expectActive(page, 'Book');
    assert.equal(await page.locator('[data-owner-tab-pending="book"]').isVisible(), true);
    assert.equal(await page.evaluate(() => window.transport.current), '/pos');
    await tab(page, 'POS').click();
    await amount.waitFor();
    assert.equal(await amount.inputValue(), '125.75');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('[aria-label="Amount"]')].includes(window.moneyInput) && window.moneyInput.getBoundingClientRect().width > 0), true);
    assert.equal(await commit(page, book.id), false);

    await tab(page, 'Report').click();
    await commit(page, (await lastRequest(page)).id);
    await page.locator('[data-route-probe="/pos/report"]:visible').waitFor();
    await tab(page, 'POS').click();
    await amount.waitFor();
    assert.equal(await amount.inputValue(), '125.75');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kingpos:owner-cart:v1:owner:fixture:viewer')).cart), secondDraft);
    const receipts = await page.evaluate(() => window.operations.listPortableOperations('owner:fixture:viewer'));
    assert.equal(receipts.length, 1, 'navigation never replays Submit');
    assert.equal(receipts[0].id, receipt.id);
    assert.deepEqual(receipts[0].payload, receipt.payload);
    assert.equal(app.apiRequests.some(request => request.method !== 'GET'), false, 'the offline fixture cannot send payment or receipt mutations');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('owner server bootstrap guards first, starts desk and preferences together, and renders only a complete authorized result', { skip: !process.env.ESBUILD_MODULE_PATH }, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const imports = {
    '@/lib/route-context-guards': 'export function requireSalonManagePageContext(path){return globalThis.ownerBootstrap.guard(path)}',
    '@/lib/pos-desk': 'export function getCurrentSalonPosDeskData(options){return globalThis.ownerBootstrap.desk(options)}',
    '@/lib/supabase/server': 'export function createAuthenticatedSupabaseServerClient(){return globalThis.ownerBootstrap.auth()}',
    '@/lib/pos-workspace-preferences': 'export function normalizeWorkspacePreferences(value){return globalThis.ownerBootstrap.normalize(value)}',
    '@/app/pos/owner-pos-client': 'export function OwnerPosClient(){throw Error("Checkout must remain a React element until rendering")}',
    '@/app/pos/owner-workspace-frame': 'export function OwnerWorkspaceFrame(){throw Error("Frame must remain a React element until rendering")}',
  };
  const bundle = await build({
    entryPoints: [resolve('app/(app)/pos/(workspace)/layout.tsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'authorized-bootstrap-probes', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => {
        assert.ok(args.path in imports, `Unprobed server dependency: ${args.path}`);
        return { path: args.path, namespace: 'probe' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'probe' }, args => ({ loader: 'js', contents: imports[args.path] }));
    } }],
  });
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, createRequire(import.meta.url));
  const Layout = loaded.exports.default;
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  function scenario() {
    const events = [];
    const guard = deferred(), desk = deferred(), auth = deferred(), settings = deferred();
    const normalized = { showStaff: true, idleMinutes: 45 };
    globalThis.ownerBootstrap = {
      guard(path) { events.push(['guard', path]); return guard.promise; },
      desk(options) { events.push(['desk', options]); return desk.promise; },
      auth() { events.push(['auth']); return auth.promise; },
      normalize(value) { events.push(['normalize', value]); return normalized; },
    };
    const client = { from(table) {
      events.push(['from', table]);
      return { select(columns) {
        events.push(['select', columns]);
        return { eq(column, value) {
          events.push(['eq', column, value]);
          return { maybeSingle() { events.push(['settings']); return settings.promise; } };
        } };
      } };
    } };
    return { events, guard, desk, auth, settings, client, normalized };
  }
  try {
    const context = { currentSalon: { id: 'selected-salon', name: 'Selected salon' }, user: { id: 'owner-user' } };
    const data = { staff: [{ id: 'staff-one' }], services: [{ id: 'service-one' }], defaults: { largeTurnThreshold: 30 }, today: '2026-10-15' };
    const success = scenario();
    let finished = false;
    const startedAt = Date.now();
    const pending = Layout({ children: 'existing route child' });
    pending.then(() => { finished = true; });
    assert.deepEqual(success.events, [['guard', '/pos']]);
    success.guard.resolve(context);
    await tick();
    assert.deepEqual(success.events.map(event => event[0]), ['guard', 'desk', 'auth'], 'neither read waits for the other after the manage guard');
    assert.equal(success.events[1][1].context, context);
    assert.equal(success.events[1][1].includeCustomers, false);
    assert.equal(finished, false);
    success.desk.resolve(data);
    await tick();
    assert.equal(finished, false, 'desk completion does not expose checkout while authenticated preferences are pending');
    success.auth.resolve(success.client);
    await tick();
    assert.deepEqual(success.events.slice(3), [['from', 'pos_settings'], ['select', 'workspace_preferences'], ['eq', 'salon_id', 'selected-salon'], ['settings']]);
    assert.equal(finished, false);
    const preferences = { showStaff: true, idleMinutes: 45 };
    success.settings.resolve({ data: { workspace_preferences: preferences } });
    const element = await pending;
    assert.equal(element.type.name, 'OwnerWorkspaceFrame');
    assert.equal(element.props.salonName, 'Selected salon');
    assert.equal(element.props.children, 'existing route child');
    const checkout = element.props.checkout;
    assert.equal(checkout.type.name, 'OwnerPosClient');
    assert.equal(checkout.key, 'selected-salon:owner-user');
    assert.equal(checkout.props.scope, 'owner:selected-salon:owner-user');
    assert.equal(checkout.props.salonId, 'selected-salon');
    assert.equal(checkout.props.salonName, 'Selected salon');
    assert.equal(checkout.props.initial.staff, data.staff);
    assert.equal(checkout.props.initial.services, data.services);
    assert.equal(checkout.props.initial.defaults, data.defaults);
    assert.equal(checkout.props.initial.today, data.today);
    assert.equal(checkout.props.preferences, success.normalized);
    assert.equal(success.events.at(-1)[1], preferences);
    assert.ok(checkout.props.snapshotAt >= startedAt && checkout.props.snapshotAt <= Date.now());

    const denied = scenario();
    const deniedResult = Layout({ children: null });
    denied.guard.reject(new Error('manage access denied'));
    await assert.rejects(deniedResult, /manage access denied/);
    assert.deepEqual(denied.events, [['guard', '/pos']], 'a denied guard cannot start either data read');

    const failed = scenario();
    const failedResult = Layout({ children: null });
    failed.guard.resolve(context);
    await tick();
    assert.deepEqual(failed.events.map(event => event[0]), ['guard', 'desk', 'auth']);
    failed.auth.resolve(failed.client);
    await tick();
    failed.desk.reject(new Error('desk unavailable'));
    await assert.rejects(failedResult, /desk unavailable/);
    failed.settings.resolve({ data: { workspace_preferences: preferences } });
    await tick();
    assert.equal(failed.events.some(event => event[0] === 'normalize'), false, 'a failed read cannot render a partial checkout');
  } finally { delete globalThis.ownerBootstrap; }
});
