import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('real agenda: compact row, independent Edit, conditional text actions, guarded ticket handoff and note dialog', {timeout:120000},async()=>{
 const root=process.cwd(),out=path.resolve('artifacts/iphone-three-layout/approved-ui');fs.mkdirSync(out,{recursive:true});
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import{OwnerAgendaRow}from'./app/bookings/owner-agenda-row';
 window.calls=[];window.fail=false;window.delay=false;window.refreshes=0;
 const base={id:'booking',start_at:new Date(Date.now()-60000).toISOString(),updated_at:'revision-1',normalizedStatus:'confirmed',confirmation_status:'confirmed',customer:{id:'customer',name:'Lover-nai',phone:'(312) 555-0142',email:'lover-nail@gmail.com'},assignedStaffNames:['Staff-Ny'],serviceNames:['Full Set'],durationMinutes:45,subtotal:40,no_show_kind:null,lines:[],posTicket:null};
 function App(){const[state,setState]=useState({key:0,booking:base,canManage:true});window.renderScenario=(patch={},canManage=true)=>setState(s=>({key:s.key+1,booking:{...base,...patch},canManage}));return <div data-booking-surface="owner" style={{padding:12}}><div className="owner-agenda-columns">{['Time','Staff','Services','Customer',''].map(t=><span key={t}>{t}</span>)}</div><OwnerAgendaRow key={state.key} booking={state.booking} timezone="America/Chicago" canManage={state.canManage} onOpen={()=>window.edits=(window.edits||0)+1}/></div>};createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,jsx:'automatic',alias:{'@':root},plugins:[{name:'disabled-server-boundaries',setup(b){
 b.onResolve({filter:/^next\/navigation$|\/bookings\/actions$|\.\/actions$/},a=>({path:a.path,namespace:'qa'}));
 b.onLoad({filter:/.*/,namespace:'qa'},a=>({contents:a.path.includes('navigation')?`export const usePathname=()=>'/pos/book';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>({refresh(){window.refreshes++}});`:`
 async function act(input,ticket){window.calls.push({input,ticket});if(window.delay)await new Promise(r=>window.release=r);if(window.fail)return {ok:false,message:'Fixture failure'};return {ok:true,message:ticket?'POS ticket is ready.':'Updated.',ticketId:ticket?'ticket-1':undefined};}
 export const createBookingPosTicketAction=input=>act(input,true);export const runBookingStatusAction=input=>act(input,false);`}));
 }}]});
 const css=(await postcss([tailwind()]).process(fs.readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css+'\n'+fs.readFileSync('app/bookings/booking-workspace.css','utf8');
 const server=createServer((req,res)=>res.end('<div id="root"></div>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 const summary=page.locator('summary');await summary.waitFor();
 for(const width of [320,375,390,430,768,1280]){await page.setViewportSize({width,height:850});await page.evaluate(()=>window.renderScenario());await summary.click();await page.getByRole('button',{name:'Create ticket',exact:true}).waitFor();
 const geometry=await page.evaluate(()=>{const cells=[...document.querySelector('summary').children].map(e=>e.getBoundingClientRect());const actions=[...document.querySelector('.owner-agenda-actions').children].map(e=>e.getBoundingClientRect());return{overflow:document.documentElement.scrollWidth>innerWidth,ordered:cells.every((r,i)=>!i||cells[i-1].right<=r.left+1),actionsSameRow:Math.max(...actions.map(r=>r.top))-Math.min(...actions.map(r=>r.top))<1,buttonBorder:getComputedStyle(document.querySelector('.owner-agenda-actions button')).borderTopWidth};});
 assert.deepEqual(geometry,{overflow:false,ordered:true,actionsSameRow:true,buttonBorder:'0px'});await page.screenshot({path:path.join(out,`agenda-${width}.png`)});
 }
 await page.locator('.owner-agenda-edit').click();assert.equal(await page.evaluate(()=>window.edits),1);assert.equal(await page.locator('details').getAttribute('open'),'');
 await summary.click();await page.locator('.owner-agenda-edit').click();assert.equal(await page.locator('details').getAttribute('open'),null,'Edit must not toggle the row');
 await page.evaluate(()=>window.renderScenario({start_at:new Date(Date.now()+3600000).toISOString(),normalizedStatus:'pending',confirmation_status:'requested'}));await summary.click();await page.getByRole('button',{name:'Confirm',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Create ticket',exact:true}).count(),0);
 await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.waitForFunction(()=>window.refreshes>0);assert.equal(await page.getByRole('button',{name:'Confirm',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Create ticket',exact:true}).count(),0);
 await page.evaluate(()=>window.renderScenario());await summary.click();await page.getByRole('button',{name:'No-show',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();const before=await page.evaluate(()=>window.calls.length);await dialog.getByRole('textbox').fill('Customer called');await page.screenshot({path:path.join(out,'no-show-note.png')});await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.calls.length),before);
 await page.getByRole('button',{name:'No-show',exact:true}).click();await dialog.getByRole('textbox').fill('Keep this note');await page.evaluate(()=>window.fail=true);await dialog.getByRole('button',{name:'Mark No-show',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByRole('textbox').inputValue(),'Keep this note');
 await page.evaluate(()=>window.fail=false);await dialog.getByRole('button',{name:'Mark No-show',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(await page.getByRole('button',{name:'Create ticket',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.calls.at(-1).input.reason),'Keep this note');
 await page.evaluate(()=>{window.renderScenario();window.fail=true});await summary.click();await page.getByRole('button',{name:'Create ticket',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Create ticket',exact:true}).count(),1);assert.equal(await page.getByRole('link',{name:'POS ticket',exact:true}).count(),0);
 await page.evaluate(()=>{window.fail=false;window.delay=true});await page.getByRole('button',{name:'Create ticket',exact:true}).click();await page.getByRole('button',{name:'Create ticket',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Create ticket',exact:true}).isDisabled(),true);await page.evaluate(()=>window.release());await page.getByRole('link',{name:'POS ticket',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Create ticket',exact:true}).count(),0);await page.getByText('Completed',{exact:true}).waitFor();
 await page.evaluate(()=>window.renderScenario({},false));await summary.click();assert.equal(await page.locator('.owner-agenda-actions button').count(),0);assert.equal(await page.getByRole('link',{name:'lover-nail@gmail.com',exact:true}).count(),0);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({widths:[320,375,390,430,768,1280],editDoesNotToggle:true,confirmHiddenAfterSuccess:true,futureTicketHidden:true,noteCancelNoWrite:true,noteFailureRetained:true,ticketFailureRetainsAction:true,pendingDisablesActions:true,successfulTicketCompletesBooking:true,readOnlyNoMutations:true}));
 }finally{await browser.close();server.close();}
});
