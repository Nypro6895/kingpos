import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('Admin pricing preview and plugin purchase/recovery controls work on desktop and mobile', async()=>{
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{CommerceForm}from'./app/(app)/admin/market/commerce-form';
 import{BookingPolicyPanel}from'./app/market/booking-policy-panel';
 const params=new URLSearchParams(location.search);
 createRoot(document.getElementById('root')).render(params.has('plugin') ? <BookingPolicyPanel paymentsAvailable={params.has('ready')} state={{content:'Please arrive on time.',published:false,active:params.has('active'),subscribed:params.has('subscribed')}}/> : <CommerceForm configuration={{version:1,bank_name:'',bank_beneficiary:'',bank_account:'',bank_routing:'',bank_instructions:'',tax_bps:0,fee_bps:0,fixed_fee_cents:0,plugin_prices:{'vietnamese-language':399,'booking-policy':99,'booking-deposit':590,'checkin-receipt':470}}}/>);
 `},outfile:'bundle.js',bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'isolated-actions',setup(b){
 b.onResolve({filter:/^(next\/navigation|.*commerce-actions|.*booking-policy-actions)$/},args=>({path:args.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path.includes('navigation')?`export function useRouter(){return{refresh(){},push(){}}}`:args.path.includes('commerce-actions')?`export async function saveCommerceConfiguration(form){window.savedDraft=Object.fromEntries(form);return{ok:true,message:'Draft saved.'}}`:`export async function saveBookingPolicy(content,published){window.savedRules={content,published};return{saved:true}};export async function bookingPolicyPaymentAction(portal){return{url:portal?'https://billing.stripe.com/test':'https://checkout.stripe.com/test'}}`}));
 }}]});
 const js=result.outputFiles.find(file=>file.path.endsWith('.js')).text;
 const moduleCss=result.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'';
 const productionCss=fs.existsSync('.next/static/css')?fs.readdirSync('.next/static/css').filter(file=>file.endsWith('.css')).map(file=>fs.readFileSync('.next/static/css/'+file,'utf8')).join('\n'):'';
 const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url.startsWith('/bundle.js')?'application/javascript':'text/html');response.end(request.url.startsWith('/bundle.js')?js:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${productionCss}\n${moduleCss}\nbody{margin:0;padding:20px;background:#fafafa}#root{max-width:1100px;margin:auto}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const out='artifacts/market-commerce-audit-qa';fs.mkdirSync(out,{recursive:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:950});await page.goto(base);
   await page.getByLabel('Tax (%)',{exact:true}).fill('8');await page.getByLabel('Transaction fee (%)',{exact:true}).fill('2');await page.getByLabel('Fixed fee (USD)',{exact:true}).fill('0.30');
   const deposit=page.getByRole('row').filter({hasText:'Booking Deposit'});
   await deposit.getByRole('cell',{name:'$6.80',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:`${out}/admin-${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'Save draft configuration'}).click();await page.getByRole('status').filter({hasText:'Draft saved.'}).waitFor();
   assert.equal(await page.evaluate(()=>window.savedDraft.tax),'8');
   await page.getByLabel('Tax (%)',{exact:true}).fill('101');assert.equal(await page.getByRole('button',{name:'Save draft configuration'}).isDisabled(),true);
  }
  await page.goto(base+'?plugin');assert.equal(await page.getByRole('button',{name:'Subscribe · $0.99 / month'}).isDisabled(),true);
  await page.getByRole('button',{name:'Save rules',exact:true}).click();await page.getByRole('status').filter({hasText:'Booking rules saved.'}).waitFor();
  assert.equal(await page.evaluate(()=>window.savedRules.content),'Please arrive on time.');
  await page.goto(base+'?plugin&subscribed');assert.equal(await page.getByRole('button',{name:'Manage subscription',exact:true}).isEnabled(),true);
  await page.goto(base+'?plugin&active&ready');assert.equal(await page.getByRole('button',{name:'Subscribe · $0.99 / month'}).isDisabled(),true);
  await page.route('https://checkout.stripe.com/**',route=>route.fulfill({contentType:'text/html',body:'Checkout test destination'}));
  await page.goto(base+'?plugin&ready');await page.getByRole('button',{name:'Subscribe · $0.99 / month'}).click();await page.waitForURL('https://checkout.stripe.com/test');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
