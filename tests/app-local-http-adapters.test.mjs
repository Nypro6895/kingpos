import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

async function moduleFrom(file,fixtures){
 fixtures={'app-local-command-client':'export function getAppLocalCommandScope(){return undefined}',...fixtures};
 const bundle=await build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs',alias:{'@':process.cwd()},plugins:[{name:'local-http-fixture',setup(b){
  b.onResolve({filter:/.*/},args=>{
   if(args.path==='next/server')return{path:args.path,external:true};
   const key=Object.keys(fixtures).find(key=>args.path===key||args.path.endsWith('/'+key));return key?{path:key,namespace:'fixture'}:undefined;
  });
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:fixtures[args.path]}));
 }}]});
 const loaded={exports:{}};new Function('module','exports','require',bundle.outputFiles[0].text)(loaded,loaded.exports,createRequire(import.meta.url));return loaded.exports;
}
const wire=(status,body)=>({status,headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('native exact URL adapters preserve original read queries/status/body and leave web/foreign fetch untouched',async()=>{
 const api=await moduleFrom('lib/app-local-http-client.ts',{'app-local-host':'export function getAppLocalHost(){throw Error("Inject fixture host")}'});
 const reads=[],original=[],scope='v3:owner-a';let native=true;
 const host={get isNative(){return native},async read(name,args,options){reads.push({name,args,options});return{schemaVersion:1,status:200,scope,etag:'"version-a"',updatedAt:1,data:wire(409,{error:'scope changed'})}}};
 const fetch=api.createAppLocalHttpFetch({scope:()=>scope,host:()=>host,fetch:async(input,init)=>{original.push({input,init});return new Response('original',{status:202})}});
 const response=await fetch('/api/pos/owner/workspace?resource=staff&ownerScope=owner%3Asalon%3Aviewer&ids=11111111-1111-4111-8111-111111111111');
 assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'scope changed'});assert.equal(reads.length,1);assert.equal(reads[0].name,'owner.workspace-patch');assert.deepEqual(reads[0].args,{resource:'staff',ownerScope:'owner:salon:viewer',ids:'11111111-1111-4111-8111-111111111111'});
 await fetch('/api/pos/connection');assert.equal(reads[1].name,'app.connection');assert.deepEqual(reads[1].args,{});
 native=false;const controller=new AbortController(),init={method:'POST',body:'unchanged',signal:controller.signal};assert.equal((await fetch('/api/pos/owner/operations',init)).status,202);assert.equal(original[0].init,init);
 native=true;assert.equal((await fetch('https://foreign.test/api/pos/owner/operations',init)).status,202);assert.equal(reads.length,2);
 await assert.rejects(()=>fetch('/api/pos/owner/workspace?resource=staff&resource=catalog'),/Unsupported/);
 await assert.rejects(()=>fetch('/api/pos/connection?token=private'),/Unsupported/);
});

test('opaque native schemes compare their complete authority and never bridge protocol-relative foreign requests',async()=>{
 const api=await moduleFrom('lib/app-local-http-client.ts',{'app-local-host':'export function getAppLocalHost(){throw Error("Inject fixture host")}'});
 const previous=globalThis.location;globalThis.location={href:'reylumi-app://bundle/pos'};
 try {
  const reads=[],original=[];
  const fetch=api.createAppLocalHttpFetch({scope:()=> 'scope-a',host:()=>({isNative:true,async read(name,args){reads.push({name,args});return{status:200,scope:'scope-a',data:wire(200,{ok:true})}}}),fetch:async(input)=>{original.push(input);return new Response('original')}});
  await fetch('/api/pos/connection');await fetch('reylumi-app://bundle/api/pos/connection');await fetch('https://reylumi.com/api/pos/connection');assert.equal(reads.length,3);
  for(const url of ['//foreign.test/api/pos/connection','//bundle/api/pos/connection','reylumi-app://foreign/api/pos/connection','other-app://bundle/api/pos/connection','reylumi-app://bundle:99/api/pos/connection','https://user:secret@reylumi.com/api/pos/connection'])await fetch(url);
  assert.equal(reads.length,3);assert.equal(original.length,6);assert.equal(typeof api.installAppLocalHttpTransport,'function');
 } finally {if(previous===undefined)delete globalThis.location;else globalThis.location=previous;}
});

