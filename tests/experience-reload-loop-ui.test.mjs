import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

const idleMs = Math.max(4600, Math.min(120_000, Number(process.env.TEST_EXPERIENCE_SOAK_MS) || 4600));

test('background actions retain the page and live cache while confirmed access changes remain blocking and reloads are bounded', { timeout: idleMs + 90_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
    import{ExperienceScopeProvider,useExperienceScope}from'./components/experience-scope';
    import{ExperiencePageBoundary}from'./components/experience-page-boundary';
    import{SessionExpiryPrompt}from'./components/session-expiry-prompt';
    import{ExploreAccountActionsProvider,ExploreSalonLove}from'./components/explore-account-actions';
    import{OwnerCampaignRuntime}from'./components/owner-campaign-runtime';
    import{requestExploreFeed}from'./lib/explore-feed-client';
    import{fetchExploreSearchPage}from'./lib/explore-search-client';
    import{experienceResourceCache,ExperienceResourceAccessError}from'./lib/experience-resource-cache';
    import{useExperienceResource}from'./lib/use-experience-resource';
    const current={scope:'account-one',viewerId:'one',workspaceId:'personal:one',salonId:null,permissionRevision:'same-grants',authenticated:true};
    const adminCurrent={...current,scope:'admin-one',admin:true};
    const initial={value:1},initialAt=Date.now();
    window.currentContext=current;window.serverContext=current;window.serverAdminContext=adminCurrent;window.cache=experienceResourceCache;
    window.contextStatus=200;window.resourceStatus=200;window.resourceVersion=1;window.sessionAuthenticated=true;window.holdContext=false;window.pendingContexts=[];
    window.diag={requests:[],mutations:0,scopeChanges:0,effectMounts:0,effectCleanups:0,adminCleanups:0,reloads:0,routeRefreshes:0};
    window.captureReload=()=>window.diag.reloads++;
    window.addEventListener('reylumi:experience-mutation',()=>window.diag.mutations++);
    window.addEventListener('reylumi:experience-scope-changed',()=>window.diag.scopeChanges++);
    window.fetch=async(input,options={})=>{
      const url=new URL(input instanceof Request?input.url:String(input),document.baseURI);const target=url.pathname;
      const requestHeaders=new Headers(options.headers);const action=requestHeaders.get('Next-Action');
      const method=options.method??'GET';
      window.diag.requests.push({target,method,action,admin:url.searchParams.get('admin')==='1',body:options.body??null});
      let controlled;
      if(target==='/api/experience/context'&&window.holdContext)controlled=await new Promise(resolve=>window.pendingContexts.push(resolve));
      else await new Promise(resolve=>setTimeout(resolve,target==='/api/experience/context'?80:15));
      const headers=new Headers({'Content-Type':'application/json'});let status=200,result={items:[],hasMore:false};
      if(target==='/api/experience/context'){status=controlled?.status??window.contextStatus;result=controlled?.context??(url.searchParams.get('admin')==='1'?window.serverAdminContext:window.serverContext)}
      else if(target==='/api/auth/session')result={authenticated:window.sessionAuthenticated};
      else if(target==='/api/explore/search')result={searchVersion:3,target:'salons',results:[],hasMore:false};
      else if(target==='/api/fixture-resource'){status=window.resourceStatus;result={value:window.resourceVersion}}
      else if(target==='/api/auth/logout'){window.sessionAuthenticated=false;window.serverContext={...current,scope:'guest',viewerId:null,authenticated:false}}
      else if(action){
        const args=JSON.parse(options.body??'[]');result=action==='campaign-prompt'?null:{active:args[1]??false,error:null};
        if(args[1]!==undefined){headers.set('x-action-revalidated','1');window.resourceVersion++}
      }else if(target==='/api/fixture-write'){window.resourceVersion++;headers.set('x-reylumi-experience-change','data')}
      else if(target==='/api/fixture-scope'){headers.set('x-reylumi-experience-change','scope')}
      return new Response(JSON.stringify(result),{status,headers});
    };
    window.requestFeed=mode=>requestExploreFeed({mode,cursor:'fixture-session',events:[{contentKey:'fixture',kind:'meaningful_view'}]});
    window.requestSearch=()=>fetchExploreSearchPage({query:'nails'},new AbortController().signal);
    window.writeData=()=>fetch('/api/fixture-write',{method:'POST'});
    window.changeScope=()=>fetch('/api/fixture-scope',{method:'POST'});
    window.finishContext=result=>window.pendingContexts.shift()?.(result);
    window.invalidateResource=()=>experienceResourceCache.invalidate({scope:current.scope,tags:['fixture']});
    experienceResourceCache.seed({scope:'other-account',key:'other-resource'},{value:'untouched'},{tags:['fixture'],freshForMs:300000});
    function Probe(){
      const scope=useExperienceScope();
      useEffect(()=>{window.forceValidate=()=>scope.validate(true)},[scope.validate]);
      const resource=useExperienceResource({scope:current.scope,key:'fixture-resource',tags:['fixture'],initialData:initial,initialUpdatedAt:initialAt,freshForMs:60000,fetcher:async({signal})=>{
        const response=await fetch('/api/fixture-resource',{signal});
        if([401,403,409].includes(response.status))throw new ExperienceResourceAccessError(response.status);
        if(!response.ok)throw Error('Temporary resource failure');return{data:await response.json()};
      }});
      useEffect(()=>{window.diag.effectMounts++;return()=>window.diag.effectCleanups++},[]);
      return <section data-content><input aria-label="Draft" defaultValue="original"/><output data-resource>{resource.data?.value??'hidden'}</output><div data-scroll style={{height:150,overflow:'auto'}}><div style={{height:1000}}>Retained reading position</div></div></section>;
    }
    function AdminProbe(){useEffect(()=>()=>window.diag.adminCleanups++,[]);return <p data-admin>Authorized admin page</p>}
    function App(){
      const mode=window.__fixtureMode??new URLSearchParams(location.search).get('mode');const[visible,setVisible]=useState(true);
      useEffect(()=>{window.ready=true},[]);
      return <><button onClick={()=>setVisible(value=>!value)}>{visible?'Hide route':'Show route'}</button><Activity mode={visible?'visible':'hidden'}><ExperienceScopeProvider context={current}><SessionExpiryPrompt authenticated/><ExperiencePageBoundary renderRevision="one"><Probe/>{mode==='idle'?<><ExploreAccountActionsProvider authenticated><ExploreSalonLove salonId="11111111-1111-1111-1111-111111111111" name="Fixture Salon"/></ExploreAccountActionsProvider><OwnerCampaignRuntime scope="salon:user" settings={{enabled:true}} location={{city:'',state:'',country:'US'}}/></>:null}{mode==='nested'?<ExperienceScopeProvider context={adminCurrent}><AdminProbe/></ExperienceScopeProvider>:null}</ExperiencePageBoundary></ExperienceScopeProvider></Activity></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: 'bundle.js', bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'reload-loop-fixture', setup(b) {
    // Keep the actual auth, Activity and resource-cache logic. Capture navigation
    // and shorten only retry delays so failure recovery can be exercised quickly.
    b.onLoad({ filter: /components[\\/]experience-scope\.tsx$/ }, args => ({ resolveDir: process.cwd(), loader: 'tsx', contents: readFileSync(args.path, 'utf8')
      .replaceAll('window.location.reload()', 'window.captureReload()')
      .replace('const RETRY_DELAYS = [1_000, 3_000, 8_000];', 'const RETRY_DELAYS = [20, 40, 60];') }));
    b.onResolve({ filter: /^(next\/navigation|.*loading-feedback|.*workspace-language|.*login-form|.*auth-intent-prompt|.*reylumi-icons|.*quick-booking-client|.*app\/explore\/account-actions|.*app\/saved-post\/actions|.*app\/campaigns\/actions|.*owner-campaign-dialog)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir: process.cwd(), loader: 'tsx', contents:
      path === 'next/navigation' ? `const router={refresh(){window.diag.routeRefreshes++}};const search=new URLSearchParams();export const useRouter=()=>router;export const usePathname=()=>'/explore';export const useSearchParams=()=>search;`
      : path.endsWith('loading-feedback') ? `export const PageLoadingSkeleton=()=> <div data-guard>Checking context</div>;`
      : path.endsWith('workspace-language') ? `export const useWorkspaceTranslation=()=>x=>x;export const WorkspaceText=({text})=><>{text}</>;`
      : path.endsWith('login-form') ? `export const LoginForm=()=>null;`
      : path.endsWith('auth-intent-prompt') ? `export const AuthIntentPrompt=()=>null;`
      : path.endsWith('reylumi-icons') ? `export const ReylumiIcon=()=>null;`
      : path.endsWith('quick-booking-client') ? `export const openQuickBooking=()=>{};`
      : path.endsWith('app/explore/account-actions') ? `const action=async(kind,args)=>(await fetch('/explore',{method:'POST',headers:{'Next-Action':kind},body:JSON.stringify(args)})).json();export const salonLoveAction=(...args)=>action('salon-love',args);export const referenceLoveAction=(...args)=>action('reference-love',args);`
      : path.endsWith('app/saved-post/actions') ? `export const setAccountSavedPostAction=()=>Promise.resolve({active:false});`
      : path.endsWith('app/campaigns/actions') ? `export const ownerCampaignPromptAction=async()=>(await fetch('/explore',{method:'POST',headers:{'Next-Action':'campaign-prompt'}})).json();export const dismissCampaignPromptAction=()=>Promise.resolve();`
      : `export const OwnerCampaignDialog=()=>null;`
    }));
  } }] });
  const js = result.outputFiles[0].text;
  if (process.env.TEST_EXPERIENCE_FIXTURE_EXPORT) {
    writeFileSync(process.env.TEST_EXPERIENCE_FIXTURE_EXPORT, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script>window.__fixtureMode="idle";</script><script>' + js.replaceAll('</script', '<\\/script') + '</script></body></html>');
  }
  if (process.env.TEST_EXPERIENCE_FIXTURE_EXPORT_ONLY === '1') return;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? js : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const useWebKit = process.env.TEST_BROWSER_ENGINE === 'webkit';
  const browser = await (useWebKit ? webkit : chromium).launch({ executablePath: process.env.TEST_BROWSER_PATH, ...(useWebKit ? {} : { args: ['--no-proxy-server'], channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome' }), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(15_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const open = async (mode = 'reads', preserveStorage = false) => {
      if (!preserveStorage && page.url() !== 'about:blank') await page.evaluate(() => sessionStorage.clear());
      await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
      await page.waitForFunction(() => window.ready);
      await page.locator('[data-content]').waitFor({ state: 'visible' });
    };
    const contextCount = () => page.evaluate(() => window.diag.requests.filter(request => request.target === '/api/experience/context').length);
    const saveView = async () => {
      await page.getByLabel('Draft').fill('unsaved edit');
      await page.evaluate(() => { window.originalContent = document.querySelector('[data-content]'); document.querySelector('[data-scroll]').scrollTop = 345; });
    };
    const assertRetained = async () => {
      assert.equal(await page.locator('[data-content]').isVisible(), true);
      assert.equal(await page.getByLabel('Draft').inputValue(), 'unsaved edit');
      assert.equal(await page.evaluate(() => document.querySelector('[data-content]') === window.originalContent), true);
      assert.equal(await page.locator('[data-scroll]').evaluate(element => element.scrollTop), 345);
    };

    await open('idle');
    await saveView();
    await page.evaluate(() => {
      window.soakSearch = setInterval(() => { void window.requestSearch(); }, 2500);
      window.soakTelemetry = setInterval(() => { void window.requestFeed('events'); }, 5000);
    });
    await page.waitForTimeout(idleMs);
    await page.evaluate(() => { clearInterval(window.soakSearch); clearInterval(window.soakTelemetry); });
    const idle = await page.evaluate(() => window.diag);
    assert.equal(idle.requests.filter(request => request.action === 'salon-love').length, 1, 'the real favorite read must not restart its own effect');
    assert.equal(idle.requests.filter(request => request.action === 'campaign-prompt').length, 1, 'the real two-second campaign check must not schedule itself again');
    assert.equal(idle.effectCleanups, 0);
    assert.equal(idle.mutations, 0);
    assert.equal(idle.reloads, 0);
    await assertRetained();

    await page.evaluate(async () => {
      for (const mode of ['page', 'updates', 'events']) await window.requestFeed(mode);
      await window.requestSearch();
      await fetch('/api/explore/area', { method: 'POST', body: '{}' });
      await fetch('/api/explore/advertising', { method: 'POST', body: '{}' });
      await fetch('/api/pos/windows-download', { method: 'POST', body: JSON.stringify({ action: 'check' }) });
    });
    assert.equal(await contextCount(), 0);
    assert.equal(await page.evaluate(() => window.diag.effectCleanups), 0);
    assert.equal(await page.evaluate(() => window.diag.mutations), 0);
    await assertRetained();

    // A real favorite click sends Next's revalidation header. The current live
    // cache must refresh without dropping input, scroll or another scope's seed.
    await page.getByRole('button', { name: 'Love Fixture Salon', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-resource]').textContent === '2');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.diag.mutations), 1);
    assert.equal(await page.evaluate(() => window.diag.effectCleanups), 0);
    assert.equal(await page.evaluate(() => window.cache.get({ scope: 'other-account', key: 'other-resource' }).fresh), true);
    await assertRetained();

    // A read and mutation in flight at the same time keep their classifications.
    await page.evaluate(async () => { await Promise.all([window.requestSearch(), window.writeData()]); });
    await page.waitForFunction(() => document.querySelector('[data-resource]').textContent === '3');
    assert.equal(await page.evaluate(() => window.diag.mutations), 2);
    assert.equal(await page.evaluate(() => window.diag.effectCleanups), 0);
    await assertRetained();

    await page.getByRole('button', { name: 'Hide route', exact: true }).click();
    await page.getByRole('button', { name: 'Show route', exact: true }).click();
    await page.locator('[data-content]').waitFor({ state: 'visible' });
    await assertRetained();

    // Root and admin scopes share a session but use different grant digests.
    // A current-session save checks both, while an unrelated resource rejection
    // cannot block either of them or clear the current page's retained state.
    await open('nested'); await saveView();
    await page.evaluate(async () => { await window.writeData(); });
    await page.waitForFunction(() => window.diag.requests.filter(request => request.target === '/api/experience/context').length === 2);
    await page.waitForTimeout(120);
    assert.deepEqual(await page.evaluate(() => window.diag.requests.filter(request => request.target === '/api/experience/context').map(request => request.admin).sort()), [false, true]);
    assert.equal(await page.evaluate(() => window.diag.effectCleanups + window.diag.adminCleanups), 0);
    assert.equal(await page.locator('[data-admin]').isVisible(), true);
    await assertRetained();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:experience-access-changed', { detail: { scope: 'unrelated-scope', status: 403 } })));
    await page.waitForTimeout(120);
    assert.equal(await contextCount(), 2);
    assert.equal(await page.evaluate(() => window.diag.reloads), 0);
    assert.equal(await page.locator('[data-admin]').isVisible(), true);
    await assertRetained();

    // An unavailable background context check is not proof of changed identity.
    await open(); await saveView();
    await page.evaluate(async () => { window.contextStatus = 503; await window.writeData(); });
    await page.waitForFunction(() => window.diag.requests.filter(request => request.target === '/api/experience/context').length === 1);
    await page.waitForTimeout(200);
    assert.equal(await contextCount(), 1, 'temporary background failure does not create an automatic request loop');
    assert.equal(await page.evaluate(() => window.diag.reloads), 0);
    await assertRetained();
    await page.evaluate(() => { window.contextStatus = 200; window.dispatchEvent(new Event('online')); });
    await page.waitForFunction(() => window.diag.requests.filter(request => request.target === '/api/experience/context').length === 2);
    await page.waitForTimeout(120);
    await assertRetained();

    // Known security invalidation blocks before validation completes, then an
    // unavailable check recovers without replacing the retained page instance.
    await open(); await saveView();
    await page.evaluate(() => { window.contextStatus = 503; window.dispatchEvent(new Event('reylumi:experience-scope-changed')); });
    await page.locator('[data-content]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.diag.requests.filter(request => request.target === '/api/experience/context').length === 4);
    await page.getByText('Please check your connection and try again.', { exact: true }).waitFor();
    assert.equal(await contextCount(), 4);
    assert.equal(await page.evaluate(() => window.diag.reloads), 0);
    await page.evaluate(() => { window.contextStatus = 200; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('[data-content]').waitFor({ state: 'visible' });
    await assertRetained();

    // A foreground check can join an in-flight background check. A 503 must
    // retain the foreground retry budget instead of leaving an invisible page.
    await open(); await saveView();
    await page.evaluate(async () => { window.holdContext = true; await window.writeData(); });
    await page.waitForFunction(() => window.pendingContexts.length === 1);
    await page.evaluate(() => { void window.forceValidate(); });
    await page.locator('[data-content]').waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.contextStatus = 503; window.holdContext = false; window.finishContext({ status: 503 }); });
    await page.waitForFunction(() => window.diag.requests.filter(request => request.target === '/api/experience/context').length === 4);
    await page.getByText('Please check your connection and try again.', { exact: true }).waitFor();
    await page.evaluate(() => { window.contextStatus = 200; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator('[data-content]').waitFor({ state: 'visible' });
    await assertRetained();

    // A pre-save request may finish after a mutation. Its obsolete account
    // result cannot reload or authorize the view; only the newer request wins.
    await open(); await saveView();
    await page.evaluate(async () => { window.holdContext = true; await window.writeData(); });
    await page.waitForFunction(() => window.pendingContexts.length === 1);
    await page.evaluate(async () => { await window.writeData(); });
    await page.waitForFunction(() => window.pendingContexts.length === 2);
    await page.evaluate(() => { void window.forceValidate(); });
    await page.locator('[data-content]').waitFor({ state: 'hidden' });
    await page.evaluate(() => window.finishContext({ context: { ...window.currentContext, scope: 'obsolete-account', viewerId: 'obsolete' } }));
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.diag.reloads), 0);
    assert.equal(await page.locator('[data-content]').isVisible(), false);
    await page.evaluate(() => { window.holdContext = false; window.finishContext(); });
    await page.locator('[data-content]').waitFor({ state: 'visible' });
    await assertRetained();

    // Explicit scope responses and cross-tab/session reset signals remain gates.
    await open();
    await page.evaluate(async () => { window.holdContext = true; await window.changeScope(); });
    await page.locator('[data-content]').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.diag.scopeChanges), 1);
    await page.evaluate(() => { window.holdContext = false; window.finishContext(); });
    await page.locator('[data-content]').waitFor({ state: 'visible' });

    for (const reason of ['logout', 'identity', 'permissions']) {
      await open();
      await page.evaluate(reason => { window.holdContext = true; window.dispatchEvent(new CustomEvent('reylumi:experience-reset', { detail: { reason, suspended: true } })); }, reason);
      await page.locator('[data-content]').waitFor({ state: 'hidden' });
      await page.evaluate(() => { window.holdContext = false; window.finishContext(); });
      await page.locator('[data-content]').waitFor({ state: 'visible' });
    }

    // A successful logout response cannot leave the old account visible.
    await open();
    await page.evaluate(async () => { window.holdContext = true; await fetch('/api/auth/logout', { method: 'POST' }); });
    await page.locator('[data-content]').waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.holdContext = false; window.finishContext(); });
    await page.waitForFunction(() => window.diag.reloads === 1);
    assert.equal(await page.locator('[data-content]').isVisible(), false);

    // All resource authorization rejection statuses hide the resource and route.
    for (const status of [401, 403, 409]) {
      await open();
      await page.evaluate(status => { window.resourceStatus = status; window.holdContext = true; window.invalidateResource(); }, status);
      await page.locator('[data-content]').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => window.cache.get({ scope: 'account-one', key: 'fixture-resource' })), undefined);
      await page.evaluate(() => { window.holdContext = false; window.finishContext(); });
      await page.waitForFunction(() => window.diag.reloads === 1);
      assert.equal(await page.locator('[data-content]').isVisible(), false);
    }

    // A confirmed grant change gets one automatic navigation. A second document
    // with the same bad server context stays blocked for explicit recovery.
    await open();
    const changeGrants = () => page.evaluate(() => { window.serverContext = { ...window.currentContext, permissionRevision: 'revoked', scope: 'revoked-grants' }; window.dispatchEvent(new Event('reylumi:experience-scope-changed')); });
    await changeGrants();
    await page.waitForFunction(() => window.diag.reloads === 1);
    assert.equal(await page.locator('[data-content]').isVisible(), false);
    await open('reads', true);
    await changeGrants();
    await page.getByText('Your access has changed. Reload to continue.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.diag.reloads), 0, 'session storage bounds the same fault across full document navigation');
    assert.equal(await page.locator('[data-content]').isVisible(), false);
    await page.evaluate(() => { window.serverContext = window.currentContext; window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(180);
    assert.equal(await page.locator('[data-content]').isVisible(), false, 'automatic recovery cannot reveal stale rejected server props');
    assert.equal(await page.evaluate(() => window.diag.reloads), 0);
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    assert.equal(await page.evaluate(() => window.diag.reloads), 1, 'the user can explicitly request recovery after the automatic budget is spent');

    await open();
    await page.evaluate(() => { Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } }); });
    await changeGrants();
    await page.getByText('Your access has changed. Reload to continue.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.diag.reloads), 0, 'storage failure cannot permit an unbounded cross-document reload');
    assert.equal(await page.locator('[data-content]').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
