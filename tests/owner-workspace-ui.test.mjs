import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
test('Owner POS: isolated draft, one writer, offline submit survives reopen, retry once, saved ticket restores', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:60000},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);const root=resolve('.').replaceAll('\\','/');
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{OwnerPosClient}from'${root}/app/pos/owner-pos-client';import{OwnerQueueRuntime}from'${root}/app/pos/owner-queue-runtime';
 import*as ops from'${root}/lib/portable-operations';window.ops=ops;
 createRoot(document.getElementById('runtime')).render(<OwnerQueueRuntime scope="owner:salon:user"/>);
 createRoot(document.getElementById('hidden')).render(<OwnerPosClient scope="owner:salon:user" salonId="salon" salonName="Test salon" initial={{staff:[],services:[],today:'2026-09-24',defaults:{staffCheckInEnabled:false,largeTurnThreshold:25,tipSuggestions:[]}}}/>);
 const ownerRoot=createRoot(document.getElementById('root'));window.closePosPage=()=>ownerRoot.unmount();ownerRoot.render(<OwnerPosClient scope="owner:salon:user" salonId="salon" salonName="Test salon" initial={{staff:[],services:[],today:'2026-09-24',defaults:{staffCheckInEnabled:false,largeTurnThreshold:25,tipSuggestions:[10,15,20,25]}}}/>);`},jsx:'automatic',bundle:true,write:false,platform:'browser',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'refresh',namespace:'fixture'}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
 b.onResolve({filter:/^\.\/actions$/},args=>args.importer.endsWith('owner-pos-client.tsx')?{path:'actions',namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path==='refresh'?`export function usePosResourceRefresh(){}`:args.path==='actions'?`export async function searchPosDeskCustomers(){return[];}`:`import React from 'react';export default function Link(props){return <a {...props}/>;}`}));
 }}]});
 let available=false,lost=true;const commits=new Map();let attempts=0;
 const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(req.url==='/api/pos/connection'){res.statusCode=available?200:503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({available}));return;}
 if(req.url==='/api/pos/owner/operations'){if(!available){res.statusCode=503;res.end('{}');return;}let raw='';for await(const part of req)raw+=part;const op=JSON.parse(raw);attempts++;commits.set(op.id,op);if(lost){lost=false;res.destroy();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({kind:'ok',data:{ticketId:op.id}}));return;}
 res.setHeader('Content-Type','text/html');res.end('<style>'+readFileSync('app/globals.css','utf8').split('/* Owner checkout:')[1].replace(/^.*?\*\//s,'')+'section[role=dialog]{position:fixed;inset:60px 12px;z-index:100;background:white;overflow:auto}body{margin:0}.fixture-header{height:62px}.fixture-nav{height:69px;position:fixed;bottom:0;width:100%}@media(min-width:1280px){.fixture-header,.fixture-nav{display:none}}#hidden{display:none}@media(min-width:1280px){#hidden{display:block}#root{display:none}}</style><header class="fixture-header"></header><nav class="fixture-nav"></nav><div id="runtime"></div><div id="hidden" data-testid="customer-desktop-shell"></div><div id="root"></div><script src="/bundle.js"></script>');
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

test('Owner mobile steps preserve one ticket across staff, back navigation and reopen', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:60000},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);const root=resolve('.').replaceAll('\\','/');
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{OwnerPosClient}from'${root}/app/pos/owner-pos-client';import{OwnerQueueRuntime}from'${root}/app/pos/owner-queue-runtime';
 import*as ops from'${root}/lib/portable-operations';window.ops=ops;
 createRoot(document.getElementById('runtime')).render(<OwnerQueueRuntime scope="owner:salon:user"/>);
 createRoot(document.getElementById('hidden')).render(<OwnerPosClient scope="owner:salon:user" salonId="salon" salonName="Test salon" initial={{staff:[{id:'alice',display_name:'Alice',today_status:'working',turns:{queueTurns:1}},{id:'bob',display_name:'Bob',today_status:'working',turns:{queueTurns:2}}],services:[{id:'manicure',name:'Manicure',base_price:25},{id:'pedicure',name:'Pedicure',base_price:40}],today:'2026-09-24',defaults:{staffCheckInEnabled:false,largeTurnThreshold:25,tipSuggestions:[]}}}/>);
 const ownerRoot=createRoot(document.getElementById('root'));window.closePosPage=()=>ownerRoot.unmount();ownerRoot.render(<OwnerPosClient scope="owner:salon:user" salonId="salon" salonName="Test salon" initial={{staff:[{id:'alice',display_name:'Alice',today_status:'working',turns:{queueTurns:1}},{id:'bob',display_name:'Bob',today_status:'working',turns:{queueTurns:2}}],services:[{id:'manicure',name:'Manicure',base_price:25},{id:'pedicure',name:'Pedicure',base_price:40}],today:'2026-09-24',defaults:{staffCheckInEnabled:false,largeTurnThreshold:25,tipSuggestions:[10,15,20,25]}}}/>);`},jsx:'automatic',bundle:true,write:false,platform:'browser',plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'refresh',namespace:'fixture'}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
 b.onResolve({filter:/^\.\/actions$/},args=>args.importer.endsWith('owner-pos-client.tsx')?{path:'actions',namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:root,contents:args.path==='refresh'?`export function usePosResourceRefresh(){}`:args.path==='actions'?`export async function searchPosDeskCustomers(){return[];}`:`import React from 'react';export default function Link(props){return <a {...props}/>;}`}));
 }}]});
 let available=false,lost=true;const commits=new Map();let attempts=0;
 const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(req.url==='/api/pos/connection'){res.statusCode=available?200:503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({available}));return;}
 if(req.url==='/api/pos/owner/operations'){if(!available){res.statusCode=503;res.end('{}');return;}let raw='';for await(const part of req)raw+=part;const op=JSON.parse(raw);attempts++;commits.set(op.id,op);if(lost){lost=false;res.destroy();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({kind:'ok',data:{ticketId:op.id}}));return;}
 res.setHeader('Content-Type','text/html');res.end('<style>'+readFileSync('app/globals.css','utf8').split('/* Owner checkout:')[1].replace(/^.*?\*\//s,'')+'section[role=dialog]{position:fixed;inset:60px 12px;z-index:100;background:white;overflow:auto}body{margin:0}.fixture-header{height:62px}.fixture-nav{height:69px;position:fixed;bottom:0;width:100%}@media(min-width:1280px){.fixture-header,.fixture-nav{display:none}}#hidden{display:none}@media(min-width:1280px){#hidden{display:block}#root{display:none}}</style><header class="fixture-header"></header><nav class="fixture-nav"></nav><div id="runtime"></div><div id="hidden" data-testid="customer-desktop-shell"></div><div id="root"></div><script src="/bundle.js"></script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 let diagnosticPage;
 try{const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();diagnosticPage=page;const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);
 await page.getByRole('button',{name:/Alice/}).click();await page.getByRole('button',{name:/Manicure/}).click();
 await page.locator('[aria-label=Amount]:visible').fill('30');
 await page.getByRole('button',{name:'Edit line',exact:true}).click();await page.getByRole('button',{name:'Staff / service',exact:true}).click();await page.getByRole('button',{name:/Alice/}).click();await page.getByRole('button',{name:/Manicure/}).click();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'30');
 const firstId=await page.evaluate(()=>JSON.parse(localStorage.getItem('kingpos:owner-cart:v1:owner:salon:user')).cart.id);
 await page.getByRole('button',{name:'+ Add another',exact:true}).click();await page.getByRole('button',{name:/Bob/}).click();await page.getByRole('button',{name:/Pedicure/}).click();
 await page.reload();await page.locator('[aria-label=Amount]:visible').waitFor();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'40');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('kingpos:owner-cart:v1:owner:salon:user')).cart.id),firstId);
 await page.getByRole('button',{name:'Edit line',exact:true}).click();await page.getByRole('dialog').getByText('Alice',{exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Edit entry 1',exact:true}).click();await page.getByRole('button',{name:'5',exact:true}).click();await page.getByRole('button',{name:'0',exact:true}).click();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50');await page.reload();await page.locator('[aria-label=Amount]:visible').waitFor();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50');
 await page.getByRole('button',{name:'Tip',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Tip',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('dialog[open]').count(),0);
 await page.getByRole('button',{name:'5',exact:true}).click();assert.match(await page.locator('.owner-adjustment-row').innerText(),/Tip.*\$5.00/s);
 await page.getByRole('button',{name:'Discount',exact:true}).click();await page.getByRole('button',{name:'5',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Tip $5.00',exact:true}).getAttribute('aria-pressed'),'false');assert.match(await page.locator('.owner-adjustment-row').last().innerText(),/Discount.*-\$5.00/s);
 assert.equal(await page.locator('.owner-mobile-total').innerText(),'Total\n$90.00');
 await page.reload();await page.getByRole('button',{name:'Discount $5.00',exact:true}).waitFor();assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'50');
 await page.getByRole('button',{name:'Edit entry 1',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Discount $5.00',exact:true}).getAttribute('aria-pressed'),'false');
 const fits=await page.locator('.owner-submit').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight);assert.ok(fits,'Submit stays inside the phone viewport');
 await page.setViewportSize({width:320,height:568});assert.ok(await page.locator('.owner-submit').evaluate(e=>e.getBoundingClientRect().bottom<=document.querySelector('.owner-checkout').getBoundingClientRect().bottom),'Small phone fits');await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Submit',exact:true}).click();await page.getByRole('button',{name:/Alice/}).waitFor();
 const queued=await page.evaluate(()=>window.ops.listPortableOperations('owner:salon:user'));assert.equal(queued.length,1);assert.equal(queued[0].payload.ownerCartId,firstId);assert.equal(queued[0].payload.tipAmount,5);assert.equal(queued[0].payload.discountValue,5);assert.deepEqual(queued[0].payload.lines.map(l=>[l.staffId,l.serviceId,l.total]),[['alice','manicure',50],['bob','pedicure',40]]);
 await page.setViewportSize({width:1440,height:900});await page.locator('[aria-label=Amount]:visible').waitFor();await page.getByRole('button',{name:/Alice/}).waitFor();await page.getByRole('button',{name:/Manicure/}).waitFor();
 }catch(error){console.log('UI diagnosis:',await diagnosticPage.locator('body').innerText(),await diagnosticPage.evaluate(()=>navigator.locks.query()));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
});
