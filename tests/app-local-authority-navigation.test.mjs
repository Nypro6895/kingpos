import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', skip = !existsSync(browserPath);
const salon = '11111111-1111-4111-8111-111111111111', staff = '22222222-2222-4222-8222-222222222222', viewer = '33333333-3333-4333-8333-333333333333';
const scopes = { account: 'v3:' + 'a'.repeat(64), portal: 'v3:' + 'b'.repeat(64), workday: 'v3:' + 'c'.repeat(64) }, today = new Date().toISOString().slice(0, 10);
function seed() {
  const now = Date.now(), owner = { schemaVersion: 1, context: { scope: scopes.account, viewerId: viewer, workspaceId: salon, salonId: salon, permissionRevision: 'owner-r1', authenticated: true }, display: { name: 'Fixture owner', language: 'en', role: 'OWNER' }, access: { ownerWorkspace: true, staffWorkspace: false }, onlineValidatedAt: now, grant: { version: 1, scope: scopes.account, scopes: [scopes.account], viewerId: viewer, workspaceId: salon, salonId: salon, grantRevision: 'owner-r1', generation: 'fixture-device-generation', issuedAt: now, expiresAt: now + 3600000, path: '/pos', kind: 'owner' } };
  const reference = { ownerScope: 'owner:' + salon + ':' + viewer, salonId: salon, salonName: 'Fixture salon', timezone: 'America/Chicago', today, staff: [{ id: staff, display_name: 'Alice', is_active: true, job_title: 'Technician', today_status: 'working', turns: { queueTurns: 2, largeTurns: 2, smallTurns: 0, totalTurns: 2, receiptLargeTurns: 0 } }], services: [], defaults: { adsFooter: '', largeTurnThreshold: 25, showServiceName: true, showStaffName: true, staffCheckInEnabled: false, taxEnabled: false, tipSuggestions: [10, 15, 20] }, preferences: { showStaff: true, showServices: true, showCustomer: true, showTip: true, showDiscount: true, idleMinutes: 3, idleWarningSeconds: 60 } };
  return { owner, scope: scopes, data: { 'owner.workspace': { view: 'workspace', props: reference }, 'owner.check-in': { view: 'check-in', props: { data: { salonId: salon, salonName: 'Fixture salon', today, timezone: 'America/Chicago', checkInEnabled: true, staff: [{ id: staff, displayName: 'Alice', jobTitle: 'Technician', avatarUrl: null, status: 'working', isPasscodeDefault: false, queueTurnCount: 2, checkInAt: null, checkInSequence: 1 }] } } }, 'staff.my-work': { title: 'My Work data' }, 'staff.workday': { title: 'Workday data' }, 'page.market': { title: 'Market data' }, 'page.settings': { title: 'Settings data' } } };
}
async function serve(script, initial, start = '/pos', installClock = false) {
  const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/fixture.js' ? script : '<!doctype html><style>[hidden]{display:none!important}body{font:14px system-ui}button,input{min-height:30px}.owner-checkout{min-height:500px}.owner-inline-money{display:none}</style><div id="app"></div><script>window.fixture=' + JSON.stringify(initial).replaceAll('<', '\\u003c') + '</script><script src="/fixture.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] }), page = await browser.newPage({ viewport: { width: 1400, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message)); if(installClock)await page.clock.install(); await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort()); await page.goto('http://127.0.0.1:' + server.address().port + start);
  return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}
