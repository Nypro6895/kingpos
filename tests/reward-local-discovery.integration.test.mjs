import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startIsolatedSupabase } from './helpers/isolated-supabase-fixture.mjs';
import { checkRewardDiscoveryUI } from './reward-local-discovery-ui.mjs';
import {assertRewardPublicProgramContext,assertRewardOneTimeHistory} from './helpers/reward-public-context-acceptance.mjs';
import {rewardParallelRpc} from './helpers/reward-parallel-rpc.mjs';

test('Local reward discovery: real PostgreSQL, Auth, tenant authority and bounded geography', {timeout:900000, skip:process.env.RUN_REWARD_SQL!=='1'}, async t => {
 const f=await startIsolatedSupabase('reward-local-discovery',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});
 t.after(()=>f.close());
 const owner=f.person('local-reward-owner'), stranger=f.person('local-reward-stranger');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Local reward test'})[0].account_id;
 const rule={enabled:true,nearby:true,spendCents:2000,spendPoints:20,welcomePoints:10,firstBookingPoints:20,visitPoints:0,conversionPoints:30,offers:[{id:'five-off',title:'$5 off',points:100,valueCents:500,minimumCents:4000}]};
 let journeyCustomer;
 function salon(name,lat,lon,city='Chicago',state='IL') {
  const id=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:randomUUID(),p_name:name,p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:city,p_state:state,p_postal_code:'60601',p_country:'US'}).salon_id;
  f.sql(`update locations set latitude=${lat},longitude=${lon} where id='${id}';update salon_settings set public_discovery_enabled=true,public_discovery_published_at=now() where salon_id='${id}';insert into services(salon_id,name,category,base_price) values('${id}','Manicure','Nails',50);`);
  return id;
 }
 const near=salon('Nearest rewards',41.881,-87.63),far=salon('Far rewards',42.30,-87.63),off=salon('Paused',41.89,-87.63),privateShop=salon('Not opted in',41.88,-87.62),empty=salon('No offers',41.885,-87.63),zero=salon('No earning',41.887,-87.63);
 const save=(id,p=rule)=>{const version=f.rpc(owner,'reward_owner',{p_salon:id,p_op:'load'}).version;return f.rpc(owner,'reward_owner',{p_salon:id,p_op:'save',p_args:{program:p,expectedVersion:version}});};
 const discover=args=>f.rpc(null,'reward_discover',args);
 const gps={p_lat:41.88,p_lon:-87.63};
 save(near);save(far);save(off,{...rule,enabled:false});save(privateShop,{...rule,nearby:false});save(empty,{...rule,nearby:false,offers:[]});save(zero,{...rule,nearby:false,spendPoints:0,welcomePoints:0,firstBookingPoints:0,visitPoints:0,conversionPoints:0});
 // Legacy invalid configurations can exist before this forward migration.
 f.sql(`update reward_programs set nearby=true where salon_id in ('${empty}','${zero}')`);
 await t.test('audit blockers: reachable earning path, server preview and versioned saves',async()=>{
  const load=()=>f.rpc(owner,'reward_owner',{p_salon:near,p_op:'load'});
  const stale=load();const a=save(near,{...rule,visitPoints:7});
  const rejected=f.http(3000,'/rpc/reward_owner','POST',{p_salon:near,p_op:'save',p_args:{program:{...stale.program,welcomePoints:33},expectedVersion:stale.version}},owner.token);
  assert.equal(rejected.data.code,'40001');assert.equal(load().program.visitPoints,7);assert.ok(a.version>stale.version);
  assert.ok(f.http(3000,'/rpc/reward_owner','POST',{p_salon:near,p_op:'save',p_args:{program:rule}},owner.token).status>=400);
  const simultaneous=await Promise.all([77,88].map(welcomePoints=>rewardParallelRpc(f,owner,'reward_owner',{p_salon:near,p_op:'save',p_args:{program:{...a.program,welcomePoints},expectedVersion:a.version}})));
  assert.equal(simultaneous.filter(r=>r.status<300).length,1);assert.equal(simultaneous.filter(r=>r.data.code==='40001').length,1);
  const fresh=salon('Concurrent first save',0,0,'Concurrency fixture','IL');
  const initial=await Promise.all([11,22].map(welcomePoints=>rewardParallelRpc(f,owner,'reward_owner',{p_salon:fresh,p_op:'save',p_args:{program:{...rule,welcomePoints},expectedVersion:0}})));
  assert.equal(initial.filter(r=>r.status<300).length,1);assert.equal(initial.filter(r=>r.data.code==='40001').length,1);
  const unreachable={...rule,spendPoints:0,firstBookingPoints:0,visitPoints:0,conversionPoints:0};
  const preview=f.rpc(owner,'reward_owner',{p_salon:near,p_op:'preview',p_args:{program:unreachable}}).readiness;
  assert.equal(preview.discoverable,false);assert.equal(preview.newCustomerOffers,0);
  assert.ok(f.http(3000,'/rpc/reward_owner','POST',{p_salon:near,p_op:'save',p_args:{program:unreachable,expectedVersion:load().version}},owner.token).status>=400);
  save(near,{...unreachable,nearby:false});f.sql(`update reward_programs set nearby=true where salon_id='${near}'`);
  assert.equal(discover(gps).salons.some(s=>s.id===near),false);
  save(near);
  const service=f.json(`select to_jsonb(id) from services where salon_id='${near}' limit 1`);
  f.sql(`update services set is_active=false where id='${service}'`);
  const invalid={...rule,offers:[{...rule.offers[0],serviceId:service}]};
  assert.equal(f.rpc(owner,'reward_owner',{p_salon:near,p_op:'preview',p_args:{program:invalid}}).readiness.discoverable,false);
  assert.ok(f.http(3000,'/rpc/reward_owner','POST',{p_salon:near,p_op:'save',p_args:{program:invalid,expectedVersion:load().version}},owner.token).status>=400);
  f.sql(`update services set is_active=true where id='${service}'`);save(near);
  f.sql(`update salon_settings set public_discovery_enabled=false where salon_id='${near}'`);
  assert.equal(discover(gps).salons.some(s=>s.id===near),false);assert.equal(f.rpc(null,'reward_public_program',{p_salon:near}).salon,null);
  assert.equal(f.rpc(null,'reward_nearby',gps).some(s=>s.id===near),false);
  assert.equal(f.rpc(owner,'reward_owner',{p_salon:near,p_op:'preview',p_args:{program:rule}}).readiness.discoverable,false);
  f.sql(`update salon_settings set public_discovery_enabled=true where salon_id='${near}'`);save(near);
 });
 await t.test('public eligibility is actor-bound and reads do not enroll',()=>{assertRewardPublicProgramContext(f,{salon:near,customer:stranger});});
 await t.test('anonymous local discovery only includes active opted-in usable programs; nearest stable order',()=>{
  const rows=discover(gps).salons;
  assert.deepEqual(rows.map(r=>r.id),[near]);assert.equal(rows[0].offers[0].points,100);assert.equal(rows[0].distanceMiles,0.1);
  assert.deepEqual(discover(gps),discover(gps));
  assert.equal(discover({...gps,p_category:'Hair'}).salons.length,0);
  assert.equal(discover({...gps,p_category:'Nails'}).salons.length,1);
  assert.equal(discover({}).needsArea,true);
  assert.equal(discover({p_state:'IL'}).needsArea,true);
  for(const invalid of [{p_lat:91,p_lon:0},{p_lat:0,p_lon:181},{p_lat:41.88},{...gps,p_radius_miles:50}]) assert.ok(f.http(3000,'/rpc/reward_discover','POST',invalid).status>=400);
 });
 await t.test('named city/state and ZIP stay in their explicit area, never borrow GPS distance',()=>{
  const named=discover({p_city:'Chicago',p_state:'IL',p_country:'US'}).salons;
  assert.deepEqual(new Set(named.map(r=>r.id)),new Set([near,far]));assert.ok(named.every(r=>r.distanceMiles===null));
  assert.equal(discover({p_city:'Chicago',p_state:'WI',p_country:'US'}).salons.length,0);
  assert.equal(discover({p_postal:'99999',p_state:'IL',p_country:'US'}).salons.length,0);
  assert.equal(discover({p_postal:'60601',p_country:'US'}).salons.some(s=>s.id===near),true);
 });
 await t.test('server filters, active services and pause update immediately without altering balances',()=>{
  save(near,{...rule,welcomePoints:0,conversionPoints:0});
  assert.equal(discover({...gps,p_kind:'welcome'}).salons.length,0);assert.equal(discover({...gps,p_kind:'before_after'}).salons.length,0);
  assert.equal(discover({...gps,p_kind:'spend'}).salons.length,1);
  const service=f.json(`select to_jsonb(id) from services where salon_id='${near}' limit 1`);
  save(near,{...rule,offers:[{...rule.offers[0],serviceId:service}]});
  f.sql(`update services set is_active=false where id='${service}'`);
  assert.equal(discover(gps).salons.length,0);
  f.sql(`update services set is_active=true where id='${service}'`);save(near,{...rule,enabled:false});assert.equal(discover(gps).salons.length,0);save(near);
  assert.equal(f.sql('select count(*) from reward_ledger'),'0');assert.equal(f.sql('select count(*) from reward_members'),'0');
 });
 await t.test('owner guidance is read-only, owner-bound and provides real aggregate results',()=>{
  const fresh=salon('Not configured',41.89,-87.64);
  const before=f.sql('select count(*) from reward_programs');
  const summary=f.rpc(owner,'reward_owner_discovery',{p_salon:fresh});assert.equal(summary.enabled,false);assert.equal(summary.members,0);
  assert.equal(f.sql('select count(*) from reward_programs'),before);
  for(const who of [null,stranger]) assert.ok(f.http(3000,'/rpc/reward_owner_discovery','POST',{p_salon:near},who?.token).status>=400);
  assert.equal(f.rpc(owner,'reward_owner_discovery',{p_salon:near}).enabled,true);
  assert.equal(f.rpc(owner,'reward_owner_discovery',{p_salon:near}).usableOffers,1);
  assert.equal(f.rpc(owner,'reward_owner_discovery',{p_salon:zero}).earning,false);
  assert.ok(f.http(3000,'/rpc/reward_discovery_offers','POST',{p_salon:near,p_offers:rule.offers}).status>=400);
 });
 await t.test('production React discovery component with real anonymous RPC data on mobile and desktop',async()=>{
  let setupStarted=false;
  await checkRewardDiscoveryUI({
   discover:q=>discover({p_city:q.get('location')?.startsWith('Chicago')?'Chicago':'Madison',p_state:q.get('location')?.startsWith('Chicago')?'IL':'WI',p_country:'US',p_category:q.get('category')||null,p_kind:q.get('kind')||'all'}),
   owner:()=>f.rpc(owner,'reward_owner_discovery',{p_salon:near}),
   program:id=>({...f.rpc(null,'reward_public_program',{p_salon:id}),authenticated:false}),
   setup:(op,args)=>{if(op==='load'&&!setupStarted){save(near,{...rule,enabled:false,nearby:false});setupStarted=true;}return f.rpc(owner,'reward_owner',{p_salon:near,p_op:op,p_args:args});},
   output:'artifacts/reward-practical-v3/browser-sql',
  });
 });
 await t.test('new customer discovery → linked visit → three paid receipts → consent → pause → real redemption and retry',()=>{
  save(near);const customer=f.person('reward-journey-customer'),customerId=randomUUID(),staffId=randomUUID();
  journeyCustomer=customer;
  const serviceId=f.json(`select to_jsonb(id) from services where salon_id='${near}' limit 1`);
  f.sql(`insert into customers(id,location_id,name,customer_user_id) values('${customerId}','${near}','Journey customer','${customer.profileId}');insert into staff(id,salon_id,display_name) values('${staffId}','${near}','Journey staff');`);
  const personal=(op,args={})=>f.rpc(customer,'reward_personal',{p_op:op,p_args:args});
  assert.equal(f.rpc(customer,'reward_public_program',{p_salon:near}).joined,false);
  function visit(amount){const id=randomUUID(),token=randomUUID();f.sql(`insert into customer_visits(id,salon_id,customer_id,origin_metadata) values('${id}','${near}','${customerId}',jsonb_build_object('token','${token}'));insert into pos_live_drafts(salon_id,token,customer) values('${near}','${token}','{"id":"${customerId}","name":"Journey customer"}');`);return{id,token,receipt:{customerId,customerVisitId:id,discountType:'fixed_amount',discountValue:0,tipAmount:0,liveDraftToken:token,lines:[{id:randomUUID(),staffId,serviceId,serviceLabel:'Manicure',total:amount,amountInput:String(amount),amountParts:[amount]}]}};}
  function pay(v){return f.rpc(owner,'replay_pos_owner_operation',{p_salon:near,p_operation_id:randomUUID(),p_occurred_at:new Date().toISOString(),p_payload:v.receipt});}
  const first=visit(50);assert.equal(personal('load',{visitId:first.id}).view.available,10);pay(first);
  assert.equal(personal('wallet').cards.find(c=>c.salonId===near).available,50);
  const second=visit(50);pay(second);assert.equal(personal('wallet').cards.find(c=>c.salonId===near).available,90);
  const third=visit(20);pay(third);assert.equal(personal('wallet').cards.find(c=>c.salonId===near).available,110);
  assert.equal(f.rpc(customer,'reward_public_program',{p_salon:near}).available,110);
  assert.equal(f.rpc(null,'reward_public_program',{p_salon:near}).available,null);
  const fourth=visit(50);personal('request',{visitId:fourth.id,offerId:'five-off',consent:true});
  const quote=f.rpc(owner,'reward_pos',{p_salon:near,p_op:'quote',p_args:{receipt:fourth.receipt,token:fourth.token}});
  assert.equal(quote.view.request.status,'confirmed');
  fourth.receipt.rewardQuote=quote.view.request.quote;
  save(near,{...rule,enabled:false});assert.equal(f.rpc(null,'reward_public_program',{p_salon:near}).salon,null);
  const args={p_salon:near,p_operation_id:randomUUID(),p_occurred_at:new Date().toISOString(),p_payload:fourth.receipt};
  const paid=f.rpc(owner,'replay_pos_owner_operation',args);assert.ok(paid.ticketId);assert.equal(f.rpc(owner,'replay_pos_owner_operation',args).ticketId,paid.ticketId);
  assert.equal(Number(f.sql(`select discount_value from pos_tickets where id='${paid.ticketId}'`)),5);
  assert.equal(Number(f.sql(`select sum(amount) from pos_payments where ticket_id='${paid.ticketId}'`)),45);
  assert.equal(personal('wallet').cards.find(c=>c.salonId===near).available,10);
  const summary=f.rpc(owner,'reward_owner_discovery',{p_salon:near});assert.equal(summary.discountCents,500);assert.equal(summary.rewardUses,1);
  save(near);assertRewardPublicProgramContext(f,{salon:near,customer});assertRewardOneTimeHistory(f,{salon:near,customer,ticketId:paid.ticketId});
 });
 if(process.env.RUN_REWARD_APP==='1')await t.test('actual authenticated Next owner, public API, salon continuity and member wallet',async()=>{
  const {rewardPracticalApp}=await import('./helpers/reward-practical-app.mjs');await rewardPracticalApp(f,{owner,customer:journeyCustomer,salon:near,account});
 });
 await t.test('radius handles high latitude/antimeridian and bounded results disclose truncation',()=>{
  save(near);
  const polar=salon('Across longitude boundary',80,-179.95,'Polar','AK');save(polar);
  assert.equal(discover({p_lat:80,p_lon:179.95,p_radius_miles:5}).salons[0].id,polar);
  for(let i=0;i<25;i++)save(salon(`Local ${String(i).padStart(2,'0')}`,41.90+i*.0001,-87.63));
  const rows=discover(gps);assert.equal(rows.salons.length,24);assert.equal(rows.hasMore,true);assert.equal(rows.salons[0].id,near);
  const last=rows.salons.map(s=>s.distanceMiles);assert.deepEqual([...last].sort((a,b)=>a-b),last);
 });
});
