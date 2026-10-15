import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
import {createHmac,randomBytes} from 'node:crypto';
const read=path=>readFileSync(path,'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('system SMS checks the master and function switches before any provider request',async()=>{
 const bundle=await build({entryPoints:['lib/system-sms.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'settings-fixture',setup(b){
  b.onResolve({filter:/^server-only$|twilio-settings$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='server-only'?'':'export async function getTwilioSettings(){return globalThis.smsSettingsFixture}'}));
 }}]});
 const {sendSystemSms,systemSmsReady}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
 const oldFetch=globalThis.fetch,oldSecret=process.env.SUPABASE_SEND_SMS_HOOK_SECRET;
 let calls=0;
 try {
  globalThis.smsSettingsFixture={accountSid:'AC-fixture',authToken:'secret',from:'+15555550100',enabled:false,authSms:true,loginAlerts:true,salonVerification:true};
  globalThis.fetch=async()=>{calls++;return Response.json({sid:'SM-fixture'});};
  assert.equal(await systemSmsReady('loginAlerts'),false);
  await assert.rejects(sendSystemSms('loginAlerts','+15555550101','fixture'),/disabled/);
  globalThis.smsSettingsFixture.enabled=true;globalThis.smsSettingsFixture.loginAlerts=false;
  await assert.rejects(sendSystemSms('loginAlerts','+15555550101','fixture'),/disabled/);
  assert.equal(calls,0);
  delete process.env.SUPABASE_SEND_SMS_HOOK_SECRET;
  assert.equal(await systemSmsReady('authSms'),false);
  process.env.SUPABASE_SEND_SMS_HOOK_SECRET='fixture';
  assert.equal(await systemSmsReady('authSms'),true);
  assert.equal(await sendSystemSms('salonVerification','+15555550101','fixture'),'SM-fixture');
  assert.equal(calls,1);
 } finally {globalThis.fetch=oldFetch;delete globalThis.smsSettingsFixture;if(oldSecret===undefined)delete process.env.SUPABASE_SEND_SMS_HOOK_SECRET;else process.env.SUPABASE_SEND_SMS_HOOK_SECRET=oldSecret;}
});

test('Auth SMS hook verifies signatures and rejects tampering and stale requests',async()=>{
 const bundle=await build({entryPoints:['lib/auth-sms-hook.ts'],bundle:true,write:false,platform:'node',format:'esm'});
 const {verifyAuthSmsHook}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
 const key=randomBytes(32),now=Date.now(),timestamp=String(Math.floor(now/1000)),body='{"sms":{"otp":"123456"}}';
 const signature=createHmac('sha256',key).update(`fixture.${timestamp}.${body}`).digest('base64');
 const headers=new Headers({'webhook-id':'fixture','webhook-timestamp':timestamp,'webhook-signature':`v1,${signature}`});
 assert.equal(verifyAuthSmsHook(body,headers,`v1,whsec_${key.toString('base64')}`,now),true);
 assert.equal(verifyAuthSmsHook(body+'x',headers,key.toString('base64'),now),false);
 assert.equal(verifyAuthSmsHook(body,headers,key.toString('base64'),now+301000),false);
 assert.equal(verifyAuthSmsHook(body,new Headers(),key.toString('base64'),now),false);
});

test('Auth SMS hook rejects unsigned requests and never resends an accepted or uncertain hook',async()=>{
 const rows=new Map();let sends=0,fail=false;
 globalThis.smsHookFixture={
  send:async()=>{sends++;if(fail)throw new Error('Network interrupted');},
  client:()=>({from:()=>({
   insert:async({id})=>{if(rows.has(id))return {error:{code:'23505'}};rows.set(id,'sending');return {error:null};},
   select:()=>({eq:(_key,id)=>({single:async()=>({data:{state:rows.get(id)},error:null})})}),
   update:({state})=>({eq:async(_key,id)=>{rows.set(id,state);return {error:null};}}),
  })}),
 };
 const bundle=await build({entryPoints:['app/api/auth/sms-hook/route.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'hook-fixture',setup(b){
  b.onResolve({filter:/system-sms$|twilio-settings$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.endsWith('system-sms')?'export async function sendSystemSms(){return globalThis.smsHookFixture.send()}':'export function twilioSettingsClient(){return globalThis.smsHookFixture.client()}'}));
 }}]});
 const {POST}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
 const secret=randomBytes(32),oldSecret=process.env.SUPABASE_SEND_SMS_HOOK_SECRET;
 process.env.SUPABASE_SEND_SMS_HOOK_SECRET=secret.toString('base64');
 const request=id=>{
  const body=JSON.stringify({user:{phone:'15555550100'},sms:{otp:'123456'}}),ts=String(Math.floor(Date.now()/1000));
  return new Request('http://localhost/api/auth/sms-hook',{method:'POST',body,headers:{'webhook-id':id,'webhook-timestamp':ts,'webhook-signature':`v1,${createHmac('sha256',secret).update(`${id}.${ts}.${body}`).digest('base64')}`}});
 };
 try {
  assert.equal((await POST(new Request('http://localhost',{method:'POST',body:'{}'}))).status,401);
  assert.equal(sends,0);
  assert.equal((await POST(request('accepted'))).status,200);
  assert.equal((await POST(request('accepted'))).status,200);
  assert.equal(sends,1);
  fail=true;
  assert.equal((await POST(request('uncertain'))).status,503);
  fail=false;
  assert.equal((await POST(request('uncertain'))).status,503);
  assert.equal(sends,2);
 } finally {delete globalThis.smsHookFixture;if(oldSecret===undefined)delete process.env.SUPABASE_SEND_SMS_HOOK_SECRET;else process.env.SUPABASE_SEND_SMS_HOOK_SECRET=oldSecret;}
});

