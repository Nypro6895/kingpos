import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

test('actual Activity scope guards validate reveals, discard old auth results, block logout and recover from temporary failures', { timeout: 60_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{ExperienceScopeProvider,useExperienceScope}from'./components/experience-scope';
    import{ExperiencePageBoundary}from'./components/experience-page-boundary';
    window.requests=[];window.resumes=[];window.resets=[];window.reloads=0;
    window.captureReload=()=>window.reloads++;
    const current={scope:'account-one',viewerId:'one',workspaceId:'manage:one',salonId:'one',permissionRevision:'one',authenticated:true};
    window.currentContext=current;
    window.fetch=(url,options)=>new Promise((resolve,reject)=>{window.requests.push({url,options,resolve,reject})});
    window.finish=(index,context=current,status=200)=>window.requests[index].resolve(new Response(JSON.stringify(context),{status,headers:{'Content-Type':'application/json'}}));
    function Probe(){const scope=useExperienceScope();useEffect(()=>{window.forceValidate=()=>scope.validate(true)},[scope.validate]);return <div data-private=""><p>Private payroll</p><input aria-label="Local view state" defaultValue="original"/><details><summary>Show detail</summary><p>Private detail</p></details></div>}
    function App(){const[visible,setVisible]=useState(true);useEffect(()=>{window.ready=true},[]);return <><button onClick={()=>setVisible(value=>!value)}>{visible?'Hide view':'Show view'}</button><Activity mode={visible?'visible':'hidden'}><ExperienceScopeProvider context={current}><ExperiencePageBoundary renderRevision="server-one"><Probe/></ExperiencePageBoundary></ExperienceScopeProvider></Activity></>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: 'bundle.js', bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'scope-runtime-fixture', setup(b) {
    // Capture the one browser side effect while exercising the provider's real
    // validation/Activity logic. The deployed source is read without edits.
    b.onLoad({ filter: /components[\\/]experience-scope\.tsx$/ }, args => ({ resolveDir: process.cwd(), loader: 'tsx', contents: readFileSync(args.path, 'utf8')
      .replaceAll('window.location.reload();', 'window.captureReload();')
      .replace('const RETRY_DELAYS = [1_000, 3_000, 8_000];', 'const RETRY_DELAYS = [20, 40, 60];')
      .replaceAll('timeoutMs: 8_000', 'timeoutMs: 500').replaceAll('totalTimeoutMs: 8_000', 'totalTimeoutMs: 500') }));
    b.onResolve({ filter: /^(next\/navigation|.*reset-experience-cache|.*experience-resource-cache|.*loading-feedback)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir: process.cwd(), loader: 'tsx', contents:
      path === 'next/navigation' ? `const router={refresh(){window.routeRefreshes=(window.routeRefreshes??0)+1}};const search=new URLSearchParams();export const useRouter=()=>router;export const usePathname=()=>'/staff/today';export const useSearchParams=()=>search;`
      : path.endsWith('reset-experience-cache') ? `export const resetExperienceCaches=options=>window.resets.push(options);`
      : path.endsWith('experience-resource-cache') ? `export const resumeExperienceResources=scope=>window.resumes.push(scope);`
      : `import React from'react';export const PageLoadingSkeleton=()=>React.createElement('div',{'data-guard':''},'Checking context');`
    }));
  } }] });
  const js = result.outputFiles[0].text;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? js : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const useWebKit = process.env.TEST_BROWSER_ENGINE === 'webkit';
  const browser = await (useWebKit ? webkit : chromium).launch({ executablePath: process.env.TEST_BROWSER_PATH, ...(useWebKit ? {} : { args: ['--no-proxy-server'], channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const open = async () => {
      if (page.url() !== 'about:blank') await page.evaluate(() => sessionStorage.clear());
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.ready);
      assert.equal(await page.locator('[data-private]').isVisible(), true);
      assert.equal(await page.evaluate(() => window.requests.length), 0, 'a fresh server render does not refetch context');
    };

    await open();
    await page.getByLabel('Local view state').fill('retained edit');
    await page.evaluate(() => { window.originalView = document.querySelector('[data-private]'); window.originalView.querySelector('details').open = true; });
    await page.getByRole('button', { name: 'Hide view', exact: true }).click();
    await page.getByRole('button', { name: 'Show view', exact: true }).click();
    await page.waitForFunction(() => window.requests.length === 1);
    assert.equal(await page.locator('[data-private]').isVisible(), false, 'a retained private reveal waits for current authorization');
    await page.evaluate(() => window.finish(0));
    await page.waitForFunction(() => document.querySelector('[data-private]')?.getBoundingClientRect().height > 0);
    assert.equal(await page.getByLabel('Local view state').inputValue(), 'retained edit');
    assert.equal(await page.evaluate(() => document.querySelector('[data-private]') === window.originalView && window.originalView.querySelector('details').open), true);
    assert.deepEqual(await page.evaluate(() => window.resumes), ['account-one']);

    await page.getByRole('button', { name: 'Hide view', exact: true }).click();
    await page.getByRole('button', { name: 'Show view', exact: true }).click();
    await page.waitForFunction(() => window.requests.length === 2);
    await page.evaluate(() => window.finish(1, {}, 503));
    assert.equal(await page.locator('[data-private]').isVisible(), false);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => window.requests.length === 3);
    await page.evaluate(() => window.finish(2));
    await page.waitForFunction(() => document.querySelector('[data-private]')?.getBoundingClientRect().height > 0);
    assert.equal(await page.getByLabel('Local view state').inputValue(), 'retained edit', 'successful later validation releases the auth gate without remounting view state');

    await open();
    await page.evaluate(() => { void window.forceValidate(); });
    await page.waitForFunction(() => window.requests.length === 1);
    await page.evaluate(() => window.finish(0, {}, 503));
    await page.waitForFunction(() => window.requests.length === 2);
    assert.equal(await page.locator('[data-private]').isVisible(), false);
    assert.equal(await page.evaluate(() => navigator.onLine), true);
    await page.evaluate(() => window.finish(1));
    await page.waitForFunction(() => document.querySelector('[data-private]')?.getBoundingClientRect().height > 0);
    assert.deepEqual(await page.evaluate(() => ({ resets: window.resets, reloads: window.reloads })), { resets: [], reloads: 0 }, '503 recovers automatically while still online without invalidating identity');

    await open();
    await page.evaluate(() => { void window.forceValidate(); });
    await page.waitForFunction(() => window.requests.length === 4 && window.requests.every(request => request.options.signal.aborted));
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    assert.equal(await page.locator('[data-private]').isVisible(), false);
    await page.waitForTimeout(180);
    assert.equal(await page.evaluate(() => window.requests.length), 4, 'automatic retry stops after the capped budget');
    assert.deepEqual(await page.evaluate(() => ({ resets: window.resets, reloads: window.reloads, resumes: window.resumes })), { resets: [], reloads: 0, resumes: [] });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.waitForFunction(() => window.requests.length === 5);
    await page.evaluate(() => window.finish(4));
    await page.waitForFunction(() => document.querySelector('[data-private]')?.getBoundingClientRect().height > 0);

    await open();
    await page.evaluate(() => { void window.forceValidate(); });
    await page.waitForFunction(() => window.requests.length === 1);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:experience-access-changed')));
    await page.waitForFunction(() => window.requests.length === 2);
    assert.equal(await page.locator('[data-private]').isVisible(), false);
    await page.evaluate(() => window.finish(0, { ...window.currentContext, scope: 'old-response-other-account' }));
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => ({ reloads: window.reloads, resumes: window.resumes })), { reloads: 0, resumes: [] }, 'an earlier request cannot reload or resume after access invalidation');
    await page.evaluate(() => window.finish(1));
    await page.waitForFunction(() => window.reloads === 1);
    assert.deepEqual(await page.evaluate(() => window.resumes), [], 'access rejection reloads fresh server data before resuming resource reads');
    assert.equal(await page.locator('[data-private]').isVisible(), false);

    await open();
    await page.evaluate(() => { void window.forceValidate(); });
    await page.waitForFunction(() => window.requests.length === 1);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:experience-scope-changed')));
    await page.waitForFunction(() => window.requests.length === 2);
    await page.evaluate(() => window.finish(0, { ...window.currentContext, scope: 'before-mutation-context' }));
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => ({ reloads: window.reloads, resumes: window.resumes })), { reloads: 0, resumes: [] }, 'a context request that predates the mutation cannot renew authorization');
    await page.evaluate(() => window.finish(1));
    await page.waitForFunction(() => window.resumes.length === 1);
    assert.equal(await page.evaluate(() => window.reloads), 0);

    await open();
    await page.evaluate(() => { void window.forceValidate(); });
    await page.waitForFunction(() => window.requests.length === 1);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:experience-reset', { detail: { reason: 'logout' } })));
    await page.waitForFunction(() => window.requests.length === 2);
    assert.equal(await page.locator('[data-private]').isVisible(), false, 'logout hides the previous private view before the request completes');
    await page.evaluate(() => window.finish(0));
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.resumes), []);
    await page.evaluate(() => window.finish(1, { ...window.currentContext, scope: 'anonymous', authenticated: false, viewerId: null }));
    await page.waitForFunction(() => window.reloads === 1);
    assert.equal(await page.locator('[data-private]').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.resets.at(-1)), { suspend: true, reason: 'identity', notify: false });

    await open();
    await page.evaluate(() => { void window.forceValidate(); });
    await page.waitForFunction(() => window.requests.length === 1);
    await page.evaluate(() => window.finish(0, { ...window.currentContext, scope: 'changed-grants', permissionRevision: 'changed' }));
    await page.waitForFunction(() => window.reloads === 1);
    assert.equal(await page.locator('[data-private]').isVisible(), false, 'changed grants hide retained DOM before document reload');
    assert.deepEqual(await page.evaluate(() => window.resumes), []);

    await open();
    await page.evaluate(() => { void window.forceValidate(); });
    await page.waitForFunction(() => window.requests.length === 1);
    await page.evaluate(() => window.finish(0, {}, 403));
    await page.waitForFunction(() => window.reloads === 1);
    assert.equal(await page.locator('[data-private]').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => window.resets.at(-1)), { suspend: true, reason: 'permissions', notify: false });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
