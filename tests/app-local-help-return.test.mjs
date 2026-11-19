import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
let browser,server,base;
before(async()=>{
  if(!executablePath)return;
  const modules={
    '@/components/salon-language-preferences':'export const SalonLanguagePreferences=pass;',
    '@/lib/salon-language':'export const PERSONAL_LANGUAGE={salonId:null,selected:"en",offers:[],notices:[]};',
    '@/components/workspace-language':'export const WorkspaceLanguageProvider=pass;export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;',
    '@/components/campaign-plugin-context':'export const CampaignPluginProvider=pass;',
    '@/components/explore-account-actions':'export const ExploreAccountActionsProvider=pass;',
    '@/components/explore-advertising':'export const ExploreAdvertising=pass;export const ExploreAdSlot=()=>null;',
    '@/app/navigation-shell':'export const NavigationShell=({children})=><><header data-testid="role-chrome">Staff navigation</header>{children}</>;',
    '@/lib/app-local-resource':'export function useAppLocalResource(scope,name,args,options){if(options.enabled)window.privateReads++;return {available:true,data:window.navigationReady!==false&&scope===window.cacheScope&&name==="shell.navigation"?{scope,navigation:{}}:undefined};}',
    '@/lib/explore-entry-navigation':'export const handleExploreLogoClick=()=>{};',
    '@/app/explore/explore-header-search-slot':'export const ExploreHeaderSearchSlot=({children,fallback})=>children??fallback??null;',
    '@/components/legal-footer':'export const LegalFooter=()=>null;',
    '@/app/explore/explore-search-input':'export const ExploreSearchInput=()=>null;',
    '@/lib/auth-routing':fs.readFileSync('lib/auth-routing.ts','utf8'),
    '@/components/feedback-link':'export default function Link({children,...props}){return <a {...props}>{children}</a>}',
    '@/components/navigation-form':'export const NavigationForm=({children})=><form>{children}</form>;export const NavigationSubmitButton=({children})=><button>{children}</button>;',
    'next/image':'export default function Image({src,alt}){return <img src={src} alt={alt}/>}',
    'next/navigation':'export const usePathname=()=>window.route.split("?")[0];export const useSearchParams=()=>new URLSearchParams(window.route.split("?")[1]??"");export const useRouter=()=>({push:p=>window.navigations.push(p)});',
  };
  const nullable={'@/app/action-dialog':'ActionDialog','@/components/quick-booking':'QuickBooking','@/components/app-local-session-expiry-prompt':'AppLocalSessionExpiryPrompt','@/components/overlay-dismissal':'OverlayDismissal','@/components/owner-campaign-runtime':'OwnerCampaignRuntime','@/app/pos/owner-queue-runtime':'OwnerQueueRuntime','@/components/abuse-notice-view':'AbuseNoticeView','@/app/notifications/workspace-summary-seed':'WorkspaceSummarySeed'};
  for(const[k,name]of Object.entries(nullable))modules[k]=`export const ${name}=()=>null;`;
  const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{AppLocalShell}from'./components/app-local-shell';import{GuestNavigationShell}from'./app/guest-navigation-shell';
    const query=new URLSearchParams(location.search);window.route=query.has('pending')?'/beauty/library':query.has('legal')?'/privacy':query.has('default')?'/help':'/help?lang='+ (query.get('lang')??'vi');window.navigations=[];window.privateReads=0;window.cacheScope='v3:'+ 'a'.repeat(64);window.navigationReady=!query.has('pending');
    function App(){const[shown,setShown]=useState(!query.has('cold'));const[ready,setReady]=useState(window.navigationReady);window.expire=()=>setShown(false);window.acceptNavigation=()=>{window.navigationReady=true;setReady(true)};
      const value={context:{scope:window.cacheScope,authenticated:true},display:{language:'vi'}};
      void ready;return query.has('web')?<GuestNavigationShell authenticated={false}><main>Public Help</main></GuestNavigationShell>:<AppLocalShell context={query.has('pending')?value:null} presentationContext={shown?value:null} helpReturnPath={query.get('origin')} path={window.route}>{query.has('pending')?<main><textarea aria-label="Draft"/></main>:<main>Public Help</main>}</AppLocalShell>;
    }createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},plugins:[{name:'fixture-boundaries',setup(b){b.onResolve({filter:/\.css$/},()=>({path:'styles',namespace:'css-fixture'}));b.onLoad({filter:/.*/,namespace:'css-fixture'},()=>({contents:'export default {}',loader:'js'}));b.onResolve({filter:/^(?:@\/|next\/|\.\/)/},({path:specifier})=>{const key=specifier.startsWith('./')?'@/components/'+specifier.slice(2):specifier;if(specifier.startsWith('./')&&!(key in modules))return;if(key==='@/app/guest-navigation-shell')return{path:path.resolve('app/guest-navigation-shell.tsx')};return{path:key,namespace:'fixture'};});b.onLoad({filter:/.*/,namespace:'fixture'},({path:specifier})=>{if(!(specifier in modules))throw Error('Missing fixture boundary '+specifier);return{loader:specifier==='@/lib/auth-routing'?'tsx':'jsx',resolveDir:process.cwd(),contents:"import React from 'react';const pass=({children})=>children;"+modules[specifier]};});}}]});
  const js=result.outputFiles[0].text;
  server=createServer((req,res)=>{if(req.url?.startsWith('/bundle.js')){res.setHeader('content-type','application/javascript');res.end(js);}else{res.setHeader('content-type','text/html');res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath,headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
test('expired Help presentation becomes neutral, keeps bilingual return and starts no private reads',{skip:!executablePath},async()=>{const page=await browser.newPage();await page.goto(base);await page.getByTestId('role-chrome').waitFor();await page.evaluate(()=>window.expire());await page.getByRole('button',{name:'Quay lại ứng dụng'}).waitFor();assert.equal(await page.getByTestId('role-chrome').count(),0);assert.equal(await page.getByRole('link',{name:'Login',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Create account',exact:true}).count(),0);await page.getByRole('button',{name:'Quay lại ứng dụng'}).click();assert.deepEqual(await page.evaluate(()=>window.navigations),['/']);assert.equal(await page.evaluate(()=>window.privateReads),0);await page.close();});
test('cold English Help offers only ordinary home navigation without inventing identity',{skip:!executablePath},async()=>{const page=await browser.newPage();await page.goto(base+'/?cold=1&lang=en');await page.getByRole('button',{name:'Back to app'}).waitFor();assert.equal(await page.getByTestId('role-chrome').count(),0);assert.equal(await page.evaluate(()=>window.privateReads),0);await page.getByRole('button',{name:'Back to app'}).click();assert.deepEqual(await page.evaluate(()=>window.navigations),['/']);await page.close();});
test('expired in-app Help returns to the Staff or Owner origin without private reads on Help',{skip:!executablePath},async()=>{
  for(const origin of ['/staff/my-work?period=week','/bookings?date=2026-11-18'])for(const lang of ['en','vi']){
    const page=await browser.newPage();await page.goto(base+'/?'+new URLSearchParams({origin,lang}));
    await page.getByTestId('role-chrome').waitFor();await page.evaluate(()=>window.expire());
    await page.getByRole('button',{name:lang==='vi'?'Quay lại ứng dụng':'Back to app'}).click();
    assert.deepEqual(await page.evaluate(()=>window.navigations),[origin]);assert.equal(await page.evaluate(()=>window.privateReads),0);await page.close();
  }
});
test('untrusted, auth and Help-loop return hints use the ordinary home fallback',{skip:!executablePath},async()=>{
  for(const origin of ['https://example.com/','//example.com/','/\\example.com/','/login?next=/staff/my-work','/help?lang=vi','/x/../help/account']){
    const page=await browser.newPage();await page.goto(base+'/?'+new URLSearchParams({origin,cold:'1',lang:'en'}));
    await page.getByRole('button',{name:'Back to app'}).click();assert.deepEqual(await page.evaluate(()=>window.navigations),['/']);await page.close();
  }
});
test('ordinary guest web and other public documents retain their existing login controls',{skip:!executablePath},async()=>{for(const query of ['?web=1','?cold=1&legal=1']){const page=await browser.newPage();await page.goto(base+'/'+query);await page.getByRole('link',{name:'Login',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Back to app|Quay lại ứng dụng/}).count(),0);await page.close();}});

 test("Help without a language uses English return text and no private reads",{skip:!executablePath},async()=>{const page=await browser.newPage();await page.goto(base+"/?cold=1&default=1");await page.getByRole("button",{name:"Back to app",exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"Quay lại ứng dụng"}).count(),0);assert.equal(await page.evaluate(()=>window.privateReads),0);await page.close();});

test('pending authenticated navigation keeps neutral chrome and the same draft node when its menu arrives',{skip:!executablePath},async()=>{const page=await browser.newPage();await page.goto(base+'/?pending=1');await page.locator('[data-app-local-pending-shell]').waitFor();assert.equal(await page.getByTestId('role-chrome').count(),0);assert.equal(await page.getByRole('link',{name:/Login|My account/}).count(),0);await page.getByRole('textbox',{name:'Draft'}).fill('unsaved draft stays');await page.evaluate(()=>{window.draftNode=document.querySelector('textarea');window.acceptNavigation()});await page.getByTestId('role-chrome').waitFor();assert.equal(await page.locator('[data-app-local-pending-shell]').count(),0);assert.equal(await page.getByRole('textbox',{name:'Draft'}).inputValue(),'unsaved draft stays');assert.equal(await page.evaluate(()=>window.draftNode===document.querySelector('textarea')),true);await page.close();});
