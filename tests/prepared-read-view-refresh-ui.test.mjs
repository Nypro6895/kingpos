import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
async function fixture({ cached = true, path = '/my-bookings' } = {}) {
  const root = resolve('.').replaceAll('\\', '/');
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{Activity,useCallback,useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{PreparedReadViewRefresh,isPreparedReadViewPath}from'./components/prepared-read-view-refresh';
window.cached=${cached};window.now=100000;Date.now=()=>window.now;window.online=true;window.visibility='visible';
Object.defineProperty(Navigator.prototype,'onLine',{get:()=>window.online});Object.defineProperty(document,'visibilityState',{get:()=>window.visibility});
window.calls=[];window.pending=[];window.refreshes=[];window.isReadPath=isPreparedReadViewPath;
window.authorize=(scope='account-a')=>window.dispatchEvent(new CustomEvent('reylumi:experience-online-authorized',{detail:{scope}}));
window.resolveOne=(valid=true,proof=null)=>{const item=window.pending.shift();if(proof)window.authorize(proof);item.resolve(valid)};
window.wake=(event='focus')=>window.dispatchEvent(new Event(event));window.advance=()=>window.now+=30001;
function App(){const[scope,setScope]=useState('account-a'),[shown,setShown]=useState(true),[mounted,setMounted]=useState(true),[read,setRead]=useState('old list');
 const validate=useCallback((force,background)=>new Promise(resolve=>{const call={scope,force,background};window.calls.push(call);window.pending.push({...call,resolve})}),[scope]);
 useLayoutEffect(()=>{window.changeScope=setScope;window.hide=()=>setShown(false);window.show=()=>setShown(true);window.remove=()=>setMounted(false);window.applyRead=()=>setRead('fresh list')},[]);
 return <><button aria-label='Outside'>Outside</button><p data-scope>{scope}</p><Activity mode={shown?'visible':'hidden'}><input aria-label='Search draft' defaultValue=''/><p data-list>{read}</p>{mounted&&<PreparedReadViewRefresh scope={scope} validate={validate}/>}<div style={{height:2500}}/></Activity></>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', alias: { '@': root }, plugins: [{ name: 'controlled-prepared-read', setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
    builder.onResolve({ filter: /experience-offline-client$/ }, () => ({ path: 'boot', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', resolveDir: root, contents: args.path === 'boot'
      ? `export const readExperienceOfflineBootGrant=scope=>({present:window.cached,grant:window.cached?{scope}:null});`
      : `import{useSyncExternalStore}from'react';const listen=cb=>{window.addEventListener('fixture-route',cb);return()=>window.removeEventListener('fixture-route',cb)};export const usePathname=()=>useSyncExternalStore(listen,()=>location.pathname);const router={refresh(){window.refreshes.push({path:location.pathname+location.search});}};export const useRouter=()=>router;window.navigate=path=>{history.pushState(null,'',path);window.dispatchEvent(new Event('fixture-route'))};` }));
  } }] });
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + path); await page.getByLabel('Search draft').waitFor();
  return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}

test('prepared read view waits for fresh authority, coalesces wakeups and merges without replacing draft or scroll', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    await page.waitForFunction(() => calls.length === 1);
    await page.getByLabel('Search draft').fill('typed before refresh');
    await page.evaluate(() => { window.savedInput = document.querySelector('input'); savedInput.blur(); window.scrollTo(0, 400); wake('online'); wake('reylumi:foreground'); });
    assert.equal(await page.evaluate(() => calls.length), 1);
    assert.equal(await page.evaluate(() => refreshes.length), 0);
    await page.evaluate(() => resolveOne(true, 'account-a'));
    await page.waitForFunction(() => refreshes.length === 1);
    await page.evaluate(() => applyRead()); await page.getByText('fresh list', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('input') === savedInput), true);
    assert.equal(await page.getByLabel('Search draft').inputValue(), 'typed before refresh');
    assert.equal(await page.evaluate(() => scrollY), 400);
    await page.evaluate(() => { wake(); wake('online'); });
    assert.equal(await page.evaluate(() => calls.length), 1);
    await page.evaluate(() => { advance(); wake(); });
    await page.waitForFunction(() => calls.length === 2);
    assert.deepEqual(await page.evaluate(() => calls[1]), { scope: 'account-a', force: true, background: true });
    await page.evaluate(() => resolveOne(true, 'account-a')); await page.waitForFunction(() => refreshes.length === 2);
  } finally { await app.close(); }
});

