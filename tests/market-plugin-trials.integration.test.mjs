import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids={admin:id(1),owner:id(2),other:id(3),operator:id(4),suspended:id(5),salon:id(10),otherSalon:id(11)};
const migration=name=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');
test('first-party trials: authorization, expiry, replay, runtime gates and verified card fulfillment', {timeout:120000},async()=>{
 const db=new PGlite();
 const actor=async user=>db.query("select set_config('app.actor',$1,false)",[user]);
 const rpc=async(sql,args=[]) =>(await db.query(`select ${sql} as value`,args)).rows[0]?.value;
 const trial=(plugin,start=true,salon=ids.salon)=>rpc('market_plugin_trial($1,$2,$3)',[salon,plugin,start]);
 try{
  const fixture=readFileSync('tests/market-bank-billing.integration.test.mjs','utf8');
  await db.exec(fixture.match(/const bootstrap=`([\s\S]*?)`;/)[1].replace(/\$\{(\w+)\}/g,(_,name)=>ids[name]));
  await db.exec('alter table users add column email text; create table tax_company_subscriptions(like booking_policy_subscriptions including all);');
  for(const name of ['20261009160001_market_commerce_configuration','20261009180001_market_bank_billing','20261010210001_market_card_system','20261011010001_market_automatic_tax','20261011120001_tax_company_card_bridge','202610140001_market_safari_checkout']) await db.exec(migration(name));
  const sms=migration('20261011130001_system_messaging_booksms');
  await db.exec(sms.slice(sms.indexOf('create table public.booksms_subscriptions'),sms.indexOf('alter table market_billing_catalog')));
  await db.exec(`alter table market_payment_settings add column booking_deposit_test_enabled boolean default false;
   create table salon_market_plugins(salon_id uuid,plugin_id text);`);
  for(const [file,names] of [
   ['20261009130031_booking_policy_plugin',['public_booking_policy']],
   ['20261009140031_booking_deposit_plugin',['public_booking_deposit','booking_deposit_save']],
   ['20261025170000_staff_scan_workspace',['staff_scan_available']],
  ]) for(const name of names) {
   const definition=migration(file).match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\$\\$;`));
   assert.ok(definition, name); await db.exec(definition[0]);
  }
  await db.exec(`alter table market_billing_catalog add column monthly_sms_limit integer not null default 0;
   alter table market_billing_catalog drop constraint market_billing_catalog_check;
   alter table market_billing_catalog add constraint market_catalog_fulfillment_check check(not fulfillment_ready or plugin_id in ('vietnamese-language','booking-policy','booking-deposit','checkin-receipt','tax-company','booksms'));
   insert into market_billing_catalog(plugin_id,name,publisher,price_cents,published,fulfillment_ready,monthly_sms_limit) values('booksms','BookSMS','Reylumi',500,true,true,100);
   insert into platform_payment_settings(id,encrypted_config,public_config) values(true,'fake','{"enabled":true,"mode":"live","accountId":"acct_test"}');`);
  await db.exec(migration('20261103201759_market_plugin_trials'));
  await actor(ids.other); await assert.rejects(trial('booksms'),/owner access/);
  await actor(ids.owner); await assert.rejects(trial('booksms',true,ids.otherSalon),/owner access/);
  await assert.rejects(trial('unknown'),/own free activation/);
  await db.exec('set role anon'); await assert.rejects(trial('booksms'),/permission denied/); await db.exec('reset role');
  assert.equal((await trial('booksms',false)).started,false);
  const tables={'booking-policy':'booking_policy_subscriptions','booking-deposit':'booking_deposit_subscriptions','checkin-receipt':'checkin_receipt_subscriptions','tax-company':'tax_company_subscriptions','booksms':'booksms_subscriptions'};
  for(const [plugin,table] of Object.entries(tables)){
   const first=await trial(plugin); assert.equal(first.active,true); assert.equal(first.paid,false);
   const repeats=await Promise.all([trial(plugin),trial(plugin)]); assert.ok(repeats.every(r=>r.endsAt===first.endsAt));
   assert.equal(await rpc(`(select paid_until from ${table} where salon_id=$1)`,[ids.salon]),null);
   if(plugin==='booking-policy'){
    await db.query(`update booking_policy_subscriptions set published=true,content='Please arrive on time.' where salon_id=$1`,[ids.salon]);
    assert.equal(await rpc('public_booking_policy($1)',[ids.salon]),'Please arrive on time.');
   }
   if(plugin==='booking-deposit'){
    await assert.rejects(rpc("booking_deposit_save($1,true,'fixed',20,'both')",[ids.salon]),/connect Stripe/);
    await db.query(`update booking_deposit_subscriptions set stripe_account='acct_salon' where salon_id=$1`,[ids.salon]);
    await rpc("booking_deposit_save($1,true,'fixed',20,'both')",[ids.salon]);
    assert.equal((await rpc('public_booking_deposit($1)',[ids.salon])).testMode,false);
   }
   if(plugin==='checkin-receipt') assert.equal(await rpc('staff_scan_available($1)',[ids.salon]),true);
   await db.query(`update ${table} set trial_ends_at=now()-interval '1 day' where salon_id=$1`,[ids.salon]);
   assert.equal((await trial(plugin)).active,false,'expired trial cannot restart');
   if(plugin==='booking-policy') assert.equal(await rpc('public_booking_policy($1)',[ids.salon]),null);
   if(plugin==='booking-deposit') assert.equal(await rpc('public_booking_deposit($1)',[ids.salon]),null);
   if(plugin==='checkin-receipt') assert.equal(await rpc('staff_scan_available($1)',[ids.salon]),false);
  }
  assert.equal(await rpc(`(select installed from booking_deposit_subscriptions where salon_id=$1)`,[ids.salon]),true);
  assert.equal(await rpc(`(select monthly_limit from booksms_subscriptions where salon_id=$1)`,[ids.salon]),10);
  await assert.rejects(rpc('booksms_save($1,$2,true,$3,$4)',[ids.owner,ids.salon,'encrypted','{"enabled":true}']),/Activate paid/);
  await db.query(`update booksms_subscriptions set trial_ends_at=now()+interval '1 day' where salon_id=$1`,[ids.salon]);
  await rpc('booksms_save($1,$2,true,$3,$4)',[ids.owner,ids.salon,'encrypted','{"enabled":true,"confirmation":true}']);
  assert.equal(await rpc('booksms_has_access($1)',[ids.salon]),true);
  assert.equal((await rpc('booksms_owner_state($1)',[ids.salon])).active,true);
  const purchase=await rpc('market_card_reserve_safari($1,$2)',[ids.salon,'booksms']);
  assert.equal(purchase.snapshot.monthly_sms_limit,100); assert.equal(purchase.snapshot.checkout_ui_mode,'hosted');
  assert.equal((await rpc('market_card_reserve($1,$2)',[ids.salon,'booksms'])).id,purchase.id);
  const apply=(refund=0,at='2030-01-01T00:00:00Z')=>rpc('market_card_apply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[purchase.id,'sub_sms','cus_demo','active','in_sms',purchase.amount_cents,refund,'pi_sms','2030-02-01T00:00:00Z',at]);
  await apply(); await apply();
  assert.equal((await trial('booksms',false)).paid,true);
  assert.equal(await rpc(`(select monthly_limit from booksms_subscriptions where salon_id=$1)`,[ids.salon]),100);
  await apply(purchase.amount_cents,'2030-01-02T00:00:00Z');
  assert.equal((await trial('booksms',false)).paid,false);
  assert.equal(await rpc(`(select monthly_limit from booksms_subscriptions where salon_id=$1)`,[ids.salon]),10);
  await db.query(`update booksms_subscriptions set trial_ends_at=now()-interval '1 day' where salon_id=$1`,[ids.salon]);
  assert.equal(await rpc('booksms_has_access($1)',[ids.salon]),false);
  await db.query(`update locations set status='suspended' where id=$1`,[ids.salon]);
  await assert.rejects(trial('booksms'),/owner access/);
 }finally{await db.close();}
});

test('paid and trial expiry are independent in server entitlement reads',async()=>{
 const bundled=await build({entryPoints:['lib/market-access.ts'],bundle:true,write:false,platform:'node',format:'esm'});
 const {marketAccessActive}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 const now=Date.parse('2026-11-03T00:00:00Z');
 assert.equal(marketAccessActive({paid_until:null,trial_ends_at:'2026-11-04T00:00:00Z'},now),true);
 assert.equal(marketAccessActive({paid_until:'2026-11-04T00:00:00Z',trial_ends_at:'2026-11-01T00:00:00Z'},now),true);
 assert.equal(marketAccessActive({paid_until:null,trial_ends_at:'2026-11-03T00:00:00Z'},now),false);
 assert.equal(marketAccessActive(undefined,now),false);
});
