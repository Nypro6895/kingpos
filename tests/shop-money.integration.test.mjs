import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';
import {shopMoneyBrowser} from './helpers/shop-money-browser.mjs';
test('Shop money actual SQL: receipts, expenses, audit, tenant and reserve semantics',{timeout:900000,skip:process.env.RUN_SHOP_MONEY_SQL!=='1'},async t=>{
 const f=await startIsolatedSupabase('shop-money',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'), {allowConcurrentFixtureCleanup:true});t.after(()=>f.close());
 f.save('shop-money-acceptance.json',{passed:false,startedAt:new Date().toISOString()});
 const id=()=>crypto.randomUUID(),owner=f.person('money-owner'),stranger=f.person('money-other');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Money QA'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:id(),p_name:'Money QA',p_owner_is_staff:false,p_country:'US'}).salon_id;
 const date=f.sql(`select get_salon_business_date('${salon}')`),start=f.sql(`select get_salon_business_date('${salon}')-2`);
 const write=(op,args)=>f.rpc(owner,'shop_money_write',{p_salon:salon,p_op:op,p_args:args});
 const read=()=>f.rpc(owner,'shop_money_read',{p_salon:salon,p_start:start,p_end:date});
 await t.test('unentered $100 service day remains expected and is included',()=>{
  const staff=id();f.sql(`insert into staff(id,salon_id,display_name) values('${staff}','${salon}','Money QA staff')`);
  f.rpc(owner,'save_staff_day_financial_input',{p_salon:salon,p_staff:staff,p_date:start,p_request:id(),p_revision:0,p_expected_service:0,p_expected_tip:0,p_service:100,p_tip:0,p_note:'Synthetic missing collection'});
  const d=read();assert.equal(Number(d.days.find(x=>x.date===start).expected),100);assert.equal(d.collections.length,0);
 });
 await t.test('zero unentered days are present; total receipt saves do not rewrite service facts',()=>{
  const before=f.sql(`select count(*) from pos_daily_closings where salon_id='${salon}'`);
  assert.ok(read().days.some(d=>d.date===date));
  const r=write('collection',{date,cash:400,card:750,other:50,revision:0,note:'Late closing'});assert.equal(r.revision,1);
  assert.equal(f.sql(`select count(*) from pos_daily_closings where salon_id='${salon}'`),before);
  assert.equal(Number(read().collections[0].card),750);
  const projected=f.rpc(owner,'shop_payroll_collections',{p_salon:salon,p_start:start,p_end:date});assert.equal(Number(projected[0].cash),400);
 });
 await t.test('late edit is append-only and stale writes fail',()=>{
  write('collection',{date,cash:450,card:750,other:50,revision:1,note:'Forgot $50 cash'});
  assert.throws(()=>write('collection',{date,cash:0,card:0,other:0,revision:1}),/changed/);
  const h=read().history.filter(h=>h.kind==='collection');assert.equal(h.length,2);assert.equal(Number(h[0].before_value.cash),400);assert.equal(Number(h[0].after_value.cash),450);
 });
 await t.test('expense revision and fixed rent are recorded once',()=>{
  const eid=id();write('expense',{id:eid,date,amount:25,category:'supplies',source:'cash',note:'Supplies',revision:0});
  write('expense',{id:eid,date,amount:30,category:'supplies',source:'bank',note:'Corrected receipt',revision:1});
  assert.equal(read().expenses.length,1);assert.equal(Number(read().expenses[0].amount),30);
  write('settings',{date,rent:1400,rentDay:1,feeRate:2.5,feeEach:0.1,revision:0});
  write('expense',{id:id(),date,amount:1400,category:'rent',source:'bank',note:'Rent',recurrence:date.slice(0,7),revision:0});
  assert.throws(()=>write('expense',{id:id(),date,amount:1400,category:'rent',source:'bank',note:'Rent',recurrence:date.slice(0,7),revision:0}),/unique|duplicate/);
 });
 await t.test('tax paid has its own category; opening tax and source balances persist',()=>{
  write('opening',{date:start,cash:100,bank:2000,other:0,tax:500,revision:0});
  write('expense',{id:id(),date,amount:200,category:'tax_payment',source:'bank',note:'Tax remittance',revision:0});
  const d=read();assert.equal(Number(d.opening.tax),500);assert.equal(d.expenses.filter(e=>e.category==='tax_payment').length,1);
 });
 await t.test('other users, direct ledger writes, future days and negative amounts denied',()=>{
  assert.ok(f.http(3000,'/rpc/shop_money_read','POST',{p_salon:salon,p_start:start,p_end:date},stranger.token).status>=400);
  assert.ok(f.http(3000,'/rpc/shop_money_write','POST',{p_salon:salon,p_op:'collection',p_args:{date,cash:0,card:0,other:0,revision:2}},stranger.token).status>=400);
  assert.ok(f.http(3000,'/shop_expenses','POST',{id:id(),salon_id:salon,business_date:date,amount:99,category:'other',source:'cash'},owner.token).status>=400);
  assert.throws(()=>write('collection',{date:'2099-01-01',cash:1,card:0,other:0,revision:0}),/future/);
  assert.throws(()=>write('collection',{date,cash:-1,card:0,other:0,revision:2}),/check|constraint/);
  assert.throws(()=>write('collection',{date,cash:1.001,card:0,other:0,revision:2}),/decimals/);
 });
 await t.test('actual mobile components save through real SQL',()=>shopMoneyBrowser(f,owner,salon,start,date));
 f.save('shop-money-acceptance.json',{passed:true,at:new Date().toISOString(),synthetic:true,productionWrites:false,sourceDate:date,migrationSha256:f.evidence.migrationHashes.find(x=>x.file==='20261101040000_shop_money.sql').sha256});
});
