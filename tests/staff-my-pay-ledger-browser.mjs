import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {api,fixtures,authFor,fixedSetting} from './helpers/payroll-payment-fixture.mjs';
import {payrollContextBoundaryPlugin} from './payroll-history-context-fixture.mjs';

const dir='artifacts/staff-my-pay-ledger-20261113';mkdirSync(dir,{recursive:true});
const period={startDate:'2026-10-16',endDate:'2026-10-31',cycleType:'semi_monthly',preset:'semi_monthly_second'};
const cases=[];
for(const variant of ['normal','taxed','fixed','mixed','legacy','zero','large','empty']){
 const tables=fixtures();
 tables.staff_payroll_settings=[{...fixedSetting,pay_type:variant==='fixed'?'fixed':'commission',commission_rate:60,check_rate:60,tax_rate:20,tax_tips:variant==='taxed',tax_bonus:variant==='taxed',cash_to_tax_company:variant==='taxed',tip_payout_method:variant==='taxed'?'check':'cash',bonus_payout_method:variant==='taxed'?'check':'cash'}];
 tables.payroll_period_staff_inputs=[{...tables.payroll_period_staff_inputs[0],period_start:period.startDate,period_end:period.endDate,bonus_amount:variant==='zero'?0:20}];
 tables.pos_ticket_staff_earnings=[{salon_id:'salon',ticket_id:'t1',staff_id:'anna',work_date:'2026-10-29',service_total:variant==='zero'?0:variant==='large'?12345678.90:1000,tip_amount:variant==='zero'?0:100,tip_is_manual:false}];
 if(variant==='mixed')tables.staff_payroll_settings=[{...tables.staff_payroll_settings[0],effective_to:'2026-10-28'},{...tables.staff_payroll_settings[0],id:'new-setting',effective_from:'2026-10-29',commission_rate:65,check_rate:50,tax_rate:15}];
 let line=(await api.calculateLivePayrollForAuth(authFor(tables),period)).lines[0];
 if(variant==='legacy'){line.is_mixed_rate=true;line.settings_used_snapshot=[];}
 if(variant==='empty')line=null;
 cases.push({variant,data:{line,period,periodOptions:[],settings:[],history:[],status:{label:'Live'},dailyRows:(line?.dailyTotals??[]).map(d=>({id:d.id,businessDate:d.business_date,shopGross:d.gross_sales,tipAmount:d.tip_amount}))}});
}
assert.equal(cases[0].data.line.final_staff_income,648);
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{StaffMyPay}from'@/app/staff/my-work/staff-pay-analysis';const root=createRoot(document.getElementById('root'));window.renderCase=(data,lang)=>{window.testLang=lang;root.render(<main style={{maxWidth:760,margin:'auto',padding:16}}><StaffMyPay data={data}/></main>);};`;
await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:dir+'/staff.js',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'translations',setup(b){b.onResolve({filter:/workspace-language$/},()=>({path:'translation',namespace:'translation'}));b.onLoad({filter:/.*/,namespace:'translation'},()=>({loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{translateVietnamese}from'@/lib/vietnamese-dictionary';const t=s=>window.testLang==='vi'?translateVietnamese(s,true):s;export const WorkspaceText=({text})=>t(text);export const WorkspaceElement=({as='div',children,...props})=>React.createElement(as,props,children);export const useWorkspaceTranslation=()=>t;`}));}},payrollContextBoundaryPlugin()]});
const server=createServer((req,res)=>{const name=req.url.slice(1);if(['staff.js','staff.css'].includes(name)){res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(dir+'/'+name));return;}res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}p,dl,dd{margin:0}button{font:inherit}a{color:#216346}</style><link rel="stylesheet" href="/staff.css"><div id="root"></div><script src="/staff.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage();const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
try{
 for(const width of [320,390,430,768,1440])for(const lang of ['en','vi'])for(const c of cases){
  await page.setViewportSize({width,height:844});await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(({data,lang})=>window.renderCase(data,lang),{data:c.data,lang});
  await page.locator('section').first().waitFor();
  assert.equal(await page.locator('input,textarea').count(),0,'read-only Staff page');
  if(c.data.line){
   const details=page.locator('[data-staff-pay-breakdown]');assert.equal(await details.getAttribute('open'),null);
   assert.equal(await page.locator('[data-staff-pay-summary] dl > div').count(),2);
   if(width===390&&lang==='en'&&c.variant==='normal')await page.screenshot({path:dir+'/staff-closed-390.png',fullPage:true});
   await details.locator('summary').click();await page.locator('table[aria-label="Staff payment calculation"]').waitFor({state:'visible'});
   const rows=page.locator('table[aria-label="Staff payment calculation"] tbody tr');assert.equal(await rows.count(),4);
   const expected=api.staffPayrollPaymentRows(c.data.line);
   for(let i=0;i<4;i++){const cells=rows.nth(i).locator('td');for(const [col,key]of[[0,'gross'],[1,'tax'],[2,'net']]){const actual=await cells.nth(col).evaluate(e=>e.childNodes[0].textContent);assert.equal(actual,new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(expected[i][key]));}}
   const total=page.locator('table[aria-label="Staff payment calculation"] tfoot');assert((await total.innerText()).includes(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c.data.line.final_staff_income)));
   if(width===390&&lang==='en'&&c.variant==='normal')await page.screenshot({path:dir+'/staff-open-390.png',fullPage:true});
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/${lang}/${c.variant} overflow`);
  checks.push({width,lang,variant:c.variant});
 }
 assert.deepEqual(errors,[]);writeFileSync(dir+'/browser-results.json',JSON.stringify({passed:true,views:checks.length,checks,errors,financialWrites:0,scope:'Actual StaffMyPay, shared ledger, daily table, history and picker components; real calculator with isolated fixture data. Browser viewport evidence only.'},null,2));console.log({passed:true,views:checks.length});
}finally{await browser.close();await new Promise(r=>server.close(r));}
