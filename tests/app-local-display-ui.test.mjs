import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', skip = !existsSync(executablePath);
const salon = '11111111-1111-4111-8111-111111111111', key = '22222222-2222-4222-8222-222222222222', scope = salon + ':' + key, token = 'a'.repeat(32);
function context() {
  const now = Date.now();
  return { schemaVersion: 1, context: { scope, workspaceId: key, salonId: salon, viewerId: null, permissionRevision: 'device-r1', authenticated: false }, displayAuthority: { kind: 'portable' }, display: { name: 'Device salon', language: 'en', role: 'portable' }, onlineValidatedAt: now,
    grant: { version: 1, scope, scopes: [scope], workspaceId: key, salonId: salon, viewerId: null, grantRevision: 'device-r1', generation: 'fixture-device-generation', issuedAt: now, expiresAt: now + 3600000, path: '/pos/portable', kind: 'portable' },
    portable: { scope, keyId: key, salonId: salon, salonName: 'Device salon', capabilities: ['portable.pos.use'], devicePrepared: true, offlineEnabled: true } };
}
function fixtureData() {
  const draft = { id: '33333333-3333-4333-8333-333333333333', salon_id: salon, token, version: 1, status: 'draft', customer: null, selected_staff_id: null, staff_lines: [], tip: 0, tax: 0, discount: 0, subtotal: 0, total: 0, total_before_tip: 0, customer_version: 0, receipt_version: 0, server_now: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null, reset_at: null };
  const settings = { appDownloadUrl: 'https://reylumi.com', customerBackgroundImageUrl: null, customerLeftAdImageUrl: null, customerLeftAdText: '', customerPromoBody: 'Thank you for choosing us today!', customerPromoTitle: 'Welcome back,', customerRightAdImageUrl: null, customerRightAdText: '', customerShowBarcode: true, customerShowCustomerName: true, customerShowReceiptStatus: true, customerShowSalonName: true, customerShowServiceName: true, customerShowStaffName: true, salonLogoUrl: null, salonName: 'Device salon', tipSuggestions: [5, 10, 15, 20] };
  return { 'portable.workspace': { salonId: salon, liveDraft: draft }, 'portable.customer-display-settings': { settings, serviceCatalog: [], draftId: draft.id } };
}
let compiled;
async function fixture({ path = '/pos/customer-display', hold = false, mismatch = false } = {}) {
  compiled ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{getAppLocalDisplayPage}from'./lib/app-local-display-registry';import{resetAppLocalResources}from'./lib/app-local-resource';import{createAppLocalDisplayHttpFetch}from'./lib/app-local-display-http-client';import{getAppLocalHost}from'./lib/app-local-host';window.calls=[];window.reads=[];window.cacheReads=[];window.releases=[];window.online=false;Object.defineProperty(navigator,'onLine',{get:()=>window.online});window.fetch=createAppLocalDisplayHttpFetch({scope:()=>window.fixture.context.context.scope,host:getAppLocalHost,fetch:async()=>new Response(null,{status:503})});function App(){const[context,setContext]=useState(window.fixture.context);window.changeContext=next=>{window.fixture.context=next;resetAppLocalResources();setContext(next)};const page=getAppLocalDisplayPage(window.fixture.path);window.registry=getAppLocalDisplayPage;return page?<page.Component context={context} path={window.fixture.path} navigate={()=>{}}/>:<p>No renderer</p>}createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'original-display-ui', setup(builder) {
    const stubs = {
      'next/navigation': `export{useRouter,usePathname,useSearchParams,useParams}from'./app/local-app/navigation';`,
      'next/link': `export{AppLocalLink as default,useLinkStatus}from'./app/local-app/navigation';`,
      'next/image': `export{AppLocalImage as default}from'./app/local-app/navigation';`,
      '@/components/workspace-language': `import{createElement}from'react';export const WorkspaceElement=({as,children,...props})=>createElement(as,props,children);export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>value=>value;`,
      '@/lib/pos-workspace-sync': 'export const usePosResourceRefresh=()=>{};',
      '@/lib/supabase/browser': 'export const createSupabaseBrowserClient=()=>null;',
      'app-local-host': `export const appLocalPath=path=>path;export const getAppLocalHost=()=>({isNative:true,cache:async(op,args)=>{window.cacheReads.push(args);if(window.fixture.hold)await new Promise(resolve=>window.releases.push(resolve));return args.scope===window.fixture.context.context.scope&&window.fixture.data[args.name]?{data:window.fixture.data[args.name],updatedAt:Date.now(),revision:'r1'}:null},read:async(name,args,options)=>{window.reads.push({name,args});if(name==='display.http.entry')return{scope:options.scope,data:{status:200,body:'{"entry":null}',headers:{'content-type':'application/json'}}};if(name==='display.http.settings')return{scope:options.scope,data:{status:200,body:JSON.stringify(window.fixture.data['portable.customer-display-settings'].settings),headers:{'content-type':'application/json'}}};return{schemaVersion:1,status:200,scope:options.scope,etag:'r2',updatedAt:Date.now(),data:structuredClone(window.fixture.data[name])}},openOnline:async path=>{window.openedOnline=path}});`,
      'app-local-data-policy': 'export const appLocalReadIsDurable=name=>name.startsWith("portable.");',
      'experience-persistent-cache': 'export const getExperienceOfflineGrant=()=>window.fixture.context?.grant;export const isExperienceSnapshotAuthorized=()=>true;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};',
    };
    builder.onResolve({ filter: /.*/ }, args => { const name = Object.keys(stubs).find(name => args.path === name || args.path.endsWith('/' + name)); return name ? { path: name, namespace: 'fixture' } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: process.cwd(), contents: stubs[args.path] }));
    builder.onLoad({ filter: /\.[jt]sx?$/ }, args => { if (args.path.includes('node_modules')) return; const source = readFileSync(args.path, 'utf8'); if (!/^\s*['"]use server['"]/.test(source)) return; const names = [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(match => match[1]); return { loader: 'js', contents: names.map(name => `export async function ${name}(...args){window.calls.push({name:${JSON.stringify(name)},args});if(${JSON.stringify(name)}==='getPosLiveDraft')return{ok:true,data:structuredClone(window.fixture.data['portable.workspace'].liveDraft)};if(${JSON.stringify(name)}==='getCustomerDisplayLiveDraftTipOptions')return{ok:true,data:[]};return{ok:false,error:'Fixture forbids business mutations'}}`).join('\n') }; });
  } }] });
  const data = fixtureData(); if (mismatch) data['portable.customer-display-settings'].draftId = 'different-draft';
  const seed = JSON.stringify({ context: context(), data, path, hold }).replaceAll('<', '\\u003c'), script = (await compiled).outputFiles[0].text;
  const server = createServer((req, res) => { if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script); } else { res.setHeader('Content-Type', 'text/html'); res.end('<style>html,body,#root{margin:0;min-height:100%;width:100%}[data-customer-display-attract]{height:850px;position:relative}[data-customer-display-attract] img{display:none}button{min-height:30px}[inert]{pointer-events:none}</style><div id="root"></div><script>window.fixture=' + seed + '</script><script src="/fixture.js"></script>'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] }), page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port + path);
  return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}

