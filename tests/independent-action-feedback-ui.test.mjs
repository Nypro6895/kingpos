import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
let compiled;
async function bundle() {
  return compiled ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Activity,Suspense,useLayoutEffect,useMemo,useState}from'react';import{createRoot}from'react-dom/client';
    import{AppRouterContext}from'next/dist/shared/lib/app-router-context.shared-runtime';import{PathnameContext}from'next/dist/shared/lib/hooks-client-context.shared-runtime';
    import{UsersWorkspace}from'./app/(app)/admin/users/users-workspace';import{DashboardQuickActions}from'./app/(app)/admin/dashboard/dashboard-secondary';
    import{SalonMediaUploader}from'./app/salon-profile/salon-profile-studio';import{PLATFORM_ADMIN_PERMISSIONS as P}from'./types/platform-admin';
    window.routeCalls=[];window.deletes=[];window.uploadSessions=[];window.uploaded=[];window.removed=[];window.busy=[];
    window.finishDelete=(fail=false)=>{const row=window.deletes.find(row=>!row.done);if(!row)throw Error('No pending deletion');row.done=true;fail?row.reject(Error('Fixture unavailable')):row.resolve({});};
    const originalFetch=globalThis.fetch.bind(globalThis);window.fetch=(url,options)=>String(url).startsWith('/fixture-route')?originalFetch(url,options):Promise.reject(Error('Unexpected fixture request '+url));
    class FakeXHR{upload={};status=200;open(method,url){window.uploadUrl=url;}setRequestHeader(){}send(){queueMicrotask(()=>this.onload());}}window.XMLHttpRequest=FakeXHR;
    function resource(href){let state='pending';const promise=fetch('/fixture-route?href='+encodeURIComponent(href)).then(()=>{state='ready'});return{read(){if(state==='pending')throw promise}};}
    function Screen({route}){route.resource?.read();useLayoutEffect(()=>{history.replaceState({},'',route.href)},[route.href]);return <UsersWorkspace users={{items:[],total:0,page:1,page_size:25}} context={{permissions:[],userId:'fixture-admin'}} query={{q:'original'}} identityReady={false}/>}
    function UserScreen(){const[route,setRoute]=useState({href:'/admin/users',resource:null});const router=useMemo(()=>({push(href,options){window.routeCalls.push({href,options});setRoute({href,resource:resource(href)})},replace(){},refresh(){},prefetch(){},back(){},forward(){}}),[]);return <AppRouterContext.Provider value={router}><PathnameContext.Provider value='/admin/users'><Suspense fallback={<p>Loading route</p>}><Screen route={route}/></Suspense></PathnameContext.Provider></AppRouterContext.Provider>}
    function Media(){const[visible,setVisible]=useState(true),[salon,setSalon]=useState('salon-one');window.hide=()=>setVisible(false);window.show=()=>setVisible(true);window.changeSalon=()=>setSalon('salon-two');return <><p data-visible>{visible?'visible':'hidden'}</p><Activity mode={visible?'visible':'hidden'}><SalonMediaUploader expectedSalonId={salon} currentPath={null} currentUrl={null} kind='logo' intent='identity' label='Logo' onUploaded={value=>window.uploaded.push(value)} onRemoveExisting={()=>window.removed.push(true)} onUploadStateChange={value=>window.busy.push(value)}/></Activity></>}
    createRoot(document.getElementById('root')).render(location.pathname==='/media'?<Media/>:location.pathname==='/quick'?<DashboardQuickActions permissions={[P.usersRead]}/>:<UserScreen/>);window.booted=true;
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', alias: { '@': process.cwd() },
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'true' },
  banner: { js: 'var __webpack_require__=function(){throw Error("No server chunks in fixture")};__webpack_require__.u=function(){return "fixture"};var __webpack_chunk_load__=function(){throw Error("No server chunks")};' },
  plugins: [{ name: 'actual-components-only-local-actions', setup(builder) {
    builder.onResolve({ filter: /^next\/form$/ }, () => ({ path: path.resolve('node_modules/next/dist/client/app-dir/form.js') }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.resolve('node_modules/next/dist/client/app-dir/link.js') }));
    builder.onResolve({ filter: /^react-server-dom-webpack\/client$/ }, () => ({ path: path.resolve('node_modules/next/dist/compiled/react-server-dom-webpack/client.browser.js') }));
    builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:user-operation-form|user-drawer-content|entity-picker|notification-composer|overlay-dismissal|salon-profile-view)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onResolve({ filter: /salon-profile\/actions$|^\.\/workspace-actions$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: process.cwd(), contents:
      args.path === 'language' ? 'export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag,...props})=><Tag {...props}/>;export const useWorkspaceTranslation=()=>value=>value;' :
      args.path === 'css' ? 'export default new Proxy({},{get:(_,key)=>String(key)});' :
      args.path.endsWith('entity-picker') ? 'export const EntityPicker=({name,label,required,defaultValue})=><label>{label}<input name={name} required={required} defaultValue={defaultValue??""}/></label>;' :
      /actions$/.test(args.path) ? 'const unused=()=>{throw Error("Unexpected mutation")};export const bulkUserAccessAction=unused;export const createSalonProfileLookAction=unused,createSalonProfileUpdateAction=unused,deleteSalonProfileLookAction=unused,pinSalonProfileLookAction=unused,setSalonProfileLookStatusAction=unused,setSalonProfilePublicationAction=unused,updateSalonProfileIdentityAction=unused;export const deleteSalonProfileMediaAction=(...input)=>new Promise((resolve,reject)=>window.deletes.push({input,resolve,reject,done:false}));export const getSalonProfileMediaUploadSessionAction=(...input)=>{window.uploadSessions.push(input);return Promise.resolve({path:window.uploadSessions.length===1?"draft/logo.webp":"draft/logo-"+window.uploadSessions.length+".webp",accessToken:"fixture-only",anonKey:"fixture-only",bucket:"fixture",supabaseUrl:location.origin})};' :
      'export const UserOperationForm=({children})=><div>{children}</div>;export const UserReason=()=>null;export const UserDrawerContent=()=>null;export const userDate=value=>value;export const userName=value=>value.display_name??"User";export const NotificationComposer=()=>null;export const useCloseOnNavigation=()=>{};export const useOverlayPortalHost=()=>null;export const SalonProfileView=()=>null;' }));
  } }], });
}

