import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
let browser, server, base;
before(async () => {
  if (!executablePath) throw Error('A local Chromium executable is required for actual-component navigation acceptance');
  const host = fs.readFileSync('lib/app-local-host.ts', 'utf8').match(/export function appLocalPath\(value: string\): string \{[\s\S]*?\n\}/)?.[0];
  assert.ok(host);
  const modules = {
    '@/components/workspace-language': 'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;',
    '@/components/explore-advertising': 'export const ExploreAdSlot=()=>null;',
    '@/app/explore/explore-header-search-slot': 'export const ExploreHeaderSearchSlot=()=>null;',
    '@/components/legal-footer': 'export const LegalFooter=()=>null;',
    '@/lib/explore-entry-navigation': 'export const handleExploreLogoClick=()=>{};',
    '@/lib/app-local-host': host,
  };
  const source = `import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
import{GuestNavigationShell}from'./app/guest-navigation-shell';import{NavigationForm,NavigationSubmitButton}from'./components/navigation-form';
import{OfflineNetworkFormGuard}from'./components/offline-network-form-guard';
import{AppLocalNavigationProvider}from'./app/local-app/navigation';import{installAppLocalLinkNavigation}from'./lib/app-local-link-navigation';
const config=new URLSearchParams(location.search);window.state={calls:[],hosted:[],errors:[],events:[],deferred:[],mode:'normal',guard:false,hostedOnly:false};
window.NativeFormData=FormData;if(config.has('legacyFormData'))window.FormData=class extends window.NativeFormData{constructor(form,submitter){if(submitter&&config.has('throwSubmitter'))throw new TypeError('unsupported second argument');super(form)}};
if(config.has('offline'))Object.defineProperty(navigator,'onLine',{get:()=>false});
const handlers=new Set,add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);document.addEventListener=(type,listener,...rest)=>{if(type==='submit'&&listener?.name==='submitSearch')handlers.add(listener);return add(type,listener,...rest)};document.removeEventListener=(type,listener,...rest)=>{if(type==='submit')handlers.delete(listener);return remove(type,listener,...rest)};
window.helperListenerCount=()=>handlers.size;window.draftNode=null;
const resets=new Set,addWindow=window.addEventListener.bind(window),removeWindow=window.removeEventListener.bind(window);window.addEventListener=(type,listener,...rest)=>{if(type==='pageshow'&&listener?.name==='resetSearches')resets.add(listener);return addWindow(type,listener,...rest)};window.removeEventListener=(type,listener,...rest)=>{if(type==='pageshow')resets.delete(listener);return removeWindow(type,listener,...rest)};window.helperResetListenerCount=()=>resets.size;
function App(){const[route,setRoute]=useState(location.pathname+location.search);const commit=destination=>{history.pushState({},'',destination);setRoute(destination)};
const navigate=destination=>{window.state.calls.push(destination);if(window.state.mode==='throw')throw Error('fixture synchronous failure');if(window.state.mode==='reject')return Promise.reject(Error('fixture rejected navigation'));if(window.state.mode==='no-commit')return;if(window.state.mode==='hold')return new Promise((resolve,reject)=>window.state.deferred.push({destination,resolve:accepted=>{if(accepted)commit(destination);resolve()},reject}));commit(destination)};
useEffect(()=>{const pop=()=>setRoute(location.pathname+location.search);window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[]);
useEffect(()=>{const install=()=>installAppLocalLinkNavigation({navigate,isLocalRoute:()=>!window.state.hostedOnly,openOnline:destination=>{window.state.hosted.push(destination);if(window.state.mode==='reject')return Promise.reject(Error('fixture hosted failure'))},onError:error=>window.state.errors.push(String(error))});let cleanup=config.has('hosted')?()=>{}:install();window.cleanupHelper=()=>cleanup();window.reinstallHelper=()=>{cleanup();cleanup=install()};return()=>cleanup()},[]);
window.resolveNavigation=(index,accepted=true)=>window.state.deferred[index].resolve(accepted);window.rejectNavigation=index=>window.state.deferred[index].reject(Error('fixture delayed failure'));
const body=<main><h1>{route.startsWith('/explore?')?'Explore':'Experiences'}</h1><textarea aria-label="Unsubmitted draft" defaultValue="keep this draft"/></main>;
return <AppLocalNavigationProvider value={{path:route,navigate,refresh(){}}}>{config.has('offline')?<OfflineNetworkFormGuard/>:null}{config.has('retained')?<><NavigationForm id="search" role="search" action="/explore" onSubmit={event=>{if(window.state.guard)event.preventDefault()}}><input name="q" aria-label="Global search" defaultValue=""/><NavigationSubmitButton name="type" value="salons" pendingLabel="Searching…">Search</NavigationSubmitButton></NavigationForm><NavigationForm id="unrelated" role="search" action="/workspace/open"><input name="workspace_id" value="fixture-owner" readOnly/><NavigationSubmitButton>Open workspace</NavigationSubmitButton></NavigationForm>{body}</>:<GuestNavigationShell authenticated={false}>{body}</GuestNavigationShell>}</AppLocalNavigationProvider>};
document.addEventListener('reylumi:app-local-search-navigation',event=>window.state.events.push(event.detail),true);createRoot(document.getElementById('root')).render(<App/>);`;
  const output = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', target: ['safari16'], jsx: 'automatic', loader: { '.css': 'empty' }, plugins: [{
    name: 'actual-source-boundaries', setup(builder) {
      builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty-css', namespace: 'fixture' }));
      builder.onResolve({ filter: /^next\// }, ({ path: name }) => ({ path: name, namespace: 'next-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'next-fixture' }, ({ path: name }) => ({ contents: name === 'next/navigation' ? `export * from ${JSON.stringify(path.resolve('app/local-app/navigation.tsx'))}` : name === 'next/link' ? `export {AppLocalLink as default,useLinkStatus} from ${JSON.stringify(path.resolve('app/local-app/navigation.tsx'))}` : name === 'next/image' ? `export {AppLocalImage as default} from ${JSON.stringify(path.resolve('app/local-app/navigation.tsx'))}` : '', loader: 'tsx', resolveDir: process.cwd() }));
      builder.onResolve({ filter: /^@\// }, ({ path: name }) => {
        if (name in modules) return { path: name, namespace: 'fixture' };
        for (const suffix of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
          const target = path.resolve(name.slice(2) + suffix);
          if (fs.existsSync(target)) return { path: target };
        }
        throw Error('Unexpected actual-source import ' + name);
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ contents: name === 'empty-css' ? 'export default {}' : modules[name], loader: 'tsx', resolveDir: process.cwd() }));
    },
  }] });
  const js = output.outputFiles[0].text;
  server = createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(js); return; }
    if (req.url?.startsWith('/brand/')) { res.writeHead(204); res.end(); return; }
    if (req.url?.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end('{"suggestions":[]}'); return; }
    res.setHeader('Content-Type', 'text/html');
    if (!req.url?.includes('hosted=1')) res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; base-uri 'none'; form-action 'none'");
    res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

