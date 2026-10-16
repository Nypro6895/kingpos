import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const skip = !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH;

async function fixture({ clipboard = false } = {}) {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const root = resolve('.').replaceAll('\\', '/');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{ExploreAdvertising,ImageAd}from'${root}/components/explore-advertising';
import{PostShareButton}from'${root}/components/post-share-button';
const campaign={id:'fixture-image',name:'Image campaign',kind:'placement',enabled:true,imageUrl:'',href:'/image-destination?keep=1',text:'Image announcement',background:'#fff',color:'#111',delaySeconds:0,durationSeconds:0,closeButton:false,repeat:'always',position:'top',speedSeconds:12,startsAt:null,endsAt:null};
const ticker={...campaign,id:'fixture-ticker',name:'Ticker campaign',kind:'ticker',href:'/ticker-destination?keep=2',text:'Ticker announcement'};
window.analytics=[];window.assignments=[];window.shareCalls=[];
window.__fixtureAssign=href=>window.assignments.push({href,at:Date.now()});
const originalFetch=window.fetch.bind(window);window.fetch=(url,options={})=>{
 if(!String(url).startsWith('/api/explore/advertising'))return originalFetch(url,options);
 if(options.method!=='POST')return Promise.resolve(new Response(JSON.stringify({campaigns:[ticker]}),{headers:{'Content-Type':'application/json'}}));
 const body=JSON.parse(options.body);if(body.event==='view')return Promise.resolve(new Response(JSON.stringify({allowed:true}),{headers:{'Content-Type':'application/json'}}));
 const request={body,keepalive:options.keepalive};window.analytics.push(request);return new Promise(resolve=>{request.finish=()=>resolve(new Response(JSON.stringify({allowed:true}),{headers:{'Content-Type':'application/json'}}));});
};
const share=value=>{const request={value};window.shareCalls.push(request);return new Promise((resolve,reject)=>{request.finish=resolve;request.cancel=()=>reject(new DOMException('User cancelled','AbortError'));request.fail=()=>reject(new Error('Fixture sharing failed'));});};
Object.defineProperty(navigator,'share',{configurable:true,value:${clipboard ? 'undefined' : 'share'}});
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:share}});
function App(){const[visible,setVisible]=useState(true);const[mounted,setMounted]=useState(true);useEffect(()=>{window.hidePublic=()=>setVisible(false);window.showPublic=()=>setVisible(true);window.removePublic=()=>setMounted(false);},[]);return <><p data-visibility>{mounted?(visible?'visible':'hidden'):'removed'}</p>{mounted?<Activity mode={visible?'visible':'hidden'}><ExploreAdvertising><ImageAd campaign={campaign}/><PostShareButton href="/explore/looks/fixture" title="Fixture post"/></ExploreAdvertising></Activity>:null}</>;}
document.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)event.preventDefault();});
createRoot(document.getElementById('root')).render(<App/>);
` },
    jsx: 'automatic', bundle: true, write: false, platform: 'browser',
    plugins: [{ name: 'public-service-probes', setup(builder) {
      // Location.assign is a non-configurable browser API. Only its transport
      // sink is injected; the actual analytics wait, guard and lifecycle run.
      builder.onLoad({ filter: /[\\/]components[\\/]explore-advertising\.tsx$/ }, args => ({ loader: 'tsx', resolveDir: resolve('components'), contents: readFileSync(args.path, 'utf8').replaceAll('window.location.assign(', 'window.__fixtureAssign(') }));
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
      builder.onResolve({ filter: /\.module\.css$/ }, () => ({ path: 'css', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: root, contents: ({
        'next/navigation': 'export function usePathname(){return "/explore";}',
        'next/link': `import React from'react';export default function Link(props){return <a {...props}/>}export function useLinkStatus(){return{pending:false}}`,
        language: 'export const WorkspaceText=({text})=>text;export function useWorkspaceTranslation(){return value=>value;}',
        css: 'export default new Proxy({},{get:(_,key)=>String(key)});',
      })[args.path] }));
    } }],
  });
  let unexpectedServiceRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
    } else if (request.url.startsWith('/api/')) {
      unexpectedServiceRequests++; response.writeHead(503); response.end();
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<style>.fixed{position:fixed}.top-0{top:0}.inset-x-0{left:0;right:0}.block{display:block}.h-1{height:4px}.pointer-events-none{pointer-events:none}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.ticker{margin-top:16px}button,a{padding:12px;display:inline-block}</style><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  await page.clock.install();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/explore');
  await page.getByRole('link', { name: 'Ticker announcement', exact: true }).waitFor();
  return { page, errors, async close() {
    assert.equal(unexpectedServiceRequests, 0, 'no production advertising, sharing, or other API is contacted');
    await browser.close(); await new Promise(resolve => server.close(resolve));
  } };
}

async function burst(page, selector) { await page.locator(selector).evaluate(element => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); }

test('advertisement click responds immediately, records once, and retains the original1200ms handoff limit', { skip, timeout: 60_000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    await page.evaluate(() => { window.adStarted = Date.now(); });
    await burst(page, 'a[aria-label="Image campaign"]');
    await page.getByRole('status').waitFor();
    assert.equal(await page.evaluate(() => window.analytics.length), 1);
    assert.deepEqual(await page.evaluate(() => window.analytics[0].body), { id: 'fixture-image', event: 'click', path: '/explore', device: 'mobile' });
    assert.equal(await page.evaluate(() => window.analytics[0].keepalive), true);
    assert.equal(await page.evaluate(() => window.assignments.length), 0);
    await page.clock.fastForward(1200);
    assert.equal(await page.evaluate(() => window.assignments.length), 1);
    assert.equal(await page.evaluate(() => window.assignments[0].href), '/image-destination?keep=1');
    assert.ok(await page.evaluate(() => window.assignments[0].at - window.adStarted >= 1200));
    assert.equal(await page.getByRole('status').count(), 1, 'feedback stays until the browser handoff leaves or returns');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.getByRole('status').waitFor({ state: 'detached' });
    await page.evaluate(() => window.analytics[0].finish());
    assert.equal(await page.evaluate(() => window.assignments.length), 1, 'late analytics cannot repeat document navigation');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('ticker handoff cancels on Activity hide and keeps modifier analytics and routing behavior', { skip, timeout: 60_000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    const ticker = page.getByRole('link', { name: 'Ticker announcement', exact: true });
    await ticker.click(); await page.getByRole('status').waitFor();
    assert.equal(await page.evaluate(() => window.analytics.length), 1);
    await page.evaluate(() => window.hidePublic());
    await page.locator('[data-visibility]').filter({ hasText: 'hidden' }).waitFor();
    assert.equal(await page.getByRole('status').count(), 0);
    await page.clock.fastForward(1300);
    assert.equal(await page.evaluate(() => window.assignments.length), 0, 'an abandoned wait cannot send the user to an old ad');
    await page.evaluate(() => window.showPublic());
    await ticker.waitFor();
    await ticker.dispatchEvent('click', { ctrlKey: true, button: 0 });
    assert.equal(await page.getByRole('status').count(), 0, 'a native modified click does not put the current page into navigation feedback');
    assert.equal(await page.evaluate(() => window.analytics.length), 2);
    assert.equal(await page.evaluate(() => window.analytics[1].body.id), 'fixture-ticker');
    assert.equal(await page.evaluate(() => window.assignments.length), 0);
    await ticker.click(); await page.getByRole('status').waitFor();
    assert.equal(await page.evaluate(() => window.analytics.length), 2, 'existing campaign event deduplication is retained');
    await page.evaluate(() => window.analytics[1].finish());
    await page.waitForFunction(() => window.assignments.length === 1);
    assert.equal(await page.evaluate(() => window.assignments[0].href), '/ticker-destination?keep=2');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('native post sharing guards duplicate calls, stays busy until settled, and treats user cancellation silently', { skip, timeout: 60_000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    const button = page.getByRole('button', { name: 'Share post', exact: true });
    await burst(page, 'button[aria-label="Share post"]');
    assert.equal(await page.evaluate(() => window.shareCalls.length), 1);
    assert.equal(await button.isDisabled(), true);
    assert.equal(await button.getAttribute('aria-busy'), 'true');
    await page.getByText('Sharing…', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.shareCalls[0].value), { title: 'Fixture post', url: await page.evaluate(() => location.origin + '/explore/looks/fixture') });
    await page.evaluate(() => window.shareCalls[0].cancel());
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Share post"]').disabled);
    assert.equal(await page.getByRole('status').count(), 0);
    await button.click();
    await page.evaluate(() => window.shareCalls[1].finish());
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Share post"]').disabled);
    assert.equal(await page.getByRole('status').count(), 0, 'native share success keeps the original quiet completion');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('clipboard sharing reports success and failure while obsolete hidden or unmounted results cannot change a new attempt', { skip, timeout: 60_000 }, async () => {
  const app = await fixture({ clipboard: true }); const { page } = app;
  try {
    const button = page.getByRole('button', { name: 'Share post', exact: true });
    await button.click();
    await page.evaluate(() => window.hidePublic());
    await page.locator('[data-visibility]').filter({ hasText: 'hidden' }).waitFor();
    await page.evaluate(() => window.showPublic()); await button.waitFor();
    assert.equal(await button.isEnabled(), true);
    await button.click();
    await page.evaluate(() => window.shareCalls[0].finish());
    assert.equal(await button.isDisabled(), true, 'the old result cannot unlock a newer clipboard request');
    assert.equal(await page.getByRole('status').count(), 0);
    await page.evaluate(() => window.shareCalls[1].finish());
    await page.getByText('Link copied.', { exact: true }).waitFor();
    assert.equal(await button.isEnabled(), true);
    await button.click(); await page.evaluate(() => window.shareCalls[2].fail());
    await page.getByText('Could not share this link. Please try again.', { exact: true }).waitFor();
    assert.equal(await button.isEnabled(), true);
    await button.click(); await page.evaluate(() => window.removePublic());
    await page.locator('[data-visibility]').filter({ hasText: 'removed' }).waitFor();
    await page.evaluate(() => window.shareCalls[3].finish());
    assert.equal(await page.getByRole('status').count(), 0);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
