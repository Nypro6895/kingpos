import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
const salon = '11111111-1111-4111-8111-111111111111', viewer = '33333333-3333-4333-8333-333333333333';
const scope = 'v3:' + 'a'.repeat(64), ownerScope = `owner:${salon}:${viewer}`, key = `kingpos:owner-cart:v1:${ownerScope}`;
const today = new Date().toISOString().slice(0, 10);
const draft = () => ({ id: '44444444-4444-4444-8444-444444444444', amount: '77.25', staffId: null, serviceId: null, customer: null, lines: [], tip: '', discount: '' });
let compiled, styles;
async function source() {
  styles ??= postcss([tailwind({ base: process.cwd(), optimize: true })]).process(['app/globals.css', 'app/pos/owner-pos.css', 'app/local-app/app.css'].map(file => readFileSync(file, 'utf8')).join('\n'), { from: path.resolve('app/globals.css') }).then(result => result.css);
  compiled ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `import './app/local-app/entry';import{openOwnerCart}from'./lib/owner-cart-startup';window.openOwnerCart=openOwnerCart;` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'actual-owner-entry', setup(builder) {
    const noPage = name => `export const ${name}=()=>null;`;
    const stubs = {
      'next/navigation': `export*from'./app/local-app/navigation';`, 'next/link': `export{AppLocalLink as default,useLinkStatus}from'./app/local-app/navigation';`, 'next/image': `export{AppLocalImage as default}from'./app/local-app/navigation';`, 'next/form': `export{AppLocalForm as default}from'./app/local-app/navigation';`,
      '@/components/workspace-language': `export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='span',text,...props})=><Tag {...props}>{text}</Tag>;export const useWorkspaceTranslation=()=>x=>x;`,
      '@/components/app-local-shell': `export const AppLocalShell=({children,path})=><div data-fixture-shell data-owner-pos-shell={/^\\/pos(?:\\/(?:check-in|book|ticket|report))?(?:\\?|$)/.test(path)?'true':undefined}>{children}</div>;`,
      '@/components/app-local-help': `export const AppLocalHelp=()=> <main><h1>Public Help</h1></main>;`,
      '@/app/legal/legal-components': 'export const LegalDocumentPage=()=>null;export const LegalHub=()=>null;', '@/lib/legal-policies': 'export const legalDocuments={};',
      '@/lib/app-local-reference-content': 'export const APP_LOCAL_REFERENCE_ASSETS=[];',
      '@/lib/supabase/browser': 'export const createSupabaseBrowserClient=()=>null;',
      '@/app/service-relay/desk-relay': 'export const DeskRelay=()=>null;',
      '@/app/pos/portable/portable-draft-controls': 'export const PortableDraftControls=()=>null;',
      '@/app/pos/portable/portable-sync-indicator': `export const PortableSyncIndicator=()=> <button type='button' aria-label='Up to date' style={{width:40,height:40}} onClick={()=>window.syncClicks++}>✓</button>;`,
      '@/lib/pos-workspace-sync': 'export const usePosResourceRefresh=()=>{};export const usePosWorkspaceSync=()=>{};export const getPosResourceRevision=()=>0;export const publishPosWorkspaceSync=()=>{};export const subscribePosChanges=()=>()=>{};',
      '@/app/pos/owner-check-in-actions': `export async function ownerSubmitAttendance(input){window.attendanceCalls.push(input);return new Promise(resolve=>window.attendanceReplies.push(resolve));}`,
      '@/app/bookings/owner-live-booking-workspace': `export const OwnerLiveBookingWorkspace=()=> <main><h1>Bookings</h1><input aria-label='Booking draft' defaultValue='Existing note'/></main>;`,
      '@/app/pos-tickets/owner-live-tickets': `export const OwnerLiveTickets=()=> <section><h1>Work log</h1></section>;`,
      '@/app/reports/owner-live-reports': `export const OwnerLiveReports=()=> <main><h1>Report</h1><input aria-label='Report filter' defaultValue='Today'/></main>;`,
      '@/lib/app-local-page-registry': noPage('getAppLocalPage'), '@/lib/app-local-personal-registry': noPage('getAppLocalPersonalPage'), '@/lib/app-local-explore-registry': noPage('getAppLocalExplorePage'), '@/lib/app-local-owner-page-registry': noPage('getAppLocalOwnerPage'), '@/lib/app-local-business-registry': noPage('getAppLocalBusinessPage'), '@/lib/app-local-public-registry': noPage('getAppLocalPublicPage'), '@/lib/app-local-daily-registry': noPage('getAppLocalDailyPage'), '@/lib/app-local-secondary-registry': noPage('getAppLocalSecondaryPage')+'export const appLocalRouteAlias=x=>x;', '@/lib/app-local-payroll-tax-registry': noPage('getAppLocalPayrollTaxPage'), '@/lib/app-local-commerce-registry': noPage('getAppLocalCommercePage'), '@/lib/app-local-portable-registry': noPage('getAppLocalPortablePage'), '@/lib/app-local-display-registry': noPage('getAppLocalDisplayPage'),
      '@/lib/portable-operations': `import*as real from'./lib/portable-operations.ts';export*from'./lib/portable-operations.ts';export async function portableCheckpoint(...args){window.checkpointCalls++;if(window.checkpointMode==='fail')throw Error('Temporary device read failure');if(window.checkpointMode==='hold')return new Promise(resolve=>window.checkpointWaiters.push(resolve));return real.portableCheckpoint(...args)}`,
    };
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path in stubs) return { path: args.path, namespace: 'fixture' };
      if (args.path.endsWith('.css')) return { path: args.path, namespace: 'css' };
      if (!args.path.startsWith('@/') && !args.path.startsWith('.')) return;
      const base = args.path.startsWith('@/') ? path.resolve(args.path.slice(2)) : path.resolve(path.dirname(args.importer), args.path), canonical='@/'+path.relative(process.cwd(),base).replaceAll('\\','/'), file = ['.ts', '.tsx'].map(ext => base + ext).find(existsSync);
      if(canonical in stubs)return{path:canonical,namespace:'fixture'};
      if (file && /^\s*["']use server["']/.test(readFileSync(file, 'utf8'))) return { path: file, namespace: 'action' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: process.cwd(), contents: stubs[args.path] }));
    builder.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ loader: 'js', contents: 'export default new Proxy({},{get:(_,key)=>key});' }));
    builder.onLoad({ filter: /.*/, namespace: 'action' }, args => ({ loader: 'js', contents: [...readFileSync(args.path, 'utf8').matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(([, name]) => `export async function ${name}(){window.forbiddenCommands++;throw Error('Business write forbidden')}`).join('\n') }));
  } }] });
  return { js: (await compiled).outputFiles[0].text, css: await styles };
}
async function fixture({ checkpointMode = 'real', saved, noRandomUUID = false, width = 390, checkInEnabled=false, cartStorageFailure=false } = {}) {
  const { js, css } = await source();
  const now = Date.now();
  const context = { schemaVersion: 1, context: { scope, viewerId: viewer, workspaceId: salon, salonId: salon, permissionRevision: 'owner-r1', authenticated: true }, display: { name: 'Fixture owner', language: 'en', role: 'OWNER' }, access: { ownerWorkspace: true, staffWorkspace: false }, onlineValidatedAt: now, grant: { version: 1, scope, scopes: [scope], viewerId: viewer, workspaceId: salon, salonId: salon, grantRevision: 'owner-r1', generation: 'fixture-generation', issuedAt: now, expiresAt: now + 3600000, path: '/pos', kind: 'owner' } };
  const staffId='22222222-2222-4222-8222-222222222222';
  const reference = { ownerScope, salonId: salon, salonName: 'Fixture salon', timezone: 'UTC', today, staff: checkInEnabled?[{id:staffId,display_name:'Fixture Staff',job_title:'Technician',is_active:true,today_status:'not_checked_in',check_in_at:null,check_in_sequence:null,turns:{queueTurns:0,largeTurns:0,smallTurns:0,totalTurns:0,receiptLargeTurns:0}}]:[], services: [], defaults: { adsFooter: '', largeTurnThreshold: 25, showServiceName: true, showStaffName: true, staffCheckInEnabled: checkInEnabled, taxEnabled: false, tipSuggestions: [10, 15, 20] }, preferences: { showStaff: true, showServices: true, showCustomer: true, showTip: true, showDiscount: true, idleMinutes: 3, idleWarningSeconds: 60 } };
  const data = { 'owner.workspace': { view: 'workspace', props: reference }, 'owner.check-in': { view: 'check-in', props: { data: {salonId:salon,salonName:'Fixture salon',salonLogoUrl:null,timezone:'UTC',today,checkInEnabled:true,staff:checkInEnabled?[{id:staffId,displayName:'Fixture Staff',jobTitle:'Technician',avatarUrl:null,status:'not_checked_in',isPasscodeDefault:false,queueTurnCount:0,checkInAt:null,checkInSequence:null}]:[]} } }, 'owner.bookings': { view: 'bookings', props: {} }, 'owner.reports': { view: 'reports', props: {} }, 'owner.tickets': { view: 'tickets', props: { today, selectedDate: today, searchQuery: '' } } };
  const bootstrap = `window.__reylumiAppLocalContext={version:1,nonce:'fixture',scopeEpoch:1,generation:'fixture-generation'};window.checkpointMode=${JSON.stringify(checkpointMode)};window.checkpointWaiters=[];window.checkpointCalls=0;window.syncClicks=0;window.forbiddenCommands=0;window.reads=[];window.contextCalls=[];window.attendanceCalls=[];window.attendanceReplies=[];window.__reylumiAppLocalTransport={request:async r=>{if(r.kind==='context'){window.contextCalls.push(r.args.path);return{...${JSON.stringify(context)},contextPath:r.args.path}}if(r.kind==='read'){window.reads.push({name:r.name,scope:r.args.scope});if(r.args.scope!==${JSON.stringify(scope)})throw Error('Wrong scope');return{schemaVersion:1,status:200,scope:r.args.scope,etag:'r1',updatedAt:Date.now(),data:${JSON.stringify(data)}[r.name]}}if(r.kind==='cache')return null;window.forbiddenCommands++;throw Error('No business commands allowed')}};${saved !== undefined ? `if(!sessionStorage.seeded){localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(saved)});sessionStorage.seeded='yes';}` : ''}${noRandomUUID ? `Object.defineProperty(Crypto.prototype,'randomUUID',{configurable:true,value:undefined});` : ''}`;
  const storageFailure=cartStorageFailure?`window.cartStorageFailure=${JSON.stringify(cartStorageFailure)};const originalGetItem=Storage.prototype.getItem,originalSetItem=Storage.prototype.setItem;window.readRawOwnerCart=()=>originalGetItem.call(localStorage,${JSON.stringify(key)});Storage.prototype.getItem=function(name){if(name===${JSON.stringify(key)}&&window.cartStorageFailure==='read')throw new DOMException('PRIVATE_DIAGNOSTIC_MUST_NOT_RENDER','SecurityError');return originalGetItem.call(this,name)};Storage.prototype.setItem=function(name,value){if(name===${JSON.stringify(key)}&&window.cartStorageFailure==='write')throw new DOMException('PRIVATE_DIAGNOSTIC_MUST_NOT_RENDER','QuotaExceededError');return originalSetItem.call(this,name,value)};`:'';
  const writes = [];
  const server = createServer((request, response) => {
    if (request.method !== 'GET') { writes.push(request.url); response.writeHead(405); response.end(); return; }
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? js : '<!doctype html><style>' + css + '</style><div id="app"></div><script>' + bootstrap + storageFailure + '</script><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port, browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width, height: width === 820 ? 1180 : 900 } }), errors = [];
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/pos');
  return { page, writes, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}
const amount = page => page.locator('.owner-inline-money input[aria-label="Amount"]').filter({ visible: true }).first();
const nav = page => page.locator('[data-owner-navigation]:visible');
const navigate = (page, href) => page.evaluate(path => window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate', { detail: { path } })), href);

test('actual installed entry keeps one visible owner navigation across all five tabs, preserves checkout DOM/lease and separates the sync hit target', { skip, timeout: 180000 }, async () => {
  for (const width of [390, 820, 1440]) {
    const app = await fixture({ width });
    try {
      const { page } = app, input = width < 980 ? amount(page) : page.locator('.owner-amount-field input[aria-label="Amount"]');
      await input.fill('77.25'); await input.evaluate(element => window.originalAmount = element);
      assert.equal(await nav(page).count(), 1);
      const hit = await page.locator('.owner-sync-status button').evaluate(button => {
        const sync = button.getBoundingClientRect(), links = [...document.querySelectorAll('[data-owner-navigation] a')].filter(link => link.checkVisibility()).map(link => { const r = link.getBoundingClientRect(), clip=link.closest('nav').getBoundingClientRect(); return { label: link.getAttribute('aria-label'), overlap: Math.max(0, Math.min(r.right, clip.right, sync.right) - Math.max(r.left, clip.left, sync.left)) * Math.max(0, Math.min(r.bottom, clip.bottom, sync.bottom) - Math.max(r.top, clip.top, sync.top)) }; });
        return { links, x: sync.x, width: sync.width, viewport: innerWidth };
      });
      assert(hit.x >= 0 && hit.x + hit.width <= hit.viewport + 1);
      assert(hit.links.every(link => link.overlap === 0), JSON.stringify(hit));
      const checkIn=nav(page).getByRole('link',{name:'Check In',exact:true});await checkIn.scrollIntoViewIfNeeded();
      assert.equal(await checkIn.evaluate(link=>{const r=link.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return Boolean(hit&&link.contains(hit));}),true,'the actual Check In center reaches its link after horizontal scrolling');
      for (const [href, label] of [['/pos/check-in', 'Check In'], ['/pos/book', 'Book'], ['/pos/ticket', 'Ticket'], ['/pos/report', 'Report'], ['/pos', 'POS']]) {
        await nav(page).getByRole('link', { name: label, exact: true }).click();
        await page.waitForFunction(target => location.pathname === target, href);
        assert.equal(await nav(page).count(), 1, width + ' ' + href + ' has exactly one visible nav');
        assert.equal(await nav(page).getByRole('link', { name: label, exact: true }).getAttribute('aria-current'), 'page');
        assert.equal(await nav(page).getByRole('button', { name: 'More', exact: true }).isVisible(), true);
        assert.equal(await page.locator('[aria-label="Amount"]').evaluateAll(elements => elements.includes(window.originalAmount)), true);
        assert.equal(await page.evaluate(async ownerScope => { let acquired = false; await navigator.locks.request('kingpos:workspace-window:' + ownerScope, { ifAvailable: true }, lock => { acquired = Boolean(lock); }); return acquired; }, ownerScope), false, 'writer lock remains held');
        if(href==='/pos/check-in'){await page.clock.install();await page.clock.runFor(12_050);}
      }
      assert.equal(await input.inputValue(), '77.25');
      await nav(page).getByRole('button', { name: 'More', exact: true }).click();
      await page.locator('[data-owner-more-popover] a[href="/help"]').click();
      await page.getByRole('heading', { name: 'Public Help' }).waitFor();
      await navigate(page, '/pos'); await input.waitFor();
      assert.equal(await input.evaluate(element => element === window.originalAmount), true);
      assert.equal(await input.inputValue(), '77.25');
      assert.equal(await page.evaluate(() => window.forbiddenCommands), 0); assert.deepEqual(app.writes, []);
    } finally { await app.close(); }
  }
});

test('actual cashier opens with real IndexedDB when randomUUID is unavailable, and reload keeps the same unsent cart', { skip, timeout: 60000 }, async () => {
  const app = await fixture({ noRandomUUID: true });
  try {
    const input = amount(app.page); await input.fill('48.50');
    const first = await app.page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert.match(first.cart.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    await app.page.reload(); await amount(app.page).waitFor();
    assert.equal(await amount(app.page).inputValue(), '48.50');
    assert.equal(await app.page.evaluate(key => JSON.parse(localStorage.getItem(key)).cart.id, key), first.cart.id);
    assert.equal(await app.page.evaluate(() => window.forbiddenCommands), 0); assert.deepEqual(app.writes, []);
  } finally { await app.close(); }
});

test('failed checkpoint has an explicit safe retry and does not change the saved cart before a successful checkpoint', { skip, timeout: 60000 }, async () => {
  const saved = JSON.stringify({ savedAt: Date.now(), cart: draft() }), app = await fixture({ checkpointMode: 'fail', saved });
  try {
    await app.page.locator('[data-owner-cart-state="failed"]').waitFor();
    assert.equal(await app.page.locator('[data-owner-cart-state="failed"]').getAttribute('data-owner-cart-error'),'checkpoint:unknown');
    assert.equal(await app.page.getByRole('button', { name: 'Submit', exact: true }).count(), 0);
    assert.equal(await app.page.evaluate(key => localStorage.getItem(key), key), saved);
    await app.page.evaluate(() => window.checkpointMode = 'real');
    await app.page.getByRole('button', { name: 'Try again', exact: true }).click();
    await amount(app.page).waitFor(); assert.equal(await amount(app.page).inputValue(), '77.25');
    assert.equal(await app.page.evaluate(() => window.checkpointCalls), 2);
    assert.equal(await app.page.evaluate(() => window.forbiddenCommands), 0); assert.deepEqual(app.writes, []);
  } finally { await app.close(); }
});

test('held checkpoint times out without a write; retry can recover and the older completion cannot replace the edited cart', { skip, timeout: 60000 }, async () => {
  const saved = JSON.stringify({ savedAt: Date.now(), cart: draft() }), app = await fixture({ checkpointMode: 'hold', saved });
  try {
    await app.page.locator('[data-owner-cart-state="opening"]').waitFor();
    await app.page.clock.install(); await app.page.clock.runFor(8_050);
    await app.page.locator('[data-owner-cart-state="failed"]').waitFor();
    assert.equal(await app.page.locator('[data-owner-cart-state="failed"]').getAttribute('data-owner-cart-error'),'checkpoint:timeout');
    assert.equal(await app.page.evaluate(key => localStorage.getItem(key), key), saved);
    await app.page.evaluate(() => window.checkpointMode = 'real'); await app.page.getByRole('button', { name: 'Try again', exact: true }).click();
    await amount(app.page).fill('88.25');
    await app.page.evaluate(() => window.checkpointWaiters.splice(0).forEach(resolve => resolve(Date.now() + 100000)));
    await app.page.clock.runFor(50);
    assert.equal(await amount(app.page).inputValue(), '88.25');
    assert.equal(await app.page.evaluate(key => JSON.parse(localStorage.getItem(key)).cart.id, key), draft().id);
    assert.equal(await app.page.evaluate(() => window.forbiddenCommands), 0); assert.deepEqual(app.writes, []);
  } finally { await app.close(); }
});

test('corrupt saved record stays untouched and checkpointed submitted work never reappears as an editable draft', { skip, timeout: 60000 }, async () => {
  const app = await fixture({ saved: '{incomplete saved work' });
  try {
    await app.page.locator('[data-owner-cart-state="failed"]').waitFor();
    assert.equal(await app.page.locator('[data-owner-cart-state="failed"]').getAttribute('data-owner-cart-error'),'parse:invalid-json');
    assert.equal(await app.page.evaluate(key => localStorage.getItem(key), key), '{incomplete saved work');
    await app.page.getByRole('button', { name: 'Try again', exact: true }).click(); await app.page.locator('[data-owner-cart-state="failed"]').waitFor();
    assert.equal(await app.page.evaluate(key => localStorage.getItem(key), key), '{incomplete saved work');
    const result = await app.page.evaluate(async () => {
      let writes = 0, original = { savedAt: 100, cart: { id: 'already-submitted' } };
      const cart = await window.openOwnerCart({ key: 'fixture-key', scope: 'fixture-scope', storage: { getItem: () => JSON.stringify(original), setItem: () => writes++ }, checkpoint: async () => 100, create: () => ({ id: 'fresh-unsent' }), isCart: value => typeof value?.id === 'string' });
      return { cart, writes };
    });
    assert.deepEqual(result, { cart: { id: 'fresh-unsent' }, writes: 1 });
  } finally { await app.close(); }
});

test('an aborted startup cannot commit after a later scope succeeds', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await amount(app.page).waitFor();
    const result = await app.page.evaluate(async () => {
      const controller = new AbortController(), values = {}, writes = [];
      let release;
      const storage = { getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; writes.push(key); } };
      const pending = window.openOwnerCart({ key: 'old-key', scope: 'old-scope', storage, checkpoint: () => new Promise(resolve => release = resolve), create: () => ({ id: 'old' }), isCart: value => Boolean(value), signal: controller.signal }).catch(error => error.name);
      await Promise.resolve(); controller.abort();
      const next = await window.openOwnerCart({ key: 'new-key', scope: 'new-scope', storage, checkpoint: async () => 0, create: () => ({ id: 'new' }), isCart: value => Boolean(value) });
      release(0); await Promise.resolve(); return { status: await pending, next, writes };
    });
    assert.deepEqual(result, { status: 'AbortError', next: { id: 'new' }, writes: ['new-key'] });
  } finally { await app.close(); }
});

test('startup diagnostics expose only fixed stage/code and preserve the original private cause internally', {skip,timeout:60000},async()=>{
  const app=await fixture();
  try{
    await amount(app.page).waitFor();
    const results=await app.page.evaluate(async()=>{
      const run=async(stage)=>{
        const original=new DOMException('PRIVATE_CART_OR_ACCOUNT_MUST_NOT_LEAVE_CAUSE',stage==='storage-read'?'SecurityError':'QuotaExceededError');
        try{await window.openOwnerCart({key:'private-scope-key',scope:'private-viewer-scope',storage:{getItem(){if(stage==='storage-read')throw original;return null},setItem(){throw original}},checkpoint:async()=>0,create:()=>({id:'private-cart-content'}),isCart:()=>true})}
        catch(error){return{stage:error.stage,code:error.code,sameCause:error.cause===original,serialized:JSON.stringify(error),message:error.message}}
      };
      return Promise.all(['storage-read','storage-write'].map(run));
    });
    assert.deepEqual(results.map(value=>({stage:value.stage,code:value.code,sameCause:value.sameCause})),[{stage:'storage-read',code:'security',sameCause:true},{stage:'storage-write',code:'quota',sameCause:true}]);
    for(const value of results){assert(!/PRIVATE|private-|scope|viewer|cart-content/.test(value.serialized));assert.equal(value.message,'Saved work could not be opened.');}
    assert.equal(await app.page.locator('[data-owner-cart-error]').count(),0,'successful UI has no failure attribute');
  }finally{await app.close();}
});

test('actual startup storage failures render only safe diagnostics and retry leaves the exact existing cart available', {skip,timeout:60000},async()=>{
  for(const [failure,code]of[['read','storage-read:security'],['write','storage-write:quota']]){
    const saved=JSON.stringify({savedAt:Date.now(),cart:draft()}),app=await fixture({saved,cartStorageFailure:failure});
    try{
      const state=app.page.locator('[data-owner-cart-state="failed"]');await state.waitFor();
      assert.equal(await state.getAttribute('data-owner-cart-error'),code);
      assert(!/PRIVATE_DIAGNOSTIC|SecurityError|QuotaExceededError|storage-read|storage-write/.test(await state.innerText()),'technical codes and private causes stay out of visible copy');
      assert.equal(await app.page.evaluate(()=>window.readRawOwnerCart()),saved);
      await app.page.evaluate(()=>window.cartStorageFailure=false);await app.page.getByRole('button',{name:'Try again',exact:true}).click();
      await amount(app.page).waitFor();assert.equal(await amount(app.page).inputValue(),'77.25');
      assert.equal(await app.page.locator('[data-owner-cart-error]').count(),0);
      assert.equal(await app.page.evaluate(()=>window.forbiddenCommands),0);assert.deepEqual(app.writes,[]);
    }finally{await app.close();}
  }
});

test('hidden real Check In pauses its clock while a failed held attendance still rolls back the shared POS roster', {skip,timeout:60000},async()=>{
  const app=await fixture({width:1440,checkInEnabled:true});
  try{
    const {page}=app,input=page.locator('.owner-amount-field input[aria-label="Amount"]');await input.fill('77.25');
    await nav(page).getByRole('link',{name:'Check In',exact:true}).click();
    await page.getByRole('button',{name:/Fixture Staff/}).waitFor();
    await page.clock.install();await page.clock.runFor(1_050);
    await page.getByRole('button',{name:/Fixture Staff/}).click();
    for(const digit of['1','2','3','4'])await page.getByRole('button',{name:digit,exact:true}).click();
    await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.waitForFunction(()=>window.attendanceCalls.length===1);
    await nav(page).getByRole('link',{name:'POS',exact:true}).click();
    const clock=page.locator('[data-owner-local-panel="/pos/check-in"] time.tabular-nums'),before=await clock.textContent();
    await page.locator('.owner-staff').getByRole('button',{name:/Fixture Staff/}).waitFor();
    await page.clock.runFor(12_050);assert.equal(await clock.textContent(),before,'hidden presentation clock is stopped');
    await page.evaluate(()=>window.attendanceReplies.shift()({ok:false,error:'Fixture rejection: attendance was not saved.'}));
    await page.waitForFunction(()=>![...document.querySelectorAll('.owner-staff button')].some(element=>element.textContent.includes('Fixture Staff')));
    assert.equal(await input.inputValue(),'77.25');assert.equal(await page.evaluate(()=>window.attendanceCalls.length),1);
    await nav(page).getByRole('link',{name:'Check In',exact:true}).click();await page.clock.runFor(50);
    assert.notEqual(await clock.textContent(),before,'clock catches up on reveal');
    await page.getByText('Fixture rejection: attendance was not saved.',{exact:true}).waitFor();
    assert.deepEqual(app.writes,[]);assert.equal(await page.evaluate(()=>window.forbiddenCommands),0);
  }finally{await app.close();}
});
