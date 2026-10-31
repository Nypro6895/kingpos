import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('POS catalog preferences validate colors and normalize default prices', async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),contents:`export * from './lib/pos-service-catalog';export * from './lib/pos-workspace-preferences';`},bundle:true,write:false,format:'esm'});
 const {normalizeWorkspacePreferences,serviceDefaultAmount,serviceCategoryColor}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 assert.equal(normalizeWorkspacePreferences(null).serviceCategoriesEnabled,false);
 const preferences=normalizeWorkspacePreferences({serviceCategoriesEnabled:true,showTip:false,serviceCategoryColors:{Nails:'#9973c2',Bad:'url(example)',Short:'#fff'}});
 assert.equal(preferences.serviceCategoriesEnabled,true);assert.equal(preferences.showTip,false);assert.deepEqual(preferences.serviceCategoryColors,{Nails:'#9973c2'});
 assert.equal(serviceCategoryColor('Nails',preferences.serviceCategoryColors),'#9973c2');
 assert.equal(serviceDefaultAmount('25.50'),'25.5');for(const price of [null,undefined,-5,NaN,Infinity,'bad'])assert.equal(serviceDefaultAmount(price),'');
});

test('POS contiguous category colors, default price and replacement preserve submitted amounts', {timeout:60000,skip:!process.env.TEST_BROWSER_PATH},async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{PosDeskClient}from'./app/pos/pos-desk-client';
 import{DEFAULT_WORKSPACE_PREFERENCES as defaults}from'./lib/pos-workspace-preferences';
 window.grouped=true;
 const services=[{id:'a',name:'Manicure',category:'Nails',base_price:25},{id:'b',name:'Pedicure',category:'Feet',base_price:40},{id:'c',name:'Repair',category:null,base_price:5},{id:'d',name:'Gel Nails',category:'Nails',base_price:40}];
 const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<PosDeskClient preferences={{...defaults,serviceCategoriesEnabled:window.grouped,serviceCategoryColors:{Nails:'#9973c2',Feet:'#3b9e93'}}} surface="portable" activeSession={null} liveDraft={null} defaults={{adsFooter:'',largeTurnThreshold:25,showServiceName:true,showStaffName:true,staffCheckInEnabled:false,taxEnabled:false,tipSuggestions:[5,10,15,20]}} salonName="Fixture" services={services} staff={[{id:'staff',display_name:'Alice',job_title:'Professional',is_active:true,avatar_url:null,today_status:'checked_in',turns:{largeTurns:0,queueTurns:0,receiptLargeTurns:0,smallTurns:0,totalTurns:0}}]} actions={{submitPosDeskReceipt:async input=>{window.receipt=input;return{ok:true,ticketId:'ticket',ticketNumber:'T1'};}}}/>);window.render();
 `},bundle:true,write:false,jsx:'automatic',outdir:'fixture',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundary',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
 b.onResolve({filter:/supabase\/browser$/},()=>({path:'supabase',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='navigation'?'const router={refresh(){},push(){},replace(){}};export const useRouter=()=>router;export const usePathname=()=>"/pos/portable";':'export const createSupabaseBrowserClient=()=>null;'}));
 b.onResolve({filter:/\/actions$/},({path,importer})=>({path:resolve(path.startsWith('@/')?path.slice(2):join(dirname(importer),path))+'.ts',namespace:'actions'}));
 b.onLoad({filter:/.*/,namespace:'actions'},async({path})=>({contents:[...(await readFile(path,'utf8')).matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(match=>
 `export async function ${match[1]}(){throw Error('Unexpected action: ${match[1]}');}`).join('\n')}));
 }}]});
 const js=built.outputFiles.find(file=>file.path.endsWith('.js')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?js:'<div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  const catalog=page.locator('[data-pos-service-catalog]');await catalog.waitFor();
  assert.equal(await catalog.locator('[data-pos-service-folder]').count(),0);
  assert.deepEqual(await catalog.locator('[data-pos-service-tile]').evaluateAll(elements=>elements.map(e=>e.textContent)),['Manicure$25.00','Gel Nails$40.00','Pedicure$40.00','Repair$5.00']);
  assert.equal(await catalog.getByRole('button',{name:/Repair/}).isVisible(),true);
  assert.equal(await catalog.getByRole('button',{name:/Manicure/}).count(),1);
  const color=await catalog.getByRole('button',{name:/Manicure/}).evaluate(e=>e.style.borderTopColor);assert.equal(color,'rgb(153, 115, 194)');assert.equal(await catalog.getByRole('button',{name:/Gel Nails/}).evaluate(e=>e.style.borderTopColor),color);
  await page.getByText('Alice',{exact:true}).first().click();
  await catalog.getByRole('button',{name:/Manicure/}).click();
  const amount=page.locator('[data-pos-current-input]');assert.match(await amount.textContent(),/\$25/);
  const keypad=page.locator('[data-pos-amount-panel]');await keypad.getByRole('button',{name:'3',exact:true}).click();await keypad.getByRole('button',{name:'0',exact:true}).click();assert.match(await amount.textContent(),/\$30/);
  await amount.click();await keypad.getByRole('button',{name:'4',exact:true}).click();await keypad.getByRole('button',{name:'5',exact:true}).click();assert.match(await amount.textContent(),/\$45/);
  await keypad.getByRole('button',{name:'/',exact:true}).click();await keypad.getByRole('button',{name:'5',exact:true}).click();assert.match(await amount.textContent(),/\$45\/5/);
  await catalog.getByRole('button',{name:/Pedicure/}).click();assert.match(await amount.textContent(),/\$40/);
  await page.evaluate(()=>{window.grouped=false;window.render();});await page.waitForFunction(()=>document.querySelectorAll('[data-pos-service-tile]').length===4);
  assert.equal(await catalog.locator('[data-pos-service-tile]').count(),4);
  await page.getByRole('button',{name:'Submit',exact:true}).click();await page.waitForFunction(()=>!!window.receipt);
  assert.deepEqual(await page.evaluate(()=>window.receipt.lines.map(line=>[line.serviceId,line.amountInput])),[['a','45/5'],['b','40']]);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

test('POS main services stay visible and configured add-ons open only from their folder', {timeout:60000,skip:!process.env.TEST_BROWSER_PATH},async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{ServiceCatalog}from'./app/pos/service-catalog';
 const root=createRoot(document.getElementById('root'));window.locked=false;window.render=()=>root.render(<ServiceCatalog services={[{id:'main',name:'Full Set',base_price:40},{id:'addon',name:'French Tip',base_price:10,booking_parent_service_id:'main'},{id:'main2',name:'Pedicure',base_price:25},{id:'addon2',name:'Design',base_price:5,booking_parent_service_id:'main'}]} preferences={{serviceCategoriesEnabled:false,serviceCategoryColors:{}}} disabled={window.locked} onSelect={id=>window.selected=id}/>);window.render();
 `},bundle:true,write:false,jsx:'automatic',outdir:'fixture',plugins:[{name:'navigation',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const usePathname=()=>"/pos/portable";'}));}}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{const page=await browser.newPage({viewport:{width:1000,height:700}});await page.goto('http://127.0.0.1:'+server.address().port);const catalog=page.locator('[data-pos-service-catalog]');await catalog.waitFor();assert.deepEqual(await catalog.locator('[data-pos-service-tile]').evaluateAll(els=>els.map(el=>el.textContent)),['Full Set$40.00','Pedicure$25.00']);
 const folder=page.getByRole('button',{name:'Add-ons (2)',exact:true});await folder.click();const dialog=page.getByRole('dialog',{name:'Add-on services',exact:true});await dialog.waitFor();assert.deepEqual(await dialog.locator('[data-pos-service-tile]').evaluateAll(els=>els.map(el=>el.textContent)),['French Tip$10.00','Design$5.00']);
 await dialog.getByRole('heading').click();assert.equal(await dialog.isVisible(),true);await page.mouse.click(2,2);await dialog.waitFor({state:'hidden'});
 await folder.click();await dialog.getByRole('button',{name:/French Tip/}).click();await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.selected),'addon');
 await folder.click();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await page.evaluate(()=>{window.locked=true;window.render();});await page.waitForFunction(()=>document.querySelector('[data-pos-service-folder]').disabled);assert.equal(await folder.isDisabled(),true);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

