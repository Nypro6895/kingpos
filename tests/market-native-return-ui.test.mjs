import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('native Market refreshes verified access and reconciles explicit returns without carrying URL purchase authority',async()=>{
 const bundled=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useCallback,useState}from'react';import{createRoot}from'react-dom/client';import{AppLocalMarket}from'./lib/app-local-market';
 function App(){const[scope,setScope]=useState('owner:a'),[sequence,setSequence]=useState(null),[verified,setVerified]=useState(1),[noise,setNoise]=useState(0);window.scope=setScope;window.sequence=setSequence;window.verified=setVerified;window.noise=()=>setNoise(v=>v+1);const refresh=useCallback(async()=>{window.refreshes.push(scope)},[scope]);return <AppLocalMarket data={{experienceScope:scope,marketSalonId:scope==='owner:a'?'salon_a':'salon_b'}} refresh={refresh} verifiedAt={verified} returnSequence={sequence} initialBrowse={{query:String(noise),category:'All features'}}/>}createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:'browser',jsx:'automatic',plugins:[{name:'boundaries',setup(api){
  api.onResolve({filter:/^@\/app\/market\/(market-client|payment-return-actions)$/},a=>({path:a.path,namespace:'fixture'}));
  api.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:a.path.endsWith('market-client')?`import React from'react';export function MarketClient(p){return <><span data-revision={p.accessRevision}>{p.experienceScope}</span><button onClick={p.onMarketRefresh}>Refresh Market</button></>}`:`export async function reconcileMarketReturnAction(salon){window.calls.push(salon);return await new Promise(resolve=>window.pending.push(resolve));}`}));
 }}]});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://native.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('https://native.test/market?session_id=forged&salon=other&paid=true');
  await page.evaluate(()=>Object.assign(window,{calls:[],pending:[],refreshes:[]}));await page.addScriptTag({content:bundled.outputFiles[0].text});
  await page.getByText('owner:a',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.calls),[]);
  await page.getByRole('button',{name:'Refresh Market'}).click();assert.deepEqual(await page.evaluate(()=>window.refreshes),['owner:a']);
  await page.evaluate(()=>{window.verified(2);window.noise();window.sequence('1')});await page.waitForFunction(()=>window.calls.length===1);
  assert.equal(await page.locator('[data-revision]').getAttribute('data-revision'),'2');
  await page.evaluate(()=>window.noise());await page.waitForTimeout(30);assert.deepEqual(await page.evaluate(()=>window.calls),['salon_a']);
  await page.evaluate(()=>window.scope('owner:b'));await page.waitForFunction(()=>window.calls.length===2);
  await page.evaluate(()=>window.pending.shift()({message:'old salon'}));await page.waitForTimeout(30);assert.deepEqual(await page.evaluate(()=>window.refreshes),['owner:a']);
  await page.evaluate(()=>window.pending.shift()({message:'current salon'}));await page.waitForFunction(()=>window.refreshes.length===2);
  assert.deepEqual(await page.evaluate(()=>window.refreshes),['owner:a','owner:b']);
  assert.deepEqual(await page.evaluate(()=>window.calls),['salon_a','salon_b']);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('native return retries a rejected preflight after verified admission without replaying Checkout or stale generations',async()=>{
 const bundled=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useCallback,useState}from'react';import{createRoot}from'react-dom/client';import{AppLocalMarket}from'./lib/app-local-market';import{setAppLocalCommandScope}from'./lib/app-local-command-client';
 window.admit=setAppLocalCommandScope;
 function App(){const[scope,setScope]=useState('owner:a'),[sequence,setSequence]=useState(null),[verified,setVerified]=useState(1),[noise,setNoise]=useState(0);window.scope=setScope;window.sequence=setSequence;window.verified=setVerified;window.noise=()=>setNoise(v=>v+1);const refresh=useCallback(async()=>{window.refreshes.push(scope)},[scope]);return <AppLocalMarket data={{experienceScope:scope,marketSalonId:scope==='owner:a'?'salon_a':'salon_b'}} refresh={refresh} verifiedAt={verified} returnSequence={sequence} initialBrowse={{query:String(noise),category:'All features'}}/>}createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:'browser',jsx:'automatic',plugins:[{name:'boundaries',setup(api){
  api.onResolve({filter:/^@\/app\/market\/(market-client|payment-return-actions)$/},a=>({path:a.path,namespace:'fixture'}));
  api.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:a.path.endsWith('market-client')?`import React from'react';export function MarketClient(p){return <span>{p.experienceScope}</span>}`:`import{invokeAppLocalCommand}from'./lib/app-local-command-client';export async function reconcileMarketReturnAction(salon){window.attempts.push(salon);return invokeAppLocalCommand('action.dbc5382c479772dacee7b3dd',[salon],false)}`}));
 }}]});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://native.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://native.test/market');
  await page.evaluate(()=>Object.assign(window,{attempts:[],dispatches:[],pending:[],refreshes:[],__reylumiAppLocalContext:{version:1,nonce:'nonce-a',scopeEpoch:1,generation:'generation-a'},__reylumiAppLocalTransport:{request(request){window.dispatches.push(request);return new Promise((resolve,reject)=>window.pending.push({resolve,reject}));}}}));await page.addScriptTag({content:bundled.outputFiles[0].text});await page.getByText('owner:a',{exact:true}).waitFor();
  await page.evaluate(()=>window.sequence('cancel-return'));await page.waitForFunction(()=>window.attempts.length===1);await page.waitForTimeout(30);
  assert.deepEqual(await page.evaluate(()=>window.dispatches),[],'withdrawn admission rejects before native command dispatch');
  await page.evaluate(()=>window.noise());await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.attempts.length),1,'ordinary rendering does not retry');
  await page.evaluate(()=>{window.admit('owner:a');window.verified(2)});await page.waitForFunction(()=>window.dispatches.length===1);
  assert.equal(await page.evaluate(()=>window.dispatches[0].name),'action.dbc5382c479772dacee7b3dd');
  await page.evaluate(()=>window.verified(3));await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.dispatches.length),1,'new read joins in-flight reconciliation');
  await page.evaluate(()=>window.pending.shift().resolve({value:{message:'Payment status checked.'}}));await page.waitForFunction(()=>window.refreshes.length===1);
  await page.evaluate(()=>window.verified(4));await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.dispatches.length),1,'successful delivery is not repeated by its own refresh');
  await page.evaluate(()=>window.sequence('next-return'));await page.waitForFunction(()=>window.dispatches.length===2);
  await page.evaluate(()=>window.verified(5));await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.dispatches.length),2);
  await page.evaluate(()=>window.pending.shift().reject(new Error('Admission renewed during preflight')));await page.waitForFunction(()=>window.dispatches.length===3,'a newer verified read is retained while a failed preflight settles');
  await page.evaluate(()=>{window.__reylumiAppLocalContext={version:1,nonce:'nonce-b',scopeEpoch:2,generation:'generation-b'};window.admit('owner:b');window.scope('owner:b')});await page.waitForFunction(()=>window.dispatches.length===4);
  await page.evaluate(()=>window.pending.shift().resolve({value:{message:'old owner'}}));await page.waitForTimeout(30);assert.deepEqual(await page.evaluate(()=>window.refreshes),['owner:a']);
  await page.evaluate(()=>window.pending.shift().resolve({value:{message:'current owner'}}));await page.waitForFunction(()=>window.refreshes.length===2);
  assert.deepEqual(await page.evaluate(()=>window.refreshes),['owner:a','owner:b']);
  assert.equal(await page.evaluate(()=>window.dispatches.every(r=>r.kind==='command'&&r.name==='action.dbc5382c479772dacee7b3dd')),true,'only saved-purchase reconciliation can dispatch');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
