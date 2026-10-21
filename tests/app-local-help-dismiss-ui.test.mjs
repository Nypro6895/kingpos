import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const executable = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const artifacts = path.resolve(process.env.HELP_DISMISS_ARTIFACT_DIR || 'artifacts/help-context-dismiss-20261020');
const outcomes = [];
let browserPromise, bundlePromise;

// The actual shell, account menus, capture guards and native navigation adapter
// run together. Only read DTOs, unrelated runtimes and write/SDK boundaries are
// synthetic. No application/server/permission handler is replaced by a copy.
function bundle() {
  return bundlePromise ??= build({
    stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {AppLocalShell} from './components/app-local-shell';
      import {AppLocalNavigationProvider} from './app/local-app/navigation';
      const scope='v3:'+'a'.repeat(64);
      const staff={id:'staff',type:'salon',salonMode:'staff',salonName:'Synthetic Salon',label:'Synthetic Salon',roleLabel:'Staff',defaultHref:'/staff/my-work',menuActions:[]};
      const owner={...staff,id:'owner',salonMode:'manage',roleLabel:'Owner',defaultHref:'/staff/today'};
      const personal={id:'personal',type:'personal',label:'Synthetic Person',roleLabel:'Personal account',defaultHref:'/explore',menuActions:[]};
      const account={id:'account',type:'account',label:'Synthetic owner account',accountId:'fixture-account',roleLabel:'Owner',defaultHref:'/my-place',menuActions:[{id:'create',label:'Create Salon',href:'/salons/new'}]};
      const summary={items:[],previewItems:[],total:0,beautyPublicationRequests:0,bookingNotifications:0,managerApplications:0,reviewHref:'/notifications',staffApplications:0,staffInvites:0};
      window.fixtureSummary=summary;
      window.fixtureNavigation={scope,authenticated:true,ownerQueueScope:null,audience:'staff',navigation:{accountAvatarUrl:null,accountEmail:null,accountLabel:'Synthetic Person',currentUserId:'fixture-user',currentAccountName:null,currentWorkspace:staff,notificationSummary:summary,salonMode:'staff',workspaceOptions:[personal,staff,owner,account],workspaceSections:[],workspaceType:'salon'}};
      window.fixtureConfiguration={scope,language:{enabled:false,portableEnabled:false,expiresAt:null},campaign:{installed:false,runtime:null}};
      window.fixtureWrites=[];window.fixtureRoutes=[];
      window.fetch=async(input,init)=>{window.fixtureWrites.push({kind:'fetch',path:String(input),method:init?.method||'GET'});return new Response(JSON.stringify({redirectTo:'/explore'}),{status:200,headers:{'Content-Type':'application/json'}});};
      const context={schemaVersion:1,context:{scope,authenticated:true,viewerId:'fixture-user',workspaceId:'staff',salonId:'fixture-salon',permissionRevision:'fixture-v1'},offline:false,onlineValidatedAt:Date.now(),access:{staffWorkspace:true,ownerWorkspace:false}};
      function App(){const[route,setRoute]=useState('/staff/my-work');
        const navigate=next=>{window.fixtureRoutes.push(next);setRoute(next);};
        window.fixtureGoHelp=()=>setRoute('/help');
        const help=route==='/help';
        return <AppLocalNavigationProvider value={{path:route,navigate,refresh(){window.fixtureWrites.push({kind:'refresh'});}}}>
          <AppLocalShell path={route} context={help?null:context} presentationContext={help?context:null}>
            <main data-fixture-content><h1>{help?'Synthetic Help':route==='/support'?'Synthetic Report':'Synthetic Staff'}</h1><input aria-label="retained draft" defaultValue="unsaved"/></main>
          </AppLocalShell>
          <output data-fixture-route>{route}</output>
        </AppLocalNavigationProvider>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'real-help-shell-boundaries', setup(builder) {
      const stubs = {
        '@/lib/app-local-resource': `export function useAppLocalResource(scope,name){const data=name==='shell.navigation'?window.fixtureNavigation:name==='shell.configuration'?window.fixtureConfiguration:null;return {data,loading:false,refreshing:false,error:null,refresh:async()=>{}};}`,
        '@/lib/notification-client': `export const NOTIFICATIONS_REFRESH='fixture-notifications';export function markAllCenterViewed(){window.fixtureWrites.push({kind:'notification-write'});}export function useNotificationSummary(value){return value;}`,
        '@/lib/supabase/browser': `export function createSupabaseBrowserClient(){return null;}`,
        '@/lib/workspace-navigation': `export function navigateToWorkspace(){window.fixtureWrites.push({kind:'workspace-command'});}`,
        '@/components/role-more-content': `export function RoleMoreContent(){return null;}`,
        '@/app/notifications/notification-list': `export function NotificationFeedList(){return null;}`,
        '@/app/quick-workspace-panel': `export function QuickWorkspacePanel(){return null;}`,
        './explore-account-actions': `export function ExploreAccountActionsProvider({children}){return children;}`,
        '@/components/explore-advertising': `export function ExploreAdSlot(){return null;}export function ExploreAdvertising({children}){return children;}`,
        './explore-advertising': `export function ExploreAdSlot(){return null;}export function ExploreAdvertising({children}){return children;}`,
        './quick-booking': `export function QuickBooking(){return null;}`,
        './app-local-session-expiry-prompt': `export function AppLocalSessionExpiryPrompt(){return null;}`,
        './owner-campaign-runtime': `export function OwnerCampaignRuntime(){return null;}`,
        '@/app/pos/owner-queue-runtime': `export function OwnerQueueRuntime(){return null;}`,
        './abuse-notice-view': `export function AbuseNoticeView(){return null;}`,
        '@/app/notifications/workspace-summary-seed': `export function WorkspaceSummarySeed(){return null;}`,
      };
      builder.onResolve({ filter: /.*/ }, args => {
        if(args.path.endsWith('.css'))return {path:args.path,namespace:'style'};
        if (args.path==='next/navigation') return {path:path.resolve('app/local-app/navigation.tsx')};
        if (args.path==='next/link'||args.path==='next/image') return {path:args.path,namespace:'fixture'};
        if (Object.hasOwn(stubs,args.path)) return {path:args.path,namespace:'fixture'};
      });
      builder.onLoad({filter:/.*/,namespace:'style'},()=>({contents:'export default {}',loader:'js'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'}, args=>({loader:'tsx',resolveDir:process.cwd(),contents:
        args.path==='next/link'?`export {AppLocalLink as default,useLinkStatus} from './app/local-app/navigation';`
          :args.path==='next/image'?`export {AppLocalImage as default} from './app/local-app/navigation';`:stubs[args.path]}));
    } }],
  });
}

