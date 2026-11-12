import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('Staff Scan: compact single amount, listing popup, held/Done edits, deletion and final POS settlement', {timeout:120000}, async()=>{
 const bundle=await build({bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {StaffScanClient} from './app/staff/scan/staff-scan-client';
  import {ROLE_NAVIGATION} from './app/role-navigation';import {WorkspaceNavigationIcon} from './components/workspace-navigation-icon';
  const services=[{id:'s1',name:'Pedicure',price:45},{id:'s2',name:'Gel add-on',price:15},{id:'s3',name:'Manicure',price:30}];
  const customer=(id,name,number)=>({visitId:id,customerName:name,queueNumber:number,checkedInAt:'2026-10-25T14:12:00Z',status:'waiting',workingStaffName:null,requestedServices:services.slice(0,1)});
  window.scanState={enabled:true,staffId:'staff1',current:[],waiting:[customer('v1','Anna',28),customer('v2','Linda',29)],services};window.calls=[];window.fail=false;window.lost=false;
  window.publish=()=>window.listener?.({resource:'tickets'});
  window.setOnline=value=>{Object.defineProperty(navigator,'onLine',{configurable:true,value});window.dispatchEvent(new Event(value?'online':'offline'));};
  window.settle=()=>{window.scanState.current=[];window.scanState.waiting=window.scanState.waiting.filter(c=>c.visitId!=='v1');window.publish();};
  window.render=()=>root.render(<><header>King Nails Spa LLC <small>Staff</small></header><StaffScanClient salonId="salon1" staffId="staff1" initial={structuredClone(window.scanState)}/><nav>{ROLE_NAVIGATION.staff.links.map(l=><a key={l.id} href={l.href}><WorkspaceNavigationIcon name={l.icon}/>{l.label}</a>)}</nav></>);
  const root=createRoot(document.getElementById('root'));window.render();
 `},plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/staff\/scan\/actions$/},()=>({path:'actions',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/actions$/},a=>a.importer.replaceAll('\\','/').includes('/staff/scan/')?{path:'actions',namespace:'fixture'}:undefined);
  b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'sync',namespace:'fixture'}));
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
  b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='language'?`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`:a.path==='link'?`import React from 'react';export default function Link({href,children}){return <a href={href}>{children}</a>}`:a.path==='sync'?`export function subscribePosChanges(id,callback){window.listener=callback;return ()=>{window.listener=null}};`:String.raw`
   const clone=()=>structuredClone(window.scanState);
   export async function loadStaffScan(){window.calls.push('load');if(window.fail)throw Error('offline');return {data:clone()};}
   export async function connectStaffScan(scope,input){window.calls.push('connect');if(window.connectError)return {error:window.connectError};const id=input.visitId??'v1',c=window.scanState.waiting.find(c=>c.visitId===id);let ticket=window.scanState.current.find(t=>t.visitId===id);if(!ticket){ticket={...c,scanMode:true,status:'in_service',revision:1,lines:[],offers:[{id:'o'+id,staffId:'staff1',staffName:'Nene',status:'working',serviceId:null,serviceName:'Service',expiresAt:''}]};window.scanState.current.unshift(ticket);}return {ticket:structuredClone(ticket)};}
   export async function saveStaffScan(scope,input){window.calls.push({kind:'save',input});if(window.fail)throw Error('offline');const ticket=window.scanState.current.find(t=>t.offers.some(o=>o.id===input.offerId));if(!ticket)return {error:'POS saved this ticket'};if(input.revision!==ticket.revision)return {error:'POS changed this work. Refresh before editing.'};ticket.lines=[...ticket.lines.filter(l=>l.offerId!==input.offerId),...input.lines.map(l=>({...l,amount:Number(l.amount),offerId:input.offerId,staffId:'staff1',staffName:'Nene',serviceName:window.scanState.services.find(s=>s.id===l.serviceId).name}))];ticket.revision++;if(!input.lines.length){ticket.offers.find(o=>o.id===input.offerId).status='declined';window.scanState.current=window.scanState.current.filter(t=>t.visitId!==ticket.visitId);}if(input.done){ticket.offers.find(o=>o.id===input.offerId).status='done';ticket.status='checkout';}if(window.lost){window.lost=false;throw Error('lost response')}return {ticket:structuredClone(ticket)};}
   export async function cancelStaffScan(scope,input){window.calls.push('cancel');window.scanState.current=window.scanState.current.filter(t=>!t.offers.some(o=>o.id===input.offerId));return {ok:true};}
  `}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:15px Arial;background:#fbfcfc}header{padding:14px;border-bottom:1px solid #e5eeec;color:#264d49}nav{display:flex;justify-content:space-around;padding:12px 4px;background:white}nav a{font-size:12px}nav svg{width:20px;height:20px}${css}</style><div id="root"></div><script>${js}</script></html>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const out='artifacts/phone-checkin-drafts-20261110';fs.mkdirSync(out,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:/Anna · #28/}).click();
  const amount=()=>page.getByRole('textbox',{name:'Amount',exact:true});
  await amount().waitFor();await page.waitForTimeout(100);
  assert.equal(await amount().inputValue(),'45');
  assert.equal(await page.getByText('Pedicure',{exact:true}).count(),1,'service name appears once');
  assert.equal(await page.getByText('$45.00',{exact:true}).count(),0,'default is only in the amount input');
  await page.getByRole('button',{name:'6',exact:true}).click();assert.equal(await amount().inputValue(),'6');
  await page.getByRole('button',{name:'0',exact:true}).click();assert.equal(await amount().inputValue(),'60');
  for(const width of [320,375,390,430,768,1280]){
   await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/staff-single-390.png',fullPage:true});
  await page.getByRole('button',{name:'Stand by',exact:true}).click();
  await page.getByRole('button',{name:/Anna · #28.*\$60.00/}).waitFor();
  await page.getByRole('button',{name:/Anna · #28/}).click();
  await amount().waitFor();await page.waitForTimeout(60);assert.equal(await amount().inputValue(),'60');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  const held=page.getByRole('button',{name:/Anna · #28.*Waiting for POS payment/});await held.waitFor();assert.equal(await held.isDisabled(),false);
  await held.click();await amount().waitFor();await page.waitForTimeout(60);
  await page.getByRole('button',{name:'5',exact:true}).click();await page.getByRole('button',{name:'5',exact:true}).click();assert.equal(await amount().inputValue(),'55');
  await page.getByRole('button',{name:'+ Service',exact:true}).click();
  await page.getByRole('textbox',{name:'Find services'}).fill('mani');await page.getByRole('button',{name:/Manicure.*\$30/}).click();
  await page.getByRole('dialog').waitFor();assert.equal(await amount().inputValue(),'30');
  await page.getByRole('button',{name:'Stand by',exact:true}).last().click();
  await page.getByRole('button',{name:/Anna · #28.*\$85.00/}).waitFor();
  await page.getByRole('button',{name:/Anna · #28/}).click();await page.getByRole('button',{name:/Manicure.*\$30/}).click();
  await page.screenshot({path:out+'/staff-service-popup-390.png',fullPage:true});
  await page.getByRole('button',{name:'Edit service',exact:true}).click();await page.getByRole('button',{name:/Gel add-on.*\$15/}).click();
  assert.equal(await amount().inputValue(),'15');await page.getByRole('button',{name:'Delete',exact:true}).click();
  await page.getByRole('button',{name:/Anna · #28.*\$55.00/}).waitFor();
  assert.equal(await page.evaluate(()=>window.scanState.current[0].offers.length),1,'Done edits reuse offer');
  await page.screenshot({path:out+'/staff-held-390.png',fullPage:true});
  await page.getByRole('button',{name:/Anna · #28/}).click();await amount().waitFor();await page.waitForTimeout(60);
  await page.evaluate(()=>{window.scanState.current[0].revision++;window.scanState.current[0].lines[0].amount=70;window.publish()});
  await page.getByRole('button',{name:'Use POS values',exact:true}).click();assert.equal(await amount().inputValue(),'70');
  await page.evaluate(()=>window.setOnline(false));await page.getByRole('button',{name:'9',exact:true}).click();await page.getByRole('button',{name:'Stand by',exact:true}).click();
  await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.scanState.current[0].lines[0].amount),70);
  await page.evaluate(()=>{window.settle();window.setOnline(true)});
  await page.waitForFunction(()=>!document.querySelector('main').innerText.includes('Anna'));
  assert.equal(await amount().count(),0);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('reylumi:staff-scan:')).length),0);
  // A multi-service check-in begins with a list; only the staff-selected service
  // gets a price editor and the keypad is already available inside that popup.
  await page.evaluate(()=>{window.scanState.waiting[0].requestedServices=window.scanState.services.slice(0,2);window.publish()});
  await page.getByRole('button',{name:/Linda · #29/}).click();assert.equal(await amount().count(),0);
  await page.getByRole('button',{name:/Pedicure.*Select service/}).click();await amount().waitFor();
  assert.equal(await amount().inputValue(),'45');await page.getByRole('button',{name:'4',exact:true}).click();await page.getByRole('button',{name:'0',exact:true}).click();
  await page.screenshot({path:out+'/staff-multi-390.png',fullPage:true});
  await page.getByRole('button',{name:'Done',exact:true}).last().click();await page.getByRole('button',{name:/Linda · #29.*\$40.00/}).waitFor();
  await page.evaluate(()=>{
   window.scanState.waiting=[];
   window.scanState.current=[{visitId:'v3',customerName:'Rose',queueNumber:30,scanMode:true,status:'in_service',revision:5,
    requestedServices:[{id:'s1',name:'Pedicure'}],offers:[{id:'prior',staffId:'staff2',staffName:'Kim',status:'done'},{id:'next',staffId:'staff1',staffName:'Nene',status:'working'}],
    lines:[{id:'prior-line',offerId:'prior',staffId:'staff2',staffName:'Kim',serviceId:'s1',serviceName:'Pedicure',amount:45}]}];window.publish();
  });
  await page.getByRole('button',{name:/Rose · #30/}).click();
  assert.equal(await amount().count(),0,'staff B must not receive a prefilled service already performed by A');
  await page.getByRole('button',{name:'+ Service',exact:true}).click();await page.getByRole('button',{name:/Pedicure.*\$45/}).click();
  assert.equal(await amount().inputValue(),'45','staff B may explicitly choose the same service');
  await page.getByRole('button',{name:'Stand by',exact:true}).click();await page.getByRole('button',{name:/Rose · #30/}).waitFor();
  assert.equal(await page.evaluate(()=>window.scanState.current[0].lines.length),2);
  assert.equal(await page.evaluate(()=>window.scanState.current[0].lines.find(l=>l.offerId==='prior').amount),45);
  await page.evaluate(()=>{window.scanState.waiting=[{visitId:'no-checkin',customerName:'Linda',queueNumber:31,requestedServices:[]}];window.publish();window.connectError='No check-in found for this customer at this salon. Ask the customer to check in, then scan their QR code again.';});
  await page.getByRole('button',{name:/Linda/}).click();
  await page.getByRole('alert').filter({hasText:'No check-in found'}).waitFor();
  await page.evaluate(()=>window.publish());
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('alert').filter({hasText:'No check-in found'}).count(),1,'background refresh preserves actionable Scan error');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  assert.equal(await page.getByRole('alert').filter({hasText:'No check-in found'}).count(),0);
  await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:experience-reset')));await page.getByRole('button',{name:/Linda/}).waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:/Linda/}).count(),0,'identity reset hides prior customers');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
