import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import {chromium} from 'playwright-core';

const out='artifacts/history-input-reconciliation/ticket-editor';fs.mkdirSync(out,{recursive:true});
const contents=`import React from 'react';import{createRoot}from'react-dom/client';import{DailyPosTicketCard}from'./app/pos-tickets/closed-ticket-correction-form';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');window.fixtureSaves=[];
const ticket={id:id(1),workspace_revision:7,opened_at:'2026-10-20T16:00:00Z',status:'closed',source_booking_id:null,customer:{id:id(2),name:'Sample Customer',email:null,phone:null},discount_type:'fixed_amount',discount_value:5,tip_type:'fixed_amount',tip_value:10,tax_rate:0,staff_earnings:[{staff_id:id(10),tip_amount:10,tip_is_manual:false,manual_tip_amount:null}],ticket_items:[{id:id(20),assigned_staff_id:id(10),assigned_staff:{id:id(10),display_name:'Anna'},service_id:id(30),service:{id:id(30),name:'Manicure'},created_at:'2026-10-20T16:00:00Z',line_total:50,turn_parts:[{id:id(40),amount:50,turn_index:1,turn_type:'large'}]}]};
if(new URLSearchParams(location.search).has('custom')){const first=ticket.ticket_items[0];ticket.ticket_items.push({...first,id:id(21),line_total:25,turn_parts:[{id:id(41),amount:25,turn_index:1,turn_type:'large'}]});first.service_id=null;first.service=null;first.service_name_snapshot='Custom chrome accent';}
createRoot(document.getElementById('root')).render(<main style={{maxWidth:960,margin:'0 auto',padding:16}}><p style={{fontSize:12,color:'#666'}}>Local component fixture · sample past paid ticket · mocked save</p><DailyPosTicketCard actions={{correctClosedTicket:async form=>{window.fixtureSaves.push(Object.fromEntries(form));}}} businessDateCompactLabel="Oct 20" canApplyFinancialCorrection={false} canEdit={true} dailyNumber={24} isBusinessDateLocked={true} returnTo="/pos-tickets?date=2026-10-20" services={[{id:id(30),name:'Manicure'},{id:id(31),name:'Pedicure with a long service name for mobile'}]} staff={[{id:id(10),display_name:'Anna'},{id:id(11),display_name:'Lily'}]} ticket={ticket} timeZone="America/Chicago"/></main>);`;
const replacements={
 '@/components/workspace-language':'export const WorkspaceText=({text})=>text;',
 '@/app/pos-tickets/actions':'export const correctClosedPosTicketInline=async()=>{};export const submitLockedStaffFinancialCorrection=async()=>{};',
};
const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',outfile:'fixture.js',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents},plugins:[{name:'fixture-transport',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(replacements,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',contents:replacements[a.path]}));}}]});
const compiler=await compile('@import "tailwindcss";',{base:process.cwd(),onDependency(){}});
const style=compiler.build(fs.readFileSync('app/pos-tickets/closed-ticket-correction-form.tsx','utf8').split(/[\s"'`<>={}]+/));
const script=bundle.outputFiles.find(x=>x.path.endsWith('.js')).text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/fixture.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+style+'body{margin:0;background:#fff;color:#222;font-family:Arial,sans-serif}</style><div id="root"></div><script src="/fixture.js"></script>');});
await new Promise(r=>server.listen(6104,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const checks=[];
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:6104');await page.getByRole('button',{name:'Edit',exact:true}).click();
  assert.equal(await page.getByRole('dialog').count(),0,'past Owner ticket directly edits source inputs');
  const request=await page.locator('input[name=request_id]').inputValue();assert.match(request,/^[0-9a-f-]{36}$/);assert.equal(await page.locator('input[name=expected_revision]').inputValue(),'7');
  const save=page.getByRole('button',{name:'Save',exact:true});assert.equal(await save.isDisabled(),true);
  await page.getByRole('button',{name:'Manicure',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'service picker overflow '+width);await page.screenshot({path:out+'/service-picker-'+width+'.png',fullPage:true});await page.getByRole('button',{name:'Pedicure with a long service name for mobile',exact:true}).click();
  await page.getByLabel('Discount',{exact:true}).fill('15');await page.getByLabel('Discount',{exact:true}).press('Tab');
  await page.getByRole('button',{name:'$10.00',exact:true}).click();await page.locator('input[type=number]').fill('12');await page.locator('input[type=number]').press('Tab');
  assert.equal(await save.isDisabled(),true,'a change still requires a note');await page.getByRole('textbox',{name:'Reason',exact:true}).fill('Correct original service, discount and independent tip.');assert.equal(await save.isDisabled(),false);
  assert.equal(await page.locator('input[name=request_id]').inputValue(),request);assert.equal(await page.locator('input[name=expected_revision]').inputValue(),'7');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'editor overflow '+width);
  await page.screenshot({path:out+'/edited-'+width+'.png',fullPage:true});await save.click();await page.waitForFunction(()=>window.fixtureSaves.length===1);
  const sent=await page.evaluate(()=>window.fixtureSaves[0]);assert.equal(sent.request_id,request);assert.equal(sent.expected_revision,'7');assert.equal(Number(sent.discount_value),15);assert.equal(Number(sent.tip_total),12);assert.equal(JSON.parse(sent.item_updates)[0].service_id,'00000000-0000-4000-8000-000000000031');assert.ok(sent.correction_reason);assert.deepEqual(errors,[]);
  checks.push({width,overflow:false,serviceChanged:true,discount:15,tip:12,noteRequired:true,requestAndRevisionStable:true,pastPaidOwnerDirectInputEditor:true});await page.close();
 }
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:6104/?custom');await page.getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByRole('button',{name:'Custom chrome accent',exact:true}).waitFor();await page.getByRole('button',{name:'$50.00',exact:true}).click();await page.locator('input[type=number]').fill('60');await page.locator('input[type=number]').press('Tab');await page.getByRole('button',{name:'$10.00',exact:true}).click();await page.locator('input[type=number]').fill('12');await page.locator('input[type=number]').press('Tab');await page.getByRole('textbox',{name:'Reason',exact:true}).fill('Correct named custom service and independent tip.');
  assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isEnabled(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal((await page.locator('body').innerText()).includes('00000000-'),false);await page.screenshot({path:out+'/custom-same-staff-'+width+'.png',fullPage:true});await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>window.fixtureSaves.length===1);
  const sent=await page.evaluate(()=>window.fixtureSaves[0]);assert.equal(JSON.parse(sent.item_updates)[0].service_id,null);assert.equal(Number(JSON.parse(sent.item_updates)[0].parts[0].amount),60);assert.equal(Number(sent.tip_total),12);assert.deepEqual(errors,[]);checks.push({width,existingNamedCustomEditable:true,sameStaffMultipleRowsEditable:true,overflow:false,noTechnicalIds:true});await page.close();
 }
 fs.writeFileSync(out+'/browser-results.json',JSON.stringify({passed:true,layer:'Actual DailyPosTicketCard with mocked save; no production data',checks},null,2));console.log(JSON.stringify({passed:true,checks}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
