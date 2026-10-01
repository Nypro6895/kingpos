import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('Portable: per-service assignments, preview, owner-style rows and split calendar', {timeout:60000,skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{PortableBookWorkspace}from'./app/pos/portable/book/portable-book-workspace';
 const services=[{id:'a',name:'Manicure',duration_minutes:30},{id:'b',name:'Pedicure',duration_minutes:40},{id:'c',name:'Polish',duration_minutes:20}];
 let item={id:'booking',customerId:'customer',customerName:'Maya',customerPhone:'555',serviceIds:['a','b'],serviceNames:['Manicure','Pedicure'],staffId:null,staffName:'Alice, Bob',lines:[{id:'la',serviceId:'a',serviceName:'Manicure',staffId:'alice',staffName:'Alice',price:30,startAt:'2026-09-25T14:00:00Z',endAt:'2026-09-25T14:30:00Z'},{id:'lb',serviceId:'b',serviceName:'Pedicure',staffId:'bob',staffName:'Bob',price:40,startAt:'2026-09-25T14:30:00Z',endAt:'2026-09-25T15:10:00Z'}],startAt:'2026-09-25T14:00:00.000Z',endAt:'2026-09-25T15:10:00.000Z',status:'pending',updatedAt:'version1'};
 window.manageCalls=[];window.slotCalls=[];window.busy=true;
 window.addEventListener('kingpos:booking-ticket',event=>{if(window.busy){event.detail.respond('Save the current POS ticket first.');return;}window.handoff=event.detail.appointment;event.detail.respond();});
 const manage=async request=>{window.manageCalls.push(request);if(request.action==='edit'){const p=request.payload;item={...item,serviceIds:p.serviceIds,serviceNames:p.serviceIds.map(id=>services.find(s=>s.id===id).name),staffId:p.staffId,staffName:p.staffId==='bob'?'Bob':'Alice',startAt:p.startAt,endAt:new Date(Date.parse(p.startAt)+p.serviceIds.reduce((n,id)=>n+services.find(s=>s.id===id).duration_minutes,0)*60000).toISOString()};}if(request.action==='confirm')item={...item,status:'confirmed'};if(request.action==='cancel')item={...item,status:'cancelled'};return{ok:true,data:{...item,lines:item.lines ?? item.serviceIds.map(id=>({id,serviceId:id,serviceName:services.find(s=>s.id===id).name,staffId:item.staffId,price:30}))}};};
 const slots=async input=>{window.slotCalls.push(input);return[{lines:item.lines,startAt:'2026-09-25T14:00:00.000Z',label:'09:00',endAt:new Date(Date.parse('2026-09-25T14:00:00Z')+input.serviceIds.reduce((n,id)=>n+services.find(s=>s.id===id).duration_minutes,0)*60000).toISOString()}]};
 createRoot(document.getElementById('root')).render(<PortableBookWorkspace data={{appointments:[item],date:'2026-09-25',timezone:'America/Chicago',salonName:'Fixture',canCreate:true,canCancel:true,canCreateTicket:true,services,staffServiceAssignments: services.flatMap(service => (service.id==="b"?["bob"]:["alice","bob"]).map(staffId=>({serviceId:service.id,staffId}))),staff:[{id:'alice',display_name:'Alice'},{id:'bob',display_name:'Bob'}],setupMessage:null}} action={async()=>({ok:false,error:'unused'})} manageAction={manage} slotsAction={slots}/>);
 `},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'workspace',setup(b){b.onResolve({filter:/portable-workspace-state$/},()=>({path:'stub',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const usePortableWorkspaceState=()=>null;'}));}}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-09-24T18:00:00Z'));await page.goto('http://127.0.0.1:'+server.address().port+'/pos/portable/book');

 assert.match(await page.getByRole('table').textContent(),/Alice, Bob/);
 assert.equal(await page.getByRole('button',{name:'Edit services for Maya'}).evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
 await page.getByRole('button',{name:'Calendar',exact:true}).click();
 await page.getByRole('button',{name:/9:00 AM, Maya, Manicure, Alice/}).waitFor();
 await page.getByRole('button',{name:/9:30 AM, Maya, Pedicure, Bob/}).click();

 await page.getByRole('heading',{name:'Edit appointment',exact:true}).waitFor();
 assert.match(await page.getByRole('region',{name:'Edit appointment',exact:true}).textContent(),/70 min/);
 assert.match(await page.getByRole('button',{name:'Professional for Manicure',exact:true}).textContent(),/Alice/);
 await page.getByRole('button',{name:'Professional for Pedicure',exact:true}).click();
 assert.equal(await page.getByRole('region',{name:'Quick edit'}).getByRole('button',{name:/Alice/}).count(),0);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Auto recommend',exact:true}).click();
 await page.waitForFunction(()=>window.slotCalls.at(-1)?.staffIds.every(id=>id===null));
 await page.getByRole('button',{name:'Use one professional…',exact:true}).click();
 assert.equal(await page.getByRole('region',{name:'Quick edit'}).getByRole('button',{name:/Alice/}).count(),0);
 await page.getByRole('button',{name:/Bob Availability checked/}).click();
 await page.waitForFunction(()=>window.slotCalls.at(-1)?.staffIds.every(id=>id==='bob'));
 await page.getByRole('button',{name:'Professional for Manicure',exact:true}).click();
 await page.getByRole('button',{name:/Alice Availability checked/}).click();
 await page.getByRole('button',{name:'Save changes'}).click();
 await page.getByRole('region',{name:'Edit appointment',exact:true}).waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>window.manageCalls.find(call=>call.action==='edit').payload.staffIds),['alice','bob']);
 if(process.env.BOOKING_SCREENSHOT) await page.screenshot({path:process.env.BOOKING_SCREENSHOT,fullPage:true});
 assert.deepEqual(errors,[]);

 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
