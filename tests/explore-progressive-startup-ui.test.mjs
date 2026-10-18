import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('mobile startup retains the typed search, reserves reading state, prioritizes visible media and gates adaptive prefetch', { timeout: 60_000 }, async () => {
  const salon = n => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name: `Salon ${n}`, hasPublicProfile: true, serviceCategories: ['Nails'], serviceNames: [], city: 'Madison', state: 'WI', addressLine1: 'Main Street', addressLine2: null, postalCode: null, phone: null, coverImageUrl: '/cover.svg', bookingEnabled: false, logoImageUrl: null, operatingStatus: null, homeRank: n, homeSection: 'recommended' });
  const home = { error: null, inspiration: { items: [], error: null, hasMore: false, nextCursor: null }, recommendedSalons: [salon(1), salon(2), salon(3)], newSalons: [], popularServices: [] };
  const initial = { commentViewer: { userId: null, isAuthenticated: false, canModerate: false, canReplyAsSalon: false }, discoveryContent: { shortcuts: [] }, homeContent: home, initialFeed: { items: [], error: null, hasMore: false, nextCursor: null }, initialLocationSource: 'none', hasUrlLocation: false, initialSearchMode: false, initialResponse: { query: '', displayQuery: '', category: '', location: '', page: 1, pageSize: 4, results: [], error: null, totalCount: 0, totalPages: 1, sections: { bestMatches: [], nearby: [], recommended: [] }, groupCounts: { bestMatches: 0, nearby: 0, recommended: 0 }, sort: 'relevance', target: 'salons' }, quickActions: [], workspaceLocation: { label: '', source: 'none' } };
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Suspense,use,useState,useRef,useEffect}from'react';import{createRoot}from'react-dom/client';
    import{ExploreStartupShell}from'./app/explore/explore-startup-shell';
    import{ExploreProgressiveClient}from'./app/explore/explore-progressive-client';
    import{ExploreAutoLoad}from'./app/explore/explore-auto-load';
    import{recordExploreLoadDuration,useExploreVisibleAfterFirstContent}from'./lib/explore-viewport-priority';
    import{ExploreViewportImage}from'./app/explore/explore-viewport-image';
    window.calls=[];let finishCore,finishExtras,finishFeed;
    const core=new Promise(resolve=>finishCore=resolve),extras=new Promise(resolve=>finishExtras=resolve),feed=new Promise(resolve=>finishFeed=resolve);
    // The editorial directory displays three salons. Change that visible batch
    // so the test observes deferred extras without assuming an unlimited list.
    window.finishCore=()=>finishCore(${JSON.stringify(initial)});window.finishExtras=()=>finishExtras({homeContent:${JSON.stringify({ ...home, recommendedSalons: [1, 4, 2, 3, 5, 6].map(salon) })},discoveryContent:{shortcuts:[]},quickActions:[]});
    window.finishFeed=()=>finishFeed({items:[{id:'seed-one',caption:'Prepared first post'}],sessionCursor:'server-seed',nextCursor:null,hasMore:false,error:null});window.slow=()=>recordExploreLoadDuration(2000);
    function Ready(){const initial=use(core);return <ExploreProgressiveClient initial={initial} extras={extras} feed={feed}/>}
    function OptionalProbe(){const ref=useRef(null);const ready=useExploreVisibleAfterFirstContent(ref);useEffect(()=>{if(ready)window.optionalStarted=true},[ready]);return <div ref={ref} style={{position:'absolute',top:1400,width:300}}><ExploreViewportImage src="/cover.svg" alt="Offscreen eager hero probe" width={300} height={180} loading="eager"/></div>}
    function App(){const[generation,setGeneration]=useState(1);window.nextProbe=()=>setGeneration(value=>value+1);return <><Suspense fallback={<ExploreStartupShell query="" category="All" location="" source="none" viewerId={null}/>}><Ready/></Suspense><div style={{position:'absolute',top:300,width:300}}><ExploreViewportImage src="/cover.svg" alt="Visible media probe" width={300} height={180}/></div><div style={{position:'absolute',top:1100}}><ExploreAutoLoad progressKey={generation} onLoad={()=>window.calls.push(generation)}/></div><OptionalProbe/><div style={{height:1600}}/></>}
    document.body.dataset.reylumiShellReady='true';createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: 'bundle.js', bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env': '{}' }, alias: { '@': process.cwd() }, plugins: [{ name: 'progressive-ui-fixture', setup(b) {
    b.onResolve({ filter: /^(next\/navigation|next\/link|next\/image|next\/dynamic|.*\/actions|.*social-actions|.*block-actions|.*post-comment-thread|.*post-actions|.*post-safety|.*explore-account-actions|.*explore-advertising|.*save-post-button|.*salon-operating-status-badge|.*workspace-language|.*nail-inspiration|.*explore-feed)$/ }, args => args.path === '@/lib/nail-inspiration' ? undefined : ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir: process.cwd(), loader: 'tsx', contents:
      path === 'next/navigation' ? `const router={push(url){window.navigated=url},replace(url){window.navigated=url}};const search=new URLSearchParams();export const useRouter=()=>router;export const usePathname=()=>'/explore';export const useSearchParams=()=>search;`
      : path === 'next/link' ? `import React from'react';export default({children,prefetch,...props})=><a {...props}>{children}</a>;`
      : path === 'next/image' ? `import React from'react';export default function Image({fill,preload,sizes,ref,...props}){return <img {...props} ref={ref} style={{display:'block',width:'100%',height:180,objectFit:'cover'}}/>}`
      : path === 'next/dynamic' ? `export default()=>()=>null;`
      : path.endsWith('social-actions') ? `export const setExploreSalonPreferenceAction=async()=>({error:null});`
      : path.endsWith('block-actions') ? `export const setUserBlocked=async()=>({error:null});`
      : path.endsWith('post-comment-thread') ? `export const PostCommentThread=()=>null;`
      : path.endsWith('workspace-language') ? `export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='div',children,...props})=><Tag {...props}>{children}</Tag>;export const useWorkspaceTranslation=()=>text=>text;`
      : path.endsWith('nail-inspiration') ? `export const NailInspirationCard=()=>null;export const NailSearchInspiration=()=>null;export const NailInspirationFilters=()=>null;export const useNailInspiration=()=>({supported:false,posts:[],footer:null,lookIds:[]});`
      : path.endsWith('explore-feed') ? `export const ExploreFeedCard=()=>null;export const ExploreFeedSkeleton=()=> <div>Loading first batch</div>;export const ExploreFeed=({initialPage})=><div>{initialPage.items.map(item=><p key={item.id}>{item.caption}</p>)}</div>;`
      : path.endsWith('post-safety') ? `export const useHiddenPosts=()=>({hiddenKeys:new Set(),hidePost(){}});export const postIdentity=()=>'';`
      : path.endsWith('save-post-button') ? `export const SavePostAuthProvider=({children})=>children;export const SavePostButton=()=>null;`
      : `export const rememberExplorePreferenceAction=async()=>{};export const PostActions=()=>null;export const ExploreBookButton=()=>null;export const ExploreSalonLove=()=>null;export const ExploreAdSlot=()=>null;export const SalonOperatingStatusBadge=()=>null;`
    }));
  } }] });
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const server = createServer((request, response) => {
    if (request.url === '/cover.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="180"><rect width="400" height="180" fill="pink"/></svg>'); return; }
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? js : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;font:16px Arial}main{padding:12px}.hidden{display:none}.xl\\:hidden{display:block}.xl\\:block,.xl\\:grid{display:none}article{margin:12px 0;border:1px solid #ddd;padding:12px}article a{display:block}button,input{font-size:16px}[data-testid="desktop-discovery-marketplace"]{display:none}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome', headless: true, args: ['--no-proxy-server'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Search salons, services, cities, states, ZIP or ideas').fill('typed while loading');
    assert.deepEqual(await page.evaluate(() => window.calls), [], 'continuation does not prefetch while only the public startup shell exists');
    assert.equal(await page.getByAltText('Offscreen eager hero probe').getAttribute('loading'), 'lazy');
    assert.equal(await page.getByAltText('Offscreen eager hero probe').getAttribute('fetchpriority'), 'low');
    assert.equal(await page.evaluate(() => !!window.optionalStarted), false);
    await page.evaluate(() => window.finishCore());
    await page.getByText('Salon 1', { exact: true }).first().waitFor();
    assert.equal(await page.getByLabel('Search salons, services, cities, states, ZIP or ideas').inputValue(), 'typed while loading');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'explore-search-query');
    await page.waitForFunction(() => document.querySelector('[data-explore-first-content-ready="true"]'));
    await page.waitForFunction(() => window.calls.length === 1);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 350); window.finishExtras(); });
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('Salon 4', { exact: true }).count(), 0, 'late home expansion does not prepend cards while the user reads below the top');
    assert.equal(await page.evaluate(() => scrollY), 350);
    await page.evaluate(() => { window.scrollTo(0, 0); window.finishFeed(); });
    await page.getByText('Prepared first post', { exact: true }).waitFor();
    await page.getByText('Salon 4', { exact: true }).first().waitFor();
    await page.waitForFunction(() => document.querySelector('img[alt="Visible media probe"]')?.getAttribute('fetchpriority') === 'high');
    const priority = await page.locator('[data-explore-media]').evaluateAll(images => images.map(image => ({ top: image.getBoundingClientRect().top, loading: image.loading, priority: image.getAttribute('fetchpriority') })));
    assert.equal(priority.some(image => image.top < 844 && image.loading === 'eager' && image.priority === 'high'), true);
    assert.equal(priority.some(image => image.top > 844 && image.loading === 'lazy' && image.priority === 'low'), true);
    await page.evaluate(() => { Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true }); window.slow(); window.nextProbe(); });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.calls.length), 1, 'observed slow data shrinks prefetch even without navigator.connection');
    await page.evaluate(() => window.scrollTo(0, 220));
    await page.waitForFunction(() => window.calls.length === 2);
    assert.equal(await page.evaluate(() => !!window.optionalStarted), false, 'optional collections remain deferred until their own region is visible');
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForFunction(() => window.optionalStarted === true);
    await page.waitForFunction(() => document.querySelector('img[alt="Offscreen eager hero probe"]')?.getAttribute('fetchpriority') === 'high');
    assert.equal(await page.getByAltText('Offscreen eager hero probe').getAttribute('loading'), 'eager');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