test('receipt bridge attempts once, preserves operation identity/business date and every original outbox result',async()=>{
 const api=await moduleFrom('lib/app-local-http-client.ts',{'app-local-host':'export function getAppLocalHost(){throw Error("Inject fixture host")}'});
 const calls=[],operation={id:'11111111-1111-4111-8111-111111111111',scope:'owner:salon:viewer',kind:'receipt',occurredAt:'2026-10-16T15:00:00Z',payload:{businessDate:'2026-10-16',lines:[{staffId:'staff-a',total:25}],total:25}};
 let result=wire(200,{kind:'blocked',rejected:true,message:'Closed day'}),failure;
 const host={isNative:true,async command(name,args,options){calls.push({name,args,options});if(failure)throw failure;return result}};
 const fetch=api.createAppLocalHttpFetch({scope:()=> 'scope-a',host:()=>host,fetch:()=>{throw Error('No original mutation permitted')}});
 const request=()=>fetch('/api/pos/owner/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation)});
 let response=await request();assert.equal(response.status,200);assert.deepEqual(await response.json(),{kind:'blocked',rejected:true,message:'Closed day'});assert.equal(calls.length,1);assert.deepEqual(calls[0],{name:'owner.receipt-operation',args:{operation},options:{scope:'scope-a'}});
 result=wire(503,{kind:'retry'});response=await request();assert.equal(response.status,503);assert.deepEqual(await response.json(),{kind:'retry'});assert.equal(calls.length,2);
 failure=Error('Lost reply');await assert.rejects(request,/Lost reply/);assert.equal(calls.length,3,'the adapter never owns a retry');
 const aborted=new AbortController();aborted.abort();await assert.rejects(()=>fetch('/api/pos/owner/operations',{method:'POST',body:JSON.stringify(operation),signal:aborted.signal}));assert.equal(calls.length,3,'already cancelled writes never begin');
});

test('caller timeout never cancels/replays an already dispatched receipt or changes its UUID',async()=>{
 const api=await moduleFrom('lib/app-local-http-client.ts',{'app-local-host':'export function getAppLocalHost(){throw Error("Inject fixture host")}'});
 let calls=0,finish;const host={isNative:true,command(){calls++;return new Promise(resolve=>finish=resolve)}};
 const fetch=api.createAppLocalHttpFetch({scope:()=> 'scope-a',host:()=>host}),controller=new AbortController();
 const pending=fetch('/api/pos/owner/operations',{method:'POST',body:JSON.stringify({id:'original-operation'}),signal:controller.signal});
 controller.abort();await assert.rejects(()=>pending);assert.equal(calls,1);finish(wire(200,{kind:'ok',data:{ticketId:'original-operation'}}));await Promise.resolve();assert.equal(calls,1);
});

async function serverFixture(){
 const s=globalThis.__httpAdapter={scope:'scope-a',unavailable:false,calls:[],moneyStatus:200,moneyBody:{kind:'ok',data:{ticketId:'same-ticket'}}};
 const api=await moduleFrom('lib/app-local-http-server.ts',{
  'server-only':'',
  'next/headers':`export const headers=async()=>new Headers({'cookie':'fixture=session',...(globalThis.__httpAdapter.unavailable?{'x-reylumi-auth-unavailable':'1'}:{})});`,
  'request-business-context':`export const getRequestBusinessContext=async()=>({user:{id:'viewer-a'}});`,
  'experience-context':`export const getExperienceContext=()=>({scope:globalThis.__httpAdapter.scope});`,
  '@/app/api/pos/owner/workspace/route':`export async function GET(request){const s=globalThis.__httpAdapter;s.calls.push({kind:'workspace',url:request.url,cookie:request.headers.get('cookie')});return new Response(JSON.stringify({staff:[{id:'staff-a'}]}),{status:200,headers:{'content-type':'application/json','cache-control':'private, no-store','set-cookie':'never-in-js'}})}`,
  '@/app/api/pos/connection/route':`export function GET(){globalThis.__httpAdapter.calls.push({kind:'connection'});return new Response(JSON.stringify({available:true}),{headers:{'content-type':'application/json'}})}`,
  '@/app/api/pos/owner/reports/route':`export async function GET(request){globalThis.__httpAdapter.calls.push({kind:'closing',url:request.url,cookie:request.headers.get('cookie')});return new Response(JSON.stringify({report:{date:new URL(request.url).searchParams.get('date'),lock:{isLocked:true}}}),{headers:{'content-type':'application/json'}})}`,
  '@/app/api/pos/owner/operations/route':`export async function POST(request){const s=globalThis.__httpAdapter;s.calls.push({kind:'receipt',url:request.url,origin:request.headers.get('origin'),cookie:request.headers.get('cookie'),operation:await request.json()});return new Response(JSON.stringify(s.moneyBody),{status:s.moneyStatus,headers:{'content-type':'application/json'}})}`,
 });return{api,s};
}
test('server named reads invoke only original handlers after current scope, with stable conditional versions and no cookie leakage',async()=>{
 const{api,s}=await serverFixture();
 assert.equal(await api.readAppLocalHttpResource('other.read',{},{}),null);
 await assert.rejects(()=>api.readAppLocalHttpResource('owner.workspace-patch',{resource:'staff'},{scope:'old-scope'}),e=>e.status===409);assert.equal(s.calls.length,0);
 const first=await api.readAppLocalHttpResource('owner.workspace-patch',{resource:'staff',ownerScope:'owner:salon:viewer'},{scope:s.scope});assert.equal(first.data.status,200);assert.equal(first.data.headers['set-cookie'],undefined);assert.equal(s.calls.length,1);assert.equal(s.calls[0].cookie,'fixture=session');assert(new URL(s.calls[0].url).searchParams.get('ownerScope')==='owner:salon:viewer');
 const unchanged=await api.readAppLocalHttpResource('owner.workspace-patch',{ownerScope:'owner:salon:viewer',resource:'staff'},{scope:s.scope,etag:first.etag});assert.equal(unchanged.status,304);assert.equal('data'in unchanged,false);
 await assert.rejects(()=>api.readAppLocalHttpResource('owner.workspace-patch',{resource:'arbitrary'},{scope:s.scope}),e=>e.status===400);
 s.unavailable=true;const count=s.calls.length;await assert.rejects(()=>api.readAppLocalHttpResource('app.connection',{}, {scope:s.scope}),e=>e.status===503);assert.equal(s.calls.length,count);
});

test('server receipt adapter forwards original operation once and preserves retry/blocked/error HTTP outcomes',async()=>{
 const{api,s}=await serverFixture(),operation={id:'original-id',scope:'owner:salon:viewer',occurredAt:'2026-10-16T14:00:00Z',kind:'receipt',payload:{total:25,businessDate:'2026-10-16'}};
 const request=new Request('https://reylumi.com/api/app-local/command',{method:'POST',headers:{origin:'https://reylumi.com',cookie:'original=current'},body:'{}'});
 assert.deepEqual(await api.runAppLocalHttpCommand('other.command',{},request,s.scope),{handled:false});
 let result=await api.runAppLocalHttpCommand('owner.receipt-operation',{operation},request,s.scope);assert.equal(result.handled,true);assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.data.body),s.moneyBody);assert.equal(s.calls.length,1);assert.deepEqual(s.calls[0].operation,operation);assert.equal(s.calls[0].origin,'https://reylumi.com');assert.equal(s.calls[0].cookie,'original=current');
 s.moneyStatus=403;s.moneyBody={kind:'blocked'};result=await api.runAppLocalHttpCommand('owner.receipt-operation',{operation},request,s.scope);assert.equal(result.data.status,403);assert.deepEqual(JSON.parse(result.data.body),{kind:'blocked'});assert.equal(s.calls.length,2);
 await assert.rejects(()=>api.runAppLocalHttpCommand('owner.receipt-operation',{operation},request,'wrong'),e=>e.status===409);assert.equal(s.calls.length,2);
 const foreign=new Request('https://reylumi.com/api/app-local/command',{method:'POST',headers:{origin:'https://foreign.test'},body:'{}'});await assert.rejects(()=>api.runAppLocalHttpCommand('owner.receipt-operation',{operation},foreign,s.scope),e=>e.status===403);assert.equal(s.calls.length,2);
});

