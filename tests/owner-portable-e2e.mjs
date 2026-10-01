import fs from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';import {randomUUID,createHmac} from 'node:crypto';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';import {chromium,_electron as electron} from 'playwright-core';import {createClient} from '@supabase/supabase-js';
if(process.env.KINGPOS_ALLOW_TEST_DB_WRITES!=='1'||!process.env.KINGPOS_UI_TEST_URL)throw Error('Explicit isolated test authorization required');
const scratch=fs.mkdtempSync(path.join(tmpdir(),'kingpos-owner-test-')),base=process.env.KINGPOS_UI_TEST_URL;
const [account,salon,auth,user,key,staff]=Array.from({length:6},randomUUID),password='Test!'+randomUUID(),email=`pos-test-${auth}@example.invalid`,digest=randomUUID(),signature=createHmac('sha256',digest).update(key).digest('hex');
function sql(query){const file=path.join(scratch,'query.sql');fs.writeFileSync(file,query);const result=spawnSync('powershell.exe',['-NoProfile','-File',path.join(process.env.APPDATA,'npm/supabase.ps1'),'db','query','--linked','--file',file],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr+result.stdout);return JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))).rows;}
const vars=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(line=>/^[A-Z_]+=/.test(line)).map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1).replace(/^['"]|['"]$/g,'')];}));
let browser,nativeApp;
try{
 sql(`begin;
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)values('${auth}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','${email}',extensions.crypt('${password}',extensions.gen_salt('bf')),now(),now(),now(),'','','','');
 insert into auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)values(gen_random_uuid(),'${auth}','${auth}',jsonb_build_object('sub','${auth}','email','${email}'),'email',now(),now(),now());
 insert into public.users(id,auth_user_id,email,display_name)values('${user}','${auth}','${email}','Owner test');
 insert into accounts(id,name,status)values('${account}','Workspace isolated test','active');
 insert into locations(id,account_id,name,status,country)values('${salon}','${account}','Workspace isolated test','active','US');
 insert into roles(account_id,name,code,is_system)values('${account}','Owner','OWNER',true) on conflict(account_id,code)do nothing;
 insert into account_memberships(account_id,user_id,role_id,status)values('${account}','${user}',(select id from roles where code='OWNER' and account_id='${account}' limit 1),'active');
 insert into pos_settings(salon_id,staff_check_in_enabled)values('${salon}',false);
 insert into staff(id,salon_id,display_name,is_active,pos_enabled)values('${staff}','${salon}','Test staff',true,true);
 insert into pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest,is_active)values('${key}','${salon}','owner-test-${key}','test','${digest}',true);commit;`);
 const client=createClient(vars.NEXT_PUBLIC_SUPABASE_URL,vars.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw Error(error.message);
 browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 const owner=await browser.newContext({viewport:{width:390,height:844}});await owner.addCookies([{name:'sb-access-token',value:data.session.access_token,url:base},{name:'sb-refresh-token',value:data.session.refresh_token,url:base},{name:'kingpos-current-account-id',value:account,url:base},{name:'kingpos-current-manage-salon-id',value:salon,url:base}]);
 const page=await owner.newPage();page.setDefaultTimeout(45000);await page.goto(base+'/pos');await page.getByRole('button',{name:/Test staff/}).click();await page.locator('[aria-label=Amount]:visible').fill('42');
 if(process.env.KINGPOS_UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'owner-pos-phone.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Owner POS must fit phone width');
 assert.ok(await page.locator('.owner-submit').evaluate(e=>e.getBoundingClientRect().bottom<=Math.min(innerHeight,document.querySelector('.owner-checkout').getBoundingClientRect().bottom)),'Submit must stay above mobile navigation');
 await page.setViewportSize({width:320,height:568});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 if(process.env.KINGPOS_UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'owner-pos-small-phone.png')});
 assert.ok(await page.locator('.owner-submit').evaluate(e=>e.getBoundingClientRect().bottom<=Math.min(innerHeight,document.querySelector('.owner-checkout').getBoundingClientRect().bottom)),'Submit fits a small phone');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).overflow),'hidden');
 assert.ok(await page.locator('.owner-keypad').evaluate(e=>e.lastElementChild.getBoundingClientRect().bottom<=document.querySelector('.owner-submit').getBoundingClientRect().top),'Keypad must not overlap actions');
 await page.getByRole('button',{name:'Tip',exact:true}).click();await page.getByRole('button',{name:'2',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);assert.match(await page.locator('.owner-adjustment-row').innerText(),/Tip.*\$2.00/s);
 if(process.env.KINGPOS_UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'owner-pos-small-phone.png')});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Submit',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Amount"]').value==='');
 await page.getByRole('button',{name:'Up to date',exact:true}).waitFor();assert.equal(sql(`select count(*)::int n from pos_tickets where salon_id='${salon}'`)[0].n,1);
 const operation={id:randomUUID(),scope:`owner:${salon}:${user}`,kind:'receipt',occurredAt:new Date().toISOString(),payload:{lines:[{staffId:null,serviceLabel:'Concurrent test',total:10,amountInput:'10',amountParts:[10]}]}};
 const replies=await page.evaluate(async op=>Promise.all([1,2].map(async()=>{const r=await fetch('/api/pos/owner/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(op)});return r.json();})),operation);
 assert.equal(replies[0].kind,'ok');assert.equal(replies[0].data.ticketId,replies[1].data.ticketId);assert.equal(sql(`select count(*)::int n from pos_tickets where salon_id='${salon}'`)[0].n,2);
 console.log('PASS: simultaneous requests for one sale commit exactly one ticket.');
 await page.getByRole('link',{name:'Settings',exact:true}).click();await page.locator('summary:visible').filter({hasText:'Windows app & devices'}).waitFor();assert.notEqual(await page.evaluate(()=>getComputedStyle(document.body).overflow),'hidden','Settings must remain scrollable');await page.locator('summary:visible').filter({hasText:'Staff & turns'}).click();
 await page.locator('input[name="large_turn_threshold"]:visible').fill('35');await page.locator('form:visible').filter({has:page.locator('input[name="large_turn_threshold"]:visible')}).getByRole('button',{name:'Save changes'}).click();await page.locator('[role=status]:visible').filter({hasText:'Saved'}).waitFor();
 assert.equal(Number(sql(`select large_turn_threshold n from pos_settings where salon_id='${salon}'`)[0].n),35);
 sql(`update pos_settings set large_turn_threshold=40 where salon_id='${salon}'`);
 await page.locator('input[name="large_turn_threshold"]:visible').fill('36');
 await page.locator('form:visible').filter({has:page.locator('input[name="large_turn_threshold"]:visible')}).getByRole('button',{name:'Save changes'}).click();
 await page.locator('[aria-label="Settings changed"]:visible').waitFor();
 assert.equal(await page.locator('input[name="large_turn_threshold"]:visible').inputValue(),'36');
 await page.locator('button:visible').filter({hasText:'Use saved values'}).click();
 assert.equal(await page.locator('input[name="large_turn_threshold"]:visible').inputValue(),'40');
 await page.goto(base+'/pos');await page.getByRole('button',{name:/Test staff/}).click();await page.locator('[aria-label=Amount]:visible').fill('17');
 await page.setViewportSize({width:1440,height:1000});await page.locator('[aria-label=Amount]:visible').waitFor();
 assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'17');
 assert.equal(await page.locator('[aria-label=Amount]:visible').count(),1);
 if(process.env.KINGPOS_UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'owner-pos-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.locator('[aria-label=Amount]:visible').waitFor();
 assert.equal(await page.locator('[aria-label=Amount]:visible').inputValue(),'17');
 await page.goto(base+'/pos/settings');

 if(process.env.KINGPOS_UI_SCREENSHOT_DIR){
 await page.screenshot({path:path.join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'owner-settings-phone.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 for(const [label,file] of [['POS login & permissions','settings-access'],['Checkout & saved tickets','settings-checkout'],['Customer Display','settings-display'],['Data & sync','settings-sync']]){
   await page.locator('summary:visible').filter({hasText:label}).click();
   const group=page.locator('details:visible').filter({has:page.locator('summary').filter({hasText:label})}).first();
   await group.screenshot({path:path.join(process.env.KINGPOS_UI_SCREENSHOT_DIR,file+'.png')});
   await page.locator('summary:visible').filter({hasText:label}).click();
 }
 }
 const terminals=[];
 for(let n=0;n<2;n++){
  let terminal;
  if(n===0){
   const env={...process.env,KINGPOS_DESKTOP_TEST_PROFILE:path.join(scratch,'native-profile'),KINGPOS_DESKTOP_TEST_ORIGIN:base};delete env.ELECTRON_RUN_AS_NODE;
   nativeApp=await electron.launch({executablePath:path.resolve('desktop/node_modules/electron/dist/electron.exe'),args:[path.resolve('desktop')],env});
   terminal=await nativeApp.firstWindow();
   await nativeApp.evaluate(async({BrowserWindow},v)=>{const cookies=BrowserWindow.getAllWindows()[0].webContents.session.cookies;await cookies.set({name:'kingpos-portable-pos-key-id',value:v.key,url:v.base});await cookies.set({name:'kingpos-portable-pos-session',value:v.signature,url:v.base});},{key,signature,base});
  }else{const context=await browser.newContext();await context.addCookies([{name:'kingpos-portable-pos-key-id',value:key,url:base},{name:'kingpos-portable-pos-session',value:signature,url:base}]);terminal=await context.newPage();}
  terminal.setDefaultTimeout(60000);await terminal.goto(base+'/pos/portable');await terminal.locator('[data-pos-amount-panel]:visible').waitFor();terminals.push(terminal);
 }
 const native=terminals[0];await native.getByRole('link',{name:'Ticket',exact:true}).click();await native.locator('[data-portable-pos-page="ticket"]:visible').waitFor();
 await page.goto(base+'/pos');await page.locator('[aria-label=Amount]:visible').fill('63');
 const synced=page.waitForResponse(r=>r.url().endsWith('/api/pos/owner/operations')&&r.request().method()==='POST');await page.getByRole('button',{name:'Submit',exact:true}).click();const response=await synced;const result=await response.json();assert.equal(result.kind,'ok');
 const started=Date.now();await native.locator('[data-portable-pos-page="ticket"]:visible').getByText('$63.00',{exact:false}).first().waitFor({timeout:25000});console.log('PASS: already-open Windows app received Owner ticket without reload in '+(Date.now()-started)+'ms after server acknowledgement.');

 assert.equal(sql(`select count(distinct d.token)::int n from pos_workspace_drafts b join pos_live_drafts d on d.id=b.draft_id where b.key_id='${key}'`)[0].n,2);
 await page.goto(base+'/reports');await page.locator('button:visible').filter({hasText:/^Daily Closing$/}).waitFor();
 console.log('PASS: real Owner phone checkout and grouped settings, SQL receipt, separate Portable device display drafts, report loads.');
}catch(error){console.error('Owner test failure:',error);throw error;}finally{
 await nativeApp?.close();await browser?.close();
 sql(`begin;delete from pos_workspace_drafts where key_id='${key}';delete from pos_owner_operations where salon_id='${salon}';delete from pos_ticket_audit_logs where salon_id='${salon}';delete from pos_payments where salon_id='${salon}';delete from pos_ticket_item_turn_parts where salon_id='${salon}';delete from pos_ticket_items where salon_id='${salon}';delete from pos_tickets where salon_id='${salon}';delete from pos_daily_closings where salon_id='${salon}';delete from pos_live_drafts where salon_id='${salon}';delete from pos_portable_access_keys where salon_id='${salon}';delete from pos_settings where salon_id='${salon}';delete from staff where salon_id='${salon}';delete from customers where location_id='${salon}';delete from locations where id='${salon}';delete from account_memberships where account_id='${account}';delete from accounts where id='${account}';delete from public.users where id='${user}';delete from auth.users where id='${auth}';commit;`);
 if(!path.resolve(scratch).startsWith(path.resolve(tmpdir())+path.sep+'kingpos-owner-test-'))throw Error('Unexpected test directory');fs.rmSync(scratch,{recursive:true,force:true});
}
