import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import test from 'node:test';
import {build} from 'esbuild';
import ts from 'typescript';
import {chromium,webkit} from 'playwright-core';

const engine=process.env.TEST_BROWSER_ENGINE||'chromium';
const browserPath=process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip=engine==='chromium'&&!existsSync(browserPath);
const entry=readFileSync('app/local-app/entry.tsx','utf8');
const parsed=ts.createSourceFile('entry.tsx',entry,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),imports=new Map();
for(const item of parsed.statements){
 if(!ts.isImportDeclaration(item))continue;
 const path=item.moduleSpecifier.text;
 if(['react','react-dom/client','@/lib/app-local-context-recovery'].includes(path))continue;
 imports.set(path,item.importClause?.namedBindings?.elements?.map(x=>x.propertyName?.text??x.name.text)??[]);
}
const commandModule=`let scope;export const getAppLocalCommandScope=()=>scope;export const setAppLocalCommandScope=value=>scope=value;`;
const replacements={
 '@/lib/app-local-host':`export const getAppLocalHost=()=>window.fixtureHost;export const appLocalRequestId=()=>crypto.randomUUID();export function appLocalPath(value){if(!value.startsWith('/')||value.startsWith('//')||/[\\\\\\u0000-\\u001f]/.test(value))throw Error('Invalid route');const u=new URL(value,'https://reylumi.com');if(u.origin!=='https://reylumi.com')throw Error('Invalid origin');return u.pathname+u.search+u.hash;}`,
 '@/lib/app-local-command-client':commandModule,
 '@/lib/app-local-page-registry':`import React from'react';const Page=({context,path})=><main data-private-page data-path={path} data-role={context.display.role} data-scope={context.context.scope}><input aria-label="Draft" defaultValue={context.display.role}/></main>;export const getAppLocalPage=p=>['/staff/today','/staff/my-work','/staff/appointments','/settings'].includes(p)?{id:p,title:'Workspace',requiresContext:true,Component:Page}:null;`,
 '@/components/app-local-shell':`import React from'react';export function AppLocalShell({context,children,checkContext}){window.fixtureMinuteCheck=checkContext;return <>{context?<nav data-role-nav={context.display.role}>{context.display.role}</nav>:<header data-opening>Opening</header>}{children}</>}`,
 './navigation':`export function AppLocalNavigationProvider({children}){return children}`,
 './scope':`export function ExperienceScopeProvider({children}){return children}`,
 '@/lib/app-local-scope-id':`export const isAppLocalScopeId=v=>/^v3:[a-f0-9]{64}$/.test(v);export const isAppLocalPortableScopeId=()=>false`,
 '@/lib/experience-offline-policy':`export const getExperienceOfflinePath=p=>p;export const isExperienceOfflineGrant=(g,o,now=Date.now())=>g?.scope===o.scope&&g.expiresAt>now&&(!o.generation||g.generation===o.generation)`,
 '@/lib/legal-policies':`export const legalDocuments={}`,
 '@/lib/app-local-resource':`export const resetAppLocalResources=()=>{window.fixtureStats.resets++};export const useAppLocalResource=()=>({loading:false,refreshing:false,refresh:async()=>{}})`,
 '@/lib/app-local-reference-content':`export const APP_LOCAL_REFERENCE_ASSETS=[]`,
 '@/lib/app-local-secondary-registry':`export const getAppLocalSecondaryPage=()=>null;export const appLocalRouteAlias=()=>null`,
};
const mock=(path,names)=>replacements[path]??names.map(name=>`export const ${name}=${name.startsWith('getAppLocal')?'()=>null':['clearExperienceSnapshots','acceptExperienceOfflineGrant'].includes(name)?'async()=>{}':name.startsWith('install')?'()=>()=>{}':'()=>null'};`).join('\n');
let compiled;
async function compile(){
 compiled??=build({stdin:{contents:entry+`\nimport{navigateToWorkspace}from'./lib/app-local-shell-workspace-navigation';window.fixtureSwitch=role=>navigateToWorkspace(role+'-space');`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':process.cwd()},plugins:[{name:'workspace-fixture-boundaries',setup(b){
  for(const[path]of imports)b.onResolve({filter:new RegExp('^'+path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')},()=>({path,namespace:'fixture'}));
  b.onResolve({filter:/^\.\/app-local-host$/},()=>({path:'@/lib/app-local-host',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/app-local-command-client$/},()=>({path:'@/lib/app-local-command-client',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:mock(path,imports.get(path)??[]),loader:'tsx',resolveDir:process.cwd()}));
 }}]});return compiled;
}
async function fixture(options={}){
 const built=await compile();
 const setup=`window.fixtureOptions=${JSON.stringify(options)};window.fixtureStats={calls:[],commands:0,resets:0,aborted:0,errors:[]};window.fixtureServerRole='staff';window.fixtureHeld=[];
 window.__reylumiAppLocalContext={generation:'synthetic-generation-20261018',scopeEpoch:1,nonce:'fixture'};
 window.addEventListener('reylumi:app-local-workspace-error',e=>window.fixtureStats.errors.push(e.detail));
 window.fixtureDispatchResolve=(detail={})=>window.dispatchEvent(new CustomEvent('reylumi:app-local-workspace-resolve',{detail:{generation:window.__reylumiAppLocalContext.generation,...detail}}));
 window.fixtureNavigate=p=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path:p}}));
 window.fixtureHost={isNative:true,cache:async()=>null,openOnline:async()=>{throw Error('External navigation blocked')},command:async(name,args)=>{window.fixtureStats.commands++;if(!window.fixtureOptions.failBeforeWrite)window.fixtureServerRole=args.workspaceId.startsWith('owner')?'owner':'staff';if(window.fixtureOptions.resetBeforeReply){window.__reylumiAppLocalContext.scopeEpoch++;window.dispatchEvent(new CustomEvent('reylumi:app-local-reset',{detail:{reason:'context',scopeEpoch:window.__reylumiAppLocalContext.scopeEpoch}}));}throw Object.assign(Error('Synthetic unconfirmed reply'),{status:503});},context:async(path,request)=>{
 window.fixtureStats.calls.push({path,fresh:Boolean(request.fresh)});
 const role=path==='/'?window.fixtureServerRole:path==='/staff/today'?'owner':'staff',scope='v3:'+(role==='owner'?'a':'b').repeat(64),generation=window.__reylumiAppLocalContext.generation;
 const make=()=>({schemaVersion:1,context:{scope,authenticated:true,viewerId:window.fixtureOptions.otherViewer&&path==='/'?'other-viewer':'fixture-viewer',workspaceId:role+'-space',salonId:'fixture-salon',permissionRevision:role},grant:{scope,generation,expiresAt:Date.now()+3600000,grantRevision:role,kind:role},onlineValidatedAt:Date.now(),offline:false,home:window.fixtureOptions.unsafeHome&&path==='/'?'https://outside.invalid/':role==='owner'?'/staff/today':'/staff/my-work',display:{role},access:{ownerWorkspace:role==='owner',staffWorkspace:role==='staff'}});
 if(path==='/'&&window.fixtureOptions.neutralFailures>0){window.fixtureOptions.neutralFailures--;throw Object.assign(Error('Synthetic context unavailable'),{status:503});}
 return new Promise((resolve,reject)=>{let done=false;const abort=()=>{if(done)return;done=true;window.fixtureStats.aborted++;reject(new DOMException('Cancelled','AbortError'))};request.signal.addEventListener('abort',abort,{once:true});const finish=()=>{if(done)return;done=true;request.signal.removeEventListener('abort',abort);resolve(make());};if(window.fixtureOptions.holdPath===path)window.fixtureHeld.push(finish);else setTimeout(finish,20);});
 }};`;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:'<div id="app"></div><script>'+setup+'</script><script src="/app.js"></script>')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();let browser;
 try{
  browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({executablePath:browserPath,headless:true}));
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+'/staff/my-work');
  await page.locator('[data-private-page][data-role="staff"]:visible').waitFor();
  return{page,async close(){await browser.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);}};
 }catch(e){await browser?.close();await new Promise(resolve=>server.close(resolve));throw e;}
}

