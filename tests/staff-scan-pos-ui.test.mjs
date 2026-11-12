import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('POS exposes editing and collection before phone Done and guards stale editor revisions', {timeout:30000},async()=>{
 const bundle=await build({bundle:true,write:false,outdir:'fixture',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';import {DeskRelay} from './app/service-relay/desk-relay';import {PortableDraftControls} from './app/pos/portable/portable-draft-controls';
  window.ticket={visitId:'v1',customerName:'Anna',queueNumber:28,status:'in_service',scanMode:true,revision:1,requestedServices:[{id:'s1',name:'Pedicure'}],offers:[{id:'o1',staffId:'staff1',staffName:'Nene',status:'working',serviceName:'Pedicure'}],lines:[{id:'l1',offerId:'o1',staffId:'staff1',staffName:'Nene',serviceId:'s1',serviceName:'Pedicure',amount:45}]};
  window.saved=[];window.submitted=[];window.held=0;window.resets=0;
  const load=async()=>({data:{installed:true,tickets:window.ticket?[structuredClone(window.ticket)]:[],staff:[{id:'staff1',name:'Nene'},{id:'staff2',name:'Bella'}],services:[{id:'s1',name:'Pedicure',price:45},{id:'s2',name:'Manicure',price:30}]}});
  const save=async input=>{window.saved.push(input);if(input.revision!==window.ticket.revision)return {error:'Ticket changed'};window.ticket={...window.ticket,revision:window.ticket.revision+1,status:'checkout',lines:input.lines.map(l=>({...l,amount:Number(l.amount),serviceName:l.serviceId==='s1'?'Pedicure':'Manicure',staffName:l.staffId==='staff1'?'Nene':'Bella'})),offers:window.ticket.offers.map(o=>({...o,status:'done'}))};return {ok:true}};
  const submit=async input=>{window.submitted.push(input);window.ticket=null;return {ok:true,ticketId:'paid'}};
  createRoot(document.getElementById('root')).render(<PortableDraftControls scope="salon1" active={true} activity="draft1" value={{id:"draft1"}} label="Anna" reset={async()=>{window.resets++}} restore={()=>true} parkShared={async()=>{window.held++;return true}} sharedTickets={<DeskRelay embedded salonId="salon1" load={load} save={save} submit={submit}/>}/>);
 `},plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/^\.\/actions$/},()=>({path:'actions',namespace:'fixture'}));
  b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'sync',namespace:'fixture'}));
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='language'?`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`:a.path==='sync'?`export function subscribePosChanges(id,cb){window.refresh=()=>cb({resource:'tickets'});return ()=>{}}`:`export const loadServiceRelay=async()=>({});export const submitServiceRelay=async()=>({});export const saveServiceRelayAtDesk=async()=>({});export const notifyPersonalReady=async()=>({});`,loader:'js'}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font:15px Arial}${css}</style><div id="root"></div><script>${js}</script></html>`)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);assert.equal(await page.getByRole('button',{name:/Service tickets/}).count(),0);await page.getByRole('button',{name:'Save for later',exact:true}).click();await page.getByRole('button',{name:/Anna · #28/}).click();assert.equal(await page.evaluate(()=>window.held),1);assert.equal(await page.evaluate(()=>window.resets),1);assert.equal(await page.evaluate(()=>localStorage.getItem('kingpos:parked-tickets:v1:salon1')),null);
  await page.getByRole('button',{name:'Payment collected · Submit'}).waitFor();
  await page.getByRole('button',{name:'Edit services & amounts'}).click();await page.getByLabel('POS amount 1',{exact:true}).fill('60');
  await page.getByLabel('Service 1',{exact:true}).selectOption('s2');await page.getByLabel('Staff 1',{exact:true}).selectOption('staff2');
  await page.evaluate(()=>{window.ticket.revision++;window.refresh()});
  await page.getByText('Ticket changed. Close this editor and reopen it to use the latest values.').waitFor();assert.ok(await page.getByRole('button',{name:'Save ticket'}).isDisabled());
  await page.getByRole('button',{name:'Cancel edit'}).click();await page.getByRole('button',{name:'Edit services & amounts'}).click();
  await page.getByLabel('POS amount 1',{exact:true}).fill('60');await page.getByLabel('Service 1',{exact:true}).selectOption('s2');await page.getByLabel('Staff 1',{exact:true}).selectOption('staff2');
  await page.getByRole('button',{name:'Save ticket'}).click();await page.getByText('Ready to pay',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.saved.length),1);assert.equal(await page.evaluate(()=>window.saved[0].lines[0].amount),'60');
  await page.getByRole('button',{name:'Payment collected · Submit'}).click();await page.getByText('No held tickets').waitFor();assert.equal(await page.evaluate(()=>window.submitted.length),1);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
