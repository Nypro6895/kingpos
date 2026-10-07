import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('owner agenda: compact mobile and desktop, single expanded row, dismiss, confirmation and navigation', {skip:!process.env.ESBUILD_MODULE_PATH,timeout:90000},async()=>{
const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
const source=readFileSync('app/bookings/booking-workspace-client.tsx','utf8');
const actionNames=[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+\/actions)["']/g)].flatMap(m=>m[1].split(',').map(s=>s.trim().split(/\s+as\s+/)[0]).filter(s=>s&&!s.startsWith('type ')));
actionNames.push('cancelStaffTimeBlockAction');
const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{BookingWorkspaceClient}from'./app/bookings/booking-workspace-client';
const base={id:'one',updated_at:'2026-10-02T10:00:00Z',start_at:'2026-10-02T14:00:00Z',end_at:'2026-10-02T14:45:00Z',normalizedStatus:'pending',customer:{id:'customer',name:'Maya',phone:'5551234567',email:null},serviceNames:['Manicure'],durationMinutes:45,subtotal:40,assignedStaffNames:['Tracy'],lines:[],events:[],source:'owner_manual',notes:'Requested a quiet appointment',noShowCount:0};
window.props={bookings:[base,{...base,id:'two',customer:{...base.customer,name:'Anna'},start_at:'2026-10-02T15:00:00Z'}],canManageBookings:true,canViewBookings:true,filters:{date:'2026-10-02',dateRange:'day',query:'',tab:'calendar',view:'day'},options:{services:[],staff:[],assignments:[],availabilityRules:[],timeBlocks:[],customers:[]},accountName:'Salon account',publicBookingHref:'/book/salon',range:{days:[{date:'2026-10-02',label:'Fri, Oct 2'},{date:'2026-10-03',label:'Sat, Oct 3'}]},requests:[],salonName:'King Nails',setupPermissions:{},settings:{booking_enabled:true,online_booking_visible:true,timezone_iana:'America/Chicago',ticket_creation_mode:'manual'},timezone:'America/Chicago',warnings:[]};
window.calls=[];window.nav=[];const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<BookingWorkspaceClient {...window.props}/>);window.render();`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'stubs',setup(b){
b.onResolve({filter:/next\/navigation$/},()=>({path:'nav',namespace:'stub'}));
b.onResolve({filter:/\/actions$/},()=>({path:'actions',namespace:'stub'}));
b.onResolve({filter:/history-link-control$/},()=>({path:'history',namespace:'stub'}));
b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='nav'?`export const usePathname=()=>'/bookings';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({push:url=>window.nav.push(url),replace:url=>window.nav.push(url),refresh:()=>window.refreshes=(window.refreshes||0)+1});`:args.path==='history'?'export const HistoryLinkControl=()=>null;':actionNames.map(name=>`export async function ${name}(input){window.calls.push({name:'${name}',input});return {ok:true,message:'Saved'}}`).join('\n')}));}}]});
const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});try{
for(const width of [375,1280]){const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.process={env:{}};});
await page.route('http://localhost/',r=>r.fulfill({contentType:'text/html',body:'<style>body{margin:0;font-family:Arial}*,::before,::after{box-sizing:border-box}button,input,select{font:inherit}h1,h2,p{margin:0}'+readFileSync('app/bookings/booking-workspace.css','utf8')+'</style><div id="root"></div><script src="/bundle.js"></script>'}));await page.route('**/bundle.js',r=>r.fulfill({contentType:'text/javascript',body:result.outputFiles.find(f=>f.path.endsWith('.js')).text}));await page.goto('http://localhost/');
await page.locator('.owner-agenda-row').first().click();assert.equal(await page.locator('.owner-agenda-item[open]').count(),1);assert.match(await page.locator('.owner-agenda-item[open]').innerText(),/5551234567/);
await page.locator('.owner-agenda-row').nth(1).click();assert.equal(await page.locator('.owner-agenda-item[open]').count(),1);assert.match(await page.locator('.owner-agenda-item[open]').innerText(),/Anna/);
await page.locator('.owner-schedule-date h1').click();assert.equal(await page.locator('.owner-agenda-item[open]').count(),0);
await page.locator('.owner-agenda-row').first().click();await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.waitForFunction(()=>window.calls.length===1);assert.equal(await page.evaluate(()=>window.calls[0].input.command),'confirm');assert.match(await page.locator('.owner-agenda-row').first().innerText(),/Confirmed/);
await page.locator('.owner-schedule-menu > summary').first().click();await page.getByRole('button',{name:'All appointments in this month',exact:true}).waitFor();await page.mouse.click(width-3,880);assert.equal(await page.locator('.owner-schedule-menu[open]').count(),0);
await page.locator('.owner-schedule-menu > summary').nth(1).click();await page.getByRole('link',{name:'Availability',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('.owner-schedule-menu[open]').count(),0);
await page.getByRole('button',{name:'Next day',exact:true}).click();assert.match(await page.evaluate(()=>window.nav.at(-1)),/tab=calendar/);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.evaluate(()=>{window.props={...window.props,filters:{...window.props.filters,view:'week'}};window.render();});await page.getByText('Sat, Oct 3',{exact:true}).waitFor();assert.match(await page.locator('.owner-agenda').innerText(),/No appointments/);
await page.screenshot({path:'work/owner-agenda-'+width+'.png'});
await page.evaluate(()=>{window.props={...window.props,filters:{...window.props.filters,tab:'booking-page'}};window.render();});
await page.getByRole('switch',{name:'Online booking',exact:true}).waitFor();
assert.equal(await page.locator('.booking-setup-row').count(),4);
assert.equal(await page.locator('iframe').count(),0);
await page.getByText(/Add this booking link to your Google Maps/).waitFor();
await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value}}}));
await page.getByRole('button',{name:'Copy link',exact:true}).click();
await page.getByText('Link copied.',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>window.copied),'http://localhost/book/salon');
await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied')}}}));
await page.getByRole('button',{name:'Copy link',exact:true}).click();
await page.getByText(/Could not copy/).waitFor();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.screenshot({path:'work/owner-booking-settings-'+width+'.png'});
await page.evaluate(()=>{window.props={...window.props,filters:{...window.props.filters,tab:'settings'},settings:{...window.props.settings,minimum_lead_time_minutes:60,maximum_advance_window_days:30,slot_interval_minutes:15,default_cleanup_buffer_minutes:0,cancellation_window_minutes:120,confirmation_mode:'instant_booking',any_professional_enabled:true,same_day_booking_enabled:true,guest_booking_enabled:true,split_staff_appointment_enabled:false}};window.render();});
await page.getByRole('button',{name:'Save settings',exact:true}).waitFor();
await page.getByLabel(/Maximum advance/).fill('45');
await page.getByRole('button',{name:'Save settings',exact:true}).click();
await page.waitForFunction(()=>window.calls.some(call=>call.name==='updateBookingSettingsAction'));
assert.equal(await page.evaluate(()=>window.calls.find(call=>call.name==='updateBookingSettingsAction').input.maximumAdvanceWindowDays),45);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.screenshot({path:'work/owner-preferences-'+width+'.png'});
await page.evaluate(()=>{window.props={...window.props,filters:{...window.props.filters,tab:'availability'},options:{...window.props.options,staff:[{id:'tracy',display_name:'Tracy',is_active:true,online_booking_enabled:true}]}};window.render();});
await page.locator('.availability-person-toggle').waitFor({timeout:5000}).catch(error=>{assert.deepEqual(errors,[]);throw error;});
assert.equal(await page.locator('.availability-person-editor').count(),0);
await page.locator('.availability-person-toggle').click();
await page.locator('.availability-person-editor').waitFor();
assert.equal(await page.locator('input[type="time"]').count(),0);
await page.locator('.availability-day-toggle').first().click();
await page.getByRole('button',{name:/add hours/i}).click();
assert.equal(await page.locator('input[type="time"]').count(),2);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.screenshot({path:'work/owner-availability-'+width+'.png'});
assert.deepEqual(errors,[]);await page.close();}
}finally{await browser.close();}
});



