import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath=process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip=!existsSync(browserPath),staffA='11111111-1111-4111-8111-111111111111',staffB='22222222-2222-4222-8222-222222222222';
const today=new Date().toISOString().slice(0,10);
let compiled;
async function fixture(){
 compiled??=build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from'react';import{createRoot}from'react-dom/client';
  import{OwnerWorkspaceFrame}from'./app/pos/owner-workspace-frame';import{OwnerLocalPanelsOutlet}from'./app/pos/owner-local-panels';
  import{OwnerPosClient}from'./app/pos/owner-pos-client';import{OwnerReferenceSeed}from'./app/pos/owner-local-workspace';
  import*as saved from'./lib/experience-persistent-cache';import*as resource from'./lib/app-local-resource';
  window.api={...saved,...resource};window.rscRequests=[];window.attendanceCalls=[];window.attendanceReplies=[];
  const reference=window.REFERENCE,owner={scope:'scope-owner-a',ownerScope:reference.ownerScope,salonId:reference.salonId};
  const attendanceAction=input=>{window.attendanceCalls.push(input);return new Promise(resolve=>window.attendanceReplies.push(resolve))};
  const originalFetch=window.fetch.bind(window);window.fetch=(input,init)=>originalFetch(input,window.ignoreReadAbort&&String(input).startsWith('/api/app-local/read')?{...init,signal:undefined}:init);
  async function start(){const issuedAt=Date.now();await saved.acceptExperienceOfflineGrant({version:1,scope:owner.scope,scopes:[owner.scope],viewerId:'viewer-a',workspaceId:'salon-a',salonId:'salon-a',grantRevision:'grant-a',generation:saved.getExperienceDeviceGeneration(),issuedAt,expiresAt:issuedAt+86400000,path:'/pos',kind:'owner'});
   createRoot(document.getElementById('root')).render(<OwnerWorkspaceFrame owner={owner} localPanels={<OwnerLocalPanelsOutlet scope={owner.scope} salonId={owner.salonId} attendanceAction={attendanceAction}/>} checkout={<><OwnerReferenceSeed data={reference} updatedAt={Date.now()-60000}/><OwnerPosClient scope={owner.ownerScope} salonId={owner.salonId} salonName={reference.salonName} initial={reference} preferences={reference.preferences}/></>}><p data-server-outlet>Server route children must not become a cached panel</p></OwnerWorkspaceFrame>);
  }start();
 `},bundle:true,write:false,format:'iife',jsx:'automatic',platform:'browser',alias:{'@':process.cwd()},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'authorized-local-owner-fixture',setup(b){
  const files={
   'next/navigation':`import{useSyncExternalStore}from'react';const event='fixture:navigate',original=history.pushState;history.pushState=function(...args){original.apply(history,args);window.dispatchEvent(new Event(event))};function subscribe(fn){window.addEventListener(event,fn);window.addEventListener('popstate',fn);return()=>{window.removeEventListener(event,fn);window.removeEventListener('popstate',fn)}}export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname);export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push(href){window.rscRequests.push(href)},replace(href){window.rscRequests.push(href)},refresh(){window.rscRequests.push('refresh')}});`,
   'next/link':`export default function Link({prefetch,onNavigate,...props}){return <a {...props}/>}`,
   'next/image':`export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>}`,
   'next/form':`export default function Form({replace,scroll,prefetch,...props}){return <form {...props}/>}`,
   '@/components/workspace-language':`export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='span',text,...props})=><Tag {...props}>{text}</Tag>;export const useWorkspaceTranslation=()=>x=>x;`,
   '@/components/experience-scope':`export const useExperienceScope=()=>null;`,
   '@/lib/supabase/browser':`export const createSupabaseBrowserClient=()=>null;`,
   '@/components/role-more-content':`export const RoleMoreContent=()=>null;`,
   '@/app/service-relay/desk-relay':`export const DeskRelay=()=>null;`,
   '@/app/bookings/owner-live-booking-workspace':`export function OwnerLiveBookingWorkspace(){throw Error('No Book DTO requested in this fixture')}`,
   '@/app/reports/owner-live-reports':`export function OwnerLiveReports(){throw Error('No Report DTO requested in this fixture')}`,
  };
  b.onResolve({filter:/.*/},args=>{
   if(/(?:^|\/)supabase\/browser$/.test(args.path))return{path:'@/lib/supabase/browser',namespace:'fixture'};
   if(/(?:^|\/)workspace-language$/.test(args.path))return{path:'@/components/workspace-language',namespace:'fixture'};
   if(args.path in files)return{path:args.path,namespace:'fixture'};
   if(args.path.endsWith('.css'))return{path:args.path,namespace:'css'};
   if(!args.path.startsWith('@/')&&!args.path.startsWith('.'))return;
   const base=args.path.startsWith('@/')?path.resolve(args.path.slice(2)):path.resolve(path.dirname(args.importer),args.path);
   const target=['.ts','.tsx'].map(ext=>base+ext).find(existsSync);
   if(target&&/^\s*["']use server["']/.test(readFileSync(target,'utf8')))return{path:target,namespace:'action'};
  });
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:files[a.path]}));
  b.onLoad({filter:/.*/,namespace:'css'},()=>({loader:'js',contents:'export default new Proxy({},{get:(_,key)=>key})'}));
  b.onLoad({filter:/.*/,namespace:'action'},a=>({loader:'js',contents:[...readFileSync(a.path,'utf8').matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(([,name])=>`export async function ${name}(){throw Error('Unexpected original command in read-only fixture: ${name}')}`).join('\n')}));
 }}]});
 const bundle=(await compiled).outputFiles[0].text;
 const defaults={staffCheckInEnabled:false,largeTurnThreshold:25,tipSuggestions:[10,15,20,25]};
 const reference={ownerScope:'owner:salon-a:viewer-a',salonId:'salon-a',salonName:'Salon A',timezone:'UTC',today,defaults,preferences:{showStaff:true,showServices:true,showCustomer:true,showTip:true,showDiscount:true},services:[],staff:[{id:staffA,display_name:'Anna',job_title:'Artist',is_active:true,avatar_url:null,today_status:'working',check_in_at:today+'T09:00:00Z',check_in_sequence:1,turns:{queueTurns:2,largeTurns:2,smallTurns:0,totalTurns:2,receiptLargeTurns:2}}]};
 const roster={salonId:'salon-a',salonName:'Salon A',salonLogoUrl:null,timezone:'UTC',today,checkInEnabled:true,staff:[{id:staffA,displayName:'Anna',jobTitle:'Artist',avatarUrl:null,status:'working',checkInAt:today+'T09:00:00Z',checkInSequence:1,queueTurnCount:2,isPasscodeDefault:false},{id:staffB,displayName:'Binh',jobTitle:'Artist',avatarUrl:null,status:'not_checked_in',checkInAt:null,checkInSequence:null,queueTurnCount:0,isPasscodeDefault:false}]};
 const state={requests:[],held:[],hold:false,version:1,bodyBytes:[],writes:[]};
 const server=createServer((request,response)=>{
  const url=new URL(request.url,'http://local');
  if(request.method!=='GET'){state.writes.push(request.url);response.writeHead(405);response.end();return;}
  if(url.pathname==='/fixture.js'){response.setHeader('Content-Type','application/javascript');response.end(bundle);return;}
  if(url.pathname==='/api/app-local/read'){
   const name=url.searchParams.get('name'),scope=url.searchParams.get('scope'),args=JSON.parse(url.searchParams.get('args')||'{}');state.requests.push({name,scope,args,etag:request.headers['if-none-match']});
   if(scope!=='scope-owner-a'){response.writeHead(409);response.end();return;}
   if(state.hold){state.held.push({response,name,args,roster:structuredClone(roster),reference:structuredClone(reference)});return;}
   const data=name==='owner.workspace'?{view:'workspace',props:reference}:name==='owner.check-in'?{view:'check-in',props:{data:roster}}:name==='owner.tickets'?{view:'tickets',props:{salonId:'salon-a',initialTickets:[],bounds:{openedFrom:today+'T00:00:00Z',openedTo:today+'T23:59:59Z'},searchQuery:'',canApplyFinancialCorrection:false,canEdit:false,isBusinessDateLocked:false,returnTo:'/pos/ticket',selectedDate:today,today,selectedDateLabel:'Today',selectedDateCompactLabel:'Today',services:[],staff:[]}}:{view:'denied',message:'This read-only fixture has no '+name+' permission'};
   const etag='"'+name+'-'+state.version+'"';
   if(request.headers['if-none-match']===etag){response.writeHead(304,{ETag:etag,'x-reylumi-scope':scope});response.end();state.bodyBytes.push(0);return;}
   const text=JSON.stringify({schemaVersion:1,status:200,scope,etag,updatedAt:Date.now()-60000,data});response.setHeader('Content-Type','application/json');response.end(text);state.bodyBytes.push(Buffer.byteLength(text));return;
  }
  if(url.pathname.startsWith('/api/')){response.writeHead(503);response.end('{}');return;}
  response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><style>[hidden]{display:none!important}body{font:14px system-ui;margin:0}button,input{min-height:32px}'+readFileSync('app/pos/owner-pos.css','utf8')+'</style></head><body><div id="root"></div><script>window.REFERENCE='+JSON.stringify(reference)+'</script><script src="/fixture.js"></script></body></html>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const profile=mkdtempSync(path.join(tmpdir(),'reylumi-owner-local-')),origin='http://127.0.0.1:'+server.address().port;
 let browser;
 async function launch(){browser=await chromium.launchPersistentContext(profile,{executablePath:browserPath,headless:true,args:['--no-proxy-server'],viewport:{width:390,height:844}});const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{window.addEventListener('error',event=>window.fixtureError=event.message);window.addEventListener('unhandledrejection',event=>window.fixtureError=String(event.reason))});await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin+'/pos');await page.waitForFunction(()=>document.querySelector('.owner-top-nav')||window.fixtureError);const error=await page.evaluate(()=>window.fixtureError);if(error)throw Error(error);return{page,errors};}
 return{state,reference,roster,origin,launch,async restart(){await browser.close();return launch()},async close(){for(const row of state.held)row.response.destroy();await browser?.close();await new Promise(resolve=>server.close(resolve));assert(path.resolve(profile).startsWith(path.resolve(tmpdir())+path.sep));rmSync(profile,{recursive:true,force:true});}};
}
const tab=(page,name)=>page.locator('.owner-top-nav:visible').getByRole('link',{name,exact:true});

test('local owner tabs keep actual checkout/Check-in DOM usable before held reads; PIN action remains one explicit call', {skip,timeout:90000},async t=>{
 const app=await fixture();try{
  const {page,errors}=await app.launch();await page.locator('input[aria-label="Amount"]').first().waitFor();await page.locator('input[aria-label="Amount"]').first().fill('125.75');
  assert.equal(app.state.requests.some(row=>['owner.reports','owner.bookings'].includes(row.name)),false,'Unvisited heavy workspaces do not compete with first POS paint');
  await tab(page,'Check In').click();await page.getByRole('button',{name:/Binh/}).waitFor();await tab(page,'POS').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-owner-local-panel="/pos/check-in"] button')].some(node=>node.textContent.includes('Anna')));
  await page.evaluate(()=>{window.moneyInput=document.querySelector('[aria-label="Amount"]');window.staffButton=[...document.querySelectorAll('[data-owner-local-panel="/pos/check-in"] button')].find(node=>node.textContent.includes('Binh'))});
  app.state.hold=true;await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:foreground')));await page.waitForFunction(()=>document.querySelector('[aria-label="Amount"]')?.value==='125.75');
  const started=Date.now();await tab(page,'Check In').click();await page.getByRole('button',{name:/Binh/}).waitFor();
  assert.equal(await page.evaluate(()=>window.rscRequests.length),0);assert.equal(await page.locator('[data-pos-tab-placeholder]').count(),0);
  await page.getByRole('button',{name:/Binh/}).click();for(const digit of['1','2','3','4'])await page.getByRole('button',{name:digit,exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();
  await page.waitForFunction(()=>window.attendanceCalls.length===1);assert.equal(await page.getByRole('button',{name:/Binh/}).isVisible(),true);
  await tab(page,'POS').click();assert.equal(await page.locator('input[aria-label="Amount"]').first().inputValue(),'125.75');assert.equal(await page.evaluate(()=>window.moneyInput===document.querySelector('[aria-label="Amount"]')),true);
  await tab(page,'Check In').click();assert.equal(await page.evaluate(()=>window.staffButton===[...document.querySelectorAll('[data-owner-local-panel="/pos/check-in"] button')].find(node=>node.textContent.includes('Binh'))),true);
  await page.evaluate(({staffB,today})=>window.attendanceReplies.shift()({ok:true,data:{staffId:staffB,today,status:'working',checkInSequence:2,queueTurnCount:1,isPasscodeDefault:false}}),{staffB,today});
  await page.getByText(/saved for Binh/).waitFor();assert.equal(app.state.held.length>0,true);assert.equal(await page.evaluate(()=>window.attendanceCalls[0].passcode),'1234');
  assert.equal(app.state.writes.length,0);assert.deepEqual(errors,[]);t.diagnostic(JSON.stringify({switchAndExplicitActionMs:Date.now()-started,heldReads:app.state.held.length,environment:'Local Chromium controlled authorized owner fixture; not iPhone timing'}));
 }finally{await app.close();}
});

test('same-account durable Check-in data survives process restart while fresh reads are held and keeps money draft', {skip,timeout:90000},async t=>{
 const app=await fixture();try{
  let {page}=await app.launch();await page.locator('input[aria-label="Amount"]').first().fill('77.25');await tab(page,'Check In').click();await page.getByRole('button',{name:/Binh/}).waitFor();
  await page.waitForFunction(async()=>{const value=await window.api.readExperienceSnapshot({scope:'scope-owner-a',domain:'owner-check-in',params:{query:''}});return value?.data?.view==='check-in'});
  app.state.hold=true;const started=Date.now();({page}=await app.restart());await page.locator('input[aria-label="Amount"]').first().waitFor();await tab(page,'Check In').click();await page.getByRole('button',{name:/Binh/}).waitFor();
  assert.equal(await page.evaluate(()=>window.rscRequests.length),0);await tab(page,'POS').click();assert.equal(await page.locator('input[aria-label="Amount"]').first().inputValue(),'77.25');
  assert(app.state.held.length>0);assert.equal(app.state.writes.length,0);t.diagnostic(JSON.stringify({cachedColdToRosterMs:Date.now()-started,environment:'Local Chromium restarted persistent profile with held GETs; not physical device'}));
 }finally{await app.close();}
});

test('confirmed attendance invalidates an older held read and reconciles a later authoritative roster without replacing inputs', {skip,timeout:90000},async()=>{
 const app=await fixture();try{
  const{page,errors}=await app.launch();await page.locator('input[aria-label="Amount"]').first().fill('42.15');await tab(page,'Check In').click();await page.getByRole('button',{name:/Binh/}).waitFor();
  await page.evaluate(()=>window.ignoreReadAbort=true);app.state.hold=true;await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:foreground')));await page.waitForFunction(()=>document.querySelector('[data-owner-local-panel="/pos/check-in"]'));
  await new Promise(resolve=>{const wait=()=>app.state.held.some(row=>row.name==='owner.check-in')?resolve():setTimeout(wait,10);wait()});
  await page.getByRole('button',{name:/Binh/}).click();for(const digit of['1','2','3','4'])await page.getByRole('button',{name:digit,exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.waitForFunction(()=>window.attendanceCalls.length===1);
  await page.evaluate(({staffB,today})=>window.attendanceReplies.shift()({ok:true,data:{staffId:staffB,today,status:'working',checkInSequence:2,queueTurnCount:1,isPasscodeDefault:false}}),{staffB,today});await page.getByText(/saved for Binh/).waitFor();
  app.roster.staff[1]={...app.roster.staff[1],status:'break',checkInAt:today+'T10:00:00Z',checkInSequence:2};app.state.version=2;app.state.hold=false;
  const before=app.state.requests.filter(row=>row.name==='owner.check-in').length;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('reylumi:app-local-command-complete',{detail:{scope:'scope-owner-a'}})));
  for(const row of app.state.held.splice(0)){const data=row.name==='owner.check-in'?{view:'check-in',props:{data:row.roster}}:row.name==='owner.workspace'?{view:'workspace',props:row.reference}:{view:'denied',message:'Old read'};row.response.setHeader('Content-Type','application/json');row.response.end(JSON.stringify({schemaVersion:1,status:200,scope:'scope-owner-a',etag:'"old-held"',updatedAt:Date.now()+100000,data}));}
  await page.getByRole('button',{name:/Binh/}).filter({hasText:'On break'}).waitFor();assert(app.state.requests.filter(row=>row.name==='owner.check-in').length>before,'completion queues an authoritative read after the stale request');
  await tab(page,'POS').click();assert.equal(await page.locator('input[aria-label="Amount"]').first().inputValue(),'42.15');assert.equal(app.state.writes.length,0);assert.deepEqual(errors,[]);
 }finally{await app.close();}
});

test('previous-day cached reference retains catalog but never treats old attendance or turns as current', {skip,timeout:90000},async()=>{
 const app=await fixture();try{
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);app.reference.today=yesterday;app.roster.today=yesterday;app.roster.staff[0].checkInAt=yesterday+'T09:00:00Z';
  const{page,errors}=await app.launch();await tab(page,'Check In').click();const anna=page.getByRole('button',{name:/Anna/});await anna.waitFor();assert.match(await anna.innerText(),/Not checked in/);assert.doesNotMatch(await anna.innerText(),/Working/);
  await page.locator('input[aria-label="Amount"]').first().evaluate(node=>node.value='');await tab(page,'POS').click();await page.locator('input[aria-label="Amount"]').first().fill('19.25');assert.equal(app.state.writes.length,0);assert.deepEqual(errors,[]);
 }finally{await app.close();}
});