async function open(query = 'retained=1') {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort('blockedbyclient'));
  await page.goto(base + '/book/11111111-1111-4111-8111-111111111111?' + query);
  await page.waitForFunction(() => window.reinstallHelper);
  return page;
}
async function submit(page, query) {
  await page.locator('#search input[name=q]').first().fill(query);
  await page.locator('#search button[type=submit]').click({ noWaitAfter: true, force: true });
}
async function settled(page) { await page.waitForFunction(() => document.querySelector('#search')?.getAttribute('aria-busy') === 'false'); }
async function state(page) { return page.evaluate(() => ({ ...window.state, deferred: window.state.deferred.length })); }

test('actual guest header routes a salon Book page into Explore under unchanged form-action none CSP and preserves draft', async () => {
  const page = await open('');
  const violations = [];
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('form-action')) violations.push(message.text()); });
  await page.locator('textarea').fill('saved local draft');
  await page.evaluate(() => { window.draftNode = document.querySelector('textarea'); });
  await page.locator('#guest-global-search').fill('nail');
  await page.getByRole('button', { name: 'Search', exact: true }).click({ noWaitAfter: true, force: true });
  await page.waitForFunction(() => location.pathname + location.search === '/explore?q=nail');
  await page.getByRole('heading', { name: 'Explore', exact: true }).waitFor();
  assert.deepEqual((await state(page)).calls, ['/explore?q=nail']);
  assert.deepEqual(violations, []);
  assert.equal(await page.locator('textarea').inputValue(), 'saved local draft');
  assert.equal(await page.evaluate(() => window.draftNode === document.querySelector('textarea')), true);
  await page.close();
});
test('retained actual form supports second query, Back, same-query re-submit and exact draft DOM retention', async () => {
  const page = await open();
  await page.evaluate(() => { window.draftNode = document.querySelector('textarea'); });
  await page.locator('textarea').fill('do not erase');
  await submit(page, 'nail'); await settled(page);
  await submit(page, 'spa'); await settled(page);
  await page.goBack(); await page.waitForFunction(() => location.search === '?q=nail&type=salons');
  await submit(page, 'nail'); await settled(page);
  assert.deepEqual((await state(page)).calls, ['/explore?q=nail&type=salons', '/explore?q=spa&type=salons', '/explore?q=nail&type=salons']);
  assert.equal(await page.locator('textarea').inputValue(), 'do not erase');
  assert.equal(await page.evaluate(() => window.draftNode === document.querySelector('textarea')), true);
  await page.close();
});
test('unresolved asynchronous navigation owns one submission and only its accepted destination clears pending', async () => {
  const page = await open();
  await page.evaluate(() => { window.state.mode = 'hold'; const form = document.querySelector('#search'); form.querySelector('input').value = 'nail'; form.requestSubmit(form.querySelector('button')); form.requestSubmit(form.querySelector('button')); });
  await page.waitForFunction(() => window.state.calls.length === 1);
  assert.equal(await page.locator('#search').getAttribute('aria-busy'), 'true');
  assert.equal((await state(page)).deferred, 1);
  await page.evaluate(() => window.resolveNavigation(0));
  await settled(page);
  assert.equal((await state(page)).calls.length, 1);
  await page.close();
});
test('throw, rejection and unaccepted navigation release only the attempt and permit an explicit retry', async () => {
  for (const mode of ['throw', 'reject', 'no-commit']) {
    const page = await open();
    await page.evaluate(mode => { window.state.mode = mode; }, mode);
    await submit(page, 'nail'); await settled(page);
    assert.equal((await state(page)).errors.length, 1);
    await page.evaluate(() => { window.state.mode = 'normal'; });
    await submit(page, 'retry'); await settled(page);
    assert.equal((await state(page)).calls.length, 2);
    assert.equal(await page.evaluate(() => location.search), '?q=retry&type=salons');
    await page.close();
  }
});
test('stale completion does not unlock a newer attempt and helper cleanup removes its submit listener', async () => {
  const page = await open();
  await page.evaluate(() => { window.state.mode = 'hold'; });
  await submit(page, 'first'); await page.waitForFunction(() => window.state.deferred.length === 1);
  const old = await page.evaluate(() => window.state.events.find(event => event.phase === 'start'));
  assert.equal(await page.evaluate(() => window.helperListenerCount()), 1);
  assert.equal(await page.evaluate(() => window.helperResetListenerCount()), 1);
  await page.evaluate(() => window.reinstallHelper()); await settled(page);
  assert.equal(await page.evaluate(() => window.helperListenerCount()), 1);
  await submit(page, 'first'); await page.waitForFunction(() => window.state.deferred.length === 2);
  await page.evaluate(old => document.querySelector('#search').dispatchEvent(new CustomEvent('reylumi:app-local-search-navigation', { detail: { ...old, phase: 'complete', accepted: true } })), old);
  await page.evaluate(() => window.resolveNavigation(0, false));
  assert.equal(await page.locator('#search').getAttribute('aria-busy'), 'true');
  await page.evaluate(() => window.resolveNavigation(1));
  await settled(page);
  assert.equal(await page.evaluate(() => location.search), '?q=first&type=salons');
  await page.evaluate(() => window.cleanupHelper());
  assert.equal(await page.evaluate(() => window.helperListenerCount()), 0);
  assert.equal(await page.evaluate(() => window.helperResetListenerCount()), 0);
  await page.close();
});
test('successful controls and actual submitter replace action query and preserve encoded and duplicate values', async () => {
  const page = await open();
  await page.evaluate(() => {
    const form = document.querySelector('#search'); form.action = '/explore?stale=discard';
    const hidden = document.createElement('input'); hidden.name = 'q'; hidden.value = 'second query'; form.append(hidden);
    form.querySelector('button').setAttribute('formaction', '/explore?also=discard');
  });
  await submit(page, 'nail & spa'); await settled(page);
  assert.deepEqual((await state(page)).calls, ['/explore?q=nail+%26+spa&type=salons&q=second+query']);
  await page.close();
});
test('original prevented submit and unsupported mutation/target/encoding/action boundaries keep ownership', async () => {
  for (const attributes of [
    { formmethod: 'post' }, { formenctype: 'multipart/form-data' }, { formtarget: '_blank' },
    { formaction: '/workspace/open' }, { formaction: '//example.invalid/explore' },
    { formaction: 'https://example.invalid/explore' }, { name: '$ACTION_ID_fixture' }, { name: '$ACTION_REF_fixture' },
  ]) {
    const page = await open();
    await page.evaluate(attributes => { for (const [key, value] of Object.entries(attributes)) document.querySelector('#search button').setAttribute(key, value); }, attributes);
    await page.evaluate(() => document.querySelector('#search').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: document.querySelector('#search button') })));
    assert.deepEqual((await state(page)).calls, []);
    assert.deepEqual((await state(page)).hosted, []);
    await page.close();
  }
  const page = await open();
  await page.evaluate(() => { window.state.guard = true; });
  await submit(page, 'guarded');
  assert.deepEqual((await state(page)).calls, []);
  assert.equal(await page.locator('#search').getAttribute('aria-busy'), 'false');
  await page.close();
});
test('ordinary workspace document, POST and non-search form remain outside installed interception', async () => {
  const page = await open();
  await page.evaluate(() => document.querySelector('#unrelated').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: document.querySelector('#unrelated button') })));
  assert.equal(await page.locator('#unrelated').getAttribute('aria-busy'), 'true');
  await submit(page, 'nail'); await settled(page);
  assert.equal(await page.locator('#unrelated').getAttribute('aria-busy'), 'true');
  for (const change of ['post', 'nonsearch']) {
    await page.evaluate(change => { window.dispatchEvent(new PageTransitionEvent('pageshow')); const form = document.querySelector('#search'); if (change === 'post') form.method = 'post'; else { form.method = 'get'; form.removeAttribute('role'); } }, change);
    await settled(page);
    await page.evaluate(() => document.querySelector('#search').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: document.querySelector('#search button') })));
    assert.equal((await state(page)).calls.length, 1);
  }
  await page.close();
});
test('hosted fallback acknowledgement and rejection settle only their exact search', async () => {
  const page = await open();
  await page.evaluate(() => { window.state.hostedOnly = true; });
  await submit(page, 'fallback'); await settled(page);
  assert.deepEqual((await state(page)).hosted, ['/explore?q=fallback&type=salons']);
  assert.deepEqual((await state(page)).calls, []);
  await page.evaluate(() => { window.state.mode = 'reject'; });
  await submit(page, 'failure'); await settled(page);
  assert.equal((await state(page)).errors.length, 1);
  await page.close();
});
test('without installed helper the actual hosted form retains native document GET', async () => {
  const page = await open('retained=1&hosted=1');
  await submit(page, 'ordinary web');
  await page.waitForURL(base + '/explore?q=ordinary+web&type=salons');
  assert.equal(await page.evaluate(() => location.pathname + location.search), '/explore?q=ordinary+web&type=salons');
  await page.close();
});

