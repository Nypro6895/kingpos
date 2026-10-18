import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
const scope = 'v3:' + 'a'.repeat(64);
let bundle;

// Keep the actual entry, native JS host, Explore registry, startup shell and
// resource lifecycle. Substitute unrelated page families and the final feed
// renderer; every native reply stays local and business commands are forbidden.
async function script() {
  bundle ??= build({
    entryPoints: ['app/local-app/entry.tsx'], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'actual-entry-explore-session-recovery', setup(builder) {
      const noPage = name => `export const ${name}=()=>null;`;
      const stubs = {
        'next/navigation': `export*from'./app/local-app/navigation';`,
        'next/link': `export{AppLocalLink as default,useLinkStatus}from'./app/local-app/navigation';`,
        'next/image': `export{AppLocalImage as default}from'./app/local-app/navigation';`,
        'next/form': `export{AppLocalForm as default}from'./app/local-app/navigation';`,
        '@/components/app-local-shell': `import{useRouter}from'./app/local-app/navigation';export function AppLocalShell({children,context}){const router=useRouter();return <div data-entry-shell data-active-scope={context?.context.scope}><header><button onClick={()=>router.push('/explore')}>Explore</button></header>{children}</div>}`,
        '@/components/app-local-help': 'export const AppLocalHelp=()=> <h1>Public help</h1>;',
        '@/app/legal/legal-components': 'export const LegalDocumentPage=()=>null;export const LegalHub=()=>null;',
        '@/lib/legal-policies': 'export const legalDocuments={};',
        '@/lib/app-local-reference-content': 'export const APP_LOCAL_REFERENCE_ASSETS=[];',
        '@/components/workspace-language': `export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='span',text,...props})=><Tag {...props}>{text}</Tag>;export const useWorkspaceTranslation=()=>x=>x;`,
        '@/components/offline-network-form-guard': 'export const OfflineNetworkFormGuard=()=>null;',
        '@/app/explore/explore-search-input': `export const ExploreSearchInput=({initialDraftValue,onSuggestionSelect,category,location,...props})=><input {...props}/>;`,
        '@/app/explore/explore-progressive-client': `export function ExploreProgressiveClient({initial}){return <main data-ready-explore><h1>{initial.fixtureTitle}</h1><label>Explore draft<input aria-label="Explore draft" defaultValue=""/></label></main>}`,
        '@/lib/explore-discovery-presentation': 'export const buildExploreDiscoveryContent=()=>({});',
        '@/lib/explore-showcase-content': 'export const enrichExploreShowcaseContent=value=>value;',
        'app-local-command-client': `let scope;export const getAppLocalCommandScope=()=>scope;export const setAppLocalCommandScope=value=>{scope=value;window.commandScope=value};`,
        'experience-persistent-cache': `export const acceptExperienceOfflineGrant=async()=>true;export const clearExperienceSnapshots=async()=>{};export const getExperienceDeviceGeneration=()=>window.__reylumiAppLocalContext.generation;export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};`,
        'experience-state': 'export const clearExperienceState=()=>{};',
        'app-local-data-policy': 'export const appLocalReadIsDurable=()=>true;',
        'app-local-page-registry': noPage('getAppLocalPage'),
        'app-local-personal-registry': noPage('getAppLocalPersonalPage'),
        'app-local-owner-page-registry': noPage('getAppLocalOwnerPage'),
        'app-local-business-registry': noPage('getAppLocalBusinessPage'),
        'app-local-public-registry': noPage('getAppLocalPublicPage'),
        'app-local-daily-registry': noPage('getAppLocalDailyPage'),
        'app-local-secondary-registry': noPage('getAppLocalSecondaryPage') + 'export const appLocalRouteAlias=()=>null;',
        'app-local-payroll-tax-registry': noPage('getAppLocalPayrollTaxPage'),
        'app-local-commerce-registry': noPage('getAppLocalCommercePage'),
        'app-local-portable-registry': noPage('getAppLocalPortablePage'),
        'app-local-display-registry': noPage('getAppLocalDisplayPage'),
        '@/app/pos/owner-local-workspace': 'export const OwnerLocalWorkspace=({children})=>children;',
        '@/app/pos/owner-local-panels': 'export const OwnerLocalPanels=()=>null;',
        '@/app/pos/owner-pos-client': 'export const OwnerPosClient=()=>null;',
        '@/app/pos/owner-pos-tabs': 'export const OwnerPosNavigation=()=>null;',
        'app-local-http-client': 'export const installAppLocalHttpClient=()=>{};',
        'app-local-role-http-client': 'export const installAppLocalRoleHttpClient=()=>{};',
        'app-local-personal-http-client': 'export const installAppLocalPersonalHttpClient=()=>{};',
        'app-local-explore-http-client': 'export const installAppLocalExploreHttpTransport=()=>{};',
        'app-local-public-http-client': 'export const installAppLocalPublicHttpTransport=()=>{};',
        'app-local-business-http-client': 'export const installAppLocalBusinessHttpClient=()=>{};',
        'app-local-shell-http-client': 'export const installAppLocalShellHttpTransport=()=>{};',
        'app-local-portable-http-client': 'export const installAppLocalPortableHttpClient=()=>{};',
        'app-local-display-http-client': 'export const installAppLocalDisplayHttpClient=()=>{};',
      };
      builder.onResolve({ filter: /.*/ }, args => {
        const name = Object.keys(stubs).find(name => args.path === name || args.path.endsWith('/' + name));
        return name ? { path: name, namespace: 'fixture' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: process.cwd(), contents: stubs[args.path] }));
      builder.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: 'export default {};' }));
    } }],
  });
  return (await bundle).outputFiles[0].text;
}

