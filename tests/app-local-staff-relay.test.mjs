import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createServer}from'node:http';
import {build}from'esbuild';
import {chromium}from'playwright-core';
const browserPath=process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const staffId='11111111-1111-4111-8111-111111111111',salonId='22222222-2222-4222-8222-222222222222',viewerId='33333333-3333-4333-8333-333333333333',scope='v3:'+'a'.repeat(64);
const workspace={installed:true,staffId,services:[{id:'service-a',name:'Manicure',price:42}],tickets:[{visitId:'visit-a',queueNumber:12,customerName:'Fixture customer',status:'working',revision:4,lines:[{id:'line-a',offerId:'offer-a',staffId,staffName:'Fixture staff',serviceId:'service-a',serviceName:'Manicure',amount:42}],offers:[{id:'offer-a',staffId,staffName:'Fixture staff',serviceId:'service-a',serviceName:'Manicure',status:'working',expiresAt:'2099-01-01'}],requestedServices:[]}]};
test('the actual cached staff editor restores unsent money after a process restart and never sends it on reconnect',{skip:!fs.existsSync(browserPath),timeout:60000},async()=>{
 const fixture=JSON.stringify({workspace,scope,staffId,salonId,viewerId}).replaceAll('<','\\u003c');
 const built=await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import{AppLocalStaffRelay}from'./lib/app-local-staff-relay';import*as storage from'./lib/experience-persistent-cache';window.api=storage;window.calls=[];window.reads=[];let online=false;Object.defineProperty(navigator,'onLine',{get:()=>online});window.reconnect=()=>{online=true;window.dispatchEvent(new Event('online'))};async function main(){const f=window.fixture,now=Date.now();await storage.acceptExperienceOfflineGrant({version:1,scope:f.scope,scopes:[f.scope],viewerId:f.viewerId,salonId:f.salonId,workspaceId:f.salonId,grantRevision:'staff-rev-a',generation:storage.getExperienceDeviceGeneration(),issuedAt:now,expiresAt:now+86400000,path:'/staff/my-work',kind:'staff',staffBinding:{version:1,staffId:f.staffId,viewerId:f.viewerId,salonId:f.salonId,revision:'44444444-4444-4444-8444-444444444444',approvedAt:new Date(now-1000).toISOString()}});window.before=await storage.readExperienceSnapshot({scope:f.scope,domain:'draft:staff-service',params:{staffId:f.staffId,offerId:'offer-a'}});createRoot(document.getElementById('root')).render(<AppLocalStaffRelay scope={f.scope} salonId={f.salonId} staffId={f.staffId}/>)}main();`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':process.cwd()},plugins:[{name:'scoped-fixture',setup(b){
  const modules={
   'app-local-host':`export const getAppLocalHost=()=>({isNative:true,cache:async(op,args)=>args.scope===window.fixture.scope&&args.name==='staff.relay'?{data:window.fixture.workspace,updatedAt:Date.now(),revision:'fixture'}:null,read:async(name,args,opts)=>{window.reads.push({name,args});return{schemaVersion:1,status:304,scope:opts.scope,etag:'fixture',updatedAt:Date.now()}}});`,
   '@/lib/pos-workspace-sync':`export const subscribePosChanges=()=>()=>{};`,
   '@/components/workspace-language':`export const WorkspaceText=({text})=>text;`,
   './actions':`export async function saveServiceRelay(input){window.calls.push(input);return{error:'Fixture stopped before a real save'}}export async function loadServiceRelay(){throw Error('Unmanaged initial load')}export async function findServiceRelay(){throw Error('Unexpected find')}export async function respondServiceRelay(){throw Error('Unexpected response')}`,
  };b.onResolve({filter:/.*/},args=>{const key=Object.keys(modules).find(key=>args.path===key||args.path.endsWith('/'+key));return key?{path:key,namespace:'fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',contents:modules[a.path],resolveDir:process.cwd()}));b.onLoad({filter:/\.css$/},()=>({loader:'js',contents:'export default {}'}));
 }}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?built.outputFiles[0].text:`<div id="root"></div><script>window.fixture=${fixture}</script><script src="/fixture.js"></script>`)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'staff-relay-cold-'));let browser;
 const start=async()=>{browser=await chromium.launchPersistentContext(profile,{executablePath:browserPath,headless:true,args:["--no-proxy-server"]});const page=browser.pages()[0]??await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/staff/my-work');return page};
 try{
  let page=await start();const price=()=>page.getByRole('textbox',{name:'Price 1',exact:true});await price().waitFor();assert.equal(await price().inputValue(),'42');await price().fill('77.25');
  // Installed Playwright treats a Promise returned by waitForFunction as immediately truthy.
  // Poll inside the page instead, waiting for a real committed IndexedDB snapshot before stopping Chrome.
  await page.evaluate(async()=>{const end=Date.now()+5000;while(Date.now()<end){const saved=await window.api.readExperienceSnapshot({scope:window.fixture.scope,domain:'draft:staff-service',params:{staffId:window.fixture.staffId,offerId:'offer-a'}});if(saved?.data.lines[0].amount==='77.25')return;await new Promise(resolve=>setTimeout(resolve,25))}throw Error('Edited relay draft did not commit to IndexedDB')});
  assert.equal(await page.evaluate(async()=>(await window.api.listExperienceSnapshots(window.fixture.scope)).length),1);assert.equal(await page.evaluate(()=>window.calls.length),0);
  await browser.close();page=await start();await price().waitFor();
  assert.equal(await page.evaluate(()=>window.before?.data.lines[0].amount),'77.25');
  await page.waitForFunction(()=>document.querySelector('[aria-label="Price 1"]')?.value==='77.25',{},{timeout:4000});
  await page.evaluate(()=>window.reconnect());await page.waitForFunction(()=>window.reads.length===1);await page.waitForTimeout(1800);assert.equal(await page.evaluate(()=>window.calls.length),0);
  await page.getByRole('button',{name:'Send to POS',exact:true}).click();await page.getByRole('alert').waitFor();const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,1);assert.equal(calls[0].lines[0].amount,'77.25');assert.equal(calls[0].revision,4);
 }finally{await browser?.close();await new Promise(r=>server.close(r));const resolved=fs.realpathSync(profile);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('staff-relay-cold-'));fs.rmSync(resolved,{recursive:true,force:true});}
});

test('the staff relay named read rejects another identity before reading and returns body-free unchanged revisions',async()=>{
 const state=globalThis.relayReadFixture={identity:{context:{user:{id:viewerId},currentSalon:{id:salonId},scope},staff:{id:staffId}},calls:0,data:workspace};
 const built=await build({entryPoints:['lib/app-local-staff-relay-server.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'authority',setup(b){const modules={'server-only':'','staff-portal-identity':'export async function getStaffPortalIdentity(){return globalThis.relayReadFixture.identity}','experience-context':'export const getExperienceContext=context=>({scope:context.scope});','@/app/service-relay/actions':'export async function loadServiceRelay(){globalThis.relayReadFixture.calls++;return{data:globalThis.relayReadFixture.data}}'};b.onResolve({filter:/.*/},a=>{const key=Object.keys(modules).find(key=>a.path===key||a.path.endsWith('/'+key));return key?{path:key,namespace:'fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:modules[a.path]}));}}]});
 const{readAppLocalStaffRelayResource:read}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 await assert.rejects(read('staff.relay',{staffId:viewerId},{scope}),{status:403});assert.equal(state.calls,0);
 const first=await read('staff.relay',{staffId},{scope});assert.equal(first.data,workspace);const next=await read('staff.relay',{staffId},{scope,etag:first.etag});assert.equal(next.status,304);assert.equal('data'in next,false);
 state.identity.context.scope='other';await assert.rejects(read('staff.relay',{staffId},{scope}),{status:409});assert.equal(state.calls,2);
});
