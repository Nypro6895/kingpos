import assert from 'node:assert/strict';import {build} from 'esbuild';import {createServer} from 'node:http';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
import postcss from 'postcss';import tailwindcss from '@tailwindcss/postcss';import {chromium} from 'playwright-core';
import {payrollContextFixture,payrollContextBoundaryPlugin} from './payroll-history-context-fixture.mjs';
import {api,fixtures,authFor,fixedSetting} from './helpers/payroll-payment-fixture.mjs';
const dir='artifacts/payroll-payment-ledger-live-20261112';mkdirSync(dir,{recursive:true});
const period={startDate:'2026-10-16',endDate:'2026-10-31',cycleType:'semi_monthly',preset:'semi_monthly_second'};
let bonus=20,check=null,delay=15,taxBonus=false,method='cash',issued=[],writes=0;
const calculate=async()=>{
 const tables=fixtures();tables.staff[0].display_name='Kim';
 tables.staff_payroll_settings=[{...fixedSetting,pay_type:'commission',commission_rate:60,check_rate:60,tax_rate:20,tax_tips:false,tax_bonus:taxBonus,bonus_payout_method:method,tip_payout_method:'cash',legal_name:'Kim Example'}];
 tables.payroll_period_staff_inputs=[{...tables.payroll_period_staff_inputs[0],period_start:period.startDate,period_end:period.endDate,bonus_amount:bonus,check_number:check,note:null}];
 tables.pos_ticket_staff_earnings=[{salon_id:'salon',ticket_id:'t1',staff_id:'anna',work_date:'2026-10-29',service_total:1000,tip_amount:100,tip_is_manual:false}];
 return (await api.calculateLivePayrollForAuth(authFor(tables),period)).lines[0];
};
let entry=payrollContextFixture.replace(/const line=\{[^\n]+\};/,'const line=window.initial.line;').replace('canManagePayroll:false','canManagePayroll:true')
 .replace('window.__payrollFixture={data,salonId:salon,owner:all};','data.issuedChecks={status:"available",checks:window.initial.issued};window.__payrollFixture={data,salonId:salon,owner:all};');
