import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const executablePath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', skip = !fs.existsSync(executablePath);
const scope = 'v3:' + 'a'.repeat(64), id = '00000000-0000-4000-8000-000000000001';
let compiled;
async function fixture(path, data) {
  compiled ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';import{getAppLocalOwnerPage}from'./lib/app-local-owner-page-registry';import{seedAppLocalResource}from'./lib/app-local-resource';
Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.fixture.actions=[];window.fixture.reads=[];window.fixture.online=[];window.deliver=(name,args,data)=>seedAppLocalResource(window.fixture.context.context.scope,name,args,{schemaVersion:1,status:200,scope:window.fixture.context.context.scope,etag:'new',updatedAt:Date.now()+1000,data});
function App(){const[path,setPath]=useState(window.fixture.path),[visited,setVisited]=useState([window.fixture.path]);window.navigate=href=>{history.pushState({},'',href);setVisited(x=>[...new Set([...x,href])]);setPath(href)};return visited.map(href=>{const page=getAppLocalOwnerPage(href);return page?<Activity key={href} mode={path===href?'visible':'hidden'}><page.Component context={window.fixture.context} path={href} navigate={window.navigate}/></Activity>:null})}createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'reviewed-local-fixture-only', setup(builder) {
    const modules = {
      'next/navigation': `export const useRouter=()=>({push:href=>window.navigate(href),replace:href=>window.navigate(href),refresh:()=>{},prefetch:()=>{}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({});`,
      'next/link': `import React from'react';export const useLinkStatus=()=>({pending:false});export default function Link({href,children,prefetch,replace,scroll,onNavigate,onClick,...props}){return <a {...props} href={href} onClick={event=>{onClick?.(event);if(event.defaultPrevented||event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();window.navigate(String(href))}}>{children}</a>}`,
      'next/image': `import React from'react';export default function Image({src,fill,priority,unoptimized,fetchPriority,quality,placeholder,blurDataURL,loader,...props}){return <img {...props} src={typeof src==='string'?src:src.src}/>}`,
      'next/form': `import React from'react';export default function Form({action,children,...props}){return <form {...props} action={typeof action==='function'?action:undefined} onSubmit={typeof action==='string'?e=>{e.preventDefault();window.navigate(action+'?'+new URLSearchParams(new FormData(e.currentTarget)))}:undefined}>{children}</form>}`,
      'next/dynamic': `import React,{lazy,Suspense}from'react';export default function dynamic(loader){const View=lazy(()=>loader().then(x=>({default:x.default??x})));return props=><Suspense fallback={null}><View {...props}/></Suspense>}`,
      'server-only': '',
      'experience-scope': `export const useExperienceScope=()=>({context:window.fixture.context.context});`,
      'app-local-host': `export function getAppLocalHost(){return{isNative:true,cache:async(operation,args)=>window.fixture.data[JSON.stringify([args.name,args.args])]??null,read:async(name,args)=>{window.fixture.reads.push({name,args});throw Error('Offline fixture')},openOnline:async path=>window.fixture.online.push(path)}}`,
      'experience-persistent-cache': `export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const isExperienceSnapshotContextAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};`,
    };
    builder.onResolve({ filter: /.*/ }, args => { const key = Object.keys(modules).find(key => args.path === key || args.path.endsWith('/' + key)); return key ? { path: key, namespace: 'fixture' } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', contents: modules[args.path], resolveDir: process.cwd() }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: 'export default {};' }));
    builder.onLoad({ filter: /\.[tj]sx?$/ }, args => { const source = fs.readFileSync(args.path, 'utf8'); if (!/^\s*['"]use server['"]/.test(source)) return; const names = [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(x => x[1]); return { loader: 'js', contents: names.map(name => `export async function ${name}(...args){window.fixture.actions.push({name:${JSON.stringify(name)},args});return{status:'idle',message:'',approved:false,revision:null}}`).join('\n') }; });
  } }] });
  const output = await compiled, context = { schemaVersion: 1, context: { scope, authenticated: true, viewerId: id, salonId: id, workspaceId: 'owner', permissionRevision: 'fixture' }, access: { ownerWorkspace: true, staffWorkspace: false }, display: { name: 'Fixture owner', language: 'en', role: 'owner' }, grant: null, onlineValidatedAt: Date.now() };
  const serialized = JSON.stringify({ path, context, data }).replaceAll('<', '\\u003c'), errors = [];
  const server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html'); response.end(request.url === '/bundle.js' ? output.outputFiles[0].text : `<div id="root"></div><script>window.fixture=${serialized}</script><script src="/bundle.js"></script>`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().method() === 'GET' && route.request().url().startsWith(`http://127.0.0.1:${server.address().port}/`) ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}${path}`);
    return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
  } catch (error) { await browser?.close(); await new Promise(resolve => server.close(resolve)); throw error; }
}
const snapshot = data => ({ data, revision: 'r1', updatedAt: Date.now() });
test('actual customer edit form keeps unsent values through silent update and Activity hide/reveal without writes', { skip, timeout: 40000 }, async () => {
  const path = `/customers/${id}/edit`, app = await fixture(path, {});
  try {
    await app.page.getByRole('heading', { name: 'Edit customer' }).waitFor();
    await app.page.evaluate(({ id }) => window.deliver('page.owner-customer-form', { customerId: id }, { canManageCustomers: true, customer: { id, name: 'Original fixture', status: 'active', notes: '', staff_notes: '', internal_notes: '' } }), { id });
    const field = app.page.locator('input[name=name]'); await field.fill('Unsent customer draft');
    await app.page.evaluate(({ id }) => { window.retainedCustomerInput = document.querySelector('input[name=name]'); window.deliver('page.owner-customer-form', { customerId: id }, { canManageCustomers: true, customer: { id, name: 'Fresh server fixture', status: 'active' } }); window.navigate('/customers'); }, { id });
    await app.page.getByRole('heading', { name: 'Customers' }).waitFor();
    await app.page.evaluate(path => window.navigate(path), path);
    await field.waitFor({ state: 'visible' }); assert.equal(await field.inputValue(), 'Unsent customer draft');
    assert.equal(await app.page.evaluate(() => document.querySelector('input[name=name]') === window.retainedCustomerInput), true);
    assert.deepEqual(await app.page.evaluate(() => window.fixture.actions), []);
  } finally { await app.close(); }
});
test('actual staff account reconfirmation remains explicit and its original portal hides with the retained route', { skip, timeout: 40000 }, async () => {
  const path = `/staff?staff=${id}`;
  const member = { id, display_name: 'Mai fixture', staff_profile_display_name: 'Mai fixture', first_name: 'Mai', last_name: '', email: 'mai@example.invalid', phone: '', is_active: true, online_booking_enabled: true, payroll_setup_status: 'configured', specialties: [], account_user_id: id, user_id: null, connected_user: { id, display_name: 'Mai fixture', email: 'mai@example.invalid', status: 'active' } };
  const data = { canViewStaff: true, canManageStaff: true, canManagePayroll: false, canBecomeStaff: false, directory: { staff: [member] }, bookingSetup: { readinessByStaffId: {}, permissions: {}, assignments: [], availabilityRules: [], services: [], staff: [], timeBlocks: [] }, connectionRequests: [], lookupResult: null, lookupError: null, offlineBinding: null, experienceScope: scope };
  const app = await fixture(path, { [JSON.stringify(['page.owner-staff', { staff: id }])]: snapshot(data) });
  try {
    const approval = app.page.locator('input[name=confirmed]'); await approval.waitFor({ state: 'visible' });
    assert.equal(await approval.isChecked(), false); assert.equal(await approval.getAttribute('required'), '');
    assert.equal(await app.page.locator('input[name=scope]').inputValue(), scope); assert.deepEqual(await app.page.evaluate(() => window.fixture.actions), []);
    await app.page.evaluate(() => window.navigate('/customers'));
    await approval.waitFor({ state: 'hidden' }); assert.equal(await app.page.getByRole('dialog').count(), 0);
    await app.page.evaluate(path => window.navigate(path), path);
    await approval.waitFor({ state: 'visible' }); assert.equal(await approval.isChecked(), false);
    assert.deepEqual(await app.page.evaluate(() => window.fixture.actions), []);
  } finally { await app.close(); }
});
