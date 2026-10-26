import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startIsolatedSupabase } from './helpers/isolated-supabase-fixture.mjs';

test('bulk customer merge with complete migrations, Auth, PostgREST and RLS', {
  skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async t=>{
  const f=await startIsolatedSupabase('customer-merge-suggestions');
  t.after(()=>f.close());
  const owner=f.person('owner'),personal=f.person('personal'),other=f.person('other');
  const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Merge Fixture'})[0].account_id;
  const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Merge Fixture',p_owner_is_staff:false,
    p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
  const make=(user=null)=>f.rest(owner,'/customers','POST',{location_id:salon,name:'Merge Fixture',phone:'5035550170',email:'merge@example.invalid',customer_user_id:user})[0].id;
  const args=(target,sources)=>({p_salon:salon,p_target:target,p_sources:sources});
  const target=make(personal.profileId),compatible=make(),conflict=make(other.profileId);
  await t.test('compatible and conflicting suggestions both remain visible',()=>{
    const batch=f.rpc(owner,'customer_duplicate_batch',{p_salon:salon,p_ids:[target]})[target];
    assert.equal(batch.length,2);
    assert.match(batch.find(c=>c.id===conflict).mergeBlockedReason,/different personal account/);
    assert.equal(batch.find(c=>c.id===compatible).mergeBlockedReason,null);
  });
  await t.test('anonymous, outsider and customer callers cannot invoke the owner bulk merge',()=>{
    for (const who of [null,other,personal]) {
      assert.ok(f.http(3000,'/rpc/merge_customer_suggestions','POST',args(target,[compatible,conflict]),who?.token).status>=400);
      assert.ok(f.http(3000,'/rpc/customer_merge_plan','POST',args(target,[compatible,conflict]),who?.token).status>=400);
    }
    assert.ok(f.http(3000,'/rpc/customer_merge_plan_internal','POST',args(target,[compatible]),owner.token).status>=400);
  });
  await t.test('one transaction preserves real booking ownership, ticket amounts and conflicting account',()=>{
    const booking=crypto.randomUUID(),ticket=crypto.randomUUID();
    f.sql(`insert into bookings(id,salon_id,customer_id,start_at,end_at) values('${booking}','${salon}','${compatible}',now()+interval '2 days',now()+interval '2 days 1 hour')`);
    f.sql(`insert into pos_tickets(id,salon_id,customer_id,source_booking_id) values('${ticket}','${salon}','${compatible}','${booking}')`);
    f.sql(`insert into pos_ticket_items(salon_id,pos_ticket_id,service_name_snapshot,unit_price,line_total) values('${salon}','${ticket}','Fixture Service',170,170)`);
    const result=f.rpc(owner,'merge_customer_suggestions',args(target,[compatible,conflict]));
    assert.equal(result.merged,1);assert.deepEqual(result.skipped.map(c=>c.id),[conflict]);
    assert.equal(f.rest(owner,`/customers?id=eq.${compatible}`).length,0);
    assert.equal(f.rest(owner,`/customers?id=eq.${conflict}`)[0].customer_user_id,other.profileId);
    assert.equal(f.rest(owner,`/customers?id=eq.${target}`)[0].customer_user_id,personal.profileId);
    assert.equal(f.sql(`select customer_id from bookings where id='${booking}'`),target);
    assert.equal(f.sql(`select customer_user_id is null from bookings where id='${booking}'`),'t');
    assert.equal(f.sql(`select customer_id from pos_tickets where id='${ticket}'`),target);
    assert.equal(Number(f.sql(`select sum(line_total) from pos_ticket_items where pos_ticket_id='${ticket}'`)),170);
    const blocked=f.rpc(owner,'merge_customer_suggestions',args(target,[conflict]));
    assert.equal(blocked.merged,0);assert.equal(blocked.skipped.length,1);
  });
  await t.test('an unlinked target does not choose between personal accounts',()=>{
    const unlinked=make(),a=make(personal.profileId),b=make(other.profileId),safe=make();
    const result=f.rpc(owner,'merge_customer_suggestions',args(unlinked,[b,safe,a]));
    assert.equal(result.merged,1);assert.equal(result.skipped.length,2);
    assert.equal(f.rest(owner,`/customers?id=eq.${unlinked}`)[0].customer_user_id,null);
  });
  f.save('customer-merge-suggestions-results.json',{passed:true,migrations:f.evidence.migrationHashes.length});
});
