import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startIsolatedSupabase } from './helpers/isolated-supabase-phone-fixture.mjs';

test('customer identity with complete migrations, real Auth, PostgREST and RLS', {
  skip: process.env.RUN_ISOLATED_SUPABASE !== '1', timeout: 900000,
}, async t => {
  const f = await startIsolatedSupabase('customer-identity');
  t.after(() => f.close());
  const owner=f.person('owner'), outsider=f.person('outsider'), personal=f.person('customer');
  const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Identity Fixture'})[0].account_id;
  const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Identity Fixture',p_owner_is_staff:false,
    p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
  const make=(name,phone=null,user=null)=>f.rest(owner,'/customers','POST',{location_id:salon,name,phone,customer_user_id:user})[0].id;
  const call=(who,name,args)=>f.http(3000,`/rpc/${name}`,'POST',args,who?.token);
  const merge=(who,target,sources)=>call(who,'merge_customer_records',{p_salon:salon,p_target:target,p_sources:sources});
  const nene=make('nene','9713732876');
  await t.test('owner creation normalizes phone and reuses typo-name match',()=>{
    assert.equal(f.rpc(owner,'create_salon_customer_identity',{p_salon:salon,p_input:{name:'nenr',phone:'+1 (971) 373-2876'}}),nene);
    assert.ok(f.rpc(owner,'find_customer_identity_matches',{p_salon:salon,p_name:'ne',p_phone:'9713722876'}).some(c=>c.id===nene));
  });
  await t.test('outsiders and anonymous callers cannot read or merge salon customers',()=>{
    for(const who of [null,outsider]) {
      assert.ok(call(who,'find_customer_identity_matches',{p_salon:salon,p_name:'nene',p_phone:'9713732876'}).status>=400);
      assert.ok(merge(who,nene,[make('nene','9713732876')]).status>=400);
    }
  });
  await t.test('340 walking records occupy exactly one directory row before pagination',()=>{
    f.sql(`insert into customers(location_id,name) select '${salon}','Walking' from generate_series(1,340)`);
    const result=f.rpc(owner,'customer_directory',{p_salon:salon});
    const walking=result.rows.filter(c=>c.walking_count);
    assert.equal(walking.length,1);assert.equal(walking[0].walking_count,340);
    assert.ok(result.count<25);
  });
  await t.test('manual merge preserves real linked customer trigger metadata and aliases',()=>{
    const target=make('Mary','5035550100'),source=make('Mary','15035550100',personal.profileId);
    const result=merge(owner,target,[source]); assert.equal(result.status,200,JSON.stringify(result.data));
    const kept=f.rest(owner,`/customers?id=eq.${target}`)[0];
    assert.equal(kept.customer_user_id,personal.profileId);assert.ok(kept.customer_account_claimed_at);
    assert.equal(f.rest(owner,`/customer_merged_ids?source_id=eq.${source}`)[0].target_id,target);
    assert.equal(f.rest(owner,`/customers?id=eq.${source}`).length,0);
  });
  await t.test('personal merging requires every record already linked to that account',()=>{
    const a=make('David','5035550110',personal.profileId),b=make('Davif','5035550110',personal.profileId),unlinked=make('David','5035550111');
    assert.ok(f.rpc(personal,'my_customer_identity_groups').some(g=>g.customers.some(c=>c.id===a)));
    assert.ok(merge(personal,a,[unlinked]).status>=400);
    const result=merge(personal,a,[b]); assert.equal(result.status,200,JSON.stringify(result.data));
    assert.equal(f.rest(personal,'/customer_merge_events').length,0);
  });
  await t.test('different linked accounts fail atomically',()=>{
    const a=make('Ana','5035550120',personal.profileId),b=make('Ana','5035550120',outsider.profileId);
    const before=Number(f.sql('select count(*) from customer_merge_events'));
    assert.ok(merge(owner,a,[b]).status>=400);
    assert.equal(f.rest(owner,`/customers?id=in.(${a},${b})`).length,2);
    assert.equal(Number(f.sql('select count(*) from customer_merge_events')),before);
  });
  await t.test('automatic consolidation works with actual dependencies and excludes unrelated shared-phone names',()=>{
    const unrelated=make('Admin-Truong','9713732876');
    assert.ok(f.rpc(owner,'consolidate_customer_identities',{p_salon:salon})>=2);
    assert.equal(f.rest(owner,`/customers?id=eq.${unrelated}`).length,1);
  });
  await t.test('public display checks both fields, preserves separate shared-phone visits and replays requests',()=>{
    const token=crypto.randomUUID();
    f.sql(`insert into pos_live_drafts(salon_id,token) values('${salon}','${token}')`);
    const args={p_token:token,p_phone:'9713732876',p_customer_name:'nenr',p_request_id:crypto.randomUUID()};
    const first=f.rpc(null,'resolve_customer_display_check_in_identity',args);
    assert.equal(first.ok,true,JSON.stringify(first));
    assert.equal(first.visit.customerId,nene);
    assert.deepEqual(f.rpc(null,'resolve_customer_display_check_in_identity',args),first);
    const ambiguous=f.rpc(null,'resolve_customer_display_check_in_identity',{...args,p_customer_name:'David',p_request_id:crypto.randomUUID()});
    assert.equal(ambiguous.ok,false);assert.ok(ambiguous.candidates?.length>0);
    assert.ok(!JSON.stringify(ambiguous.candidates).includes('9713732876'));
    const separateArgs={...args,p_customer_name:'David',p_request_id:crypto.randomUUID(),p_new_customer:true};
    const separate=f.rpc(null,'resolve_customer_display_check_in_identity',separateArgs);
    assert.equal(separate.ok,true,JSON.stringify(separate));assert.notEqual(separate.visit.id,first.visit.id);
    assert.notEqual(separate.visit.customerId,nene);
    assert.deepEqual(f.rpc(null,'resolve_customer_display_check_in_identity',separateArgs),separate);
    assert.ok(merge(owner,nene,[separate.visit.customerId]).status>=400);
    f.sql(`update customer_visits set status='completed' where id in ('${first.visit.id}','${separate.visit.id}')`);
    const merged=merge(owner,nene,[separate.visit.customerId]);assert.equal(merged.status,200,JSON.stringify(merged.data));
    assert.equal(f.sql(`select customer_id from customer_visits where id='${separate.visit.id}'`),nene);
  });
  await t.test('booking resolver and merge preserve actual booking ownership and ticket item amounts',()=>{
    const source=make('Helen','5035550130');
    const resolved=f.rpc(owner,'create_booking_customer_identity',{p_salon:salon,p_name:'Helrn',p_phone:'15035550130',p_email:null,
      p_user:null,p_actor:owner.profileId,p_source:'owner_booking'});
    assert.equal(resolved.created,false);assert.equal(resolved.customer.id,source);
    const target=make('Helen','5035550130');
    const booking=crypto.randomUUID(),ticket=crypto.randomUUID();
    f.sql(`insert into bookings(id,salon_id,customer_id,start_at,end_at) values('${booking}','${salon}','${source}',now()+interval '2 days',now()+interval '2 days 1 hour')`);
    f.sql(`insert into pos_tickets(id,salon_id,customer_id,source_booking_id) values('${ticket}','${salon}','${source}','${booking}')`);
    f.sql(`insert into pos_ticket_items(salon_id,pos_ticket_id,service_name_snapshot,unit_price,line_total) values('${salon}','${ticket}','Fixture Service',165,165)`);
    const result=merge(owner,target,[source]);assert.equal(result.status,200,JSON.stringify(result.data));
    assert.equal(f.sql(`select customer_id from bookings where id='${booking}'`),target);
    assert.equal(f.sql(`select customer_user_id is null from bookings where id='${booking}'`),'t');
    assert.equal(f.sql(`select customer_id from pos_tickets where id='${ticket}'`),target);
    assert.equal(Number(f.sql(`select sum(line_total) from pos_ticket_items where pos_ticket_id='${ticket}'`)),165);
  });
  f.save('customer-identity-full-schema-results.json',{passed:true,migrations:f.evidence.migrationHashes.length});
});
