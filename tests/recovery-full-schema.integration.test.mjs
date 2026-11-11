import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';
test('full schema and real Auth recovery preserve identity and require a fresh login', {timeout:600000}, async()=>{
 const f=await startIsolatedSupabase('recovery-completion',{db:'public.ecr.aws/supabase/postgres:17.11.0.006',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',storage:'public.ecr.aws/supabase/storage-api:v1.84.19',rest:'public.ecr.aws/supabase/postgrest:v16.5'},{allowConcurrentFixtureCleanup:true});
 try{
  const admin=f.person('admin'),customer=f.person('customer'),outsider=f.person('outsider');
  f.sql(`insert into platform_admin_memberships(user_id,role_id,status) select '${admin.profileId}',id,'active' from platform_admin_roles where slug='platform_owner';`);
  const email=`recovered.${crypto.randomUUID()}@example.invalid`;
  const data={category:'account_takeover',description:'Fixture independently verified recovery request.',priority:'high',recovery_contact:email,identity_verified:true,contact_verified:false,verification_evidence:'Fixture verified original account ownership independently.'};
  const caseId=f.rpc(admin,'admin_user_case_save',{p_user_id:customer.profileId,p_request_id:crypto.randomUUID(),p_case_id:null,p_data:data,p_reason:'Fixture verified recovery'});
  assert.equal(f.http(3000,'/rpc/admin_secure_recovery','POST',{p_case:caseId,p_reason:'Unauthorized fixture'},outsider.token).status,400);
  const digest=crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
  f.rpc(admin,'admin_recovery_contact_begin',{p_case:caseId,p_request:crypto.randomUUID(),p_digest:digest,p_reason:'Fixture contact proof'});
  assert.equal(f.rpc({token:f.serviceToken},'confirm_recovery_contact',{p_digest:digest}),true);
  f.rpc(admin,'admin_secure_recovery',{p_case:caseId,p_reason:'Fixture contain compromise'});
  assert.equal(f.sql(`select count(*) from auth.sessions where user_id='${customer.authId}'`),'0');
  function begin(operation){const requestId=crypto.randomUUID();f.rpc(admin,'admin_user_identity_begin',{p_request_id:requestId,p_user_id:customer.profileId,p_operation:operation,p_email:operation==='email_change'?email:null,p_payload:{case_id:caseId},p_reason:'Fixture verified identity action'});return requestId;}
  function finish(requestId){f.rpc({token:f.serviceToken},'admin_user_identity_finish',{p_request_id:requestId,p_status:'accepted',p_auth_user_id:customer.authId});}
  const changed=begin('email_change');f.request(9999,`/admin/users/${customer.authId}`,'PUT',{email,email_confirm:true},f.serviceToken);finish(changed);
  f.sql(`update admin_user_identity_jobs set created_at=now()-interval '2 minutes' where user_id='${customer.profileId}'`);
  const reset=begin('password_reset');
  const link=f.request(9999,'/admin/generate_link','POST',{type:'recovery',email},f.serviceToken);assert.ok(link.hashed_token);
  finish(reset);
  const recovery=f.request(9999,'/verify','POST',{type:'recovery',token_hash:link.hashed_token});assert.ok(recovery.access_token);
  const payload=JSON.parse(Buffer.from(recovery.access_token.split('.')[1],'base64url'));
  assert.equal(f.rpc({token:f.serviceToken},'recovery_reset_session_valid',{p_auth_id:customer.authId,p_session_id:payload.session_id}),true);
  const password=`Fixture!${crypto.randomBytes(20).toString('hex')}`;
  f.request(9999,'/user','PUT',{password},recovery.access_token);
  f.rpc({token:f.serviceToken},'record_recovery_password_change',{p_auth_id:customer.authId});
  assert.equal(f.sql(`select public.recovery_access_complete('${caseId}')`),'f');
  assert.equal(f.rpc({token:f.serviceToken},'recovery_reset_session_valid',{p_auth_id:customer.authId,p_session_id:payload.session_id}),false);
  const login=f.request(9999,'/token?grant_type=password','POST',{email,password});assert.equal(login.user.id,customer.authId);
  assert.equal(f.sql(`select public.recovery_access_complete('${caseId}')`),'t');
  assert.equal(f.sql(`select count(*) from public.users where auth_user_id='${customer.authId}'`),'1');
  f.sql(`update platform_reports set status='resolved',resolution='Fixture customer regained access' where id='${caseId}'`);
  assert.equal(f.sql(`select status from account_recovery_requests where admin_case_id='${caseId}'`),'resolved');
  f.save('real-auth-recovery.json',{passed:true,identityPreserved:true,oldSessionsRevoked:true,passwordChanged:true,freshLoginRequired:true,noEmailSent:true});
 }catch(e){throw Error(f.redact(e.stack));}finally{f.close();}
});