function nativeFixture(options) {
  return `
  window.fixture=${JSON.stringify(options)};
  window.__reylumiAppLocalContext={version:1,nonce:'11111111-1111-4111-8111-111111111111',scopeEpoch:1,generation:'fixture-device-generation'};
  window.contextRequests=[];window.reads=[];window.cacheReads=[];window.commands=[];
  window.contextFailures=window.fixture.contextFailures??0;window.invalidContext=Boolean(window.fixture.invalidContext);window.expiredOfflineContext=Boolean(window.fixture.expiredOfflineContext);
  window.__reylumiAppLocalTransport={async request(request){
    if(request.kind==='context'){
      window.contextRequests.push({...request.args});
      if(window.contextFailures>0){window.contextFailures--;throw Object.assign(new Error('Fixture connection unavailable'),{status:503})}
      if(window.invalidContext)return{schemaVersion:1,context:{scope:'invalid-scope'}};
      const now=Date.now();
      if(window.expiredOfflineContext)return{schemaVersion:1,contextPath:request.args.path,host:window.__reylumiAppLocalContext,offline:true,onlineValidatedAt:now-60000,
        context:{scope:'${scope}',viewerId:'33333333-3333-4333-8333-333333333333',workspaceId:'personal',salonId:null,permissionRevision:'customer-r1',authenticated:true},
        grant:{version:1,scope:'${scope}',scopes:['${scope}'],viewerId:'33333333-3333-4333-8333-333333333333',workspaceId:'personal',salonId:null,grantRevision:'customer-r1',generation:window.__reylumiAppLocalContext.generation,issuedAt:now-120000,expiresAt:now-60000,path:'/explore',kind:'customer'}};
      return{schemaVersion:1,contextPath:request.args.path,host:window.__reylumiAppLocalContext,offline:false,grant:null,
        context:{scope:'${scope}',viewerId:'33333333-3333-4333-8333-333333333333',workspaceId:'personal',salonId:null,permissionRevision:'customer-r1',authenticated:true},
        display:{name:'Fixture customer',role:'CUSTOMER',language:'en'},access:{ownerWorkspace:false,staffWorkspace:false},onlineValidatedAt:now};
    }
    if(request.kind==='read'){
      window.reads.push({name:request.name,scope:request.args.scope});
      if(request.args.scope!=='${scope}')throw Object.assign(new Error('Wrong authority'),{status:409});
      if(request.name!=='page.explore')throw new Error('Unexpected read '+request.name);
      return{schemaVersion:1,status:200,scope:'${scope}',etag:'fixture-core',updatedAt:Date.now(),data:{fixtureTitle:'Explore loaded',deferred:{extras:false,feed:false},homeContent:{},discoveryContent:{},quickActions:[]}};
    }
    if(request.kind==='cache'){window.cacheReads.push(request.name);return request.name==='cancel'?{ok:true}:null}
    if(request.kind==='command'){window.commands.push(request.name);throw new Error('Fixture forbids commands')}
    throw new Error('Unexpected native operation '+request.kind);
  }};`;
}

async function fixture(options = {}) {
  const js = await script();
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? js : '<!doctype html><style>[hidden]{display:none!important}body{font:16px Arial}button,input{min-height:40px}</style><div id="app"></div><script>' + nativeFixture(options) + '</script><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } }), errors = [];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port + '/explore');
  return { page, async close() {
    const commands = await page.evaluate(() => window.commands);
    await browser.close(); await new Promise(resolve => server.close(resolve));
    assert.deepEqual(errors, [], 'recovery does not crash the installed client');
    assert.deepEqual(commands, [], 'read recovery never replays a business command');
  } };
}

const retry = page => page.getByRole('button', { name: 'Try again', exact: true });
const ready = page => page.getByRole('heading', { name: 'Explore loaded', exact: true });

test('Explore context failure exposes retry without starting unauthorized page reads; retry restores the real resource lifecycle', { skip, timeout: 30000 }, async () => {
  const app = await fixture({ contextFailures: 1 });
  try {
    await retry(app.page).waitFor();
    assert.equal(await app.page.locator('[data-explore-startup]').count(), 1);
    assert.deepEqual(await app.page.evaluate(() => window.reads), []);
    assert.equal(await app.page.locator('[data-entry-shell]').getAttribute('data-active-scope'), null);
    await retry(app.page).click(); await ready(app.page).waitFor();
    assert.equal(await app.page.locator('[data-entry-shell]').getAttribute('data-active-scope'), scope);
    assert.equal(await app.page.evaluate(() => window.contextRequests.length), 2);
    assert.equal(await app.page.evaluate(() => window.contextRequests.at(-1).fresh), true);
    assert.deepEqual(await app.page.evaluate(() => window.reads), [{ name: 'page.explore', scope }]);
    assert.equal(await retry(app.page).count(), 0);
  } finally { await app.close(); }
});

