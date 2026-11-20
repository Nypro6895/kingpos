import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup,uuid,hash} from './helpers/post-comment-identity-fixture.mjs';

const migration=fs.readFileSync('supabase/migrations/20261015200000_confirmed_social_identity.sql','utf8');
const contexts=new Map();
let contentId=1000;
async function register(db,n,{emailConfirmed=true,phoneConfirmed=false}={}) {
 const email=`identity-${n}@example.test`,device=hash(`identity-device:${n}`),ip=hash(`identity-ip:${n}`);
 contexts.set(n,{device,ip});
 const admission=(await db.query("select abuse_preflight('signup',null,$1,$2,'US',$3) data",[device,ip,hash(`email:${email}`)])).rows[0].data;
 assert.equal(admission.allowed,true);
 const token=(await db.query('select issue_abuse_signup_ticket($1,$2,$3) token',[hash(`email:${email}`),device,ip])).rows[0].token;
 await db.query('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at,phone_confirmed_at) values($1,$2,$3,$4,$5)',[uuid(n),email,{abuse_signup_ticket:token},emailConfirmed?new Date():null,phoneConfirmed?new Date():null]);
 await db.query('insert into users(id,auth_user_id,created_at) values($1,$1,now())',[uuid(n)]);
 await actor(db,n);
}
async function actor(db,n) {
 const {device,ip}=contexts.get(n),payload=`${device}|${ip}|US|${Math.floor(Date.now()/1000)}`;
 await db.query("select set_config('test.uid',$1,false),set_config('request.headers',$2,false)",[uuid(n),JSON.stringify({'x-reylumi-safety':payload,'x-reylumi-safety-signature':hash(payload)})]);
}
async function notice(db,n) {
 const {device,ip}=contexts.get(n);
 return (await db.query("select get_abuse_notice($1,$2,$3,'US') data",[uuid(n),device,ip])).rows[0].data;
}
async function post(db,n,caption=`A distinct manicure shared by customer ${contentId}`,id=++contentId) {
 await actor(db,n);
 await db.query('insert into beauty_posts(id,author_user_id,caption) values($1,$2,$3)',[uuid(id,'10000000'),uuid(n),caption]);
 return (await db.query('select id,visibility,safety_hold from beauty_posts where id=$1',[uuid(id,'10000000')])).rows[0];
}
async function comment(db,n,body=`Thank you ${contentId}`,id=++contentId) {
 await actor(db,n);await db.exec('set role authenticated');
 try {
  await db.query('insert into salon_profile_comments(id,author_user_id,body) values($1,$2,$3)',[uuid(id,'30000000'),uuid(n),body]);
  return (await db.query('select id,status from salon_profile_comments where id=$1',[uuid(id,'30000000')])).rows[0];
 } finally {await db.exec('reset role');}
}
const acl=async db=>(await db.query("select proname,proowner::regrole::text,proacl::text,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('abuse_guard_actor','abuse_track_identity','get_abuse_notice','abuse_preflight','abuse_guard_signup') order by proname")).rows;
const functionBodies=async db=>(await db.query("select proname,pg_get_functiondef(oid) as body from pg_proc where pronamespace='public'::regnamespace and proname in ('abuse_guard_actor','abuse_track_identity','get_abuse_notice','abuse_preflight','abuse_guard_signup') order by proname")).rows;

