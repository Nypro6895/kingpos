import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const root=path.resolve(process.env.MARKET_SYSTEM_SOURCE||'.');
const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {BookingDepositProduct} from '@/app/market/booking-deposit-product';createRoot(document.getElementById('root')).render(<BookingDepositProduct salonId="salon"/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':root},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'component-boundaries',setup(api){
 const mocks={
  'next/navigation':`const router={push(path){window.appPaths.push(path)}};export function useRouter(){return router}`,
  'next/link':`export default function Link({children}){return children}`,
  'next/image':`export default function Image(){return null}`,
  '@/components/workspace-language':`export function useWorkspaceTranslation(){return x=>x}`,
  './booking-deposit-purchase-actions':`export async function beginBookingDepositCheckoutAction(){return {url:'https://checkout.stripe.com/c/pay/test'}}`,
 };
 api.onResolve({filter:/\.css$/},a=>({path:a.path,namespace:'style'}));
 api.onLoad({filter:/.*/,namespace:'style'},()=>({contents:'export default {}'}));
 api.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'mock'}:undefined);
 api.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));
}}]});
test('Booking Deposit opens the native payment bridge and keeps its confirmation screen in the app',{timeout:60000},async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({userAgent:'Mozilla/5.0 iPhone ReylumiIOS/1.0'});
  await page.route('https://reylumi.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('https://reylumi.test/market/booking-deposit');
  await page.evaluate(()=>{window.appPaths=[];window.nativeCalls=[];window.__reylumiNativePayments=1;window.webkit={messageHandlers:{reylumi:{postMessage:m=>window.nativeCalls.push(m)}}};});
  await page.addScriptTag({content:result.outputFiles[0].text});
  await page.getByRole('button',{name:'Add to Reylumi',exact:true}).click();
  await page.waitForFunction(()=>window.appPaths.length===1);
  assert.deepEqual(await page.evaluate(()=>window.nativeCalls),[{action:'open-payment',url:'https://checkout.stripe.com/c/pay/test'}]);
  assert.deepEqual(await page.evaluate(()=>window.appPaths),['/market/booking-deposit/payment?salon=salon']);
  assert.equal(new URL(page.url()).hostname,'reylumi.test');
  await page.evaluate(()=>{window.__reylumiNativePayments=undefined;window.alert=message=>window.updateMessage=message;});
  await page.getByRole('button',{name:'Add to Reylumi',exact:true}).click();
  await page.waitForFunction(()=>!!window.updateMessage);
  assert.equal(await page.evaluate(()=>window.nativeCalls.length),1);
  assert.equal(await page.evaluate(()=>window.appPaths.length),1);
 }finally{await browser.close();}
});