test('offline fallback, mismatched proof and rejected authority cannot refresh the server view', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    await page.waitForFunction(() => calls.length === 1);
    await page.evaluate(() => resolveOne(true)); // valid may mean an offline lease after a failed GET
    await page.evaluate(() => { advance(); wake(); }); await page.waitForFunction(() => calls.length === 2);
    await page.evaluate(() => resolveOne(true, 'other-account'));
    await page.evaluate(() => { advance(); wake(); }); await page.waitForFunction(() => calls.length === 3);
    await page.evaluate(() => resolveOne(false, 'account-a'));
    assert.equal(await page.evaluate(() => refreshes.length), 0);
    await page.evaluate(() => { advance(); online = false; wake('online'); wake('reylumi:foreground'); });
    assert.equal(await page.evaluate(() => calls.length), 3);
    await page.evaluate(() => { online = true; wake('online'); }); await page.waitForFunction(() => calls.length === 4);
    await page.evaluate(() => resolveOne(true, 'account-a')); await page.waitForFunction(() => refreshes.length === 1);
  } finally { await app.close(); }
});

test('fresh SSR is not reread on startup; only known read paths wake and focused review drafts defer refresh', { skip, timeout: 30000 }, async () => {
  const app = await fixture({ cached: false }); const { page } = app;
  try {
    assert.equal(await page.evaluate(() => calls.length), 0);
    await page.evaluate(() => wake()); assert.equal(await page.evaluate(() => calls.length), 0);
    const allowed = ['/my-bookings?tab=past', '/explore/favorites', '/more/saved-post?q=hello', '/more/following', '/activity/receipts/11111111-1111-4111-8111-111111111111'];
    const denied = ['/pos', '/staff/my-work', '/payroll', '/book/salon', '/my-bookings/id', '/activity', '/more/security', '/activity/receipts/id/edit', '/my-bookings?token=secret'];
    assert.deepEqual(await page.evaluate(paths => paths.map(isReadPath), allowed), allowed.map(() => true));
    assert.deepEqual(await page.evaluate(paths => paths.map(isReadPath), denied), denied.map(() => false));
    await page.evaluate(() => { navigate('/more/saved-post?q=saved'); });
    await page.getByLabel('Search draft').focus();
    await page.evaluate(() => { advance(); wake(); }); assert.equal(await page.evaluate(() => calls.length), 0);
    await page.getByRole('button', { name: 'Outside' }).focus();
    await page.evaluate(() => wake()); await page.waitForFunction(() => calls.length === 1);
    await page.evaluate(() => resolveOne(true, 'account-a')); await page.waitForFunction(() => refreshes.length === 1);
    await page.evaluate(() => navigate('/pos')); await page.evaluate(() => { advance(); wake(); });
    assert.equal(await page.evaluate(() => calls.length), 1);
  } finally { await app.close(); }
});

test('late validation is cancelled by URL query, pathname, scope, Activity hide or unmount', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    await page.waitForFunction(() => calls.length === 1);
    await page.evaluate(() => { navigate('/my-bookings?tab=past'); resolveOne(true, 'account-a'); });
    assert.equal(await page.evaluate(() => refreshes.length), 0);
    await page.evaluate(() => { advance(); wake(); }); await page.waitForFunction(() => calls.length === 2);
    await page.evaluate(() => navigate('/more/following'));
    await page.evaluate(() => resolveOne(true, 'account-a')); assert.equal(await page.evaluate(() => refreshes.length), 0);
    await page.evaluate(() => { advance(); wake(); }); await page.waitForFunction(() => calls.length === 3);
    await page.evaluate(() => changeScope('account-b')); await page.locator('[data-scope]').filter({ hasText: 'account-b' }).waitFor();
    await page.evaluate(() => resolveOne(true, 'account-a')); assert.equal(await page.evaluate(() => refreshes.length), 0);
    await page.evaluate(() => { advance(); wake(); }); await page.waitForFunction(() => calls.length === 4);
    await page.evaluate(() => hide()); await page.getByLabel('Search draft').waitFor({ state: 'hidden' });
    await page.evaluate(() => resolveOne(true, 'account-b')); assert.equal(await page.evaluate(() => refreshes.length), 0);
    await page.evaluate(() => show()); await page.getByLabel('Search draft').waitFor();
    await page.evaluate(() => { advance(); wake(); }); await page.waitForFunction(() => calls.length === 5);
    await page.evaluate(() => remove());
    await page.evaluate(() => resolveOne(true, 'account-b')); assert.equal(await page.evaluate(() => refreshes.length), 0);
  } finally { await app.close(); }
});
