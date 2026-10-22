import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

// Real installed entry, local ScopeProvider, strict online proof reader and both
// context routes. Database authority, bridge delivery and registry content are
// fixtures; no business writes or external requests occur.
const engine = process.env.TEST_BROWSER_ENGINE || 'chromium';
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if(!['chromium','webkit'].includes(engine))throw Error('Invalid engine');if(engine==='chromium'&&!existsSync(browserPath))throw Error('Chromium unavailable; no skips allowed');
const generation = 'page-admission-fixture-20261019';
const viewer = '00000000-0000-4000-8000-000000000001';
const salon = '00000000-0000-4000-8000-000000000002';
const staffId = '00000000-0000-4000-8000-000000000003';
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(process.env.TEST_STAFF_ONLINE_BASELINE==='1'&&file==='app/api/app-local/context/route.ts'?execFileSync('git',['show','f90575a6b9f67e8d1d79bd3cfdc3704b9c5e9914:'+file],{encoding:'utf8'}):readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => { assert.ok(name in dependencies, `${file}: unexpected ${name}`); return dependencies[name]; }, exports);
  return exports;
}
const policy = load('lib/experience-offline-policy.ts', { './staff-offline-binding': load('lib/staff-offline-binding.ts') });

function contextHandler(options={}) {
 const accountId='00000000-0000-4000-8000-000000000006';
 const business=role=>({user:{id:viewer,display_name:'Fixture',language:'en',status:'active'},salonMode:role==='owner'?'manage':role==='staff'?'staff':null,currentSalon:role==='customer'?null:{id:salon,status:'active',account_id:accountId},currentStaffSalon:role==='staff'?{id:salon}:null,currentAccount:role==='customer'?null:{id:accountId,status:'active'},currentWorkspace:{id:role==='staff'?'staff:'+salon:role+'-workspace',type:role==='customer'?'personal':'salon',salonMode:role==='staff'?'staff':role==='owner'?'manage':null,salonId:role==='customer'?null:salon,accountId:role==='customer'?null:accountId},defaultRouteForCurrentContext:role==='owner'?'/staff/today':role==='staff'?'/staff/my-work':'/explore',activeRole:{code:role},accountId:role==='customer'?null:accountId,permissionCodes:[],permissions:[],workspaceType:role==='customer'?'personal':'salon'});
 const experience=load('lib/experience-context.ts',{'server-only':{},'node:crypto':crypto});
 const nextHeaders={headers:async()=>new Headers(),cookies:async()=>({get:()=>undefined})};
 const request={getRequestBusinessContext:async()=>business(options.serverRole||'customer')};
 const current={isSalonManageContext:value=>value.salonMode==='manage',getCurrentStaffBusinessContext:async()=>business('staff')};
 const identity={getStaffPortalIdentity:async context=>({context:context||business('staff'),staff:{id:staffId,salon_id:salon}})};
 const scope={runWithReadContext:read=>read()},bounded={runReadWithDeadline:promise=>promise};
 const offline=load('app/api/experience/offline-context/route.ts',{'node:crypto':crypto,'next/headers':nextHeaders,'next/server':{connection:async()=>{}},'@/lib/request-business-context':request,'@/lib/experience-context':experience,'@/lib/staff-portal-identity':identity,'@/lib/supabase/server':{},'@/lib/current-context':current,'@/lib/staff-workdays':{getCurrentStaffForSalon:async()=>({id:staffId,salon_id:salon})},'@/lib/staff-account':{},'@/lib/experience-offline-policy':policy,'@/lib/bounded-get':bounded,'@/lib/staff-offline-binding-server':{getStaffOfflineBindingAuthorization:async()=>options.bindingState==='approved'?{state:'approved',binding:{version:1,staffId,viewerId:viewer,salonId:salon,revision:'00000000-0000-4000-8000-000000000004',approvedAt:'2026-10-01T00:00:00Z'}}:options.bindingState==='revoked'?{state:'revoked',binding:null}:{state:'unconfirmed',binding:null}},'@/lib/read-context-scope':scope});
 const online=load('lib/staff-online-access-server.ts',{'server-only':{},'@/lib/experience-context':experience,'@/lib/bounded-get':bounded,'@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>({rpc:async(name,args)=>{assert.equal(name,'get_my_staff_online_access');assert.deepEqual(args,{p_staff_id:staffId,p_salon_id:salon,p_account_id:accountId});const value={version:1,state:options.bindingState==='missing'?'missing':options.bindingState==='binding-present'?'binding-present':'denied',staffId,viewerId:viewer,salonId:salon,accountId};if(options.bindingState==='wrong-viewer'){value.state='missing';value.viewerId='00000000-0000-4000-8000-000000000007';}return{data:options.bindingState==='malformed'?[value]:value,error:options.bindingState==='timeout'?{code:'57014'}:null};}})}});
 const timing={measure:async(_name,read)=>read(),measureSync:(_name,read)=>read(),finish:response=>response};
 return load('app/api/app-local/context/route.ts',{'next/headers':nextHeaders,'next/server':{connection:async()=>{}},'@/lib/request-business-context':request,'@/lib/experience-context':experience,'@/lib/experience-offline-policy':policy,'@/app/api/experience/offline-context/route':offline,'@/lib/staff-portal-identity':identity,'@/lib/current-context':current,'@/lib/staff-online-access-server':online,'@/lib/app-local-portable-context-server':{readAppLocalPortableContext:async()=>null},'@/lib/app-local-display-server':{readAppLocalDisplayContext:async()=>null},'@/lib/read-context-scope':scope,'@/lib/read-request-trace-protocol':load('lib/read-request-trace-protocol.ts',{'./app-local-command-trace-protocol':load('lib/app-local-command-trace-protocol.ts')}),'@/lib/read-request-timing':{createReadRequestTiming:()=>timing}}).GET;
}

const entry = process.env.TEST_ENTRY_BASELINE ? execFileSync('git', ['show', (process.env.TEST_ENTRY_BASELINE === '39' ? '62f22d20c5fe9e048a679f9ba6c648d2115cd632' : '1c2628c4df2069de0722874ce8972231945e7146') + ':app/local-app/entry.tsx'], { encoding: 'utf8' }) : readFileSync('app/local-app/entry.tsx', 'utf8');
const parsed = ts.createSourceFile('entry.tsx', entry, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), imports = new Map();
const real = ['react', 'react-dom/client', '@/lib/app-local-context-recovery', '@/lib/app-local-page-admission', '@/lib/experience-offline-policy', '@/lib/read-request-trace-protocol'];
for (const item of parsed.statements) {
  if (!ts.isImportDeclaration(item) || real.includes(item.moduleSpecifier.text)) continue;
  imports.set(item.moduleSpecifier.text, item.importClause?.namedBindings?.elements?.map(x => x.propertyName?.text ?? x.name.text) ?? []);
}
const replacements = {
  '@/lib/app-local-host': `export const getAppLocalHost=()=>window.fixtureHost;export const appLocalRequestId=()=>crypto.randomUUID();export function appLocalPath(value){if(!value.startsWith('/')||value.startsWith('//')||/[\\\\\\u0000-\\u001f]/.test(value))throw Error('Invalid route');const u=new URL(value,'https://reylumi.com');if(u.origin!=='https://reylumi.com')throw Error('Invalid origin');return u.pathname+u.search+u.hash;}`,
  '@/lib/app-local-command-client': `let scope;export const getAppLocalCommandScope=()=>scope;export const setAppLocalCommandScope=value=>scope=value;`,
  '@/lib/app-local-page-registry': `import React from'react';import{useExperienceScope}from'@/components/experience-scope';function Page({context,path}){const gate=useExperienceScope();React.useEffect(()=>{window.fixtureStats.rendered.push({path,role:context?.display.role});},[path,context]);return <main data-private-page data-path={path} data-scope={context?.context.scope} data-role={context?.display.role}>{path} {context?.display.role}<input aria-label='Draft' defaultValue='retained'/><button onClick={()=>gate.validate(true).then(value=>window.fixtureStats.validations.push(value))}>Validate current authority</button></main>;}export const getAppLocalPage=p=>['/staff/today','/staff/my-work','/staff/workday','/staff/appointments','/settings','/my-place','/salon-profile','/explore','/market'].includes(p)?{id:p,title:'Workspace',requiresContext:!['/explore','/market'].includes(p),Component:Page}:null;`,
  '@/components/app-local-shell': `import React from'react';export function AppLocalShell({context,children,checkContext}){window.fixtureMinuteCheck=checkContext;return <>{context?<nav data-role-nav={context.display.role}/>:<header data-opening/>}{children}</>;}`,
  './navigation': `export function AppLocalNavigationProvider({children}){return children;}`,
  './scope': `export function ExperienceScopeProvider({children}){return children;}`,
  '@/lib/app-local-scope-id': `export const isAppLocalScopeId=v=>/^v3:[a-f0-9]{64}$/.test(v);export const isAppLocalPortableScopeId=()=>false;`,
  '@/lib/legal-policies': `export const legalDocuments={};`,
  '@/lib/app-local-resource': `export {rememberAppLocalRoleResources,reconcileAppLocalRoleResources,clearAppLocalRoleResources,invalidateAppLocalRoleResources} from './lib/app-local-resource';export const resetAppLocalResources=()=>{};export const useAppLocalResource=()=>({loading:false,refreshing:false,refresh:async()=>{}});`,
  '@/lib/app-local-reference-content': `export const APP_LOCAL_REFERENCE_ASSETS=[];`,
  '@/lib/app-local-secondary-registry': `export const getAppLocalSecondaryPage=p=>p==='/'?{id:'root',title:'Root',requiresContext:true,Component:()=>null}:null;export const appLocalRouteAlias=()=>null;`,
};
let compiled;
async function compile() {
  compiled ??= build({ stdin: { contents: entry+`\nimport{navigateToWorkspace}from'./lib/app-local-shell-workspace-navigation';window.fixtureSwitchRole='staff';window.fixtureSwitchStaff=()=>navigateToWorkspace('staff-workspace');window.fixtureSwitch=role=>{window.fixtureSwitchRole=role;navigateToWorkspace(role+'-workspace');};`, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, alias: { '@': process.cwd() }, plugins: [{ name: 'admission-boundaries', setup(b) {
    if (process.env.TEST_ENTRY_BASELINE === '39') b.onLoad({ filter: /[\\/]lib[\\/](?:app-local-context-recovery|app-local-page-admission)\.ts$/ }, args => ({ contents: execFileSync('git', ['show', '62f22d20c5fe9e048a679f9ba6c648d2115cd632:lib/' + args.path.split(/[\\/]/).at(-1)], { encoding: 'utf8' }), loader: 'ts', resolveDir: process.cwd() + '/lib' }));
    b.onResolve({filter:/^\.\/app-local-host$/},()=>({path:'@/lib/app-local-host',namespace:'fixture'}));b.onResolve({filter:/^\.\/app-local-command-client$/},()=>({path:'@/lib/app-local-command-client',namespace:'fixture'}));
    b.onResolve({filter:/^(?:\.\/scope|@\/components\/experience-scope)$/},()=>({path:process.cwd()+'/app/local-app/scope.tsx'}));b.onResolve({filter:/^@\/components\/offline-network-form-guard$/},()=>({path:'form-guard',namespace:'fixture'}));
    for (const [path] of imports) if(path!=='./scope') b.onResolve({ filter: new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path==='form-guard'?'export const OfflineNetworkFormGuard=()=>null;':replacements[path] ?? (imports.get(path) ?? []).map(name => `export const ${name}=${name.startsWith('getAppLocal') ? '()=>null' : ['clearExperienceSnapshots', 'acceptExperienceOfflineGrant'].includes(name) ? 'async()=>{}' : name.startsWith('install') ? '()=>()=>{}' : '()=>null'};`).join('\n'), loader: 'tsx', resolveDir: process.cwd() }));
  } }] });
  return compiled;
}
async function fixture(options = {}) {
  const built = await compile(), handler = contextHandler(options), calls = [], envelopes=[];
  const cached = options.cachedOwner ? await (await contextHandler({ role: 'owner' })(new Request('https://reylumi.com/api/app-local/context?' + new URLSearchParams({ path: '/staff/today', generation })))).json() : null;
  const setup = `
    window.fixtureStats={rendered:[],commands:0,contextRequests:[],hosted:[],diagnosticExports:[],validations:[]};
    window.fixtureHoldNext=false;window.fixtureHeld=[];window.fixtureOffline=false;Object.defineProperty(navigator,'onLine',{get:()=>!window.fixtureOffline});window.fixtureOptions=${JSON.stringify(options)};
    window.fixtureCached=${JSON.stringify(cached)};
    window.__reylumiAppLocalContext={generation:'${generation}',scopeEpoch:1,nonce:'fixture'};
    if(window.fixtureOptions.diagnostics)window.__reylumiExportDiagnostics=(...args)=>window.fixtureStats.diagnosticExports.push(args.length);
    window.fixtureNavigate=path=>window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path}}));
    const read=async(path,signal)=>{
      const r=await fetch('/fixture-context?'+new URLSearchParams({path,generation:'${generation}'}),{signal});
      if(!r.ok)throw Object.assign(Error('Fixture denied'),{status:r.status});
      return {...await r.json(),offline:false};
    };
    window.fixtureHost={isNative:true,cache:async()=>null,
      command:async(name)=>{if(name!=='shell.switch-workspace')throw Error('Synthetic command forbidden');window.fixtureStats.commands++;const response=await fetch('/fixture-select-staff?role='+window.fixtureSwitchRole);if(!response.ok)throw Error('Synthetic switch failed');return response.json();},
      openOnline:async path=>{window.fixtureStats.hosted.push(path);if(window.fixtureOptions.hostedUnavailable)throw Error('Synthetic secure handoff unavailable');},
      context:async(path,options)=>{
        window.fixtureStats.contextRequests.push({path,fresh:Boolean(options.fresh)});if(window.fixtureOffline)throw Object.assign(Error('Synthetic offline'),{status:-1009});
        if(window.fixtureStats.contextRequests.length<=(window.fixtureOptions.cancelContextReads??0))throw Object.assign(Error('Discarded fixture response'),{name:'AbortError',status:-999,reason:'cancelled'});
        if(window.fixtureCached&&!options.fresh){
          const value=window.fixtureCached;window.fixtureCached=null;
          setTimeout(async()=>{
            const fresh=await read(path);window.__reylumiAppLocalContext.scopeEpoch++;
            window.dispatchEvent(new CustomEvent('reylumi:app-local-reset',{detail:{...window.__reylumiAppLocalContext,reason:'context'}}));
            window.dispatchEvent(new CustomEvent('reylumi:app-local-context',{detail:{...fresh,contextPath:path}}));
          },80);
          return {...value,offline:true};
        }
        const value=await read(path,options.signal);if(window.fixtureHoldNext){window.fixtureHoldNext=false;await new Promise(resolve=>window.fixtureHeld.push({resolve,value}));}window.dispatchEvent(new CustomEvent('reylumi:app-local-context',{detail:{...value,contextPath:path}}));return value;
      }
    };`;
  const server = createServer(async (req, res) => {
    try {
      if(req.url.startsWith('/fixture-select-staff')){options.serverRole=new URL(req.url,'http://fixture').searchParams.get('role')||'staff';res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({path:options.serverRole==='owner'?'/staff/today':options.serverRole==='customer'?'/my-place':'/staff/my-work'}));return;}
      if (req.url.startsWith('/fixture-context?')) {
        const url = new URL(req.url, 'https://reylumi.com'); calls.push(url.searchParams.get('path'));
        const response = await handler(new Request('https://reylumi.com/api/app-local/context?' + url.searchParams, { headers: options.protocolVersion === null ? {} : { 'X-Reylumi-Staff-Online-Access': options.protocolVersion ?? '1' } }));
        const body = await response.json();envelopes.push({path:url.searchParams.get('path'),transportStatus:response.status,grantStatus:body.grantStatus,offlineState:body.offlineState??null,hasGrant:Boolean(body.grant),grantKind:body.grant?.kind??null,staffWorkspace:Boolean(body.access?.staffWorkspace)});
        if (options.changeViewerAtRoot && url.searchParams.get('path') === '/') body.context.viewerId = 'other-viewer';
        if(options.patch)options.patch(body,url.searchParams.get('path'));if (options.explicitStatus) { body.grant = null; body.grantStatus = options.explicitStatus; }
        res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return;
      }
      res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
      res.end(req.url === '/app.js' ? built.outputFiles[0].text : '<div id="app"></div><script>' + setup + '</script><script src="/app.js"></script>');
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); server.unref();
  const browser = await (engine === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch({ executablePath: browserPath, headless: true }));
  const page = await browser.newPage(), errors = [];
  if (options.clockTime) { await page.clock.install({ time: options.clockTime }); await page.clock.pauseAt(options.clockTime); }
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + server.address().port + (options.start || '/staff/today'));
  return { page, calls, envelopes, state:options, setBindingState:state=>{options.bindingState=state;}, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}



const privateStaff=page=>page.locator('[data-private-page][data-path="/staff/my-work"][data-role="staff"]:visible');
const denied=page=>page.locator('[data-context-failure="verification"]');
async function personal(options={}){return fixture({role:'customer',serverRole:'customer',start:'/my-place',bindingState:'missing',...options});}
async function enterStaff(f){await f.page.locator('[data-private-page][data-path="/my-place"][data-role="customer"]:visible').waitFor();await f.page.evaluate(()=>window.fixtureSwitch('staff'));}
const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
test('genuinely missing binding opens Staff on first Personal switch with actual strict route and provider',{timeout:15000},async()=>{
 const f=await personal();try{await enterStaff(f);await privateStaff(f.page).waitFor({timeout:4000});assert.equal(f.envelopes.at(-1).offlineState,'online-only');assert.equal(f.envelopes.at(-1).grantStatus,503);assert.equal(f.envelopes.at(-1).hasGrant,false);await f.page.getByRole('button',{name:'Validate current authority',exact:true}).click();await f.page.waitForFunction(()=>window.fixtureStats.validations.length===1);assert.deepEqual(await f.page.evaluate(()=>window.fixtureStats.validations),[true]);assert.equal(await f.page.evaluate(()=>window.fixtureStats.commands),1);}finally{await f.close();}
});

test('missing or unsupported client capability cannot receive the new Staff online-only mode',{timeout:15000},async()=>{
 for(const protocolVersion of [null,'0','2']){const f=await personal({protocolVersion});try{await enterStaff(f);await denied(f.page).waitFor({timeout:4000});assert.equal(await privateStaff(f.page).count(),0);assert.equal(f.envelopes.some(value=>value.offlineState==='online-only'),false);}finally{await f.close();}}
});
test('unconfirmed manual retry issues fresh GET and only newly verified missing binding can admit Staff',{timeout:15000},async()=>{
 const f=await personal({bindingState:'binding-present'});try{await enterStaff(f);await denied(f.page).waitFor({timeout:4000});const before=f.calls.length;await f.page.getByRole('button',{name:'Try again',exact:true}).click();await f.page.waitForFunction(before=>window.fixtureStats.contextRequests.length>before,before);await denied(f.page).waitFor();assert.equal(await privateStaff(f.page).count(),0);f.setBindingState('missing');await f.page.getByRole('button',{name:'Try again',exact:true}).click();await privateStaff(f.page).waitFor();assert.equal(await f.page.evaluate(()=>window.fixtureStats.commands),1);}finally{await f.close();}
});
test('Staff missing-binding proof survives Explore/Post reentry, repeated roles and foreground validation',{timeout:25000},async()=>{
 const f=await personal();try{await enterStaff(f);await privateStaff(f.page).waitFor();for(const path of ['/explore','/salon-profile','/staff/my-work','/staff/appointments','/staff/workday','/staff/my-work']){await f.page.evaluate(path=>window.fixtureNavigate(path),path);await f.page.locator('[data-private-page][data-path="'+path+'"]:visible').waitFor();}await privateStaff(f.page).getByLabel('Draft').fill('kept draft');const count=f.calls.length;await f.page.evaluate(()=>window.dispatchEvent(new Event('reylumi:foreground')));await f.page.waitForFunction(count=>window.fixtureStats.contextRequests.length>count,count);await privateStaff(f.page).waitFor();assert.equal(await privateStaff(f.page).getByLabel('Draft').inputValue(),'kept draft');for(const role of ['customer','staff','owner','staff']){await f.page.evaluate(role=>window.fixtureSwitch(role),role);const path=role==='staff'?'/staff/my-work':role==='owner'?'/staff/today':'/my-place';await f.page.locator('[data-private-page][data-path="'+path+'"][data-role="'+role+'"]:visible').waitFor();}assert.equal(await f.page.locator('[data-context-failure]').count(),0);assert.equal(await f.page.evaluate(()=>window.fixtureStats.commands),5);}finally{await f.close();}
});
test('online-only Staff disconnect immediately withdraws private data and reconnect requires a new verified read',{timeout:15000},async()=>{
 const f=await personal();try{await enterStaff(f);await privateStaff(f.page).waitFor();await f.page.evaluate(()=>{window.fixtureOffline=true;window.dispatchEvent(new Event('offline'));});await privateStaff(f.page).waitFor({state:'hidden'});await f.page.locator('[data-context-failure]').waitFor();const before=f.calls.length;await f.page.evaluate(()=>{window.fixtureOffline=false;window.dispatchEvent(new Event('online'));});await privateStaff(f.page).waitFor();assert.ok(f.calls.length>before);assert.equal(await f.page.evaluate(()=>window.fixtureStats.commands),1);}finally{await f.close();}
});

test('fresh proof renewal keeps the warm Staff form mounted and advances its validity',{timeout:15000},async()=>{
 const options={clockTime:Date.now()+1000};options.patch=(body,path)=>{if(path==='/staff/my-work')body.onlineValidatedAt=options.clockTime;};
 const f=await personal(options);try{await enterStaff(f);await privateStaff(f.page).waitFor();await privateStaff(f.page).getByLabel('Draft').fill('kept during renewal');await f.page.evaluate(()=>{window.fixtureOriginalInput=document.querySelector('[data-private-page][data-path="/staff/my-work"] input');});const before=f.calls.length,rendered=await f.page.evaluate(()=>window.fixtureStats.rendered.length);options.clockTime+=21000;await f.page.clock.fastForward(21000);await f.page.waitForFunction(before=>window.fixtureStats.contextRequests.length>before,before);await privateStaff(f.page).waitFor();await f.page.waitForFunction(rendered=>window.fixtureStats.rendered.length>rendered,rendered);await f.page.clock.fastForward(11000);await privateStaff(f.page).waitFor();assert.equal(await privateStaff(f.page).getByLabel('Draft').inputValue(),'kept during renewal');assert.equal(await f.page.evaluate(()=>window.fixtureOriginalInput===document.querySelector('[data-private-page][data-path="/staff/my-work"] input')),true);}finally{await f.close();}
});

test('an unsettled renewal cannot extend the thirty-second online-only proof',{timeout:15000},async()=>{
 const options={clockTime:Date.now()+1000};options.patch=(body,path)=>{if(path==='/staff/my-work')body.onlineValidatedAt=options.clockTime;};
 const f=await personal(options);try{await enterStaff(f);await privateStaff(f.page).waitFor();await f.page.waitForFunction(()=>window.fixtureStats.rendered.some(value=>value.path==='/staff/my-work'&&value.role==='staff'));await f.page.evaluate(()=>{window.fixtureHoldNext=true;});await f.page.clock.fastForward(21000);await f.page.waitForFunction(()=>window.fixtureHeld.length===1);await f.page.evaluate(()=>{window.fixtureHoldNext=true;});await f.page.clock.fastForward(10000);await privateStaff(f.page).waitFor({state:'hidden',timeout:4000});assert.equal(await privateStaff(f.page).count(),0);}finally{await f.close();}
});

test('a malformed online-only marker withdraws a previously approved offline Staff lease',{timeout:15000},async()=>{
 const options={bindingState:'approved',patch:(body,path)=>{if(options.corrupt&&path==='/staff/my-work')delete body.staffOnlineAccess;}};
 const f=await personal(options);try{await enterStaff(f);await privateStaff(f.page).waitFor();assert.equal(f.envelopes.at(-1).hasGrant,true);f.setBindingState('missing');options.corrupt=true;await f.page.evaluate(()=>window.dispatchEvent(new Event('reylumi:foreground')));await denied(f.page).waitFor();assert.equal(await privateStaff(f.page).count(),0);}finally{await f.close();}
});
test('same-scope conflict rejects a held pre-conflict proof until one post-conflict Staff read settles',{timeout:15000},async()=>{
 const f=await personal();try{await enterStaff(f);await privateStaff(f.page).waitFor();const scope=await f.page.locator('[data-private-page]:visible').getAttribute('data-scope');await f.page.evaluate(()=>{window.fixtureHoldNext=true;window.dispatchEvent(new Event('reylumi:foreground'));});await f.page.waitForFunction(()=>window.fixtureHeld.length===1);await f.page.evaluate(scope=>window.dispatchEvent(new CustomEvent('reylumi:app-local-scope-conflict',{detail:{scope,status:409}})),scope);await privateStaff(f.page).waitFor({state:'hidden'});const before=f.calls.length;await f.page.evaluate(()=>{window.fixtureHoldNext=true;window.fixtureHeld.shift().resolve();});await f.page.waitForFunction(before=>window.fixtureStats.contextRequests.length>before&&window.fixtureHeld.length===1,before);assert.equal(await privateStaff(f.page).count(),0);await f.page.evaluate(()=>window.fixtureHeld.shift().resolve());await privateStaff(f.page).waitFor();}finally{await f.close();}
});
test('late old Staff proof cannot replace a newly selected Personal workspace',{timeout:15000},async()=>{
 const f=await personal();try{await enterStaff(f);await privateStaff(f.page).waitFor();await f.page.evaluate(()=>{window.fixtureHoldNext=true;window.dispatchEvent(new Event('reylumi:foreground'));});await f.page.waitForFunction(()=>window.fixtureHeld.length===1);await f.page.evaluate(()=>window.fixtureSwitch('customer'));await f.page.locator('[data-private-page][data-path="/my-place"][data-role="customer"]:visible').waitFor();await f.page.evaluate(()=>window.fixtureHeld.shift().resolve());await settle(f.page);assert.equal(await privateStaff(f.page).count(),0);assert.equal(await f.page.locator('[data-private-page][data-role="customer"]:visible').count(),1);}finally{await f.close();}
});
test('revoked, existing, denied, mismatched, malformed and unavailable proof lookups preserve denial',{timeout:40000},async()=>{
 for(const bindingState of ['revoked','binding-present','denied','wrong-viewer','malformed','timeout']){const f=await personal({bindingState});try{await enterStaff(f);await f.page.locator('[data-context-failure]').waitFor();assert.equal(await privateStaff(f.page).count(),0,bindingState);assert.equal(f.envelopes.some(value=>value.offlineState==='online-only'),false,bindingState);}finally{await f.close();}}
});
test('explicit auth/permission/scope denial wins over online-only and Staff does not render Owner Today',{timeout:25000},async()=>{
 for(const explicitStatus of [401,403,409]){const f=await personal({patch:(body,path)=>{if(path==='/staff/my-work')body.grantStatus=explicitStatus;}});try{await enterStaff(f);await f.page.locator('[data-context-failure]').waitFor();assert.equal(await privateStaff(f.page).count(),0);}finally{await f.close();}}
 const f=await personal();try{await enterStaff(f);await privateStaff(f.page).waitFor();await f.page.evaluate(()=>window.fixtureNavigate('/staff/today'));await f.page.waitForFunction(()=>window.fixtureStats.contextRequests.some(call=>call.path==='/staff/today'));await settle(f.page);assert.equal(await f.page.locator('[data-private-page][data-path="/staff/today"]:visible').count(),0);}finally{await f.close();}
});
