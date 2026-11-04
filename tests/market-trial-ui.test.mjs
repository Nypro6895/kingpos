import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';

test('mobile owner trial: explicit start, duplicate-click guard, live refresh and scoped navigation', {timeout:60000},async()=>{
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{MarketTrialPanel}from'./app/market/trial-panel';createRoot(document.getElementById('root')).render(<MarketTrialPanel pluginId="booksms" scope="owner:salon_a" salonId="salon_a"/>);`},bundle:true,write:false,platform:'browser',jsx:'automatic',plugins:[{name:'boundaries',setup(api){
  const stubs={
   'next/navigation':`export function useRouter(){return {refresh(){window.refreshes++}}}`,
   '@/lib/experience-resource-cache':`export function invalidateExperienceResources(filter){window.invalidations.push(filter)}`,
   './trial-actions':`export async function marketTrialAction(plugin,start=false){window.calls.push({plugin,start});if(start){await new Promise(r=>setTimeout(r,80));window.state={started:true,active:true,paid:false,endsAt:'2030-01-06T00:00:00Z'}}return {state:window.state}}`,
  };
  api.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'stub'}:undefined);
  api.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path]}));
 }}]});
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('https://reylumi.test/**',r=>r.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;padding:20px;margin:0}button{padding:14px;border-radius:10px;border:0;background:#141414;color:white}p{line-height:1.5}</style><h1>BookSMS</h1><div id="root"></div>'}));
  await page.goto('https://reylumi.test/market');
  await page.evaluate(()=>{window.calls=[];window.invalidations=[];window.refreshes=0;window.state={started:false,active:false,paid:false,endsAt:null};});
  await page.addScriptTag({content:result.outputFiles[0].text});
  const start=page.getByRole('button',{name:'Start 5-day free trial'});
  await start.waitFor();assert.deepEqual(await page.evaluate(()=>window.calls),[{plugin:'booksms',start:false}]);
  await start.evaluate(button=>{button.click();button.click();});
  await page.getByText(/Trial active until/).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.start).length),1);
  assert.deepEqual(await page.evaluate(()=>window.invalidations),[{scope:'owner:salon_a'}]);
  assert.equal(await page.evaluate(()=>window.refreshes),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  mkdirSync('artifacts/market-trials-20261103',{recursive:true});
  await page.screenshot({path:'artifacts/market-trials-20261103/booksms-trial-mobile.png',fullPage:true});
 }finally{await browser.close();}
});
