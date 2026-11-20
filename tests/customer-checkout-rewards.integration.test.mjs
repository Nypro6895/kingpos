import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('customer checkout preview and automatic tip preserve server authority',{timeout:900000,skip:process.env.RUN_REWARD_SQL!=='1'},async t=>{
 const f=await startIsolatedSupabase('customer-checkout',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});t.after(()=>f.close());
 const owner=f.person('checkout-owner'),guest=f.person('checkout-guest');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Checkout fixture'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:randomUUID(),p_name:'Checkout QA',p_owner_is_staff:false,p_country:'US'}).salon_id;
 const customer=randomUUID(),visit=randomUUID(),service=randomUUID(),draft=randomUUID(),token='checkout-'+randomUUID();
 const program={enabled:true,nearby:false,spendCents:2000,spendPoints:20,welcomePoints:0,firstBookingPoints:20,visitPoints:0,conversionPoints:0,offers:[{id:'five',title:'$5 off',points:100,valueCents:500,minimumCents:4000}]};
 f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program,expectedVersion:0}});
 const receipt={customerId:customer,customerVisitId:visit,discountType:'fixed_amount',discountValue:0,tipAmount:0,lines:[{serviceId:service,staffId:null,serviceLabel:'QA services',total:100,amountInput:'100',amountParts:[100]}]};
 f.sql(`insert into customers(id,location_id,name,customer_user_id) values('${customer}','${salon}','Synthetic checkout','${guest.profileId}');insert into services(id,salon_id,name,base_price) values('${service}','${salon}','QA services',100);insert into customer_visits(id,salon_id,customer_id) values('${visit}','${salon}','${customer}');insert into reward_ledger(salon_id,user_id,delta,reason,event_key) values('${salon}','${guest.profileId}',160,'Synthetic opening balance','checkout-open');insert into pos_live_drafts(id,salon_id,token,customer,subtotal,total,total_before_tip,receipt_version,customer_version) values('${draft}','${salon}','${token}','{"id":"${customer}","name":"Synthetic checkout"}',100,100,100,7,3);`);
 const display=()=>f.rpc(null,'reward_display',{p_token:token,p_op:'load',p_args:{visitId:visit}}).view;
 // The legacy load enrolls once (including a possible zero-value welcome row).
 // Measure the new projection after that existing enrollment boundary.
 display();
 const tipArgs={p_token:token,p_tip_amount:20,p_request_id:randomUUID(),p_draft_id:draft,p_customer_version:3,p_receipt_version:7};
 await t.test('preview is scoped and read only; pending earnings are not spendable points',()=>{
  const before=Number(f.sql('select count(*) from reward_ledger'));
  const view=display();assert.equal(view.available,160);assert.equal(view.checkout.points,100);assert.equal(view.checkout.giftCents,0);
  assert.equal(Number(f.sql('select count(*) from reward_ledger')),before);
  assert.ok(f.http(3000,'/rpc/reward_checkout_preview','POST',{p_token:token,p_visit:visit}).status>=400);
  assert.ok(f.http(3000,'/rpc/reward_display','POST',{p_token:'wrong',p_op:'load',p_args:{visitId:visit}}).status>=400);
 });
 await t.test('late or foreign tip saves fail before changing the draft; retries remain idempotent',()=>{
  for(const change of [{p_draft_id:randomUUID()},{p_customer_version:2},{p_receipt_version:6},{p_receipt_version:6,p_tip_amount:0}])assert.ok(f.http(3000,'/rpc/confirm_pos_live_draft_tip_scoped','POST',{...tipArgs,...change}).status>=400);
  assert.equal(Number(f.sql(`select tip from pos_live_drafts where id='${draft}'`)),0);
  const first=f.rpc(null,'confirm_pos_live_draft_tip_scoped',tipArgs),again=f.rpc(null,'confirm_pos_live_draft_tip_scoped',tipArgs);
  assert.equal(first.tip,20);assert.equal(first.version,again.version);assert.equal(first.total,120);
  assert.equal(display().checkout.points,100,'Tip never earns spend points');
 });
 await t.test('reward reservation changes the estimate only after POS publishes matching receipt facts',()=>{
  f.rpc(guest,'reward_personal',{p_op:'request',p_args:{visitId:visit,offerId:'five',consent:true}});
  const view=f.rpc(owner,'reward_pos',{p_salon:salon,p_op:'quote',p_args:{receipt:{...receipt,tipAmount:20},token}}).view;
  assert.equal(view.request.status,'confirmed');assert.equal(display().checkout,undefined,'The discount has not reached the live draft');
  f.sql(`update pos_live_drafts set discount=5,total_before_tip=95,total=115 where id='${draft}'`);
  const next=display();assert.equal(next.available,60);assert.equal(next.reserved,100);assert.equal(next.checkout.points,80);assert.equal(next.checkout.rewardValueCents,500);
 });
 await t.test('partial gift reduces qualifying spend, without consuming gift or reward before payment',()=>{
  const quote=f.rpc(owner,'gift_card_pos',{p_salon:salon,p_op:'sync',p_args:{token,receipt:{...receipt,tipAmount:20}}}).session;assert.equal(quote.total,11500);
  const card=f.sql(`select gift_card_issue('${salon}',2500,'${guest.profileId}','${randomUUID()}')`);
  f.rpc(guest,'reward_visit_gifts',{p_visit:visit,p_card:card});
  const preview=display().checkout;assert.equal(preview.giftCents,2500);assert.equal(preview.points,60);assert.equal(preview.totalCents,11500);
  assert.equal(Number(f.sql(`select balance from gift_cards where id='${card}'`)),2500);
  assert.equal(Number(f.sql("select count(*) from reward_ledger where reason='Reward used'")),0);
 });
 await t.test('paused earning hides estimated credits but preserves available points and reservations',()=>{
  f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program:{...program,enabled:false},expectedVersion:1}});
  const view=display();assert.equal(view.checkout.earningEnabled,false);assert.equal(view.checkout.points,0);assert.equal(view.available,60);assert.equal(view.reserved,100);
 });
 await t.test('a previous customer cannot receive an in-flight tip after the customer version changes',()=>{
  f.sql(`update pos_live_drafts set customer_version=4 where id='${draft}'`);
  assert.ok(f.http(3000,'/rpc/confirm_pos_live_draft_tip_scoped','POST',{...tipArgs,p_tip_amount:99,p_request_id:randomUUID()}).status>=400);
  assert.equal(Number(f.sql(`select tip from pos_live_drafts where id='${draft}'`)),20);
 });
 f.save('checkout-result.json',{passed:true,syntheticOnly:true,source:'Current migration set and real PostgreSQL/Auth/PostgREST',scope:'Preview and scoped tip RPC; no hosted or native acceptance'});
});
