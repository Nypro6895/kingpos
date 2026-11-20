import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('workspace graph is read-only, self scoped under RLS and immediately reflects removed grants',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async t=>{
 const f=await startIsolatedSupabase('workspace-graph',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'));t.after(()=>f.close());
 const owner=f.person('dal-owner'),other=f.person('dal-other');
 const fresh=f.rpc(owner,'read_my_workspace_graph_v1');assert.equal(fresh.bootstrapRequired,true);
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'DAL Owner'})[0].account_id;
 const otherAccount=f.rpc(other,'ensure_personal_account_for_current_user',{p_account_name:'DAL Other'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'DAL salon',p_owner_is_staff:true,
   p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
 const counts=()=>f.sql("select jsonb_build_object('accounts',(select count(*) from accounts),'memberships',(select count(*) from account_memberships),'users',(select count(*) from users))");
 const before=counts(),graph=f.rpc(owner,'read_my_workspace_graph_v1');assert.equal(counts(),before);
 assert.equal(graph.userId,owner.profileId);assert.equal(graph.bootstrapRequired,false);
 assert(graph.accounts.some(a=>a.id===account));assert(!graph.accounts.some(a=>a.id===otherAccount));
 assert(graph.locations.some(l=>l.id===salon));assert(graph.staff.some(s=>s.salon_id===salon));
 const project='id,account_id,user_id,role_id,status,joined_at,created_at,updated_at';
 const memberships=f.rest(owner,`/account_memberships?user_id=eq.${owner.profileId}&status=eq.active&select=${project}&order=created_at,id`);
 assert.deepEqual(graph.accountMemberships,memberships,'same projected membership facts as the prior REST path');
 const outsider=f.rpc(other,'read_my_workspace_graph_v1');assert(!outsider.accounts.some(a=>a.id===account));assert(!outsider.locations.some(l=>l.id===salon));
 assert.throws(()=>f.rpc(null,'read_my_workspace_graph_v1'));
 const role=graph.accountMemberships.find(m=>m.account_id===account).role_id;
 f.sql(`delete from role_permissions where role_id='${role}';`);
 assert.equal(f.rpc(owner,'read_my_workspace_graph_v1').grants.filter(g=>g.role_id===role).length,0,'no result shared into later requests');
 f.sql(`update account_memberships set status='removed' where user_id='${owner.profileId}'; update salon_memberships set status='removed' where user_id='${owner.profileId}'; update staff set is_active=false where account_user_id='${owner.profileId}';`);
 const removed=f.rpc(owner,'read_my_workspace_graph_v1');assert.equal(removed.accounts.length,0);assert.equal(removed.locations.length,0);
 f.sql(`update users set status='suspended' where id='${owner.profileId}';`);assert.throws(()=>f.rpc(owner,'read_my_workspace_graph_v1'));
 f.save('workspace-graph-result.json',{selfScoped:true,anonymousDenied:true,suspendedDenied:true,removedMembershipsWithdrawn:true,removedGrantsWithdrawn:true,readOnly:true,projectionMatchesLegacy:true});
});
