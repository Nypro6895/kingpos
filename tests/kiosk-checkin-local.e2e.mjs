// Opt-in full UI check against an ALREADY RUNNING dedicated local QA stack.
// No Supabase CLI, linked project, DB reset, migrations, or production fallback.
import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';import {resolve} from 'node:path';
import {assertLoopbackUrl,assertOwnedKioskDatabase} from './kiosk-local-target.mjs';
import fs from 'node:fs';
const enabled=process.env.RUN_KIOSK_LOCAL_E2E==='1';
test('local full UI: known customer, Back/edit and one confirmed visit',{skip:!enabled,timeout:180000},async(t)=>{
 const base=assertLoopbackUrl(process.env.KIOSK_E2E_BASE_URL);
 const backend=assertLoopbackUrl(process.env.KIOSK_E2E_BACKEND_URL);
 const container=process.env.KIOSK_E2E_DB_CONTAINER,scope=process.env.KIOSK_E2E_SCOPE;
 assert.match(container??'',/^kiosk-e2e-[a-z0-9-]+$/,'A dedicated kiosk container is required');
 const docker=process.env.TEST_DOCKER_PATH||'docker',context=process.env.TEST_DOCKER_CONTEXT||'desktop-linux';
 const command=(args,input)=>execFileSync(docker,['--context',context,...args],{input,encoding:'utf8',windowsHide:true,timeout:30000});
 const meta=JSON.parse(command(['inspect',container]))[0];
 const network=meta.HostConfig.NetworkMode;
 const internal=network==='none'?false:JSON.parse(command(['network','inspect',network]))[0]?.Internal===true;
 assertOwnedKioskDatabase(meta,scope,internal);
 // Explicit runtime declaration from the local QA launcher; never inherit a live backend.
 assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,backend,'App launcher must target this exact local backend');
 assert.equal(process.env.KIOSK_QA_NOTIFICATIONS_DISABLED,'1','Local QA notification worker must be disabled');
 assert.equal((await fetch(base,{redirect:'manual',signal:AbortSignal.timeout(5000)})).status<500,true,'Local app unavailable');
 const sql=s=>command(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'],s).trim();
 assert.equal(sql("select position('p_new cannot bypass' in pg_get_functiondef('public.resolve_display_customer_identity(uuid,text,text,uuid,boolean)'::regprocedure))>0"),'t','Kiosk migration is not present on local backend');
 const [account,salon,customer,service,draft]=Array.from({length:5},crypto.randomUUID),token=crypto.randomBytes(16).toString('hex');
 sql(`begin;
 insert into accounts(id,name,status) values('${account}','Kiosk Synthetic QA','active');
 insert into locations(id,account_id,name,status,country) values('${salon}','${account}','Kiosk Synthetic QA','active','US');
 insert into customers(id,location_id,name,phone,status,source) values('${customer}','${salon}','Avery Demo','2025550147','active','manual');
 insert into services(id,salon_id,name,category,base_price,duration_minutes,is_active,online_booking_enabled) values('${service}','${salon}','Synthetic manicure','Nails',25,30,true,true);
 insert into pos_live_drafts(id,salon_id,token) values('${draft}','${salon}','${token}');commit;`);
 const {chromium}=createRequire(resolve('package.json'))('playwright-core');
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 t.signal.addEventListener('abort',()=>void browser.close(),{once:true});
 const output=process.env.KIOSK_E2E_OUTPUT_DIR??'artifacts/kiosk-local-e2e';fs.mkdirSync(output,{recursive:true});
 let page,stage='open';
 try{
  page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(15000);
  await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost','[::1]'].includes(u.hostname)?route.continue():route.abort();});
  await page.goto(base+'/pos/customer-display?token='+token);
  console.log('UI stage: open');
  await page.waitForFunction(()=>document.querySelector('[data-customer-display-attract]')||document.querySelector('input[aria-label="Phone"]'));
  const attract=page.locator('[data-customer-display-attract]');if(await attract.isVisible())await attract.click();
  stage='phone';const firstPhone=page.getByRole('textbox',{name:'Phone',exact:true});await firstPhone.waitFor();console.log('UI stage: phone');
  for(const digit of '2025550147')await page.getByRole('button',{name:`Digit ${digit}`,exact:true}).click();
  stage='recognition';console.log('UI stage: recognition');
  await page.getByText('Synthetic manicure',{exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Name',exact:true}).count(),0);
  await page.getByRole('button',{name:'Back',exact:true}).click();
  stage='back';console.log('UI stage: back');
  const phone=page.getByRole('textbox',{name:'Phone',exact:true});await phone.waitFor();
  await new Promise(r=>setTimeout(r,800));assert.equal((await phone.inputValue()).replace(/\D/g,''),'2025550147');
  await page.getByRole('button',{name:'Backspace',exact:true}).click();await page.getByRole('button',{name:'Digit 7',exact:true}).click();await page.getByText('Synthetic manicure',{exact:true}).waitFor();
  stage='services';console.log('UI stage: services');
  await page.getByRole('button',{name:/Synthetic manicure/}).click();
  await page.getByRole('button',{name:/Confirm/}).click();
  stage='confirmation';console.log('UI stage: confirmation');
  await page.locator('[data-customer-display-checkin]').waitFor();
  assert.equal(sql(`select count(*) from customer_visit_services s join customer_visits v on v.id=s.visit_id where v.salon_id='${salon}' and s.service_id='${service}'`),'1');
  assert.equal(sql(`select count(*) from customer_visits where salon_id='${salon}' and customer_id='${customer}' and status in ('waiting','in_service','checkout')`),'1');
  assert.equal(sql(`select count(*) from customers where location_id='${salon}' and normalize_customer_claim_phone(phone)='+12025550147'`),'1');
  assert.equal(sql(`select customer_user_id is null from customers where id='${customer}'`),'t');
 }catch(error){if(page&&!page.isClosed()){await page.screenshot({path:output+'/failure.png'}).catch(()=>{});fs.writeFileSync(output+'/failure.txt',`stage=${stage}\n`+await page.locator('body').innerText().catch(()=>''));}throw error;}finally{await browser.close();}
 // Retain this uniquely identified synthetic fixture for inspection; never reset a DB.
 console.log(JSON.stringify({syntheticFixture:{account,salon,customer,draft},retained:true}));
});
