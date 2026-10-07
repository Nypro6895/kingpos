import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('history table, compact review and same-day merge fit desktop/mobile', {
 skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH, timeout:90000
},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{ActivityHistoryPanel}from'./app/(app)/activity/activity-history-panel';import{BookingDetailsButton}from'./app/my-bookings/booking-details-button';
 const salon={id:'salon',name:'King Nails',location:'8333 W Appleton Ave ? Milwaukee, Wisconsin',imageUrl:null,coverUrl:null};
 window.evidence={bookingId:'booking',ticket:null,checkedInAt:null,manualLink:false,candidates:[{id:'ticket',kind:'ticket',at:'2026-10-01T16:50:00Z',label:'Ticket 123',ticket:{ticketId:'ticket',ticketNumber:'123',openedAt:'2026-10-01T16:05:00Z',closedAt:'2026-10-01T16:50:00Z',services:[{id:'line',name:'Full-set + Nail art',lineTotal:55}],payments:[],discountValue:0,taxRate:0,tipValue:0}}]};window.calls=[];
 window.booking={id:'booking',salon_id:'salon',status:'confirmed',start_at:'2026-10-01T15:45:00Z',end_at:'2026-10-01T16:30:00Z',salon_timezone_snapshot:'America/Chicago',salon:{name:'King Nails',displayName:'King Nails',address_line1:'8333 W Appleton Ave',city:'Milwaukee',state:'Wisconsin',publicDiscoveryEnabled:true},lines:[{id:'line',service_name_snapshot:'Full-set',line_total:40,currentServiceBookable:true,assignedStaff:{displayName:'David'}}],historyEvidence:window.evidence};
 window.receipt={ticketId:'ticket',ticketNumber:'123',openedAt:'2026-10-01T16:05:00Z',closedAt:'2026-10-01T16:50:00Z',salon:{name:'King Nails',addressLine1:'8333 W Appleton Ave',city:'Milwaukee',state:'Wisconsin'},services:[{id:'actual',name:'Full-set + Nail art',staffName:'David',lineTotal:55}],totals:{subtotal:55,total:55,discount_amount:0,tax_amount:0,tip_amount:0},payments:[{label:'Cash'}],verifiedVisit:{status:'verified',countsTowardReputation:true,experienceState:null,experienceBody:null,windowDays:30}};

 createRoot(document.getElementById('root')).render(<><ActivityHistoryPanel activities={[
 {id:'booking',type:'booking',bookingId:'booking',href:'/my-bookings/booking',occurredAt:'2026-10-01T15:45:00Z',startAt:'2026-10-01T15:45:00Z',endAt:'2026-10-01T16:30:00Z',timezone:'America/Chicago',salon,services:[{name:'Full-set',lineTotal:40}],status:'past_appointment',total:40,currency:'USD',title:'Full-set',historyEvidence:window.evidence},
 {id:'purchase',type:'purchase',ticketId:'ticket',ticketNumber:'123',href:'/activity/receipts/ticket',occurredAt:'2026-10-01T16:50:00Z',timezone:'America/Chicago',salon,services:[{name:'Full-set + Nail art',lineTotal:55}],status:'completed',total:55,currency:'USD',title:'Full-set',verifiedVisit:{status:'verified',countsTowardReputation:true,experienceState:null,experienceBody:null,windowDays:30}},
 {id:'visit',type:'visit',href:'/activity',occurredAt:'2026-10-01T16:02:00Z',timezone:'America/Chicago',salon,services:[{name:'Manicure'}],title:'Checked in',status:'checked_in',total:0,currency:'USD'}
 ]}/><div data-testid='upcoming-details'><BookingDetailsButton activity={{type:'booking',bookingId:'booking',salon,currency:'USD',timezone:'America/Chicago',occurredAt:'2026-10-01T15:45:00Z',services:[],total:40}}/></div></>);`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'stubs',setup(b){
 b.onResolve({filter:/next\/link|next\/navigation|history-link-actions$|history-details-actions$|my-bookings\/actions$|activity\/actions$/},args=>({path:args.path,namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:args.path==='next/link'?'export default function Link(p){return <a {...p}/>;}':args.path==='next/navigation'?'export const usePathname=()=>"/activity";export const useRouter=()=>({refresh(){window.refreshes=(window.refreshes||0)+1}});':args.path.endsWith('history-details-actions')?'export const loadHistoryDetailsAction=async input=>({error:null,booking:input.bookingId?window.booking:null,receipt:input.ticketId?window.receipt:null});':args.path.includes('my-bookings/actions')?'export const loadCustomerRescheduleSlotsAction=async()=>({ok:true,data:{slots:[]}});export const rescheduleCustomerBookingAction=async()=>({ok:true,message:"Saved"});export const cancelCustomerBookingAction=async()=>{window.booking={...window.booking,status:"cancelled"};return{ok:true,message:"Cancelled"};};':args.path.endsWith('history-link-actions')?'export const loadHistoryEvidenceAction=async()=>({evidence:window.evidence});export const setHistoryLinkAction=async input=>{window.calls.push(input);window.evidence={...window.evidence,manualLink:!input.unlink,candidates:[]};return{error:null};};':'export const recordVisitExperienceAction=async()=>({error:null,countsTowardReputation:true});'}));
 }}]});
 const css=(await postcss([tailwind({base:process.cwd()})]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'})).css + '\n' + (built.outputFiles.find(file=>file.path.endsWith('.css'))?.text ?? '');
 const js=built.outputFiles.find(file=>file.path.endsWith('.js')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><main style="padding:16px"><div id="root"></div></main><script src="/app.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});await mkdir('artifacts/history-qa',{recursive:true});
 try {for(const width of [1280,375]){
 const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 const visible=page.locator(width>=768?'table':'.md\\:hidden');
 assert.match(await visible.textContent(),/Est\. \$40\.00/);assert.match(await visible.textContent(),/Visited/);
 assert.doesNotMatch(await visible.textContent(),/Appleton|Verified Visit|Paid at salon|Review visit|Past Appointment/);
 assert.equal(await visible.getByRole('button',{name:'Details',exact:true}).count(),3);
 if(width>=768)assert.equal(await page.getByRole('columnheader').first().textContent(),'Date & time');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'artifacts/history-qa/'+width+'-table.png'});
 const originalUrl=page.url();await visible.getByRole('button',{name:'Details',exact:true}).first().click();
 const drawer=page.getByRole('dialog',{name:'Booking details'});await drawer.waitFor();await drawer.getByRole('link',{name:'Rebook',exact:true}).waitFor();
 assert.match(await drawer.textContent(),/8333 W Appleton Ave/);assert.match(await drawer.textContent(),/David/);assert.match(await drawer.textContent(),/Booking estimate/);
 assert.equal(page.url(),originalUrl);let rect=await drawer.boundingBox();assert.ok(rect.width<=384&&rect.x>=0&&rect.x+rect.width<=width+1);
 await page.screenshot({path:'artifacts/history-qa/'+width+'-booking-drawer.png'});
 await drawer.getByRole('button',{name:/Same-day visit.*Merge/}).click();
 const merge=page.locator('dialog:modal').last();await merge.waitFor();rect=await merge.boundingBox();assert.ok(rect.width<=384&&rect.x>=0&&rect.x+rect.width<=width+1);
 await merge.getByRole('button',{name:'Merge',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),1);
 await drawer.waitFor();assert.equal(await drawer.isVisible(),true);
 await drawer.getByRole('button',{name:'Manage merge'}).click();await page.getByRole('button',{name:'Undo merge'}).click();assert.equal(await page.evaluate(()=>window.calls[1].unlink),true);
 await drawer.getByRole('button',{name:'Close history details'}).click();
 await page.evaluate(()=>{window.booking={...window.booking,start_at:'2099-10-01T15:45:00Z',end_at:'2099-10-01T16:30:00Z'};});
 await visible.getByRole('button',{name:'Details',exact:true}).first().click();await drawer.getByRole('button',{name:'Reschedule',exact:true}).waitFor();assert.equal(await drawer.getByRole('button',{name:'Contact salon',exact:true}).count(),0);await page.screenshot({path:'artifacts/history-qa/'+width+'-upcoming-drawer.png'});await drawer.getByRole('button',{name:'Cancel appointment',exact:true}).click();
 await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();await drawer.getByText('Cancelled',{exact:false}).waitFor();
 assert.equal(page.url(),originalUrl);await drawer.getByRole('button',{name:'Close history details'}).click();
 await visible.getByRole('button',{name:'Details',exact:true}).nth(1).click();await drawer.getByRole('button',{name:'Report experience',exact:true}).waitFor();
 assert.match(await drawer.textContent(),/Paid at salon/);assert.match(await drawer.textContent(),/55\.00/);assert.match(await drawer.textContent(),/Cash/);
 await page.screenshot({path:'artifacts/history-qa/'+width+'-receipt-drawer.png'});
 await drawer.getByRole('button',{name:'Report experience',exact:true}).click();await drawer.getByRole('button',{name:'Good',exact:true}).click();await drawer.getByText('Good shared',{exact:true}).waitFor();
 await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});assert.equal(page.url(),originalUrl);
 await page.getByTestId('upcoming-details').getByRole('button',{name:'Details',exact:true}).click();await drawer.waitFor();await drawer.getByRole('link',{name:'Rebook',exact:true}).waitFor();assert.match(await drawer.textContent(),/David/);assert.equal(await drawer.getByText('View full details',{exact:false}).count(),0);assert.equal(page.url(),originalUrl);await page.evaluate(()=>document.querySelector('[data-testid=upcoming-details]').style.display='none');await page.setViewportSize({width:width<768?1280:375,height:900});await drawer.waitFor({state:'visible'});assert.equal(await drawer.evaluate(element=>element.parentElement===document.body),true,'drawer escapes responsive hidden ancestors');await drawer.getByRole('button',{name:'Close history details'}).click();await drawer.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.deepEqual(errors,[]);await page.close();
 }} finally{await browser.close();await new Promise(r=>server.close(r));}
});
