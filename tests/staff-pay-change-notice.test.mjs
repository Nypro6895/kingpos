import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const helpers = await build({entryPoints:['lib/staff-pay-changes.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
const mod={exports:{}};new Function('module','exports',helpers.outputFiles[0].text)(mod,mod.exports);
const {staffPayChanges,staffPayChangeValue}=mod.exports;
const change={id:'one',staff_id:'staff-1',salon_id:'salon-1',source_table:'payroll_period_staff_inputs',source_id:'input',period_start:'2026-10-16',period_end:'2026-10-31',created_at:'2026-10-28T12:00:00Z',actor_id:'owner',before_values:{bonus_amount:0,note:null},after_values:{bonus_amount:25,note:'Added the missing bonus.'}};

test('only staff income changes and notes appear; Daily Report, no-ops, other staff and payment metadata are excluded',()=>{
  const daily={...change,id:'daily',source_table:'pos_daily_closings',before_values:{cash_amount:1},after_values:{cash_amount:100}};
  const metadata={...change,id:'check',before_values:{check_number:'1'},after_values:{check_number:'2'}};
  const unchanged={...change,id:'noop',after_values:change.before_values};
  assert.deepEqual(staffPayChanges([daily,metadata,unchanged,{...change,staff_id:'staff-2'},change],'staff-1'),[change]);
  assert.equal(staffPayChanges([{...change,staff_id:null}]).length,0);
  assert.equal(staffPayChanges([{...change,source_table:'pos_ticket_staff_earnings',before_values:{tip_amount:10},after_values:{tip_amount:20}}]).length,1);
  assert.equal(staffPayChanges([{...change,before_values:{note:'Old'},after_values:{note:null}}]).length,1);
  assert.equal(staffPayChangeValue('commission_rate',60),'60%');
  assert.equal(staffPayChangeValue('bonus_amount',25),'$25.00');
});

test('payroll bell links open staff workspace and compact detail without changing unrelated notifications',async()=>{
  const built=await build({entryPoints:['lib/notification-feed-items.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'context',setup(b){
    b.onResolve({filter:/^@\/lib\/current-context$/},()=>({path:'context',namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const getStaffWorkspaceId=id=>`staff:${id}`;export const getManageWorkspaceId=id=>`manage:${id}`;'}));
  }}]});const m={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,m,m.exports);
  const notification={notification_type:'payroll_updated',recipient_kind:'staff',salon_id:'salon',href:'/staff/my-work?tab=payroll&payPeriodStart=2026-10-16'};
  const result=m.exports.resolveAppNotificationDestination(notification);
  assert.equal(result.href,notification.href+'#input-history');assert.equal(result.workspaceId,'staff:salon');
  assert.equal(m.exports.resolveAppNotificationDestination({...notification,href:'/staff/my-work'}).workspaceId,'staff:salon');
  assert.equal(m.exports.resolveAppNotificationDestination({...notification,notification_type:'other'}).href,notification.href);
});

test('compact notice: hidden without changes, single line, click/Escape/focus, note escaping, bell deep link, mobile and desktop', {timeout:60000}, async()=>{
  const dir='artifacts/staff-pay-change-warning-20261028/browser';mkdirSync(dir,{recursive:true});
  await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{StaffPayChangeNotice}from'@/app/staff/my-work/staff-pay-change-notice';
  const original=${JSON.stringify(change)};original.after_values.note='Owner note <script>alert(1)</script> '+ 'Long note '.repeat(500);function App(){const[rows,setRows]=useState([]);return <main><h1>My Pay</h1><p>Current take-home pay <strong>$583.28</strong></p><button id="change" onClick={()=>setRows([original])}>Owner change fixture</button><button id="empty" onClick={()=>setRows([])}>Clear fixture</button><StaffPayChangeNotice changes={rows} staffId="staff-1"/><p>Pay breakdown</p></main>}createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,outfile:dir+'/fixture.js',jsx:'automatic',plugins:[{name:'copy',setup(b){
    b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;'}));
  }}]});
  const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{font-family:Arial;margin:0;color:#19252d}main{padding:20px;max-width:1000px;margin:auto}h1{font-size:22px}main>p{padding:20px 0}#change,#empty{margin:0 8px 20px 0}</style><div id="root"></div><script src="/fixture.js"></script>';
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html');res.end(req.url.startsWith('/fixture.')?readFileSync(dir+req.url):html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  const checks=[];
  try{browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
    for(const width of [390,1280]){const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#change').waitFor();
      const notice=page.getByRole('button',{name:/Payroll updated/});assert.equal(await notice.count(),0);await page.locator('#change').click();await notice.waitFor();assert.ok((await notice.boundingBox()).height<=48);
      await notice.click();const dialog=page.getByRole('dialog');await dialog.waitFor();assert.ok((await dialog.innerText()).includes('$0.00'));assert.ok((await dialog.innerText()).includes('$25.00'));assert.ok((await dialog.innerText()).includes('<script>alert(1)</script>'));assert.equal(await page.locator('dialog script').count(),0);
      let nativeCloseEvents=0;
      const closeAndWaitForNativeEvent=async action=>{
        // Escape removes `open` before the queued native close event. Waiting
        // only for hidden can race onClose's hash cleanup with the next link.
        await dialog.evaluate(element=>{
          element.dataset.testNativeClose='pending';
          element.addEventListener('close',()=>queueMicrotask(()=>{element.dataset.testNativeClose='handled';}),{once:true});
        });
        await action();
        await page.waitForFunction(()=>document.querySelector('dialog')?.dataset.testNativeClose==='handled');
        await dialog.waitFor({state:'hidden'});nativeCloseEvents++;
      };
      assert.ok(await dialog.evaluate(el=>el.scrollHeight>el.clientHeight));assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
      await closeAndWaitForNativeEvent(()=>page.keyboard.press('Escape'));assert.equal(await notice.evaluate(el=>el===document.activeElement),true);
      await page.evaluate(()=>location.hash='payroll-changes');await dialog.waitFor();await closeAndWaitForNativeEvent(()=>dialog.getByRole('button',{name:'Close',exact:true}).click());await page.waitForFunction(()=>location.hash==='');
      await notice.click();await page.screenshot({path:resolve(dir,`detail-${width}.png`)});await closeAndWaitForNativeEvent(()=>page.keyboard.press('Escape'));await page.screenshot({path:resolve(dir,`notice-${width}.png`)});
      await page.locator('#empty').click();assert.equal(await notice.count(),0);assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.equal(nativeCloseEvents,3);checks.push({width,nativeCloseEvents,hashReopenedAfterEscape:true,passed:true});await page.close();}
    writeFileSync(dir+'/results.json',JSON.stringify(checks,null,2));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
});


