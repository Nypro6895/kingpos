import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

let bundle;
async function fixture(path = '/bookings', role = 'owner') {
  bundle ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{getAppLocalSecondaryPage,appLocalRouteAlias}from'./lib/app-local-secondary-registry';
import{AppLocalNavigationProvider}from'./app/local-app/navigation';
import{OwnerPosNavigation}from'./app/pos/owner-pos-tabs';import{RoleMoreContent}from'./components/role-more-content';
window.alias=appLocalRouteAlias;window.reads=[];
function App(){const[path,setPath]=useState(location.pathname+location.search);const role=window.role;
const context={context:{scope:'scope-a',authenticated:true,salonId:'salon-a'},access:{ownerWorkspace:role==='owner',staffWorkspace:role==='staff'},home:role==='owner'?'/staff/today':role==='staff'?'/staff/my-work':'/explore'};
const navigate=href=>{history.pushState(null,'',href);setPath(href)};window.navigate=navigate;
const page=getAppLocalSecondaryPage(path);return <AppLocalNavigationProvider value={{path,navigate,refresh(){}}}>
{!path.startsWith('/pos/')&&path!=='/pos'?<aside data-regular-nav><RoleMoreContent roleKind='owner' activeItemIds={[]} onNavigate={()=>{}}/></aside>:path!=='/pos/more'?<OwnerPosNavigation active={path==='/pos/settings'?'settings':'pos'}/>:null}
{page?<page.Component path={path} context={context} navigate={navigate}/>:<p data-destination>{path}</p>}
</AppLocalNavigationProvider>};createRoot(document.getElementById('root')).render(<App/>);
` }, bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'navigation-fixture',setup(b){
    const modules={
      'next/navigation':`export{usePathname,useSearchParams}from'./app/local-app/navigation';export const useRouter=()=>({push:href=>{const u=new URL(href,location.href);window.navigate(u.pathname+u.search)},replace:href=>window.navigate(href)});`, 'next/link':`export{AppLocalLink as default,useLinkStatus}from'./app/local-app/navigation';`, 'next/form':`export{AppLocalForm as default}from'./app/local-app/navigation';`,
      'workspace-language':`export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='span',text,...props})=><Tag {...props}>{text}</Tag>;export const useWorkspaceTranslation=()=>x=>x;`,
      'campaign-plugin-context':`export const useCampaignPlugin=()=>false;`,
      'contextual-support':`export const ContextualSupport=()=>null;`,
      'app-local-showcase-look':`export const AppLocalShowcaseLook=()=>null;`, 'app-local-transformations':`export const AppLocalTransformations=()=>null;`, 'app-local-visit':`export const AppLocalVisitView=()=>null;`,
      'owner-live-booking-workspace':`import{usePathname}from'next/navigation';export const OwnerLiveBookingWorkspace=()=> <p data-booking-path>{usePathname()}</p>;`,
      'owner-live-reports':`import{usePathname}from'next/navigation';export const OwnerLiveReports=()=> <p data-report-path>{usePathname()}</p>;`,
      'owner-live-tickets':`export const OwnerLiveTickets=({returnTo})=> <form data-ticket-return><input name='return_to' value={returnTo} readOnly/></form>;`,
      'portable-check-in-client':`export const PortableCheckInClient=()=>null;`,
      'owner-check-in-actions':`export const ownerSubmitAttendance=async()=>{throw Error('No mutations in navigation tests')};`,
      'owner-local-workspace':`export const useOwnerLocalWorkspace=()=>null;export const saveOwnerLocalSnapshot=async()=>{};`,
      'portable-sync-indicator':`export const PortableSyncIndicator=()=>null;`,
      'pos-workspace-sync':`export const usePosResourceRefresh=()=>{};`,
      'app-local-resource':`export const seedAppLocalResource=()=>{};export function useAppLocalResource(scope,name,args){window.reads.push({scope,name,args});return{updatedAt:1,refresh:async()=>{},data:name==='owner.bookings'?{view:'bookings',props:{}}:name==='owner.reports'?{view:'reports',props:{}}:{view:'tickets',props:{searchQuery:new URLSearchParams(args.query).get('q')??'',selectedDate:'2026-10-16',today:'2026-10-16'}}}}`,
    };
    b.onResolve({filter:/.*/},a=>{let key=Object.keys(modules).find(k=>a.path===k||a.path.endsWith('/'+k));if(key==='owner-local-workspace'&&!a.path.startsWith('.'))return;if(key==='owner-local-workspace'&&a.importer.includes('secondary-registry'))return;return key?{path:key,namespace:'fixture'}:undefined});
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:modules[a.path],loader:'tsx',resolveDir:process.cwd()}));
    b.onLoad({filter:/\.css$/},()=>({contents:'export default {}',loader:'js'}));
  }}]});
  const compiled=await bundle,errors=[];
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?compiled.outputFiles[0].text:`<div id="root"></div><script>window.role=${JSON.stringify(role)}</script><script src="/bundle.js"></script>`)});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>errors.push(e.message));const origin='http://127.0.0.1:'+server.address().port;
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin+path);
  return{page,async close(){await browser.close();await new Promise(r=>server.close(r));assert.deepEqual(errors,[])}};
}

test('regular Book/Report/Ticket preserve their navigation and ticket return/filter URLs',async()=>{
  const app=await fixture();const {page}=app;try{
    await page.locator('[data-booking-path]').waitFor();assert.equal(new URL(page.url()).pathname,'/bookings');
    assert.equal(await page.evaluate(()=>window.alias('/bookings?q=test')),null);
    await page.locator('[data-regular-nav] a[href="/reports"]').click();await page.locator('[data-report-path]').waitFor();
    assert.equal(await page.locator('[data-report-path]').textContent(),'/reports');
    await page.locator('[data-regular-nav] a[href="/pos-tickets"]').click();await page.locator('[data-ticket-return]').waitFor();
    assert.match(await page.locator('[name=return_to]').inputValue(),/^\/pos-tickets\?/);
    assert.equal(await page.getByRole('navigation',{name:'Owner POS'}).count(),0);
    await page.getByRole('button',{name:'Work log filters'}).click();
    await page.locator('[name=q]').fill('Anna');await page.getByRole('button',{name:'Search',exact:true}).click();
    await page.waitForURL(/\/pos-tickets\?.*q=Anna/);assert.equal(await page.locator('[data-regular-nav]').count(),1);
    await page.waitForFunction(()=>document.querySelector('[name=return_to]')?.value.includes('q=Anna'));
  }finally{await app.close()}
});

test('POS Settings and More keep POS links and expose an explicit exit to role home',async()=>{
  const app=await fixture('/pos/settings');const {page}=app;try{
    const nav=page.getByRole('navigation',{name:'Owner POS'});await nav.waitFor();
    for(const path of ['/pos','/pos/book','/pos/ticket','/pos/report','/pos/check-in','/pos/settings'])assert.equal(await nav.locator(`a[href="${path}"]`).count(),1);
    await nav.getByRole('button',{name:'More',exact:true}).click();
    const menu=page.locator('[data-owner-more-popover]');await menu.waitFor();
    for(const path of ['/pos/ticket','/pos/report','/pos/settings'])assert.equal(await menu.locator(`a[href="${path}"]`).count(),1);
    await menu.getByRole('link',{name:'All',exact:true}).click();await page.waitForURL('**/pos/more');
    assert.equal(await page.getByRole('navigation',{name:'Owner POS'}).count(),1);
    await page.getByRole('link',{name:'Exit POS',exact:true}).click();await page.waitForURL('**/staff/today');
    assert.equal(await page.locator('[data-regular-nav]').count(),1);
  }finally{await app.close()}
});

for(const [role,home] of [['owner','/staff/today'],['staff','/staff/my-work'],['customer','/explore']])test(`neutral startup selects ${role} home`,async()=>{
  const app=await fixture('/',role);try{await app.page.waitForURL('**'+home);assert.equal(await app.page.evaluate(()=>window.reads.length),0)}finally{await app.close()}
});