async function fixture(desktop = false) {
  const output = await bundle();
  const server = createServer((request, response) => {
    response.setHeader('Content-Type',request.url==='/app.js'?'text/javascript':'text/html');
    response.end(request.url==='/app.js'?output.outputFiles[0].text:'<div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();
  const browser = await (browserPromise ??= engine==='webkit'?webkit.launch({headless:true}):chromium.launch({headless:true,...(existsSync(executable)?{executablePath:executable}:{})}));
  const context = await browser.newContext({viewport:desktop?{width:1440,height:1000}:{width:390,height:844}});
  const page = await context.newPage(), errors=[], external=[];
  const origin='http://127.0.0.1:'+server.address().port;
  page.setDefaultTimeout(4000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    if(route.request().url().startsWith(origin+'/'))return route.continue();
    external.push(route.request().url());return route.abort();
  });
  await page.goto(origin+'/staff/my-work');
  // No utility CSS is imported: exercise each real menu variant by its unique
  // trigger and DOM id, instead of pretending CSS visibility proves identity.
  const trigger=desktop?page.getByTestId('customer-desktop-account-trigger'):page.getByRole('button',{name:'Open account switcher',exact:true});
  const menu=page.locator(desktop?'#customer-desktop-account-menu':'#customer-context-sheet');
  await trigger.click();await menu.waitFor();
  return {page,menu,errors,external,async close(){await context.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);}};
}

async function scenario(name, body, desktop=false) {
  let app, failure, details;
  try {app=await fixture(desktop);await body(app);}
  catch(error){failure=error;if(app){mkdirSync(artifacts,{recursive:true});await app.page.screenshot({path:path.join(artifacts,engine+'-'+name+'-failure.png')}).catch(()=>{});}}
  finally {
    if(app){details=await app.page.evaluate(()=>({route:document.querySelector('[data-fixture-route]')?.textContent,routes:window.fixtureRoutes,writes:window.fixtureWrites})).catch(()=>null);try{await app.close();}catch(error){failure??=error;}}
    outcomes.push({name,passed:!failure,...(failure?{error:failure.message}:{}),details});
  }
  if(failure)throw failure;
}

for(const desktop of [false,true]) for(const [label,destination] of [['Help','/help'],['Report / Contact','/support']]) {
  const name=(desktop?'desktop':'mobile')+'-'+(destination==='/help'?'help':'report')+'-dismiss';
  test(name,{timeout:30000},()=>scenario(name,async({page,menu})=>{
    await page.getByRole('textbox',{name:'retained draft'}).fill('unchanged draft');
    await menu.getByRole('link',{name:label,exact:true}).click();
    await page.waitForFunction(expected=>document.querySelector('[data-fixture-route]')?.textContent===expected,destination);
    assert.equal(await menu.count(),0,'The original account menu closes during link navigation');
    assert.equal(await page.getByRole('textbox',{name:'retained draft'}).inputValue(),'unchanged draft','Unrelated retained page state survives');
    assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
  },desktop));
}

test('retained Help drawer Close only dismisses and never navigates',{timeout:30000},()=>scenario('help-close',async({page,menu})=>{
  await page.evaluate(()=>window.fixtureGoHelp());
  await page.getByRole('heading',{name:'Synthetic Help'}).waitFor();
  await menu.getByRole('button',{name:'Close account switcher',exact:true}).click();
  assert.equal(await menu.count(),0);
  assert.equal(await page.locator('[data-fixture-route]').textContent(),'/help');
  assert.deepEqual(await page.evaluate(()=>window.fixtureRoutes),[],'Dismissal is not an account navigation');
  assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
}));

for(const action of ['workspace','logout','create']) test('Help '+action+' still requires fresh authority',{timeout:30000},()=>scenario('help-guard-'+action,async({page,menu})=>{
  await page.evaluate(()=>window.fixtureGoHelp());
  await page.getByRole('heading',{name:'Synthetic Help'}).waitFor();
  const target=action==='workspace'?menu.getByRole('button',{name:'Switch to Synthetic Salon',exact:true}).last():menu.getByRole('button',{name:action==='logout'?'Log out':'Create Salon',exact:true});
  await target.click();
  await page.waitForFunction(()=>document.querySelector('[data-fixture-route]')?.textContent==='/my-place');
  assert.deepEqual(await page.evaluate(()=>window.fixtureRoutes),['/my-place']);
  assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[],'No workspace or write handler runs with decorative Help authority');
}));

test('Help POST form remains blocked even with a dismiss-looking attribute',{timeout:30000},()=>scenario('help-post-form-guard',async({page,menu})=>{
  await page.evaluate(()=>window.fixtureGoHelp());
  await page.getByRole('heading',{name:'Synthetic Help'}).waitFor();
  await menu.evaluate(node=>{const form=document.createElement('form');form.method='post';form.setAttribute('data-app-local-dismiss','account-switcher');form.addEventListener('submit',event=>{event.preventDefault();window.fixtureWrites.push({kind:'post-form-handler'});});node.append(form);form.requestSubmit();});
  await page.waitForFunction(()=>document.querySelector('[data-fixture-route]')?.textContent==='/my-place');
  assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
}));

after(async()=>{
  await (await browserPromise)?.close();
  mkdirSync(artifacts,{recursive:true});
  writeFileSync(path.join(artifacts,engine+'-help-dismiss-ui.json'),JSON.stringify({engine,passed:outcomes.length===9&&outcomes.every(row=>row.passed),tests:outcomes},null,2)+'\n');
});
