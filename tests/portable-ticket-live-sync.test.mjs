import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

test('Portable Ticket follows the business day, receives remote tickets and preserves historical filters and local work', {skip:!process.env.ESBUILD_MODULE_PATH||!process.env.TEST_BROWSER_PATH,timeout:45000},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const root=resolve('.').replaceAll('\\','/');
 const initial={date:'2026-09-24',timezone:'America/Chicago',tickets:[],staff:[],services:[],canEdit:false,isBusinessDateLocked:false};
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{PortableTicketClient}from'${root}/app/pos/portable/ticket/portable-ticket-client';const root=createRoot(document.getElementById('root'));window.render=(followToday=true)=>root.render(<PortableTicketClient initialData={${JSON.stringify(initial)}} searchQuery="" followToday={followToday}/>);window.render();`},jsx:'automatic',bundle:true,write:false,platform:'browser',plugins:[{name:'fixtures',setup(b){
  b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'sync',namespace:'fixture'}));
  b.onResolve({filter:/portable-workspace-state$/},()=>({path:'workspace',namespace:'fixture'}));
  b.onResolve({filter:/portable-operations$/},()=>({path:'ops',namespace:'fixture'}));
  b.onResolve({filter:/portable-local-tickets$/},()=>({path:'local',namespace:'fixture'}));
  b.onResolve({filter:/portable\/actions$/},()=>({path:'actions',namespace:'fixture'}));
  b.onResolve({filter:/closed-ticket-correction-form$/},()=>({path:'card',namespace:'fixture'}));
  b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',resolveDir:root,contents:({
   sync:`export function subscribePosChanges(id,fn){window.remote=fn;return()=>{};}`,
   workspace:`export function usePortableWorkspaceState(){return{scope:'salon:key',businessDate:window.day??'2026-09-25'};}`,
   ops:`export const PORTABLE_OPERATIONS_CHANGED='operations';`,
   local:`export function PortableLocalTickets(){return null;}`,
   actions:`export async function correctPortableClosedPosTicketInline(){}`,
   card:`import React from 'react';export function DailyPosTicketCard({ticket}){return <output>{ticket.id}</output>;}`,
   link:`import React from 'react';export default function Link(props){return <a {...props}/>;}`
  })[path]}));
 }}]});
 let ticket='before';const dates=[];
 const server=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(req.url.startsWith('/api/')){const date=new URL(req.url,'http://test').searchParams.get('date');dates.push(date);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...initial,date,tickets:[{id:ticket,openedAt:date+'T18:00:00Z',ticketSequence:1,status:'closed',adjustments:[],items:[],staffEarnings:[],subtotal:25,tipAmount:0,total:25,paid:25,remaining:0}]}));return;}
  res.setHeader('Content-Type','text/html');res.end('<input aria-label="Unfinished ticket" value="47"><div id="root"></div><script src="/bundle.js"></script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByText('before',{exact:true}).waitFor();assert.equal(dates.at(-1),'2026-09-25');
  ticket='remote-owner-ticket';await page.evaluate(()=>window.remote({resource:'tickets'}));await page.getByText(ticket,{exact:true}).waitFor();assert.equal(await page.getByLabel('Unfinished ticket').inputValue(),'47');
  ticket='after-midnight';await page.evaluate(()=>{window.day='2026-09-26';window.render();});await page.getByText(ticket,{exact:true}).waitFor();assert.equal(dates.at(-1),'2026-09-26');assert.equal(await page.locator('input[name=date]').inputValue(),'2026-09-26');
  await page.evaluate(()=>window.render(false));await page.waitForFunction(()=>document.querySelector('input[name=date]')?.value==='2026-09-24');assert.equal(dates.at(-1),'2026-09-24');
  ticket='missed-while-sleeping';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText(ticket,{exact:true}).waitFor();assert.equal(dates.at(-1),'2026-09-24');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