test('desktop toolbar portal transfers its own focus and selection without stealing another control focus', { timeout: 30_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{ExploreSearchToolbar}from'./app/explore/explore-search-toolbar';
    window.fetch=async()=>Response.json({suggestions:[]});const noop=()=>{};
    createRoot(document.getElementById('root')).render(<ExploreSearchToolbar query="" initialDraftValue="typed before stream" restoreInitialFocus category="All" location="" locationSource="none" scopePolicy="expandable" locating={false} pending={false} message={null} areaOpen={false} onAreaOpenChange={noop} onSearch={noop} onDraftChange={noop} onSuggestionSelect={noop} onAreaApply={noop} onCurrentLocation={noop}/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'portal-focus-fixture', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/workspace-language$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: process.cwd(), loader: 'tsx', contents: `export const WorkspaceText=({text})=>text;` }));
  } }] });
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? result.outputFiles[0].text : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><button id="external">Other control</button><header data-explore-header-search></header><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome', headless: true, args: ['--no-proxy-server'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.activeElement?.id === 'explore-search-query');
    await page.getByLabel('Search salons, services, cities, states, ZIP or ideas').evaluate(node => node.setSelectionRange(2, 7));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => document.querySelector('[data-explore-header-search] input') === document.activeElement);
    assert.deepEqual(await page.locator('input[name=q]').evaluate(node => ({ draft: node.value, start: node.selectionStart, end: node.selectionEnd })), { draft: 'typed before stream', start: 2, end: 7 });
    await page.getByRole('button', { name: 'Other control' }).focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.querySelector('[data-explore-header-search] input'));
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'external', 'relocation leaves a different focused control alone');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => document.querySelector('[data-explore-header-search] input'));
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'external');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-explore-header-search] input') === document.activeElement);
    assert.equal(await page.locator('input[name=q]').inputValue(), 'typed before stream', 'the initial desktop stream handoff also survives its first portal relocation');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