test('actual guest IME guard keeps ownership before an ordinary Enter search', async () => {
  const page = await open('');
  await page.locator('#guest-global-search').fill('nail');
  await page.locator('#guest-global-search').dispatchEvent('compositionstart');
  await page.evaluate(() => { const form = document.querySelector('form[role=search]'); form.requestSubmit(form.querySelector('button[type=submit]')); });
  assert.deepEqual((await state(page)).calls, []);
  assert.equal(await page.locator('form[role=search]').getAttribute('aria-busy'), 'false');
  await page.locator('#guest-global-search').dispatchEvent('compositionend');
  await page.locator('#guest-global-search').press('Enter', { noWaitAfter: true });
  await page.waitForFunction(() => location.pathname + location.search === '/explore?q=nail');
  assert.deepEqual((await state(page)).calls, ['/explore?q=nail']);
  await page.close();
});

test('existing offline guard preserves entries and prevents installed search interception', async () => {
  const page = await open('retained=1&offline=1');
  await page.locator('textarea').fill('offline draft stays');
  await submit(page, 'nail');
  assert.deepEqual((await state(page)).calls, []);
  assert.equal(await page.locator('#search').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('textarea').inputValue(), 'offline draft stays');
  await page.getByText("You're offline. Your entries are kept. Reconnect to continue.").waitFor();
  await page.close();
});

