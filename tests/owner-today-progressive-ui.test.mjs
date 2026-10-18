import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = engine === 'chromium' && !existsSync(browserPath);
const sections = ['staff', 'bookings', 'waiting', 'financials', 'extras'];

async function fixture(transport, duplicates = 1, { realRealtime = false, stalePhaseSeed = false, offline = false } = {}) {
  const output = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React,{Activity,useState} from 'react';import{createRoot}from'react-dom/client';
    import{AppLocalTodayClient,TodayProgressiveClient}from'./app/staff/today/today-progressive-client';
    import{refreshAppLocalResource,seedAppLocalResource}from'./lib/app-local-resource';
    import{experienceResourceCache}from'./lib/experience-resource-cache';
    window.reads=[];window.holds=new Set(['financials']);window.failures=new Map([['extras',503]]);window.pending=[];window.versions=new Map();window.salonNames=new Map();window.cacheLoads=[];
    const load=experienceResourceCache.load;experienceResourceCache.load=(context,fetcher,options)=>{window.cacheLoads.push({key:context.key,force:options?.force});return load(context,fetcher,options);};
    window.release=(phase)=>{window.holds.delete(phase);for(const item of window.pending.filter(item=>item.phase===phase))item.resolve();};
    const all=['staff','bookings','waiting','financials','extras'];
    function dashboard(scope,date,phase){
      const metric=value=>({label:'Synthetic fixture',value,href:null,chart:null,detail:null});
      return{date,timezone:'UTC',salonName:window.salonNames.get(scope)||scope,generatedAt:new Date().toISOString(),noAccess:false,
        permissions:{canViewBookings:true,canViewDashboard:true,canViewReports:true,canViewStaffFinancials:true,canViewTickets:true},
        dayView:{isCurrentDate:true,currentDate:date,selectedDate:date},loadErrors:[],attention:[],businessHours:{},
        summary:{staff:metric(phase==='staff'?'3':'--'),customers:metric(phase==='bookings'?'4':'--'),waiting:metric(phase==='waiting'?'2':'--'),sales:metric(phase==='financials'?scope+' '+date+' sales'+(window.versions.get(phase)||''):'--')},
        rightNow:{scheduleHref:null,upcomingBookings:[],waitingClients:[]},performance:{bookingStatus:[]},team:[],
        quickAccesses:{available:[],selected:[],canCustomize:true,maxSelected:8},
        pendingSections:{sections:all,metrics:['staff','customers','waiting','sales'],details:true}};
    }
    window.read=async(phase,scope,date)=>{
      const entry={phase,scope,date,version:window.versions.get(phase)||''},snapshot=dashboard(scope,date,phase);window.reads.push(entry);
      if(window.holds.has(phase))await new Promise(resolve=>window.pending.push({...entry,resolve}));
      const status=window.failures.get(phase);if(status)throw Object.assign(new Error('Synthetic weak network'),{status});
      return snapshot;
    };
    window.fetch=async(input)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.origin);
      try{const data=await window.read(url.searchParams.get('phase'),url.searchParams.get('scope'),url.searchParams.get('date'));return new Response(JSON.stringify({data,revision:'a'.repeat(64),sections:{fixture:'b'.repeat(64)},updatedAt:new Date().toISOString(),partial:false}),{status:200,headers:{'content-type':'application/json',etag:'fixture'}});}
      catch(error){return new Response('{}',{status:error.status===503?400:error.status??400});}
    };
    if(window.fixture.stalePhaseSeed){
      const scope='scope-a',date='2026-10-18',phase='financials',updatedAt=Date.now()-60000,stale=dashboard(scope,date,phase);
      stale.generatedAt=new Date(Date.now()-86400000).toISOString();stale.timezone='America/Chicago';stale.dayView={...stale.dayView,currentDate:'2026-10-17',isCurrentDate:false};stale.summary.sales.value='yesterday cached sales';
      if(window.fixture.transport==='native')seedAppLocalResource(scope,'page.owner-today',{date,phase},{schemaVersion:1,status:200,scope,etag:'stale',updatedAt,offline:true,data:{dashboard:stale,isOwner:true}});
      else experienceResourceCache.seed({scope,key:'today-section:'+date+':'+date+':'+phase},{data:stale,revision:'c'.repeat(64),sections:{fixture:'d'.repeat(64)},updatedAt:stale.generatedAt},{freshForMs:0,retainForMs:1800000},updatedAt,'stale');
    }
    function App(){const[visible,setVisible]=useState(true),[identity,setIdentity]=useState({scope:'scope-a',date:'2026-10-18'});window.show=setVisible;window.identity=setIdentity;
      window.refreshPhase=phase=>refreshAppLocalResource(identity.scope,'page.owner-today',{date:identity.date,phase});
      window.renameSalon=async name=>{window.salonNames.set(identity.scope,name);if(window.fixture.transport==='native')await refreshAppLocalResource(identity.scope,'page.owner-today',{date:identity.date,phase:'shell'});else setIdentity(previous=>({...previous}));};
      return <Activity mode={visible?'visible':'hidden'}>{Array.from({length:window.fixture.duplicates},(_,index)=><div key={index} data-consumer={index}>{window.fixture.transport==='native'
        ?<AppLocalTodayClient scope={identity.scope} requestedDate={identity.date}/>
        :<TodayProgressiveClient initialDashboard={dashboard(identity.scope,identity.date,'shell')} scope={identity.scope} salonId='fixture-salon' isOwner/>}</div>)}</Activity>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'today-fixture-boundaries', setup(builder) {
    const replacements = [
      [/(?:^|\/)app-local-host$/, 'host'],
      [/(?:^|\/)experience-persistent-cache$/, 'storage'],
      [/(?:^|\/)app-local-data-policy$/, 'policy'],
      [/(?:^|\/)experience-native-readmodels$/, 'native-readmodels'],
      ...(realRealtime ? [[/(?:^|\/)pos-workspace-sync$/, 'pos-events']] : [[/(?:^|\/)use-live-experience-refresh$/, 'realtime']]),
      [/(?:^|\/)today-dashboard-view$/, 'view'],
    ];
    for (const [filter, path] of replacements) builder.onResolve({ filter }, () => ({ path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir: process.cwd(), loader: path === 'view' ? 'tsx' : 'js', contents: ({
      host: `export const getAppLocalHost=()=>({isNative:true,cache:async()=>null,read:async(name,args,options)=>({schemaVersion:1,status:200,scope:options.scope,etag:'fixture',updatedAt:Date.now(),data:{dashboard:await window.read(args.phase,options.scope,args.date||'2026-10-18'),isOwner:true}})});`,
      storage: `export const EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT='fixture:offline';export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const isExperienceSnapshotContextAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};`,
      policy: `export const appLocalReadIsDurable=()=>true;`,
      'native-readmodels': `export const subscribeExperienceNativeReadModel=()=>()=>{};`,
      realtime: `export const useLiveExperienceRefresh=()=>{};`,
      'pos-events': `const listeners=new Map();window.posSubscriptions=listeners;window.emitPosChange=(salon,change)=>{for(const listener of listeners.get(salon)||[])listener(change);};export const subscribePosChanges=(salon,listener)=>{let group=listeners.get(salon);if(!group)listeners.set(salon,group=new Set());group.add(listener);return()=>group.delete(listener);};`,
      view: `import React from'react';export function TodayDashboardView({dashboard}){return <main data-fixture-view><p data-date>{dashboard.date}</p><p data-scope>{dashboard.salonName}</p>{['staff','customers','waiting','sales'].map(key=><p key={key} data-metric={key}>{dashboard.summary[key].value}</p>)}<p data-pending>{dashboard.pendingSections?.sections?.join(',')}</p><input aria-label='retained draft' defaultValue='draft'/></main>;}`,
    })[path] }));
  } }] });
  const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? output.outputFiles[0].text : `<div id="root"></div><script>window.fixture=${JSON.stringify({ transport, duplicates, stalePhaseSeed })}</script><script src="/app.js"></script>`); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  let browser;
  try {
    browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: browserPath, headless: true }));
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000);
    if (offline) await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
  } catch (error) {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    throw error;
  }
}