test('the original paired Display restores a scoped cached snapshot and keeps entered phone DOM during silent same-token refresh', { skip, timeout: 45000 }, async () => {
  const app = await fixture(); try {
    await app.page.locator('[data-local-customer-display][data-display-authority=portable] [data-customer-display-attract]').waitFor();
    await app.page.waitForFunction(() => !document.querySelector('[data-display-opening]'));
    await app.page.getByRole('button', { name: 'Customer display attract screen', exact: true }).click();
    for (const digit of ['7', '7', '3']) await app.page.getByRole('button', { name: 'Digit ' + digit, exact: true }).click();
    const phone = app.page.getByRole('textbox', { name: 'Phone', exact: true }); assert.match(await phone.inputValue(), /773/);
    assert.deepEqual(await app.page.evaluate(() => window.calls), []);
    await app.page.evaluate(() => { window.phoneNode = document.querySelector('[aria-label=Phone]'); window.fixture.data['portable.workspace'].liveDraft.version = 2; window.online = true; window.dispatchEvent(new Event('online')); });
    await app.page.waitForFunction(() => window.calls.some(row => row.name === 'getPosLiveDraft'));
    assert.equal(await app.page.evaluate(() => document.querySelector('[aria-label=Phone]') === window.phoneNode), true); assert.match(await phone.inputValue(), /773/);
    assert.equal(await app.page.evaluate(() => window.calls.filter(row => !['getPosLiveDraft', 'getCustomerDisplayLiveDraftTipOptions'].includes(row.name)).length), 0);
    await app.page.evaluate(() => { const next = structuredClone(window.fixture.context); next.context.scope = 'v3:' + 'b'.repeat(64); next.context.salonId = null; next.displayAuthority.kind = 'public'; next.grant = null; delete next.portable; window.changeContext(next); });
    await app.page.locator('[data-display-authority=public]').waitFor(); assert.equal(await phone.count(), 0); assert.equal(await app.page.evaluate(() => window.cacheReads.some(row => row.name === 'owner.customer-display')), false);
  } finally { await app.close(); }
});

