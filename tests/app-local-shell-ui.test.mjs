import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const salon = '11111111-1111-4111-8111-111111111111';
let productionStyles;
function realOwnerStyles() {
  productionStyles ??= postcss([tailwind({ base: process.cwd(), optimize: true })]).process([
    'app/globals.css', 'app/pos/owner-pos.css', 'app/local-app/app.css',
  ].map(file => readFileSync(file, 'utf8')).join('\n'), { from: path.resolve('app/globals.css') }).then(result => result.css);
  return productionStyles;
}
async function fixture({ retainedOwner = false } = {}) {
  const summary = { items: [], beautyPublicationRequests: 0, bookingNotifications: 0, managerApplications: 0, previewItems: [], reviewHref: '/notifications', staffApplications: 0, staffInvites: 0, total: 0 };
  const owner = { accountId: 'account', accountName: 'Fixture account', avatarUrl: null, businessId: null, businessMode: 'manage', businessName: 'Fixture Salon', defaultHref: '/pos', description: null, id: 'manage:' + salon, label: 'Fixture Salon', menuActions: [], primaryAction: { href: '/pos', id: 'pos', label: 'POS' }, quickActions: [], roleCode: 'OWNER', roleLabel: 'Owner', salonCount: 1, salonId: salon, salonMode: 'manage', salonName: 'Fixture Salon', secondaryAction: null, type: 'salon' };
  const second = { ...owner, id: 'manage:second', salonId: 'second', salonName: 'Second Salon', businessName: 'Second Salon', label: 'Second Salon' };
  const data = { scope: 'scope-a', authenticated: true, ownerQueueScope: 'owner:' + salon + ':viewer', audience: 'owner', navigation: { accountAvatarUrl: null, accountEmail: 'viewer@example.invalid', accountLabel: 'Viewer', canManageStaff: true, canSwitchManageSalon: true, currentManageSalonId: salon, currentManageSalonName: 'Fixture Salon', currentAccountName: 'Fixture Account', currentUserId: 'viewer', currentStaffSalonId: null, currentStaffSalonName: null, currentWorkspace: owner, manageSalons: [{ id: salon, name: 'Fixture Salon' }, { id: 'second', name: 'Second Salon' }], notificationSummary: summary, staffSalons: [], workspaceOptions: [owner, second, { ...owner, id: 'personal', label: 'Personal', type: 'personal', salonMode: null, salonId: null, salonName: null, businessMode: null, businessName: null, roleLabel: 'Personal', defaultHref: '/explore' }], workspaceSections: [], workspaceType: 'salon', salonMode: 'manage' } };
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AppLocalShell}from'./components/app-local-shell';import{MarketClient}from'./app/market/market-client';import{AppLocalNavigationProvider}from'./app/local-app/navigation';import{useExploreAuthenticated}from'./components/explore-account-actions';import{WorkspaceText}from'./components/workspace-language';import{AppLocalHelp}from'./components/app-local-help';import{OwnerPosTabs}from'./app/pos/owner-pos-tabs';import{RoleMoreContent}from'./components/role-more-content';import{usePathname}from'next/navigation';
window.shellMenu=undefined;window.shellConfig=undefined;window.shellNotice=undefined;window.requests=[];window.resourceCalls=[];window.queueScopes=[];window.workspaceCalls=[];window.actionCalls=[];window.translateLoads=0;window.onlinePaths=[];window.contextCalls=[];window.contextReply=null;window.fetch=async(input,init)=>{const url=new URL(String(input),location.href);window.requests.push({path:url.pathname,method:init?.method??'GET'});if(url.pathname==='/api/auth/session')return Response.json({authenticated:true});if(url.pathname==='/api/explore/advertising')return Response.json({campaigns:[]});if(url.pathname==='/api/notifications')return Response.json({items:[],unreadCount:0});if(url.pathname==='/api/public-booking/context')return new Promise(resolve=>window.bookingResolve=resolve);throw Error('Unexpected shell fetch '+url.pathname)};
function RetainedOwnerContent(){const path=usePathname(),areas={'/pos':'pos','/pos/check-in':'checkIn','/pos/book':'book','/pos/ticket':'ticket','/pos/report':'report'},inPos=path in areas;return <div className='app-local-body'><div className='app-local-page' hidden={!inPos}><div data-owner-workspace='true'><header className='owner-heading'><OwnerPosTabs active={areas[path]??'pos'}/></header><div hidden={path!=='/pos'}><section className='owner-checkout' data-owner-reference='true'><label>Retained money<input aria-label='Retained money' defaultValue='42.00'/></label></section></div></div></div>{!inPos?<section data-fixture-destination={path} style={{minHeight:1800,padding:24}}>{path==='/help'?<AppLocalHelp language='en' navigate={path=>window.changePath(path)}/>:<h1>{path}</h1>}{path==='/more'?<RoleMoreContent roleKind='owner' activeItemIds={[]} onNavigate={()=>{}}/>:null}<a href='/pos' onClick={event=>{event.preventDefault();window.changePath('/pos')}}>Return to POS</a></section>:null}</div>}
function Content(){const authenticated=useExploreAuthenticated();const path=usePathname();if(${retainedOwner})return <RetainedOwnerContent/>;if(path.startsWith('/help'))return <AppLocalHelp language='en' slug={path.startsWith('/help/')?path.slice(6):undefined} navigate={path=>window.changePath(path)}/>;return <><input aria-label='Money draft' defaultValue='157.25'/><div data-authenticated={String(authenticated)}><WorkspaceText text='Save'/></div><a href='/book/${salon}'>Book fixture salon</a><MarketClient paymentsAvailable={false}/></>}
function App(){const[current,setPath]=useState(location.pathname),[context,setContext]=useState(null),[revision,setRevision]=useState(0);window.setContext=()=>setContext({schemaVersion:1,context:{scope:'scope-a',viewerId:'viewer',authenticated:true,salonId:'${salon}'}});window.setDeviceContext=()=>{window.requests=[];window.resourceCalls=[];setPath('/pos/portable');setContext({schemaVersion:1,context:{scope:'salon:key',viewerId:null,authenticated:false},grant:{kind:'portable'}})};window.setGuestContext=()=>setContext({schemaVersion:1,context:{scope:'guest',viewerId:null,authenticated:false}});window.releaseNotice=()=>{window.shellNotice={scope:'scope-a',mode:'review'};setRevision(x=>x+1)};window.releaseMenu=()=>{window.shellMenu=${JSON.stringify(data)};setRevision(x=>x+1)};window.releaseLanguage=()=>{window.shellConfig={scope:'scope-a',language:{enabled:true,portableEnabled:false,expiresAt:'2099-01-01T00:00:00Z'},campaign:{installed:false,runtime:null}};setRevision(x=>x+1)};window.changePath=path=>{history.pushState({},'',path);setPath(path)};return <AppLocalNavigationProvider value={{path:current,navigate:window.changePath,refresh:()=>{}}}><AppLocalShell context={${retainedOwner}&&current.startsWith('/help')?null:context} presentationContext={${retainedOwner}&&current.startsWith('/help')?context:null} path={current}><div data-revision={revision}><Content/></div></AppLocalShell></AppLocalNavigationProvider>};createRoot(document.getElementById('app')).render(<App/>);` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '""', 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '""', 'process.env.NEXT_PUBLIC_MAPTILER_KEY': '""', 'process.env.NEXT_PUBLIC_BOOKING_STRIPE_PUBLISHABLE_KEY': '""' }, plugins: [{ name: 'original-shell-browser', setup(b) {
    const fixtures = {
      'next/navigation': `export*from'./app/local-app/navigation'`, 'next/link': `export{AppLocalLink as default,useLinkStatus}from'./app/local-app/navigation'`, 'next/image': `export{AppLocalImage as default}from'./app/local-app/navigation'`, 'next/form': `export{AppLocalForm as default}from'./app/local-app/navigation'`,
      'next/dynamic': `import React,{lazy,Suspense}from'react';export default function dynamic(loader){const View=lazy(()=>loader().then(x=>({default:x.default??x})));return props=><Suspense fallback={null}><View {...props}/></Suspense>}`,
      '@/lib/app-local-host': `export const appLocalPath=x=>x;export const appLocalRequestId=()=>crypto.randomUUID();export const getAppLocalHost=()=>({isNative:true,async context(path,options){window.contextCalls.push({path,options:{fresh:options?.fresh}});if(!window.contextReply)throw Error('temporary unavailable');return window.contextReply},async openOnline(path){window.onlinePaths.push(path)}})`,
      '@/lib/supabase/browser': 'export const createSupabaseBrowserClient=()=>null', '@/components/experience-scope': 'export const useExperienceScope=()=>({context:{scope:"scope-a"},validate:async()=>true})',
      '@/lib/portable-operations': 'export async function syncPortableOperations(scope){window.queueScopes.push(scope)}export const listPortableOperations=async()=>[];export const cancelPortableOperation=async()=>{};export const canCancelPortableOperation=()=>false;export const retryPortableOperation=async()=>{};export const PORTABLE_OPERATIONS_CHANGED="kingpos:operations-changed"',
      '@/lib/workspace-navigation': 'export function navigateToWorkspace(...args){window.workspaceCalls.push(args)}',
      '@/lib/workspace-translator-client': `export async function loadWorkspaceTranslator(){window.translateLoads++;return text=>text==='Save'?'Lưu':text}`,
      '@/lib/app-local-resource': `export function useAppLocalResource(scope,name,args,options){window.resourceCalls.push({scope,name,enabled:options?.enabled});return{data:name==='shell.navigation'?window.shellMenu:name==='shell.configuration'?window.shellConfig:name==='shell.notice'?window.shellNotice:undefined,loading:false,refreshing:false,updatedAt:Date.now(),refresh:async()=>{}}}`,
    };
    b.onResolve({ filter: /.*/ }, a => { if (a.path in fixtures) return { path: a.path, namespace: 'fixture' }; if (a.path.endsWith('.css')) return { path: a.path, namespace: 'css' }; if (!a.path.startsWith('@/') && !a.path.startsWith('.')) return; const base = a.path.startsWith('@/') ? path.resolve(a.path.slice(2)) : path.resolve(path.dirname(a.importer), a.path), file = ['.ts', '.tsx'].map(x => base + x).find(existsSync); if (file && /^\s*["']use server["']/.test(readFileSync(file, 'utf8'))) return { path: file, namespace: 'action' }; });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'tsx', resolveDir: process.cwd(), contents: fixtures[a.path] })); b.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ loader: 'js', contents: 'export default new Proxy({},{get:(_,x)=>x})' })); b.onLoad({ filter: /.*/, namespace: 'action' }, a => ({ loader: 'js', contents: [...readFileSync(a.path, 'utf8').matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(([, name]) => `export async function ${name}(...args){window.actionCalls.push({name:${JSON.stringify(name)},args});return null}`).join('\n') }));
  } }] });
  const styles = retainedOwner ? await realOwnerStyles() : '[hidden],.hidden{display:none!important}body{font:14px system-ui}button,input{min-height:32px}';
  const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/fixture.js' ? 'application/javascript' : 'text/html'); res.end(req.url === '/fixture.js' ? bundle.outputFiles[0].text : '<!doctype html><style>' + styles + '</style><div id="app"></div><script src="/fixture.js"></script>'); }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  return { browser, origin: 'http://127.0.0.1:' + server.address().port, close: async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}
test('actual Market input survives held shell menu, entitlement update and original shell route topology; account and quick booking context are real', { skip: !existsSync(browserPath), timeout: 90000 }, async () => {
  const f = await fixture(); let page; const errors = [];
  try {
    page = await f.browser.newPage({ viewport: { width: 390, height: 844 } }); page.on('pageerror', e => errors.push(e.message)); await page.route('**/*', route => route.request().resourceType() === 'document' || new URL(route.request().url()).pathname === '/fixture.js' ? route.continue() : route.abort());
    await page.goto(f.origin + '/market'); const search = page.getByRole('textbox', { name: 'Search features', exact: true }); await search.fill('Payroll'); await page.getByRole('textbox', { name: 'Money draft' }).fill('157.42'); await search.evaluate(element => window.savedSearch = element); await page.evaluate(() => { window.savedMoney = document.querySelector('[aria-label="Money draft"]'); window.setContext(); });
    await page.waitForFunction(() => document.querySelector('[data-authenticated="true"]')); assert.equal(await search.inputValue(), 'Payroll'); assert.equal(await page.locator('[aria-busy=true]').count(), 0);
    await page.evaluate(() => window.releaseMenu()); await page.getByRole('button', { name: 'Open account switcher', exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.savedMoney === document.querySelector('[aria-label="Money draft"]')), true); assert.equal(await search.inputValue(), 'Payroll'); assert.equal(await search.evaluate(element => window.savedSearch === element), true);
    await page.evaluate(() => window.releaseLanguage()); await page.waitForFunction(() => document.documentElement.lang === 'vi'); assert.equal(await page.locator('[data-authenticated=true]').textContent(), 'Lưu');
    await page.evaluate(() => window.releaseNotice()); await page.locator('aside[role=status]').filter({hasText:'Your posts and comments require review before they appear publicly.'}).waitFor(); assert.equal(await search.evaluate(element => element===window.savedSearch),true);
    for (const href of ['/pos', '/pos/check-in', '/pos', '/unregistered-route', '/market']) { await page.evaluate(path => window.changePath(path), href); assert.equal(await page.evaluate(() => window.savedMoney === document.querySelector('[aria-label="Money draft"]')), true); assert.equal(await page.getByRole('textbox', { name: 'Money draft' }).inputValue(), '157.42'); }
    await page.getByRole('button', { name: 'Open account switcher', exact: true }).click(); await page.getByRole('button', { name: 'Switch to Second Salon', exact: true }).click(); assert.equal(await page.evaluate(() => window.workspaceCalls.length), 1);
    await page.getByRole('link', { name: 'Book fixture salon', exact: true }).click(); await page.getByRole('dialog', { name: 'Quick booking', exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.requests.some(x => x.path === '/api/public-booking/context')), true); assert.equal(await page.getByRole('dialog', { name: /beauty moment/ }).count(), 0); assert(await page.evaluate(() => window.queueScopes.every(scope => scope === 'owner:' + '11111111-1111-4111-8111-111111111111' + ':viewer'))); assert.deepEqual(errors, []);
  } catch (error) { console.error(JSON.stringify({ errors, body: await page?.locator('body').innerText() })); throw error; } finally { await f.close(); }
});

test('unconfirmed context does not advertise logout; workspace dialog retry requests verification', { skip: !existsSync(browserPath), timeout: 40000 }, async () => {
  const f = await fixture(); const page = await f.browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.route('**/*', route => route.request().url().startsWith(f.origin) ? route.continue() : route.abort());
    await page.goto(f.origin + '/market');
    assert.equal(await page.getByRole('link', { name: 'Login', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Create account', exact: true }).count(), 0);
    await page.evaluate(() => { window.retries = 0; window.addEventListener('reylumi:app-local-workspace-retry', () => window.retries++); window.dispatchEvent(new CustomEvent('reylumi:app-local-workspace-error', { detail: 'Role verification interrupted' })); });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    assert.equal(await page.evaluate(() => window.retries), 1);
    await page.evaluate(() => window.setGuestContext());
    await page.getByRole('link', { name: 'Login', exact: true }).waitFor();
  } finally { await f.close(); }
});
test('initial packaged Help needs no context, shell, session, advertising or quick-booking request', { skip: !existsSync(browserPath), timeout: 90000 }, async () => {
  const f = await fixture(); try { const page = await f.browser.newPage(); await page.goto(f.origin + '/help'); await page.getByRole('heading', { name: 'Reylumi Help', exact: true }).waitFor(); await page.getByRole('searchbox', {name:'Search the guides',exact:true}).fill('POS'); assert(await page.getByText('Guides found:',{exact:false}).count()); assert.deepEqual(await page.evaluate(() => window.requests), []); assert(await page.evaluate(() => window.resourceCalls.every(x => x.enabled === false))); assert.equal(await page.evaluate(() => window.translateLoads), 0); } finally { await f.close(); }
});
test('installed expiry never embeds an auth form; unavailable checks retain display and confirmed expiry opens original HTTPS sign-in', { skip: !existsSync(browserPath), timeout: 90000 }, async () => {
  const f = await fixture(); try {
    const page = await f.browser.newPage(); await page.clock.install(); await page.goto(f.origin + '/market'); await page.getByRole('textbox', { name: 'Money draft' }).waitFor(); await page.evaluate(() => window.setContext()); await page.waitForFunction(() => document.querySelector('[data-authenticated=true]'));
    await page.clock.runFor(60_050); assert.equal(await page.getByRole('dialog', { name: 'Session expired' }).count(), 0); assert.equal(await page.evaluate(() => window.contextCalls[0].options.fresh), true);
    await page.evaluate(() => window.contextReply = { schemaVersion: 1, context: { scope: 'guest', authenticated: false }, offline: false }); await page.clock.runFor(60_050);
    await page.getByRole('dialog', { name: 'Session expired', exact: true }).waitFor(); assert.equal(await page.locator('input[type=password],iframe').count(), 0); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); assert.deepEqual(await page.evaluate(() => window.onlinePaths), ['/login?next=%2Fmarket']);
  } finally { await f.close(); }
});
test('device PIN workspace never runs account shell reads or treats owner-to-portable as session expiry', { skip: !existsSync(browserPath), timeout: 90000 }, async () => {
  const f = await fixture(); try {
    const page = await f.browser.newPage(); await page.goto(f.origin + '/pos/portable'); await page.getByRole('textbox', { name: 'Money draft' }).waitFor(); assert.deepEqual(await page.evaluate(() => window.requests), []); assert(await page.evaluate(() => window.resourceCalls.every(x => x.enabled === false)));
    await page.evaluate(() => { window.changePath('/market'); window.setContext(); window.releaseMenu(); }); await page.getByRole('button', { name: 'Open account switcher', exact: true }).waitFor();
    await page.evaluate(() => window.setDeviceContext()); await page.waitForFunction(() => !document.querySelector('[data-testid=customer-desktop-shell]')); assert.equal(await page.getByRole('dialog', { name: 'Session expired', exact: true }).count(), 0); assert(await page.evaluate(() => window.resourceCalls.every(x => x.enabled === false))); assert.deepEqual(await page.evaluate(() => window.requests), []);
  } finally { await f.close(); }
});

test('real owner CSS restores role chrome after POS More navigation while retaining hidden checkout and document scrolling', { skip: !existsSync(browserPath), timeout: 180000 }, async () => {
  const f = await fixture({ retainedOwner: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
      const page = await f.browser.newPage({ viewport }), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().resourceType() === 'document' || new URL(route.request().url()).pathname === '/fixture.js' ? route.continue() : route.abort());
      await page.goto(f.origin + '/pos');
      await page.evaluate(() => { window.setContext(); window.shellConfig = { scope: 'scope-a', language: { enabled: false, portableEnabled: false, expiresAt: null }, campaign: { installed: true, runtime: null } }; window.releaseMenu(); });
      await page.locator('[data-testid="customer-desktop-shell"]').waitFor();
      await page.getByRole('textbox', { name: 'Retained money', exact: true }).fill('77.25');
      await page.evaluate(() => { window.savedCheckout = document.querySelector('.owner-checkout'); window.savedMoney = document.querySelector('[aria-label="Retained money"]'); });
      const inspect = () => page.evaluate(() => {
        const shell = document.querySelector('[data-testid="customer-desktop-shell"]'), visible = element => Boolean(element?.checkVisibility());
        return {
          header: [...shell.querySelectorAll(':scope > div > div > header')].some(visible),
          footer: [...shell.querySelectorAll(':scope > div > div > nav')].some(visible),
          sidebar: visible(shell.querySelector(':scope > [data-desktop-sidebar-slot]')),
          sameCheckout: window.savedCheckout === document.querySelector('.owner-checkout'),
          sameMoney: window.savedMoney === document.querySelector('[aria-label="Retained money"]'),
          money: window.savedMoney.value,
          htmlOverflow: getComputedStyle(document.documentElement).overflowY,
          bodyOverflow: getComputedStyle(document.body).overflowY,
        };
      });
      const expectChrome = async (focused, label) => {
        assert.equal(await page.locator('[data-testid="customer-desktop-shell"]').count(), 1, label + ': role shell mounted');
        const state = await inspect();
        assert.equal(state.header, !focused, label + ': header');
        assert.equal(state.footer, !focused && viewport.width < 1280, label + ': bottom menu');
        assert.equal(state.sidebar, !focused && viewport.width >= 1280, label + ': sidebar');
        assert.equal(state.sameCheckout, true, label + ': checkout DOM retained');
        assert.equal(state.sameMoney, true, label + ': money input retained');
        assert.equal(state.money, '77.25', label + ': draft retained');
        if (!focused) {
          assert.notEqual(state.htmlOverflow, 'hidden', label + ': document scroll unlocked');
          assert.notEqual(state.bodyOverflow, 'hidden', label + ': body scroll unlocked');
          await page.evaluate(() => window.scrollTo(0, 160));
          assert(await page.evaluate(() => window.scrollY > 0), label + ': document can scroll');
          await page.evaluate(() => window.scrollTo(0, 0));
        }
      };
      await expectChrome(true, viewport.width + ' POS');
      const openMore = async href => {
        await page.locator('[data-owner-workspace] button[aria-label="More"]').click();
        await page.locator('[data-owner-more-popover] a[href="' + href + '"]').click();
        await page.waitForFunction(path => location.pathname === path, href);
      };
      // The shipped POS All link is /pos/more (focused POS chrome). Exercise
      // its ordinary Market exit before the fixture's separate global More.
      await openMore('/market');
      await expectChrome(false, viewport.width + ' Market exit');
      await page.evaluate(() => window.changePath('/more'));
      await expectChrome(false, viewport.width + ' More All');
      for (const href of ['/market', '/settings', '/reports', '/payroll', '/staff', '/services', '/customers', '/salon-settings', '/campaigns', '/support', '/help']) {
        if (href === '/help') await page.evaluate(() => { window.requests = []; window.resourceCalls = []; window.queueScopes = []; window.workspaceCalls = []; });
        await page.locator('[data-fixture-destination="/more"] a[href="' + href + '"]').click();
        await page.waitForFunction(path => location.pathname === path, href);
        await expectChrome(false, viewport.width + ' ' + href);
        if (href === '/help') {
          assert(await page.evaluate(() => window.resourceCalls.every(call => call.enabled === false)), 'retained Help chrome cannot start a scoped read');
          assert.deepEqual(await page.evaluate(() => window.requests), [], 'Help presentation cannot start account/session/advertising requests');
          assert.deepEqual(await page.evaluate(() => window.queueScopes), [], 'Help presentation cannot restart owner queue runtime');
          await page.getByRole('searchbox', { name: 'Search the guides', exact: true }).fill('POS');
          assert(await page.getByText('Guides found:', { exact: false }).count(), 'presentation capture leaves real Help content search intact');
          if (viewport.width >= 1280) {
            const form = page.locator('[data-testid="customer-desktop-header"] form[role="search"]');
            await form.evaluate(element => element.addEventListener('submit', event => { window.helpSearch = { prevented: event.defaultPrevented, fields: [...new FormData(element)] }; event.preventDefault(); }, { once: true }));
            await form.getByRole('searchbox').fill('nails 90210');
            await form.getByRole('button', { name: 'Search', exact: true }).click();
            await page.waitForFunction(() => Boolean(window.helpSearch));
            assert.deepEqual(await page.evaluate(() => window.helpSearch), { prevented: false, fields: [['location', ''], ['q', 'nails 90210']] }, 'Help header search keeps original native GET serialization');
            assert.equal(new URL(page.url()).pathname, '/help', 'search was not rerouted to My Place');
          }
          await page.locator('[data-app-notification-trigger]').filter({ visible: true }).first().click();
          await page.waitForFunction(() => location.pathname === '/notifications');
          assert.equal(await page.locator('details[data-dismissible-popover][open]').count(), 0, 'presentation notification control navigates before opening its live dropdown');
          await page.evaluate(() => window.changePath('/help'));
          await page.getByRole('button', { name: viewport.width >= 1280 ? 'Open account menu' : 'Open account switcher', exact: true }).click();
          await page.waitForFunction(() => location.pathname === '/my-place');
          assert.deepEqual(await page.evaluate(() => window.workspaceCalls), [], 'Help account control must navigate to validated My Place before workspace actions');
          await expectChrome(false, viewport.width + ' My Place after Help');
        }
        await page.locator('[data-fixture-destination] a[href="/pos"]').click();
        await expectChrome(true, viewport.width + ' return POS');
        await openMore('/market');
        await page.evaluate(() => window.changePath('/more'));
      }
      for (const href of ['/more/saved-post', '/more/following', '/pos/settings']) {
        await page.evaluate(path => window.changePath(path), href);
        await expectChrome(href === '/pos/settings', viewport.width + ' ' + href);
      }
      for (const href of ['/pos/check-in', '/pos/book', '/pos/ticket', '/pos/report', '/pos']) {
        await page.evaluate(path => window.changePath(path), href);
        await expectChrome(true, viewport.width + ' focused ' + href);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.actionCalls), [], 'navigation must not replay a business action');
      await page.close();
    }
  } finally { await f.close(); }
});