test('booking SMS uses plugin credentials and requires a server quota reservation before sending',async()=>{
 globalThis.bookSmsFixture={config:null,reserved:true};
 const bundle=await build({entryPoints:['lib/booking-notifications.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'plugin-fixture',setup(b){
  b.onResolve({filter:/^server-only$|booksms$|^@supabase\/supabase-js$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='server-only'?'':a.path.endsWith('booksms')?'export async function bookSmsConfig(){return globalThis.bookSmsFixture.config}':'export function createClient(){return {rpc:async()=>({data:globalThis.bookSmsFixture.reserved,error:null})}}'}));
 }}]});
 const {sendBookingMessage}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
 const oldFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{calls++;assert.match(url,/AC-plugin/);return Response.json({sid:'SM-fixture'});};
 const message={id:'fixture',channel:'sms',recipient:'+15555550100',message:'fixture',salon_id:id(10),event_key:'confirmed'};
 try {
  assert.equal((await sendBookingMessage(message)).state,'unconfigured');assert.equal(calls,0);
  globalThis.bookSmsFixture.config={enabled:true,accountSid:'AC-plugin',authToken:'plugin-token',messagingServiceSid:'MG-plugin'};
  globalThis.bookSmsFixture.reserved=false;
  assert.equal((await sendBookingMessage(message)).state,'unconfigured');assert.equal(calls,0);
  globalThis.bookSmsFixture.reserved=true;
  assert.equal((await sendBookingMessage(message)).state,'accepted');assert.equal(calls,1);
 } finally {globalThis.fetch=oldFetch;delete globalThis.bookSmsFixture;}
});

