import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import {chromium} from 'playwright-core';
import {fixturePlugin,ownerTicket,id} from './helpers/ticket-correction-history-fixture.mjs';

const out='artifacts/history-inline-combined/legacy-ticket-notifications';fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync('app/staff/today/today-dashboard-view.tsx','utf8'),ast=ts.createSourceFile('today-dashboard-view.tsx',source,ts.ScriptTarget.Latest,true);
const salesSummary=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='SalesSummary');assert.ok(salesSummary,'actual SalesSummary implementation');
const ticket={...ownerTicket(),salon_id:id(9),ticket_number:'T104',opened_at:'2026-10-29T16:00:00Z',payments:[],audit_logs:[],adjustments:[]};
const before={ticket_number:'T104',status:'closed',service_total:50,tip_amount:10,lines:[{line_id:id(20),service_name:'Manicure',service_total:50,parts:[50]}]},after={...before,service_total:60,lines:[{...before.lines[0],service_total:60,parts:[60]}]};
const edit={id:id(500),salon_id:id(9),staff_id:null,ticket_id:ticket.id,source_id:ticket.id,source_table:'ticket',event_action:'updated',period_start:'2026-10-29',period_end:'2026-10-29',created_at:'2026-10-31T15:00:00Z',before_values:before,after_values:after,actor_name:'Salon Owner',note:'Corrected the service price.',business_timezone:'America/Chicago'};
const contents=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{WorkspaceText}from'@/components/workspace-language';import{FinancialHistoryProvider,useFinancialHistoryContext}from'./app/payroll/inline-financial-history';import{financialHistoryForObject}from'./lib/inline-financial-history';import{ticketNotificationDate}from'./lib/ticket-history-navigation';import{TodayInlineTickets}from'./app/staff/today/today-inline-tickets';import{StaffDailyTickets,StaffDailyMetrics}from'./app/staff/my-work/staff-daily-overview';
const ticket=${JSON.stringify(ticket)},edit=${JSON.stringify(edit)};
const formatMoney=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n),formatShortMoney=formatMoney,hasSalesActivity=()=>true,TrendPill=()=>null,EmptyLine=({label})=><p>{label}</p>;
${salesSummary.getText(ast)}
const mode=new URL(location.href).searchParams.get('mode')||'web-owner',native=mode.startsWith('native-'),staff=mode.includes('staff'),empty=mode.includes('empty'),malformed=mode.includes('malformed');
const legacyQuery=malformed?'eventDate=2026-02-30':'eventDate=2026-10-29',query=native?'?'+legacyQuery:undefined,params=native?new URLSearchParams(query):new URLSearchParams(location.search),date=ticketNotificationDate(Object.fromEntries(params))??'2026-10-31';
const own={...edit,staff_id:'${id(10)}',before_values:{...edit.before_values,tip_amount:10},after_values:{ticket_number:'T104',status:'closed',service_total:0,tip_amount:0,lines:[]}};
window.reads=[];window.fetch=async input=>{const url=new URL(String(input),location.href);window.reads.push({path:url.pathname,args:Object.fromEntries(url.searchParams)});return new Response(JSON.stringify(url.pathname.includes('/api/pos/owner/tickets')?{tickets:empty?[]:[ticket],salonId:'${id(9)}'}:{rows:empty||malformed?[]:[staff?own:edit]}));};
createRoot(document.getElementById('root')).render(<main><h1>{staff?'Staff Today':'Owner day '+date}</h1><FinancialHistoryProvider salonId="${id(9)}" surface="today" start={staff?'2026-10-31':date} end={staff?'2026-10-31':date} query={query}>{staff?<><StaffDailyMetrics activity={{assignedServiceAmount:0,tipAmount:0,totalEarning:0,bigTurns:0,smallTurns:0}} completedTickets={0}/><StaffDailyTickets tickets={[]} timezone="America/Chicago" staffId="${id(10)}" businessDate="2026-10-31" emptyState={<p>No current tickets</p>}/></>:<SalesSummary date={date} timeZone="America/Chicago" canViewTickets performance={{sales:{service:60,tip:10,total:70,ticketCount:empty?0:1,discount:0,comparison:null}}}/>}</FinancialHistoryProvider></main>);`;
const bundle=await build({stdin:{contents,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',outfile:'fixture.js',jsx:'automatic',plugins:[fixturePlugin]});
const compiler=await compile('@import "tailwindcss";',{base:process.cwd(),onDependency(){}}),sources=['app/staff/today/today-dashboard-view.tsx','app/staff/today/today-inline-tickets.tsx','app/pos-tickets/closed-ticket-correction-form.tsx','app/payroll/inline-financial-history.tsx'];
const css=compiler.build(sources.flatMap(file=>fs.readFileSync(file,'utf8').split(/[\s"'`<>={}]+/)))+'\n'+bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const script=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
const server=createServer((req,res)=>{const js=req.url==='/fixture.js';res.setHeader('Content-Type',js?'text/javascript':'text/html; charset=utf-8');res.end(js?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'*{box-sizing:border-box}body{margin:0;font:14px Arial;color:#27272a;background:#fff}main{max-width:900px;margin:auto;padding:12px}h1{font-size:18px}</style><div id="root"></div><script src="/fixture.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const checks=[];
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const width of [320,390,1280])for(const mode of ['web-owner','native-owner','web-staff','native-staff','web-empty','native-empty','web-malformed']){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const native=mode.startsWith('native-'),malformed=mode.includes('malformed'),empty=mode.includes('empty'),staff=mode.includes('staff');
  await page.goto('http://127.0.0.1:'+server.address().port+'/?mode='+mode+(native?'':'&eventDate='+(malformed?'2026-02-30':'2026-10-29'))+'#input-history');
  await page.waitForFunction(()=>window.reads?.some(row=>row.path==='/api/financial-input-history'));
  if(!malformed){
   await page.waitForFunction(()=>window.reads.some(row=>row.path==='/api/financial-input-history'&&row.args.date==='2026-10-29'));
   if(empty){await page.locator('[data-legacy-input-context]').waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/Edited|Corrected the service price|→/);}
   else if(staff){await page.waitForFunction(()=>document.querySelector('[data-ticket-context]')?.open);assert.match(await page.locator('[data-ticket-context]').innerText(),/Corrected the service price/);assert.match(await page.locator('body').innerText(),/0 completed/);assert.match(await page.locator('[data-ticket-context]').innerText(),/2026-10-29/);}
   else{await page.waitForFunction(()=>document.querySelector('[data-today-ticket-list] [data-edited-ticket]')?.open);assert.match(await page.locator('h1').innerText(),/2026-10-29/);assert.match(await page.locator('[data-edited-ticket]').innerText(),/\$50\.00.*→.*\$60\.00/s);assert.equal(await page.locator('[data-focused-input-object]').count(),0);const toggle=page.locator('button[aria-expanded]');assert.equal(await toggle.getAttribute('aria-expanded'),'true');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false','legacy auto-open remains dismissible');await toggle.click();}
  }else{assert.equal(await page.locator('[data-legacy-input-context]').count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Edited/);assert.ok((await page.evaluate(()=>window.reads)).every(row=>row.args.date!=='2026-02-30'));}
  const reads=await page.evaluate(()=>window.reads);assert.ok(reads.every(row=>!row.args.inputEvent),'no inferred edit ID');assert.doesNotMatch(await page.locator('body').innerText(),/00000000-0000-4000-8000-/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,mode+' overflow '+width);assert.deepEqual(errors,[]);
  await page.screenshot({path:out+'/'+mode+'-'+width+'.png',fullPage:true});checks.push({width,mode,reads,passed:true});await page.close();
 }
 fs.writeFileSync(out+'/browser-results.json',JSON.stringify({at:new Date().toISOString(),layer:'Actual Owner SalesSummary extracted unchanged from source, actual Provider/TodayInlineTickets/StaffDailyTickets; mocked read transport only; native route query passed explicitly; no hosted data.',checks},null,2));console.log(JSON.stringify({passed:true,checks:checks.map(({width,mode})=>({width,mode}))},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
