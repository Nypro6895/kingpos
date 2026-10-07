import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('Book keeps list, calendar, details and editor consistent after stale offline replay and server refresh', {timeout:90000}, async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{PortableBookWorkspace}from'./app/pos/portable/book/portable-book-workspace';
 const pending={id:'booking',customerId:'customer',customerName:'Maya',customerPhone:'555',serviceIds:['a'],serviceNames:['Manicure'],staffId:'alice',staffName:'Alice',startAt:'2026-09-25T14:00:00Z',endAt:'2026-09-25T14:30:00Z',status:'pending',updatedAt:'2026-09-24T15:00:00Z',lines:[{id:'line',serviceId:'a',serviceName:'Manicure',staffId:'alice',staffName:'Alice',price:30}]};
 window.server={...pending,status:'confirmed',updatedAt:'2026-09-24T16:00:00Z'};window.calls=[];
 window.operations=[{kind:'booking',state:'synced',payload:{localAppointment:{...pending,id:'local'}},result:pending}];
 window.replay=()=>window.dispatchEvent(new Event('kingpos:operations-changed'));
 const root=createRoot(document.getElementById('root'));
 window.refreshRows=[pending];const refresh=async()=>window.refreshRows;
 window.renderRows=rows=>root.render(<PortableBookWorkspace refreshAction={refresh} data={{appointments:rows,date:'2026-09-25',timezone:'America/Chicago',salonName:'Fixture',canCreate:true,canCancel:true,canCreateTicket:true,services:[{id:'a',name:'Manicure',duration_minutes:30,base_price:30}],staff:[{id:'alice',display_name:'Alice'}],staffServiceAssignments:[{serviceId:'a',staffId:'alice'}],setupMessage:null}} action={async()=>({ok:false,error:'unused'})} manageAction={async req=>{window.calls.push(req);if(req.action==='confirm')window.server={...window.server,status:'confirmed',updatedAt:'2026-09-24T18:00:00Z'};return{ok:true,data:window.server}}}/>);
 window.renderRows([pending]);
 `},bundle:true,write:false,outdir:'fixture',define:{'process.env':'{}'},jsx:'automatic',plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/portable-workspace-state$/},()=>({path:'workspace',namespace:'stub'}));
 b.onResolve({filter:/portable-operations$/},()=>({path:'operations',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='workspace'?'const state={scope:"fixture",offlineEnabled:true};export const usePortableWorkspaceState=()=>state;':'export const PORTABLE_OPERATIONS_CHANGED="kingpos:operations-changed";export const listPortableOperations=async()=>window.operations;export const savePortableOperation=async()=>{};'}));
 }}]});
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<style>body{margin:0;font-family:Arial}button{font:inherit}*{box-sizing:border-box}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-09-25T18:00:00Z'));await page.goto('http://127.0.0.1:'+server.address().port);
  const table=page.getByRole('table',{name:'Appointments'});
  await page.getByRole('button',{name:'Change status for Maya'}).click();
  assert.match(await page.getByRole('dialog',{name:'Appointment status'}).textContent(),/confirmed/);
  await page.evaluate(()=>window.replay());
  assert.match(await table.textContent(),/Confirmed/);assert.doesNotMatch(await table.textContent(),/Pending/);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  const card=page.getByRole('button',{name:/9:00 AM, Maya, Manicure, Alice, Confirmed/});await card.scrollIntoViewIfNeeded();await card.hover();await page.waitForTimeout(500);await page.mouse.move(0,0);await card.hover();await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').textContent(),/Confirmed/);
  await card.click();await page.getByRole('region',{name:'Edit appointment',exact:true}).waitFor();await page.evaluate(()=>window.replay());assert.equal(await page.getByRole('button',{name:/9:00 AM, Maya, Manicure, Alice, Pending/}).count(),0);
  await page.evaluate(()=>{window.server={...window.server,status:'cancelled',updatedAt:'2026-09-24T17:00:00Z'};window.renderRows([window.server]);});
  await page.getByText('This appointment changed on another device.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Save changes'}).isDisabled(),true);
  await page.getByRole('button',{name:'Close appointment editor'}).click();
  await page.getByRole('button',{name:/9:00 AM, Maya, Manicure, Alice, Cancelled/}).click();
  const details=page.getByRole('dialog');assert.match(await details.textContent(),/Cancelled/);
  await page.evaluate(()=>{window.server={...window.server,status:'completed',updatedAt:'2026-09-24T18:00:00Z'};window.renderRows([window.server]);window.replay();});
  await page.getByRole('dialog').getByText('Completed',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.action)),['read','read'],'Opening status or editor never confirms an appointment');
  await page.getByRole('button',{name:'Close appointment details'}).click();
  await page.evaluate(()=>{window.server={...window.server,status:'pending',updatedAt:'2026-09-24T19:00:00Z'};window.refreshRows=[window.server];window.dispatchEvent(new Event('focus'));});
  await page.getByRole('button',{name:/9:00 AM, Maya, Manicure, Alice, Pending/}).waitFor();
  await page.getByRole('button',{name:/9:00 AM, Maya, Manicure, Alice, Pending/}).click();
  assert.match(await page.getByRole('region',{name:'Edit appointment',exact:true}).textContent(),/pending/);
  await page.evaluate(()=>window.replay());
  assert.equal(await page.getByRole('button',{name:/9:00 AM, Maya, Manicure, Alice, Confirmed/}).count(),0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
