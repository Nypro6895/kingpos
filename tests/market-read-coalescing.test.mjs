import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('actual Market hooks reuse fresh data and join invalidation plus explicit refresh', {timeout:15000}, async()=>{
  const result=await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';
import{MarketExperienceClient}from'./app/market/market-experience-client';
import{invalidateExperienceResources}from'./lib/experience-resource-cache';
window.h={reads:[],hold:false};const scope='v3:'+'a'.repeat(64),initial={data:{marker:'Initial'},updatedAt:new Date().toISOString(),revision:'r1'};
window.invalidateMarket=()=>{invalidateExperienceResources({scope,tags:['market','catalog','settings']});dispatchEvent(new Event('reylumi:market-changed'));};
function App(){const[active,set]=useState(true);window.activeMarket=set;return <Activity mode={active?'visible':'hidden'}><MarketExperienceClient context={{scope,salonId:null}} initial={initial}/></Activity>};createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'market-network-boundaries',setup(b){
  b.onResolve({filter:/market-client$|fetch-live-experience-resource$|experience-persistent-cache$|experience-native-readmodels$|supabase\/browser$|loading-feedback$/},({path})=>({path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',resolveDir:process.cwd(),contents:
    path.endsWith('market-client')?'export const MarketClient=({marker})=><output>{marker}</output>;':
    path.endsWith('fetch-live-experience-resource')?'export const fetchLiveExperienceResource=(url,scope)=>async()=>{window.h.reads.push({url,scope});if(h.hold)await new Promise(resolve=>window.finishRead=resolve);return{data:{data:{marker:"Refreshed"},revision:"r2",updatedAt:new Date().toISOString()},etag:"r2"};};':
    path.endsWith('experience-persistent-cache')?'export const EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT="fixture-authorization";export const isExperienceSnapshotContextAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};':
    path.endsWith('experience-native-readmodels')?'export const subscribeExperienceNativeReadModel=()=>()=>{};':
    path.endsWith('supabase/browser')?'export const createSupabaseBrowserClient=()=>null;':'export const PageLoadingSkeleton=()=>null;'
  }));
}}]});
  const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(result.outputFiles[0].text);}else{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/fixture.js"></script>');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(4000);
    await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('Initial',{exact:true}).waitFor();await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>h.reads.length),0,'Fresh initial snapshot must not trigger an entry reread');
    await page.evaluate(()=>{dispatchEvent(new Event('focus'));dispatchEvent(new Event('reylumi:foreground'));});await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>h.reads.length),0,'Fresh lifecycle wakes must not reread');
    await page.evaluate(()=>{h.hold=true;window.invalidateMarket();});await page.waitForFunction(()=>typeof window.finishRead==='function');
    assert.equal(await page.evaluate(()=>h.reads.length),1,'Automatic invalidation and explicit refresh join one in-flight request');
    await page.evaluate(()=>{h.hold=false;window.finishRead();});await page.getByText('Refreshed',{exact:true}).waitFor();
    await page.evaluate(()=>window.activeMarket(false));await page.waitForTimeout(50);await page.evaluate(()=>window.activeMarket(true));await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>h.reads.length),1,'A fresh Activity reveal must not reread');assert.deepEqual(errors,[]);
    fs.mkdirSync('artifacts/iphone-quality-audit-20261103/market-logo-allocation',{recursive:true});
    fs.writeFileSync('artifacts/iphone-quality-audit-20261103/market-logo-allocation/read-hook-audit.json',JSON.stringify({passed:true,source:'Actual MarketExperienceClient/useExperienceResource/useLiveExperienceRefresh/cache/scheduler; network replaced by synthetic promise; salon broker disabled',freshEntryReads:0,freshLifecycleReads:0,invalidationAndExplicitRefreshReads:1,freshRevealExtraReads:0,requests:await page.evaluate(()=>h.reads),errors,conclusion:'No redundant client hook read demonstrated for these lifecycle/event cases. Does not measure hosted router.refresh server work or real network latency.'},null,2));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
