import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const secret = "c".repeat(64), device = "a".repeat(64), ip = "b".repeat(64);
const uuid = (n, prefix = "00000000") => `${prefix}-0000-0000-0000-${String(n).padStart(12, "0")}`;
const hash = value => createHmac("sha256", secret).update(value).digest("hex");
async function setup() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema extensions; create extension pgcrypto with schema extensions;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{"provider":"email"}',raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz default now(),phone_confirmed_at timestamptz);
    create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('test.role',true),''),'authenticated')$$;
    create table users(id uuid primary key,auth_user_id uuid,created_at timestamptz default now()-interval '1 year',status text default 'active',email text,display_name text);
    create table storage.objects(bucket_id text,name text,metadata jsonb);
    create table platform_reports(id uuid primary key default gen_random_uuid(),category text,summary text,description text,source text,reporter_user_id uuid,subject_user_id uuid,priority text,status text,resolution text,resolved_by_user_id uuid,resolved_at timestamptz);
    create table locations(id uuid primary key,name text);
    create table salon_settings(salon_id uuid,public_profile_cover_path text);
    create table beauty_post_media(id uuid primary key default gen_random_uuid(),post_id uuid,object_path text);
    create table beauty_posts(id uuid primary key,profile_id uuid,author_user_id uuid,caption text,visibility text default 'public',moderation_status text default 'visible',deleted_at timestamptz);
    create table salon_profile_looks(id uuid primary key,salon_id uuid,author_user_id uuid,created_by_user_id uuid,title text,caption text,status text default 'published',media_path text,is_pinned boolean default false);
    create table salon_profile_updates(like salon_profile_looks including all);
    create table salon_profile_comments(id uuid primary key default gen_random_uuid(),author_user_id uuid,body text,status text default 'visible',look_id uuid,update_id uuid,beauty_post_id uuid,salon_id uuid,is_salon_reply boolean default false);
    alter table salon_profile_comments enable row level security;
    create policy public_read_visible_comments on salon_profile_comments for select to anon,authenticated using(status='visible');
    create policy own_update on salon_profile_comments for update to authenticated using(author_user_id=current_setting('test.uid')::uuid) with check(author_user_id=current_setting('test.uid')::uuid);
    grant usage on schema public to anon,authenticated;
    grant select,insert,update on salon_profile_comments to authenticated;
    create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function platform_admin_has_permission(text) returns boolean language sql stable as $$select coalesce(current_setting('test.admin',true),'')='yes' or $1=any(string_to_array(coalesce(current_setting('test.permissions',true),''),','))$$;
    create function user_can_manage_salon(uuid) returns boolean language sql stable as $$select false$$;
    create function user_has_salon_permission(uuid,text[]) returns boolean language sql stable as $$select false$$;
    create function post_comment_target_is_public(uuid,uuid,uuid,uuid) returns boolean language sql stable as $$select true$$;
    create function admin_set_user_access(uuid,text,boolean) returns jsonb language plpgsql as $$begin if not platform_admin_has_permission('admin.users.suspend') then raise exception 'Permission denied.'; end if; update users set status='suspended' where id=$1; return '{}'; end$$;
  `);
  for (let n = 1; n <= 10; n++) {
    await db.query(`insert into auth.users(id,email) values($1,$2)`, [uuid(n), `user${n}@example.test`]);
    await db.query(`insert into users(id,auth_user_id) values($1,$1)`, [uuid(n)]);
  }
  for (const file of ["202610070007_post_safety.sql", "202610070008_abuse_prevention.sql", "202610070009_report_persistence.sql", "202610070010_admin_post_review.sql", "202610070012_existing_guest_report_identity.sql", "202610070014_post_review_workspace.sql", "202610070015_review_search_reason_labels.sql", "202610070016_report_author_identity.sql"]) await db.exec(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query(`select configure_abuse_security($1,true,true)`, [secret]);
  await actor(db, 1);
  return db;
}
async function actor(db, n, customDevice = device) {
  const payload = `${customDevice}|${ip}|US|${Math.floor(Date.now() / 1000)}`;
  await db.query(`select set_config('test.uid',$1,false),set_config('request.headers',$2,false)`, [n ? uuid(n) : "", JSON.stringify({ "x-reylumi-safety": payload, "x-reylumi-safety-signature": hash(payload) })]);
}
async function post(db, n, caption = `Manicure ${n}`, author = 1) { await db.query(`insert into beauty_posts(id,author_user_id,caption) values($1,$2,$3)`, [uuid(n, "10000000"), uuid(author), caption]); }


async function deployed(){const db=await setup();await db.exec(fs.readFileSync('supabase/migrations/20261015190000_signup_admission_retries.sql','utf8'));await db.exec("create function public.is_account_erasure_write(uuid) returns boolean language sql stable as $$select coalesce(current_setting('test.erasure',true),'')='yes'$$");for(const def of Object.values(JSON.parse(fs.readFileSync('tests/fixtures/social-monitor-production-functions.json','utf8'))))await db.exec(def);return db;}
async function monitor(){const db=await deployed();await db.exec(fs.readFileSync('supabase/migrations/20261029021000_social_monitor_only.sql','utf8'));return db;}
test('volume, device/network auto flags and bot signals are advisory; manual controls remain',async()=>{
 const db=await monitor();try{
  await db.query("insert into abuse_restrictions(scope,identifier,mode,reason,source,expires_at) values('device',$1,'challenge','Bot flag','automatic',now()+interval '1 hour')",[device]);
  const pre=async(a='comment')=>(await db.query('select abuse_preflight($1,$2,$3,$4,$5) data',[a,uuid(1),device,ip,'US'])).rows[0].data;
  for(let n=0;n<125;n++) assert.equal((await pre()).allowed,true);
  for(let n=0;n<3;n++) assert.equal((await db.query('select record_abuse_bot_event($1,$2,$3,$4,$5) ok',['post',uuid(1),device,ip,'US'])).rows[0].ok,true);
  assert.equal((await db.query("select count(*)::int n from abuse_events where reason='Automated request detected'")).rows[0].n,1);
  for(let n=0;n<45;n++) await db.query('insert into salon_profile_comments(author_user_id,body) values($1,$2)',[uuid(1),'I love this beautiful nail design']);
  assert.equal((await db.query("select count(*)::int n from salon_profile_comments where status='visible'")).rows[0].n,45);
  assert.equal((await db.query("select count(*)::int n from abuse_events where details->>'monitorOnly'='true'")).rows[0].n>0,true);
  assert.equal((await db.query('select get_abuse_notice($1,$2,$3,$4) data',[uuid(1),device,ip,'US'])).rows[0].data.mode,undefined);
  await db.query("insert into abuse_restrictions(scope,identifier,mode,reason,expires_at) values('account',$1,'deny','Admin decision',now()+interval '1 hour')",[uuid(1)]);
  assert.equal((await pre()).allowed,false);
  await assert.rejects(db.query('insert into salon_profile_comments(author_user_id,body) values($1,$2)',[uuid(1),'Hello']),/temporarily restricted/);
 }finally{await db.close();}
});
test('keyword, duplicate text and repeated image signals do not silently hide new posts',async()=>{
 const db=await monitor();try{
  await db.exec("insert into post_safety_keywords(phrase,category) values('special offer','scam')");
  for(let n=1;n<=6;n++) await post(db,n,'A special offer for a beautiful manicure');
  assert.equal((await db.query("select count(*)::int n from beauty_posts where visibility='public' and not safety_hold")).rows[0].n,6);
  assert.equal((await db.query("select count(*)::int n from post_safety_cases where origin='automatic'")).rows[0].n>0,true);
  await db.query("insert into storage.objects values('beauty-profile-media','same-image','{\"eTag\":\"identical\"}')");
  for(let n=1;n<=3;n++){await actor(db,n);await db.query('insert into beauty_post_media(post_id,object_path) values($1,$2)',[uuid(n,'10000000'),'same-image']);}
  assert.equal((await db.query("select count(*)::int n from beauty_posts where visibility='public' and not safety_hold")).rows[0].n,6);
  assert.equal((await db.query("select count(*)::int n from abuse_events where reason='Repeated image'")).rows[0].n>0,true);
 }finally{await db.close();}
});
test('human challenge pass hides notice; manual review, suspension, signed context and auth safeguards survive',async()=>{
 const db=await monitor();try{
  await db.query("insert into abuse_restrictions(scope,identifier,mode,reason,expires_at) values('account',$1,'challenge','Admin requested verification',now()+interval '1 hour')",[uuid(1)]);
  const notice=async()=>(await db.query('select get_abuse_notice($1,$2,$3,$4) data',[uuid(1),device,ip,'US'])).rows[0].data;
  assert.equal((await notice()).mode,'challenge');
  await db.query("insert into abuse_verification_passes values($1,$2,now()+interval '15 minutes')",[device,ip]);
  assert.deepEqual(await notice(),{});
  await post(db,1);
  await db.exec("update abuse_restrictions set revoked_at=now()");
  await db.query("insert into abuse_restrictions(scope,identifier,mode,reason,expires_at) values('account',$1,'review','Admin requested review',now()+interval '1 hour')",[uuid(1)]);
  await post(db,2);
  assert.equal((await db.query('select safety_hold from beauty_posts where id=$1',[uuid(2,'10000000')])).rows[0].safety_hold,true);
  await db.exec("update abuse_restrictions set revoked_at=now();set request.headers='{}'");
  await assert.rejects(post(db,3),/Please use Reylumi/);
  await actor(db,1);await db.query("update users set status='suspended' where id=$1",[uuid(1)]);
  await assert.rejects(post(db,3),/Account is restricted/);
  await assert.rejects(db.exec("set role authenticated;select record_social_safety_signal('post',null,null,null,null,'Automated request detected')"),/permission denied/);
 }finally{await db.close();}
});

test('new-account post thresholds only notify admin; signup and login retries retain limits',async()=>{
 const db=await monitor();try{
  await db.query('update users set created_at=now() where id=$1',[uuid(1)]);
  for(let n=1;n<=15;n++)await post(db,n,'Manicure design '+n);
  assert.equal((await db.query("select count(*)::int n from beauty_posts where visibility='public' and not safety_hold")).rows[0].n,15);
  assert.equal((await db.query("select count(*)::int n from abuse_events where reason='Posting rate exceeded'")).rows[0].n,1);
  for(let n=0;n<30;n++)await db.query('select abuse_preflight($1,null,$2,$3,$4) data',['login',device,ip,'US']);
  const denied=(await db.query('select abuse_preflight($1,null,$2,$3,$4) data',['login',device,ip,'US'])).rows[0].data;
  assert.equal(denied.allowed,false);assert.equal(denied.code,'rate_limited');
 }finally{await db.close();}
});

test('production wrapper checks catalog baseline and records migration atomically',async()=>{
 const db=await deployed();try{
  await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])');
  await db.exec(fs.readFileSync('tests/fixtures/social-monitor-apply.sql','utf8'));
  assert.equal((await db.query("select count(*)::int n from supabase_migrations.schema_migrations where version='20261029021000'")).rows[0].n,1);
 }finally{await db.close();}
});
