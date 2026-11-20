import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync('supabase/migrations/20261119200000_verified_account_sessions.sql','utf8');
const old=readFileSync('supabase/migrations/202608300001_account_login_security.sql','utf8').replaceAll('\r\n','\n');
const record=old.slice(old.indexOf('create or replace function public.record_account_login_session('),old.indexOf('create or replace function public.account_recovery_support_update_request('));
const uid='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
const a='20000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000002',c='20000000-0000-4000-8000-000000000003';
const legacy='30000000-0000-4000-8000-000000000001';
async function setup({ambiguous=false,hook=false}={}){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create role authenticator;
 create schema auth;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
 create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
 grant usage on schema auth to authenticated,anon,service_role;
 create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now(),user_agent text,not_after timestamptz);
 create table auth.refresh_tokens(id bigserial primary key,session_id uuid);
 create table users(id uuid primary key,auth_user_id uuid,status text default 'active',last_login_at timestamptz,updated_at timestamptz);
 create function current_public_user_id() returns uuid language sql stable security definer as $$select id from users where auth_user_id=auth.uid()$$;
 create table account_login_sessions(id uuid primary key,user_id uuid,auth_user_id uuid,device_label text default 'Unknown device',browser_name text,os_name text,device_type text default 'unknown',ip_address inet,city text,region text,country text,location_label text,user_agent text,trusted_at timestamptz,revoked_at timestamptz,revoked_by_user_id uuid,last_seen_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now());
 alter table account_login_sessions enable row level security;
 create policy self on account_login_sessions for all to authenticated using(user_id=current_public_user_id()) with check(user_id=current_public_user_id());
 grant select,insert,update,delete on account_login_sessions to authenticated;
 create table private_fixture_rows(id integer primary key);insert into private_fixture_rows values(1);
 alter table private_fixture_rows enable row level security;
 create policy existing_access on private_fixture_rows for select to authenticated,anon using(true);
 grant select on private_fixture_rows to authenticated,anon;
 create table account_security_preferences(user_id uuid primary key,login_alerts_enabled boolean default true);
 create table account_login_activity(user_id uuid,login_session_id uuid,activity_type text,device_label text,browser_name text,os_name text,device_type text,ip_address inet,city text,region text,country text,location_label text,user_agent text,metadata jsonb);
 create table app_notifications(recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text,read_at timestamptz,updated_at timestamptz);
 create unique index notification_event on app_notifications(recipient_user_id,event_key) where event_key is not null;
 create function account_login_security_safe_inet(p text) returns inet language sql as $$select nullif(p,'')::inet$$;
 insert into users(id,auth_user_id) values('${uid}','${uid}'),('${other}','${other}');
 insert into auth.sessions(id,user_id,user_agent) values('${a}','${uid}','Fixture A'),('${b}','${uid}','Fixture B'),('${c}','${other}','Fixture other');
 insert into auth.refresh_tokens(session_id) select id from auth.sessions;
 `);
 if(ambiguous) await db.exec(`insert into account_login_sessions(id,user_id,auth_user_id,revoked_at) values('${legacy}','${uid}','${uid}',now());`);
 if(hook) await db.exec(`create function public.existing_request_hook() returns void language plpgsql as $$begin if current_user<>'authenticated' then raise exception 'Hook caller privileges changed'; end if;perform set_config('fixture.previous_hook','ran',true);end$$;
 alter role authenticator set pgrst.db_pre_request='public.existing_request_hook';`);
 await db.exec(record);
 await db.exec(migration);
 return db;
}
async function as(db,user=uid,sid=b){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:user,session_id:sid})]);await db.exec('set role authenticated');}
async function state(db){return (await db.query('select public.check_account_login_session() state')).rows[0].state;}
async function recordSession(db,id=legacy){return db.query(`select record_account_login_session($1,'Fixture','Browser','OS','desktop',null,null,null,'Fixture location','Fixture agent',null)`,[id]);}

test('migration adopts live provider IDs without removing sessions; replay is idempotent',async()=>{
 const db=await setup();try{
  assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n,3);
  assert.equal((await db.query('select count(*)::int n from account_login_sessions where auth_session_id is not null')).rows[0].n,3);
  await db.exec(migration);
  assert.equal((await db.query('select count(*)::int n from account_login_sessions')).rows[0].n,3);
  await as(db);assert.deepEqual(await state(db),{allowed:true,session_id:b,registered:true});
 }finally{await db.close();}
});

test('ambiguous revoked legacy history requires only affected old sessions to reauthenticate',async()=>{
 const db=await setup({ambiguous:true});try{
  assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n,3);
  await as(db,uid,a);assert.deepEqual(await state(db),{allowed:false});
  assert.equal((await db.query('select * from private_fixture_rows')).rows.length,0,'direct RLS read must deny even without PostgREST');
  await as(db,other,c);assert.equal((await state(db)).allowed,true);
  await db.exec('reset role');const fresh='20000000-0000-4000-8000-000000000009';
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[fresh,uid]);
  await as(db,uid,fresh);await recordSession(db,'30000000-0000-4000-8000-000000000009');assert.equal((await state(db)).allowed,true);
  await db.exec('reset role');assert.ok((await db.query('select revoked_at from account_login_sessions where id=$1',[legacy])).rows[0].revoked_at);
 }finally{await db.close();}
});

test('selective revoke stops provider refresh, table/definer requests, and cannot be undone; sibling stays active',async()=>{
 const db=await setup();try{
  await as(db);assert.equal((await db.query('select revoke_account_login_session($1) n',[a])).rows[0].n,1);
  assert.equal((await state(db)).allowed,true);
  await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from auth.refresh_tokens where session_id=$1',[a])).rows[0].n,0);
  await as(db,uid,a);assert.deepEqual(await state(db),{allowed:false});
  await assert.rejects(db.query('select reylumi_request_guard()'),/Session expired/);
  await assert.rejects(recordSession(db),/Session expired/);
  await as(db);await assert.rejects(db.query('update account_login_sessions set revoked_at=null where id=$1',[a]),/permission denied/);
  assert.equal((await db.query('select * from private_fixture_rows')).rows.length,1);
  await assert.rejects(db.query('update account_login_sessions set auth_session_id=$1 where id=$2',[a,b]),/permission denied/);
  await assert.rejects(db.query('select revoke_account_login_session($1)',[c]),/cannot be identified/);
  await db.exec('reset role');await assert.rejects(db.query('update account_login_sessions set revoked_at=null where id=$1',[a]),/cannot be restored/);
  await db.exec('set role anon');assert.equal((await db.query('select * from private_fixture_rows')).rows.length,1,'existing anonymous policy stays in effect');
 }finally{await db.close();}
});

test('missing, forged, expired, and deleted provider session IDs never grant access',async()=>{
 const db=await setup();try{
  for(const sid of [null,'invalid','20000000-0000-4000-8000-000000000099',c]){
   await as(db,uid,sid);assert.deepEqual(await state(db),{allowed:false});
  }
  await db.exec('reset role');await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[b]);
  await as(db);assert.deepEqual(await state(db),{allowed:false});
 }finally{await db.close();}
});

test('others and all scopes preserve other accounts and prevent unbound new refresh sessions surviving logout',async()=>{
 const db=await setup();try{
  await as(db);await db.query("select revoke_account_login_session(null,'others')");assert.equal((await state(db)).allowed,true);
  await db.query("select revoke_account_login_session(null,'all')");assert.equal((await state(db)).allowed,false);
  await as(db,other,c);assert.equal((await state(db)).allowed,true);
 }finally{await db.close();}
});

test('existing PostgREST hook is chained under its original caller role',async()=>{
 const db=await setup({hook:true});try{
  await as(db);await db.exec('begin;select reylumi_request_guard();');
  assert.equal((await db.query("select current_setting('fixture.previous_hook') value")).rows[0].value,'ran');
  await db.exec('commit;reset role');
  const config=(await db.query('select previous_request_hook from reylumi_security.session_guard_configuration')).rows[0];
  assert.equal(config.previous_request_hook,'public.existing_request_hook');
 }finally{await db.close();}
});
