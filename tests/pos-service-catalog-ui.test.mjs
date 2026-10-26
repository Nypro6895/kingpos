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
