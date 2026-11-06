import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';
const browserPath=process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const language=`import React from 'react';export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;export const WorkspaceElement=({as:Tag='div',children,...p})=><Tag {...p}>{children}</Tag>;`;
const source=fs.readFileSync('app/staff/appointments/staff-schedule-view.tsx','utf8');
const parsed=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const expanded=parsed.statements.filter(n=>ts.isFunctionDeclaration(n)&&['AppointmentExpanded','AppointmentInspiration'].includes(n.name?.text)).map(n=>n.getText(parsed)).join('\n');
async function bundle(){return build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {TeamSettingsPanel} from './app/settings/team-payroll-panels';
import {StaffCustomerFields} from './app/staff/appointments/staff-customer-fields';
import {StaffDailyTickets} from './app/staff/my-work/staff-daily-overview';
import {WorkspaceText,WorkspaceElement} from '@/components/workspace-language';
const appointmentRequiresConfirmation=()=>false;
const StaffConfirmBookingButton=()=> <button>Confirm booking</button>;
const StaffNoShowButton=()=> <button>No-show</button>;
${expanded}
const appointment={customerName:'Linh',customerPhone:'3125551234',customerContactVisible:false,status:'confirmed',lineStatus:'scheduled',noShowEligible:true,noShowCount:1,noShowReason:'Customer supplied note',publicNotes:'Keep customer note',serviceNote:'Keep service note',inspiration:{imageUrl:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect width=%2260%22 height=%2260%22 fill=%22pink%22/%3E%3C/svg%3E',source_title_snapshot:'Booked look',service_name_snapshot:'Manicure',source_caption_snapshot:'Keep inspiration'}};
const ticket={id:'ticket',ticketNumber:'T1',customerName:'Linh',customerPhone:null,services:[{serviceName:'Manicure',quantity:1,lineTotal:50}],serviceTotal:50,tipAmount:10,totalEarning:60,hasEarning:true,totalTurns:1,bigTurns:1,smallTurns:0,status:'closed',openedAt:'2026-11-05T15:00Z',closedAt:'2026-11-05T16:00Z'};
function App(){const[visible,setVisible]=useState(false);window.setVisible=setVisible;return <>
<section id="owner"><h2>Settings · Staff</h2><TeamSettingsPanel data={{kind:'staff-team',salonId:'salon',staff:[],requests:[],canManage:false,canManagePublicTeam:false,canManageCustomerContacts:true,customerContactsVisible:visible}} onSaved={async()=>setVisible(window.saved.visible)}/></section>
<section id="schedule"><h2>Schedule · Linh · 10:00 AM · Manicure · $50</h2><AppointmentExpanded appointment={{...appointment,customerContactVisible:visible,customerPhone:visible?'3125551234':null}}/></section>
<section id="daily"><h2>My Work</h2><StaffDailyTickets tickets={[{...ticket,customerPhone:visible?'3125551234':null}]} timezone="America/Chicago"/></section>
<section id="create"><h2>New appointment</h2><StaffCustomerFields salonId="salon" disabled={false} contactVisible={visible}/></section>
</>};createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,outdir:'fixture',platform:'browser',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},jsx:'automatic',plugins:[{name:'service-boundaries',setup(b){
 b.onResolve({filter:/workspace-language$|direct-settings-actions$|settings-extra-actions$|direct-pos-actions$|staff-customer-contact-actions$|staff-public-profile-editor$|staff-hours-booking$|delete-unused-button$/},a=>({path:a.path,namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:a.path.endsWith('workspace-language')?language:a.path.endsWith('staff-customer-contact-actions')?`export const saveStaffCustomerContacts=async(salonId,visible)=>{window.saved={salonId,visible};return window.failSave?{ok:false,error:'Save rejected'}:{ok:true}};`:a.path.endsWith('staff-hours-booking')?'export const StaffHoursBooking=()=>null;':a.path.endsWith('staff-public-profile-editor')?'export const StaffPublicProfileEditor=()=>null;':a.path.endsWith('delete-unused-button')?'export const DeleteUnusedButton=()=>null;':'export const saveDirectStaff=async()=>({ok:true});export const runDirectStaffRequest=async()=>({ok:true});export const saveDirectPayroll=async()=>({ok:true});export const saveSettingsPublicTeam=async()=>({ok:true});export const resetDirectStaffPasscode=async()=>({ok:true});'}));
 }}]});}

