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
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`import React from 'react';import{createRoot}from'react-dom/client';import{PortableTicketClient}from'${root}/app/pos/portable/ticket/portable-ticket-client';import{TicketFilters}from'${root}/app/pos-tickets/ticket-filters';const root=createRoot(document.getElementById('root'));window.render=(followToday=true,date)=>root.render(<PortableTicketClient initialData={{...${JSON.stringify(initial)},...(date?{date}:{})}} searchQuery="" followToday={followToday}/>);window.render();window.renderOwner=()=>{window.testPath="/pos-tickets";function Owner(){const[q,setQ]=React.useState("");return <TicketFilters title="POS Tickets" actions={<button aria-label="More options">⋯</button>} date="2026-09-24" query={q} onQueryChange={setQ}/>;}root.render(<Owner/>);};`},jsx:'automatic',bundle:true,write:false,platform:'browser',outdir:'fixture-output',plugins:[{name:'fixtures',setup(b){
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
  b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'sync',namespace:'fixture'}));
  b.onResolve({filter:/portable-workspace-state$/},()=>({path:'workspace',namespace:'fixture'}));
  b.onResolve({filter:/portable-operations$/},()=>({path:'ops',namespace:'fixture'}));
  b.onResolve({filter:/portable-local-tickets$/},()=>({path:'local',namespace:'fixture'}));
  b.onResolve({filter:/portable\/actions$/},()=>({path:'actions',namespace:'fixture'}));
  b.onResolve({filter:/closed-ticket-correction-form$/},()=>({path:'card',namespace:'fixture'}));
  b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
  b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',resolveDir:root,contents:({
   language:`export function useWorkspaceTranslation(){return text=>text;}export function WorkspaceText({text}){return text;}`,
   sync:`export function subscribePosChanges(id,fn){window.remote=fn;return()=>{};}`,
   navigation:`const router={refresh(){window.refreshed=true;window.dispatchEvent(new Event('focus'));},replace(href){window.history.replaceState(null,'',href);window.render(false,new URL(href,location.origin).searchParams.get('date'));}};export function useRouter(){return router;}export function usePathname(){return window.testPath??'/pos/portable/ticket';}`,
   workspace:`export function usePortableWorkspaceState(){return{scope:'salon:key',businessDate:window.day??'2026-09-25'};}`,
   ops:`export const PORTABLE_OPERATIONS_CHANGED='operations';`,
   local:`export function PortableLocalTickets(){return null;}`,
   actions:`export async function correctPortableClosedPosTicketInline(){}`,
   card:`import React from 'react';export function DailyPosTicketCard({ticket}){return <output>{ticket.id}</output>;}`,
   link:`import React from 'react';export default function Link(props){return <a {...props}/>;}`
  })[path]}));
 }}]});
 let ticket='before', fail=false, delay=0;const dates=[];
 const server=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);return;}
  if(req.url==='/bundle.css'){res.setHeader('Content-Type','text/css');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.css')).text);return;}
  if(req.url.startsWith('/api/')){const date=new URL(req.url,'http://test').searchParams.get('date');dates.push(date);if(fail){res.statusCode=503;res.end('{}');return;}res.setHeader('Content-Type','application/json');setTimeout(()=>res.end(JSON.stringify({...initial,date,tickets:[{id:ticket,openedAt:date+'T18:00:00Z',ticketSequence:1,status:'closed',adjustments:[],items:[],staffEarnings:[],subtotal:25,tipAmount:0,total:25,paid:25,remaining:0}]})),delay);return;}
  res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style><input aria-label="Unfinished ticket" value="47"><div id="root"></div><script src="/bundle.js"></script>');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByText('before',{exact:true}).waitFor();assert.equal(dates.at(-1),'2026-09-25');
  ticket='remote-owner-ticket';await page.evaluate(()=>window.remote({resource:'tickets'}));await page.getByText(ticket,{exact:true}).waitFor();assert.equal(await page.getByLabel('Unfinished ticket').inputValue(),'47');
  ticket='after-midnight';await page.evaluate(()=>{window.day='2026-09-26';window.render();});await page.getByText(ticket,{exact:true}).waitFor();assert.equal(dates.at(-1),'2026-09-26');assert.match(await page.locator('[data-ticket-date]').getAttribute('aria-label'),/Sep 26, 2026/);
  await page.evaluate(()=>window.render(false));await page.waitForFunction(()=>document.querySelector('[data-ticket-date]')?.getAttribute('aria-label').includes('Sep 24, 2026'));assert.equal(dates.at(-1),'2026-09-24');
  ticket='missed-while-sleeping';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText(ticket,{exact:true}).waitFor();assert.equal(dates.at(-1),'2026-09-24');

  for(const width of [320,390,430,768,1280]){
    await page.setViewportSize({width,height:844});
    const metrics=await page.locator('[data-ticket-toolbar]').evaluate(node=>{const a=node.querySelector('[data-ticket-date]').getBoundingClientRect(),b=node.querySelector('input').getBoundingClientRect();return{sameRow:Math.abs(a.y-b.y)<2,overflow:document.documentElement.scrollWidth>innerWidth,searchWidth:b.width};});
    assert.equal(metrics.sameRow,true);assert.equal(metrics.overflow,false);assert.ok(metrics.searchWidth>140);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-ticket-date]').click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('button',{name:'2026-09-24',exact:true}).getAttribute('aria-pressed'),'true');
  await page.screenshot({path:'artifacts/ticket-calendar-history-20261031/calendar-mobile.png'});
  await page.getByRole('button',{name:'Previous month'}).click();
  await page.getByRole('button',{name:'2026-08-17',exact:true}).click();
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.match(page.url(),/date=2026-08-17/);await page.waitForFunction(()=>document.querySelector('[data-ticket-date]')?.getAttribute('aria-label').includes('Aug 17, 2026'));await page.waitForFunction(()=>document.querySelector('output'));assert.equal(dates.at(-1),'2026-08-17');
  await page.locator('[data-ticket-date]').click();await page.getByRole('button',{name:'2026-08-17',exact:true}).click();assert.equal(await page.evaluate(()=>window.refreshed),true);
  await page.locator('[data-ticket-date]').click();await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),0);
  // A failing refresh must be visible and explicitly retryable.
  fail=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('alert').waitFor();
  fail=false;ticket='retry-success';await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByText(ticket,{exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
  // A changed day must not expose the old day's rows while the request is pending.
  delay=250;ticket='new-day';await page.evaluate(()=>{window.day='2026-09-27';window.render(true);});
  await page.getByRole('status').waitFor();assert.equal(await page.getByText('retry-success',{exact:true}).count(),0);
  await page.getByText('new-day',{exact:true}).waitFor();assert.equal(dates.at(-1),'2026-09-27');
  await page.evaluate(()=>window.renderOwner());
  await page.getByRole('button',{name:'More options'}).waitFor();
  for(const width of [320,390,430,768,1280]){
    await page.setViewportSize({width,height:844});
    const valid=await page.locator('[data-ticket-toolbar]').evaluate(node=>{const a=node.querySelector('[data-ticket-date]').getBoundingClientRect(),b=node.querySelector('input').getBoundingClientRect();return Math.abs(a.y-b.y)<2&&document.documentElement.scrollWidth<=innerWidth&&b.width>140;});assert.equal(valid,true);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('input[name=q]').fill('Alice');
  await page.locator('[data-ticket-date]').click();await page.getByRole('dialog').waitFor();
  await page.evaluate(()=>{document.querySelector('input[aria-label="Unfinished ticket"]').style.visibility='hidden';});
  await page.screenshot({path:'artifacts/ticket-calendar-history-20261031/calendar-mobile.png'});
  await page.getByRole('button',{name:'2026-09-17',exact:true}).click();
  assert.match(page.url(),/pos-tickets\?date=2026-09-17&q=Alice/);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