test('BookSMS migration gates unpaid, uninstalled, disabled, expired and exhausted salons; billing fulfills paid access', {timeout:120000},async()=>{
 const db=new PGlite();
 try {
  // Reuse the existing billing fixture, without executing its tests.
  const fixture=read('tests/market-bank-billing.integration.test.mjs').match(/const bootstrap=(`[^]*?`);/)[1];
  await db.exec(new Function('admin','owner','other','operator','suspended','salon','otherSalon',`return ${fixture}`)(id(1),id(2),id(3),id(4),id(5),id(10),id(11)));
  await db.exec(read('supabase/migrations/20261009160001_market_commerce_configuration.sql'));
  await db.exec(read('supabase/migrations/20261009180001_market_bank_billing.sql'));
  await db.exec('create table tax_company_subscriptions (like booking_policy_subscriptions including all);');
  const tax=read('supabase/migrations/20261009210001_tax_company_plugin.sql');
  await db.exec(tax.slice(tax.indexOf('-- Extend the existing audited bank')));
  await db.exec(`create table customers(id uuid primary key,location_id uuid,email text,phone text);
   create table booking_settings(salon_id uuid primary key,confirmation_email_enabled boolean default true,confirmation_sms_enabled boolean default true,reminder_enabled boolean default true);
   create table bookings(id uuid primary key,customer_id uuid,salon_id uuid,status text,start_at timestamptz,confirmation_status text,salon_timezone_snapshot text,created_at timestamptz default now());
   create function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select true$$;`);
  const booking=read('supabase/migrations/202609240003_booking_notifications.sql');
  await db.exec(booking.slice(booking.indexOf('create table public.booking_message_outbox'),booking.indexOf('notify pgrst')));
  await db.exec(read('supabase/migrations/20261011130001_system_messaging_booksms.sql'));
  const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0]?.value;
  const actor=async n=>db.query("select set_config('app.actor',$1,false)",[id(n)]);
  const rpc=async(name,args=[],types=[])=>value(`select ${name}(${args.map((_,i)=>`$${i+1}::${types[i]}`).join(',')}) as value`,args.map(a=>a!==null && typeof a==='object'?JSON.stringify(a):a));
  assert.equal(await value('select booksms_has_access($1) as value',[id(10)]),false);
  assert.equal(await value("select fulfillment_ready as value from market_billing_catalog where plugin_id='booksms'"),false);
  await actor(1);
  await assert.rejects(rpc('market_billing_save_catalog',['booksms',1,{price_cents:100,fulfillment_ready:true,monthly_sms_limit:0}],['text','integer','jsonb']),/constraint/);
  const plan=await rpc('market_billing_save_catalog',['booksms',1,{price_cents:100,fulfillment_ready:true,monthly_sms_limit:2}],['text','integer','jsonb']);
  assert.equal(plan.fulfillment_ready,true);
  const bank=await rpc('market_billing_save_bank',[{label:'USD',bank_name:'Test bank',beneficiary:'Test',account_number:'12345678'},null],['jsonb','integer']);
  await rpc('market_billing_save_settings',[1,{enabled:true,default_bank_account_id:bank.id}],['integer','jsonb']);
  await actor(2);
  const order=await rpc('market_billing_create_order',[id(10),'booksms',id(20)],['uuid','text','uuid']);
  await actor(1);
  await rpc('market_billing_record_receipt',[order.id,'BOOKSMS-IN-1',order.total_cents,new Date().toISOString(),'Verified'],['uuid','text','integer','timestamptz','text']);
  assert.equal(await value('select monthly_limit as value from booksms_subscriptions where salon_id=$1',[id(10)]),2);
  assert.equal(await value('select booksms_has_access($1) as value',[id(10)]),false);
  await rpc('booksms_save',[id(2),id(10),true,'encrypted-fixture',{enabled:true,confirmation:true,reminders:false}],['uuid','uuid','boolean','text','jsonb']);
  assert.equal(await value('select booksms_has_access($1) as value',[id(10)]),true);
  await db.query('update booksms_subscriptions set installed=false where salon_id=$1',[id(10)]);
  assert.equal(await value('select booksms_has_access($1) as value',[id(10)]),false);
  await db.query('update booksms_subscriptions set installed=true,public_config=jsonb_set(public_config,\'{enabled}\',\'false\') where salon_id=$1',[id(10)]);
  assert.equal(await value('select booksms_has_access($1) as value',[id(10)]),false);
  await db.query('update booksms_subscriptions set public_config=jsonb_set(public_config,\'{enabled}\',\'true\') where salon_id=$1',[id(10)]);
  assert.equal(await rpc('booksms_reserve_send',[id(10),true],['uuid','boolean']),false);
  assert.equal(await rpc('booksms_reserve_send',[id(10),false],['uuid','boolean']),true);
  assert.equal(await rpc('booksms_reserve_send',[id(10),false],['uuid','boolean']),true);
  assert.equal(await rpc('booksms_reserve_send',[id(10),false],['uuid','boolean']),false);
  await assert.rejects(rpc('booksms_save',[id(3),id(10),true,'x',{}],['uuid','uuid','boolean','text','jsonb']),/owner/);
  await actor(2);
  const state=await rpc('booksms_owner_state',[id(10)],['uuid']);
  assert.equal('encrypted_config' in state,false);
  await db.query("update booksms_subscriptions set paid_until=now()-interval '1 second' where salon_id=$1",[id(10)]);
  assert.equal(await value('select booksms_has_access($1) as value',[id(10)]),false);
  // A stale booking queue entry cannot bypass a revoked plugin.
  await db.query("insert into customers values($1,$2,'fixture@example.invalid','+15555550100')",[id(30),id(10)]);
  await db.query("insert into bookings values($1,$2,$3,'confirmed',now()+interval '3 days','confirmed','UTC',now())",[id(31),id(30),id(10)]);
  assert.equal(await value("select count(*)::integer as value from booking_message_outbox where channel='sms'"),0);
  await db.query("insert into booking_message_outbox(salon_id,booking_id,channel,event_key,recipient,message) select salon_id,id,'sms',status||':'||confirmation_status||':'||extract(epoch from start_at)::text,'+15555550100','fixture' from bookings");
  const claimed=await db.query('select * from claim_booking_messages(20,true,true)');
  assert.equal(claimed.rows.some(row=>row.channel==='sms'),false);
 } finally {await db.close();}
});
