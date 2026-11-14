import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

test('Ticket delivery modal fits small phones, keeps focus, shares the same card and clears collected credentials',{timeout:60000},async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{TicketGiftDelivery}from'./components/gift-card/ticket-gift-delivery';createRoot(document.getElementById('root')).render(<TicketGiftDelivery ticketId='ticket-fixture' saleId='sale-fixture' last4='1234'/>);`},bundle:true,write:false,outdir:'out',jsx:'automatic'});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const card={id:'same-card-fixture',salonName:'Synthetic Salon',balance:5000,last4:'1234',generation:1,status:'active',design:{background:'#f4e9e1',color:'#214a42',image:'',logo:'',elements:[{kind:'text',id:'title',text:'Synthetic Gift card',x:50,y:50,size:24}]}};
 let deliveryStatus='ready';const requests=[];
 const server=createServer(async(req,res)=>{
  requests.push(req.url);
  if(req.url==='/api/gift-cards/ticket-delivery'){let raw='';for await(const chunk of req)raw+=chunk;assert.deepEqual(JSON.parse(raw),{ticketId:'ticket-fixture',saleId:'sale-fixture'});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({deliveryStatus,ticketNumber:'T00001',giftSaleId:'sale-fixture',purchase:5000,card,...(deliveryStatus==='ready'?{token:'a'.repeat(64)}:{})}));return;}
  if(req.url==='/gift-cards/shared-default.webp'){res.setHeader('Content-Type','image/webp');res.end(await readFile('public/gift-cards/shared-default.webp'));return;}
  res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const out=resolve('artifacts/gift-wallet-recovery/browser');await mkdir(out,{recursive:true});const errors=[];
 try{
  const context=await browser.newContext();await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copiedGift=value;}}});Object.defineProperty(navigator,'share',{value:async value=>{window.sharedGift=value.url;}});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  for(const width of [320,390,820,1440]){
   deliveryStatus='ready';await page.setViewportSize({width,height:844});await page.goto(origin);
   const trigger=page.getByRole('button',{name:'Show gift card 1234',exact:true});await trigger.click();
   const dialog=page.getByRole('dialog',{name:'Ticket gift card',exact:true});await dialog.getByRole('img',{name:'Scan to receive gift card',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Close gift card delivery',exact:true}).evaluate(e=>e===document.activeElement),true,'focus enters the modal');
   assert.equal(await dialog.evaluate(e=>e.scrollWidth>e.clientWidth+1),false,'dialog content fits '+width);
   assert.ok((await dialog.locator('.gc-card').boundingBox()).height>100,'issued artwork stays visible '+width);
   const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,'modal bounds fit '+width);
   await dialog.getByRole('button',{name:'Copy link',exact:true}).click();await dialog.getByRole('button',{name:'Link copied',exact:true}).waitFor();await dialog.getByRole('button',{name:'Share link',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.copiedGift),origin+'/gift-cards#card='+'a'.repeat(64));assert.equal(await page.evaluate(()=>window.sharedGift),origin+'/gift-cards#card='+'a'.repeat(64));assert.equal(deliveryStatus,'ready');
   assert.equal(await dialog.locator('a[href*="#card="]').count(),0,'staff never self-opens the receive flow');
   await page.screenshot({path:join(out,'ticket-delivery-'+width+'.png')});
   deliveryStatus='collected';await dialog.getByText('This gift card has already been received or saved to the customer’s account.',{exact:true}).waitFor();
   assert.equal(await dialog.getByRole('img',{name:'Scan to receive gift card',exact:true}).count(),0);assert.equal(await dialog.getByRole('button',{name:'Share link',exact:true}).count(),0);
   await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(e=>e===document.activeElement),true,'focus returns to the ticket');
  }
  assert.equal(requests.some(path=>path.startsWith('/gift-cards#')||path==='/api/gift-cards'),false,'only the dedicated staff read is used');assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(done=>server.close(done));}
});
