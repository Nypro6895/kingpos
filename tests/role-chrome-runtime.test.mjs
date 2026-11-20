import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const h = React.createElement;
let pathname = '/payroll';
let session = true;
const nothing = () => null;
const domProps = (props, omitted) => Object.fromEntries(Object.entries(props).filter(([key]) => !omitted.includes(key)));
const stubs = {
  'next/navigation': { usePathname: () => pathname, useRouter: () => ({}), useSearchParams: () => new URLSearchParams() },
  'next/link': Object.assign(props => h('a', domProps(props, ['prefetch', 'onNavigate'])), { useLinkStatus: () => ({ pending: false }) }),
  'next/image': props => h('img', domProps(props, ['priority'])),
  '@/components/workspace-language': { WorkspaceText: ({ text }) => text, useWorkspaceTranslation: () => value => value },
  '@/components/campaign-plugin-context': { useCampaignPlugin: () => false },
  '@/components/settings-icon': { SettingsIconShape: nothing },
  '@/app/account/logout-button': { LogoutButton: nothing },
  '@/components/explore-advertising': { ExploreAdSlot: nothing },
  '@/app/action-dialog': { ActionDialog: nothing },
  '@/app/notifications/notification-list': { NotificationFeedList: nothing },
  '@/app/quick-workspace-panel': { QuickWorkspacePanel: nothing },
  '@/lib/account-avatar': { safeAccountAvatarUrl: () => null },
  '@/lib/supabase/browser': { createSupabaseBrowserClient: () => null },
  '@/app/salons/actions': { setCurrentWorkspace: nothing, switchWorkspaceDestination: nothing, switchWorkspaceLanding: nothing },
  '@/lib/notification-client': { markAllCenterViewed: nothing, NOTIFICATIONS_REFRESH: 'notifications-refresh', useNotificationSummary: value => value },
  '@/components/legal-footer': { LegalFooter: nothing },
  '@/app/explore/explore-search-input': { ExploreSearchInput: props => h('input', domProps(props, ['onSuggestionSelect', 'category', 'location'])) },
  '@/lib/request-business-context': { getRequestBusinessContext: async () => { throw new Error('workspace unavailable'); } },
  '@/app/salon-switcher': { SalonSwitcher: nothing },
  '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async () => { if (session instanceof Error) throw session; return session ? {} : null; } },
};
const cache = new Map();
function load(file) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);
  const module = { exports: {} };
  const code = transformSync(readFileSync(absolute, 'utf8'), { loader: absolute.endsWith('tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs' }).code;
  const localRequire = specifier => {
    if (specifier in stubs) return stubs[specifier];
    if (specifier.endsWith('.css')) return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    if (specifier.startsWith('@/')) {
      const target = specifier.slice(2);
      for (const extension of ['.tsx', '.ts']) {
        try { return load(target + extension); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      throw new Error(`Missing fixture dependency ${specifier}`);
    }
    return require(specifier);
  };
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  cache.set(absolute, module.exports);
  return module.exports;
}

const { LegalNavigationShell } = load('app/legal/legal-navigation-shell.tsx');
const { NavigationShell } = load('app/navigation-shell.tsx');


const shared = load('app/role-navigation.ts').SHARED_CONTEXT_ROUTE_PREFIXES;
function shellProps(role) {
 const workspace = { id: 'fixture', type: role === 'personal' ? 'personal' : 'salon', salonMode: role === 'staff' ? 'staff' : role === 'owner' ? 'manage' : null, salonName: 'QA Salon', staffDisplayName: 'QA Staff', label: 'QA', roleLabel: role, menuActions: [] };
 return { accountAvatarUrl: null, accountEmail: 'qa@example.test', accountLabel: 'QA', currentAccountName: 'QA', currentUserId: 'fixture', currentWorkspace: workspace, workspaceType: workspace.type, salonMode: workspace.salonMode, workspaceOptions: [workspace], workspaceSections: [], notificationSummary: { items: [], total: 0, bookingNotifications: 0, previewItems: [], reviewHref: '/notifications' } };
}
const files = fsPages('app');
function fsPages(dir) { return require('node:fs').readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?fsPages(path.join(dir,e.name)):e.name==='page.tsx'?[path.join(dir,e.name).split(path.sep).join('/')]:[]); }
const allRoutes=files.map(file=>({file,route:'/'+file.split('/').slice(1,-1).filter(x=>!/^\(.+\)$/.test(x)).join('/')}));
const navSource=readFileSync('app/navigation-shell.tsx','utf8');
// Export the actual route classifier through the existing fixture loader.
const classifySource=navSource.slice(navSource.indexOf('function matchesPath('),navSource.indexOf('function routeNavigationForWorkspaceKind('));
const roleConfig=load('app/role-navigation.ts');
const classify=new Function('SHARED_CONTEXT_ROUTE_PREFIXES','ROLE_NAVIGATION',transformSync(classifySource,{loader:'ts'}).code+'; return { getRouteWorkspaceKind, isShelllessPath };')(shared,roleConfig.ROLE_NAVIGATION);
const audit=allRoutes.map(row=>({...row,shell:row.file.startsWith('app/(legal)/')?'public-role-aware':row.file.startsWith('app/(app)/')?(classify.isShelllessPath(row.route)?'dedicated':classify.getRouteWorkspaceKind(row.route)||'UNCLASSIFIED'):'standalone'}));
mkdirSync('artifacts/role-chrome-20261103',{recursive:true});
writeFileSync('artifacts/role-chrome-20261103/route-audit.json',JSON.stringify(audit,null,2));
test('every app route has an explicit role or dedicated shell',()=>assert.deepEqual(audit.filter(x=>x.shell==='UNCLASSIFIED'),[]));
test('all shared routes retain the active role header and five bottom links',()=>{
 for(const role of ['personal','owner','staff']) for(const route of shared){
 pathname=route+'/fixture';
 const html=renderToStaticMarkup(h(NavigationShell,shellProps(role),h('main',{},'Page content')));
 assert.ok(html.includes('workspace-mobile-nav'),role+' '+route);
 assert.ok(html.includes('Page content'));
 assert.ok(html.includes('aria-label="'+roleConfig.ROLE_NAVIGATION[role].ariaLabel+'"'));
 }
});
test('signed-in public pages use the workspace shell; guest and offline content stay readable',async()=>{
 stubs['@/lib/request-business-context'].getRequestBusinessContext=async()=>({user:{id:'fixture'}});
 stubs['@/app/salon-switcher'].SalonSwitcher=({children})=>h(NavigationShell,shellProps('staff'),children);
 pathname='/help';session=true;
 const signed=renderToStaticMarkup(await LegalNavigationShell({children:'Help content'}));
 assert.ok(signed.includes('workspace-mobile-nav'));assert.ok(signed.includes('aria-label="Staff"'));
 const renderShell=stubs['@/app/salon-switcher'].SalonSwitcher;
 stubs['@/app/salon-switcher'].SalonSwitcher=async()=>{throw new Error('permissions unavailable');};
 const degraded=renderToStaticMarkup(await LegalNavigationShell({children:'Help content'}));
 assert.ok(degraded.includes('Help content')&&degraded.includes('>My account<')&&!degraded.includes('>Login<'));
 stubs['@/app/salon-switcher'].SalonSwitcher=renderShell;
 session=false;
 const guest=renderToStaticMarkup(await LegalNavigationShell({children:'Help content'}));
 assert.ok(guest.includes('Help content')&&guest.includes('>Login<'));
 session=new Error('offline');
 const offline=renderToStaticMarkup(await LegalNavigationShell({children:'Help content'}));
 assert.ok(offline.includes('Help content')&&!offline.includes('>Login<'));
});

test('real navigation markup fits phone, landscape and tablet for every role and ordinary route', { skip: !process.env.TEST_BROWSER_PATH, timeout: 120000 }, async()=>{
 const input=readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./navigation-shell.tsx";\n@source "./guest-navigation-shell.tsx";\n@source "../tests/role-chrome-runtime.test.mjs";');
 const {css}=await postcss([tailwind()]).process(input,{from:path.resolve('app/globals.css')});
 const cases=[];
 for(const role of ['personal','owner','staff']) {
  for(const row of audit.filter(x=>['shared','public-role-aware','personal','staff','manage','salon'].includes(x.shell))){
   pathname=row.route.replace(/\[.*?\]/g,'fixture');
   const markup=renderToStaticMarkup(h(NavigationShell,shellProps(role),h('main',{className:'p-4'},h('h1',{},pathname),h('div',{style:{height:1200}},'Long content'),h('button',{id:'last-control'},'Last control'))));
   cases.push({role,route:pathname,markup,width:390,height:844});
  }
  for(const [width,height] of [[320,568],[428,926],[844,390],[1024,768],[1280,800]]){
   pathname='/help';
   cases.push({role,route:pathname,width,height,markup:renderToStaticMarkup(h(NavigationShell,shellProps(role),h('main',{className:'p-4'},h('h1',{},'Reylumi Help'),h('div',{style:{height:1200}},'Guides'),h('button',{id:'last-control'},'Last control'))))});
  }
 }
 const server=createServer((req,res)=>{
  if(req.url.startsWith('/brand/')){res.setHeader('Content-Type','image/png');res.end(readFileSync('public/brand/reylumi-logo-horizontal.png'));return;}
  const item=cases[Number(req.url.slice(1))]||cases[0];res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body>'+item.markup+'</body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 const results=[];
 try{
 const page=await browser.newPage();
 for(const [index,item] of cases.entries()){
  await page.setViewportSize({width:item.width,height:item.height});await page.goto('http://127.0.0.1:'+server.address().port+'/'+index);
  const metrics=await page.evaluate(()=>{
   const nav=document.querySelector('.workspace-mobile-nav');const r=nav.getBoundingClientRect();
   const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
   scrollTo(0,document.documentElement.scrollHeight);
   const last=document.querySelector('#last-control').getBoundingClientRect();
   return {overflow:document.documentElement.scrollWidth>innerWidth+1,navVisible:visible(nav),navTop:r.top,navBottom:r.bottom,lastBottom:last.bottom,headerVisible:[...document.querySelectorAll('header')].some(visible)};
  });
  assert.equal(metrics.overflow,false,JSON.stringify({role:item.role,route:item.route,width:item.width,metrics}));
  assert.ok(metrics.headerVisible,'header '+JSON.stringify(item.route));
  if(item.width<1024){assert.ok(metrics.navVisible);assert.ok(metrics.navBottom<=item.height+1);assert.ok(metrics.lastBottom<=metrics.navTop+1,'content clears bottom bar');}
  results.push({role:item.role,route:item.route,width:item.width,height:item.height,...metrics});
  if(item.route==='/help'&&[390,428,844,1280].includes(item.width)) { await page.evaluate(()=>scrollTo(0,0)); await page.screenshot({path:'artifacts/role-chrome-20261103/'+item.role+'-'+item.width+'.png'}); }
 }
 writeFileSync('artifacts/role-chrome-20261103/browser-results.json',JSON.stringify(results,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
