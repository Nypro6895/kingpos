import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

test('My Pay daily totals and Tickets date/detail/edit history fit mobile and desktop', {timeout:60000}, async()=>{
 const dir='artifacts/staff-pay-tickets/browser';mkdirSync(dir,{recursive:true});
 const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{StaffMyPay}from'@/app/staff/my-work/staff-pay-analysis';import{StaffTickets}from'@/app/staff/my-work/staff-tickets';
 window.navigated=[];function App(){const[tab,setTab]=useState('pay');
 const pay={period:{startDate:'2026-10-16',endDate:'2026-10-31'},periodOptions:[{startDate:'2026-10-16',endDate:'2026-10-31',value:'2026-10-16:2026-10-31'}],settings:[],history:[],status:{label:'Live'},line:{staff_id:'s',final_staff_income:678.28,final_cash_amount:277.96,final_check_amount:400.32,gross_sales:1112,staff_commission_gross:667.2,tip_amount:11.08,bonus_amount:0,tax_withheld:0,check_rate_used:60,commission_rate_used:60,tax_rate_used:0,pay_type_used:'commission',settings_used_snapshot:[],dailyTotals:[]},dailyRows:[{id:'day',businessDate:'2026-10-30',shopGross:55,commissionGross:33,tipAmount:0}]};
 const tickets={date:'2026-10-30',staffId:'s',tickets:[{id:'one',ticketNumber:'#1042',openedAt:'2026-10-30T15:30:00Z',closedAt:'2026-10-30T16:00:00Z',status:'closed',customerName:'Emma',serviceTotal:30,tip:0,services:[{id:'service',name:'Classic manicure with a very long detailed service description',quantity:1,unitPrice:30,price:30,removed:false}],history:[{id:'edit',at:'2026-10-31T14:10:00Z',actor:'Owner',source:'pos_ticket_items',before:{line_total:25},after:{line_total:30}}],activity:[{id:'activity',at:'2026-10-31T14:10:00Z',actor:'Owner',action:'service_updated'}]},{id:'two',ticketNumber:'#1048',openedAt:'2026-10-30T19:15:00Z',closedAt:null,status:'open',customerName:null,serviceTotal:25,tip:null,services:[],history:[],activity:[]}]};
 return <main><nav><button onClick={()=>setTab('pay')}>My Pay</button><button onClick={()=>setTab('tickets')}>Tickets</button></nav>{tab==='pay'?<StaffMyPay data={pay}/>:<StaffTickets data={tickets} timezone="America/Chicago"/>}</main>};createRoot(document.getElementById('root')).render(<App/>);`;
 await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,outfile:dir+'/fixture.js',jsx:'automatic',plugins:[{name:'adapters',setup(b){
  b.onResolve({filter:/ledger-actions|current-payroll-download-actions/},a=>({path:'actions',namespace:'fixture'}));
  b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onResolve({filter:/^@\/components\/(workspace-language|customer-name)$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='actions'?`export const saveOwnerAdjustment=()=>{throw Error('Fixture must not write')};export const saveRecordedPayment=saveOwnerAdjustment;export const verifyPayrollIntent=saveOwnerAdjustment;export const downloadMyCurrentPayroll=saveOwnerAdjustment;`:a.path==='next/navigation'?`export const useRouter=()=>({push:url=>window.navigated.push(url)});export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>'/staff/my-work';`:a.path==='next/link'?`import React from'react';export default function Link({children,...p}){return <a {...p} onClick={e=>{e.preventDefault();window.navigated.push(p.href)}}>{children}</a>}`:a.path.endsWith('customer-name')?`export const CustomerName=({name,fallback})=>name||fallback;`:`import React from'react';export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='div',...p})=><Tag {...p}/>;export const useWorkspaceTranslation=()=>text=>text;`}));
 }}]});
 const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:white}main{max-width:1100px;padding:16px;margin:auto}nav{display:flex;gap:16px;margin-bottom:16px}button{min-height:44px}dl{margin:0}</style><div id="root"></div><script src="/fixture.js"></script>';
 const server=createServer((req,res)=>{if(req.url==='/fixture.js'||req.url==='/fixture.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(dir+req.url));}else res.end(html)});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const width of [390,430,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.getByText('Current take-home pay',{exact:true}).count(),1);assert.equal(await page.getByText('Take-home pay',{exact:true}).count(),0);
  const daily=page.getByRole('table').first();assert.deepEqual(await daily.locator('thead th').allTextContents(),['Date','Services','Tip']);assert.ok((await daily.textContent()).includes('$55.00'));assert.ok(!(await daily.textContent()).includes('$33.00'));
  assert.ok(await daily.isVisible());assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth));await page.screenshot({path:resolve(dir,'pay-'+width+'.png'),fullPage:true});
  await page.getByRole('button',{name:'Tickets',exact:true}).click();await page.getByLabel('Ticket date',{exact:true}).fill('2025-02-18');assert.ok((await page.evaluate(()=>window.navigated.at(-1))).includes('ticketDate=2025-02-18'));
  await page.getByRole('link',{name:'Previous day'}).click();assert.ok((await page.evaluate(()=>window.navigated.at(-1))).includes('2026-10-29'));
  await page.getByRole('link',{name:'Next day'}).click();assert.ok((await page.evaluate(()=>window.navigated.at(-1))).includes('2026-10-31'));
  await page.locator('details > summary').filter({hasText:'#1042'}).click();await page.locator('summary').filter({hasText:'Edit history'}).first().click();assert.ok((await page.locator('body').innerText()).includes('$25.00 → $30.00'));await page.locator('summary').filter({hasText:'Ticket activity'}).first().click();assert.ok((await page.locator('body').innerText()).includes('service updated'));
  assert.ok(await page.getByText('Classic manicure with a very long detailed service description',{exact:true}).last().isVisible());assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth));await page.screenshot({path:resolve(dir,'tickets-'+width+'.png'),fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }
 writeFileSync(dir+'/results.json',JSON.stringify({widths:[390,430,1280],result:'passed',coverage:['daily raw services','single take-home','arbitrary date','previous/next date','ticket details','edit history','activity','long names','no overflow']},null,2));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
