// Opt-in: use only with a Supabase test project linked to this checkout.
// KINGPOS_ALLOW_TEST_DB_WRITES=1 KINGPOS_UI_TEST_URL=http://localhost:3107
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { randomUUID, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
if (process.env.KINGPOS_ALLOW_TEST_DB_WRITES !== "1" || !process.env.KINGPOS_UI_TEST_URL) {
  throw new Error("Set KINGPOS_ALLOW_TEST_DB_WRITES=1 and KINGPOS_UI_TEST_URL for a confirmed test database.");
}
const repo=process.cwd();
const scratch=fs.mkdtempSync(path.join(tmpdir(),'kingpos-offline-e2e-'));const [account,salon,key,staff,secondStaff]=Array.from({length:5},randomUUID);const customer=randomUUID();const customerPhone='202555'+String(Math.floor(Math.random()*10000)).padStart(4,'0');const newPhone='312555'+String(Math.floor(Math.random()*10000)).padStart(4,'0');const digest=randomUUID();const signature=createHmac('sha256',digest).update(key).digest('hex');
function query(sql){const file=path.join(scratch,'fixture.sql');fs.writeFileSync(file,sql);const r=spawnSync('powershell.exe',['-NoProfile','-File',path.join(process.env.APPDATA,'npm/supabase.ps1'),'db','query','--linked','--file',file],{cwd:repo,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.stdout);const parsed=JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));if(!parsed.rows)throw Error(JSON.stringify(parsed));return parsed.rows;}
(async()=>{try{
query(`begin;
insert into public.accounts(id,name,status) values('${account}','Portable HTTP test','active');
insert into public.locations(id,account_id,name,status,country) values('${salon}','${account}','Portable HTTP test','active','US');
insert into public.pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,label,is_active) values('${key}','${salon}','test-${key}','test','${digest}','Test',true);
insert into public.staff(id,salon_id,display_name,is_active,pos_enabled) values('${staff}','${salon}','Test staff',true,true);
insert into public.staff(id,salon_id,display_name,is_active,pos_enabled) values('${secondStaff}','${salon}','Second staff',true,true);
insert into public.customers(id,location_id,name,phone,status,source) values('${customer}','${salon}','Maya Customer','${customerPhone}','active','manual');
insert into public.pos_settings(salon_id,staff_check_in_enabled) values('${salon}',true);commit;`);
const base=process.env.KINGPOS_UI_TEST_URL;

let debugPage, debugDisplay;
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{
const context=await browser.newContext({viewport:{width:1600,height:1000}});
const hydrationErrors=[];context.on('page',p=>p.on('console',message=>{if(/hydrated|hydration failed/i.test(message.text()))hydrationErrors.push(message.text());}));
await context.addCookies([{name:'kingpos-portable-pos-key-id',value:key,url:base},{name:'kingpos-portable-pos-session',value:signature,url:base}]);
const page=await context.newPage();debugPage=page;page.setDefaultTimeout(30000);await page.clock.install();
async function waitForAsync(fn,arg){const until=Date.now()+90000;while(Date.now()<until){if(await page.evaluate(fn,arg))return;await page.waitForTimeout(100);}throw Error('Async condition timed out');}
await page.goto(base+'/pos/portable',{waitUntil:'domcontentloaded',timeout:120000});
await page.locator('[data-pos-amount-panel]:visible').waitFor({timeout:90000});
await page.waitForFunction(scope=>!!localStorage.getItem('kingpos:offline-staff:'+scope),salon+':'+key,{timeout:60000});
await waitForAsync(async()=>!!await(await caches.open('kingpos-portable-shell-v1')).match('/pos/__portable-cache-session'),null,{timeout:90000});
console.log("Prepared offline shell and staff verifier.");
const display=await context.newPage();debugDisplay=display;
await display.goto(base+'/pos/customer-display',{waitUntil:'domcontentloaded'});
await display.locator('[data-customer-display-attract]').waitFor({timeout:60000});
console.log('Paired customer display is idle.');
let workspaceReloads=0;
page.on('request',request=>{if(request.method()==='GET'&&request.headers().rsc==='1')workspaceReloads++;});
await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
await context.setOffline(true);
await page.locator('a[href="/pos/portable/check-in"]').first().click();
await page.locator('[data-portable-check-in-page] button').filter({hasText:'Test staff'}).click();
await page.getByLabel('Passcode',{exact:true}).pressSequentially('1234');await page.getByRole('button',{name:'Confirm',exact:true}).click();
await page.getByRole('dialog').waitFor({state:'hidden'});console.log('Offline check-in saved.');
await page.locator('[data-portable-check-in-page] button').filter({hasText:'Second staff'}).click();
await page.getByLabel('Passcode',{exact:true}).pressSequentially('1234');await page.getByRole('button',{name:'Confirm',exact:true}).click();
await page.getByRole('dialog').waitFor({state:'hidden'});
await page.locator('a[href="/pos/portable"]').first().click();
assert.match(await page.locator('[data-pos-staff-turn-board] button[data-pos-staff-large-turns]').first().innerText(),/Test/);
for(let n=0;n<2;n++){
 await page.locator('[data-pos-staff-turn-board] button[data-pos-staff-large-turns]').filter({hasText:'Test'}).click();
 await page.locator('[data-pos-amount-panel]:visible').getByRole('button',{name:'5',exact:true}).click();
 await page.locator('[data-pos-amount-panel]:visible').getByRole('button',{name:'0',exact:true}).click();
 await display.getByText('$50.00',{exact:true}).first().waitFor();
 await page.getByRole('button',{name:'Submit',exact:true}).click();
 await page.getByText('Ticket saved',{exact:true}).waitFor();
 await display.locator('[data-customer-display-completed]').waitFor();
 assert.match(await page.locator('[data-pos-staff-turn-board] button[data-pos-staff-large-turns]').first().innerText(),/Second/);
 await display.locator('[data-customer-display-completed]').click();
 await display.locator('[data-customer-display-attract]').waitFor();
 const close=page.locator('[data-pos-toast-close]');if(await close.isVisible())await close.click();
}
assert.equal(await page.locator('[data-pos-toast-tone="error"]').count(),0,'Offline work showed an error popup');
assert.equal(await page.locator('[data-pos-staff-turn-board] button[data-pos-staff-large-turns]').filter({hasText:'Test'}).getAttribute('data-pos-staff-large-turns'),'2');
const readRows=()=>page.evaluate(scope=>new Promise((resolve,reject)=>{const req=indexedDB.open('kingpos-portable-operations',1);req.onsuccess=()=>{const read=req.result.transaction('operations').objectStore('operations').getAll();read.onsuccess=()=>resolve(read.result.filter(r=>r.scope===scope));read.onerror=()=>reject(read.error);};}),salon+':'+key);
assert.equal((await readRows()).filter(r=>r.kind==='receipt').length,2);
await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-pos-amount-panel]:visible').waitFor();
await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Submit'&&!button.disabled&&button.getClientRects().length>0));console.log('Offline page hydrated.');
assert.equal((await readRows()).filter(r=>r.kind==='receipt').length,2);
await context.setOffline(false);
await waitForAsync(scope=>new Promise(resolve=>{const req=indexedDB.open('kingpos-portable-operations',1);req.onsuccess=()=>{const read=req.result.transaction('operations').objectStore('operations').getAll();read.onsuccess=()=>resolve(read.result.filter(r=>r.scope===scope).every(r=>r.state==='synced'));};}),salon+':'+key,{timeout:90000});
assert.equal(query(`select count(*)::int as count from public.pos_tickets where salon_id='${salon}';`)[0].count,2);
assert.equal(workspaceReloads,0,'Background sync triggered workspace navigation');
for (const [phone,name,isNew] of [[customerPhone,'Maya',false],[newPhone,'New Guest',true]]) {
 await page.locator('[data-pos-staff-turn-board] button[data-pos-staff-large-turns]').filter({hasText:'Test'}).click();
 await page.locator('[data-pos-amount-panel]:visible').getByRole('button',{name:'5',exact:true}).click();
 await display.getByLabel('Phone',{exact:true}).pressSequentially(phone);
 if(isNew){await display.getByLabel('Customer name',{exact:true}).fill(name);await display.getByRole('button',{name:'Continue',exact:true}).click();}
 await display.getByText(isNew ? /Welcome, New/ : /Welcome back, Maya/).first().waitFor();
 await page.getByText(isNew ? 'New Guest' : 'Maya Customer',{exact:true}).first().waitFor();
 console.log(isNew?'New profile received by POS.':'Existing customer received by POS.');
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await display.locator('[data-customer-display-attract]').waitFor();
}
console.log('Existing customer greeting and new profile propagate to POS.');
query(`insert into public.services(id,salon_id,name,category,base_price,duration_minutes,is_active,online_booking_enabled) values('${randomUUID()}','${salon}','Test manicure','Nails',50,30,true,true);`);
await display.reload({waitUntil:'domcontentloaded'});
await display.locator('[data-customer-display-attract]').click();
await display.getByLabel('Phone',{exact:true}).pressSequentially(customerPhone);
console.log('Idle phone entered:',await display.evaluate(()=>document.querySelector('input[aria-label="Phone"]')?.value));
await display.locator('[data-customer-display-service-select]').waitFor();
await display.getByRole('button',{name:/Test manicure/}).click();
await display.locator('[data-customer-display-service-select]').getByRole('button',{name:'Check in',exact:true}).click();
await display.locator('[data-customer-display-checkin]').waitFor();
console.log('Idle customer check-in and service selection restored.');
await page.getByRole('button',{name:/Open waiting list, 1 waiting/}).waitFor({timeout:10000});
await page.getByRole('button',{name:/Open waiting list/}).click();
if(process.env.KINGPOS_UI_SCREENSHOT_DIR) await page.locator('[data-pos-waiting-drawer]').screenshot({path:path.join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'waiting-actions.png')});
await context.setOffline(true);
await page.getByRole('button',{name:'Select Maya Customer from waiting',exact:true}).click();
await page.getByText('Maya Customer',{exact:true}).first().waitFor();
await page.locator('[data-pos-staff-turn-board] button[data-pos-staff-large-turns]').filter({hasText:'Test'}).click();
await page.locator('[data-pos-amount-panel]:visible').getByRole('button',{name:'5',exact:true}).click();
await page.getByRole('button',{name:'Save for later',exact:true}).click();
await page.getByRole('button',{name:'Saved tickets (1)',exact:true}).click();
if(process.env.KINGPOS_UI_SCREENSHOT_DIR) await page.getByRole('dialog',{name:'Saved tickets'}).screenshot({path:path.join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'saved-tickets.png')});
await page.getByRole('button',{name:/^Maya Customer ·/}).click();
await page.getByText('Maya Customer',{exact:true}).first().waitFor();
assert.equal(await page.getByRole('button',{name:'Saved tickets (0)',exact:true}).count(),1);
await page.getByText('$5.00',{exact:true}).first().waitFor();
await page.locator('a[href="/pos/portable/check-in"]').first().click();
await page.clock.fastForward(180100);
await page.getByRole('dialog',{name:'Unfinished ticket'}).waitFor();
if(process.env.KINGPOS_UI_SCREENSHOT_DIR) await page.getByRole('dialog',{name:'Unfinished ticket'}).screenshot({path:path.join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'idle-ticket.png')});
await page.getByRole('button',{name:'Continue',exact:true}).click();
await page.clock.fastForward(180100);
await page.getByRole('dialog',{name:'Unfinished ticket'}).waitFor();
await page.clock.fastForward(61000);
await page.getByRole('dialog',{name:'Unfinished ticket'}).waitFor({state:'hidden'});
assert.equal(await page.getByText('Maya Customer',{exact:true}).count(),0);
await page.clock.setSystemTime(new Date());
await page.locator('a[href="/pos/portable/check-in"]').first().click();
await page.locator('[data-portable-check-in-page] button').filter({hasText:'Test staff'}).click();
await page.getByRole('button',{name:'Check out',exact:true}).click();
await page.getByLabel('Passcode',{exact:true}).pressSequentially('1234');
await page.getByRole('button',{name:'Confirm',exact:true}).click();
await page.getByRole('dialog').waitFor({state:'hidden'});
await page.locator('a[href="/pos/portable"]').first().click();
assert.equal(await page.locator('[data-pos-staff-turn-board]').getByRole('button',{name:/^Test staff,/}).count(),0);
console.log('PASS: immediate waiting selection offline, parked restore, 3+1 minute idle reset, immediate staff checkout.');
await page.getByRole('button',{name:/Open waiting list/}).click();
await page.getByRole('button',{name:'Edit Maya Customer',exact:true}).click();
const editDialog=page.getByRole('dialog',{name:'Edit waiting customer'});
await editDialog.getByLabel('Name',{exact:true}).fill('Edited Maya');
await editDialog.getByRole('button',{name:'Save',exact:true}).click();
await editDialog.waitFor({state:'hidden'});
await page.getByRole('button',{name:'Edited Maya left',exact:true}).click();
await page.getByRole('button',{name:'Close',exact:true}).click();
await page.getByText('No customer waiting',{exact:true}).first().waitFor();
await context.setOffline(false);
await waitForAsync(scope=>new Promise(resolve=>{const req=indexedDB.open('kingpos-portable-operations',1);req.onsuccess=()=>{const read=req.result.transaction('operations').objectStore('operations').getAll();read.onsuccess=()=>resolve(read.result.filter(r=>r.scope===scope).every(r=>r.state==='synced'));};}),salon+':'+key);
assert.equal(query(`select cancelled_reason from public.customer_visits where salon_id='${salon}' and customer_id='${customer}' order by checked_in_at desc limit 1;`)[0].cancelled_reason,'Customer left before service.');
console.log('PASS: offline customer edit and left action sync to retained visit history.');



