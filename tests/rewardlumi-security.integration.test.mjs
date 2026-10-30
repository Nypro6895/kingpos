import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import{startIsolatedSupabase}from'./helpers/isolated-supabase-fixture.mjs';import{rewardParallelRpc}from'./helpers/reward-parallel-rpc.mjs';
test('Reward security actual Postgres/Auth/PostgREST',{timeout:900000,skip:!process.env.TEST_SUPABASE_IMAGES&&process.env.RUN_REWARD_SQL!=='1'},async t=>{
 const f=await startIsolatedSupabase('reward-security',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});t.after(()=>f.close());
 const id=()=>crypto.randomUUID(),owner=f.person('sec-owner'),guest=f.person('sec-guest'),other=f.person('sec-other');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Security QA'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:id(),p_name:'Reward security QA',p_owner_is_staff:false,p_country:'US'}).salon_id;
 const program={enabled:true,nearby:false,spendCents:2000,spendPoints:20,welcomePoints:0,firstBookingPoints:0,visitPoints:0,conversionPoints:30,offers:[{id:'five',title:'$5 off',points:100,valueCents:500,minimumCents:4000}]};
 f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program}});
 const customer=id(),stranger=id(),service=id();
 f.sql(`insert into customers(id,location_id,name,customer_user_id) values('${customer}','${salon}','QA guest','${guest.profileId}'),('${stranger}','${salon}','QA other','${other.profileId}');insert into services(id,salon_id,name,base_price) values('${service}','${salon}','QA service',60);select reward_join('${salon}','${guest.profileId}');insert into reward_ledger(salon_id,user_id,delta,reason,event_key) values('${salon}','${guest.profileId}',150,'Synthetic QA opening balance','sec-seed');`);
 const personal=(op,args)=>f.rpc(guest,'reward_personal',{p_op:op,p_args:args});
 const newVisit=()=>{const visit=id();f.sql(`insert into customer_visits(id,salon_id,customer_id) values('${visit}','${salon}','${customer}')`);return visit;};
 const receipt=visit=>({customerId:customer,customerVisitId:visit,discountType:'fixed_amount',discountValue:0,tipAmount:0,lines:[{staffId:null,serviceId:service,serviceLabel:'QA service',total:60,amountInput:'60',amountParts:[60]}]});
 const visit=newVisit(),draft=receipt(visit);personal('request',{visitId:visit,offerId:'five',consent:true,points:1,valueCents:990000});const initial=f.rpc(owner,'reward_pos',{p_salon:salon,p_op:'quote',p_args:{receipt:draft,token:'sec-cart'}}).view;draft.rewardQuote=initial.request.quote;assert.equal(initial.request.points,100);assert.equal(initial.request.valueCents,500);let settledTicket;
 await t.test('forged internal request marker cannot debit another customer or invent a discount',()=>{
  const forged={...draft,customerId:stranger,customerVisitId:undefined,rewardQuote:undefined,rewardRequestId:initial.request.id,_rewardValueCents:990000,_rewardOrdinaryCents:-500};
  const result=f.rpc(owner,'reward_submit_owner',{p_salon:salon,p_request:id(),p_receipt:forged});assert.ok(result.ticketId);
  assert.equal(f.sql(`select status from reward_requests where id='${initial.request.id}'`),'confirmed');
  assert.equal(Number(f.sql(`select count(*) from reward_ledger where event_key='redeem:${initial.request.id}'`)),0);
  assert.equal(Number(f.sql(`select discount_value from pos_tickets where id='${result.ticketId}'`)),0);
 });
 await t.test('actual parallel settlement retries produce one ticket and one point debit; changed replay rejected',async()=>{
  const args={p_salon:salon,p_request:id(),p_receipt:draft};
  const replies=await Promise.all([rewardParallelRpc(f,owner,'reward_submit_owner',args),rewardParallelRpc(f,owner,'reward_submit_owner',args)]);
  assert.deepEqual(replies.map(r=>r.status),[200,200]);assert.equal(replies[0].data.ticketId,replies[1].data.ticketId);
  const ticket=replies[0].data.ticketId;settledTicket=ticket;assert.equal(Number(f.sql(`select count(*) from reward_ledger where event_key='redeem:${initial.request.id}'`)),1);
  assert.equal(Number(f.sql(`select sum(amount) from pos_payments where ticket_id='${ticket}'`)),55);
  assert.ok(f.http(3000,'/rpc/reward_submit_owner','POST',{...args,p_receipt:{...draft,tipAmount:1}},owner.token).status>=400);
 });
 await t.test('concurrent quotes reserve once; canonical check-in constraint prevents a second active visit',async()=>{
  f.sql(`insert into reward_ledger(salon_id,user_id,delta,reason,event_key) values('${salon}','${guest.profileId}',100-reward_balance('${salon}','${guest.profileId}'),'Synthetic QA balance','sec-reserve')`);
  const v=newVisit();personal('request',{visitId:v,offerId:'five',consent:true});
  const args={p_salon:salon,p_op:'quote',p_args:{receipt:receipt(v),token:'sec-'+v}};
  const replies=await Promise.all([rewardParallelRpc(f,owner,'reward_pos',args),rewardParallelRpc(f,owner,'reward_pos',args)]);
  assert.ok(replies.every(r=>r.status===200&&r.data.view.request.status==='confirmed'));
  assert.equal(personal('wallet',{}).cards[0].reserved,100);assert.ok(personal('wallet',{}).cards[0].available>=0);
  assert.throws(()=>newVisit(),/customer_visits_one_active_customer_uidx/);
  const payload={...receipt(v),rewardQuote:replies[0].data.view.request.quote};
  const settled=await Promise.all([1,2].map(()=>rewardParallelRpc(f,owner,'reward_submit_owner',{p_salon:salon,p_request:id(),p_receipt:payload})));
  assert.equal(settled.filter(r=>r.status===200).length,1);assert.equal(settled.filter(r=>r.status>=400).length,1);
  assert.equal(Number(f.sql(`select count(*) from reward_ledger where event_key='redeem:${replies[0].data.view.request.id}'`)),1);
 });
 await t.test('private helpers, direct ledger writes and foreign role requests are denied',()=>{
  for(const name of ['reward_prepare_receipt','reward_finish_receipt','reward_balance'])assert.ok(f.http(3000,'/rpc/'+name,'POST',{},guest.token).status>=400);
  assert.ok(f.http(3000,'/reward_ledger','POST',{salon_id:salon,user_id:guest.profileId,delta:999,reason:'tamper',event_key:'tamper'},guest.token).status>=400);
  assert.ok(f.http(3000,'/rpc/reward_pos','POST',{p_salon:salon,p_op:'quote',p_args:{receipt:draft}},other.token).status>=400);
 });
 await t.test('Reward source report is owner scoped, uses canonical business date and reconciles reversals without changing financial facts',()=>{
  const day=f.sql(`select get_salon_business_date('${salon}')`),args={p_salon:salon,p_day:day};
  const facts=()=>f.sql(`select md5(jsonb_build_object('tickets',(select jsonb_agg(to_jsonb(t) order by id) from pos_tickets t where salon_id='${salon}'),'payments',(select jsonb_agg(to_jsonb(p) order by id) from pos_payments p where salon_id='${salon}'),'earnings',(select jsonb_agg(to_jsonb(e) order by id) from pos_ticket_staff_earnings e where salon_id='${salon}'))::text)`);
  const before=facts(),report=f.rpc(owner,'reward_owner_report',args);assert.equal(facts(),before);
  assert.equal(report.source,'reward');assert.equal(report.includedInTicketDiscount,true);assert.equal(report.summary.grossUses,2);assert.equal(report.summary.netValueCents,1000);assert.equal(report.summary.pointsSpent,200);
  assert.ok(f.http(3000,'/rpc/reward_owner_report','POST',args,guest.token).status>=400);
  assert.ok(f.http(3000,'/rpc/reward_owner_report','POST',{...args,p_salon:id()},owner.token).status>=400);
  assert.equal(f.rpc(owner,'reward_owner_report',{...args,p_day:'2000-01-01'}).entries.length,0);
  f.sql(`update pos_tickets set status='voided' where id='${settledTicket}'`);
  const reversed=f.rpc(owner,'reward_owner_report',args);assert.equal(reversed.summary.grossUses,2);assert.equal(reversed.summary.netValueCents,500);assert.equal(reversed.summary.reversedValueCents,500);assert.equal(reversed.summary.pointsReturned,100);
 });
 f.save('reward-security-result.json',{actualSql:true,concurrentHttp:true,syntheticOnly:true,noProductionWrites:true});
});
