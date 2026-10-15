import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import path from 'node:path';
const root=path.resolve(process.env.MARKET_SYSTEM_SOURCE||'.');
const script=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CardCheckoutPanel} from '@/app/market/card-checkout-panel';import {useHiddenPosts,notifyUserBlocksChanged} from '@/components/post-safety';import {openMarketPayment} from '@/lib/open-market-payment';window.changeBlocks=notifyUserBlocksChanged;window.openPayment=openMarketPayment;function Hidden(){const hidden=useHiddenPosts('viewer');return <output data-testid="hidden">{hidden.join(',')}</output>;}const state={salon_id:'salon',catalog:[{plugin_id:'booking-policy',name:'Booking policy',price_cents:100,fulfillment_ready:true,published:true}],settings:{tax_bps:0,fee_bps:0,fixed_fee_cents:0}};createRoot(document.getElementById('root')).render(<><CardCheckoutPanel pluginId="booking-policy" pluginName="Booking policy" billingState={state} hasActiveSubscription={false} ready onStateChange={()=>{}}/><Hidden/></>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':root},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'ui-server-stubs',setup(api){
 const mocks={
  'next/navigation':`const router={refresh(){window.refreshed++}};export function useRouter(){return router}`,
  'next/link':`export default function Link({children,...props}){return children}`,
  '@/components/workspace-language':`export function WorkspaceText({text}){return text}export function useWorkspaceTranslation(){return x=>x}`,
  '@/app/post-moderation/actions':`export async function loadHiddenPostIdentitiesAction(){return window.hiddenFromServer}export async function postModerationAction(){return{}}`,
  './card-payment-actions':`export async function startCardCheckout(id,external){window.checkoutCalls.push({id,external});return window.checkoutResult}export async function refreshCardPurchase(){window.statusChecks++;return{message:'Payment status checked'}}`,
  '@stripe/stripe-js/pure':`export function loadStripe(){window.embeddedLoads++;throw Error('Embedded must not load on iOS')}`,
 };
 api.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);api.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
}}]});

test('iOS Market stays outside embedded Stripe; block refresh is reversible and never persists remote hides',{timeout:60000},async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},userAgent:'Mozilla/5.0 iPhone ReylumiIOS/1.0'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://reylumi.test/**',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}));
  await page.goto('https://reylumi.test/market');
  await page.evaluate(()=>{window.hiddenFromServer=['beauty_post:blocked'];window.checkoutCalls=[];window.statusChecks=0;window.embeddedLoads=0;window.refreshed=0;window.checkoutResult={checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test'};window.nativeCalls=[];window.webkit={messageHandlers:{reylumi:{postMessage:m=>window.nativeCalls.push(m)}}};localStorage.setItem('reylumi-hidden-posts:viewer',JSON.stringify(['beauty_post:reported']));});
  await page.addScriptTag({content:script.outputFiles[0].text});
  await page.evaluate(()=>{window.__reylumiNativePayments=1;});
  await page.getByTestId('hidden').filter({hasText:'blocked'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('reylumi-hidden-posts:viewer'))),['beauty_post:reported']);
  await page.evaluate(()=>{window.hiddenFromServer=[];window.changeBlocks();});
  await page.waitForFunction(()=>document.querySelector('[data-testid="hidden"]').textContent==='beauty_post:reported');
  await page.getByRole('button',{name:'Buy with card',exact:true}).click();
  const checkout=page.getByRole('link',{name:'Continue to secure checkout'});await checkout.waitFor();assert.equal(await checkout.getAttribute('href'),'https://checkout.stripe.com/c/pay/cs_test');
  assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.evaluate(()=>window.embeddedLoads),0);assert.equal(await page.evaluate(()=>window.checkoutCalls[0].external),true);
  await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:foreground')));
  await page.waitForFunction(()=>window.statusChecks>0);
  await page.evaluate(()=>window.openPayment('https://billing.stripe.com/p/session/test'));
  assert.deepEqual(await page.evaluate(()=>window.nativeCalls),[{action:'open-payment',url:'https://billing.stripe.com/p/session/test'}]);
  await page.evaluate(()=>window.openPayment('https://connect.stripe.com/oauth/authorize?state=app-only'));
  assert.deepEqual(await page.evaluate(()=>window.nativeCalls.at(-1)),{action:'open-market-website'});
  assert.equal(await page.evaluate(()=>{try{window.openPayment('https://billing.stripe.com.evil.test/');return false}catch{return true}}),true);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