const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const firstView = page => page.locator('[data-consumer="0"]');

for (const transport of ['web', 'native']) {
  test(transport + ': slow and failed sections leave useful content visible, retry only the failed source, and share reads across consumers/revisit', { skip, timeout: 30000 }, async () => {
    const app = await fixture(transport, 2), { page } = app;
    try {
      await page.waitForFunction(() => document.querySelector('[data-consumer="0"] [data-metric="staff"]')?.textContent === '3' && document.querySelector('[data-consumer="0"] [data-metric="customers"]')?.textContent === '4' && document.querySelector('[data-consumer="0"] [data-metric="waiting"]')?.textContent === '2');
      assert.equal(await firstView(page).locator('[data-metric="sales"]').textContent(), '--');
      await firstView(page).locator('[data-today-retry="extras"]').waitFor();
      assert.equal(await page.evaluate(() => window.reads.filter(read => read.phase === 'financials').length), 1);
      assert.equal(await page.evaluate(() => window.reads.filter(read => read.phase === 'extras').length), 1);
      await firstView(page).locator('input').fill('retained draft 118');
      await firstView(page).locator('input').evaluate(node => window.originalDraft = node);
      await page.evaluate(() => { window.failures.delete('extras'); window.release('financials'); });
      await firstView(page).locator('[data-today-retry="extras"] button').click();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-metric="sales"]')].every(node => node.textContent === 'scope-a 2026-10-18 sales'));
      await page.waitForFunction(() => [...document.querySelectorAll('[data-pending]')].every(node => node.textContent === ''));
      const reads = await page.evaluate(() => window.reads);
      for (const phase of sections) assert.equal(reads.filter(read => read.phase === phase).length, phase === 'extras' ? 2 : 1, phase);
      assert.equal(reads.filter(read => read.phase === 'shell').length, transport === 'native' ? 1 : 0);
      for (let i = 0; i < 3; i++) { await page.evaluate(() => window.show(false)); await settle(page); await page.evaluate(() => { window.show(true); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('reylumi:foreground')); }); await settle(page); }
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => window.reads.length), reads.length);
      assert.equal(await firstView(page).locator('input').evaluate(node => node === window.originalDraft), true);
      assert.equal(await firstView(page).locator('input').inputValue(), 'retained draft 118');
    } finally { await app.close(); }
  });

  test(transport + ': delayed old date/scope cannot replace the current workspace and explicit reset removes private content', { skip, timeout: 30000 }, async () => {
    const app = await fixture(transport), { page } = app;
    try {
      await page.waitForFunction(() => window.reads.some(read => read.phase === 'financials'));
      await page.evaluate(() => { window.failures.clear(); window.identity({scope:'scope-a',date:'2026-10-17'}); });
      await page.waitForFunction(() => window.reads.some(read => read.phase === 'financials' && read.date === '2026-10-17'));
      await page.evaluate(() => window.identity({scope:'scope-b',date:'2026-10-16'}));
      await page.waitForFunction(() => window.reads.some(read => read.phase === 'financials' && read.scope === 'scope-b'));
      await page.evaluate(() => window.release('financials'));
      await page.waitForFunction(() => document.querySelector('[data-metric="sales"]')?.textContent === 'scope-b 2026-10-16 sales');
      assert.equal(await page.locator('[data-date]').textContent(), '2026-10-16');
      assert.equal(await page.locator('[data-scope]').textContent(), 'scope-b');
      await page.evaluate(() => { for (const phase of ['shell','staff','bookings','waiting','financials','extras']) window.holds.add(phase); window.dispatchEvent(new CustomEvent('reylumi:experience-reset')); });
      await settle(page);
      assert.equal(await page.locator('[data-fixture-view]').count(), 0);
      assert.equal(await page.locator('body').textContent().then(text => text.includes('scope-b 2026-10-16 sales')), false);
    } finally { await app.close(); }
  });

  test(transport + ': confirmed section denial clears already loaded private sections', { skip, timeout: 30000 }, async () => {
    const app = await fixture(transport), { page } = app;
    try {
      await page.waitForFunction(() => document.querySelector('[data-metric="staff"]')?.textContent === '3' && window.reads.some(read => read.phase === 'financials'));
      await page.evaluate(() => { window.failures.set('financials',403); window.release('financials'); });
      await page.waitForFunction(() => !document.querySelector('[data-fixture-view]'));
      assert.equal(await page.locator('[data-metric="staff"]').count(), 0);
    } finally { await app.close(); }
  });

  test(transport + ': an old cached phase with yesterday clock and former timezone cannot permanently deny a fresh matching shell', { skip, timeout: 30000 }, async () => {
    const app = await fixture(transport, 1, { stalePhaseSeed: true }), { page } = app;
    try {
      await page.waitForFunction(() => window.reads.some(read => read.phase === 'financials'));
      await settle(page);
      assert.equal(await page.locator('[data-fixture-view]').count(), 1, 'a cached clock mismatch is not an access revocation');
      assert.equal(await page.locator('[data-metric="sales"]').textContent(), '--', 'incompatible cached financial values are not merged');
      assert.equal(await page.locator('[data-today-clock-refresh]').count(), 0, 'old cached clock state does not demand a fresh-shell reload');
      assert.equal(await page.locator('body').textContent().then(text => text.includes('workspace access must be checked')), false);
      await page.evaluate(() => { window.failures.clear(); window.release('financials'); });
      await page.waitForFunction(() => document.querySelector('[data-metric="sales"]')?.textContent === 'scope-a 2026-10-18 sales');
      assert.equal(await page.locator('[data-scope]').textContent(), 'scope-a');
      assert.equal(await page.locator('[data-date]').textContent(), '2026-10-18');
      assert.equal(await page.locator('[data-today-clock-refresh]').count(), 0);
      assert.equal(await page.evaluate(() => window.reads.filter(read => read.phase === 'financials').length), 1);
    } finally { await app.close(); }
  });

  test(transport + ': a same-scope salon rename admits the new shell and late matching section data', { skip, timeout: 30000 }, async () => {
    const app = await fixture(transport), { page } = app;
    try {
      await page.waitForFunction(() => document.querySelector('[data-metric="staff"]')?.textContent === '3' && window.reads.some(read => read.phase === 'financials'));
      await page.evaluate(() => window.renameSalon('renamed salon'));
      await page.waitForFunction(() => document.querySelector('[data-scope]')?.textContent === 'renamed salon');
      await page.evaluate(() => { window.failures.clear(); window.release('financials'); });
      await page.waitForFunction(() => document.querySelector('[data-metric="sales"]')?.textContent === 'scope-a 2026-10-18 sales');
      assert.equal(await page.locator('[data-scope]').textContent(), 'renamed salon');
      assert.equal(await page.locator('body').textContent().then(text => text.includes('workspace access must be checked')), false);
    } finally { await app.close(); }
  });
}

