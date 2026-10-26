import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('signup phone history with complete migrations, real Auth/PostgREST and RLS',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async t=>{
 const images=JSON.parse(process.env.TEST_SUPABASE_IMAGES || '{}');
 const f=await startIsolatedSupabase('signup-phone-history',images);t.after(()=>f.close());
 const owner=f.person('phone-owner'),customer=f.person('phone-customer'),outsider=f.person('phone-outsider');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Phone history fixture'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Phone history salon',p_owner_is_staff:false,
  p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
 const phone='+15035550901';
 const make=name=>f.rest(owner,'/customers','POST',{location_id:salon,name,phone})[0].id;
 const mary=make('Mary'),david=make('David');
 await t.test('before verification even the signed-in customer cannot discover phone history',()=>{
  assert.equal(f.rpc(customer,'get_my_phone_history_profiles',{p_phone:phone}).ok,false);
  assert.equal(f.rpc(customer,'claim_selected_phone_history',{p_phone:phone,p_customer_ids:[mary]}).ok,false);
 });
 // Simulate provider-confirmed phone inside the network-isolated fixture. No SMS is sent.
 f.sql(`update auth.users set phone='15035550901',phone_confirmed_at=now() where id='${customer.authId}'`);
 assert.equal(f.rpc(customer,'record_customer_verified_phone_from_auth',{p_phone:phone}).ok,true);
 await t.test('shared names require selection, expose only allowed fields and remain unclaimed',()=>{
  const result=f.rpc(customer,'claim_customers_for_verified_phone',{p_phone:phone});assert.equal(result.selectionRequired,true);assert.equal(result.linkedCount,0);
  const choices=f.rpc(customer,'get_my_phone_history_profiles',{p_phone:phone});assert.equal(choices.profiles.length,2);
  assert.deepEqual(Object.keys(choices.profiles[0]).sort(),['id','linked','name','salonName']);
 });
 const visit=crypto.randomUUID();
 f.sql(`insert into customer_visits(id,salon_id,customer_id,status,source) values('${visit}','${salon}','${mary}','waiting','walk_in')`);
 await t.test('selected profile immediately exposes historical check-in through the real activity RPC',()=>{
  const result=f.rpc(customer,'claim_selected_phone_history',{p_phone:phone,p_customer_ids:[mary]});assert.equal(result.linkedCount,1);
  const history=f.rpc(customer,'get_customer_activity',{p_limit:100});assert.equal(history.ok,true);assert.ok(history.visits.some(v=>v.id===visit));
  assert.equal(f.rest(owner,`/customers?id=eq.${david}`)[0].customer_user_id,null);
  assert.equal(f.rpc(customer,'claim_selected_phone_history',{p_phone:phone,p_customer_ids:[mary]}).linkedCount,0);
 });
 await t.test('outsider and anonymous clients cannot discover or claim this phone',()=>{
  assert.equal(f.rpc(outsider,'get_my_phone_history_profiles',{p_phone:phone}).ok,false);
  assert.equal(f.rpc(outsider,'claim_selected_phone_history',{p_phone:phone,p_customer_ids:[david]}).ok,false);
  assert.ok(f.http(3000,'/rpc/get_my_phone_history_profiles','POST',{p_phone:phone}).status>=400);
 });
 f.save('signup-phone-history-results.json',{passed:true,migrations:f.evidence.migrationHashes.length});
});
