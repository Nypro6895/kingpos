import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const out=path.resolve('artifacts/service-relay-qa');fs.mkdirSync(out,{recursive:true});
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{StaffRelay}from'./app/service-relay/staff-relay';import{DeskRelay}from'./app/service-relay/desk-relay';createRoot(document.getElementById('app')).render(<><StaffRelay salonId="salon"/><DeskRelay salonId="salon"/></>);`},bundle:true,outfile:path.join(out,'panel.js'),jsx:'automatic',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/service-relay\/actions$|^\.\/actions$/},()=>({path:'actions',namespace:'fixture'}));
 b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'sync',namespace:'fixture'}));
 b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({loader:'tsx',contents:p==='sync'?`export function subscribePosChanges(id,fn){window.listeners??=[];window.listeners.push(fn);return()=>{window.listeners=window.listeners.filter(f=>f!==fn)}};`:p==='language'?`export function WorkspaceText({text}){return text;}`:`
 window.calls=[];
 window.relay={installed:true,staffId:'anna',services:[{id:'full',name:'Full Set',price:40},{id:'pedi',name:'Pedicure',price:35}],tickets:[{visitId:'visit',queueNumber:28,customerName:'Linh',status:'waiting',revision:0,requestedServices:[{id:'full',name:'Full Set'}],lines:[],offers:[{id:'offer',staffId:'anna',staffName:'Anna',serviceId:'full',serviceName:'Full Set',status:'offered',expiresAt:'2099-01-01'}]}]};
 window.relay=JSON.parse(localStorage.getItem("mock-relay")??"null")??window.relay;export async function loadServiceRelay(){return{data:structuredClone(window.relay)}};
 export async function respondServiceRelay(id,accept){const t=window.relay.tickets[0];t.offers[0].status=accept?'working':'declined';t.status='in_service';t.revision++;localStorage.setItem("mock-relay",JSON.stringify(window.relay));return{ok:true}};
 export async function saveServiceRelay(input){window.calls.push(input);if(window.failSave)return{error:'Ticket changed. Refresh before saving.'};const t=window.relay.tickets[0];t.lines=input.lines.map(l=>({...l,offerId:'offer',staffId:'anna',staffName:'Anna',serviceName:window.relay.services.find(s=>s.id===l.serviceId).name,amount:Number(l.amount)}));t.revision++;if(input.done){t.offers[0].status='done';t.status='checkout'}localStorage.setItem("mock-relay",JSON.stringify(window.relay));return{ok:true}};
 export async function submitServiceRelay(input){window.submits=(window.submits??0)+1;await new Promise(r=>setTimeout(r,100));window.relay.tickets=[];return{ok:true,ticketId:'paid'}};
 export async function findServiceRelay(){return{ok:true}};
 `}));
}}]});
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/panel.css"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#f1f5f3;font-family:Arial,sans-serif}#app{max-width:480px;margin:auto}</style><div id="app"></div><script src="/panel.js"></script></html>`);
const server=http.createServer((req,res)=>{const file=path.join(out,req.url==='/'?'index.html':path.basename(req.url));if(!fs.existsSync(file)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const browser=await chromium.launch({executablePath:executable,headless:true});const errors=[];
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Accept',exact:true}).click();
  await page.getByLabel('Price 1',{exact:true}).fill('40');
  await page.waitForFunction(()=>window.calls.length===1);assert.equal(await page.getByLabel('Price 1').inputValue(),'40');
  await page.getByRole('button',{name:'+ Service',exact:true}).click();await page.getByLabel('Service 2').selectOption('pedi');await page.getByLabel('Price 2').fill('35');
  await page.waitForFunction(()=>window.calls.some(c=>c.lines.length===2));
  await page.screenshot({path:path.join(out,`staff-${width}.png`),fullPage:true});
  // A remote hint must not replace in-progress local edits.
  await page.evaluate(()=>{window.failSave=true});await page.getByLabel('Price 2').fill('37');await page.evaluate(()=>window.listeners.forEach(fn=>fn({resource:'tickets'})));
  assert.equal(await page.getByLabel('Price 2').inputValue(),'37');
  await page.getByRole('alert').waitFor();await page.reload();await page.getByLabel('Price 2').waitFor();assert.equal(await page.getByLabel('Price 2').inputValue(),'37');
  await page.getByRole('button',{name:'Done',exact:true}).click();await page.waitForFunction(()=>window.relay.tickets[0]?.status==='checkout');await page.evaluate(()=>window.listeners.forEach(fn=>fn({resource:'tickets'})));await page.getByRole('button',{name:/Service tickets/}).click();
  await page.getByRole('dialog',{name:'Service tickets'}).waitFor();await page.getByText('Ready to pay',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,`cashier-${width}.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Payment collected · Submit'}).dblclick();await page.getByText('No customers waiting.').waitFor();assert.equal(await page.evaluate(()=>window.submits),1);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  await page.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({widths:[390,1280],checks:['accept','auto-send prices','multiple services','preserve edits on refresh','restore after reload','shared cashier ticket','single Submit','Escape closes drawer'],errors},null,2));console.log('Service Relay UI checks passed at 390px and 1280px.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
