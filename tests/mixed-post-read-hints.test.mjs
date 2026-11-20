import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

async function importModule(entry,plugins=[]){
 const bundle=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',logLevel:'error',plugins});
 return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
const mutations=await importModule('lib/experience-mutations.ts');

test('only server response none suppresses mixed POST invalidation; scope/data and revalidated actions keep priority',()=>{
 const classify=(req={},res={})=>mutations.classifyExperienceResponse('/api/rewards','POST',new Headers(req),new Headers(res));
 assert.equal(classify({}, {'x-reylumi-experience-change':'none'}),'none');
 assert.equal(classify({'x-reylumi-experience-change':'none'},{}),'data','a caller cannot declare its mutation passive');
 for(const value of ['data','scope'])assert.equal(classify({'Next-Action':'qa'},{'x-reylumi-experience-change':value,'x-action-revalidated':'1'}),value);
 for(const revalidated of ['1','2'])assert.equal(classify({'Next-Action':'qa'},{'x-reylumi-experience-change':'none','x-action-revalidated':revalidated}),'data');
 assert.equal(classify({},{}),'data');
});

const fakeServer={name:'authorized-rpc-boundary',setup(b){
 b.onResolve({filter:/^(next\/server|next\/headers|@\/lib\/(supabase\/server|current-context|market-plugins|market-payments|gift-card-stripe|pos-settings|pos-staff-realtime-server|platform-admin\/auth|platform-admin\/permissions))$/},a=>({path:a.path,namespace:'qa-boundary'}));
 b.onLoad({filter:/.*/,namespace:'qa-boundary'},({path})=>({contents:
  path==='next/server'?`export const after=()=>{};`:
  path==='next/headers'?`export const cookies=async()=>({get(){}});`:
  path.endsWith('supabase/server')?`export const createAuthenticatedSupabaseServerClient=async()=>globalThis.__qaMixed.auth?globalThis.__qaMixed.db:null;export const createSupabaseServerClient=()=>globalThis.__qaMixed.db;`:
  path.endsWith('current-context')?`export const getCurrentBusinessContext=async()=>({currentSalon:{id:'qa-salon'},user:{id:'qa-viewer'}});`:
  path.endsWith('market-plugins')?`export const marketPluginContext=async()=>{if(!globalThis.__qaMixed.auth)throw Error('Denied owner');return{client:globalThis.__qaMixed.db,salonId:'qa-salon'}};`:
  path.endsWith('market-payments')?`export const marketServiceClient=()=>globalThis.__qaMixed.db;`:
  path.endsWith('gift-card-stripe')?`export const connectGiftStripe=async()=>({});export const prepareGiftOnline=async()=>({});export const syncGiftOnline=async()=>{};`:
  path.endsWith('pos-settings')?`export const getCurrentSalonPosSettings=async()=>({});`:
  path.endsWith('pos-staff-realtime-server')?`export const broadcastPosStaffChange=async()=>{};`:
  path.endsWith('platform-admin/auth')?`export const requirePlatformAdmin=async()=>{if(!globalThis.__qaMixed.auth)throw Error('Denied admin')};`:
  `export const PLATFORM_ADMIN_PERMISSIONS={advertisingManage:'qa'};` }));
}};

test('authorized successful mixed RPC reads return none only for audited scope/op pairs',async()=>{
 const rewards=await importModule('app/api/rewards/route.ts',[fakeServer]);
 const gifts=await importModule('app/api/gift-cards/route.ts',[fakeServer]);
 globalThis.__qaMixed={auth:true,fail:false,calls:[],db:{rpc(name,args){globalThis.__qaMixed.calls.push({name,args});return Promise.resolve(globalThis.__qaMixed.fail?{error:{message:'Denied fixture read'}}:{data:{},error:null})},from(){const row={select(){return row},eq(){return row},single(){return Promise.resolve({data:{id:'qa-order',stripe_account:'qa-account',stripe_session:null},error:null})}};return row}}};
 const request=(body,hints={})=>{const req=new Request('http://localhost:3117/api/test',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3117',...hints},body:JSON.stringify({...body,args:{salonId:'qa-salon',visitId:'qa-visit'},token:'a'.repeat(64)})});req.nextUrl=new URL(req.url);return req};
 try{
  for(const [handler,pairs]of [[rewards,['personal:wallet','personal:gift-load','owner:load','owner:preview','owner:report','admin:load']],[gifts,['owner:read','wallet:list','wallet:history','public:read','public:mobile','online:catalog','pos:wallet','pos:read']]]){
   for(const pair of pairs){const [scope,op]=pair.split(':');const response=await handler.POST(request({scope,op}));assert.equal(response.status,200,pair);assert.equal(response.headers.get('x-reylumi-experience-change'),'none',pair)}
  }
  for(const [handler,pairs]of [[rewards,['personal:join','personal:gift-approve','owner:save','owner:accept','admin:save','pos:load','pos:quote','display:load','unknown:read']],[gifts,['owner:install','owner:void-sale','wallet:present','wallet:claim','public:receive','public:transfer','online:status','online:buy','display:read','pos:sync']]]){
   for(const pair of pairs){const [scope,op]=pair.split(':');const response=await handler.POST(request({scope,op},{'x-reylumi-experience-change':'none'}));assert.notEqual(response.headers.get('x-reylumi-experience-change'),'none',pair+' must remain a write/unknown')}
  }
  globalThis.__qaMixed.fail=true;
  assert.equal((await rewards.POST(request({scope:'personal',op:'wallet'}))).headers.get('x-reylumi-experience-change'),null);
  assert.equal((await gifts.POST(request({scope:'wallet',op:'list'}))).headers.get('x-reylumi-experience-change'),null);
  globalThis.__qaMixed.fail=false;globalThis.__qaMixed.auth=false;
  assert.equal((await rewards.POST(request({scope:'personal',op:'wallet'}))).status,400);
  assert.equal((await gifts.POST(request({scope:'wallet',op:'list'}))).status,400);
 }finally{delete globalThis.__qaMixed}
});

test('actual session observer keeps an in-flight history cache read for a verified wallet read and invalidates on a write',async()=>{
 const fixture=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import{createRoot}from'react-dom/client';
  import{SessionExpiryPrompt}from'./components/session-expiry-prompt';
  import{experienceResourceCache}from'./lib/experience-resource-cache';
  const qa=window.qa={status:'idle',events:0};window.addEventListener('reylumi:experience-mutation',()=>qa.events++);
  qa.start=()=>{qa.status='pending';qa.promise=experienceResourceCache.load({scope:'qa-scope',key:'history'},({signal})=>new Promise((resolve,reject)=>{qa.release=()=>resolve({data:{booking:'qa-booking'}});signal.addEventListener('abort',()=>reject(signal.reason),{once:true})}),{force:true,tags:['booking']}).then(()=>qa.status='resolved',()=>qa.status='invalidated')};
  createRoot(document.getElementById('root')).render(<SessionExpiryPrompt authenticated={false}/>);
 `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',plugins:[{name:'context-only-stubs',setup(b){
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));b.onResolve({filter:/experience-scope$/},()=>({path:'scope',namespace:'fixture'}));b.onResolve({filter:/reset-experience-cache$/},()=>({path:'reset',namespace:'fixture'}));b.onResolve({filter:/login\/login-form$/},()=>({path:'login',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',contents:path==='scope'?`export const useExperienceScope=()=>({context:{scope:'qa-scope'}});`:path==='language'?`export const WorkspaceText=({text})=>text;`:path==='reset'?`export const resetExperienceCaches=()=>{};`:`export const LoginForm=()=>null;` }));
 }}]});
 const js=fixture.outputFiles[0].text;
 const server=createServer((req,res)=>{if(req.url?.startsWith('/api/rewards')){res.setHeader('Content-Type','application/json');if(req.url.includes('read'))res.setHeader('x-reylumi-experience-change','none');res.end('{}');return}res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?js:'<div id="root"></div><script src="/fixture.js"></script>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH,headless:true}:{channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.fetch.name==='monitoredFetch');
  await page.evaluate(()=>window.qa.start());await page.evaluate(()=>fetch('/api/rewards?read',{method:'POST'}));
  assert.equal(await page.evaluate(()=>window.qa.status),'pending');assert.equal(await page.evaluate(()=>window.qa.events),0);
  await page.evaluate(()=>window.qa.release());await page.waitForFunction(()=>window.qa.status==='resolved');
  await page.evaluate(()=>window.qa.start());await page.evaluate(()=>fetch('/api/rewards?write',{method:'POST'}));
  await page.waitForFunction(()=>window.qa.status==='invalidated');assert.equal(await page.evaluate(()=>window.qa.events),1);
 }finally{await browser.close();await new Promise(r=>server.close(r))}
});