test('lost workspace acknowledgments recover through neutral state for twenty round trips in each direction, one write each',{skip,timeout:60000},async()=>{
 const a=await fixture();try{
  for(let i=0;i<40;i++){
   const role=i%2===0?'owner':'staff';await a.page.evaluate(role=>window.fixtureSwitch(role),role);
   await a.page.locator('[data-private-page][data-role="'+role+'"]:visible').waitFor();
   const s=await a.page.evaluate(()=>window.fixtureStats);assert.equal(s.commands,i+1);assert.equal(s.errors.length,0);
   assert.equal(s.calls.filter(x=>x.path==='/').length,i+1);
   assert.equal(await a.page.locator('[data-role-nav="'+role+'"]').count(),1);
   assert.equal(await a.page.locator('[data-private-page][data-role="'+(role==='owner'?'staff':'owner')+'"]:visible').count(),0);
  }
 }finally{await a.close();}
});
test('an uncommitted switch recovers its actual Staff workspace and reports that the requested Owner workspace did not open',{skip,timeout:20000},async()=>{
 const a=await fixture({failBeforeWrite:true});try{await a.page.evaluate(()=>window.fixtureSwitch('owner'));await a.page.waitForFunction(()=>window.fixtureStats.errors.length===1);await a.page.locator('[data-private-page][data-role="staff"]:visible').waitFor();const s=await a.page.evaluate(()=>window.fixtureStats);assert.equal(s.commands,1);assert.match(s.errors[0],/did not change/);}finally{await a.close();}
});
test('neutral failure retry and foreground/minute checks never restart the Staff route or replay a committed switch',{skip,timeout:20000},async()=>{
 const a=await fixture({neutralFailures:2});try{await a.page.evaluate(()=>window.fixtureSwitch('owner'));await a.page.locator('[data-context-failure]').waitFor();const before=await a.page.evaluate(()=>window.fixtureStats.calls.length);await a.page.evaluate(()=>window.fixtureMinuteCheck());assert.equal(await a.page.evaluate(()=>window.fixtureStats.calls.length),before);await a.page.getByRole('button',{name:'Try again',exact:true}).click();await a.page.locator('[data-private-page][data-role="owner"]:visible').waitFor();const s=await a.page.evaluate(()=>window.fixtureStats);assert.equal(s.commands,1);assert.deepEqual(s.calls.map(x=>x.path),['/staff/my-work','/','/','/','/staff/today']);}finally{await a.close();}
});
test('account mismatch, unsafe server home and stale-generation events cannot admit Owner',{skip,timeout:25000},async()=>{
 for(const options of[{otherViewer:true},{unsafeHome:true}]){const a=await fixture(options);try{await a.page.evaluate(()=>window.fixtureSwitch('owner'));await a.page.locator('[data-context-failure]').waitFor();assert.equal(await a.page.locator('[data-private-page]:visible').count(),0);assert.equal(await a.page.evaluate(()=>window.fixtureStats.commands),1);}finally{await a.close();}}
 const a=await fixture();try{await a.page.evaluate(()=>window.fixtureDispatchResolve({generation:'obsolete-generation'}));await a.page.waitForTimeout(100);assert.equal(await a.page.evaluate(()=>window.fixtureStats.calls.length),1);assert.equal(await a.page.locator('[data-private-page][data-role="staff"]:visible').count(),1);}finally{await a.close();}
});
test('navigation away cancels held neutral recovery and rejects its late former-role result',{skip,timeout:20000},async()=>{
 const a=await fixture({holdPath:'/'});try{await a.page.evaluate(()=>window.fixtureSwitch('owner'));await a.page.waitForFunction(()=>window.fixtureHeld.length===1);await a.page.evaluate(()=>window.fixtureNavigate('/settings'));await a.page.locator('[data-private-page][data-path="/settings"]:visible').waitFor();await a.page.evaluate(()=>{
  window.fixtureHeld.forEach(f=>f());
  const scope='v3:'+'a'.repeat(64),generation=window.__reylumiAppLocalContext.generation;
  window.dispatchEvent(new CustomEvent('reylumi:app-local-context',{detail:{schemaVersion:1,contextPath:'/',context:{scope,authenticated:true,viewerId:'fixture-viewer',workspaceId:'owner-space',salonId:'fixture-salon',permissionRevision:'owner'},grant:{scope,generation,expiresAt:Date.now()+3600000,grantRevision:'owner',kind:'owner'},onlineValidatedAt:Date.now(),offline:false,display:{role:'owner'},home:'/staff/today'}}));
 });await a.page.waitForTimeout(150);assert.equal(await a.page.locator('[data-private-page][data-role="owner"]:visible').count(),0);assert.equal(await a.page.locator('[data-private-page][data-path="/settings"][data-role="staff"]:visible').count(),1);assert.equal(await a.page.evaluate(()=>window.fixtureStats.commands),1);}finally{await a.close();}
});
test('the minute session callback and foreground burst join one pending current-route validation',{skip,timeout:20000},async()=>{
 const a=await fixture();try{
  await a.page.evaluate(()=>{window.fixtureOptions.holdPath='/staff/my-work';void window.fixtureMinuteCheck();for(let i=0;i<8;i++)window.dispatchEvent(new Event('reylumi:foreground'));});
  await a.page.waitForFunction(()=>window.fixtureHeld.length===1);assert.equal(await a.page.evaluate(()=>window.fixtureStats.calls.length),2);
  await a.page.evaluate(()=>window.fixtureHeld.forEach(f=>f()));await a.page.waitForTimeout(100);
  assert.equal(await a.page.evaluate(()=>window.fixtureStats.calls.length),2);assert.equal(await a.page.locator('[data-private-page][data-role="staff"]:visible').count(),1);
 }finally{await a.close();}
});
test('a late cached callback cannot downgrade a newer online admission and trigger a fresh navigation read',{skip,timeout:20000},async()=>{
 const a=await fixture();try{
  await a.page.evaluate(()=>{
   const generation=window.__reylumiAppLocalContext.generation,scope='v3:'+'b'.repeat(64);
   window.dispatchEvent(new CustomEvent('reylumi:app-local-context',{detail:{schemaVersion:1,contextPath:'/staff/my-work',context:{scope,authenticated:true,viewerId:'fixture-viewer',workspaceId:'staff-space',salonId:'fixture-salon',permissionRevision:'staff'},grant:{scope,generation,expiresAt:Date.now()+3600000,grantRevision:'staff',kind:'staff'},onlineValidatedAt:Date.now()-60000,offline:true,display:{role:'staff'}}}));
   window.fixtureNavigate('/staff/appointments');
  });
  await a.page.locator('[data-private-page][data-path="/staff/appointments"]:visible').waitFor();await a.page.waitForTimeout(100);
  assert.equal(await a.page.evaluate(()=>window.fixtureStats.calls.length),1);assert.equal(await a.page.locator('[data-role-nav="staff"]').count(),1);
 }finally{await a.close();}
});
test('a same-generation authority reset during the gesture retains only its original viewer binding for read-only recovery',{skip,timeout:20000},async()=>{
 const a=await fixture({resetBeforeReply:true});try{
  await a.page.evaluate(()=>window.fixtureSwitch('owner'));
  await a.page.locator('[data-private-page][data-role="owner"]:visible').waitFor();
  const s=await a.page.evaluate(()=>window.fixtureStats);assert.equal(s.commands,1);assert.equal(s.errors.length,0);assert.deepEqual(s.calls.map(x=>x.path),['/staff/my-work','/','/staff/today']);
 }finally{await a.close();}
 const denied=await fixture({resetBeforeReply:true,otherViewer:true});try{
  await denied.page.evaluate(()=>window.fixtureSwitch('owner'));await denied.page.locator('[data-context-failure]').waitFor();assert.equal(await denied.page.locator('[data-private-page]:visible').count(),0);assert.equal(await denied.page.evaluate(()=>window.fixtureStats.commands),1);
 }finally{await denied.close();}
});

