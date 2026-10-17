import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const skip = !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH;

async function fixture() {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const root = resolve('.').replaceAll('\\', '/');
  const nextLink = resolve('node_modules/next/dist/client/app-dir/link.js');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{Activity,startTransition,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{AppRouterContext}from'next/dist/shared/lib/app-router-context.shared-runtime';
import FeedbackLink from'${root}/components/feedback-link';
import{NavigationForm,NavigationSubmitButton}from'${root}/components/navigation-form';
import{ActionFeedback}from'${root}/components/action-feedback';import{SubmitButton}from'${root}/components/submit-button';
window.linkCalls=[];window.prefetches=[];window.actionCalls=[];window.linkEvents=[];
let latest=null;
window.transport={navigate(href,replace,scroll,link,transitionTypes){const request={href,replace,scroll,transitionTypes,finish:null};window.linkCalls.push(request);if(href==='/fast')return;if(latest){latest.link?.setOptimisticLinkStatus({pending:false});latest.finish();}latest={link,finish:null};const active=latest;startTransition(async()=>{link?.setOptimisticLinkStatus({pending:true});await new Promise(resolve=>{request.finish=resolve;active.finish=resolve;});if(latest===active)latest=null;});}};
function Links(){return <AppRouterContext.Provider value={{}}><div id="link-layout" style={{display:'grid',gridTemplateColumns:'120px 120px',gap:8}}>
<FeedbackLink id="slow" href="/slow" className="fixture-link" title="Preserved title" data-custom="kept" aria-label="Slow route" prefetch={false} replace scroll={false} transitionTypes={['fixture']} ref={node=>{window.linkRef=node;}} onClick={()=>window.linkEvents.push('click')} onNavigate={()=>window.linkEvents.push('navigate')}><span>Slow route</span></FeedbackLink>
<FeedbackLink id="other" href="/other">Other route</FeedbackLink><FeedbackLink id="fast" href="/fast">Fast route</FeedbackLink>
<FeedbackLink id="cancel-click" href="/cancel-click" onClick={event=>event.preventDefault()}>Cancel click</FeedbackLink>
<FeedbackLink id="cancel-nav" href="/cancel-nav" onNavigate={event=>event.preventDefault()}>Cancel navigation</FeedbackLink>
<FeedbackLink id="download" href="/download" download="fixture.txt">Download</FeedbackLink>
<FeedbackLink id="external" href="https://example.invalid/">External</FeedbackLink>
<FeedbackLink id="legacy" href="/legacy" legacyBehavior><a title="Legacy child">Legacy</a></FeedbackLink>
<span id="layout-anchor">Anchor</span></div></AppRouterContext.Provider>;}
function App(){const[visible,setVisible]=useState(true);const[mounted,setMounted]=useState(true);const[working,setWorking]=useState(false);useEffect(()=>{window.hideShared=()=>setVisible(false);window.showShared=()=>setVisible(true);window.removeShared=()=>setMounted(false);window.setWorking=setWorking;},[]);return <>
<p data-fixture-visible>{mounted?(visible?'visible':'hidden'):'removed'}</p>
{mounted?<Activity mode={visible?'visible':'hidden'}><Links/><iframe name="result-frame" title="Native form result"/>
<NavigationForm id="hard-form" action="/capture" method="get" target="result-frame" data-custom="form-kept" ref={node=>{window.formRef=node;}}>
<input name="workspace_id" type="hidden" value="selected-workspace"/><input name="filter" defaultValue="keep value"/>
<NavigationSubmitButton id="hard-submit" name="mode" value="owner" pendingLabel="Opening workspace…" className="fixed-button" ref={node=>{window.buttonRef=node;}}>Open workspace</NavigationSubmitButton>
<NavigationSubmitButton id="hard-disabled" disabled>Disabled option</NavigationSubmitButton></NavigationForm>
<NavigationForm id="cancel-form" action="/capture" method="get" target="result-frame" onSubmit={event=>event.preventDefault()}><NavigationSubmitButton>Cancelled form</NavigationSubmitButton></NavigationForm>
<form id="server-form" action={async data=>{window.actionCalls.push(Object.fromEntries(data));await new Promise(resolve=>{window.finishAction=resolve;});}}>
<input name="record" type="hidden" value="unchanged-record"/><SubmitButton id="server-submit" name="intent" value="lock" className="fixed-button" pendingLabel="Locking…" title="Lock record">Lock record</SubmitButton></form>
<button id="presentational" className="fixed-button" type="button" aria-busy={working}><ActionFeedback pending={working} pendingLabel="Working on this…"><span data-original-child>Original action</span></ActionFeedback></button><span id="action-anchor">After action</span>
</Activity>:null}</>;}
document.addEventListener('click',event=>{const link=event.target.closest?.('a');if(link&&(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||link.hasAttribute('download')||link.href.startsWith('https:')))event.preventDefault();});
createRoot(document.getElementById('root')).render(<App/>);
` },
    jsx: 'automatic', bundle: true, write: false, platform: 'browser',
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.__NEXT_CACHE_COMPONENTS': 'true' },
    plugins: [{ name: 'actual-next-link-held-transport', setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: nextLink }));
      builder.onResolve({ filter: /^\.\.\/components\/(links|app-router-instance)$/ }, args => args.importer.replaceAll('\\', '/').endsWith('/app-dir/link.js') ? { path: args.path.endsWith('/links') ? 'link-instances' : 'dispatch', namespace: 'fixture' } : undefined);
      builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', resolveDir: root, contents: ({
        language: 'export const WorkspaceText=({text})=>text;export function useWorkspaceTranslation(){return value=>value;}',
        dispatch: 'export function dispatchNavigateAction(...args){window.transport.navigate(...args)}',
        'link-instances': `export const IDLE_LINK_STATUS={pending:false};export function mountLinkInstance(element,href,router,strategy,prefetch,setOptimisticLinkStatus){return{setOptimisticLinkStatus}};export function unmountLinkForCurrentNavigation(){};export function unmountPrefetchableInstance(){};export function onNavigationIntent(element){window.prefetches.push(element.id)};`,
      })[args.path] }));
    } }],
  });
  const submissions = [];
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
    } else if (request.url.startsWith('/capture')) {
      submissions.push({ method: request.method, url: request.url });
      response.setHeader('Content-Type', 'text/html'); response.end('<p>Received native GET</p>');
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<style>body{margin:8px}.fixed{position:fixed}.top-0{top:0}.inset-x-0{left:0;right:0}.block{display:block}.h-1{height:4px}.pointer-events-none{pointer-events:none}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.fixed-button{width:220px;height:52px}iframe{height:30px;width:240px}a{display:block}</style><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  try { await page.locator('#slow').waitFor({ timeout: 5000 }); }
  catch (error) {
    await browser.close(); await new Promise(resolve => server.close(resolve));
    throw new Error(`Shared fixture did not mount: ${errors.join('; ')}`, { cause: error });
  }
  return { page, errors, submissions, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

async function frames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

test('FeedbackLink uses real Next16 link status, respects cancellation and modifiers, and keeps forwarded DOM layout intact', { skip, timeout: 60_000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    assert.equal(await page.evaluate(() => window.linkRef === document.querySelector('#slow')), true);
    assert.equal(await page.locator('#slow').getAttribute('title'), 'Preserved title');
    assert.equal(await page.locator('#slow').getAttribute('data-custom'), 'kept');
    assert.equal(await page.locator('#slow').getAttribute('href'), '/slow');
    assert.equal(await page.locator('#legacy').count(), 0, 'legacy behavior preserves its original sole child instead of forcing attributes onto it');
    assert.equal(await page.getByRole('link', { name: 'Legacy', exact: true }).getAttribute('title'), 'Legacy child');
    for (const id of ['cancel-click', 'cancel-nav']) await page.locator('#' + id).click();
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) await page.locator('#slow').dispatchEvent('click', { ...modifiers, button: 0 });
    await page.locator('#download').click(); await page.locator('#external').click();
    await frames(page);
    assert.equal(await page.evaluate(() => window.linkCalls.length), 0);
    assert.equal(await page.getByRole('status').count(), 0);
    await page.locator('#fast').click(); await frames(page);
    assert.equal(await page.getByRole('status').count(), 0, 'a cached fast transport does not leave feedback stuck');
    const before = await page.locator('#link-layout').boundingBox();
    const anchor = await page.locator('#layout-anchor').boundingBox();
    await page.locator('#slow').click();
    await page.getByRole('status').waitFor();
    assert.deepEqual(await page.locator('#link-layout').boundingBox(), before);
    assert.deepEqual(await page.locator('#layout-anchor').boundingBox(), anchor);
    assert.equal(await page.locator('#slow [role=status]').count(), 0, 'feedback is a body portal rather than extra link layout');
    assert.deepEqual(await page.evaluate(() => window.linkEvents.slice(-2)), ['click', 'navigate']);
    assert.deepEqual(await page.evaluate(() => { const { href, replace, scroll, transitionTypes } = window.linkCalls.at(-1); return { href, replace, scroll, transitionTypes }; }), { href: '/slow', replace: 'replace', scroll: 1, transitionTypes: ['fixture'] });
    await page.locator('#other').click(); await frames(page);
    assert.equal(await page.getByRole('status').count(), 1, 'only the latest link remains pending');
    await page.evaluate(() => window.linkCalls.at(-1).finish());
    await page.getByRole('status').waitFor({ state: 'detached' });
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('FeedbackLink pending portal disappears when its retained view is hidden or removed', { skip, timeout: 60_000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    await page.locator('#slow').click(); await page.getByRole('status').waitFor();
    await page.evaluate(() => window.hideShared());
    await page.locator('[data-fixture-visible]').filter({ hasText: 'hidden' }).waitFor();
    assert.equal(await page.getByRole('status').count(), 0, 'a body portal cannot remain over the next page');
    await page.evaluate(() => window.linkCalls.at(-1).finish());
    await page.evaluate(() => window.showShared());
    await page.locator('#slow').waitFor();
    assert.equal(await page.getByRole('status').count(), 0);
    await page.locator('#slow').click(); await page.getByRole('status').waitFor();
    await page.evaluate(() => window.removeShared());
    await page.locator('[data-fixture-visible]').filter({ hasText: 'removed' }).waitFor();
    assert.equal(await page.getByRole('status').count(), 0);
    await page.evaluate(() => window.linkCalls.at(-1).finish());
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('NavigationForm preserves native GET submitter fields, guards repeats, and resets BFCache or Activity pending state', { skip, timeout: 60_000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    assert.equal(await page.evaluate(() => window.formRef === document.querySelector('#hard-form') && window.buttonRef === document.querySelector('#hard-submit')), true);
    assert.equal(await page.locator('#hard-form').getAttribute('data-custom'), 'form-kept');
    await page.getByRole('button', { name: 'Cancelled form', exact: true }).click();
    assert.equal(await page.locator('#cancel-form').getAttribute('aria-busy'), 'false');
    assert.equal(app.submissions.length, 0);
    await page.locator('#hard-submit').click();
    await page.waitForFunction(() => document.querySelector('#hard-form').getAttribute('aria-busy') === 'true');
    await page.frameLocator('iframe').getByText('Received native GET').waitFor();
    assert.equal(app.submissions.length, 1);
    const request = new URL(app.submissions[0].url, 'http://fixture.invalid');
    assert.equal(app.submissions[0].method, 'GET');
    assert.deepEqual(Object.fromEntries(request.searchParams), { workspace_id: 'selected-workspace', filter: 'keep value', mode: 'owner' }, 'feedback must not disable or remove the native successful submitter before serialization');
    assert.equal(await page.locator('#hard-submit').evaluate(button => button.disabled), false);
    assert.equal(await page.locator('#hard-submit').getAttribute('aria-disabled'), 'true');
    assert.equal(await page.locator('#hard-disabled').evaluate(button => button.disabled), true);
    await page.locator('#hard-form').evaluate(form => { form.requestSubmit(document.querySelector('#hard-submit')); form.requestSubmit(document.querySelector('#hard-submit')); });
    await frames(page);
    assert.equal(app.submissions.length, 1);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal(await page.locator('#hard-form').getAttribute('aria-busy'), 'false');
    await page.locator('#hard-submit').click();
    await page.waitForFunction(() => document.querySelector('#hard-form').getAttribute('aria-busy') === 'true');
    await page.evaluate(() => window.hideShared());
    await page.locator('[data-fixture-visible]').filter({ hasText: 'hidden' }).waitFor();
    await page.evaluate(() => window.showShared());
    await page.locator('#hard-submit').waitFor();
    assert.equal(await page.locator('#hard-form').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#hard-submit').getAttribute('aria-disabled'), 'false');
    assert.equal(await page.locator('input[name=filter]').inputValue(), 'keep value');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('ActionFeedback remains presentational and the real SubmitButton keeps React form action data and pending lifetime', { skip, timeout: 60_000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    const before = await page.locator('#presentational').boundingBox();
    const anchor = await page.locator('#action-anchor').boundingBox();
    await page.evaluate(() => window.setWorking(true));
    await page.getByText('Working on this…', { exact: true }).waitFor();
    assert.equal(await page.locator('#presentational span[aria-hidden=true]').count(), 1);
    assert.equal(await page.locator('#presentational').getAttribute('aria-busy'), 'true');
    assert.deepEqual(await page.locator('#presentational').boundingBox(), before);
    assert.deepEqual(await page.locator('#action-anchor').boundingBox(), anchor);
    assert.equal(await page.evaluate(() => window.actionCalls.length), 0);
    await page.evaluate(() => window.setWorking(false));
    await page.locator('[data-original-child]').waitFor();
    await page.locator('#server-submit').click();
    await page.getByRole('button', { name: 'Locking…', exact: true }).waitFor();
    assert.equal(await page.locator('#server-submit').isDisabled(), true);
    assert.equal(await page.locator('#server-submit').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#server-submit').getAttribute('title'), 'Lock record');
    assert.deepEqual(await page.evaluate(() => window.actionCalls), [{ record: 'unchanged-record', intent: 'lock' }]);
    await page.evaluate(() => window.finishAction());
    await page.getByRole('button', { name: 'Lock record', exact: true }).waitFor();
    assert.equal(await page.locator('#server-submit').isEnabled(), true);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