test('confirmed social identity migration preserves legitimate use and anti-abuse controls',async t=>{
 const db=await setup();
 try {
  let oldPost,oldComment,baselineAcl,policy;
  await t.test('reproduces the released false positive before upgrade',async()=>{
   await register(db,100);
   assert.equal((await notice(db,100)).mode,'review');
   oldPost=await post(db,100);oldComment=await comment(db,100);
   assert.equal(oldPost.visibility,'self');assert.equal(oldPost.safety_hold,true);assert.equal(oldComment.status,'reported');
   assert.equal(Number((await db.query('select count(*) n from abuse_restrictions')).rows[0].n),0);
   baselineAcl=await acl(db);policy=(await db.query('select policy from abuse_system_settings')).rows[0].policy;
  });
  await t.test('upgrades an existing confirmed identity without unbanning or publishing stored content',async()=>{
   const before=(await db.query('select * from abuse_identity_reviews order by auth_user_id')).rows;
   await db.exec(migration);
   assert.deepEqual((await db.query('select * from abuse_identity_reviews order by auth_user_id')).rows,before);
   assert.deepEqual(await notice(db,100),{});
   assert.equal((await post(db,100)).visibility,'public');assert.equal((await comment(db,100)).status,'visible');
   assert.equal((await db.query('select visibility from beauty_posts where id=$1',[oldPost.id])).rows[0].visibility,'self');
   assert.equal((await db.query('select status from salon_profile_comments where id=$1',[oldComment.id])).rows[0].status,'reported');
   assert.deepEqual(await acl(db),baselineAcl);assert.deepEqual((await db.query('select policy from abuse_system_settings')).rows[0].policy,policy);
  });
  await t.test('new confirmed signup can post and comment immediately with email delivery disabled or enabled',async()=>{
   for (const [n,ready] of [[101,false],[102,true]]) {
    await db.query('select configure_abuse_email_verification($1)',[ready]);await register(db,n);
    assert.deepEqual(await notice(db,n),{});assert.equal((await post(db,n)).visibility,'public');assert.equal((await comment(db,n)).status,'visible');
    assert.equal((await db.query('select verified_at is not null as verified from abuse_identity_reviews where auth_user_id=$1',[uuid(n)])).rows[0].verified,true);
   }
  });
  await t.test('phone confirmation is recognized on signup and subsequent Auth update',async()=>{
   await db.query('select configure_abuse_email_verification(false)');await register(db,103,{emailConfirmed:false,phoneConfirmed:true});
   assert.deepEqual(await notice(db,103),{});assert.equal((await post(db,103)).visibility,'public');assert.equal((await comment(db,103)).status,'visible');
   await register(db,104,{emailConfirmed:false});assert.equal((await notice(db,104)).mode,'review');
   await db.query('update auth.users set phone_confirmed_at=now() where id=$1',[uuid(104)]);
   assert.deepEqual(await notice(db,104),{});assert.equal((await post(db,104)).visibility,'public');
   assert.equal((await db.query('select verified_at is not null as verified from abuse_identity_reviews where auth_user_id=$1',[uuid(104)])).rows[0].verified,true);
  });
  await t.test('genuinely unconfirmed identity keeps existing verification and review behavior',async()=>{
   await db.query('select configure_abuse_email_verification(true)');await register(db,105,{emailConfirmed:false});
   await db.query(`update auth.users set raw_user_meta_data=raw_user_meta_data || '{"email_confirmed_at":"2026-01-01T00:00:00Z","phone_confirmed_at":"2026-01-01T00:00:00Z","verified":true}'::jsonb where id=$1`,[uuid(105)]);
   await assert.rejects(post(db,105),/Confirm your email/);await assert.rejects(comment(db,105),/Confirm your email/);
   await db.query('select configure_abuse_email_verification(false)');assert.equal((await post(db,105)).visibility,'self');assert.equal((await comment(db,105)).status,'reported');
   await db.query('update auth.users set email_confirmed_at=now() where id=$1',[uuid(105)]);
   assert.deepEqual(await notice(db,105),{});assert.equal((await post(db,105)).visibility,'public');assert.equal((await comment(db,105)).status,'visible');
  });
  await t.test('a failed content transaction and a valid retry do not exhaust the successful-content quota',async()=>{
   await register(db,106);await post(db,106,'Original content',6000);
   await assert.rejects(post(db,106,'A corrected retry',6000),/duplicate key/);
   assert.equal((await post(db,106,'A corrected retry',6001)).visibility,'public');
   await comment(db,106,'Thanks',6000);await assert.rejects(comment(db,106,'Thanks again',6000),/duplicate key/);
   assert.equal((await comment(db,106,'Thanks again',6001)).status,'visible');
   const counters=(await db.query("select action,sum(count)::int n from abuse_counters where scope='account' and identifier=$1 and action in ('post','comment') group by action order by action",[uuid(106)])).rows;
   assert.deepEqual(counters,[{action:'comment',n:2},{action:'post',n:2}]);
  });
  await t.test('bulk posts and comments still reach the existing limits',async()=>{
   await register(db,107);for(let n=0;n<3;n++)assert.equal((await post(db,107,`Individual portfolio content number ${n}`)).visibility,'public');
   await assert.rejects(post(db,107,'Fourth bulk post'),/posting limit/);
   await register(db,108);for(let n=0;n<10;n++)assert.equal((await comment(db,108,`Comment ${n}`)).status,'visible');
   await assert.rejects(comment(db,108,'Eleventh comment'),/posting limit/);
  });
  await t.test('repeated content remains held despite a confirmed account',async()=>{
   await register(db,109);const text='Book the identical promotional manicure today';
   assert.equal((await post(db,109,text)).visibility,'public');assert.equal((await post(db,109,text)).visibility,'public');
   const held=await post(db,109,text);assert.equal(held.visibility,'self');assert.equal(held.safety_hold,true);
  });
  await t.test('explicit deny and cooldown still block confirmed users across account device network and country',async()=>{
   let n=110;
   for(const scope of ['account','device','ip','country'])for(const mode of ['deny','cooldown']){
    await register(db,++n);const ctx=contexts.get(n),identifier=scope==='account'?uuid(n):scope==='country'?'US':ctx[scope];
    const id=(await db.query("insert into abuse_restrictions(scope,identifier,mode,reason,expires_at) values($1,$2,$3,'Actual fixture restriction',now()+interval '1 hour') returning id",[scope,identifier,mode])).rows[0].id;
    assert.equal((await notice(db,n)).mode,mode);await assert.rejects(post(db,n),/temporarily restricted/);await assert.rejects(comment(db,n),/temporarily restricted/);
    await db.query('update abuse_restrictions set revoked_at=now() where id=$1',[id]);
   }
  });
  await t.test('explicit review still holds content and challenge still requires a bound pass',async()=>{
   await register(db,120);
   await db.query("insert into abuse_restrictions(scope,identifier,mode,reason,expires_at) values('account',$1,'review','Explicit moderation review',now()+interval '1 hour')",[uuid(120)]);
   assert.equal((await notice(db,120)).mode,'review');assert.equal((await post(db,120)).visibility,'self');assert.equal((await comment(db,120)).status,'reported');
   await register(db,121);const ctx=contexts.get(121);
   await db.query("insert into abuse_restrictions(scope,identifier,mode,reason,expires_at) values('device',$1,'challenge','Risk-based challenge',now()+interval '1 hour')",[ctx.device]);
   await assert.rejects(post(db,121),/security check/);await assert.rejects(comment(db,121),/security check/);
   await db.query("insert into abuse_verification_passes values($1,$2,now()+interval '10 minutes')",[ctx.device,ctx.ip]);
   assert.equal((await post(db,121)).visibility,'public');assert.equal((await comment(db,121)).status,'visible');
  });
  await t.test('suspended deleted and pending-deletion accounts and unsigned requests stay blocked',async()=>{
   for(const [n,status] of [[122,'suspended'],[123,'deleted'],[124,'pending_deletion']]){
    await register(db,n);await db.query('update users set status=$1 where id=$2',[status,uuid(n)]);
    await assert.rejects(post(db,n),/Account is restricted/);await assert.rejects(comment(db,n),/Account is restricted/);
   }
   await register(db,125);await db.exec("set request.headers='{}'");
   await assert.rejects(db.query("insert into beauty_posts(id,author_user_id,caption) values($1,$2,'Unsigned')",[uuid(9000,'10000000'),uuid(125)]),/Please use Reylumi/);
  });
  await t.test('reapplying the migration preserves function ACLs policy and all restriction rows',async()=>{
   const bodies=await functionBodies(db),restrictions=(await db.query('select * from abuse_restrictions order by id')).rows;
   await db.exec(migration);assert.deepEqual(await functionBodies(db),bodies);assert.deepEqual(await acl(db),baselineAcl);
   assert.deepEqual((await db.query('select * from abuse_restrictions order by id')).rows,restrictions);assert.deepEqual((await db.query('select policy from abuse_system_settings')).rows[0].policy,policy);
   const grants=(await db.query("select has_function_privilege('anon','public.abuse_guard_actor(text)','execute') as anon_actor,has_function_privilege('authenticated','public.get_abuse_notice(uuid,text,text,text)','execute') as auth_notice")).rows[0];
   assert.deepEqual(grants,{anon_actor:false,auth_notice:false});
  });
 } finally {await db.close();}
});

test('unknown function shape aborts the migration without partial access changes',async()=>{
 const db=await setup();
 try {
  await db.exec("create or replace function public.get_abuse_notice(p_user_id uuid,p_device text,p_ip text,p_country text) returns jsonb language sql stable security definer set search_path=public as $$select '{}'::jsonb$$");
  const before=await functionBodies(db),privileges=await acl(db);
  await assert.rejects(db.exec(migration),/Unexpected get_abuse_notice/);
  await db.exec('rollback');
  assert.deepEqual(await functionBodies(db),before);assert.deepEqual(await acl(db),privileges);
 } finally {await db.close();}
});
