import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

test('Staff Scan: requested/additional services, automatic save, Stand by, Cancel, Done and POS settlement on reconnect', {timeout:120000}, async()=>{
 const bundle=await build({bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {StaffScanClient} from './app/staff/scan/staff-scan-client';
  import {ROLE_NAVIGATION} from './app/role-navigation';import {WorkspaceNavigationIcon} from './components/workspace-navigation-icon';
  const services=[{id:'s1',name:'Pedicure',price:45},{id:'s2',name:'Gel add-on',price:15},{id:'s3',name:'Manicure',price:30}];
  const customer=(id,name,number)=>({visitId:id,customerName:name,queueNumber:number,checkedInAt:'2026-10-25T14:12:00Z',status:'waiting',workingStaffName:null,requestedServices:services.slice(0,2)});
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
   export async function connectStaffScan(scope,input){window.calls.push('connect');const id=input.visitId??'v1',c=window.scanState.waiting.find(c=>c.visitId===id);let ticket=window.scanState.current.find(t=>t.visitId===id);if(!ticket){ticket={...c,scanMode:true,status:'in_service',revision:1,lines:[],offers:[{id:'o'+id,staffId:'staff1',staffName:'Nene',status:'working',serviceId:null,serviceName:'Service',expiresAt:''}]};window.scanState.current.unshift(ticket);}return {ticket:structuredClone(ticket)};}
   export async function saveStaffScan(scope,input){window.calls.push({kind:'save',input});if(window.fail)throw Error('offline');const ticket=window.scanState.current.find(t=>t.offers.some(o=>o.id===input.offerId));if(!ticket)return {error:'POS saved this ticket'};ticket.lines=input.lines.map(l=>({...l,amount:Number(l.amount),offerId:input.offerId,staffId:'staff1',staffName:'Nene',serviceName:window.scanState.services.find(s=>s.id===l.serviceId).name}));ticket.revision++;if(input.done){ticket.offers[0].status='done';ticket.status='checkout';}if(window.lost){window.lost=false;throw Error('lost response')}return {ticket:structuredClone(ticket)};}
   export async function cancelStaffScan(scope,input){window.calls.push('cancel');window.scanState.current=window.scanState.current.filter(t=>!t.offers.some(o=>o.id===input.offerId));return {ok:true};}
  `}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:15px Arial;background:#fbfcfc;padding-bottom:75px}header{padding:20px;border-bottom:1px solid #e5eeec;color:#264d49}header small{color:#718580;margin-left:8px}nav{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-around;padding:12px 4px;background:white;border-top:1px solid #dde9e6}nav a{display:grid;place-items:center;gap:4px;color:#667b78;text-decoration:none;font-size:12px}nav svg{width:20px;height:20px}nav a[href='/staff/scan']{color:#187d79}h3{font-size:15px;margin:10px 0}${css}</style><div id="root"></div><script>${js}</script></html>`);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const out='artifacts/staff-scan-20261025';fs.mkdirSync(out,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
  const open=async()=>{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:/Anna · #28/}).waitFor();await page.waitForTimeout(70);};
  await open();
  assert.equal(await page.getByRole('link',{name:'Scan',exact:true}).count(),1);assert.equal(await page.getByRole('link',{name:'Notifications',exact:true}).count(),0);
  for(const width of [320,375,390,430,768,1280]){
   await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`waiting overflow at ${width}`);
   if(width===390)await page.screenshot({path:out+'/waiting-390.png',fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:/Anna · #28/}).click();await page.getByRole('region',{name:'Enter services and amounts'}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Confirm|Accept|Find$/,exact:true}).count(),0,'no extra confirmation');
  await page.getByRole('button',{name:'Pedicure',exact:true}).click();await page.getByRole('textbox',{name:'Amount 1',exact:true}).fill('45');
  await page.getByRole('button',{name:'Gel add-on',exact:true}).click();await page.getByRole('textbox',{name:'Amount 2',exact:true}).fill('15');
  for(const width of [320,375,390,430,768,1280]){
    await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`service editor overflow at ${width}`);
    assert.ok(await page.getByRole('textbox',{name:'Amount 1',exact:true}).evaluate(node=>node.getBoundingClientRect().height>=48));
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:out+'/services-390.png',fullPage:true});
  await page.getByRole('textbox',{name:'Amount 2',exact:true}).press('Enter');
  await page.getByRole('button',{name:/Anna · #28.*\$60.00/}).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='save').length),1);
  await page.screenshot({path:out+'/saved-390.png',fullPage:true});
  console.log('Scan UI: initial selection and auto-save passed');
  await page.getByRole('button',{name:/Anna · #28/}).click();await page.getByRole('button',{name:'Find & add service',exact:true}).click();await page.getByRole('textbox',{name:'Find services'}).fill('mani');
  await page.getByRole('button',{name:/Manicure.*\$30/}).click();await page.getByRole('textbox',{name:'Amount 3',exact:true}).fill('30');await page.getByRole('textbox',{name:'Amount 3',exact:true}).press('Enter');
  await page.getByRole('button',{name:/Anna · #28.*\$90.00/}).waitFor();
  console.log('Scan UI: catalog addition passed');
  await page.getByRole('button',{name:/Anna · #28/}).click();await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.getByRole('button',{name:/Anna · #28.*Waiting for POS payment/}).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='save'&&c.input.done).length),1);
  assert.ok(await page.getByRole('button',{name:/Anna · #28/}).isDisabled());
  console.log('Scan UI: Done passed');
  await open();await page.getByRole('button',{name:/Anna · #28/}).click();await page.getByRole('button',{name:'Stand by',exact:true}).click();
  await page.getByRole('button',{name:/Anna · #28.*Enter amount.*Working.*Holding/}).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='save').length),0);
  await page.getByRole('button',{name:/Anna · #28/}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:/Anna · #28/}).waitFor();assert.equal(await page.getByRole('heading',{name:'Your current work'}).count(),0);
  console.log('Scan UI: Stand by and Cancel passed');
  await page.getByRole('button',{name:/Anna · #28/}).click();await page.getByRole('button',{name:'Pedicure',exact:true}).click();await page.getByRole('textbox',{name:'Amount 1',exact:true}).fill('45');await page.getByRole('textbox',{name:'Amount 1',exact:true}).press('Enter');
  await page.getByRole('button',{name:/Anna · #28.*\$45.00/}).waitFor();await page.getByRole('button',{name:/Anna · #28/}).click();
  await page.evaluate(()=>window.setOnline(false));await page.getByRole('textbox',{name:'Amount 1',exact:true}).fill('55');
  await page.getByRole('textbox',{name:'Amount 1',exact:true}).press('Enter');await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.scanState.current[0].lines[0].amount),45);
  await page.evaluate(()=>{window.settle();window.setOnline(true)});
  await page.waitForFunction(()=>!document.querySelector('main').innerText.includes('Anna'));
  assert.equal(await page.getByRole('textbox',{name:'Amount 1',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('reylumi:staff-scan:')).length),0,'settled drafts removed before any retry');
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='save').length),1,'offline edit never replays after POS settlement');
  await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:experience-reset')));assert.equal(await page.getByRole('button',{name:/Linda/}).count(),0,'identity reset hides prior customers');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
