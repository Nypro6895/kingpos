import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('Front desk: searchable service rows, direct edits, real touch keyboard, calendar scale and opening hours', {timeout:90000}, async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{PortableBookWorkspace}from'./app/pos/portable/book/portable-book-workspace';import{PortableTouchKeyboard}from'./app/pos/portable/touch-keyboard';
 const services=[{id:'a',name:'Manicure',category:'Nails',duration_minutes:30,base_price:30},{id:'b',name:'Pedicure',category:'Feet',duration_minutes:40,base_price:40},{id:'c',name:'Polish',category:'Nails',duration_minutes:20,base_price:20},...Array.from({length:60},(_,i)=>({id:'s'+i,name:'Treatment '+i,category:'Spa',duration_minutes:30,base_price:30}))];
 const staff=[{id:'alice',display_name:'Alice'},{id:'bob',display_name:'Bob'},...Array.from({length:20},(_,i)=>({id:'t'+i,display_name:'Professional '+i}))];
 const lines=[{id:'la',serviceId:'a',serviceName:'Manicure',staffId:'alice',staffName:'Alice',price:30,startAt:'2026-09-25T14:00:00Z',endAt:'2026-09-25T14:30:00Z'},{id:'lb',serviceId:'b',serviceName:'Pedicure',staffId:'bob',staffName:'Bob',price:40,startAt:'2026-09-25T14:30:00Z',endAt:'2026-09-25T15:10:00Z'}];
 let item={id:'booking',customerId:'customer',customerName:'Maya',customerPhone:'312-555-0101',customerEmail:'maya@example.test',serviceIds:['a','b'],serviceNames:['Manicure','Pedicure'],staffId:null,staffName:'Alice, Bob',lines,startAt:'2026-09-25T14:00:00Z',endAt:'2026-09-25T15:10:00Z',status:'pending',updatedAt:'v1',notes:'Short nails'};
 window.saved=[];window.slotCalls=[];
 const slots=async input=>{window.slotCalls.push(input);let cursor=Date.parse(input.date+'T14:00:00Z');const lines=input.serviceIds.map((id,i)=>{const s=services.find(s=>s.id===id),startAt=new Date(cursor).toISOString();cursor+=s.duration_minutes*60000;const staffId=input.staffIds?.[i]||(['alice','bob'][i%2]);return{serviceId:id,serviceName:s.name,staffId,staffName:staff.find(s=>s.id===staffId)?.display_name,startAt,endAt:new Date(cursor).toISOString(),price:s.base_price};});return [{startAt:input.date+'T14:00:00Z',label:'09:00',endAt:new Date(cursor).toISOString(),lines}];};
 const manage=async req=>{if(req.action==='edit'){window.saved.push(req.payload);item={...item,...req.payload,updatedAt:'v2'};}if(req.action==='confirm')item={...item,status:'confirmed',updatedAt:'v2'};return{ok:true,data:item};};
 createRoot(document.getElementById('root')).render(<div data-portable-shell><PortableBookWorkspace data={{appointments:[item],date:'2026-09-25',timezone:'America/Chicago',salonName:'Fixture',canCreate:true,canCancel:true,canCreateTicket:true,services,staff,staffServiceAssignments:services.flatMap(s=>staff.filter(m=>s.id!=='b'||m.id==='bob').map(m=>({serviceId:s.id,staffId:m.id}))),setupMessage:null}} action={async input=>{window.created=input;return{ok:true,data:{...item,id:'new',...input,serviceNames:input.serviceIds.map(id=>services.find(s=>s.id===id).name)}};}} manageAction={manage} slotsAction={slots} staffOptionsAction={async input=>staff.map(m=>({staffId:m.id,available:m.id!=='t1'}))} hoursAction={async date=>({date,source:'salon',intervals:date==='2026-09-26'?[]:[{start:600,end:1080}]})} searchCustomersAction={async query=>query.toLowerCase().includes('maya')||query.includes('0101')?[{id:'customer',name:'Maya',phone:'312-555-0101',email:'maya@example.test'}]:[]}/><PortableTouchKeyboard enabled={true}/></div>);
 `},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'workspace',setup(b){b.onResolve({filter:/portable-workspace-state$/},()=>({path:'stub',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const usePortableWorkspaceState=()=>null;'}));}}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<style>body{margin:0;font-family:Arial}button{font:inherit}*{box-sizing:border-box}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-09-24T18:00:00Z'));await page.goto('http://127.0.0.1:'+server.address().port);
 for(const width of [1100,900,884,768]) {
  await page.setViewportSize({width,height:650});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Booking toolbar fits the viewport');
  assert.ok(await page.getByRole('table',{name:'Appointments'}).evaluate(el=>el.parentElement.scrollWidth<=el.parentElement.clientWidth),'Booking list has no horizontal scroll');
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Change professional for Maya'}).click();
 await page.getByRole('searchbox',{name:'Search professionals'}).fill('bob');
 await page.getByRole('button',{name:/Bob Available/}).click();
 assert.equal(await page.getByRole('group',{name:'Touch keyboard'}).count(),0);
 await page.getByRole('button',{name:'Professional for Pedicure',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:/Alice Available/}).count(),0);
 await page.getByRole('region',{name:'Quick edit'}).getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('button',{name:'Save changes'}).click();
 await page.getByRole('region',{name:'Edit appointment',exact:true}).waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>window.saved[0].staffIds),['bob','bob']);
 await page.getByRole('button',{name:'+ New appointment'}).click();
 await page.getByLabel('Customer name',{exact:true}).fill('Maya');
 await page.getByRole('option',{name:/Maya/}).click();
 await page.getByRole('button',{name:'Add service',exact:false}).click();
 const search=page.getByRole('searchbox',{name:'Search services'});await search.click();
 const keyboard=page.getByRole('group',{name:'Touch keyboard'});await keyboard.getByRole('button',{name:'p',exact:true}).click();
 await page.getByRole('button',{name:'Pedicure, 40 min',exact:true}).click();
 assert.equal(await keyboard.count(),1,'multi-add keeps touch keyboard open');
 await page.getByRole('button',{name:'Polish, 20 min',exact:true}).click();
 await page.getByRole('region',{name:'Quick edit'}).getByRole('button',{name:'Done',exact:true}).click();
 assert.equal(await keyboard.count(),0);
 await page.getByRole('button',{name:/Sep 25/}).click();
 await page.getByRole('button',{name:/09:00.*60 min/}).click();
 await page.getByRole('button',{name:'+ Add note',exact:true}).click();
 await page.getByRole('textbox',{name:'Appointment note'}).click();await keyboard.getByRole('button',{name:'a',exact:true}).click();
 const save=await page.getByRole('button',{name:'Create appointment',exact:true}).boundingBox(), kb=await keyboard.boundingBox();assert.ok(save.y+save.height<=kb.y,'Save remains above keyboard');
 await page.getByRole('button',{name:'Create appointment',exact:true}).click();await page.waitForFunction(()=>!!window.created);
 assert.deepEqual(await page.evaluate(()=>window.created.serviceIds),['b','c']);assert.equal(await page.evaluate(()=>window.created.notes),'a');
 await page.getByRole('button',{name:'Calendar',exact:true}).click();
 await page.getByLabel('Outside opening hours').first().waitFor();
 assert.equal(await page.getByRole('searchbox',{name:'Find calendar professional'}).count(),0);
 const card=page.getByRole('button',{name:/9:00 AM, Maya, Manicure, Alice/}).first();const before=await card.boundingBox();
 for(let step=0;step<14;step++)await page.getByRole('button',{name:'Drag to stretch time scale'}).press('ArrowUp');const after=await card.boundingBox();assert.ok(Math.abs(after.height-before.height*2)<2);
 await card.hover();await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').textContent(),/Manicure/);
 if(process.env.BOOKING_QA_DIR)await page.screenshot({path:process.env.BOOKING_QA_DIR+'/front-desk-calendar.png'});
 await page.getByLabel('Selected date').fill('2026-09-26');await page.getByText('The salon is closed on this date.').waitFor();
 await page.getByRole('button',{name:'Hide keyboard'}).click();
 await page.setViewportSize({width:768,height:900});await page.getByRole('button',{name:'+ New appointment'}).click();await page.getByLabel('Phone',{exact:true}).click();
 await keyboard.getByRole('button',{name:'1',exact:true}).click();assert.equal(await page.getByLabel('Phone',{exact:true}).inputValue(),'1');
 const picker=await page.getByRole('region',{name:'Quick edit'}).boundingBox(),kb2=await keyboard.boundingBox();assert.ok(picker.y+picker.height<=kb2.y);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(process.env.BOOKING_QA_DIR)await page.screenshot({path:process.env.BOOKING_QA_DIR+'/front-desk-touch.png'});
 assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