entry+=`\nwindow.refreshFromServer=async()=>{const next=await(await fetch('/state')).json();Object.assign(window.initial.line,next.line);window.initial.issued=next.issued;await window.renderPayroll();};`;
await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:dir+'/app.js',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'controlled-save-transport',setup(b){
 b.onLoad({filter:/\.(ts|tsx)$/,namespace:'file'},({path})=>{
  if(path.includes('node_modules'))return;
  const text=readFileSync(path,'utf8');if(!/^\s*["']use server["']/.test(text))return;
  const names=[...text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)/g)].map(m=>m[1]??m[2]);
  return{loader:'js',contents:names.map(n=>`export const ${n}=async()=>{throw Error('Unexpected server mutation: ${n}')};`).join('\n')};
 });
 b.onLoad({filter:/next\/navigation/,namespace:'payroll-boundary'},()=>({loader:'js',contents:`const nav=url=>{history.pushState({},'',url);window.renderPayroll()};const router={push:nav,replace:nav,refresh(){if(window.latestLine){Object.assign(window.initial.line,window.latestLine);window.latestLine=null;}window.renderPayroll()}};export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;export const useRouter=()=>router;`}));
 b.onLoad({filter:/[\\/]app[\\/]payroll[\\/]actions\.ts$/,namespace:'payroll-actions'},({path})=>{
  const names=[...readFileSync(path,'utf8').matchAll(/export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)/g)].map(m=>m[1]??m[2]);
  return{loader:'js',contents:names.map(n=>n==='autosavePayrollPeriodStaffInputAction'?`export const ${n}=async(previous,form)=>{const result=await(await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(form.entries()))})).json();if(result.line){window.latestLine=result.line;}return result;};`:`export const ${n}=async()=>{throw Error('Unexpected action: ${n}')};`).join('\n')};
 });
}},payrollContextBoundaryPlugin()]});
const globals=readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "'+resolve('app').replaceAll('\\','/')+'";');
writeFileSync(dir+'/global.css',(await postcss([tailwindcss()]).process(globals,{from:resolve('app/globals.css')})).css);
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/save'){
  let raw='';for await(const chunk of req)raw+=chunk;const values=JSON.parse(raw);await new Promise(r=>setTimeout(r,delay));
  if(Number(values.expected_bonus_amount)!==bonus||(values.expected_check_number||null)!==check){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'error',message:'Changed on another device.'}));return;}
  const value=Number(values.bonus_amount);if(!Number.isFinite(value)||value<0){res.end(JSON.stringify({status:'error',message:'Invalid bonus.'}));return;}
  bonus=value;check=values.check_number||null;writes++;
  const line=await calculate();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'saved',savedAt:new Date().toISOString(),baselineAt:new Date().toISOString(),baseline:{bonus_amount:bonus,check_number:check,note:null},line}));return;
 }
 if(url.pathname==='/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({line:await calculate(),issued}));return;}
 if(['/app.js','/app.css','/global.css'].includes(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(dir+url.pathname));return;}
 if(url.pathname==='/api/financial-input-history'){res.setHeader('Content-Type','application/json');res.end('{"rows":[]}');return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><div id="root"></div><script>window.initial='+JSON.stringify({line:await calculate(),issued})+'</script><script src="/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);const checks=[];
try{
 for(const runtime of ['web','native']){
  bonus=20;check=null;taxBonus=false;method='cash';issued=[];delay=15;
  await page.goto(base+'/payroll?tab=staff&runtime='+runtime+'&mode=plain');
  const card=page.locator('[data-staff-payroll-row]').first(),details=card.getByRole('button',{name:/Details/});await details.waitFor();
  assert.equal(await details.getAttribute('aria-expanded'),'false');await details.click();
  const table=card.getByRole('table',{name:'Staff payment calculation'}),input=card.getByRole('spinbutton',{name:'Bonus',exact:true});
  assert.equal(await input.inputValue(),'20.00');assert.match(await table.innerText(),/\$72.00/);assert.match(await card.innerText(),/\$648.00/);
  for(const width of [320,390,430,768,1440]){
   await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${runtime}/${width} overflow`);
   if(runtime==='web'&&width===390)await page.screenshot({path:dir+'/payment-details-390.png',fullPage:true});checks.push({runtime,width,passed:true});
  }
  await page.setViewportSize({width:390,height:1000});
  await input.fill('35.50');await card.getByRole('textbox',{name:'Check number',exact:true}).click();
  await page.waitForFunction(()=>window.initial.line.bonus_amount===35.5);await page.waitForFunction(()=>document.querySelector('[data-staff-payroll-row]').innerText.includes('$663.50'));
  assert.equal(await input.inputValue(),'35.50');assert.equal(bonus,35.5);
  // Enter must save the same form, including leading zeros in manually entered references.
  const checkInput=card.getByRole('textbox',{name:'Check number',exact:true});await checkInput.fill('000123');await checkInput.press('Enter');
  await page.waitForFunction(()=>window.initial.line.check_number==='000123');assert.equal(check,'000123');
  // A second edit arriving during a delayed save must settle to the last value.
  delay=900;await input.fill('41');await checkInput.click();await page.waitForTimeout(100);await input.fill('42');await checkInput.click();
  await page.waitForFunction(()=>window.initial.line.bonus_amount===42);assert.equal(Number(await input.inputValue()),42);assert.equal(bonus,42);delay=15;
  // The actual calculator moves taxed bonus into check, leaving cash untouched.
  taxBonus=true;method='check';await page.evaluate(()=>window.refreshFromServer());
  await page.waitForFunction(()=>document.querySelector('[data-staff-payroll-row]').innerText.includes('$321.60'));
  assert.match(await table.innerText(),/\$8.40/);assert.match(await table.innerText(),/\$33.60/);
  await input.fill('50');await checkInput.click();await page.waitForFunction(()=>window.initial.line.bonus_amount===50);
  await page.waitForFunction(()=>document.querySelector('[data-staff-payroll-row]').innerText.includes('$328.00'));assert.equal(windowCheckNet(),328);
  function windowCheckNet(){return Math.round((288+bonus*.8)*100)/100;}
  // Issued numbers are a read-only projection, never a hidden write into manual payroll inputs.
  issued=[{id:'issued-check',staffId:'anna',number:'123',periodStart:period.startDate,periodEnd:period.endDate}];await page.evaluate(()=>window.refreshFromServer());
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Check number"]').value==='123');assert.equal(await checkInput.getAttribute('readonly'),'');
  await input.fill('55');await details.focus();await page.waitForFunction(()=>window.initial.line.bonus_amount===55);assert.equal(check,'000123');
  await details.click();await details.click();assert.equal(Number(await input.inputValue()),55);assert.equal(await details.getAttribute('aria-expanded'),'true');
  checks.push({runtime,liveInput:true,leadingZeros:true,pendingEdits:true,taxedBonusChannel:true,issuedReadOnly:true,drafts:true,passed:true});
 }
 assert.deepEqual(errors,[]);assert.equal(writes,12,'each settled input change saves once');writeFileSync(dir+'/browser-results.json',JSON.stringify({passed:true,checks,errors,isolatedFixtureWrites:writes,productionWrites:0,limitation:'Actual web/app-local UI and calculator; controlled local transport, not hosted/provider/device acceptance'},null,2));console.log({passed:true,checks:checks.length,isolatedFixtureWrites:writes,errors});
}catch(error){console.error({browserErrors:errors,writes,bonus,check});await page.screenshot({path:dir+'/failure.png',fullPage:true});throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