test('Staff contact setting renders naturally on mobile/desktop; exact lookup preserves typed phone and manual entry',{timeout:60000},async()=>{
 const result=await bundle();const utilities=await postcss([tailwindcss()]).process('@import "tailwindcss" source(none); @source "./app/settings/team-payroll-panels.tsx"; @source "./app/settings/direct-settings-ui.tsx"; @source "./app/(app)/staff/appointments/page.tsx";', {from:process.cwd()+'/fixture.css'});const css=utilities.css+result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('');const browser=await chromium.launch({executablePath:browserPath,headless:true});
 try{
 for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:1100}});page.on('pageerror',e=>console.error('Fixture page:',e.message));let calls=[];
 await page.route('http://localhost/',r=>r.fulfill({contentType:'text/html',body:`<style>${css} *,::before,::after{box-sizing:border-box}body{font:14px Arial;margin:16px}section{margin-bottom:20px}h2{font-size:16px}button,input{font:inherit;max-width:100%}#owner form{padding:12px;border:1px solid #ddd;border-radius:8px}#owner label{display:flex;gap:8px}#owner p{line-height:1.5}.settings-form-actions{display:flex;gap:8px;align-items:center}${fs.readFileSync('app/staff/appointments/staff-appointments.css','utf8')}</style><div id="root"></div><script src="/bundle.js"></script>`}));
 await page.route('**/bundle.js',r=>r.fulfill({contentType:'text/javascript',body:result.outputFiles.find(f=>f.path.endsWith('.js')).text}));
 await page.route('**/api/staff/create-appointment',r=>{calls.push(r.request().postDataJSON());return r.fulfill({json:[{id:'customer',name:'Linh',phone:null}]})});
 await page.goto('http://localhost/');const schedule=page.locator('#schedule'),daily=page.locator('#daily'),create=page.locator('#create');
 await schedule.getByText('Keep service note').waitFor();
 assert.equal(await schedule.locator('a[href^="tel:"]').count(),0);
 assert.doesNotMatch(await schedule.innerText(),/Phone|No phone|permission|restricted|not allowed/i);
 assert.match(await schedule.innerText(),/Keep customer note/);assert.match(await schedule.innerText(),/Keep inspiration/);assert.equal(await schedule.locator('img').count(),1);
 await daily.locator('summary').click();assert.match(await daily.innerText(),/Linh/);assert.match(await daily.innerText(),/\$50\.00/);assert.match(await daily.innerText(),/\$10\.00/);assert.doesNotMatch(await daily.innerText(),/3125551234|Customer phone/);
 const name=create.getByRole('combobox').nth(0),phone=create.getByLabel('Phone',{exact:true});
 await name.fill('Manual customer');await page.waitForTimeout(350);assert.equal(calls.length,0);
 await phone.fill('312555');await page.waitForTimeout(350);assert.equal(calls.length,0);
 await phone.fill('+1 (312) 555-1234');await create.getByRole('option',{name:'Linh',exact:true}).click();
 assert.equal(await phone.inputValue(),'+1 (312) 555-1234');assert.equal(await name.inputValue(),'Linh');assert.equal(await create.locator('[name=customerId]').inputValue(),'customer');
 await name.fill('Manual customer');assert.equal(await create.locator('[name=customerId]').inputValue(),'');
 const before=schedule.locator('img');assert.equal(await before.count(),1);
 await page.screenshot({path:`artifacts/staff-customer-contact/staff-hidden-${width}.png`,fullPage:true});
 const checkbox=page.getByRole('checkbox',{name:'Staff can view customer contact details'});await checkbox.check();await page.getByRole('button',{name:'Save customer contact settings'}).click();
 await schedule.locator('a[href^="tel:"]').waitFor();assert.equal(await name.inputValue(),'Manual customer');assert.match(await daily.innerText(),/3125551234/);assert.equal(await schedule.locator('img').count(),1);
 await page.screenshot({path:`artifacts/staff-customer-contact/staff-visible-${width}.png`,fullPage:true});
 await page.evaluate(()=>window.failSave=true);await checkbox.uncheck();await page.getByRole('button',{name:'Save customer contact settings'}).click();await page.getByRole('alert').filter({hasText:'Save rejected'}).waitFor();assert.equal(await schedule.locator('a[href^="tel:"]').count(),1);
 await page.close();
 }
 }finally{await browser.close()}
});
