import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';
import{createServer}from'node:http';
import{build}from'esbuild';
import{chromium}from'playwright-core';
const browserPath=process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('confirmed deletion wins over a delayed disk read; a network timeout retains the last authorized view',{skip:!fs.existsSync(browserPath),timeout:30000},async()=>{
 const output=await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import{useAppLocalResource,refreshAppLocalResource,resetAppLocalResources,seedAppLocalResource}from'./lib/app-local-resource';window.refresh=()=>refreshAppLocalResource('scope-a','staff.relay',{});window.reset=resetAppLocalResources;window.seed=()=>seedAppLocalResource('scope-a','staff.relay',{}, {schemaVersion:1,status:200,scope:'scope-a',etag:'new',updatedAt:30,data:{name:'Latest staff'}});function View(){const r=useAppLocalResource('scope-a','staff.relay',{}, {enabled:false});return <main><p data-name>{r.data?.name??'empty'}</p><p data-error>{r.error??''}</p></main>}import{hydrateAppLocalResource}from'./lib/app-local-resource';window.hydrate=()=>hydrateAppLocalResource('scope-a','staff.relay',{});createRoot(document.getElementById('root')).render(<View/>);`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'held-authorized-storage',setup(b){b.onResolve({filter:/(?:^|\/)app-local-host$/},()=>({path:'host',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`window.readFailureStatus=404;window.removed=0;export const getAppLocalHost=()=>({isNative:true,cache:async(op)=>op==='get'?new Promise(resolve=>window.finishDisk=resolve):(window.removed++,null),read:async()=>{throw Object.assign(Error(window.readFailureStatus===404?'Deleted':'Network timeout'),{status:window.readFailureStatus})}});`}));}}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?output.outputFiles[0].text:'<div id="root"></div><script src="/app.js"></script>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:browserPath,headless:true}),page=await browser.newPage();
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('[data-name]').waitFor();
  await page.evaluate(()=>{void window.hydrate();});await page.waitForFunction(()=>typeof window.finishDisk==='function');
  await page.evaluate(()=>window.refresh());assert.equal(await page.locator('[data-name]').textContent(),'empty');assert.equal(await page.evaluate(()=>window.removed),1);
  await page.evaluate(async()=>{window.finishDisk({data:{name:'Deleted staff'},revision:'old',updatedAt:10});await Promise.resolve();});
  assert.equal(await page.locator('[data-name]').textContent(),'empty');assert.match(await page.locator('[data-error]').textContent(),/no longer available/);
  await page.evaluate(async()=>{window.seed();window.readFailureStatus=503;await window.refresh();});assert.equal(await page.locator('[data-name]').textContent(),'Latest staff');
  await page.evaluate(()=>window.reset());assert.equal(await page.locator('[data-name]').textContent(),'empty');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