test('pageshow releases only helper-owned attempts and stale completion cannot unlock the next search', async () => {
  const page = await open();
  await page.evaluate(() => { window.state.mode = 'hold'; });
  await submit(page, 'nail'); await page.waitForFunction(() => window.state.deferred.length === 1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
  await settled(page);
  await submit(page, 'nail'); await page.waitForFunction(() => window.state.deferred.length === 2);
  await page.evaluate(() => window.resolveNavigation(0, false));
  assert.equal(await page.locator('#search').getAttribute('aria-busy'), 'true');
  await page.evaluate(() => window.resolveNavigation(1)); await settled(page);
  assert.equal((await state(page)).calls.length, 2);
  await page.close();
});

test('legacy Safari submitter fallback preserves native successful-control order, external association and fieldsets', async () => {
  for (const variant of ['button', 'external', 'disabled', 'legend', 'input-submit', 'throw-second-argument']) {
    const page = await open('retained=1&legacyFormData=1' + (variant === 'throw-second-argument' ? '&throwSubmitter=1' : ''));
    const expected = await page.evaluate(variant => {
      const form = document.querySelector('#search'), original = form.querySelector('button');
      form.querySelector('input').value = 'nail & spa';
      let submitter = original;
      const duplicate = document.createElement('input'); duplicate.name = 'q'; duplicate.value = 'after query'; form.append(duplicate);
      const ignored = document.createElement('input'); ignored.name = 'ignored'; ignored.value = 'disabled'; ignored.disabled = true; form.append(ignored);
      if (variant === 'external') {
        submitter = document.createElement('button'); submitter.type = 'submit'; submitter.name = 'q'; submitter.value = 'external first'; submitter.setAttribute('form', 'search'); form.before(submitter);
      } else if (variant === 'disabled') {
        const fieldset = document.createElement('fieldset'); fieldset.disabled = true; form.append(fieldset); fieldset.append(original);
      } else if (variant === 'legend') {
        const fieldset = document.createElement('fieldset'), legend = document.createElement('legend'); fieldset.disabled = true; fieldset.append(legend); form.append(fieldset); legend.append(original);
      } else if (variant === 'input-submit') {
        submitter = document.createElement('input'); submitter.type = 'submit'; submitter.name = 'q'; submitter.value = 'input submit value'; original.before(submitter);
      }
      window.state.legacySubmitter = submitter;
      return '/explore?' + new URLSearchParams(Array.from(new window.NativeFormData(form, submitter)).map(([key, value]) => [key, typeof value === 'string' ? value : value.name]));
    }, variant);
    await page.evaluate(() => document.querySelector('#search').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: window.state.legacySubmitter })));
    await page.waitForFunction(() => window.state.calls.length === 1); await settled(page);
    assert.deepEqual((await state(page)).calls, [expected]);
    assert.equal(await page.locator('[data-app-local-search-submitter]').count(), 0);
    await page.evaluate(() => window.cleanupHelper());
    assert.equal(await page.evaluate(() => window.helperListenerCount()), 0);
    assert.equal(await page.evaluate(() => window.helperResetListenerCount()), 0);
    await page.close();
  }
});

test('image and unvalued input submitters retain their document boundary without invented browser values', async () => {
  for (const type of ['image', 'submit']) {
    const page = await open('retained=1&legacyFormData=1');
    await page.evaluate(type => {
      const form = document.querySelector('#search'), submitter = document.createElement('input'); submitter.type = type; submitter.name = 'browser-value'; form.append(submitter);
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter }));
    }, type);
    assert.deepEqual((await state(page)).calls, []);
    assert.equal(await page.locator('[data-app-local-search-submitter]').count(), 0);
    await page.close();
  }
});
