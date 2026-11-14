import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
const dir='artifacts/payroll-compact-settings-20261112/browser-details';mkdirSync(dir,{recursive:true});
const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import {StaffIncomeCard} from '@/app/payroll/staff-income-card';import {StaffPayrollDetailsGroup} from '@/app/payroll/staff-payroll-details';
import {StaffPaymentTable} from '@/app/payroll/staff-payment-table';
import styles from '@/app/payroll/payroll-mobile.module.css';import theme from '@/app/payroll/payroll-theme.module.css';
const snapshot={payType:'commission',commissionRate:60,checkRate:60,taxRate:20,cashToTaxCompany:false,taxTips:false,tipPayoutMethod:'cash',bonusPayoutMethod:'cash',taxBonus:false};
const line={staff_id:'kim',staff_display_name_snapshot:'Kim',staff_legal_name_snapshot:'Kim Example',gross_sales:509.49,check_gross:194.76,staff_commission_gross:305.69,base_check_amount:155.81,base_cash_amount:129.84,final_check_amount:155.81,final_cash_amount:131.76,final_staff_income:287.57,tip_amount:1.92,tip_check_amount:0,tip_cash_amount:1.92,bonus_amount:0,bonus_check_amount:0,bonus_cash_amount:0,tax_withheld:18.12,is_mixed_rate:false,pay_type_used:'commission',commission_rate_used:60,check_rate_used:60,tax_rate_used:20,cash_to_tax_company_snapshot:false,tip_payout_method_snapshot:'cash',bonus_payout_method_snapshot:'cash',tax_tips_snapshot:false,tax_bonus_snapshot:false,settings_used_snapshot:[snapshot],period_staff_input_snapshot:{bonusSettings:[snapshot]},dailyTotals:[]};
const root=createRoot(document.getElementById('root'));window.renderCase=(variant='normal',lang='en')=>{window.testLang=lang;const l=structuredClone(line);
if(variant==='taxed'){l.tip_check_amount=1.54;l.tip_cash_amount=0;l.tax_tips_snapshot=true;l.final_cash_amount=129.84;l.final_check_amount=157.35;l.final_staff_income=287.19;l.settings_used_snapshot=[{...snapshot,taxTips:true,tipPayoutMethod:'check'}];}
if(variant==='long'){l.staff_display_name_snapshot='Alexandra Nguyen Long Name';l.final_check_amount=-1234567.89;l.final_cash_amount=2345678.91;l.base_check_amount=-1234567.89;l.base_cash_amount=2345676.99;l.final_staff_income=1111111.02;l.staff_legal_name_snapshot=null;}
if(variant==='mixed'){l.is_mixed_rate=true;l.settings_used_snapshot=[snapshot,{...snapshot,commissionRate:65,checkRate:50,taxRate:15,taxTips:true,tipPayoutMethod:'check'}];}
if(variant==='legacy'){l.is_mixed_rate=true;l.settings_used_snapshot=[];}
root.render(<main className={theme.surface+' '+styles.page} style={{padding:16,maxWidth:960,margin:'auto'}}><StaffPayrollDetailsGroup><StaffIncomeCard line={l} adjustments={<div><StaffPaymentTable line={l}/><label>Bonus input <input aria-label="Bonus input" defaultValue="0"/></label><button type="button">Cancel</button></div>} breakdown={<div>Existing breakdown</div>}/><StaffIncomeCard line={{...l,staff_id:"ny",staff_display_name_snapshot:"Staff-Ny"}} breakdown={<div>Second staff breakdown</div>}/></StaffPayrollDetailsGroup><StaffPayrollDetailsGroup><StaffIncomeCard line={{...l,staff_id:"other-list",staff_display_name_snapshot:"Separate list"}} /></StaffPayrollDetailsGroup></main>);};window.renderCase();`;
await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:dir+'/app.js',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'language-only',setup(b){b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'tsx',resolveDir:process.cwd(),contents:`import {translateVietnamese} from '@/lib/vietnamese-dictionary';export const useWorkspaceTranslation=()=>text=>window.testLang==='vi'?translateVietnamese(text,true):text;export const WorkspaceText=({text})=>window.testLang==='vi'?translateVietnamese(text,true):text;`}));}}]});
const server=createServer((req,res)=>{const name=(req.url??'').slice(1);if(['app.js','app.css'].includes(name)){res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(dir+'/'+name));return;}res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}summary{cursor:pointer}dl,dd,p{margin:0}button,input{font:inherit}button{min-height:44px}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];
try {
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('[data-staff-payroll-row]').first().waitFor();
 assert.equal(await page.locator('button[aria-expanded="true"]').count(),0,'all rows initially closed');
 for(const width of [320,390,430,768,1440]) for(const lang of ['en','vi']) for(const variant of ['normal','taxed','long','mixed','legacy']){
  await page.setViewportSize({width,height:900});await page.evaluate(({variant,lang})=>window.renderCase(variant,lang),{variant,lang});
  const cards=page.locator('[data-staff-payroll-row]'),first=cards.nth(0),second=cards.nth(1),other=cards.nth(2);
  const trigger=first.locator('button[aria-controls]'),next=second.locator('button[aria-controls]'),independent=other.locator('button[aria-controls]');
  await first.getByText(variant==='long'?'Alexandra Nguyen Long Name':'Kim',{exact:true}).waitFor();
  await page.waitForFunction(lang=>document.querySelector('[data-staff-payroll-row] button').textContent===(lang==='vi'?'Chi tiết':'Details'),lang);
  for(const b of [trigger,next,independent])if(await b.getAttribute('aria-expanded')==='true')await b.click();
  assert.equal(await first.getByText('Existing breakdown',{exact:true}).isVisible(),false);
  await trigger.focus();await page.keyboard.press('Enter');assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  await page.getByLabel('Bonus input').fill('7');assert.equal(await first.getByText('Existing breakdown',{exact:true}).isVisible(),true);
  if(variant==='taxed')assert.match(await first.innerText(),/1.54/);
  if(variant==='normal'&&width===390&&lang==='en'){
   await page.screenshot({path:dir+'/details-open-390.png',fullPage:true});
   assert.match(await first.innerText(),/Check:\s*\$155.81/);assert.match(await first.innerText(),/Cash:\s*\$131.76/);assert.match(await first.innerText(),/Bonus/);
  }
  await independent.click();assert.equal(await trigger.getAttribute('aria-expanded'),'true','another payroll list does not close this one');
  await next.click();assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await next.getAttribute('aria-expanded'),'true');assert.equal(await independent.getAttribute('aria-expanded'),'true');
  await trigger.click();assert.equal(await next.getAttribute('aria-expanded'),'false');assert.equal(await page.getByLabel('Bonus input').inputValue(),'7','switching rows retains draft');
  await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),'false','same Details toggles closed');
  await independent.click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}/${lang}/${variant} overflow`);
  if(variant==='normal'&&width===390&&lang==='en'){
   assert((await first.boundingBox()).height<=80,'closed row is compact');
   assert.doesNotMatch(await first.innerText(),/Commission|Bonus:/);await page.screenshot({path:dir+'/details-closed-390.png',fullPage:true});
  }
  checks.push({width,lang,variant,passed:true});
 }
 assert.deepEqual(errors,[]);writeFileSync(dir+'/results.json',JSON.stringify({passed:true,views:checks.length,checks,errors,limitation:'Actual shared component and CSS; isolated sample props, no live financial writes or physical device proof'},null,2));console.log({passed:true,views:checks.length,errors});
}finally{await browser.close();await new Promise(r=>server.close(r));}