test('background extras resume on visibility or focus and preserve scroll and search input guards', { timeout: 30_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ExploreProgressiveClient}from'./app/explore/explore-progressive-client';
    window.fixtureVisibility='visible';
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.fixtureVisibility});
    window.setVisibility=(value,event)=>{window.fixtureVisibility=value;if(event==='visibility')document.dispatchEvent(new Event('visibilitychange'));if(event==='focus')window.dispatchEvent(new Event('focus'))};
    let resolve;const extras=new Promise(done=>resolve=done);
    window.finishExtras=()=>resolve({homeContent:{recommendedSalons:['First card','Extra card']},discoveryContent:{},quickActions:[]});
    createRoot(document.getElementById('root')).render(<ExploreProgressiveClient initial={{homeContent:{recommendedSalons:['First card']}}} extras={extras}/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', plugins: [{ name: 'extras-resume-fixture', setup(builder) {
    builder.onResolve({ filter: /^\.\/explore-client$/ }, args => args.path === '@/lib/nail-inspiration' ? undefined : ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from'react';export const ExploreClient=({homeContent})=><main style={{minHeight:2400}}><input aria-label="Search draft"/><ol>{homeContent.recommendedSalons.map(name=><li key={name}>{name}</li>)}</ol></main>;
    ` }));
  } }] });
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? result.outputFiles[0].text : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome', headless: true, args: ['--no-proxy-server'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    const reset = async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByText('First card', { exact: true }).waitFor();
      await page.evaluate(() => { window.setVisibility('hidden'); window.finishExtras(); });
      await page.waitForTimeout(100);
      assert.equal(await page.getByText('Extra card', { exact: true }).count(), 0, 'extras stay pending while the document is hidden');
    };
    for (const wake of ['visibility', 'focus']) {
      await reset();
      await page.evaluate(wake => window.setVisibility('visible', wake), wake);
      await page.getByText('Extra card', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => scrollY), 0, `${wake} alone resumes pending extras without scroll or key input`);
    }
    await reset();
    await page.evaluate(() => { window.scrollTo(0, 350); window.setVisibility('visible', 'visibility'); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(1000);
    assert.equal(await page.getByText('Extra card', { exact: true }).count(), 0, 'foreground wake does not expand the page while the user reads below the top');
    assert.equal(await page.evaluate(() => scrollY), 350);
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('input').focus({ preventScroll: true }); window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(1000);
    assert.equal(await page.getByText('Extra card', { exact: true }).count(), 0, 'foreground wake still preserves an active search input');
    assert.equal(await page.getByLabel('Search draft').evaluate(node => node === document.activeElement), true);
    await page.getByLabel('Search draft').evaluate(node => node.blur());
    await page.getByText('Extra card', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
