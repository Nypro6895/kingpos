import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('Actual Portable POS accepts booking services and preserves an unfinished ticket', {timeout:60000,skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{PosDeskClient}from'./app/pos/pos-desk-client';import{openBookingInPortablePos}from'./lib/portable-booking-ticket';
 window.openBooking=(id='booking',version='v1')=>{try{openBookingInPortablePos({id,updatedAt:version,customerId:'customer',customerName:'Booking Customer',customerPhone:'555',staffId:'staff',staffName:'Alice',status:'confirmed',serviceIds:['a','b'],serviceNames:['Manicure','Pedicure'],startAt:'2026-09-25T14:00:00Z',endAt:'2026-09-25T15:00:00Z',lines:[{id:'line1',serviceId:'a',serviceName:'Manicure',staffId:'staff',price:40},{id:'line2',serviceId:'b',serviceName:'Pedicure',staffId:'staff2',price:30}]});return null;}catch(e){return e.message;}};
 createRoot(document.getElementById('root')).render(<PosDeskClient surface="portable" activeSession={null} liveDraft={null} defaults={{adsFooter:'',largeTurnThreshold:25,showServiceName:true,showStaffName:true,staffCheckInEnabled:false,taxEnabled:false,tipSuggestions:[5,10,15,20]}} salonName="Fixture" services={[{id:'a',name:'Manicure',base_price:40},{id:'b',name:'Pedicure',base_price:30}]} staff={[{id:'staff2',display_name:'Bob',job_title:'Professional',is_active:true,avatar_url:null,today_status:'checked_in',turns:{largeTurns:0,queueTurns:0,receiptLargeTurns:0,smallTurns:0,totalTurns:0}},{id:'staff',display_name:'Alice',job_title:'Professional',is_active:true,avatar_url:null,today_status:'checked_in',turns:{largeTurns:0,queueTurns:0,receiptLargeTurns:0,smallTurns:0,totalTurns:0}}]} actions={{submitPosDeskReceipt:async input=>{window.receipt=input;return{ok:true,ticketId:'ticket',ticketNumber:'T1'};}}}/>);
 `},bundle:true,write:false,jsx:'automatic',outdir:'fixture',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundary',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
 b.onResolve({filter:/\/app\/pos\/actions$|^@\/app\/pos\/actions$/},()=>({path:'actions',namespace:'fixture'}));
 b.onResolve({filter:/supabase\/browser$/},()=>({path:'supabase',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='navigation'?'export const useRouter=()=>({refresh(){},push(){}});export const usePathname=()=>"/pos/portable";':args.path==='supabase'?'export const createSupabaseBrowserClient=()=>null;':`const action=async()=>({ok:true,data:{version:1}});export const cancelWaitingVisitForPos=action,createPosDeskCustomer=action,getPosLiveDraft=action,searchPosDeskCustomers=action,selectWaitingVisitForPos=action,submitPosDeskReceipt=action,touchCustomerDisplayLiveDraftActivity=action,updatePosActiveDraft=action,updatePosLiveDraftCustomer=action;`}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?js:'<div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try {const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('Alice',{exact:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>window.openBooking()),null);await page.getByText('Booking Customer',{exact:true}).first().waitFor();
 assert.match(await page.evaluate(()=>window.openBooking('another-booking')),/unfinished ticket/);
 assert.match(await page.evaluate(()=>window.openBooking('booking','v2')),/appointment changed/);
 assert.equal(await page.evaluate(()=>window.openBooking()),null);
 assert.match(await page.locator('body').textContent(),/Manicure/);assert.match(await page.locator('body').textContent(),/Pedicure/);
 await page.getByRole('button',{name:'Submit',exact:true}).click();await page.waitForFunction(()=>!!window.receipt);
 assert.equal(await page.evaluate(()=>window.receipt.sourceBookingId),'booking');assert.equal(await page.evaluate(()=>window.receipt.sourceBookingUpdatedAt),'v1');assert.deepEqual(await page.evaluate(()=>window.receipt.lines.map(l=>l.serviceId)),['a','b']);assert.deepEqual(await page.evaluate(()=>window.receipt.lines.map(l=>l.staffId)),['staff','staff2']);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
