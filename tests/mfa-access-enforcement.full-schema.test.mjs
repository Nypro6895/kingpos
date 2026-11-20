import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

const forward='20261119221000_mfa_access_enforcement.sql';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";

function decodeBase32(value){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let accumulator=0,bits=0;const bytes=[];
 for(const c of value.toUpperCase().replace(/[=\s]/g,'')){
  const index=alphabet.indexOf(c);assert.ok(index>=0,'Invalid owned TOTP secret encoding');
  accumulator=(accumulator<<5)|index;bits+=5;
  if(bits>=8){bits-=8;bytes.push((accumulator>>>bits)&255);}
 }
 return Buffer.from(bytes);
}

test('real Auth TOTP assurance restricts private data, definer RPC and Storage while pending verification remains usable',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 const sourceRoot=process.cwd(),migrations=path.join(sourceRoot,'supabase/migrations');
 const output=process.env.BOOKING_TEST_OUTPUT_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'mfa-enforcement-'));
 fs.mkdirSync(output,{recursive:true});
 const files=fs.readdirSync(migrations).filter(file=>file.endsWith('.sql')).sort();
 assert.equal(files.length,454);assert.equal(files.at(-1),forward);
 const inherited=files.filter(file=>file!==forward).map(file=>({file,sha256:sha(fs.readFileSync(path.join(migrations,file)))}));
 const bytes=fs.readFileSync(path.join(migrations,forward)),sql=bytes.toString().replaceAll('\r\n','\n');
 const staging=path.join(output,'baseline453/supabase/migrations');fs.mkdirSync(staging,{recursive:true});
 for(const {file,sha256} of inherited){const body=fs.readFileSync(path.join(migrations,file));assert.equal(sha(body),sha256);fs.writeFileSync(path.join(staging,file),body);}
 const images=JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{"db":"public.ecr.aws/supabase/postgres:17.11.0.006","auth":"public.ecr.aws/supabase/gotrue:v2.197.0","storage":"public.ecr.aws/supabase/storage-api:v1.84.19","rest":"public.ecr.aws/supabase/postgrest:v16.5"}');
 let f;try{process.chdir(path.join(output,'baseline453'));f=await startIsolatedSupabase('mfa-enforcement',images,{allowConcurrentFixtureCleanup:true});}finally{process.chdir(sourceRoot);}
 const secrets=new Set(),checks=[];
 const hide=value=>{let result=f.redact(value);for(const secret of secrets)if(secret)result=result.replaceAll(secret,'[owned-mfa-redacted]');return result;};
 const remember=data=>{for(const key of ['access_token','refresh_token'])if(typeof data?.[key]==='string')secrets.add(data[key]);return data;};
 const check=(name,action)=>{action();checks.push(name);};
 const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
 function passwordLogin(account){return remember(f.request(9999,'/token?grant_type=password','POST',{email:account.email,password:account.password}));}
 function account(name){
  const password='OwnedMfa!'+randomBytes(22).toString('hex');secrets.add(password);
  const email=name+'.'+randomBytes(8).toString('hex')+'@example.invalid';
  const signup=remember(f.request(9999,'/signup','POST',{email,password,data:{display_name:'Owned MFA '+name,first_name:'Owned',last_name:name}}));assert.ok(signup.user?.id);
  const value={email,password,authId:signup.user.id},login=passwordLogin(value);assert.ok(login.access_token);
  value.token=login.access_token;value.refreshToken=login.refresh_token;
  const scoped={token:value.token},rows=f.rest(scoped,'/users?auth_user_id=eq.'+value.authId+'&select=id');
  value.profileId=rows[0]?.id||f.rest(scoped,'/users','POST',{auth_user_id:value.authId,email,display_name:'Owned MFA '+name,first_name:'Owned',last_name:name,status:'active'})[0].id;
  return value;
 }
 function enroll(token,name){
  const factor=f.request(9999,'/factors','POST',{factor_type:'totp',friendly_name:name,issuer:'Owned isolated MFA'},token);
  assert.ok(factor.id);assert.ok(factor.totp?.secret);assert.ok(factor.totp?.uri);
  for(const value of [factor.totp.secret,factor.totp.uri,factor.totp.qr_code])if(value)secrets.add(value);
  const uri=new URL(factor.totp.uri);assert.equal(uri.protocol,'otpauth:');assert.equal(uri.hostname,'totp');
  const period=Number(uri.searchParams.get('period')||30),digits=Number(uri.searchParams.get('digits')||6),algorithm=(uri.searchParams.get('algorithm')||'SHA1').toLowerCase();
  assert.ok([30,60].includes(period));assert.ok([6,8].includes(digits));assert.ok(['sha1','sha256','sha512'].includes(algorithm));
  return{id:factor.id,key:decodeBase32(factor.totp.secret),period,digits,algorithm,lastCounter:null};
 }
 function codeFor(factor){
  const counter=Math.floor(Date.now()/1000/factor.period),buffer=Buffer.alloc(8);buffer.writeBigUInt64BE(BigInt(counter));
  const digest=createHmac(factor.algorithm,factor.key).update(buffer).digest(),offset=digest[digest.length-1]&15;
  const value=String((digest.readUInt32BE(offset)&0x7fffffff)%(10**factor.digits)).padStart(factor.digits,'0');secrets.add(value);factor.lastCounter=counter;return value;
 }
 const challenge=(token,factor)=>f.request(9999,'/factors/'+factor.id+'/challenge','POST',{},token);
 function verify(token,factor,challengeId,code){return remember(f.http(9999,'/factors/'+factor.id+'/verify','POST',{challenge_id:challengeId,code},token).data);}
 function sqlState(token,profileId){
  const verified=claims(token),selected={role:verified.role,sub:verified.sub,session_id:verified.session_id,aal:verified.aal};
  assert.equal(selected.role,'authenticated');assert.ok(selected.session_id);
  const result=f.sql(`begin;set local role authenticated;do $ctx$begin perform set_config('request.jwt.claims',${literal(JSON.stringify(selected))},true);end$ctx$;
    select jsonb_build_object('state',public.reylumi_account_session_state(),'ownRows',(select count(*) from public.users where id=${literal(profileId)}));rollback;`);
  return JSON.parse(result.split(/\r?\n/).find(line=>line.startsWith('{')));
 }
 const sessionMetadata=()=>f.json(`select jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig)
  from pg_proc p where p.oid='public.reylumi_account_session_state()'::regprocedure`);
 try{
  check('byte-identical inherited453 schema loaded',()=>assert.deepEqual(f.evidence.migrationHashes.map(({file,sha256})=>({file,sha256})),inherited));
  const owner=account('owner'),control=account('control');
  assert.equal(claims(owner.token).aal,'aal1');assert.equal(claims(control.token).aal,'aal1');
  f.rpc(owner,'check_account_login_session');f.rpc(control,'check_account_login_session');
  const privateBucket='mfa-private-fixture',publicBucket='mfa-public-fixture';
  f.request(5000,'/bucket','POST',{id:privateBucket,name:privateBucket,public:false},f.serviceToken);
  f.request(5000,'/bucket','POST',{id:publicBucket,name:publicBucket,public:true},f.serviceToken);
  f.sql(`create policy fixture_mfa_private_read on storage.objects for select to authenticated using(bucket_id=${literal(privateBucket)});`);
  f.request(5000,'/object/'+privateBucket+'/proof.json','POST',{ownedFixture:true},f.serviceToken);
  f.request(5000,'/object/'+publicBucket+'/proof.json','POST',{ownedFixture:true},f.serviceToken);
  assert.equal(f.sql("select prosecdef from pg_proc where oid='public.current_public_user_id()'::regprocedure"),'t');
  const factor=enroll(owner.token,'Owned verified factor');
  const firstChallenge=challenge(owner.token,factor),firstCode=codeFor(factor);
  const firstStrong=verify(owner.token,factor,firstChallenge.id,firstCode);assert.ok(firstStrong.access_token);assert.equal(claims(firstStrong.access_token).aal,'aal2');
  const weak=passwordLogin(owner);assert.ok(weak.access_token);assert.equal(claims(weak.access_token).aal,'aal1');
  const weakPerson={...owner,token:weak.access_token};f.rpc(weakPerson,'check_account_login_session');
  check('before454 verified-factor AAL1 gap reproduced only on owned account',()=>{
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},weak.access_token).status,200);
   assert.equal(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,weak.access_token).status,200);
   assert.equal(sqlState(weak.access_token,owner.profileId).state.allowed,true);
  });
  const metadataBefore=sessionMetadata();f.sql(sql);f.evidence.forwardMigration={file:forward,sha256:sha(bytes),executedSha256:sha(sql)};
  check('454 preserves function owner ACL stability and search path',()=>assert.deepEqual(sessionMetadata(),metadataBefore));
  check('verified-factor AAL1 is denied by actual REST pre-request, definer and Storage',()=>{
   assert.equal(f.http(3000,'/users?select=id','GET',undefined,weak.access_token).status,401);
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},weak.access_token).status,401);
   assert.equal(f.http(3000,'/rpc/check_account_login_session','POST',{},weak.access_token).status,401);
   assert.ok(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,weak.access_token).status>=400);
  });
  check('direct authenticated SQL RLS rejects AAL1 and returns only bounded MFA-required state',()=>{
   assert.deepEqual(sqlState(weak.access_token,owner.profileId),{state:{allowed:false,mfa_required:true},ownRows:0});
  });
  check('real verified AAL2 retains private REST definer and Storage access',()=>{
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},firstStrong.access_token).status,200);
   assert.equal(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,firstStrong.access_token).status,200);
   const result=sqlState(firstStrong.access_token,owner.profileId);assert.equal(result.state.allowed,true);assert.equal(result.ownRows,1);
  });
  check('no-factor AAL1 and public/service operations retain existing access',()=>{
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},control.token).status,200);
   assert.equal(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,control.token).status,200);
   assert.equal(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,f.serviceToken).status,200);
   assert.equal(f.http(5000,'/object/public/'+publicBucket+'/proof.json').status,200);
  });
  enroll(control.token,'Owned unverified factor');
  check('unverified-factor AAL1 remains allowed',()=>{
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},control.token).status,200);
   assert.equal(sqlState(control.token,control.profileId).state.allowed,true);
  });
  const badChallenge=challenge(weak.access_token,factor),validNow=codeFor(factor),wrongCode=String((Number(validNow)+1)%(10**factor.digits)).padStart(factor.digits,'0');secrets.add(wrongCode);
  const wrong=f.http(9999,'/factors/'+factor.id+'/verify','POST',{challenge_id:badChallenge.id,code:wrongCode},weak.access_token);
  check('invalid MFA code does not promote a pending AAL1 session',()=>{
   assert.ok(wrong.status>=400);assert.ok(!wrong.data?.access_token);
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},weak.access_token).status,401);
  });
  // Avoid a provider TOTP replay window without reusing a just-accepted code.
  const nextWindow=(factor.lastCounter+1)*factor.period*1000+100;
  if(Date.now()<nextWindow)await new Promise(resolve=>setTimeout(resolve,Math.min(nextWindow-Date.now(),factor.period*1000+100)));
  const pendingChallenge=challenge(weak.access_token,factor),elevated=verify(weak.access_token,factor,pendingChallenge.id,codeFor(factor));
  assert.ok(elevated.access_token);assert.equal(claims(elevated.access_token).aal,'aal2');
  const elevatedPerson={...owner,token:elevated.access_token};
  const elevatedId=f.rpc(elevatedPerson,'check_account_login_session').session_id;
  check('pending Auth challenge/verify still upgrades real AAL1 to usable AAL2',()=>{
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},elevated.access_token).status,200);
   assert.equal(f.http(5000,'/object/authenticated/'+privateBucket+'/proof.json','GET',undefined,elevated.access_token).status,200);
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},weak.access_token).status,401);
  });
  assert.equal(f.rpc({...owner,token:firstStrong.access_token},'revoke_account_login_session',{p_session_id:elevatedId,p_scope:'one'}),1);
  check('MFA cannot restore a revoked provider session and sibling AAL2 stays valid',()=>{
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},elevated.access_token).status,401);
   assert.deepEqual(sqlState(elevated.access_token,owner.profileId).state,{allowed:false});
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},firstStrong.access_token).status,200);
   assert.ok(f.http(9999,'/token?grant_type=refresh_token','POST',{refresh_token:elevated.refresh_token}).status>=400);
  });
  f.sql(`update public.users set status='suspended' where id=${literal(owner.profileId)}`);
  check('existing account-status/provider-session revocation remains ahead of MFA-required responses',()=>{
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},firstStrong.access_token).status,401);
   assert.deepEqual(sqlState(firstStrong.access_token,owner.profileId).state,{allowed:false});
   assert.equal(f.http(3000,'/rpc/current_public_user_id','POST',{},control.token).status,200);
  });
  check('all inherited453 and forward454 source bytes remain unchanged',()=>{
   for(const pin of inherited)assert.equal(sha(fs.readFileSync(path.join(migrations,pin.file))),pin.sha256);
   assert.equal(sha(fs.readFileSync(path.join(migrations,forward))),sha(bytes));
  });
  f.save('mfa-access-acceptance.json',{passed:true,baselineMigrations:453,targetMigrations:454,forward:f.evidence.forwardMigration,checks,checkCount:checks.length,skipped:0,
   actualAuthTotp:true,preFixOwnedAal1GapObserved:true,postFixAal1Denied:true,postFixAal2Allowed:true,pendingChallengeVerifyPreserved:true,
   noOrUnverifiedFactorAal1Preserved:true,revocationAndStatusPreserved:true,ownerAclUnchanged:true,inherited453Unchanged:true,
   factorSecretsCodesOrTokensPersisted:false,productionOperations:false,appGuardAndProxySeparateEvidenceRequired:true,physicalDeviceAcceptance:false});
 }catch(error){f.save('mfa-access-failure.json',{passed:false,checks,error:hide(error.stack)});throw Error(hide(error.stack));}
 finally{f.close();}
});