test('selecting the already open Explore page recovers missing authority instead of leaving the same skeleton', { skip, timeout: 30000 }, async () => {
  const app = await fixture({ contextFailures: 1 });
  try {
    await retry(app.page).waitFor();
    await app.page.getByRole('button', { name: 'Explore', exact: true }).click();
    await ready(app.page).waitFor();
    assert.equal(await app.page.evaluate(() => window.contextRequests.length), 2);
    assert.equal(await app.page.evaluate(() => window.contextRequests.at(-1).fresh), true);
    assert.equal(await app.page.evaluate(() => location.pathname), '/explore');
  } finally { await app.close(); }
});

test('malformed fulfilled context is a recoverable error, never an indefinite unadmitted Explore shell', { skip, timeout: 30000 }, async () => {
  const app = await fixture({ invalidContext: true });
  try {
    await retry(app.page).waitFor();
    assert.deepEqual(await app.page.evaluate(() => window.reads), []);
    await app.page.evaluate(() => { window.invalidContext = false; });
    await retry(app.page).click(); await ready(app.page).waitFor();
    assert.equal(await app.page.evaluate(() => window.contextRequests.length), 2);
  } finally { await app.close(); }
});

test('an expired offline admission exposes retry and cannot issue Explore reads until a fresh context succeeds', { skip, timeout: 30000 }, async () => {
  const app = await fixture({ expiredOfflineContext: true });
  try {
    await retry(app.page).waitFor();
    assert.deepEqual(await app.page.evaluate(() => window.reads), []);
    assert.equal(await app.page.evaluate(() => window.commandScope), undefined);
    await app.page.evaluate(() => { window.expiredOfflineContext = false; });
    await retry(app.page).click(); await ready(app.page).waitFor();
    assert.equal(await app.page.evaluate(() => window.contextRequests.length), 2);
    assert.equal(await app.page.evaluate(() => window.contextRequests.at(-1).fresh), true);
  } finally { await app.close(); }
});

test('native reset followed by failed foreground verification remains recoverable and restarts only authorized reads', { skip, timeout: 30000 }, async () => {
  const app = await fixture();
  try {
    await ready(app.page).waitFor();
    await app.page.evaluate(() => {
      window.contextFailures = 1;
      window.dispatchEvent(new Event('reylumi:app-local-reset'));
      window.dispatchEvent(new Event('reylumi:foreground'));
    });
    await retry(app.page).waitFor();
    assert.equal(await app.page.locator('[data-entry-shell]').getAttribute('data-active-scope'), null);
    assert.equal(await ready(app.page).count(), 0);
    const before = await app.page.evaluate(() => window.contextRequests.length);
    await retry(app.page).click(); await ready(app.page).waitFor();
    assert.equal(await app.page.evaluate(() => window.contextRequests.length), before + 1);
    assert.equal(await app.page.evaluate(() => window.contextRequests.at(-1).fresh), true);
    // A foreground listener can finish a server-authorized refresh in the same
    // tick as reset. Recovery may retain that fresh data instead of refetching.
    assert.ok(await app.page.evaluate(() => window.reads.length >= 1 && window.reads.every(read => read.name === 'page.explore' && read.scope === window.commandScope)));
    assert.equal(await app.page.evaluate(() => window.commandScope), scope);
  } finally { await app.close(); }
});

test('a transient foreground failure preserves an already admitted Explore draft and restores fresh verification without commands', { skip, timeout: 30000 }, async () => {
  const app = await fixture();
  try {
    await ready(app.page).waitFor();
    const draft = app.page.getByRole('textbox', { name: 'Explore draft', exact: true });
    await draft.fill('unfinished search'); await draft.evaluate(node => { window.savedExploreDraft = node; });
    await app.page.evaluate(() => { window.contextFailures = 1; window.dispatchEvent(new Event('reylumi:foreground')); });
    await app.page.waitForFunction(() => window.contextFailures === 0);
    assert.equal(await draft.inputValue(), 'unfinished search');
    assert.equal(await draft.evaluate(node => node === window.savedExploreDraft), true);
    await app.page.evaluate(() => window.dispatchEvent(new Event('reylumi:foreground')));
    await app.page.waitForFunction(() => window.contextRequests.length === 3);
    assert.equal(await draft.inputValue(), 'unfinished search');
    assert.equal(await draft.evaluate(node => node === window.savedExploreDraft), true);
    assert.equal(await app.page.evaluate(() => window.commandScope), scope);
  } finally { await app.close(); }
});
