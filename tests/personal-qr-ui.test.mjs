import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createServer} from 'node:http';import {build} from 'esbuild';import {chromium} from 'playwright-core';

test('Personal QR, account check-in, Ready/prices/history and owner scan → info → Send/Cancel stay connected', {timeout:60000},async()=>{
 const bundle=await build({bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {PersonalQrClient} from './app/qr/personal-qr-client';import {PersonalQrStaffConnector} from './app/staff/personal-qr-connector';
  import {DeskRelay} from './app/service-relay/desk-relay';import {ROLE_NAVIGATION} from './app/role-navigation';import {WorkspaceNavigationIcon} from './components/workspace-navigation-icon';
  const uuid='00000000-0000-4000-8000-000000000100';window.personalCode='reylumi:personal:'+uuid;
  window.state={userId:'user1',code:window.personalCode,expiresAt:new Date(Date.now()+900000).toISOString(),updatedAt:new Date().toISOString(),visits:[]};
  window.catalog={salonId:'salon1',salonName:'King Nails Spa LLC',services:[{id:'s1',name:'Pedicure'},{id:'s2',name:'Gel add-on'},{id:'s3',name:'Manicure'},...Array.from({length:7},(_,i)=>({id:'extra'+i,name:'Extra service '+i}))]};
  window.calls=[];window.routes=[];window.fail=false;
  window.resume=()=>window.dispatchEvent(new Event('focus'));
  window.updateReady=()=>{window.state.visits[0].ready={at:new Date().toISOString(),staffName:'Nene',chair:'3'};window.resume()};
  window.updateWorking=()=>{window.state.visits[0]={...window.state.visits[0],status:'in_service',ready:null,workingStaff:['Nene'],lines:[{id:'l1',serviceName:'Pedicure',staffName:'Nene',amount:45},{id:'l2',serviceName:'Gel add-on',staffName:'Nene',amount:15}]};window.resume()};
  window.updatePaid=()=>{window.state.visits[0]={...window.state.visits[0],status:'paid',ticketId:'ticket1',workingStaff:[],receipt:{ticketId:'ticket1',ticketNumber:'T1',status:'closed',discountType:'fixed_amount',discountValue:0,taxRate:0,tipType:'fixed_amount',tipValue:10,services:[{id:'l1',name:'Pedicure',lineTotal:45,staffName:'Nene'},{id:'l2',name:'Gel add-on',lineTotal:15,staffName:'Nene'}],payments:[{amount:70}]}};window.resume()};
  window.setOnline=value=>{Object.defineProperty(navigator,'onLine',{configurable:true,value});window.dispatchEvent(new Event(value?'online':'offline'))};
  window.desk={installed:true,staff:[{id:'staff1',name:'Nene'}],services:[],tickets:[{visitId:'v1',customerName:'Anna',queueNumber:28,status:'waiting',revision:1,canNotifyReady:true,offers:[],lines:[],requestedServices:[{id:'s1',name:'Pedicure'}]}]};
  const mode=new URLSearchParams(location.search).get('mode');
  createRoot(document.getElementById('root')).render(mode==='owner'?<PersonalQrStaffConnector salonId="salon1" viewerId="owner1" closeHref="/staff"><button>Create new profile</button><select aria-label="Legacy staff selector"><option>Existing profile</option></select></PersonalQrStaffConnector>:mode==='pos'?<DeskRelay salonId="salon1"/>:<><header>Reylumi · Personal <span>Notifications</span></header><PersonalQrClient viewerId="user1" initial={structuredClone(window.state)}/><nav>{ROLE_NAVIGATION.personal.links.map(link=><a key={link.id} href={link.href}><WorkspaceNavigationIcon name={link.icon}/>{link.label}</a>)}</nav></>);
 `},plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/(^\.\/actions$|app\/qr\/actions$)/},()=>({path:'actions',namespace:'fixture'}));
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
  b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'sync',namespace:'fixture'}));
  b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='language'?`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`:a.path==='sync'?`export function subscribePosChanges(){return ()=>{}}`:a.path==='next/navigation'?`export const useRouter=()=>({replace:url=>window.routes.push(url),refresh:()=>window.routes.push('refresh')});`:a.path==='next/link'?`export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`:String.raw`
   export async function loadPersonalQr(){if(window.fail)throw Error('offline');return {data:structuredClone(window.state)}}
   export async function loadPersonalQrCatalog(viewer,entry){window.calls.push({kind:'catalog',viewer,entry});return {catalog:window.catalog}}
   export async function checkinPersonalQr(viewer,input){window.calls.push({kind:'checkin',viewer,input});window.state.visits=[{visitId:'v1',salonId:'salon1',salonName:'King Nails Spa LLC',queueNumber:28,status:'waiting',checkedInAt:new Date().toISOString(),ticketId:null,receipt:null,ready:null,lines:[],workingStaff:[],requestedServices:window.catalog.services.filter(s=>input.services.includes(s.id))}];return {visitId:'v1'}}
   export async function previewPersonalStaffQr(scope,code){window.calls.push({kind:'preview',scope,code});return {preview:{userId:'user1',name:'Anna Nguyen',phoneHint:'••• 1234',emailHint:'a•••@example.invalid',status:'available'}}}
   export async function sendPersonalStaffQr(scope,code){window.calls.push({kind:'send',scope,code});return {status:'pending'}}
   export async function loadServiceRelay(){return {data:window.desk}}
   export async function submitServiceRelay(){return {ok:true}};export async function saveServiceRelayAtDesk(){return {ok:true}}
   export async function notifyPersonalReady(input){window.calls.push({kind:'ready',input});return {ok:true}}
  `}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding-bottom:75px;font:15px Arial;background:#fbfcfc}header{padding:18px;color:#27534d;border-bottom:1px solid #e2eeea}header span{float:right;font-size:12px}nav{display:flex;justify-content:space-around;position:fixed;bottom:0;left:0;right:0;background:white;border-top:1px solid #dbeae5;padding:12px 0}nav a{display:grid;justify-items:center;gap:4px;text-decoration:none;color:#5f7a73;font-size:12px}nav svg{width:20px;height:20px}nav a[href='/qr']{color:#187d79}${css}</style><div id="root"></div><script>${js}</script></html>`)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const out='artifacts/personal-qr-20261025';fs.mkdirSync(out,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=async(mode='')=>{await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);await page.waitForTimeout(60)};
  await open();await page.getByRole('img',{name:'Your Personal ID QR'}).waitFor();assert.equal(await page.getByText('Staff connection',{exact:true}).count(),0);
  for(const width of [320,375,390,430,768,1280]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Personal QR overflow ${width}`)}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/personal-qr-390.png',fullPage:true});
  await page.getByText('Have a check-in link?',{exact:true}).click();await page.getByRole('textbox',{name:'Salon check-in link'}).fill('https://reylumi.com/check-in/00000000-0000-4000-8000-000000000200');await page.getByRole('button',{name:'Open check-in',exact:true}).click();
  const services=page.getByRole('region',{name:'Choose check-in services'});await services.waitFor();assert.equal(await services.getByRole('textbox').count(),0);assert.ok(!(await services.innerText()).includes('Anna'));
  const choices=services.getByRole('checkbox');for(let i=0;i<8;i++)await choices.nth(i).check();assert.equal(await choices.nth(8).isDisabled(),true);for(let i=7;i>=0;i--)await choices.nth(i).uncheck();assert.equal(await choices.nth(8).isEnabled(),true);
  await services.getByLabel('Pedicure',{exact:true}).check();await services.getByLabel('Gel add-on',{exact:true}).check();await page.screenshot({path:out+'/check-in-services-390.png',fullPage:true});
  await page.getByRole('button',{name:'Check in',exact:true}).click();await page.getByText('Waiting',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='checkin').length),1);
  await page.evaluate(()=>window.updateReady());await page.getByText('Your staff is ready',{exact:true}).waitFor();await page.screenshot({path:out+'/customer-ready-390.png',fullPage:true});
  await page.evaluate(()=>window.updateWorking());await page.getByText('In service',{exact:true}).waitFor();await page.getByText('$60.00',{exact:true}).waitFor();
  await page.evaluate(()=>window.setOnline(false));await page.getByText('Offline. Showing the last saved status and prices.').waitFor();assert.equal(await page.getByText('$60.00',{exact:true}).count(),1);
  await page.evaluate(()=>{window.setOnline(true);window.updatePaid()});await page.getByText('Paid',{exact:true}).waitFor();await page.getByText('$70.00',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'View receipt'}).getAttribute('href'),'/activity/receipts/ticket1');assert.equal(await page.getByRole('img',{name:'Your check-in QR',exact:true}).count(),0);
  await page.getByRole('button',{name:'My personal QR',exact:true}).click();await page.getByRole('img',{name:'Your Personal ID QR'}).waitFor();assert.equal(await page.getByRole('link',{name:'History',exact:true}).getAttribute('href'),'/activity');
  await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:experience-reset')));assert.equal(await page.getByRole('img',{name:'Your Personal ID QR'}).count(),0);
  await open('owner');await page.getByText('Enter Personal QR code',{exact:true}).click();await page.getByRole('textbox',{name:'Personal QR code'}).fill('reylumi:personal:00000000-0000-4000-8000-000000000100');await page.getByRole('button',{name:'Find account',exact:true}).click();
  const preview=page.getByRole('region',{name:'Scanned user information'});await preview.waitFor();assert.equal(await page.getByRole('combobox').count(),0);assert.equal(await page.getByRole('button',{name:'Create new profile',exact:true}).count(),0);
  assert.deepEqual(await preview.getByRole('button').allTextContents(),['Cancel','Send']);await page.screenshot({path:out+'/owner-scan-send-cancel-390.png',fullPage:true});
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Scan personal QR',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='send').length),0);
  await page.getByText('Enter Personal QR code',{exact:true}).click();await page.getByRole('button',{name:'Find account',exact:true}).click();await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>window.routes.includes('/staff'));assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='send').length),1);
  await open('pos');await page.getByRole('button',{name:/Service tickets/}).click();await page.getByLabel('Ready staff',{exact:true}).selectOption('staff1');await page.getByLabel('Ready chair',{exact:true}).fill('3');await page.getByRole('button',{name:'Notify Ready',exact:true}).click();await page.getByText('Ready sent.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='ready').length),1);
  await page.screenshot({path:out+'/pos-ready-390.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r))}
});
