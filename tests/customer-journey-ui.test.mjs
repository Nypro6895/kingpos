import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright-core';

test('real journey UI: tabs, filters, one detail read, legacy links, QR entry, safe mutations and bounded rows',{timeout:90000},async()=>{
 const root=process.cwd(),out='artifacts/customer-journey-20261029/browser';fs.mkdirSync(out,{recursive:true});
 const bundle=await build({bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{CustomerJourney,CustomerJourneyLoading}from'./app/activity/customer-journey';
 import{journeyFixture,journeyId}from'./tests/helpers/customer-journey-fixture.mjs';
 window.data=journeyFixture();window.reads=[];window.writes=[];window.refreshes=0;window.scope='scope-A';window.routes=[];
 window.details=(input)=>{const row=[...window.data.upcoming,...window.data.history].find(x=>x.type==="booking"&&x.bookingId===input.bookingId)||window.data.upcoming[0];const receipt=input.ticketId?{...window.data.history.find(x=>x.type==='purchase'),id:input.ticketId,closedAt:'2026-10-28T20:00:00Z',openedAt:'2026-10-28T19:00:00Z',services:[{id:'l1',name:'Gel Manicure',quantity:1,lineTotal:40,staffName:'Alex'},{id:'l2',name:'Classic Pedicure',quantity:1,lineTotal:50,staffName:'Alex'}],totals:{subtotal:90,discount_amount:0,tax_amount:0,tip_amount:18,total:108},payments:[{label:'Card',amount:108}],salon:{...row.salon,phone:'+15555550100'}}:null;return {booking:input.bookingId?{id:input.bookingId,status:row.bookingStatus||'confirmed',salon_id:journeyId(1),salon_timezone_snapshot:'America/Chicago',start_at:row.startAt,end_at:row.endAt,lines:row.services.map((s,i)=>({id:'line'+i,service_name_snapshot:s.name,line_total:s.lineTotal,quantity:1,duration_minutes:45,currentServiceBookable:true,assignedStaff:{displayName:'Alex'}})),salon:{name:row.salon.name,displayName:row.salon.name,city:'Milwaukee',state:'WI',phone:'+15555550100',publicDiscoveryEnabled:true},historyEvidence:row.historyEvidence}:null,receipt,error:null};};
 const app=createRoot(document.getElementById('root'));let revision=0;window.show=(options={})=>{app.render(options.failed?<CustomerJourneyLoading failed="Temporary connection issue" onRetry={()=>window.show()}/>:<CustomerJourney key={++revision} activity={window.data} {...options} onRefresh={async()=>{window.refreshes++}}/>)};window.show();
 `},plugins:[{name:'isolated-read-write-boundaries',setup(b){
  const stubs={
   'experience-scope':`export function useExperienceScope(){return{context:{authenticated:true,scope:window.scope}}}`,
   'workspace-language':`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`,
   'overlay-dismissal':`export function useCloseOnNavigation(){}`,
   'use-persistent-read-view':`export function usePersistentReadView(){}`,
   'customer-history-client':`export async function loadCustomerHistoryRead(scope,input){window.reads.push({scope,input});return window.details(input)}`,
   'next/link':`export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}`,
   'next/navigation':`export function useRouter(){return{refresh:()=>window.routes.push('refresh'),replace:href=>window.routes.push(href)}}`,
  };
  b.onResolve({filter:/(?:^next\/(?:link|navigation)$|\/(?:experience-scope|workspace-language|overlay-dismissal|use-persistent-read-view|customer-history-client)$)/},a=>({path:a.path.startsWith('next/')?a.path:a.path.split('/').at(-1),namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:root}));
  b.onLoad({filter:/\.[tj]sx?$/},async a=>{if(a.path.includes('node_modules'))return;const text=await fs.promises.readFile(a.path,'utf8');if(!/^\s*["']use server["'];/.test(text))return;const source=ts.createSourceFile(a.path,text,ts.ScriptTarget.Latest,true);const names=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)).map(n=>n.name.text);return{loader:'js',contents:names.map(name=>`export async function ${name}(...args){if(${JSON.stringify(name)}==='loadCustomerRescheduleSlotsAction')return{ok:true,data:{date:'2026-10-30',slots:[]}};if(${JSON.stringify(name)}==='cancelCustomerBookingAction'){window.writes.push({name:${JSON.stringify(name)},args});return{ok:true,bookingId:args[0].bookingId,message:'Cancelled'}};throw Error('Unexpected server boundary: ${name}')}`).join('\n')};});
 }}]});
 const js=bundle.outputFiles.find(x=>x.path.endsWith('.js')).text,modules=bundle.outputFiles.find(x=>x.path.endsWith('.css')).text;
 const candidates=new Set();for(const file of ['app/activity/customer-journey.tsx','app/activity/history-details-drawer.tsx','app/my-bookings/[bookingId]/booking-detail-actions.tsx','components/booking-deposit-receipt.tsx'])for(const token of fs.readFileSync(file,'utf8').match(/[^\s"'`<>{}=;(),]+/g)||[])candidates.add(token);
 const tw=await compile(fs.readFileSync('app/globals.css','utf8'),{base:root,onDependency:()=>{}});const css=tw.build([...candidates])+modules;
 const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{background:white}.fixtureHeader{height:109px;display:flex;align-items:center;justify-content:space-between;padding:40px 16px 0;border-bottom:1px solid #eee}.fixtureNav{position:fixed;bottom:0;left:0;right:0;height:88px;background:white;border-top:1px solid #eee;display:flex;justify-content:space-around;align-items:center;z-index:50;color:#8a7e84;font-size:12px}#root{padding-bottom:88px}</style><div class="fixtureHeader"><b>Personal</b><span>REYLUMI</span></div><div id="root"></div><div class="fixtureNav"><span>Explore</span><span style="color:#f26f3d">Bookings</span><span>Beauty</span><span>QR</span><span>More</span></div><script>${js}</script>`;
 fs.writeFileSync(path.join(out,'fixture.html'),html);
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{const page=await browser.newPage({viewport:{width:428,height:926}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('heading',{name:'Appointments & visits'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'View my QR',exact:true}).getAttribute('href'),'/qr?visit=00000000-0000-4000-8000-000000000090');
  assert.ok((await page.getByLabel('At salon').textContent()).includes('1:55 PM'),'arrival is server arrival, not2:30 appointment');
  await page.screenshot({path:path.join(out,'upcoming.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>window.reads.length+window.writes.length),0);
  await page.getByRole('tab',{name:'History',exact:true}).click();assert.equal(await page.getByLabel('Salon history').getByRole('button').count(),4);
  assert.equal(await page.getByText('Past appointment',{exact:true}).count(),1);assert.equal(await page.getByText('Visited',{exact:true}).count(),1);
  assert.equal(await page.getByText('$108.00',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Filter appointments and visits'}).click();await page.getByRole('dialog',{name:'Filter history'}).waitFor();
  await page.getByLabel('Status',{exact:true}).selectOption('cancelled');await page.getByRole('button',{name:'Apply filters'}).click();assert.equal(await page.getByLabel('Salon history').getByRole('button').count(),1);
  await page.getByRole('button',{name:'Filter appointments and visits'}).click();await page.getByRole('button',{name:'Reset',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Filter history'}).waitFor({state:'hidden'});await page.waitForFunction(()=>document.body.style.overflow!=='hidden');
  await page.getByRole('button',{name:/Details:.*Visited/}).click();await page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Visit & receipt'})}).waitFor();
  assert.equal(await page.evaluate(()=>window.reads.length),1);await page.screenshot({path:path.join(out,'receipt.png')});await page.getByRole('button',{name:'Close history details'}).click();assert.equal(await page.evaluate(()=>window.refreshes),0,'closing read-only details does not reload the list');
  await page.getByRole('tab',{name:'Upcoming',exact:true}).click();await page.getByRole('button',{name:/Details:.*Confirmed/}).click();await page.getByRole('button',{name:'Reschedule',exact:true}).waitFor();await page.getByRole('button',{name:'Cancel appointment',exact:true}).click();await page.getByRole('heading',{name:'Cancel this appointment?',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.writes.length),0,'opening cancellation is read only');
  const dialogs=page.getByRole('dialog');assert.equal(await dialogs.count(),2,'nested confirmation preserves outer drawer');await page.getByRole('button',{name:'Keep appointment',exact:true}).click();await page.getByRole('button',{name:'Close history details'}).click();
  await page.evaluate(()=>window.show({initialSelectedBookingId:'00000000-0000-4000-8000-000000009999'}));await page.getByRole('button',{name:'Close history details'}).waitFor();const deepReadCount=await page.evaluate(()=>window.reads.filter(x=>x.input.bookingId?.endsWith('009999')).length);assert.equal(deepReadCount,1,'outside-window legacy deep link is authorized once, then seeded into drawer');await page.getByRole('button',{name:'Close history details'}).click();
  await page.evaluate(()=>{window.data={...window.data,history:[],upcoming:[]};window.show()});await page.getByRole('heading',{name:'No upcoming appointments'}).waitFor();assert.equal(await page.getByRole('link',{name:'Check in at salon'}).getAttribute('href'),'/qr?scan=1');assert.equal(await page.getByRole('link',{name:'My QR',exact:true}).getAttribute('href'),'/qr');
  await page.evaluate(()=>window.show({failed:true}));await page.getByRole('button',{name:'Try again'}).click();await page.getByRole('heading',{name:'No upcoming appointments'}).waitFor();
  for(const width of [360,390,428,768,1280]){await page.setViewportSize({width,height:926});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow '+width);}
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed:true,realComponents:true,network:'Server action and identity boundaries isolated; no live account or DB writes',widths:[360,390,428,768,1280],checks:['tabs','receipt amount once','active arrival time','status filter','Escape restores scroll','one details read','no refresh on read-only close','nested cancellation opens without write','deep link one read','check-in scanner href','Personal QR href','empty','retry','responsive overflow'],limits:'Browser/component proof; not native or production E2E'},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
