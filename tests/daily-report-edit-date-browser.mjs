import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const base={id:'10000000-1111-4111-8111-000000000001',salon_id:'salon',staff_id:null,source_id:'closing',source_table:'daily_report',period_start:'2026-11-01',period_end:'2026-11-01',business_timezone:'America/Chicago',created_at:'2026-11-01T18:39:00Z',event_action:'updated',actor_id:null,actor_name:'Owner',before_values:{cash_amount:25,credit_card_amount:0,other_amount:0,entered:true},after_values:{cash_amount:25,credit_card_amount:86,other_amount:0,entered:true}};
const next={...base,id:'10000000-1111-4111-8111-000000000002',created_at:'2026-11-02T06:00:00Z',before_values:base.after_values,after_values:{...base.after_values,credit_card_amount:90}};
const ticket={...base,id:'10000000-1111-4111-8111-000000000003',source_table:'ticket',source_id:'ticket',ticket_id:'ticket',before_values:{service_total:86},after_values:{service_total:90}};
const contents=`import React from 'react';import {createRoot} from 'react-dom/client';
import {FinancialHistoryProvider} from '@/app/payroll/inline-financial-history';
import {DailyInputInlineHistory} from '@/app/reports/daily-input-inline-history';
import {ReportTicketHistoryRow} from '@/app/reports/report-ticket-history-row';
const root=createRoot(document.getElementById('root'));
window.show=rows=>root.render(<FinancialHistoryProvider salonId="salon" surface="reports" start="2026-11-01" end="2026-11-01" initialChanges={rows}><DailyInputInlineHistory businessDate="2026-11-01"/><ReportTicketHistoryRow ticketId="ticket"><span>Ticket</span></ReportTicketHistoryRow></FinancialHistoryProvider>);`;
const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',outfile:'fixture.js',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents},alias:{'@':process.cwd()},plugins:[{name:'fixture',setup(b){
 b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',contents:path==='language'?'export const WorkspaceText=({text})=>text;':'export const useSearchParams=()=>new URLSearchParams();'}));
}}]});
const script=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?script:'<!doctype html><div id="root"></div><script src="/fixture.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/chromium',headless:true});
 const page=await browser.newPage({timezoneId:'Asia/Tokyo',viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(rows=>window.show(rows),[base,ticket]);
 const report=page.locator('[data-closing-input-date]'),ticketRow=page.locator('[data-report-ticket]');
 await report.waitFor();
 assert.doesNotMatch(await report.locator('summary').innerText(),/Edited/);
 assert.equal(await report.getAttribute('class'),null);
 assert.match(await ticketRow.locator('summary').innerText(),/Edited/);
 await report.locator('summary').click();
 assert.match(await report.innerText(),/No saved edits for this date/);
 assert.doesNotMatch(await report.innerText(),/\$0\.00\s*→\s*\$86\.00/);
 await page.evaluate(rows=>window.show(rows),[base,next,ticket]);
 await page.waitForFunction(()=>document.querySelector('[data-closing-input-date]>summary')?.textContent?.includes('Edited'));
 assert.match(await report.locator('summary').innerText(),/Edited\s*·\s*1/);
 assert.ok(await report.getAttribute('class'));
 assert.match(await report.innerText(),/\$86\.00\s*→\s*\$90\.00/);
 assert.doesNotMatch(await report.innerText(),/\$0\.00\s*→\s*\$86\.00/);
 assert.match(await ticketRow.locator('summary').innerText(),/Edited/);
 assert.deepEqual(errors,[]);
 console.log('PASS: Daily Report same-day saves stay unmarked when viewed later; only post-date edits are counted and shown. Ticket remains Edited. Salon timezone is independent of device timezone.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