await context.setOffline(true);
try { await page.getByRole('button',{name:'Lock POS',exact:true}).click(); } catch { /* Offline navigation can replace the document while clicking. */ }
await page.getByRole('dialog',{name:'POS locked'}).waitFor();
assert.ok((await context.cookies()).some(cookie=>cookie.name==='kingpos-portable-local-lock'&&cookie.value==='1'));
await context.setOffline(false);
// Chromium can finish reconnecting the service-worker target after the page target.
// A failed navigation may be retried, but must ultimately reach login, never cached POS.
for(let attempt=0;;attempt++) {
 try { await page.goto(base+'/pos/portable',{waitUntil:'domcontentloaded'}); break; }
 catch(error) { if(attempt>=3)throw error;await page.waitForTimeout(1000); }
}
await page.locator('input[name=access_id]').waitFor();
assert.equal(await page.locator('[data-pos-amount-panel]:visible').count(),0,'Offline lock reopened the authenticated desk');
assert.deepEqual(hydrationErrors,[],'Clean browser reported hydration errors');
console.log('PASS: real Portable UI offline check-in, two submits, immediate staff ordering, paired display thank-you/idle, offline reload, exact-once upload and offline lock.');
}catch(error){if(debugDisplay)console.error('DISPLAY:',(await debugDisplay.locator('body').innerText()).slice(0,2500));if(debugPage)console.error((await debugPage.locator('body').innerText()).slice(0,2500));throw error;}finally{await browser.close();}
}finally{query(`begin;delete from public.pos_ticket_audit_logs where salon_id='${salon}';delete from public.pos_payments where salon_id='${salon}';delete from public.pos_ticket_item_turn_parts where salon_id='${salon}';delete from public.pos_ticket_items where salon_id='${salon}';delete from public.pos_tickets where salon_id='${salon}';delete from public.customer_visits where salon_id='${salon}';delete from public.pos_live_drafts where salon_id='${salon}';delete from public.pos_portable_access_keys where salon_id='${salon}';delete from public.pos_settings where salon_id='${salon}';delete from public.services where salon_id='${salon}';delete from public.staff where salon_id='${salon}';delete from public.customers where location_id='${salon}';delete from public.locations where id='${salon}' and account_id='${account}';delete from public.accounts where id='${account}';commit;`);console.log('Temporary test fixtures removed.');fs.unlinkSync(path.join(scratch,'fixture.sql'));fs.rmdirSync(scratch);}})().catch(e=>{console.error(e.message);process.exitCode=1;});