test('early public attract frame is inert until both matching paired records finish, and mismatched drafts never become usable', { skip, timeout: 45000 }, async () => {
  const app = await fixture({ hold: true }); try {
    await app.page.locator('[data-display-opening=true]').waitFor(); assert.equal(await app.page.locator('[data-display-opening]').evaluate(node => node.inert), true);
    await app.page.keyboard.press('7'); assert.deepEqual(await app.page.evaluate(() => window.calls), []);
    await app.page.waitForFunction(() => window.releases.length === 2);
    await app.page.evaluate(() => { window.fixture.hold = false; window.releases.splice(0).forEach(resolve => resolve()); });
    await app.page.waitForFunction(() => !document.querySelector('[data-display-opening]'));
    await app.page.getByRole('button', { name: 'Customer display attract screen', exact: true }).click(); await app.page.getByRole('button', { name: 'Digit 7', exact: true }).click(); assert.match(await app.page.getByRole('textbox', { name: 'Phone', exact: true }).inputValue(), /7/);
  } finally { await app.close(); }
  const mismatch = await fixture({ mismatch: true }); try { await mismatch.page.waitForFunction(() => window.cacheReads.length === 2); assert.equal(await mismatch.page.locator('[data-display-opening]').evaluate(node => node.inert), true); assert.deepEqual(await mismatch.page.evaluate(() => window.calls), []); } finally { await mismatch.close(); }
});

test('Display setup retains explicit HTTPS PIN pairing and public capability URLs are never claimed as local renderers', { skip, timeout: 45000 }, async () => {
  const app = await fixture({ path: '/pos/customer-display/setup' }); try {
    await app.page.getByRole('img', { name: 'Reylumi', exact: true }).waitFor(); await app.page.getByRole('button', { name: 'Pair Display', exact: true }).click();
    assert.equal(await app.page.evaluate(() => window.openedOnline), '/pos/customer-display/setup'); assert.equal(await app.page.locator('input[type=password]').count(), 0);
    assert.equal(await app.page.evaluate(() => window.registry('/pos/customer-display?token=' + 'a'.repeat(32))), null); assert.equal(await app.page.evaluate(() => window.registry('/pos/customer-display/setup?passcode=secret')), null); assert.equal(await app.page.evaluate(() => window.registry('//foreign/pos/customer-display')), null); assert.deepEqual(await app.page.evaluate(() => window.calls), []);
  } finally { await app.close(); }
});
