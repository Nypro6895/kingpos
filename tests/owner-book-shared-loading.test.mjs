import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build, buildSync } from 'esbuild';
import { chromium } from 'playwright-core';
import ts from 'typescript';

// Actual OwnerPanel/cache/prefetch with synthetic host IO and a small body.
// This checks read ownership, not Book business rules or physical WebKit.
const browserPath=process.env.TEST_BROWSER_PATH??['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const options={skip:!browserPath,timeout:30_000},scopeA='v3:'+'a'.repeat(64),scopeB='v3:'+'b'.repeat(64);
const basePath='/pos/book?date=2026-11-18';
function definition(source,name){const ast=ts.createSourceFile('source.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node,name);return node.getText(ast);}
const panel=definition(readFileSync('app/pos/owner-local-panels.tsx','utf8'),'OwnerPanel');
const legacy=definition(execFileSync('git',['show','cf77926:lib/owner-local-workspace.ts'],{encoding:'utf8'}),'ownerLocalReadArgs').replace('function ownerLocalReadArgs(','function legacyOwnerLocalReadArgs(');
const mod={exports:{}};new Function('module','exports',buildSync({entryPoints:['lib/owner-local-workspace.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text)(mod,mod.exports);
const {ownerLocalReadArgs:args,ownerLocalReadArgsFromRecord:pick}=mod.exports;
test('only unique exact Book defaults share read identity; dates, filters and other panels keep their meaning',()=>{
  assert.deepEqual(args(basePath+'&tab=calendar&view=list&range=day'),args(basePath));
  for(const suffix of ['tab=settings','tab=availability','view=week','view=day','range=next7','range=all','range=month','staff=staff-a','bookingId=booking-a','request=request-a','error=notice'])assert.match(String(args(basePath+'&'+suffix).query),new RegExp(suffix));
  assert.notDeepEqual(args(basePath),args('/pos/book?date=2026-11-19'));
  for(const path of ['/pos/ticket','/pos/report','/pos/check-in','/pos'])assert.deepEqual(args(path+'?tab=calendar&view=list&range=day'),{query:'range=day&tab=calendar&view=list'});
  assert.deepEqual(args(basePath+'&tab=calendar&tab=settings'),{query:'date=2026-11-18&tab=calendar&tab=settings'});
  assert.deepEqual(pick('owner.bookings',{query:'view=list&date=2026-11-18',ids:['one']}),{query:'date=2026-11-18',ids:['one']});
  assert.deepEqual(pick('owner.bookings',{query:undefined,ids:['one']}),{query:undefined,ids:['one']});
});
function context(scope=scopeA){const now=Date.now(),identity={scope,viewerId:'00000000-0000-4000-8000-000000000001',salonId:'00000000-0000-4000-8000-000000000002',workspaceId:'book-fixture',permissionRevision:'r1',authenticated:true};return{schemaVersion:1,context:identity,onlineValidatedAt:now,display:{name:'Synthetic QA',role:'Owner',language:'en'},access:{ownerWorkspace:true,staffWorkspace:false},grant:{version:1,...identity,scopes:[scope],generation:'generation-0000000001',grantRevision:'r1',issuedAt:now-100,expiresAt:now+3_600_000,kind:'owner',path:'/pos/book'}};}
let browser,server,base;
before(async()=>{
  if(!browserPath)return;
  const bundle=await build({stdin:{loader:'tsx',resolveDir:resolve('.'),contents:`
    import React,{useState,useEffect,useLayoutEffect,useRef}from'react';import{createRoot}from'react-dom/client';
    import{useAppLocalResource,peekAppLocalResource,refreshAppLocalResource,resetAppLocalResources,seedAppLocalResource,invalidateAppLocalResource}from'./lib/app-local-resource';
    import{ownerLocalHref,ownerLocalReadName,ownerLocalReadArgs}from'./lib/owner-local-workspace';
    import{useAppLocalPrefetch}from'./lib/app-local-prefetch';
    import{appLocalPrefetchPlan}from'./lib/app-local-prefetch-plan';
    const h=window.h={reads:[],rules:[],pending:new Map(),caches:[],commands:[],serial:0};
    window.__reylumiAppLocalContext={generation:'generation-0000000001',scopeEpoch:1,nonce:'fixture'};
    const response=row=>({schemaVersion:1,status:200,scope:row.scope,etag:'r'+row.id,updatedAt:Date.now(),offline:false,data:{view:'bookings',props:{scope:row.scope,date:new URLSearchParams(row.args.query).get('date')??'default',version:row.id}}});
    window.holdRead=(extra={})=>h.rules.push({remaining:1,...extra});window.releaseRead=id=>{const p=h.pending.get(id);h.pending.delete(id);p.resolve(response(p.row));};
    window.host={isNative:true,read(name,args={},options={}){const row={id:++h.serial,name,args,scope:options.scope};h.reads.push(row);const rule=name==='owner.bookings'?h.rules.find(rule=>rule.remaining>0&&(!rule.scope||rule.scope===row.scope)):null;if(rule)rule.remaining--;return new Promise((resolve,reject)=>{const abort=()=>{if(!rule?.ignoreAbort)reject(new DOMException('cancelled','AbortError'));};options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();if(rule?.status)reject(Object.assign(new Error('Synthetic denial'),{status:rule.status}));else if(rule)h.pending.set(row.id,{row,resolve});else resolve(response(row));});},cache(operation,args){h.caches.push({operation,...args});return Promise.resolve(null);},command(){h.commands.push({});throw Error('No writes');},openOnline(){throw Error('No external navigation');}};
    const getAppLocalHost=()=>window.host,useOwnerLocalWorkspace=()=>null,usePosResourceRefresh=()=>{},WorkspaceText=({text})=>text,LumiLoadingStatus=()=> <p>Loading</p>;
    const OwnerLocalPanelBody=({data,query})=><section data-testid='book-content'><output>{data.props.scope+'|'+data.props.date+'|'+data.props.version}</output><p data-testid='presentation'>{query}</p><input data-testid='book-draft' aria-label='Synthetic retained booking draft' defaultValue=''/></section>;
    const BookingWorkspacePending=()=> <p data-testid='book-pending'>Loading Book</p>;
    ${legacy}
    ${panel}
    ${panel.replace('function OwnerPanel(','function LegacyOwnerPanel(').replace('args = ownerLocalReadArgs(href)','args = legacyOwnerLocalReadArgs(href)')}
    function Runtime({value,path}){useAppLocalPrefetch(value,path);return null;}
    function App(){const[cfg,set]=useState({value:null,path:${JSON.stringify(basePath)},runtime:false,legacy:false});const[paths,setPaths]=useState([${JSON.stringify(basePath)}]);window.configure=next=>set(old=>{const value={...old,...next};history.replaceState({},'',value.path);return value;});if(!paths.includes(cfg.path))setPaths([...paths,cfg.path]);window.refreshBook=()=>refreshAppLocalResource(cfg.value.context.scope,'owner.bookings',ownerLocalReadArgs(cfg.path));const Page=cfg.legacy?LegacyOwnerPanel:OwnerPanel;return <>{cfg.value&&paths.map(path=><React.Activity key={cfg.value.context.scope+':'+path} mode={path===cfg.path?'visible':'hidden'}><Page href={path} active={path===cfg.path} scope={cfg.value.context.scope} salonId={cfg.value.context.salonId} navigate={path=>window.configure({path})}/></React.Activity>)}{cfg.value&&cfg.runtime?<Runtime value={cfg.value} path={cfg.path}/>:null}</>;}
    window.peekBook=(scope,args)=>peekAppLocalResource(scope,'owner.bookings',args);window.bookArgs=ownerLocalReadArgs;window.resetReads=resetAppLocalResources;window.plan=appLocalPrefetchPlan;
    window.seedBook=(scope,args,stamp)=>seedAppLocalResource(scope,'owner.bookings',args,{schemaVersion:1,status:200,scope,etag:'bootstrap',updatedAt:stamp,offline:false,data:{view:'bookings',props:{scope,date:'2026-11-18',version:500}}});
    createRoot(document.getElementById('root')).render(<App/>);window.fixtureReady=true;
  `},bundle:true,write:false,format:'iife',jsx:'automatic',plugins:[{name:'book-host-boundaries',setup(b){b.onResolve({filter:/\/(app-local-host|experience-persistent-cache)$/},a=>({path:a.path.split('/').at(-1),namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='app-local-host'?'export const getAppLocalHost=()=>window.host;':'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};'}));}}]});
  server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({executablePath:browserPath,headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function fixture(t,cfg={},setup){const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{try{assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>h.commands.length),0);}finally{await page.close();}});await page.addInitScript(()=>{const now=Date.now;window.clockOffset=0;Date.now=()=>now()+window.clockOffset;});await page.goto(base);await page.waitForFunction(()=>window.fixtureReady);if(setup)await setup(page);await page.evaluate(cfg=>window.configure(cfg),{value:context(),...cfg});return page;}
const ready=(page,date='2026-11-18',scope=scopeA)=>page.locator('[data-testid=book-content]:visible').filter({has:page.locator('output').filter({hasText:scope+'|'+date+'|'})}).waitFor();
const reads=page=>page.evaluate(()=>h.reads.filter(row=>row.name==='owner.bookings'));
test('negative control: baseline default spelling rereads Book; current spelling and prefetch reuse one DTO',options,async t=>{
  for(const legacy of [true,false]){const page=await fixture(t,{legacy});await ready(page);await page.evaluate(path=>window.configure({path}),basePath+'&tab=calendar&view=list&range=day');await ready(page);assert.equal((await reads(page)).length,legacy?2:1);assert.match(await page.locator('[data-testid=presentation]:visible').textContent(),/tab=calendar/);if(!legacy){await page.evaluate(()=>window.configure({runtime:true}));await page.waitForTimeout(250);const selected=(await reads(page)).filter(row=>row.args.query===args(basePath).query);assert.equal(selected.length,1,'prefetch cannot repeat the selected exact-date read');assert.ok((await reads(page)).filter(row=>row.args.query!==args(basePath).query).every(row=>row.args.query===''),'the undated startup default is deliberately a separate read');const alias=await page.evaluate(value=>window.plan(value,'/bookings?date=2026-11-18&tab=calendar&view=list&range=day')[0].args,context());assert.deepEqual(alias,args(basePath));}}
});
test('held default and explicit default join once; retained draft DOM and timestamps survive return',options,async t=>{
  const page=await fixture(t,{},page=>page.evaluate(()=>window.holdRead()));await page.waitForFunction(()=>h.pending.size===1);await page.evaluate(path=>window.configure({path}),basePath+'&tab=calendar&view=list&range=day');assert.equal((await reads(page)).length,1);await page.evaluate(id=>window.releaseRead(id),(await reads(page))[0].id);await ready(page);
  const input=page.locator('[data-testid=book-draft]:visible');await input.fill('Unsaved synthetic booking');await input.evaluate(node=>window.originalDraft=node);const before=await page.evaluate(scope=>window.peekBook(scope,window.bookArgs(location.pathname+location.search)),scopeA);
  await page.evaluate(path=>window.configure({path}),basePath);await ready(page);await page.evaluate(path=>window.configure({path}),basePath+'&tab=calendar&view=list&range=day');await ready(page);assert.equal(await input.evaluate(node=>node===window.originalDraft),true);assert.equal(await input.inputValue(),'Unsaved synthetic booking');const after=await page.evaluate(scope=>window.peekBook(scope,window.bookArgs(location.pathname+location.search)),scopeA);assert.equal(after.updatedAt,before.updatedAt);assert.equal(after.verifiedAt,before.verifiedAt);
});
test('different dates and nondefault range/view/selected record filters keep separate reads',options,async t=>{
  const page=await fixture(t);await ready(page);const paths=['/pos/book?date=2026-11-19',basePath+'&view=week',basePath+'&range=next7',basePath+'&tab=availability',basePath+'&staff=staff-a',basePath+'&bookingId=booking-a'];
  for(const path of paths){await page.evaluate(path=>window.configure({path}),path);await ready(page,new URL(path,'https://reylumi.com').searchParams.get('date'));assert.deepEqual((await reads(page)).at(-1).args,args(path));}assert.equal((await reads(page)).length,1+paths.length);
});
test('Book reuse retains the original freshness deadline and denial withdraws every equivalent view',options,async t=>{
  const page=await fixture(t);await ready(page);const before=await page.evaluate(scope=>window.peekBook(scope,window.bookArgs(location.pathname+location.search)),scopeA);
  await page.evaluate(path=>{window.clockOffset=29_000;window.configure({path});},basePath+'&tab=calendar');await ready(page);assert.equal((await reads(page)).length,1);assert.equal(await page.evaluate(scope=>window.peekBook(scope,window.bookArgs(location.pathname+location.search)).verifiedAt,scopeA),before.verifiedAt);
  await page.evaluate(()=>{window.clockOffset=31_000;window.holdRead({status:403});window.dispatchEvent(new Event('focus'));});await page.waitForFunction(scope=>window.peekBook(scope,window.bookArgs(location.pathname+location.search))?.accessDenied===true,scopeA);assert.equal(await page.locator('[data-testid=book-content]:visible').count(),0);assert.equal((await reads(page)).length,2);
});
test('a reset rejects an old ignored-abort reply across scopes',options,async t=>{
  const page=await fixture(t,{},page=>page.evaluate(()=>window.holdRead({ignoreAbort:true})));await page.waitForFunction(()=>h.pending.size===1);const old=(await reads(page))[0];await page.evaluate(({scope,value,path})=>{window.resetReads(scope);window.configure({value,path});},{scope:scopeA,value:context(scopeB),path:basePath+'&tab=calendar'});await ready(page,'2026-11-18',scopeB);await page.evaluate(id=>window.releaseRead(id),old.id);await page.waitForTimeout(100);await ready(page,'2026-11-18',scopeB);assert.equal(await page.evaluate(({scope,args})=>window.peekBook(scope,args),{scope:scopeA,args:args(basePath)}),undefined);
});
test('accepted legacy Book bootstrap defaults reuse the canonical key without timestamp renewal',options,async t=>{
  let stamp;const page=await fixture(t,{path:basePath+'&tab=calendar&view=list&range=day'},async page=>{stamp=await page.evaluate(scope=>{const stamp=Date.now()-1000;window.seedBook(scope,{query:'date=2026-11-18&range=day&tab=calendar&view=list'},stamp);return stamp;},scopeA);});await ready(page);assert.equal((await reads(page)).length,0);const before=await page.evaluate(scope=>window.peekBook(scope,window.bookArgs(location.pathname+location.search)),scopeA);assert.equal(before.updatedAt,stamp);assert.equal(before.data.props.version,500);await page.evaluate(path=>window.configure({path}),basePath);await ready(page);const after=await page.evaluate(scope=>window.peekBook(scope,window.bookArgs(location.pathname+location.search)),scopeA);assert.equal(after.updatedAt,before.updatedAt);assert.equal(after.verifiedAt,before.verifiedAt);assert.equal((await reads(page)).length,0);
});
