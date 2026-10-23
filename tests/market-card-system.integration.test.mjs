import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const root=process.env.MARKET_SYSTEM_SOURCE??'.';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids={admin:id(1),owner:id(2),other:id(3),operator:id(4),suspended:id(5),salon:id(10),otherSalon:id(11)};
const existing=readFileSync('tests/market-bank-billing.integration.test.mjs','utf8');
const bootstrap=existing.match(/const bootstrap=`([\s\S]*?)`;/)[1].replace(/\$\{(\w+)\}/g,(_,name)=>ids[name]);
test('card billing: authorization, frozen quotes, idempotent access, refunds and stale events',{timeout:120000},async t=>{
 const db=new PGlite();
 const value=async(sql,args=[]) =>(await db.query(sql,args)).rows[0]?.value;
 const actor=async user=>db.query("select set_config('app.actor',$1,false)",[user]);
 const reserve=async(plugin='booking-policy',salon=ids.salon)=>value('select market_card_reserve($1,$2) as value',[salon,plugin]);
 let p;
 const apply=async({status='active',amount=p.amount_cents,refund=0,at='2030-01-01T00:00:00Z',sub='sub_demo',until='2030-02-01T00:00:00Z'}={})=>db.query('select market_card_apply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.id,sub,'cus_demo',status,'in_demo',amount,refund,'pi_demo',until,at]);
 try{
 await db.exec(bootstrap);await db.exec('alter table users add column email text');
 for(const file of ['20261009160001_market_commerce_configuration.sql','20261009180001_market_bank_billing.sql','20261010210001_market_card_system.sql'])await db.exec(readFileSync(`${root}/supabase/migrations/${file}`,'utf8'));
 await actor(ids.owner);
 await t.test('closed until live payment configuration is enabled',async()=>{await assert.rejects(reserve(),/not connected/);await db.exec(`insert into platform_payment_settings(id,encrypted_config,public_config) values(true,'test','{"enabled":true,"mode":"test","accountId":"acct_demo"}')`);await assert.rejects(reserve(),/not connected/);await db.exec(`update platform_payment_settings set public_config='{"enabled":true,"mode":"live","accountId":"acct_demo"}'`);});
 await t.test('rejects unauthorized salon and unsupported plugin',async()=>{await assert.rejects(reserve('booking-policy',ids.otherSalon),/owner access/);await assert.rejects(reserve('campaigns'),/not ready/);});
 await t.test('repeated requests reserve the same immutable quote',async()=>{p=await reserve();assert.equal(p.amount_cents,99);const repeated=await Promise.all([reserve(),reserve()]);assert.ok(repeated.every(r=>r.id===p.id));await db.exec("update market_billing_catalog set price_cents=999,version=version+1 where plugin_id='booking-policy'");assert.equal((await reserve()).amount_cents,99);});
 await t.test('customers cannot read secrets or invoke payment application or bank creation',async()=>{await db.exec('set role authenticated');await assert.rejects(db.query('select * from platform_payment_settings'),/permission denied/);await assert.rejects(apply(),/permission denied/);await assert.rejects(db.query('select market_billing_create_order($1,$2,$3)',[ids.salon,'booking-policy',id(80)]),/permission denied/);await db.exec('reset role');});
 await t.test('mismatched amount cannot grant access',async()=>{await assert.rejects(apply({amount:100}),/amount mismatch/);assert.equal(await value('select count(*)::int as value from market_card_invoices'),0);});
 await t.test('verified payment and duplicate delivery grant once',async()=>{await apply();await apply();assert.equal(await value('select count(*)::int as value from market_card_invoices'),1);assert.equal(await value('select stripe_subscription as value from booking_policy_subscriptions where salon_id=$1',[ids.salon]),'sub_demo');assert.ok(await value('select paid_until as value from booking_policy_subscriptions where salon_id=$1',[ids.salon]));});
 await t.test('full refund revokes access and older events cannot restore it',async()=>{await apply({refund:99,at:'2030-01-02T00:00:00Z'});assert.equal(await value('select paid_until as value from booking_policy_subscriptions where salon_id=$1',[ids.salon]),null);await apply({at:'2030-01-01T12:00:00Z'});assert.equal(await value('select paid_until as value from booking_policy_subscriptions where salon_id=$1',[ids.salon]),null);await apply({at:'2030-01-03T00:00:00Z'});assert.equal(await value('select refunded_cents as value from market_card_invoices'),99);});
 await t.test('all other paid plugins receive their own entitlement',async()=>{for(const [plugin,table] of [['vietnamese-language','vietnamese_plugin_subscriptions'],['booking-deposit','booking_deposit_subscriptions'],['checkin-receipt','checkin_receipt_subscriptions']]){const row=await reserve(plugin);await db.query('select market_card_apply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[row.id,'sub_'+plugin,'cus_demo','active','in_'+plugin,row.amount_cents,0,'pi_'+plugin,'2030-02-01T00:00:00Z','2030-01-01T00:00:00Z']);assert.ok(await value('select paid_until as value from '+table+' where salon_id=$1',[ids.salon]));}});
 await t.test('changed owner prevents granting paid entitlement',async()=>{await db.query('update locations set owner_id=$1 where id=$2',[ids.other,ids.salon]);await assert.rejects(apply({at:'2030-01-04T00:00:00Z',refund:0,amount:99,until:'2030-03-01T00:00:00Z'}).then(()=>db.query('select market_card_apply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[p.id,'sub_demo','cus_demo','active','in_renew',99,0,'pi_renew','2030-03-01T00:00:00Z','2030-01-05T00:00:00Z'])),/owner.*authorized/);});
 }finally{await db.close();}
});