test('Portable service metadata is scoped to the verified salon and existing RPC IDs',async()=>{
 const built=await build({entryPoints:['lib/pos-service-catalog-server.ts'],bundle:true,write:false,format:'esm',plugins:[{name:'server-fixture',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));b.onResolve({filter:/market-payments$/},()=>({path:'market',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='empty'?'':`export const marketServiceClient=()=>({from(table){globalThis.scopeCalls.push(['table',table]);return{select(fields){globalThis.scopeCalls.push(['select',fields]);return this;},eq(field,value){globalThis.scopeCalls.push(['eq',field,value]);return this;},in(field,value){globalThis.scopeCalls.push(['in',field,value]);return Promise.resolve(globalThis.scopeResult);}}}});`}));}}]});
 const {withPortableServiceAddOns}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 globalThis.scopeCalls=[];globalThis.scopeResult={data:[{id:'extra',booking_parent_service_id:'main'},{id:'main',booking_parent_service_id:null}],error:null};const services=[{id:'main',name:'Full Set'},{id:'extra',name:'Design'}];const result=await withPortableServiceAddOns(services,'verified-salon');assert.deepEqual(result.map(s=>[s.id,s.booking_parent_service_id]),[['main',null],['extra','main']]);assert.ok(globalThis.scopeCalls.some(c=>c[0]==='eq'&&c[1]==='salon_id'&&c[2]==='verified-salon'));assert.ok(globalThis.scopeCalls.some(c=>c[0]==='in'&&c[1]==='id'&&c[2].join(',')==='main,extra'));
 globalThis.scopeResult={data:null,error:{message:'unavailable'}};await assert.rejects(withPortableServiceAddOns(services,'verified-salon'),/Unable to load service groups/);delete globalThis.scopeCalls;delete globalThis.scopeResult;
});