test('daily closing refresh bridges only its declared existing GET and preserves original closing status',async()=>{
 const client=await moduleFrom('lib/app-local-http-client.ts',{'app-local-host':'export function getAppLocalHost(){throw Error("Inject fixture host")}'});
 const calls=[];const fetch=client.createAppLocalHttpFetch({scope:()=> 'scope-a',host:()=>({isNative:true,async read(name,args,options){calls.push({name,args,options});return{status:200,scope:'scope-a',data:wire(200,{report:{lock:{isLocked:true}}})}}}),fetch:()=>{throw Error('No custom-scheme API request')}});
 const result=await fetch('/api/pos/owner/reports?view=closing&date=2026-10-16');assert.equal(result.status,200);assert.deepEqual(await result.json(),{report:{lock:{isLocked:true}}});assert.deepEqual(calls[0].args,{view:'closing',date:'2026-10-16'});assert.equal(calls[0].name,'owner.report-closing');
 const{api,s}=await serverFixture();const response=await api.readAppLocalHttpResource('owner.report-closing',{view:'closing',date:'2026-10-16'},{scope:s.scope});assert.equal(response.status,200);assert.equal(JSON.parse(response.data.body).report.lock.isLocked,true);assert.equal(s.calls[0].cookie,'fixture=session');assert.equal(new URL(s.calls[0].url).pathname,'/api/pos/owner/reports');
 await assert.rejects(()=>api.readAppLocalHttpResource('owner.report-closing',{view:'overview',date:'2026-10-16'},{scope:s.scope}),e=>e.status===400);await assert.rejects(()=>api.readAppLocalHttpResource('owner.report-closing',{view:'closing',date:'2026-10-16',salonId:'foreign'},{scope:s.scope}),e=>e.status===400);assert.equal(s.calls.length,1);
});
