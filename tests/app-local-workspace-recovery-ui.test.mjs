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
 if(['react','react-dom/client','@/lib/app-local-context-recovery','@/lib/app-local-page-admission'].includes(path))continue;
 imports.set(path,item.importClause?.namedBindings?.elements?.map(x=>x.propertyName?.text??x.name.text)??[]);
}
const commandModule=`let scope;export const getAppLocalCommandScope=()=>scope;export const setAppLocalCommandScope=value=>scope=value;`;
const replacements={
 '@/lib/app-local-host':`export const getAppLocalHost=()=>window.fixtureHost;export const appLocalRequestId=()=>crypto.randomUUID();export function appLocalPath(value){if(!value.startsWith('/')||value.startsWith('//')||/[\\\\\\u0000-\\u001f]/.test(value))throw Error('Invalid route');const u=new URL(value,'https://reylumi.com');if(u.origin!=='https://reylumi.com')throw Error('Invalid origin');return u.pathname+u.search+u.hash;}`,
 '@/lib/app-local-command-client':commandModule,
 '@/lib/app-local-page-registry':`import React from'react';const Page=({context,path})=><main data-private-page data-path={path} data-role={context.display.role} data-scope={context.context.scope}><input aria-label="Draft" defaultValue={context.display.role}/></main>;export const getAppLocalPage=p=>['/staff/today','/staff/my-work','/staff/appointments','/settings','/my-place'].includes(p)?{id:p,title:'Workspace',requiresContext:true,Component:Page}:null;`,
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
const compiled=new Map();

test('a stale Staff read during a committed Owner gesture cannot restart Staff or cancel destination admission', { skip, timeout: 20000 }, async () => {
 const app=await fixture({acknowledgedSwitch:true,scopeConflictBeforeReply:true,nativeEventBeforeReply:true});
 try{
  await app.page.locator('[data-private-page][data-role="staff"]:visible').waitFor();
  await app.page.evaluate(()=>window.fixtureSwitch('owner'));
  await app.page.locator('[data-private-page][data-role="owner"]:visible').waitFor();
  const observed=await app.page.evaluate(()=>window.fixtureStats);
  assert.equal(observed.commands,1);
  assert.deepEqual(observed.calls.map(x=>x.path),['/staff/my-work','/staff/today']);
  assert.equal(observed.aborted,0);
  assert.equal(await app.page.locator('[data-context-failure]').count(),0);
 }finally{await app.close();}
});
async function compile(realPolicy=false){
 if(!compiled.has(realPolicy))compiled.set(realPolicy,build({stdin:{contents:entry+`\nimport{navigateToWorkspace,completeWorkspaceHandoff}from'./lib/app-local-shell-workspace-navigation';window.fixtureSwitch=role=>navigateToWorkspace(role+'-space');window.fixtureHandoff=completeWorkspaceHandoff;`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':process.cwd()},plugins:[{name:'workspace-fixture-boundaries',setup(b){
  for(const[path]of imports){if(realPolicy&&path==='@/lib/experience-offline-policy')continue;b.onResolve({filter:new RegExp('^'+path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')},()=>({path,namespace:'fixture'}));}
  b.onResolve({filter:/^\.\/app-local-host$/},()=>({path:'@/lib/app-local-host',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/app-local-command-client$/},()=>({path:'@/lib/app-local-command-client',namespace:'fixture'}));
  if(!realPolicy)b.onResolve({filter:/^\.\/experience-offline-policy$/},()=>({path:'@/lib/experience-offline-policy',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:mock(path,imports.get(path)??[]),loader:'tsx',resolveDir:process.cwd()}));
 }}]}));return compiled.get(realPolicy);
}
async function fixture(options={}){
 const built=await compile(Boolean(options.realPolicy));
 const setup=`window.fixtureOptions=${JSON.stringify(options)};window.fixtureStats={calls:[],commands:0,commandReplies:0,resets:0,aborted:0,errors:[],activeReads:0,contextEvents:0,replyPaths:[],ordering:[]};window.fixtureServerRole=window.fixtureOptions.initialRole||'staff';window.fixtureHeld=[];
 window.__reylumiAppLocalContext={generation:'synthetic-generation-20261018',scopeEpoch:1,nonce:'fixture'};
 window.addEventListener('reylumi:app-local-workspace-error',e=>window.fixtureStats.errors.push(e.detail));
 window.fixtureDispatchResolve=(detail={})=>window.dispatchEvent(new CustomEvent('reylumi:app-local-workspace-resolve',{detail:{generation:window.__reylumiAppLocalContext.generation,...detail}}));
 window.fixtureNavigate=p=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path:p}}));
 window.fixtureHost={isNative:true,cache:async()=>null,openOnline:async()=>{throw Error('External navigation blocked')},command:async(name,args)=>{window.fixtureStats.commands++;if(!window.fixtureOptions.failBeforeWrite)window.fixtureServerRole=args.workspaceId.startsWith('owner')?'owner':'staff';if(window.fixtureOptions.scopeConflictBeforeReply)window.dispatchEvent(new CustomEvent('reylumi:app-local-scope-conflict',{detail:{scope:'v3:'+'b'.repeat(64),status:409,reason:'stale-scope'}}));if(window.fixtureOptions.resetBeforeReply){window.__reylumiAppLocalContext.scopeEpoch++;window.dispatchEvent(new CustomEvent('reylumi:app-local-reset',{detail:{reason:'context',scopeEpoch:window.__reylumiAppLocalContext.scopeEpoch}}));}if(window.fixtureOptions.holdCommandReply)await new Promise(resolve=>{window.fixtureReleaseCommand=resolve;});window.fixtureStats.commandReplies++;if(window.fixtureOptions.acknowledgedSwitch)return{path:window.fixtureServerRole==='owner'?'/staff/today':'/staff/my-work'};throw Object.assign(Error('Synthetic unconfirmed reply'),{status:503});},context:async(path,request)=>{
 window.fixtureStats.calls.push({path,fresh:Boolean(request.fresh)});
 const role=path==='/'?window.fixtureServerRole:path==='/staff/today'?'owner':path==='/my-place'?'customer':'staff',scope='v3:'+(role==='owner'?'a':'b').repeat(64),generation=window.__reylumiAppLocalContext.generation;
 const make=()=>{const now=Date.now(),viewer=window.fixtureOptions.realPolicy?'00000000-0000-4000-8000-000000000001':'fixture-viewer',salon=window.fixtureOptions.realPolicy?'00000000-0000-4000-8000-000000000002':'fixture-salon';return{schemaVersion:1,contextPath:path,host:{...window.__reylumiAppLocalContext},context:{scope,authenticated:true,viewerId:window.fixtureOptions.otherViewer&&path==='/'?'other-viewer':viewer,workspaceId:role+'-space',salonId:salon,permissionRevision:role},grant:window.fixtureOptions.explicitGrantStatus?null:{version:1,scope,scopes:[scope],viewerId:viewer,workspaceId:role+'-space',salonId:salon,generation,issuedAt:now-1000,expiresAt:now+3600000,path:role==='owner'?'/staff/today':role==='customer'?'/my-place':'/staff/my-work',grantRevision:role,kind:role,...(role==='staff'?{staffBinding:{version:1,staffId:'00000000-0000-4000-8000-000000000003',viewerId:viewer,salonId:salon,revision:'00000000-0000-4000-8000-000000000004',approvedAt:new Date(now-10000).toISOString()}}:{})},grantStatus:window.fixtureOptions.explicitGrantStatus||200,onlineValidatedAt:now,offline:false,home:window.fixtureOptions.unsafeHome&&path==='/'?'https://outside.invalid/':role==='owner'?'/staff/today':role==='customer'?'/my-place':'/staff/my-work',display:{role},access:{ownerWorkspace:role==='owner',staffWorkspace:role==='staff'}};};
 if(path==='/'&&window.fixtureOptions.neutralFailures>0){window.fixtureOptions.neutralFailures--;throw Object.assign(Error('Synthetic context unavailable'),{status:503});}
 return new Promise((resolve,reject)=>{let done=false;window.fixtureStats.activeReads++;const abort=()=>{if(done)return;done=true;window.fixtureStats.activeReads--;window.fixtureStats.aborted++;window.fixtureStats.ordering.push({type:'abort',path});reject(new DOMException('Cancelled','AbortError'))};request.signal.addEventListener('abort',abort,{once:true});const finish=()=>{if(done)return;if(window.fixtureOptions.rotateOnNextContext){window.fixtureOptions.rotateOnNextContext=false;window.__reylumiAppLocalContext.scopeEpoch++;window.dispatchEvent(new CustomEvent('reylumi:app-local-reset',{detail:{...window.__reylumiAppLocalContext,reason:'context'}}));}const value=make();if(window.fixtureOptions.nativeEventBeforeReply){window.fixtureStats.contextEvents++;window.fixtureStats.ordering.push({type:'event',path});window.dispatchEvent(new CustomEvent('reylumi:app-local-context',{detail:value}));}const deliver=()=>{if(done)return;done=true;window.fixtureStats.activeReads--;request.signal.removeEventListener('abort',abort);window.fixtureStats.replyPaths.push(path);window.fixtureStats.ordering.push({type:'reply',path});resolve(value);};if(window.fixtureOptions.nativeEventBeforeReply)setTimeout(deliver,5);else deliver();};if(window.fixtureOptions.holdPath===path)window.fixtureHeld.push(finish);else setTimeout(finish,20);});
 }};`;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:'<div id="app"></div><script>'+setup+'</script><script src="/app.js"></script>')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();let browser;
 try{
  browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({executablePath:browserPath,headless:true}));
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port+(options.startPath||'/staff/my-work'));
  await page.locator('[data-private-page][data-role="'+(options.initialRole||'staff')+'"]:visible').waitFor();
  await page.waitForFunction(()=>window.fixtureStats.activeReads===0);
  return{page,async close(){await browser.close();await new Promise(resolve=>server.close(resolve));assert.deepEqual(errors,[]);}};
 }catch(e){await browser?.close();await new Promise(resolve=>server.close(resolve));throw e;}
}

test('user navigation away cancels ownership of a late workspace acknowledgment, including navigation back to the same route',{skip,timeout:45000},async()=>{
 for(const initialRole of ['staff','owner'])for(const acknowledgedSwitch of [true,false])for(const returnToOrigin of [false,true]){
  const origin=initialRole==='owner'?'/staff/today':'/staff/my-work';
  const targetRole=initialRole==='owner'?'staff':'owner';
  const scenario=JSON.stringify({initialRole,acknowledgedSwitch,returnToOrigin});
  const a=await fixture({initialRole,startPath:origin,acknowledgedSwitch,holdCommandReply:true,realPolicy:true});try{
   await a.page.evaluate(role=>window.fixtureSwitch(role),targetRole);
   await a.page.waitForFunction(()=>typeof window.fixtureReleaseCommand==='function');
   await a.page.evaluate(()=>window.fixtureNavigate('/help'));
   await a.page.waitForFunction(()=>location.pathname==='/help');
   assert.equal(await a.page.locator('[data-private-page]:visible').count(),0);
   if(returnToOrigin){
    await a.page.evaluate(path=>window.fixtureNavigate(path),origin);
    await a.page.locator('[data-private-page][data-role="'+initialRole+'"]:visible').waitFor();
    await a.page.waitForFunction(()=>window.fixtureStats.activeReads===0);
   }
   const before=await a.page.evaluate(()=>window.fixtureStats.calls.length);
   await a.page.evaluate(async()=>{window.fixtureReleaseCommand();for(let i=0;i<12;i++)await Promise.resolve();});
   await a.page.waitForFunction(()=>window.fixtureStats.commandReplies===1&&window.fixtureStats.activeReads===0);
   assert.equal(await a.page.evaluate(()=>location.pathname),returnToOrigin?origin:'/help',scenario);
   assert.equal(await a.page.locator('[data-private-page][data-role="'+targetRole+'"]:visible').count(),0,scenario);
   const stats=await a.page.evaluate(()=>window.fixtureStats);
   assert.equal(stats.commands,1,'navigation cancellation cannot replay a committed workspace write');
   assert.equal(stats.calls.length,before,'late ACK cannot start destination admission after its gesture was cancelled: '+scenario);
  }finally{await a.close();}
 }
});

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

// Native freshContext emits the DOM context event before its bridge reply.
// These cases use the actual complete lease/Staff-binding/page validators;
// only HTTP/native delivery and page/shell rendering are controlled fixtures.
async function settleContextReads(page,before){
 await page.waitForFunction(before=>window.fixtureStats.calls.length>before&&window.fixtureStats.activeReads===0,before,{timeout:4000});
 await page.waitForTimeout(50);
}

test('native event before reply preserves same-route Owner Today handoff after login instead of starting neutral recovery',{skip,timeout:20000},async()=>{
 for(const nativeEventBeforeReply of [false,true]){
  const a=await fixture({realPolicy:true,initialRole:'owner',startPath:'/staff/today',nativeEventBeforeReply});try{
   const before=await a.page.evaluate(()=>window.fixtureStats.calls.length);
   await a.page.evaluate(()=>{window.fixtureOptions.rotateOnNextContext=true;window.fixtureHandoff('/staff/today');});
   await settleContextReads(a.page,before);
   const stats=await a.page.evaluate(()=>window.fixtureStats);
   assert.equal(await a.page.locator('[data-context-failure]').count(),0,JSON.stringify({nativeEventBeforeReply,calls:stats.calls,ordering:stats.ordering}));
   assert.equal(await a.page.locator('[data-private-page][data-path="/staff/today"][data-role="owner"]:visible').count(),1);
   assert.deepEqual(stats.calls.slice(before).map(x=>x.path),['/staff/today'],'a successful requested page must not recurse through neutral /');
   assert.equal(stats.aborted,0,'native context event must not cancel its own successful request');
   assert.equal(stats.commands,0,'login/page handoff must not synthesize a business write');
   if(nativeEventBeforeReply)assert.deepEqual(stats.ordering.slice(-2).map(x=>x.type),['event','reply']);
  }finally{await a.close();}
 }
});

test('native event before reply preserves acknowledged Staff to Owner and reverse handoffs with one write each',{skip,timeout:20000},async()=>{
 const a=await fixture({realPolicy:true,nativeEventBeforeReply:true,acknowledgedSwitch:true});try{
  for(const role of ['owner','staff']){
   const before=await a.page.evaluate(()=>window.fixtureStats.calls.length);
   await a.page.evaluate(role=>{window.fixtureOptions.rotateOnNextContext=true;window.fixtureSwitch(role);},role);
   await settleContextReads(a.page,before);
   const stats=await a.page.evaluate(()=>window.fixtureStats);
   assert.equal(await a.page.locator('[data-context-failure]').count(),0,JSON.stringify({role,calls:stats.calls,ordering:stats.ordering}));
   assert.equal(await a.page.locator('[data-private-page][data-role="'+role+'"]:visible').count(),1);
   assert.deepEqual(stats.calls.slice(before).map(x=>x.path),[role==='owner'?'/staff/today':'/staff/my-work']);
   assert.equal(stats.aborted,0);
   assert.equal(stats.commands,role==='owner'?1:2,'a native event/foreground recovery must never replay a workspace write');
  }
 }finally{await a.close();}
});

test('native event before reply preserves Personal to Owner handoff with the actual customer lease policy',{skip,timeout:15000},async()=>{
 const a=await fixture({realPolicy:true,initialRole:'customer',startPath:'/my-place',nativeEventBeforeReply:true,acknowledgedSwitch:true});try{
  const before=await a.page.evaluate(()=>window.fixtureStats.calls.length);
  await a.page.evaluate(()=>{window.fixtureOptions.rotateOnNextContext=true;window.fixtureSwitch('owner');});
  await settleContextReads(a.page,before);
  const stats=await a.page.evaluate(()=>window.fixtureStats);
  assert.equal(await a.page.locator('[data-context-failure]').count(),0,JSON.stringify({calls:stats.calls,ordering:stats.ordering}));
  assert.equal(await a.page.locator('[data-private-page][data-path="/staff/today"][data-role="owner"]:visible').count(),1);
  assert.deepEqual(stats.calls.slice(before).map(x=>x.path),['/staff/today']);
  assert.equal(stats.aborted,0);
  assert.equal(stats.commands,1,'Personal to Owner issues the requested workspace switch exactly once');
 }finally{await a.close();}
});

test('native event before reply keeps explicit401403409 denial fail-closed during Owner handoff',{skip,timeout:20000},async()=>{
 for(const [status,category]of [[401,'sign-in'],[403,'access'],[409,'workspace']]){
  const a=await fixture({realPolicy:true,initialRole:'owner',startPath:'/staff/today',nativeEventBeforeReply:true});try{
   const before=await a.page.evaluate(()=>window.fixtureStats.calls.length);
   await a.page.evaluate(status=>{window.fixtureOptions.explicitGrantStatus=status;window.fixtureOptions.rotateOnNextContext=true;window.fixtureHandoff('/staff/today');},status);
   await settleContextReads(a.page,before);
   await a.page.locator('[data-context-failure="'+category+'"]').waitFor({timeout:3000});
   assert.equal(await a.page.locator('[data-private-page]:visible').count(),0,'neither an event nor reply may override real denial');
   assert.equal(await a.page.evaluate(()=>window.fixtureStats.commands),0);
  }finally{await a.close();}
 }
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
