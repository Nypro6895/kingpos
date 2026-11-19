import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('real Auth/PostgREST enforce session revocation before RLS and definer RPC, while another device remains usable',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 const images=JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{"db":"public.ecr.aws/supabase/postgres:17.11.0.006","auth":"public.ecr.aws/supabase/gotrue:v2.197.0","storage":"public.ecr.aws/supabase/storage-api:v1.84.19","rest":"public.ecr.aws/supabase/postgrest:v16.5"}');
 const f=await startIsolatedSupabase('security-sessions',images,{allowConcurrentFixtureCleanup:true});
 try{
  const first=f.person('session-owner'),outsider=f.person('session-outsider');
  const link=f.request(9999,'/admin/generate_link','POST',{type:'magiclink',email:first.email},f.serviceToken);
  const secondLogin=f.request(9999,'/verify','POST',{type:'magiclink',token_hash:link.hashed_token});
  assert.ok(secondLogin.access_token);assert.ok(secondLogin.refresh_token);
  const second={...first,token:secondLogin.access_token};
  const firstId=f.rpc(first,'check_account_login_session').session_id;
  const secondId=f.rpc(second,'check_account_login_session').session_id;
  assert.notEqual(firstId,secondId);
  assert.equal(f.http(3000,'/rpc/reylumi_account_session_state','GET',undefined,second.token).status,200);
  const privateBucket='session-private-fixture',publicBucket='session-public-fixture';
  f.request(5000,'/bucket','POST',{id:privateBucket,name:privateBucket,public:false},f.serviceToken);
  f.request(5000,'/bucket','POST',{id:publicBucket,name:publicBucket,public:true},f.serviceToken);
  f.sql(`create policy fixture_session_storage_read on storage.objects for select to authenticated using(bucket_id='${privateBucket}');`);
  f.request(5000,'/object/'+privateBucket+'/proof.json','POST',{proof:true},f.serviceToken);
  f.request(5000,'/object/'+publicBucket+'/proof.json','POST',{proof:true},f.serviceToken);
  assert.equal(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,first.token).status,200);
  // A synthetic SECURITY DEFINER RPC deliberately ignores RLS. The effective
  // PostgREST hook must reject a revoked token before this body can execute.
  f.sql(`create function public.fixture_session_guard_definer() returns integer language sql security definer set search_path=public as $$select count(*)::int from users$$;
   revoke all on function public.fixture_session_guard_definer() from public,anon;grant execute on function public.fixture_session_guard_definer() to authenticated;notify pgrst,'reload schema';`);
  for(let attempt=0;attempt<40;attempt++){
   if(f.http(3000,'/rpc/fixture_session_guard_definer','POST',{},second.token).status===200)break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(f.rpc(second,'fixture_session_guard_definer')>=2);
  assert.ok(f.http(3000,'/rpc/revoke_account_login_session','POST',{p_session_id:firstId,p_scope:'one'},outsider.token).status>=400);
  assert.equal(f.rpc(second,'revoke_account_login_session',{p_session_id:firstId,p_scope:'one'}),1);
  assert.equal(f.http(3000,`/users?auth_user_id=eq.${first.authId}&select=id`,'GET',undefined,first.token).status,401);
  assert.equal(f.http(3000,'/rpc/fixture_session_guard_definer','POST',{},first.token).status,401);
  assert.equal(f.http(3000,'/rpc/check_account_login_session','POST',{},first.token).status,401);
  assert.equal(f.http(3000,'/rpc/reylumi_account_session_state','GET',undefined,first.token).status,401);
  assert.ok(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,first.token).status>=400);
  assert.equal(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,second.token).status,200);
  assert.equal(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,f.serviceToken).status,200);
  assert.equal(f.http(5000,'/object/public/'+publicBucket+'/proof.json').status,200);
  assert.ok(f.rpc(second,'fixture_session_guard_definer')>=2);
  assert.equal(f.rpc(second,'check_account_login_session').allowed,true);
  const revokedSid=JSON.parse(Buffer.from(first.token.split('.')[1],'base64url')).session_id;
  assert.equal(f.sql(`select count(*) from auth.refresh_tokens where session_id='${revokedSid}'`),'0');
  assert.ok(f.http(3000,`/account_login_sessions?id=eq.${firstId}`,'PATCH',{revoked_at:null},second.token).status>=400);
  assert.ok(f.http(3000,'/account_login_sessions','POST',{id:randomUUID(),user_id:first.profileId,auth_user_id:first.authId,auth_session_id:revokedSid},second.token).status>=400);
  // Retain the second device's refresh path as a positive control.
  assert.equal(f.http(9999,'/token?grant_type=refresh_token','POST',{refresh_token:secondLogin.refresh_token}).status,200);
  f.save('security-session-acceptance.json',{passed:true,migrations:f.evidence.migrationHashes.length,effectiveHookEnforced:true,oldJwtTableDenied:true,oldJwtDefinerRpcDenied:true,privateStorageDenied:true,publicStorageAndServicePreserved:true,refreshRevoked:true,siblingPreserved:true,liveDataTouched:false});
 }catch(error){throw Error(f.redact(error.stack));}finally{f.close();}
});