test('a non-context reset cancels neutral handoff and lets manual or resource recovery admit the current Staff route without another write',{skip,timeout:25000},async()=>{
 for(const reason of ['manual','resource']){
  const a=await fixture({holdPath:'/'});try{
   await a.page.evaluate(()=>window.fixtureSwitch('owner'));
   await a.page.waitForFunction(()=>window.fixtureHeld.length===1);
   await a.page.evaluate(reason=>{
    window.fixtureOptions.holdPath=undefined;
    window.__reylumiAppLocalContext.scopeEpoch++;
    window.dispatchEvent(new CustomEvent('reylumi:app-local-reset',{detail:{reason,scopeEpoch:window.__reylumiAppLocalContext.scopeEpoch}}));
    window.fixtureHeld.forEach(f=>f());
    const generation=window.__reylumiAppLocalContext.generation,scope='v3:'+'a'.repeat(64);
    window.dispatchEvent(new CustomEvent('reylumi:app-local-context',{detail:{schemaVersion:1,contextPath:'/',context:{scope,authenticated:true,viewerId:'fixture-viewer',workspaceId:'owner-space',salonId:'fixture-salon',permissionRevision:'owner'},grant:{scope,generation,expiresAt:Date.now()+3600000,grantRevision:'owner',kind:'owner'},onlineValidatedAt:Date.now(),offline:false,display:{role:'owner'},home:'/staff/today'}}));
   },reason);
   if(reason==='manual'){
    await a.page.locator('[data-context-failure]').waitFor();
    assert.equal(await a.page.locator('[data-private-page]:visible').count(),0);
    await a.page.getByRole('button',{name:'Try again',exact:true}).click();
   }
   await a.page.locator('[data-private-page][data-path="/staff/my-work"][data-role="staff"]:visible').waitFor();
   await a.page.waitForTimeout(100);
   const stats=await a.page.evaluate(()=>window.fixtureStats);
   assert.equal(stats.aborted,1,'the old neutral read was cancelled');
   assert.equal(stats.commands,1,'a reset or retry must never replay the workspace command');
   assert.deepEqual(stats.calls.map(call=>call.path),['/staff/my-work','/','/staff/my-work']);
   assert.equal(await a.page.locator('[data-private-page][data-role="owner"]:visible').count(),0,'late neutral events are not page admission');
  }finally{await a.close();}
 }
});
