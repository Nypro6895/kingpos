import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
async function fixture() {
  const stubs = {
    'next/navigation': "export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>window.router;",
    '@/components/experience-scope': "import{useSyncExternalStore}from'react';const subscribe=fn=>{window.addEventListener('scope-state',fn);return()=>window.removeEventListener('scope-state',fn)};export function useExperienceScope(){useSyncExternalStore(subscribe,()=>window.validationRevision,()=>0);return{context:{scope:'viewer-workspace',authenticated:true},validate:window.validate,checkedAt:window.checkedAt,getValidationRevision:window.getValidationRevision,validationRevision:window.validationRevision}}",
    '@/components/loading-feedback': 'export const PageLoadingSkeleton=()=> <div role="status">Checking access</div>',
    '@/lib/experience-persistent-cache': "export const EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT='offline-authorized';export const isExperienceSnapshotContextAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>false;",
    './experience-persistent-cache': "export const EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT='offline-authorized';export const isExperienceSnapshotContextAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>false;",
    './experience-native-readmodels': 'export const subscribeExperienceNativeReadModel=()=>()=>{};',
    '@/lib/pos-workspace-sync': 'export const subscribePosChanges=()=>()=>{};',
    './customer-activity-view': 'export const CustomerActivityView=({activity})=><section><input aria-label="Retained view input" defaultValue=""/><output>{activity.marker}</output></section>',
    './staff-schedule-view': 'export const StaffScheduleView=({data})=><section><input aria-label="Retained view input" defaultValue=""/><output>{data.marker}</output></section>',
    './staff-workday-view': 'export const StaffWorkdayView=({data})=><section><input aria-label="Retained view input" defaultValue=""/><output>{data.marker}</output></section>',
  };
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: "\nimport React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';\nimport{ExperiencePageBoundary}from'./components/experience-page-boundary';\nimport{CustomerActivityClient}from'./app/activity/customer-activity-client';\nimport{StaffScheduleClient}from'./app/staff/appointments/staff-schedule-client';\nimport{StaffWorkdayClient}from'./app/staff/workday/staff-workday-client';\nimport{experienceResourceCache,resumeExperienceResources}from'./lib/experience-resource-cache';\nconst now=Date.now.bind(Date);window.offset=0;Date.now=()=>now()+window.offset;\nwindow.reads=[];window.rscRefreshes=0;window.validationCalls=0;window.validationRevision=0;window.allowed=true;\nwindow.lastChecked=Date.now();window.checkedAt=()=>window.lastChecked;window.getValidationRevision=()=>window.validationRevision;\nwindow.validate=async()=>{window.validationCalls++;if(window.allowed){window.lastChecked=Date.now();return true}return false};\nwindow.router={refresh(){window.rscRefreshes++}};window.cache=experienceResourceCache;resumeExperienceResources('viewer-workspace');\nconst kind=location.pathname==='/activity'?'activity':location.pathname==='/staff/workday'?'workday':'schedule';\nconst result={marker:'current cached view',today:'2026-10-16',staff:{id:'staff-a'}};\nconst data=kind==='activity'?{kind,result}:{kind,result,staffId:'staff-a',salonId:'salon-a'};\nconst snapshot={data,revision:'a'.repeat(64),sections:{result:'b'.repeat(64)},updatedAt:new Date(Date.now()).toISOString()};\nwindow.fetch=(url,init)=>{window.reads.push({url:String(url),method:init?.method??'GET',headers:Object.fromEntries(new Headers(init?.headers))});return new Promise(resolve=>window.completeRead=()=>resolve(Response.json({partial:false,...snapshot,data:{...data,result:{...result,marker:'fresh live view'}},revision:'c'.repeat(64),updatedAt:new Date(Date.now()).toISOString()},{headers:{etag:'\"fresh\"'}})))};\nfunction View(){return kind==='activity'?<CustomerActivityClient scope=\"viewer-workspace\" initialSnapshot={snapshot}/>:kind==='workday'?<StaffWorkdayClient scope=\"viewer-workspace\" initialSnapshot={snapshot}/>:<StaffScheduleClient scope=\"viewer-workspace\" initialSnapshot={snapshot} params={{}}/>}\nfunction App(){const[shown,setShown]=useState(true);window.show=setShown;return <Activity mode={shown?'visible':'hidden'}><ExperiencePageBoundary renderRevision=\"original-server-render\"><View/></ExperiencePageBoundary></Activity>}\ncreateRoot(document.getElementById('app')).render(<App/>);\n" },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'boundary-browser-adapters', setup(b) {
      b.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/fixture.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/fixture.js' ? result.outputFiles[0].text : '<!doctype html><style>[hidden]{display:none!important}body{font:16px sans-serif}</style><div id="app"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  return { browser, origin: 'http://127.0.0.1:' + server.address().port, close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}
for (const route of ['/activity', '/staff/appointments', '/staff/workday']) {
  test(route + ' uses its actual client/resource hook on stale Activity return: same input, one held live GET, no whole-route refresh', { skip: !existsSync(browserPath), timeout: 30000 }, async () => {
    const f = await fixture(), page = await f.browser.newPage(); page.setDefaultTimeout(5000); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(f.origin + route);
      const input = page.getByRole('textbox', { name: 'Retained view input' });
      await input.fill('Keep this draft'); await input.evaluate(node => window.savedInput = node);
      assert.equal(await page.evaluate(() => window.reads.length), 0);
      await page.evaluate(() => window.show(false)); await input.waitFor({ state: 'hidden' });
      // The cache captures its clock during module initialization. Expire the
      // hidden record explicitly while the boundary's public clock advances.
      await page.evaluate(() => { window.offset += 61000; window.cache.invalidate({scope:'viewer-workspace'}); window.show(true); });
      await page.waitForFunction(() => window.reads.length === 1);
      assert.equal(await input.evaluate(node => node === window.savedInput), true);
      assert.equal(await input.inputValue(), 'Keep this draft');
      assert.equal(await page.locator('output').textContent(), 'current cached view');
      assert.deepEqual(await page.evaluate(() => ({ reads: window.reads.length, refreshes: window.rscRefreshes, validates: window.validationCalls })), { reads: 1, refreshes: 0, validates: 1 });
      const read = await page.evaluate(() => window.reads[0]);
      assert.match(read.url, route === '/activity' ? /\/api\/experience\/customer\?kind=activity/ : /\/api\/experience\/staff\?kind=/);
      assert.equal(new URL(read.url, f.origin).searchParams.get('scope'), 'viewer-workspace');
      assert.equal(read.headers['if-none-match'], '"' + 'a'.repeat(64) + '"');
      await page.evaluate(() => window.completeRead());
      await page.getByText('fresh live view', { exact: true }).waitFor();
      assert.equal(await input.evaluate(node => node === window.savedInput), true);
      assert.equal(await input.inputValue(), 'Keep this draft');
      assert.equal(await page.evaluate(() => window.reads.length), 1);
      assert.deepEqual(errors, []);
    } catch(error) { console.error(JSON.stringify({route,errors,body:await page.locator('body').innerText(),state:await page.evaluate(()=>({reads:window.reads,rsc:window.rscRefreshes,validates:window.validationCalls,cache:window.cache?.stats()}))})); throw error; } finally { await f.close(); }
  });
}
test('protected live resource still stays hidden while returning authority is rejected', { skip: !existsSync(browserPath), timeout: 30000 }, async () => {
  const f = await fixture(), page = await f.browser.newPage(); page.setDefaultTimeout(5000);
  try {
    await page.goto(f.origin + '/activity');
    const input = page.getByRole('textbox', { name: 'Retained view input' }); await input.fill('Private draft');
    await page.evaluate(() => window.show(false)); await input.waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.offset += 61000; window.allowed = false; window.show(true); });
    await page.getByRole('status').waitFor();
    assert.equal(await input.isVisible(), false);
    assert.equal(await page.evaluate(() => window.rscRefreshes), 0);
    assert.equal(await page.evaluate(() => window.validationCalls), 1);
  } finally { await f.close(); }
});