test('native: failed refresh preserves last good financial data; a denied financial read clears the merged page', { skip, timeout: 30000 }, async () => {
  const app = await fixture('native'), { page } = app;
  try {
    await page.evaluate(() => { window.failures.clear(); window.release('financials'); });
    await page.waitForFunction(() => document.querySelector('[data-metric="sales"]')?.textContent === 'scope-a 2026-10-18 sales');
    await page.evaluate(async () => { window.failures.set('financials',503); await window.refreshPhase('financials'); });
    await page.locator('[data-today-retry="financials"]').waitFor();
    assert.equal(await page.locator('[data-metric="sales"]').textContent(), 'scope-a 2026-10-18 sales');
    assert.equal(await page.locator('[data-metric="staff"]').textContent(), '3');
    await page.evaluate(async () => { window.failures.set('financials',403); await window.refreshPhase('financials'); });
    await page.waitForFunction(() => !document.querySelector('[data-fixture-view]'));
    assert.equal(await page.locator('body').textContent().then(text => text.includes('scope-a 2026-10-18 sales')), false);
  } finally { await app.close(); }
});

test('web: authoritative mutation during initial GET queues one shared follow-up and cannot lose the changed data', { skip, timeout: 30000 }, async () => {
  const app = await fixture('web', 2, { realRealtime: true }), { page } = app;
  try {
    await page.waitForFunction(() => window.reads.filter(read => read.phase === 'financials').length === 1 && window.posSubscriptions.get('fixture-salon')?.size === 10);
    await page.evaluate(() => {
      window.versions.set('financials',' after mutation');
      // No reason means an authoritative mutation, not a wake or polling hint.
      window.emitPosChange('fixture-salon',{resource:'report'});
    });
    // Both real live-refresh subscribers have joined the held initial GET.
    // Neither is allowed to create another transport request while it is open.
    await page.waitForFunction(() => window.cacheLoads.filter(load => load.key.endsWith(':financials') && load.force === true).length === 2);
    assert.equal(await page.evaluate(() => window.reads.filter(read => read.phase === 'financials').length), 1);
    await page.evaluate(() => window.release('financials'));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-metric="sales"]')].every(node => node.textContent === 'scope-a 2026-10-18 sales after mutation'));
    await settle(page);
    const reads = await page.evaluate(() => window.reads);
    assert.deepEqual(reads.filter(read => read.phase === 'financials').map(read => read.version), ['', ' after mutation']);
    for (const phase of ['staff','bookings','waiting','extras']) assert.equal(reads.filter(read => read.phase === phase).length, 1, phase + ' did not receive this mutation');
    assert.equal(await page.locator('[data-metric="sales"]').count(), 2);
  } finally { await app.close(); }
});

test('native: offline with no saved shell settles to an actionable connection message', { skip, timeout: 30000 }, async () => {
  const app = await fixture('native', 1, { offline: true }), { page } = app;
  try {
    await page.getByText('Connect to load Today.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Opening…', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Try again', exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.reads.length), 0);
  } finally { await app.close(); }
});
