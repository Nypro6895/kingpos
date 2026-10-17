import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
let bundled;
function bundle() {
  return bundled ??= build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React,{Activity,Suspense,useState,useMemo,useLayoutEffect}from'react';import{createRoot}from'react-dom/client';
      import{AppRouterContext}from'next/dist/shared/lib/app-router-context.shared-runtime';import{PathnameContext}from'next/dist/shared/lib/hooks-client-context.shared-runtime';
      import{FeedbackSearchForm,SearchSubmitButton}from'./components/feedback-search-form';import{OwnerWorkspaceFrame}from'./app/pos/owner-workspace-frame';
      import{CopyInviteLinkButton}from'./app/staff/copy-invite-link-button';import{ExploreSocialProvider,useSalonSocial}from'./components/explore-social';
      window.routeCalls=[];window.copyCalls=[];window.preferences=[];window.path=location.pathname;window.documentBoots=(window.documentBoots??0)+1;
      function deferred(list,input){return new Promise((resolve,reject)=>list.push({input,resolve,reject,done:false}));}
      window.finish=(list,value,fail=false)=>{const row=window[list].find(row=>!row.done);if(!row)throw Error('No pending '+list);row.done=true;fail?row.reject(Error(value)):row.resolve(value);};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>deferred(window.copyCalls,value)}});
      const nativeFetch=window.fetch.bind(window);window.fetch=(url,options)=>String(url).startsWith('/api/explore/salon-social')?Promise.resolve(new Response(JSON.stringify({states:{'11111111-1111-4111-8111-111111111111':{hidden:false,loved:false,saved:false,following:false}}}),{headers:{'Content-Type':'application/json'}})):nativeFetch(url,options);
      function resource(href){let state='pending',error;const promise=fetch('/fixture-route?href='+encodeURIComponent(href)).then(response=>{if(!response.ok)throw Error('Route unavailable');return response.json()}).then(()=>{state='ready'},value=>{state='error';error=value});return{read(){if(state==='pending')throw promise;if(state==='error')throw error}};}
      function Checkout(){const[amount,setAmount]=useState('125.75');return <input aria-label='Retained money draft' value={amount} onChange={event=>setAmount(event.target.value)}/>}
      function Filters(){return <FeedbackSearchForm id='search-form' action='/pos-tickets?ignored=old#kept' actionByPath={{prefix:'/pos/ticket',action:'/pos/ticket'}} replace scroll={false} prefetch={false} ref={node=>window.formNode=node}>
        <input name='date' type='hidden' value='2026-10-15'/><input aria-label='Search query' name='q' defaultValue='keep draft'/><input name='tag' type='hidden' value='first'/><input name='tag' type='hidden' value='second'/>
        <SearchSubmitButton id='search-submit' name='intent' value='filter' pendingLabel='Searching…'>Search</SearchSubmitButton>
        <SearchSubmitButton id='alternate-submit' name='intent' value='alternate' formAction='/alternate?discard=1#anchor'>Alternate</SearchSubmitButton>
        <button id='native-submit' formTarget='native-frame' name='intent' value='native'>Native target</button>
        <button id='post-submit' formMethod='post' formTarget='native-frame' name='intent' value='post'>Native post</button>
        <button id='client-action' formAction={async data=>{window.clientAction=Object.fromEntries(data)}} name='intent' value='client'>Client action</button>
      </FeedbackSearchForm>}
      function RouterView({route}){route.resource?.read();useLayoutEffect(()=>{history.replaceState({},'',route.href)},[route.href]);return <PathnameContext.Provider value={new URL(route.href,location.href).pathname}><OwnerWorkspaceFrame checkout={<Checkout/>}><Filters/><p data-route-ready>{route.href}</p></OwnerWorkspaceFrame><iframe name='native-frame' title='Native fallback'/><FeedbackSearchForm id='cancelled' action='/cancelled' prefetch={false} onSubmit={event=>event.preventDefault()}><SearchSubmitButton>Cancelled search</SearchSubmitButton></FeedbackSearchForm></PathnameContext.Provider>}
      function Routed(){const[route,setRoute]=useState({href:location.pathname,resource:null});const router=useMemo(()=>{const navigate=(method,href,options)=>{window.routeCalls.push({method,href,options});if(window.throwRoute)throw Error('Fixture router failure');setRoute({href,resource:window.fastRoute?null:resource(href)})};return{push:(href,options)=>navigate('push',href,options),replace:(href,options)=>navigate('replace',href,options),refresh(){},prefetch(){},back(){},forward(){}}},[]);return <AppRouterContext.Provider value={router}><Suspense fallback={<p>Initial route loading</p>}><RouterView route={route}/></Suspense></AppRouterContext.Provider>}
      function SocialProbe(){const social=useSalonSocial('11111111-1111-4111-8111-111111111111');return <button onClick={()=>void social.change('11111111-1111-4111-8111-111111111111','hidden',true)}>Hide salon</button>}
      function App(){const[visible,setVisible]=useState(true);window.hide=()=>setVisible(false);window.show=()=>setVisible(true);return <><p data-visible>{visible?'visible':'hidden'}</p><Activity mode={visible?'visible':'hidden'}>{window.path==='/clipboard'?<CopyInviteLinkButton value='/staff/invite/fixture'/>:window.path==='/social'?<ExploreSocialProvider viewerId='fixture-viewer'><SocialProbe/></ExploreSocialProvider>:<Routed/>}</Activity></>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', platform: 'browser', alias: { '@': process.cwd() },
    banner: { js: 'var __webpack_require__=function(){throw Error("Fixture cannot load server chunks")};__webpack_require__.u=function(){return "fixture-chunk"};var __webpack_chunk_load__=function(){throw Error("Fixture cannot load server chunks")};' },
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'true' },
    plugins: [{ name: 'actual-next-form-public-router-fixture', setup(builder) {
      builder.onResolve({ filter: /^next\/form$/ }, () => ({ path: path.resolve('node_modules/next/dist/client/app-dir/form.js') }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: path.resolve('node_modules/next/dist/client/app-dir/link.js') }));
      builder.onResolve({ filter: /^react-server-dom-webpack\/client$/ }, () => ({ path: path.resolve('node_modules/next/dist/compiled/react-server-dom-webpack/client.browser.js') }));
      builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:role-more-content|auth-intent-prompt|explore-account-actions|post-actions|save-post-button)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /social-actions$/ }, () => ({ path: 'preference-action', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: process.cwd(), contents:
        args.path === 'language' ? 'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>value=>value;' :
        args.path === 'css' ? 'export default new Proxy({},{get:(_,key)=>String(key)});' :
        args.path === 'preference-action' ? 'export const setExploreSalonPreferenceAction=(...input)=>new Promise((resolve,reject)=>window.preferences.push({input,resolve,reject,done:false}));' :
        'export const RoleMoreContent=()=>null;export const AuthIntentPrompt=()=>null;export const ExploreBookButton=()=>null;export const PostActions=()=>null;export const SavePostButton=()=>null;' }));
    } }],
  });
}
async function fixture(screen) {
  const compiled = await bundle(), reads = [], documents = [], native = [];
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(compiled.outputFiles[0].text); }
    else if (request.url.startsWith('/fixture-route')) { reads.push({ request, response }); }
    else if (request.headers['sec-fetch-dest'] === 'iframe') { let body = ''; request.on('data', value => { body += value; }); request.on('end', () => { native.push({ method: request.method, url: request.url, body }); response.end('<p>Native fallback received</p>'); }); }
    else { documents.push(request.url); response.setHeader('Content-Type', 'text/html'); response.end('<style>.fixed{position:fixed}.top-0{top:0}.inset-x-0{left:0;right:0}.block{display:block}.h-1{height:4px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}[hidden]{display:none!important}</style><div id="root"></div><script src="/bundle.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(7000);
  // Exercise Next's supported no-IntersectionObserver branch without altering
  // any Next module, router function, scheduler, or navigation implementation.
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + screen);
  try { await page.waitForFunction(() => window.documentBoots === 1, { timeout: 3000 }); }
  catch (error) { await browser.close(); await new Promise(resolve => server.close(resolve)); throw new Error('Fixture bootstrap failed: ' + errors.join('; '), { cause: error }); }
  return { page, errors, reads, documents, native, release() { const read = reads.find(read => !read.finished); assert.ok(read); read.finished = true; read.response.setHeader('Content-Type', 'application/json'); read.response.end('{}'); }, async close() { for (const read of reads) if (!read.finished) read.response.destroy(); await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('actual Next Form cooperates with persistent OwnerFrame, retains draft, and tracks the real route transition', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/pos/ticket');
  try {
    const { page } = app;
    await page.locator('#search-form').waitFor();
    assert.equal(await page.locator('#search-form').getAttribute('action'), '/pos/ticket', 'canonical action avoids the legacy frame capture');
    await page.getByLabel('Search query').fill('retained query');
    await page.evaluate(() => { window.cartInput = document.querySelector('[aria-label="Retained money draft"]'); document.querySelector('#search-form').requestSubmit(document.querySelector('#search-submit')); document.querySelector('#search-form').requestSubmit(document.querySelector('#search-submit')); });
    await page.locator('#search-submit').filter({ hasText: 'Searching…' }).waitFor();
    assert.equal(await page.locator('#search-submit').isDisabled(), true);
    assert.equal(await page.locator('#search-form').getAttribute('aria-busy'), 'true');
    assert.equal(await page.evaluate(() => window.routeCalls.length), 1, 'synchronous guard blocks a duplicate before React paints');
    const call = await page.evaluate(() => window.routeCalls[0]);
    const url = new URL(call.href);
    assert.equal(url.pathname, '/pos/ticket');
    assert.deepEqual([...url.searchParams], [['date', '2026-10-15'], ['q', 'retained query'], ['tag', 'first'], ['tag', 'second'], ['intent', 'filter']]);
    assert.equal(call.method, 'replace'); assert.deepEqual(call.options, { scroll: false });
    while (!app.reads.length) await new Promise(resolve => setImmediate(resolve));
    app.release();
    await page.getByRole('button', { name: 'Search', exact: true }).waitFor();
    assert.equal(await page.locator('#search-form').getAttribute('aria-busy'), 'false');
    assert.equal(await page.getByLabel('Search query').inputValue(), 'retained query');
    assert.equal(await page.evaluate(() => window.cartInput === document.querySelector('[aria-label="Retained money draft"]') && window.cartInput.value === '125.75'), true);
    assert.equal(app.documents.length, 1, 'soft navigation never reloads the document');
    await page.evaluate(() => { window.fastRoute = true; document.querySelector('#search-form').requestSubmit(document.querySelector('#search-submit')); });
    await page.waitForFunction(() => window.routeCalls.length === 2 && document.querySelector('#search-form').getAttribute('aria-busy') === 'false');
    await page.locator('#search-submit').click();
    await page.waitForFunction(() => window.routeCalls.length === 3 && document.querySelector('#search-form').getAttribute('aria-busy') === 'false');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('actual Next Form preserves overrides, cancellation, client actions and unsupported native submissions', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/pos/ticket');
  try {
    const { page } = app;
    await page.locator('#search-form').waitFor();
    await page.getByRole('button', { name: 'Cancelled search', exact: true }).click();
    assert.equal(await page.evaluate(() => window.routeCalls.length), 0);
    await page.locator('#native-submit').click();
    await page.frameLocator('iframe').getByText('Native fallback received').waitFor();
    assert.equal(await page.evaluate(() => window.routeCalls.length), 0);
    assert.equal(new URL(app.native[0].url, 'http://fixture.invalid').searchParams.get('intent'), 'native');
    await page.locator('#post-submit').click();
    await page.waitForFunction(() => document.querySelector('#search-form').getAttribute('aria-busy') !== 'true');
    while (app.native.length < 2) await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.native[1].method, 'POST'); assert.equal(new URLSearchParams(app.native[1].body).get('intent'), 'post');
    await page.locator('#client-action').click();
    await page.waitForFunction(() => window.clientAction !== undefined);
    assert.equal(await page.evaluate(() => window.clientAction.date), '2026-10-15');
    assert.equal(await page.evaluate(() => window.routeCalls.length), 0, 'no mutation becomes a GET navigation');
    await page.locator('#alternate-submit').click();
    await page.waitForFunction(() => window.routeCalls.length === 1);
    const destination = new URL(await page.evaluate(() => window.routeCalls[0].href));
    assert.equal(destination.pathname, '/alternate'); assert.equal(destination.hash, '#anchor');
    assert.equal(destination.searchParams.has('discard'), false); assert.equal(destination.searchParams.get('intent'), 'alternate');
    while (!app.reads.length) await new Promise(resolve => setImmediate(resolve));
    app.release();
    await page.waitForFunction(() => document.querySelector('#search-form').getAttribute('aria-busy') === 'false');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('copy invite reports rejection, keeps retry explicit, and ignores completion after retained-view hiding', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/clipboard');
  try {
    const { page } = app;
    await page.getByRole('button', { name: 'Copy link', exact: true }).click();
    await page.getByRole('button', { name: 'Copying…', exact: true }).waitFor();
    await page.evaluate(() => window.finish('copyCalls', 'Fixture permission denial', true));
    await page.getByRole('alert').filter({ hasText: 'Could not copy the link' }).waitFor();
    assert.equal(await page.evaluate(() => window.copyCalls.length), 1);
    await page.getByRole('button', { name: 'Copy link', exact: true }).click();
    await page.evaluate(() => window.hide());
    await page.locator('[data-visible]').filter({ hasText: 'hidden' }).waitFor();
    await page.evaluate(() => window.finish('copyCalls', undefined));
    await page.evaluate(() => window.show());
    await page.getByRole('button', { name: 'Copy link', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Copied', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.copyCalls.length), 2);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('social Undo stays visible and pending through the action, reports failure, and never retries itself', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/social');
  try {
    const { page } = app;
    await page.getByRole('button', { name: 'Hide salon', exact: true }).waitFor();
    await page.waitForTimeout(60); // Existing provider batches registrations for 30 ms.
    await page.getByRole('button', { name: 'Hide salon', exact: true }).click();
    await page.waitForFunction(() => window.preferences.length === 1);
    await page.evaluate(() => window.finish('preferences', {}));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('button', { name: 'Updating…', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Updating…', exact: true }).isDisabled(), true);
    await page.evaluate(() => window.finish('preferences', 'Fixture offline', true));
    await page.getByRole('status').filter({ hasText: 'Fixture offline' }).waitFor();
    assert.equal(await page.evaluate(() => window.preferences.length), 2);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.evaluate(() => window.finish('preferences', {}));
    await page.getByRole('status').filter({ hasText: 'Salon is visible again.' }).waitFor();
    assert.equal(await page.evaluate(() => window.preferences.length), 3);
    assert.deepEqual(await page.evaluate(() => window.preferences.map(row => row.input)), [['11111111-1111-4111-8111-111111111111', 'hidden', true], ['11111111-1111-4111-8111-111111111111', 'hidden', false], ['11111111-1111-4111-8111-111111111111', 'hidden', false]]);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('remaining data-changing submits and native date forms preserve authority and calculation inputs', () => {
  assert.match(readFileSync('app/(app)/payroll/page.tsx', 'utf8'), /<form action=\{savePayrollStatementAction\}>\s*<HiddenPeriodFields period=\{period\} returnPath=\{returnPath\} \/>\s*<SubmitButton pendingLabel="Saving statement…"[\s\S]*?disabled=\{!canManage\}/);
  for (const file of ['app/staff/today/today-dashboard-view.tsx', 'app/(app)/pos/portable/report/page.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /<NavigationForm[^>]*method="get"/);
    assert.match(source, /name="date"/);
    assert.match(source, /<NavigationSubmitButton pendingLabel="Loading…"/);
  }
});
