import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const bundled=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useCallback,useState}from'react';import{createRoot}from'react-dom/client';import{CardCheckoutPanel}from'./app/market/card-checkout-panel';import{setAppLocalCommandScope}from'./lib/app-local-command-client';window.admit=setAppLocalCommandScope;
 function App(){const[revision,setRevision]=useState('1'),[salon,setSalon]=useState('a'),[shown,setShown]=useState(true);window.verified=setRevision;window.salon=setSalon;window.show=setShown;const refresh=useCallback(()=>window.refreshes.push(salon),[salon]);return shown?<CardCheckoutPanel pluginId='booking-policy' pluginName='Policy' ready hasActiveSubscription={false} accessRevision={revision} experienceScope={'owner:'+salon} onMarketRefresh={refresh} onStateChange={()=>{}} billingState={{salon_id:salon,settings:{tax_bps:0,fee_bps:0,fixed_fee_cents:0},catalog:[{plugin_id:'booking-policy',price_cents:99,fulfillment_ready:true,published:true}]}}/>:null}createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,platform:'browser',jsx:'automatic',plugins:[{name:'fixture',setup(api){
 const stubs={
  '@/components/workspace-language':`export function WorkspaceText({text}){return text}`,
  'next/navigation':`const router={refresh(){window.refreshes.push('router')}};export function useRouter(){return router}`,
  './card-payment-actions':`import{invokeAppLocalCommand}from'./lib/app-local-command-client';export async function startCardCheckout(){window.buys++;return{checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_fixture'}}export async function refreshCardPurchase(plugin){window.attempts++;return invokeAppLocalCommand('action.772cdac11ef85b024329a565',[plugin],false)}export async function manageCardSubscription(){throw Error('not used')}`,
 };
 api.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'stub'}:undefined);
 api.onLoad({filter:/.*/,namespace:'stub'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:stubs[a.path]}));
}}]});
async function fixture(run){
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://native.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://native.test/market');await page.evaluate(()=>Object.assign(window,{buys:0,attempts:0,dispatches:[],pending:[],refreshes:[],__reylumiAppLocalContext:{version:1,nonce:'nonce-a',scopeEpoch:1,generation:'generation-a'},__reylumiAppLocalTransport:{request(r){window.dispatches.push(r);return new Promise((resolve,reject)=>window.pending.push({resolve,reject}))}}}));await page.addScriptTag({content:bundled.outputFiles[0].text});await page.getByRole('button',{name:'Buy with card',exact:true}).click();await page.getByRole('link',{name:'Continue to secure checkout',exact:true}).waitFor();await run(page);assert.deepEqual(errors,[]);}finally{await browser.close();}
}
test('foreground card status waits for renewed admission, retries only the read once, and does not replay Buy',()=>fixture(async page=>{
 await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:foreground')));await page.waitForFunction(()=>window.attempts===1);await page.getByText('Checking your account before checking payment status…',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.dispatches.length),0);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.attempts),1);
 await page.evaluate(()=>{window.admit('owner:a');window.verified('2')});await page.waitForFunction(()=>window.dispatches.length===1);assert.equal(await page.evaluate(()=>window.dispatches[0].name),'action.772cdac11ef85b024329a565');await page.evaluate(()=>window.pending.shift().resolve({value:{message:'No payment completed. Your trial remains active.'}}));await page.getByText('No payment completed. Your trial remains active.',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.refreshes),['a']);await page.evaluate(()=>window.verified('3'));await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.attempts),2);assert.equal(await page.evaluate(()=>window.buys),1);
}));
test('newer verified admission is retained while preflight settles and a second failure stops automatic retry',()=>fixture(async page=>{
 await page.evaluate(()=>{window.admit('owner:a');window.dispatchEvent(new Event('reylumi:foreground'))});await page.waitForFunction(()=>window.dispatches.length===1);await page.evaluate(()=>{window.verified('2');window.pending.shift().reject(new Error('stale admission'))});await page.waitForFunction(()=>window.dispatches.length===2);await page.evaluate(()=>window.pending.shift().reject(new Error('offline')));await page.getByText('Payment status could not be checked. Please retry.',{exact:true}).waitFor();await page.evaluate(()=>window.verified('3'));await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.attempts),2);assert.equal(await page.evaluate(()=>window.buys),1);
}));
test('foreground status cannot refresh after unmount or native identity change',()=>fixture(async page=>{
 await page.evaluate(()=>{window.admit('owner:a');window.dispatchEvent(new Event('reylumi:foreground'))});await page.waitForFunction(()=>window.pending.length===1);await page.evaluate(()=>{window.__reylumiAppLocalContext={version:1,nonce:'nonce-b',scopeEpoch:2,generation:'generation-b'};window.show(false);window.pending.shift().resolve({value:{message:'old owner'}})});await page.waitForTimeout(30);assert.deepEqual(await page.evaluate(()=>window.refreshes),[]);assert.equal(await page.evaluate(()=>window.buys),1);
}));
