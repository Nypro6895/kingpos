import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
function ownerFixtureCss(){
 if(process.env.KINGPOS_UI_CSS_PATH)return readFileSync(process.env.KINGPOS_UI_CSS_PATH,'utf8');
 const css=readFileSync('app/globals.css','utf8')+readFileSync('app/pos/owner-pos.css','utf8');
 return css.match(/:root\s*\{[^}]*\}/)[0]+css.slice(css.indexOf('/* Owner checkout:')).replace(/^.*?\*\//s,'');
}
test('Owner POS: isolated draft, one writer, offline submit survives reopen, retry once, saved ticket restores', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:60000},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);const root=resolve('.').replaceAll('\\','/');
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{OwnerPosClient}from'${root}/app/pos/owner-pos-client';import{OwnerQueueRuntime}from'${root}/app/pos/owner-queue-runtime';
 import*as ops from'${root}/lib/portable-operations';window.ops=ops;
 createRoot(document.getElementById('runtime')).render(<OwnerQueueRuntime scope="owner:salon:user"/>);
 const ownerRoot=createRoot(document.getElementById('root'));window.closePosPage=()=>ownerRoot.unmount();ownerRoot.render(<OwnerPosClient scope="owner:salon:user" salonId="salon" salonName="Test salon" initial={{staff:[],services:[],today:'2026-09-24',defaults:{staffCheckInEnabled:false,largeTurnThreshold:25,tipSuggestions:[10,15,20,25]}}}/>);`},jsx:'automatic',bundle:true,write:false,platform:'browser',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'refresh',namespace:'fixture'}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'fixture'}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
 b.onResolve({filter:/^\.\/actions$/},args=>args.importer.endsWith('owner-pos-client.tsx')?{path:'actions',namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path==='css'?'':args.path==='refresh'?`export function usePosResourceRefresh(){}`:args.path==='actions'?`export async function searchPosDeskCustomers(){return[];}`:`import React from 'react';export default function Link(props){return <a {...props}/>;}`}));
 }}]});
 let available=false,lost=true;const commits=new Map();let attempts=0;
 const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(req.url==='/api/pos/connection'){res.statusCode=available?200:503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({available}));return;}
 if(req.url==='/api/pos/owner/operations'){if(!available){res.statusCode=503;res.end('{}');return;}let raw='';for await(const part of req)raw+=part;const op=JSON.parse(raw);attempts++;commits.set(op.id,op);if(lost){lost=false;res.destroy();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({kind:'ok',data:{ticketId:op.id}}));return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<style>'+ownerFixtureCss()+'section[role=dialog]{position:fixed;inset:60px 12px;z-index:100;background:white;overflow:auto}body{margin:0}button,input{font:inherit}.fixture-header,.fixture-nav{display:none}@media(min-width:1280px){.fixture-header,.fixture-nav{display:none}}#hidden{display:none}</style><header class="fixture-header"></header><nav class="fixture-nav"></nav><div id="runtime"></div><div id="hidden" data-testid="customer-desktop-shell"></div><div id="root"></div><script src="/bundle.js"></script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 let diagnosticPage;
 try{const context=await browser.newContext({viewport:{width:390,height:844}});let page=await context.newPage();diagnosticPage=page;const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);await page.getByRole('button',{name:'Offline',exact:true}).waitFor();assert.equal(await page.evaluate(()=>navigator.onLine),true);await page.locator('[aria-label=Amount]:visible').fill('50');await page.setViewportSize({width:1440,height:900});await page.locator('[aria-label=Amount]:visible').waitFor();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50');await page.setViewportSize({width:390,height:844});await page.locator('[aria-label=Amount]:visible').waitFor();
 const second=await context.newPage();await second.goto(url);await second.getByRole('heading',{name:'POS is already open in another window'}).waitFor();assert.equal(await second.getByLabel('Amount',{exact:true}).count(),0);await second.close();
 await page.reload();await page.locator('[aria-label=Amount]:visible').waitFor();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50');
 await page.getByRole('button',{name:'Submit',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('[aria-label="Amount"]')).find(e=>e.getBoundingClientRect().width>0).value==='');
 assert.equal((await page.evaluate(()=>window.ops.listPortableOperations('owner:salon:user'))).length,1);
 await page.locator('[aria-label=Amount]:visible').fill('30');await page.getByRole('button',{name:'Save for later',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('[aria-label="Amount"]')).find(e=>e.getBoundingClientRect().width>0).value==='');
 await page.close();page=await context.newPage();diagnosticPage=page;await page.goto(url);await page.locator('[aria-label=Amount]:visible').waitFor();await page.getByRole('button',{name:'Saved tickets (1)',exact:true}).click();await page.getByRole('dialog',{name:'Saved tickets',exact:true}).getByRole('button',{name:/^Walk-in/}).click();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'30');
 available=true;await page.evaluate(()=>window.closePosPage());await page.waitForFunction(async()=>(await window.ops.listPortableOperations('owner:salon:user'))[0]?.state==='synced');await page.reload();await page.locator('[aria-label=Amount]:visible').waitFor();
 assert.equal(commits.size,1);assert.ok(attempts>=2);const queued=await page.evaluate(()=>window.ops.listPortableOperations('owner:salon:user'));assert.equal(queued[0].state,'synced');assert.equal([...commits.values()][0].payload.lines[0].total,50);assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'30');
 assert.equal(await page.evaluate(()=>localStorage.getItem('kingpos:portable-draft:v1:salon:key:desktop')),null);
 }catch(error){console.log('UI diagnosis:',await diagnosticPage.locator('body').innerText(),await diagnosticPage.evaluate(()=>navigator.locks.query()));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
});

test('Owner reference layout: pickers, keypad targets, menus and responsive ticket recovery', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:60000},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);const root=resolve('.').replaceAll('\\','/');
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{OwnerPosClient}from'${root}/app/pos/owner-pos-client';import{OwnerQueueRuntime}from'${root}/app/pos/owner-queue-runtime';
 import*as ops from'${root}/lib/portable-operations';window.ops=ops;
 createRoot(document.getElementById('runtime')).render(<OwnerQueueRuntime scope="owner:salon:user"/>);
 const ownerRoot=createRoot(document.getElementById('root'));window.closePosPage=()=>ownerRoot.unmount();ownerRoot.render(<OwnerPosClient scope="owner:salon:user" salonId="salon" salonName="Test salon" initial={{staff:[{id:'alice',display_name:'Alice',today_status:'working',turns:{queueTurns:1}},{id:'bob',display_name:'Bob',today_status:'working',turns:{queueTurns:2}},...Array.from({length:24},(_,i)=>({id:'employee-'+i,display_name:'Employee '+i+' with a long name',today_status:'working',turns:{queueTurns:i%5,smallTurns:i%3}}))],services:[{id:'manicure',name:'Manicure',base_price:25},{id:'pedicure',name:'Pedicure',base_price:40},...Array.from({length:38},(_,i)=>({id:'service-'+i,name:'Service '+i+' with a long descriptive name',base_price:20+i}))],today:'2026-09-24',defaults:{staffCheckInEnabled:false,largeTurnThreshold:25,tipSuggestions:[10,15,20,25]}}}/>);`},jsx:'automatic',bundle:true,write:false,platform:'browser',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'refresh',namespace:'fixture'}));
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'fixture'}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
 b.onResolve({filter:/^\.\/actions$/},args=>args.importer.endsWith('owner-pos-client.tsx')?{path:'actions',namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path==='css'?'':args.path==='refresh'?`export function usePosResourceRefresh(){}`:args.path==='actions'?`export async function searchPosDeskCustomers(){return[];}`:`import React from 'react';export default function Link(props){return <a {...props}/>;}`}));
 }}]});
 let available=false,lost=true;const commits=new Map();let attempts=0;
 const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(req.url==='/api/pos/connection'){res.statusCode=available?200:503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({available}));return;}
 if(req.url==='/api/pos/owner/operations'){if(!available){res.statusCode=503;res.end('{}');return;}let raw='';for await(const part of req)raw+=part;const op=JSON.parse(raw);attempts++;commits.set(op.id,op);if(lost){lost=false;res.destroy();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({kind:'ok',data:{ticketId:op.id}}));return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<style>'+ownerFixtureCss()+'section[role=dialog]{position:fixed;inset:60px 12px;z-index:100;background:white;overflow:auto}body{margin:0}button,input{font:inherit}.fixture-header,.fixture-nav{display:none}@media(min-width:1280px){.fixture-header,.fixture-nav{display:none}}#hidden{display:none}</style><header class="fixture-header"></header><nav class="fixture-nav"></nav><div id="runtime"></div><div id="hidden" data-testid="customer-desktop-shell"></div><div id="root"></div><script src="/bundle.js"></script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 let diagnosticPage;
 try{const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();diagnosticPage=page;const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);
 await page.getByRole('button',{name:'Services',exact:true}).click();const picker=page.getByRole('dialog',{name:'Services',exact:true});await picker.getByRole('button',{name:/Manicure/}).click();assert.equal(await page.locator('dialog[open]').count(),0);
 await page.getByRole('button',{name:'Employees',exact:true}).click();await page.getByRole('dialog',{name:'Employees',exact:true}).getByRole('button',{name:/Alice/}).click();
 await page.locator('[aria-label=Amount]:visible').fill('30');
 const firstId=await page.evaluate(()=>JSON.parse(localStorage.getItem('kingpos:owner-cart:v1:owner:salon:user')).cart.id);
 await page.getByRole('button',{name:'+ Add another',exact:true}).click();await page.getByRole('button',{name:'Services',exact:true}).click();await page.getByRole('dialog',{name:'Services',exact:true}).getByRole('button',{name:/Pedicure/}).click();await page.getByRole('button',{name:'Employees',exact:true}).click();await page.getByRole('dialog',{name:'Employees',exact:true}).getByRole('button',{name:/Bob/}).click();
 await page.reload();await page.locator('[aria-label=Amount]:visible').waitFor();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'40');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kingpos:owner-cart:v1:owner:salon:user')).cart.id),firstId);
 await page.getByRole('button',{name:'Edit entry 1',exact:true}).click();await page.getByRole('button',{name:'5',exact:true}).click();await page.getByRole('button',{name:'0',exact:true}).click();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50');
 await page.getByRole('button',{name:'Tip',exact:true}).click();await page.getByRole('button',{name:'5',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.getByRole('button',{name:'Tip',exact:true}).getAttribute('aria-pressed'),'true');assert.match(await page.locator('.owner-adjustment-row').innerText(),/Tip.*\$5.00/s);
 await page.getByRole('button',{name:'Discount',exact:true}).click();await page.getByRole('button',{name:'5',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Tip',exact:true}).getAttribute('aria-pressed'),'false');assert.match(await page.locator('.owner-adjustment-row').last().innerText(),/Discount.*-\$5.00/s);assert.match(await page.locator('.owner-mobile-ticket .owner-total').innerText(),/\$90.00/);
 await page.reload();await page.getByRole('button',{name:'Discount',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Discount',exact:true}).getAttribute('aria-pressed'),'true');await page.getByRole('button',{name:'Edit entry 1',exact:true}).click();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50');
 await page.getByRole('button',{name:'More',exact:true}).click();const menus=page.getByRole('dialog',{name:'All menus',exact:true});for(const label of ['Payroll','Staff','Customers','Services','Notifications','My Place','Account Settings'])assert.ok(await menus.getByRole('link',{name:label,exact:false}).count(),label);await menus.getByRole('button',{name:'Close menus'}).click();assert.equal(await page.getByRole('link',{name:'Settings',exact:true}).getAttribute('href'),'/pos/settings');
 assert.ok(await page.locator('.owner-top-nav').evaluate(e=>e.scrollWidth>e.clientWidth));await page.locator('.owner-top-nav').evaluate(e=>e.scrollLeft=e.scrollWidth);assert.ok(await page.locator('.owner-top-nav').evaluate(e=>e.scrollLeft>0));
 for(const [width,height] of [[320,568],[360,640],[390,844],[430,932],[768,900],[820,900],[844,390],[980,600],[1024,768],[1440,900],[1920,1080]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No horizontal page overflow at ${width}`);
   assert.equal(await page.locator('.owner-submit button:last-child').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(242, 111, 61)',`Brand orange Submit at ${width}`);
   assert.equal(await page.getByRole('button',{name:'Services',exact:true}).isVisible(),width<980,`Service picker only on mobile at ${width}`);
   assert.equal(await page.getByRole('button',{name:'Employees',exact:true}).isVisible(),width<980,`Employee picker only on mobile at ${width}`);
   assert.equal(await page.getByRole('button',{name:'Decimal point',exact:true}).count(),0);
   assert.ok(await page.getByRole('button',{name:'Reset',exact:true}).isVisible());
   assert.ok(await page.locator('.owner-submit').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight+1),`Submit fits ${width}x${height}`);
   assert.ok(await page.locator('.owner-keypad').evaluate(e=>Array.from(e.children).every(key=>key.getBoundingClientRect().bottom<=document.querySelector('.owner-keypad-edit').getBoundingClientRect().top+1)),`Keypad does not overlap controls at ${width}`);
   if(width<980)assert.ok(await page.locator('.owner-inline-rows').evaluate(e=>Array.from(e.children).every((row,index,rows)=>!index||row.getBoundingClientRect().top>=rows[index-1].getBoundingClientRect().bottom-1)),`Ticket rows remain vertical at ${width}`);
   if(width>=980){assert.match(await page.locator('.owner-selection').innerText(),/Alice.*Manicure/);assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50');assert.ok(await page.locator('.owner-receipt .owner-total').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight+1));assert.ok(await page.locator('.owner-keypad').evaluate(e=>e.querySelector('[data-key="7"]').getBoundingClientRect().top<e.querySelector('[data-key="1"]').getBoundingClientRect().top));}
   if(process.env.KINGPOS_UI_SCREENSHOT_DIR){await page.locator('.owner-top-nav').evaluate(e=>e.scrollLeft=0);await page.screenshot({path:resolve(process.env.KINGPOS_UI_SCREENSHOT_DIR,`owner-reference-${width}x${height}.png`)});}
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Services',exact:true}).click();const servicesDialog=page.getByRole('dialog',{name:'Services',exact:true});await servicesDialog.getByRole('searchbox',{name:'Search services'}).fill('Manicure');assert.equal(await servicesDialog.locator('button[aria-pressed=true]').evaluate(e=>getComputedStyle(e).borderTopColor),'rgb(242, 111, 61)');assert.ok(await servicesDialog.evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));
 if(process.env.KINGPOS_UI_SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.KINGPOS_UI_SCREENSHOT_DIR,'owner-services-popup.png')});await servicesDialog.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Employees',exact:true}).click();const employeesDialog=page.getByRole('dialog',{name:'Employees',exact:true});await employeesDialog.getByRole('searchbox',{name:'Search employees'}).fill('Alice');assert.equal(await employeesDialog.getByRole('button',{name:/Alice/}).count(),1);if(process.env.KINGPOS_UI_SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.KINGPOS_UI_SCREENSHOT_DIR,'owner-employees-popup.png')});await employeesDialog.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'More',exact:true}).click();if(process.env.KINGPOS_UI_SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.KINGPOS_UI_SCREENSHOT_DIR,'owner-more-popup.png')});await page.getByRole('button',{name:'Close menus'}).click();
 const originalCart=await page.evaluate(()=>localStorage.getItem('kingpos:owner-cart:v1:owner:salon:user'));
 await page.evaluate(raw=>{const saved=JSON.parse(raw);const first=saved.cart.lines[0];saved.savedAt=Date.now();saved.cart={...saved.cart,amount:'',staffId:null,serviceId:null,lines:[first,...Array.from({length:12},(_,i)=>({...first,id:'long-ticket-'+i,serviceLabel:'Long service '+(i+1)+' with additional details',staffName:'Employee with a long name',amountInput:'10',amountParts:[10],total:10}))]};localStorage.setItem('kingpos:owner-cart:v1:owner:salon:user',JSON.stringify(saved));},originalCart);await page.reload();await page.locator('[aria-label=Amount]:visible').waitFor();
 for(const [width,height] of [[320,568],[390,844],[844,390],[1440,900]]){
   await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const list=page.locator(width<980?'.owner-inline-rows':'.owner-receipt .owner-lines');assert.ok(await list.evaluate(e=>e.scrollHeight>e.clientHeight),'Long ticket scrolls within its panel');assert.ok(await page.locator('.owner-submit').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight+1));
   if(process.env.KINGPOS_UI_SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.KINGPOS_UI_SCREENSHOT_DIR,`owner-long-ticket-${width}.png`)});
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Tip',exact:true}).click();await page.getByRole('button',{name:'2',exact:true}).click();await page.getByRole('button',{name:'Edit entry 13',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.ok(await page.locator('.owner-inline-rows').evaluate(e=>{const selected=e.querySelector('[data-selected=true]').getBoundingClientRect(),panel=e.getBoundingClientRect();return selected.top>=panel.top-1&&selected.bottom<=panel.bottom+1;}),'Selected service stays visible after switching from Tip');
 await page.evaluate(raw=>localStorage.setItem('kingpos:owner-cart:v1:owner:salon:user',raw),originalCart);await page.setViewportSize({width:1440,height:900});await page.reload();await page.locator('[aria-label=Amount]:visible').waitFor(); await page.getByRole('button',{name:'Tip',exact:true}).click();await page.getByRole('button',{name:'6',exact:true}).click();assert.equal(await page.getByLabel('Tip amount',{exact:true}).inputValue(),'6');await page.getByRole('button',{name:'5',exact:true}).click();assert.equal(await page.getByLabel('Tip amount',{exact:true}).inputValue(),'65');await page.getByRole('button',{name:'Backspace',exact:true}).click();assert.equal(await page.getByLabel('Tip amount',{exact:true}).inputValue(),'6');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Tip',exact:true}).click();await page.getByRole('button',{name:'5',exact:true}).click();await page.getByRole('button',{name:'Edit entry 1',exact:true}).click();
 await page.getByRole('button',{name:'/',exact:true}).click();await page.getByRole('button',{name:'1',exact:true}).click();await page.getByRole('button',{name:'0',exact:true}).click();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50/10');assert.match(await page.locator('.owner-mobile-ticket .owner-total').innerText(),/\$100.00/);
 await page.getByRole('button',{name:'Employees',exact:true}).click();await page.getByRole('dialog',{name:'Employees',exact:true}).getByRole('button',{name:/Bob/}).click();await page.getByRole('button',{name:'Employees',exact:true}).click();await page.getByRole('dialog',{name:'Employees',exact:true}).getByRole('button',{name:/Alice/}).click();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50/10');
 await page.getByRole('button',{name:'Submit',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('[aria-label="Amount"]')).find(e=>e.getBoundingClientRect().width>0)?.value==='');
 const queued=await page.evaluate(()=>window.ops.listPortableOperations('owner:salon:user'));assert.equal(queued.length,1);assert.equal(queued[0].payload.ownerCartId,firstId);assert.equal(queued[0].payload.tipAmount,5);assert.equal(queued[0].payload.discountValue,5);assert.deepEqual(queued[0].payload.lines.map(l=>[l.staffId,l.serviceId,l.total]),[['alice','manicure',60],['bob','pedicure',40]]);assert.deepEqual(queued[0].payload.lines[0].amountParts,[50,10]);
 await page.locator('[aria-label=Amount]:visible').fill('30');await page.getByRole('button',{name:'Tip',exact:true}).click();await page.getByRole('button',{name:'2',exact:true}).click();await page.getByRole('button',{name:'Reset',exact:true}).click();
 const resetCart=await page.evaluate(()=>JSON.parse(localStorage.getItem('kingpos:owner-cart:v1:owner:salon:user')).cart);assert.equal(resetCart.amount,'');assert.equal(resetCart.tip,'');assert.equal(resetCart.discount,'');assert.equal(resetCart.lines.length,0);assert.equal((await page.evaluate(()=>window.ops.listPortableOperations('owner:salon:user'))).length,1);
 }catch(error){console.log('UI diagnosis:',await diagnosticPage.locator('body').innerText(),await diagnosticPage.evaluate(()=>navigator.locks.query()));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
});


test('Owner POS tabs stay in workspace and preserve mounted checkout', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:60000},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);const root=resolve('.').replaceAll('\\','/');
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
 import{OwnerWorkspaceFrame}from'${root}/app/pos/owner-workspace-frame';import{OwnerPosTabs}from'${root}/app/pos/owner-pos-tabs';
 function Checkout(){const[value,setValue]=useState('50');useEffect(()=>{window.mounts=(window.mounts||0)+1;},[]);return <><OwnerPosTabs active="pos"/><input aria-label="Draft amount" value={value} onChange={e=>setValue(e.target.value)}/></>;}
 createRoot(document.getElementById('root')).render(<OwnerWorkspaceFrame salonName="Test salon" checkout={<Checkout/>}><a href="/pos-tickets?date=2026-10-06">Ticket date</a><form action="/reports" method="get"><input name="date" value="2026-10-06" readOnly/><button>Filter report</button></form></OwnerWorkspaceFrame>);
 `},jsx:'automatic',bundle:true,write:false,platform:'browser',plugins:[{name:'workspace',setup(b){
 b.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'fixture'}));
 b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path==='css'?'':args.path==='next/link'?`import React from 'react';export default function Link({href,onClick,...props}){return <a {...props} href={href} onClick={e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.navigate(href);}}}/>;}`:`import{useSyncExternalStore}from'react';window.currentPath='/pos';window.navigate=href=>{window.currentPath=href;window.dispatchEvent(new Event('navigate'));};export function usePathname(){return useSyncExternalStore(fn=>{window.addEventListener('navigate',fn);return()=>window.removeEventListener('navigate',fn)},()=>window.currentPath.split('?')[0]);}export function useRouter(){return{push:window.navigate};}`}));
 }}]});
 const server=createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<style>'+ownerFixtureCss()+'</style><div id="root"></div><script src="/bundle.js"></script>');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.getByLabel('Draft amount').fill('125');
 const routes=[['Ticket','/pos/ticket'],['Book','/pos/book'],['Check In','/pos/check-in'],['Report','/pos/report']];
 for(const[label,path]of routes){await page.getByRole('link',{name:label,exact:true}).click();assert.equal(await page.evaluate(()=>window.currentPath),path);assert.equal(await page.locator('.owner-top-nav a[aria-current=page]:visible').textContent(),label);await page.getByRole('link',{name:'POS',exact:true}).click();assert.equal(await page.getByLabel('Draft amount').inputValue(),'125');assert.equal(await page.evaluate(()=>window.mounts),1);}
 await page.getByRole('link',{name:'Ticket',exact:true}).click();await page.getByRole('link',{name:'Ticket date'}).click();assert.equal(await page.evaluate(()=>window.currentPath),'/pos/ticket?date=2026-10-06');
 await page.getByRole('link',{name:'Report',exact:true}).click();await page.getByRole('button',{name:'Filter report'}).click();assert.equal(await page.evaluate(()=>window.currentPath),'/pos/report?date=2026-10-06');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