let entryBundle;
async function fixture(start = '/pos', installClock = false) {
  entryBundle ??= build({ entryPoints: ['app/local-app/entry.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'actual-entry-held-context', setup(builder) {
    const noPage = name => `export const ${name}=()=>null;`;
    const stubs = {
      'next/navigation': `export*from'./app/local-app/navigation';`, 'next/link': `export{AppLocalLink as default,useLinkStatus}from'./app/local-app/navigation';`, 'next/image': `export{AppLocalImage as default}from'./app/local-app/navigation';`, 'next/form': `export{AppLocalForm as default}from'./app/local-app/navigation';`,
      '@/components/workspace-language': `export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='span',text,...props})=><Tag {...props}>{text}</Tag>;export const useWorkspaceTranslation=()=>x=>x;`,
      '@/components/app-local-help': 'export const AppLocalHelp=()=> <section><h1>Full public Help frame</h1><input aria-label="Help search" defaultValue=""/><button onClick={()=>window.helpClicks=(window.helpClicks??0)+1}>Search Help</button></section>;',
      '@/app/legal/legal-components': 'export const LegalDocumentPage=()=>null;export const LegalHub=()=>null;', '@/lib/legal-policies': 'export const legalDocuments={};',
      '@/components/app-local-shell': 'export const AppLocalShell=({children,context,presentationContext})=><div data-actual-entry-shell data-active-scope={context?.context.scope} data-presented-scope={presentationContext?.context.scope} data-presented-role={presentationContext?.display.role}>{children}</div>;',
      '@/lib/app-local-reference-content': 'export const APP_LOCAL_REFERENCE_ASSETS=[];',
      'app-local-browser-compat': 'export const installAppLocalBrowserCompatibility=()=>{};',
      'app-local-host': `window.__reylumiAppLocalContext={version:1,nonce:'fixture',scopeEpoch:1,generation:'fixture-device-generation'};window.contextRequests=[];window.reads=[];window.cacheReads=[];window.wrongScope=0;window.syncCalls=0;window.resets=0;window.held=['portal','workday'];window.waiters=[];window.apiCalls=[];window.addEventListener('reylumi:app-local-access-changed',()=>window.resets++);const family=path=>path.split('?')[0]==='/staff/workday'?'workday':/^\\/staff\\/(?:my-work|appointments)(?:\\?|$)/.test(path)?'portal':'account';function value(path){const f=family(path),v=structuredClone(window.fixture.owner);v.contextPath=path;if(f!=='account'){v.context.scope=window.fixture.scope[f];v.context.permissionRevision=f+'-r1';v.grant=null;v.display.role='STAFF';v.access={ownerWorkspace:false,staffWorkspace:true};}v.onlineValidatedAt=Date.now();return v}window.releaseFamily=f=>{window.held=window.held.filter(x=>x!==f);window.waiters.filter(x=>x.family===f).forEach(x=>x.resolve(value(x.path)));window.waiters=window.waiters.filter(x=>x.family!==f)};export const appLocalPath=x=>x;export const appLocalRequestId=()=>crypto.randomUUID();export const getAppLocalHost=()=>({isNative:true,context:async(path,options)=>{window.contextRequests.push(path);if(window.held.includes(family(path)))return new Promise((resolve,reject)=>{window.waiters.push({path,family:family(path),resolve});options?.signal?.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true})});return value(path)},cache:async(op,args)=>{window.cacheReads.push(args);const expected=args.name.startsWith('staff.workday')?window.fixture.scope.workday:args.name.startsWith('staff.')?window.fixture.scope.portal:window.fixture.scope.account;return args.scope===expected&&window.fixture.data[args.name]?{data:structuredClone(window.fixture.data[args.name]),revision:'r1',updatedAt:Date.now()}:null},read:async(name,args,options)=>{window.reads.push({name,scope:options.scope});const expected=name.startsWith('staff.workday')?window.fixture.scope.workday:name.startsWith('staff.')?window.fixture.scope.portal:window.fixture.scope.account;if(options.scope!==expected){window.wrongScope++;throw Object.assign(Error('Wrong scope'),{status:409})}return{schemaVersion:1,status:200,scope:options.scope,etag:'r2',updatedAt:Date.now(),data:structuredClone(window.fixture.data[name])}},command:async()=>{throw Error('Fixture forbids business commands')},openOnline:async path=>{window.onlinePath=path}});`,
      'app-local-command-client': `let scope;export const getAppLocalCommandScope=()=>scope;export const setAppLocalCommandScope=value=>{scope=value;window.commandScope=value};`,
      'experience-persistent-cache': 'export const acceptExperienceOfflineGrant=async()=>true;export const clearExperienceSnapshots=async()=>{};export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};',
      'app-local-data-policy': 'export const appLocalReadIsDurable=()=>true;',
      'app-local-page-registry': `import{useAppLocalResource}from'./lib/app-local-resource';function Panel({context,path}){const name=path.startsWith('/staff/workday')?'staff.workday':path.startsWith('/staff/')?'staff.my-work':path.startsWith('/market')?'page.market':'page.settings',r=useAppLocalResource(context?.context.scope,name);return <main data-fixture-page={name}><h1>{r.data?.title??'Static Market frame'}</h1><input aria-label={name+' draft'} defaultValue=''/></main>}export function getAppLocalPage(path){if(!/^\\/(?:staff\\/(?:my-work|appointments|workday|connections)|market|settings)(?:\\?|$)/.test(path))return null;return{id:path.startsWith('/market')?'market':path,title:'Opening role view',requiresContext:!path.startsWith('/market'),Component:Panel}}`,
      'app-local-personal-registry': noPage('getAppLocalPersonalPage'), 'app-local-explore-registry': noPage('getAppLocalExplorePage'), 'app-local-owner-page-registry': noPage('getAppLocalOwnerPage'), 'app-local-business-registry': noPage('getAppLocalBusinessPage'), 'app-local-public-registry': noPage('getAppLocalPublicPage'), 'app-local-daily-registry': noPage('getAppLocalDailyPage'), 'app-local-secondary-registry': noPage('getAppLocalSecondaryPage') + 'export const appLocalRouteAlias=()=>null;', 'app-local-payroll-tax-registry': noPage('getAppLocalPayrollTaxPage'), 'app-local-commerce-registry': noPage('getAppLocalCommercePage'), 'app-local-portable-registry': noPage('getAppLocalPortablePage'), 'app-local-display-registry': noPage('getAppLocalDisplayPage'),
      'app-local-http-client': 'export const installAppLocalHttpClient=()=>{};', 'app-local-role-http-client': 'export const installAppLocalRoleHttpClient=()=>{};', 'app-local-personal-http-client': 'export const installAppLocalPersonalHttpClient=()=>{};', 'app-local-explore-http-client': 'export const installAppLocalExploreHttpTransport=()=>{};', 'app-local-public-http-client': 'export const installAppLocalPublicHttpTransport=()=>{};', 'app-local-business-http-client': 'export const installAppLocalBusinessHttpClient=()=>{};', 'app-local-shell-http-client': 'export const installAppLocalShellHttpTransport=()=>{};', 'app-local-portable-http-client': 'export const installAppLocalPortableHttpClient=()=>{};', 'app-local-display-http-client': 'export const installAppLocalDisplayHttpClient=()=>{};',
      '@/lib/pos-workspace-sync': 'export const usePosResourceRefresh=()=>{};export const subscribePosChanges=()=>()=>{};', '@/lib/supabase/browser': 'export const createSupabaseBrowserClient=()=>null;', '@/components/role-more-content': 'export const RoleMoreContent=()=>null;', '@/app/service-relay/desk-relay': 'export const DeskRelay=()=>null;',
      '@/app/bookings/owner-live-booking-workspace': 'export const OwnerLiveBookingWorkspace=()=>null;', '@/app/reports/owner-live-reports': 'export const OwnerLiveReports=()=>null;', '@/app/pos-tickets/owner-live-tickets': 'export const OwnerLiveTickets=()=>null;',
      '@/lib/portable-operations': `export const PORTABLE_OPERATIONS_CHANGED='fixture:operations';export const portableCheckpoint=async()=>0;export const listPortableOperations=async()=>[];export const syncPortableOperations=async()=>{window.syncCalls++};export const cancelPortableOperation=async()=>{};export const retryPortableOperation=async()=>{};export const canCancelPortableOperation=()=>false;export const savePortableOperation=async()=>{throw Error('No operation may be created')};`,
    };
    // Exercise authority recovery through the actual resource/entry lifecycle,
    // while keeping all network and business commands inside this fixture.
    stubs['app-local-host'] = stubs['app-local-host']
      .replace('window.contextRequests=[];', 'window.contextRequests=[];window.freshRequests=[];window.rejectReads=0;window.rejectContext=false;')
      .replace('window.contextRequests.push(path);', 'window.contextRequests.push(path);if(options?.fresh)window.freshRequests.push(path);if(window.rejectContext)throw Object.assign(Error("Access rejected"),{status:403});')
      .replace('window.reads.push({name,scope:options.scope});', 'window.reads.push({name,scope:options.scope});if(window.rejectReads>0){window.rejectReads--;throw Object.assign(Error("Access must be checked"),{status:409})}');
    builder.onResolve({ filter: /.*/ }, args => { const name = Object.keys(stubs).find(name => args.path === name || args.path.endsWith('/' + name)); return name ? { path: name, namespace: 'fixture' } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: process.cwd(), contents: stubs[args.path] }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: 'export default {};' }));
    builder.onLoad({ filter: /\.[jt]sx?$/ }, args => { if (args.path.includes('node_modules')) return; const source = readFileSync(args.path, 'utf8'); if (!/^\s*['"]use server['"]/.test(source)) return; return { loader: 'js', contents: [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(([, name]) => `export async function ${name}(...args){window.apiCalls.push(${JSON.stringify(name)});return {ok:false,error:'Fixture forbids mutation'}}`).join('\n') }; });
  } }] });
  return serve((await entryBundle).outputFiles[0].text, seed(), start, installClock);
}
const navigate = (page, path) => page.evaluate(path => window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate', { detail: { path } })), path);

test('one rejected read forces fresh authority recovery and restores the saved money draft', { skip, timeout: 40000 }, async () => {
  const app = await fixture('/pos', true); try {
    const amount = app.page.locator('.owner-amount-field input[aria-label=Amount]'); await amount.fill('118.75');
    await app.page.evaluate(() => { window.rejectReads = 1; window.dispatchEvent(new CustomEvent('reylumi:app-local-command-complete', { detail: { scope: window.fixture.scope.account } })); });
    await app.page.waitForFunction(() => window.resets === 1 && window.freshRequests.length === 1 && window.commandScope === window.fixture.scope.account);
    await amount.waitFor(); assert.equal(await amount.inputValue(), '118.75');
    const requests = await app.page.evaluate(() => window.contextRequests.length); await app.page.clock.fastForward(20000);
    assert.equal(await app.page.evaluate(() => window.contextRequests.length), requests);
    assert.equal(await app.page.evaluate(() => window.wrongScope), 0); assert.deepEqual(await app.page.evaluate(() => window.apiCalls), []);
  } finally { await app.close(); }
});

test('persistent read rejection stops after one fresh recovery and exposes retry instead of an infinite opening screen', { skip, timeout: 40000 }, async () => {
  const app = await fixture('/pos', true); try {
    await app.page.locator('.owner-amount-field input[aria-label=Amount]').waitFor();
    await app.page.evaluate(() => { window.rejectReads = 100; window.dispatchEvent(new CustomEvent('reylumi:app-local-command-complete', { detail: { scope: window.fixture.scope.account } })); });
    await app.page.waitForFunction(() => window.resets === 1 && window.freshRequests.length === 1 && window.commandScope === window.fixture.scope.account);
    await app.page.locator('.owner-amount-field input[aria-label=Amount]').waitFor();
    await app.page.evaluate(() => window.dispatchEvent(new CustomEvent('reylumi:app-local-command-complete', { detail: { scope: window.fixture.scope.account } })));
    await app.page.waitForFunction(() => window.resets === 2 && window.freshRequests.length === 1 && window.commandScope === undefined);
    await app.page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    const requests = await app.page.evaluate(() => window.contextRequests.length); await app.page.clock.fastForward(60000);
    assert.equal(await app.page.evaluate(() => window.contextRequests.length), requests);
    assert.equal(await app.page.locator('[data-actual-entry-shell]').getAttribute('data-active-scope'), null);
    assert.equal(await app.page.getByText('Opening your workspace…', { exact: true }).count(), 0);
    assert.deepEqual(await app.page.evaluate(() => window.apiCalls), []);
  } finally { await app.close(); }
});

test('cold installed Help uses no context, account resource, cache or command scope', { skip, timeout: 30000 }, async () => {
  const app = await fixture('/help'); try {
    await app.page.getByRole('heading', { name: 'Full public Help frame' }).waitFor();
    await app.page.getByRole('textbox', { name: 'Help search' }).fill('Check in');
    await app.page.getByRole('button', { name: 'Search Help', exact: true }).click();
    assert.deepEqual(await app.page.evaluate(() => ({ context: window.contextRequests, reads: window.reads, cache: window.cacheReads, commands: window.apiCalls, sync: window.syncCalls, scope: window.commandScope, clicks: window.helpClicks })), { context: [], reads: [], cache: [], commands: [], sync: 0, scope: undefined, clicks: 1 });
    assert.equal(await app.page.locator('[data-actual-entry-shell]').getAttribute('data-presented-scope'), null);
  } finally { await app.close(); }
});

test('owner Help retains only presentation admission, never commands or background reads, and returning POS retains original money DOM', { skip, timeout: 40000 }, async () => {
  const app = await fixture(); try {
    const amount = app.page.locator('.owner-amount-field input[aria-label=Amount]'); await amount.fill('118.75'); await amount.evaluate(node => window.savedAmount = node);
    const before = await app.page.evaluate(() => ({ context: window.contextRequests.length, reads: window.reads.length, sync: window.syncCalls }));
    await navigate(app.page, '/help');
    const shell = app.page.locator('[data-actual-entry-shell]');
    await app.page.waitForFunction(() => document.querySelector('[data-presented-role="OWNER"]'));
    assert.equal(await shell.getAttribute('data-active-scope'), null);
    assert.equal(await shell.getAttribute('data-presented-scope'), scopes.account);
    assert.equal(await app.page.evaluate(() => window.commandScope), undefined);
    const search = app.page.getByRole('textbox', { name: 'Help search' }); await search.fill('Payroll'); await search.evaluate(node => window.savedHelpSearch = node);
    await app.page.getByRole('button', { name: 'Search Help', exact: true }).click();
    await navigate(app.page, '/help/owner-pos?lang=en');
    await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:foreground')));
    assert.equal(await shell.getAttribute('data-presented-scope'), scopes.account);
    assert.equal(await search.evaluate(node => node === window.savedHelpSearch), true);
    assert.equal(await search.inputValue(), 'Payroll');
    assert.deepEqual(await app.page.evaluate(() => ({ context: window.contextRequests.length, reads: window.reads.length, sync: window.syncCalls })), before);
    assert.equal(await app.page.evaluate(() => window.commandScope), undefined);
    assert.deepEqual(await app.page.evaluate(() => window.apiCalls), []);
    await navigate(app.page, '/pos'); await amount.waitFor(); assert.equal(await amount.evaluate(node => node === window.savedAmount), true); assert.equal(await amount.inputValue(), '118.75');
  } finally { await app.close(); }
});

test('staff Help presents the actual admitted staff family and expires its unleased chrome without fetching public Help', { skip, timeout: 40000 }, async () => {
  const app = await fixture('/staff/my-work'); try {
    await app.page.clock.install();
    await app.page.waitForFunction(() => window.contextRequests.includes('/staff/my-work')); await app.page.evaluate(() => window.releaseFamily('portal'));
    await app.page.locator('[data-fixture-page="staff.my-work"]').waitFor();
    await navigate(app.page, '/help'); await app.page.waitForFunction(() => document.querySelector('[data-presented-role="STAFF"]'));
    assert.equal(await app.page.locator('[data-actual-entry-shell]').getAttribute('data-presented-scope'), scopes.portal);
    assert.equal(await app.page.evaluate(() => window.commandScope), undefined);
    const requests = await app.page.evaluate(() => window.contextRequests.length);
    await app.page.clock.fastForward(30_001);
    await app.page.waitForFunction(() => !document.querySelector('[data-presented-scope]'));
    assert.equal(await app.page.getByRole('heading', { name: 'Full public Help frame' }).isVisible(), true);
    assert.equal(await app.page.evaluate(() => window.contextRequests.length), requests);
    assert.equal(await app.page.evaluate(() => window.commandScope), undefined);
  } finally { await app.close(); }
});


test('staff Help chrome expiry keeps a separately admitted owner POS draft and single-writer lock intact', { skip, timeout: 40000 }, async () => {
  const app = await fixture('/pos', true); try {
    const amount = app.page.locator('.owner-amount-field input[aria-label=Amount]');
    await amount.fill('118.75'); await amount.evaluate(node => window.savedAmount = node);
    await navigate(app.page, '/staff/my-work');
    await app.page.waitForFunction(() => window.contextRequests.includes('/staff/my-work'));
    await app.page.evaluate(() => window.releaseFamily('portal'));
    await app.page.locator('[data-fixture-page="staff.my-work"]').waitFor();
    await navigate(app.page, '/help');
    await app.page.waitForFunction(() => document.querySelector('[data-presented-role="STAFF"]'));
    const requests = await app.page.evaluate(() => window.contextRequests.length);
    await app.page.clock.fastForward(30_001);
    await app.page.waitForFunction(() => !document.querySelector('[data-presented-scope]'));
    assert.equal(await app.page.evaluate(() => window.resets), 0);
    assert.equal(await app.page.evaluate(() => window.commandScope), undefined);
    assert.equal(await app.page.evaluate(() => window.savedAmount.isConnected), true);
    assert.equal(await app.page.evaluate(() => window.contextRequests.length), requests);
    const locks = await app.page.evaluate(() => navigator.locks.query());
    assert.ok(locks.held.some(lock => lock.name.startsWith('kingpos:workspace-window:owner:')));
    await navigate(app.page, '/pos'); await amount.waitFor();
    assert.equal(await amount.evaluate(node => node === window.savedAmount), true);
    assert.equal(await amount.inputValue(), '118.75');
    assert.equal(await app.page.evaluate(() => window.commandScope), scopes.account);
    assert.equal(await app.page.evaluate(() => window.resets), 0);
    assert.deepEqual(await app.page.evaluate(() => window.apiCalls), []);
  } finally { await app.close(); }
});

test('Help presentation cannot survive reset, changed device generation or expired owner grant', { skip, timeout: 50000 }, async () => {
  for (const scenario of ['reset', 'generation', 'expiry']) {
    const app = await fixture('/pos', scenario === 'expiry'); try {
      await app.page.locator('.owner-amount-field input[aria-label=Amount]').waitFor();
      await navigate(app.page, '/help'); await app.page.waitForFunction(() => document.querySelector('[data-presented-role="OWNER"]'));
      const requests = await app.page.evaluate(() => window.contextRequests.length);
      if (scenario === 'reset') await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:app-local-reset')));
      if (scenario === 'generation') { await app.page.evaluate(() => window.__reylumiAppLocalContext.generation = 'another-device-generation'); await navigate(app.page, '/help/owner-pos'); }
      if (scenario === 'expiry') await app.page.clock.fastForward(3_600_001);
      await app.page.waitForFunction(() => !document.querySelector('[data-presented-scope]'), undefined, {timeout:5000}).catch(async error => {
        console.error(JSON.stringify({scenario,state:await app.page.evaluate(()=>({now:Date.now(),expiresAt:window.fixture.owner.grant.expiresAt,scope:document.querySelector('[data-presented-scope]')?.getAttribute('data-presented-scope'),generation:window.__reylumiAppLocalContext.generation,requests:window.contextRequests,resets:window.resets}))})); throw error;
      });
      assert.equal(await app.page.getByRole('heading', { name: 'Full public Help frame' }).isVisible(), true);
      assert.equal(await app.page.evaluate(() => window.commandScope), undefined);
      assert.equal(await app.page.evaluate(() => window.contextRequests.length), requests);
      assert.deepEqual(await app.page.evaluate(() => window.apiCalls), []);
    } finally { await app.close(); }
  }
});


test('held staff-family context cannot send old-owner scoped reads or commands; original POS and Check-in DOM/lock survive', { skip, timeout: 50000 }, async () => {
  const app = await fixture(); try {
    const amount = app.page.locator('.owner-amount-field input[aria-label=Amount]'); await amount.waitFor(); await amount.fill('77.25'); await amount.evaluate(node => window.savedAmount = node);
    await navigate(app.page, '/pos/check-in'); const checkin = app.page.locator('[data-owner-local-panel="/pos/check-in"]'); await checkin.getByText('Alice', { exact: true }).waitFor(); await checkin.evaluate(node => window.savedCheckin = node);
    await navigate(app.page, '/staff/my-work'); await app.page.waitForFunction(() => window.contextRequests.includes('/staff/my-work'));
    assert.equal(await app.page.evaluate(() => window.commandScope), undefined); assert.equal(await app.page.evaluate(() => window.cacheReads.some(row => row.name.startsWith('staff.'))), false); assert.equal(await app.page.evaluate(() => window.savedAmount.isConnected && window.savedCheckin.isConnected), true);
    const locks = await app.page.evaluate(() => navigator.locks.query()); assert.ok(locks.held.some(lock => lock.name.startsWith('kingpos:workspace-window:owner:')));
    await app.page.evaluate(() => window.releaseFamily('portal')); await app.page.locator('[data-fixture-page="staff.my-work"]').waitFor(); assert.equal(await app.page.evaluate(() => window.commandScope), scopes.portal);
    const before = await app.page.evaluate(() => ({ sync: window.syncCalls, reads: window.reads.filter(row => row.name.startsWith('owner.')).length })); await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:foreground'))); await app.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await app.page.evaluate(() => window.syncCalls), before.sync); assert.equal(await app.page.evaluate(() => window.reads.filter(row => row.name.startsWith('owner.')).length), before.reads);
    await navigate(app.page, '/pos'); await amount.waitFor(); assert.equal(await amount.evaluate(node => node === window.savedAmount), true); assert.equal(await amount.inputValue(), '77.25'); await navigate(app.page, '/pos/check-in'); await checkin.waitFor(); assert.equal(await checkin.evaluate(node => node === window.savedCheckin), true); assert.equal(await app.page.evaluate(() => window.wrongScope), 0); assert.equal(await app.page.evaluate(() => window.resets), 0); assert.deepEqual(await app.page.evaluate(() => window.apiCalls), []);
  } finally { await app.close(); }
});

test('portal/workday/account remain distinct; unadmitted Market paints static content and rapid late context cannot win', { skip, timeout: 50000 }, async () => {
  const app = await fixture('/staff/my-work'); try {
    await app.page.waitForFunction(() => window.contextRequests.includes('/staff/my-work')); await app.page.evaluate(() => window.releaseFamily('portal')); await app.page.locator('[data-fixture-page="staff.my-work"]').waitFor();
    await navigate(app.page, '/staff/workday'); await app.page.waitForFunction(() => window.contextRequests.includes('/staff/workday')); assert.equal(await app.page.evaluate(() => window.commandScope), undefined); assert.equal(await app.page.evaluate(() => window.cacheReads.some(row => row.name === 'staff.workday')), false);
    await app.page.evaluate(() => window.held.push('account')); await navigate(app.page, '/market'); await app.page.getByRole('heading', { name: 'Static Market frame' }).waitFor(); assert.equal(await app.page.evaluate(() => window.commandScope), undefined); await app.page.evaluate(() => window.releaseFamily('account')); await app.page.locator('[data-fixture-page="page.market"]').getByRole('heading', { name: 'Market data' }).waitFor();
    await app.page.evaluate(() => window.releaseFamily('workday')); assert.equal(await app.page.evaluate(() => window.commandScope), scopes.account); assert.equal(await app.page.locator('[data-fixture-page="staff.workday"]').count(), 0); assert.equal(await app.page.evaluate(() => window.wrongScope), 0);
    await navigate(app.page, '/staff/workday'); await app.page.locator('[data-fixture-page="staff.workday"]').waitFor(); assert.equal(await app.page.evaluate(() => window.commandScope), scopes.workday);
    await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:app-local-reset'))); await app.page.getByRole('heading', { name: 'Opening role view' }).waitFor(); assert.equal(await app.page.evaluate(() => window.commandScope), undefined); assert.equal(await app.page.locator('[data-fixture-page="staff.my-work"]').count(), 0);
  } finally { await app.close(); }
});

test('scope validation from an old scope or hidden Activity cannot stamp the current provider as verified', { skip, timeout: 30000 }, async () => {
  const output = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';import{ExperienceScopeProvider,useExperienceScope}from'./app/local-app/scope';function Probe(){const s=useExperienceScope();window.currentScope=s;return <p data-scope={s.context.scope}>{s.checkedAt()}:{s.getValidationRevision()}</p>}function App(){const[scope,setScope]=useState('A'),[visible,setVisible]=useState(true);window.setScope=setScope;window.hide=()=>setVisible(false);return <Activity mode={visible?'visible':'hidden'}><ExperienceScopeProvider context={{scope,authenticated:true}} guardForms={false}><Probe/></ExperienceScopeProvider></Activity>}createRoot(document.getElementById('app')).render(<App/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'held-validation', setup(builder) { builder.onResolve({ filter: /(?:^|\/)app-local-host$/ }, () => ({ path: 'host', namespace: 'fixture' })); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `window.pending=[];export const getAppLocalHost=()=>({context:()=>new Promise(resolve=>window.pending.push(resolve))});` })); builder.onResolve({ filter: /offline-network-form-guard$/ }, () => ({ path: 'guard', namespace: 'guard' })); builder.onLoad({ filter: /.*/, namespace: 'guard' }, () => ({ loader: 'js', contents: 'export const OfflineNetworkFormGuard=()=>null;' })); } }] });
  const app = await serve(output.outputFiles[0].text, {}, '/settings'); try {
    await app.page.locator('[data-scope=A]').waitFor(); await app.page.evaluate(() => { window.old = window.currentScope; window.resultA = window.old.validate(); window.setScope('B'); }); await app.page.locator('[data-scope=B]').waitFor();
    await app.page.evaluate(() => window.pending.shift()({ context: { scope: 'A' }, onlineValidatedAt: 12345 })); assert.equal(await app.page.evaluate(() => window.resultA), false); assert.equal(await app.page.evaluate(() => window.currentScope.checkedAt()), 0); assert.equal(await app.page.evaluate(() => window.currentScope.getValidationRevision()), 0);
    await app.page.evaluate(() => { window.resultB = window.currentScope.validate(); }); await app.page.evaluate(() => window.pending.shift()({ context: { scope: 'B' }, onlineValidatedAt: 22222 })); assert.equal(await app.page.evaluate(() => window.resultB), true); assert.equal(await app.page.evaluate(() => window.currentScope.checkedAt()), 22222);
    await app.page.evaluate(() => { window.hiddenValidation = window.currentScope.validate(); window.hide(); }); await app.page.waitForFunction(() => document.querySelector('[data-scope]')?.style.display === 'none'); await app.page.evaluate(() => window.pending.shift()({ context: { scope: 'B' }, onlineValidatedAt: 33333 })); assert.equal(await app.page.evaluate(() => window.hiddenValidation), false); assert.equal(await app.page.evaluate(() => window.currentScope.checkedAt()), 22222);
  } finally { await app.close(); }
});