async function fixture(screen) {
  const output = await bundle(), reads = [], navigations = [];
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(output.outputFiles[0].text); }
    else if (request.url.startsWith('/fixture-route')) reads.push({ request, response });
    else if (request.url.startsWith('/admin/users')) { navigations.push({ url: request.url, response }); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<style>[hidden]{display:none!important}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style><div id="root"></div><script src="/bundle.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(7000);
  const origin = `http://127.0.0.1:${server.address().port}`, errors = [];
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + screen);
  await page.waitForFunction(() => window.booted === true);
  return { page, errors, reads, navigations, async close() { for (const row of [...reads, ...navigations]) row.response.destroy(); await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD9sAAAAASUVORK5CYII=', 'base64');
async function upload(page, expectedPath = 'draft/logo.webp') {
  await page.locator('input[type=file]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'Upload', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.waitForFunction(expected => window.uploaded.at(-1) === expected, expectedPath);
}

test('rendered independent user search tracks actual Next transition and preserves every filter', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/users');
  try {
    await app.page.getByPlaceholder('Name, email, phone, ID').fill('retained user');
    await app.page.locator('select[name=status]').selectOption('active');
    await app.page.locator('select[name=role]').selectOption('staff');
    await app.page.getByLabel('Business', { exact: true }).fill('business-one');
    await app.page.getByRole('button', { name: 'Apply', exact: true }).click();
    await app.page.getByRole('button', { name: 'Applying…', exact: true }).waitFor();
    assert.equal(await app.page.getByRole('button', { name: 'Applying…' }).isDisabled(), true);
    await app.page.waitForFunction(() => window.routeCalls.length === 1);
    const url = new URL(await app.page.evaluate(() => window.routeCalls[0].href));
    assert.equal(url.pathname, '/admin/users');
    assert.deepEqual(Object.fromEntries(url.searchParams), { q: 'retained user', status: 'active', role: 'staff', businessId: 'business-one', sort: 'created_desc', pageSize: '25' });
    while (!app.reads.length) await new Promise(resolve => setImmediate(resolve));
    app.reads[0].response.end('{}');
    await app.page.getByRole('button', { name: 'Apply', exact: true }).waitFor();
    assert.equal(await app.page.getByPlaceholder('Name, email, phone, ID').inputValue(), 'retained user');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('rendered dashboard native search sets pending and preserves the exact native GET payload', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/quick');
  try {
    await app.page.getByRole('button', { name: 'Find user', exact: true }).click();
    await app.page.getByPlaceholder('Name, email, or phone…').fill('Alice Example');
    // Observe the real bubbling submit after React's handler, keeping this
    // component fixture on-page rather than loading a production admin route.
    await app.page.evaluate(() => document.addEventListener('submit', event => {
      window.nativeSubmission = { action: event.target.action, method: event.target.method, fields: [...new FormData(event.target, event.submitter)] };
      event.preventDefault();
    }));
    await app.page.getByRole('button', { name: 'Find user', exact: true }).last().click();
    await app.page.getByRole('button', { name: 'Searching…', exact: true }).waitFor();
    const submission = await app.page.evaluate(() => window.nativeSubmission);
    assert.equal(new URL(submission.action).pathname, '/admin/users');
    assert.equal(submission.method, 'get');
    assert.deepEqual(submission.fields, [['q', 'Alice Example']]);
    assert.equal(await app.page.evaluate(() => document.querySelector('#dashboard-find-user').getAttribute('aria-busy')), 'true');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('media removal visibly holds one request and preserves best-effort cleanup semantics on failure', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/media');
  try {
    await upload(app.page);
    await app.page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(node => node.textContent === 'Remove'); button.click(); button.click(); });
    await app.page.getByRole('button', { name: 'Removing…', exact: true }).waitFor();
    assert.equal(await app.page.getByRole('button', { name: 'Removing…' }).isDisabled(), true);
    assert.equal(await app.page.evaluate(() => window.deletes.length), 1);
    assert.deepEqual(await app.page.evaluate(() => window.deletes[0].input), ['draft/logo.webp', 'salon-one']);
    assert.equal(await app.page.evaluate(() => window.uploaded.at(-1)), 'draft/logo.webp', 'draft is kept until cleanup settles');
    await app.page.evaluate(() => window.finishDelete(true));
    await app.page.getByText('The uploaded file could not be deleted. You can continue editing.').waitFor();
    assert.equal(await app.page.evaluate(() => window.uploaded.at(-1)), null, 'existing best-effort cleanup still clears only this draft selection');
    assert.equal(await app.page.evaluate(() => window.removed.length), 0, 'no new current-media deletion callback');
    assert.equal(await app.page.evaluate(() => window.deletes.length), 1, 'no automatic retry');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('successful media deletion while hidden reconciles the same retained draft exactly once on reveal', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/media');
  try {
    await upload(app.page);
    await app.page.getByRole('button', { name: 'Remove', exact: true }).click();
    await app.page.getByRole('button', { name: 'Removing…', exact: true }).waitFor();
    await app.page.evaluate(() => window.hide());
    await app.page.locator('[data-visible]').filter({ hasText: 'hidden' }).waitFor();
    const count = await app.page.evaluate(() => window.uploaded.length);
    await app.page.evaluate(() => window.finishDelete());
    assert.equal(await app.page.evaluate(() => window.uploaded.length), count, 'hidden completion waits for the matching editing view');
    await app.page.evaluate(() => window.show());
    await app.page.waitForFunction(() => window.uploaded.at(-1) === null);
    assert.equal(await app.page.evaluate(() => window.uploaded.length), count + 1);
    assert.equal(await app.page.getByRole('button', { name: 'Remove', exact: true }).count(), 0, 'deleted path cannot remain in the selectable draft');
    await app.page.evaluate(() => window.hide());
    await app.page.locator('[data-visible]').filter({ hasText: 'hidden' }).waitFor();
    await app.page.evaluate(() => window.show());
    await app.page.locator('[data-visible]').filter({ hasText: 'visible' }).waitFor();
    assert.equal(await app.page.evaluate(() => window.uploaded.length), count + 1, 'reveal never replays the completion callback');
    assert.equal(await app.page.evaluate(() => window.deletes.length), 1, 'reveal never replays the delete');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('media deletion stays pending across hide/reveal until the original operation finishes', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/media');
  try {
    await upload(app.page);
    await app.page.getByRole('button', { name: 'Remove', exact: true }).click();
    await app.page.getByRole('button', { name: 'Removing…', exact: true }).waitFor();
    await app.page.evaluate(() => window.hide());
    await app.page.locator('[data-visible]').filter({ hasText: 'hidden' }).waitFor();
    await app.page.evaluate(() => window.show());
    await app.page.getByRole('button', { name: 'Removing…', exact: true }).waitFor();
    assert.equal(await app.page.locator('input[type=file]').isDisabled(), true);
    assert.equal(await app.page.evaluate(() => window.deletes.length), 1);
    await app.page.evaluate(() => window.finishDelete());
    await app.page.waitForFunction(() => window.uploaded.at(-1) === null);
    assert.equal(await app.page.locator('input[type=file]').isDisabled(), false);
    assert.equal(await app.page.evaluate(() => window.deletes.length), 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('obsolete media deletion cannot clear a new salon or its newly uploaded image', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/media');
  try {
    await upload(app.page);
    await app.page.getByRole('button', { name: 'Remove', exact: true }).click();
    await app.page.getByRole('button', { name: 'Removing…', exact: true }).waitFor();
    await app.page.evaluate(() => window.changeSalon());
    await app.page.getByRole('button', { name: 'Remove', exact: true }).waitFor();
    await upload(app.page, 'draft/logo-2.webp');
    const count = await app.page.evaluate(() => window.uploaded.length);
    await app.page.evaluate(() => window.finishDelete());
    assert.equal(await app.page.evaluate(() => window.uploaded.length), count);
    assert.equal(await app.page.evaluate(() => window.uploaded.at(-1)), 'draft/logo-2.webp');
    await app.page.getByRole('button', { name: 'Remove', exact: true }).click();
    await app.page.getByRole('button', { name: 'Removing…', exact: true }).waitFor();
    assert.deepEqual(await app.page.evaluate(() => window.deletes[1].input), ['draft/logo-2.webp', 'salon-two']);
    await app.page.evaluate(() => window.finishDelete());
    await app.page.waitForFunction(() => window.uploaded.at(-1) === null);
    assert.equal(await app.page.evaluate(() => window.deletes.length), 2);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('independent form migration preserves permission, dirty-draft guard, client action and GET fields', () => {
  const users = readFileSync('app/(app)/admin/users/users-workspace.tsx', 'utf8');
  assert.match(users, /<FeedbackSearchForm action="\/admin\/users"[^>]+onSubmit=\{e=>\{if\(!guard\(\)\)e.preventDefault\(\);\}\}/);
  const quick = readFileSync('app/(app)/admin/dashboard/dashboard-secondary.tsx', 'utf8');
  assert.match(quick, /can\(P.usersRead\)[\s\S]*?<NavigationForm id="dashboard-find-user" action="\/admin\/users"/);
  assert.match(quick, /action=\{form => \{ const id = String\(form.get\("user_id"\) \|\| ""\); if \(\/\^\[0-9a-f-\]\{36\}\$\/i.test\(id\)\) window.location.assign\(`\/admin\/users\/\$\{id\}`\); \}\}/);
  const queue = readFileSync('app/(app)/admin/dashboard/dashboard-workspace.tsx', 'utf8');
  assert.match(queue, /<NavigationForm action="\/admin"/);
  for (const name of ['view', 'kind', 'sort', 'pageSize', 'q']) assert.ok(queue.includes(`name="${name}"`));
  const tax = readFileSync('app/(app)/admin/market/tax/tax-workspace.tsx', 'utf8');
  assert.match(tax, /<NavigationForm method="get" action="\/admin\/market\/tax"/);
  assert.match(tax, /name="view" value="ledger"/);
  assert.match(tax, /name="from" value=\{from\}/); assert.match(tax, /name="to" value=\{to\}/);
});
