import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(executablePath);
let bundle;
async function fixture(path, data = {}, context = null) {
  bundle ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{getAppLocalBusinessPage as getAppLocalPage}from'./lib/app-local-business-registry';
import{resetAppLocalResources,seedAppLocalResource}from'./lib/app-local-resource';
window.fixture.reads=[];window.fixture.actions=[];window.fixture.onlineOpens=[];window.fixture.api=[];
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.fixture.online===true});
window.fetch=async(input,options)=>{window.fixture.api.push([input,options]);if(String(input).startsWith('/api/business-claims/matches?'))return Response.json({matches:window.fixture.matches??[],error:null});throw Error('Offline fixture forbids API access')};
window.resolvePage=path=>getAppLocalPage(path)?.id;window.pageIds=[];
window.seed=(name,args,data)=>seedAppLocalResource(window.fixture.context.context.scope,name,args,{schemaVersion:1,status:200,scope:window.fixture.context.context.scope,etag:'r2',updatedAt:Date.now()+1000,data});
function App(){const[props,setProps]=useState({path:window.fixture.path,context:window.fixture.context});window.navigate=path=>{history.pushState(null,'',path);setProps(value=>({...value,path}))};window.switchAccount=context=>{window.fixture.context=context;resetAppLocalResources();setProps(value=>({...value,context}))};const page=getAppLocalPage(props.path);return page?<page.Component {...props} navigate={window.navigate}/>:<p>No local renderer</p>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define:{'process.env.NEXT_PUBLIC_MAPTILER_KEY':'""'}, plugins: [{ name: 'local-runtime-fixture', setup(builder) {
    const modules = {
      'next/navigation': `export const useRouter=()=>({push:href=>window.navigate(href),replace:href=>window.navigate(href),refresh:()=>window.dispatchEvent(new Event('reylumi:app-local-command-complete')),prefetch:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({});`,
      'next/link': `import React from'react';export const useLinkStatus=()=>({pending:false});export default function Link({href,children,prefetch,replace,scroll,shallow,locale,legacyBehavior,passHref,onNavigate,onClick,...props}){return <a {...props} href={typeof href==='string'?href:href.pathname} onClick={event=>{onClick?.(event);if(event.defaultPrevented||event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||String(href).startsWith('#'))return;event.preventDefault();window.navigate(String(href))}}>{children}</a>}`,
      'next/image': `import React from'react';export default function Image({src,fill,priority,unoptimized,fetchPriority,quality,placeholder,blurDataURL,loader,...props}){return <img {...props} src={typeof src==='string'?src:src.src}/>}`,
      'next/form': `import React from'react';export default function Form({action,children,...props}){return <form {...props} action={typeof action==='function'?action:undefined} onSubmit={typeof action==='string'?event=>{event.preventDefault();const q=new URLSearchParams(new FormData(event.currentTarget));window.navigate(action+'?'+q)}:undefined}>{children}</form>}`,
      'next/dynamic':`import React from'react';export default function dynamic(){return()=>null}`,
      'server-only': '',
      'experience-scope': `export const useExperienceScope=()=>window.fixture.context?{context:window.fixture.context.context}:null;`,
      'app-local-host': `export function getAppLocalHost(){return{isNative:false,cache:async()=>null,read:async(name,args,options)=>{window.fixture.reads.push({name,args,options});throw Error('Offline')},openOnline:async path=>{window.fixture.onlineOpens.push(path)}}}`,
      'experience-persistent-cache': `export const getExperienceOfflineGrant=()=>window.fixture.context?.grant;export const isExperienceSnapshotAuthorized=scope=>scope===window.fixture.context?.context.scope;export const isExperienceSnapshotContextAuthorized=({scope})=>isExperienceSnapshotAuthorized(scope);export const EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT='reylumi:offline-authorization';export const readExperienceSnapshot=async({scope,domain,params})=>{if(!isExperienceSnapshotAuthorized(scope))return null;return window.fixture.data[JSON.stringify([scope,domain,params||{}])]??null};export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};`,
    };
    builder.onResolve({ filter: /.*/ }, args => { const key = Object.keys(modules).find(key => args.path === key || args.path.endsWith('/' + key)); return key ? { path: key, namespace: 'fixture' } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', contents: modules[args.path], resolveDir: process.cwd() }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: 'export default {};' }));
    builder.onLoad({ filter: /\.(tsx|ts)$/ }, args => {
      const content = readFileSync(args.path, 'utf8');
      if (!/^\s*['"]use server['"]/.test(content)) return;
      const names = [...content.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(match => match[1]);
      return { loader: 'js', contents: names.map(name => `export async function ${name}(...args){window.fixture.actions.push({name:${JSON.stringify(name)},args});return window.fixture.results?.[${JSON.stringify(name)}]??{}}`).join('\n') };
    });
  } }] });
  const output = await bundle, errors = [], seed = JSON.stringify({ path, context, data }).replaceAll('<', '\\u003c');
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(output.outputFiles[0].text); }
    else if (request.url?.startsWith('/api/')) { response.statusCode = 500; response.end('No live service'); }
    else { response.setHeader('Content-Type', 'text/html'); response.end(`<div id="root"></div><script>window.fixture=${seed}</script><script src="/bundle.js"></script>`); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${path}`);
  return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}
const context = (scope = 'scope-a', authenticated = true) => ({ schemaVersion: 1, context: { scope, viewerId: 'viewer-a', salonId: null, workspaceId: 'personal', permissionRevision: 'r1', authenticated }, grant: null, display: { name: 'Me', language: 'en', role: 'customer' }, onlineValidatedAt: Date.now() });
const saved = (scope, domain, args, data) => ({ [JSON.stringify([scope, domain, args])]: { data, revision: '"r1"', updatedAt: Date.now(), retainUntil: Date.now() + 60000 } });

test('full local POS settings retains the original group conflict workflow and does not resubmit on its own', { skip, timeout: 40000 }, async () => {
  const snapshot = { large_turn_threshold: 25, staff_check_in_enabled: true, tip_suggestions: [10, 15, 20], workspace_preferences: {} };
  const data = { canManageSettings: true, snapshot, settings: { largeTurnThreshold: 25, staffCheckInEnabled: true, tipSuggestions: [10, 15, 20], touchKeyboardEnabled: true }, portableAccessState: { keys: [], schemaReady: true, setupMessage: null }, desktopRelease: null };
  const app = await fixture('/pos/settings', saved('scope-a', 'owner-pos-settings', {}, data), context());
  try {
    await app.page.getByRole('heading', { name: 'POS settings', exact: true }).waitFor();
    const staffGroup = app.page.locator('details').filter({ has: app.page.locator('summary', { hasText: 'Staff & turns' }) });
    await staffGroup.locator('summary').click();
    const amount = staffGroup.locator('input[name=large_turn_threshold]'); await amount.fill('30');
    await app.page.evaluate(() => { fixture.online = true; fixture.results = { savePosSettingsGroup: { ok: false, error: 'These settings changed', conflict: { large_turn_threshold: 28, staff_check_in_enabled: true } } }; });
    await staffGroup.getByRole('button', { name: 'Save changes', exact: true }).click();
    await staffGroup.getByRole('region', { name: 'Settings changed' }).waitFor();
    assert.equal(await amount.inputValue(), '30');
    assert.equal(await app.page.evaluate(() => fixture.actions.filter(row => row.name === 'savePosSettingsGroup').length), 1);
    assert.equal(await app.page.evaluate(() => JSON.parse(fixture.actions.find(row => row.name === 'savePosSettingsGroup').args[0].get('expected')).large_turn_threshold), 25);
    await staffGroup.getByRole('button', { name: 'Keep my changes' }).click();
    assert.equal(await amount.inputValue(), '30');
    assert.equal(await app.page.evaluate(() => fixture.actions.length), 1);
    await app.page.evaluate(() => { fixture.results.savePosSettingsGroup = { ok: true, snapshot: { large_turn_threshold: 30, staff_check_in_enabled: true } }; });
    await staffGroup.getByRole('button', { name: 'Save changes', exact: true }).click();
    await app.page.waitForFunction(() => fixture.actions.length === 2);
    assert.equal(await app.page.evaluate(() => JSON.parse(fixture.actions[1].args[0].get('expected')).large_turn_threshold), 28);
    const display = app.page.locator('details').filter({ has: app.page.locator('summary', { hasText: 'Customer Display' }) }); await display.locator('summary').click();
    assert.equal(await display.getByRole('link', { name: 'Install App', exact: true }).getAttribute('href'), 'https://reylumi.com/pos/customer-display/setup');
    assert.equal(await display.getByRole('link', { name: 'Open Customer Display', exact: true }).getAttribute('href'), 'https://reylumi.com/pos/customer-display');
  } finally { await app.close(); }
});

test('a complete Create Salon draft has one stable request key through quiet reads and cannot restore another scope’s draft', { skip, timeout: 40000 }, async () => {
  const data = { salons: [], currentSalonId: null, hasCreatePermission: true, createRequestKey: '11111111-1111-4111-8111-111111111111', workspaceId: null };
  const dataB = { ...data, createRequestKey: '22222222-2222-4222-8222-222222222222' };
  const app = await fixture('/salons/new', { ...saved('scope-a', 'customer-salons', {}, data), ...saved('scope-b', 'customer-salons', {}, dataB) }, context());
  try {
    const name = app.page.locator('input[name=name]'); await name.waitFor();
    await name.fill('My unsent salon'); await app.page.locator('input[name=phone]').fill('5125550100');
    await app.page.waitForFunction(() => fixture.api.length > 0);
    assert.deepEqual(await app.page.evaluate(() => fixture.actions), []);
    await app.page.evaluate(next => { window.originalNameInput = document.querySelector('input[name=name]'); window.seed('customer.salons', {}, next); }, { ...data, createRequestKey: '33333333-3333-4333-8333-333333333333' });
    assert.equal(await name.inputValue(), 'My unsent salon');
    assert.equal(await app.page.locator('input[name=create_request_key]').inputValue(), data.createRequestKey);
    assert.equal(await app.page.evaluate(() => document.querySelector('input[name=name]') === originalNameInput), true);
    await app.page.evaluate(next => window.switchAccount(next), context('scope-b'));
    await app.page.waitForFunction(() => document.querySelector('input[name=create_request_key]')?.value === '22222222-2222-4222-8222-222222222222');
    assert.equal(await name.inputValue(), ''); assert.equal(await app.page.locator('input[name=phone]').inputValue(), '');
    assert.deepEqual(await app.page.evaluate(() => fixture.actions), []);
    await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:app-local-reset')));
    assert.equal(await app.page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('reylumi:salon-create:')).length), 0);
  } finally { await app.close(); }
});

test('the complete Salon Settings view includes operating, ownership, lifecycle and public-team sections without issuing writes', { skip, timeout: 40000 }, async () => {
  const status = { checkedAt: '2026-10-16T12:00:00Z', closesAtLocal: null, detail: null, isOpen: false, kind: 'hours_unset', label: 'Hours not set', localDate: '2026-10-16', nextOpensAtLocal: null, nextOpensLabel: null, reason: null, source: 'unset', timeZone: 'America/Chicago', tone: 'muted' };
  const data = { setting: { salon_id: 'salon-a', business_name: 'My full salon', public_discovery_enabled: false, allow_staff_applications: false }, lifecycle: { name: 'My full salon', status: 'active', lifecycleStatus: 'active', disabled_at: null, closed_at: null }, operatingSettings: { timeZone: 'America/Chicago', weeklyHours: [], specialHours: [], status }, discoveryReadiness: { canEnable: false, activeServiceCount:0, items:[], missingLabels: ['Business address'] }, mapLocation: { address: { formattedAddress: '' }, coordinates: null, providerMissingConfiguration: [], refreshEnabled: false, status: 'unavailable', statusLabel: 'Location unavailable', statusDescription: 'Add a business address.' }, staffDirectory: { staff: [] }, ownerRoster: null, closureReview: null, isOwner: false, canManageSettings: true, canViewStaff: true, canManageLifecycle: false, canManageOwnership: false, salonId: 'salon-a', workspaceLabel: 'Salon workspace' };
  const app = await fixture('/salon-settings', saved('scope-a', 'owner-salon-settings', {}, data), context());
  try {
    await app.page.getByRole('heading', { name: 'Salon settings', exact: true }).waitFor();
    for (const id of ['business-information', 'public-profile-discovery', 'operating-hours', 'ownership-admins', 'salon-status', 'public-team']) assert.equal(await app.page.locator('#' + id).count(), 1);
    const name = app.page.locator('input[name=business_name]'); await name.fill('Unsent renamed salon');
    await app.page.evaluate(next => window.seed('owner.salon-settings', {}, next), { ...data, setting: { ...data.setting, business_name: 'Fresh server salon' } });
    assert.equal(await name.inputValue(), 'Unsent renamed salon');
    assert.deepEqual(await app.page.evaluate(() => fixture.actions), []);
  } finally { await app.close(); }
});

