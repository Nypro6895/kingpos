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
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{getAppLocalPage,APP_LOCAL_PAGE_IDS}from'./lib/app-local-page-registry';
import{resetAppLocalResources,seedAppLocalResource}from'./lib/app-local-resource';
window.fixture.reads=[];window.fixture.actions=[];window.fixture.onlineOpens=[];window.fixture.api=[];
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
window.fetch=async(...args)=>{window.fixture.api.push(args);throw Error('Offline fixture forbids API access')};
window.resolvePage=path=>getAppLocalPage(path)?.id;window.pageIds=APP_LOCAL_PAGE_IDS;
window.seed=(name,args,data)=>seedAppLocalResource(window.fixture.context.context.scope,name,args,{schemaVersion:1,status:200,scope:window.fixture.context.context.scope,etag:'r2',updatedAt:Date.now()+1000,data});
function App(){const[props,setProps]=useState({path:window.fixture.path,context:window.fixture.context});window.navigate=path=>{history.pushState(null,'',path);setProps(value=>({...value,path}))};window.switchAccount=context=>{resetAppLocalResources();setProps(value=>({...value,context}))};const page=getAppLocalPage(props.path);return page?<page.Component {...props} navigate={window.navigate}/>:<p>No local renderer</p>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'local-runtime-fixture', setup(builder) {
    const modules = {
      'next/navigation': `export const useRouter=()=>({push:href=>window.navigate(href),replace:href=>window.navigate(href),refresh:()=>window.dispatchEvent(new Event('reylumi:app-local-command-complete')),prefetch:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({});`,
      'next/link': `import React from'react';export const useLinkStatus=()=>({pending:false});export default function Link({href,children,prefetch,replace,scroll,shallow,locale,legacyBehavior,passHref,onNavigate,onClick,...props}){return <a {...props} href={typeof href==='string'?href:href.pathname} onClick={event=>{onClick?.(event);if(event.defaultPrevented||event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||String(href).startsWith('#'))return;event.preventDefault();window.navigate(String(href))}}>{children}</a>}`,
      'next/image': `import React from'react';export default function Image({src,fill,priority,unoptimized,fetchPriority,quality,placeholder,blurDataURL,loader,...props}){return <img {...props} src={typeof src==='string'?src:src.src}/>}`,
      'next/form': `import React from'react';export default function Form({action,children,...props}){return <form {...props} action={typeof action==='function'?action:undefined} onSubmit={typeof action==='string'?event=>{event.preventDefault();const q=new URLSearchParams(new FormData(event.currentTarget));window.navigate(action+'?'+q)}:undefined}>{children}</form>}`,
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

test('the real Market catalog and Help render locally while unavailable server reads cannot block search', { skip, timeout: 40000 }, async () => {
  const app = await fixture('/market', {}, context('guest', false));
  try {
    await app.page.getByRole('textbox', { name: 'Search features' }).waitFor();
    await app.page.getByRole('textbox', { name: 'Search features' }).fill('nonexistentfeaturexyz');
    assert.equal(await app.page.getByRole('textbox', { name: 'Search features' }).inputValue(), 'nonexistentfeaturexyz');
    assert.deepEqual(await app.page.evaluate(() => fixture.reads), []);
    assert.deepEqual(await app.page.evaluate(() => fixture.actions), []);
    await app.page.evaluate(() => window.navigate('/help?lang=en'));
    await app.page.getByRole('heading', { name: 'Reylumi Help' }).waitFor();
    assert.equal(await app.page.evaluate(() => resolvePage('/staff')), undefined);
    for (const path of ['/market?payment=received', '/login?token=secret', 'https://foreign.example/activity', '/support/token/secret']) assert.equal(await app.page.evaluate(path => resolvePage(path), path), undefined);
  } finally { await app.close(); }
});

test('the full cached customer booking list preserves real services/status/detail controls and disappears on account change', { skip, timeout: 40000 }, async () => {
  const booking = { id: '11111111-1111-4111-8111-111111111111', salon_id: 'salon-a', start_at: '2026-11-01T15:00:00Z', end_at: '2026-11-01T16:00:00Z', salon_timezone_snapshot: 'America/Chicago', status: 'confirmed', no_show_kind: null, lines: [{ id: 'line-a', line_type: 'service', service_name_snapshot: 'Manicure and care', line_total: 35, quantity: 1 }], salon: { name: 'My real salon', displayName: 'My real salon', address_line1: '123 Main', city: 'Austin', state: 'TX' } };
  const app = await fixture('/my-bookings', saved('scope-a', 'customer-bookings', {}, { tab: 'upcoming', bookings: [booking], details: null, historyRows: null }), context());
  try {
    await app.page.getByText('Manicure and care', { exact: true }).waitFor();
    await app.page.getByRole('button', { name: 'Details', exact: true }).waitFor();
    assert.ok((await app.page.locator('main').innerText()).includes('My real salon'));
    assert.ok((await app.page.locator('main').innerText()).includes('$35.00'));
    assert.deepEqual(await app.page.evaluate(() => fixture.actions), []);
    await app.page.evaluate(next => window.switchAccount(next), context('scope-b', false));
    await app.page.getByText('Sign in to view your account.').waitFor();
    assert.equal(await app.page.getByText('My real salon', { exact: true }).count(), 0);
  } finally { await app.close(); }
});

test('trusted staff cache opens the actual workday summary offline without resolving identity or replaying workday commands', { skip, timeout: 40000 }, async () => {
  const ctx = context('staff-a'), staffId = '11111111-1111-4111-8111-111111111111';
  ctx.context.salonId = 'salon-a'; ctx.grant = { kind: 'staff', scopes: ['staff-a'], salonId: 'salon-a', staffBinding: { staffId, viewerId: 'viewer-a', salonId: 'salon-a' } };
  const data = { kind: 'workday', staffId, salonId: 'salon-a', result: { today: '2026-10-16', salonName: 'My work salon', activity: { assignedServiceAmount: 68, assignedServices: 2, completedServices: 1 }, workday: { id: 'day-a', status: 'working', checkInAt: '2026-10-16T13:00:00Z', checkOutAt: null } } };
  const app = await fixture('/staff/workday', saved('staff-a', 'staff-workday', { staffId }, data), ctx);
  try {
    await app.page.getByRole('heading', { name: 'Today Summary' }).waitFor();
    assert.ok((await app.page.locator('main').innerText()).includes('$68.00'));
    await app.page.getByRole('button', { name: 'Take Break', exact: true }).waitFor();
    assert.deepEqual(await app.page.evaluate(() => fixture.reads), []);
    assert.deepEqual(await app.page.evaluate(() => fixture.actions), []);
    await app.page.evaluate(() => window.navigate('/help?lang=en'));
    await app.page.getByRole('heading', { name: 'Reylumi Help' }).waitFor();
    await app.page.evaluate(() => window.navigate('/staff/workday'));
    await app.page.getByRole('heading', { name: 'Today Summary' }).waitFor();
    assert.deepEqual(await app.page.evaluate(() => fixture.actions), []);
  } finally { await app.close(); }
});

test('full Settings navigation uses its real cached account index and keeps security data out of the retained page props', { skip, timeout: 40000 }, async () => {
  const data = { user: { id: 'viewer-a', display_name: 'Me', created_at: '2026-01-01T00:00:00Z', language: 'en', timezone: 'America/Chicago' }, createdAtLabel: '1/1/2026', index: { managed: [], staff: [], accounts: [], hasBusinessWorkspace: false } };
  const app = await fixture('/settings?section=legal-policies', saved('scope-a', 'customer-settings', {}, data), context());
  try {
    await app.page.getByRole('heading', { name: 'All Settings' }).waitFor();
    await app.page.getByRole('navigation', { name: 'Legal policies' }).waitFor();
    const input = app.page.getByRole('searchbox'); await input.fill('notifications');
    assert.equal(await input.inputValue(), 'notifications');
    assert.equal(await app.page.locator('input[type=password]').count(), 0);
    assert.deepEqual(await app.page.evaluate(() => fixture.actions), []);
    assert.deepEqual(await app.page.evaluate(() => fixture.api), []);
  } finally { await app.close(); }
});

test('the actual Support form and private inbox retain an in-progress message across a silent read update and hide on logout', { skip, timeout: 40000 }, async () => {
  const data = { cases: [{ id: '33333333-3333-4333-8333-333333333333', reference: 'R1', summary: 'My authorized support case', status: 'open', updated_at: '2026-10-16T00:00:00Z' }] };
  const seeds = { ...saved('scope-a', 'page-support', {}, data), ...saved('scope-a', 'customer-support', {}, data) };
  const app = await fixture('/support', seeds, context());
  try {
    await app.page.getByRole('link', { name: /My authorized support case/ }).waitFor();
    await app.page.locator('input[name=summary]').fill('My draft question');
    await app.page.locator('textarea[name=message]').fill('Please preserve this unsent message.');
    await app.page.evaluate(() => { window.retainedSupportInput = document.querySelector('textarea[name=message]'); window.seed('page.support', {}, { cases: [] }); });
    await app.page.getByText('Your requests and replies will appear here.').waitFor();
    assert.equal(await app.page.locator('textarea[name=message]').inputValue(), 'Please preserve this unsent message.');
    assert.equal(await app.page.evaluate(() => document.querySelector('textarea[name=message]') === window.retainedSupportInput), true);
    assert.deepEqual(await app.page.evaluate(() => fixture.actions), []);
    await app.page.evaluate(next => window.switchAccount(next), context('signed-out', false));
    await app.page.getByRole('heading', { name: 'Account access' }).waitFor();
    assert.equal(await app.page.locator('textarea[name=message]').count(), 0);
  } finally { await app.close(); }
});
