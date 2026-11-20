import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('signup reservations and posting require one real verified Auth phone',async t=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema auth;
   create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
   create table public.users(id uuid primary key,auth_user_id uuid,phone text);
   create table customer_verified_phones(user_id uuid,normalized_phone text);
   create table beauty_posts(id uuid primary key,author_user_id uuid,caption text,visibility text default 'public');
   create table beauty_post_media(id uuid primary key,post_id uuid,object_path text,role text default 'image');
   create table salon_profile_looks(id uuid primary key,created_by_user_id uuid,title text,status text default 'draft',media_path text);
   create table salon_profile_updates(like salon_profile_looks including all);
   create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;`);
  const original=readFileSync('supabase/migrations/202608100003_customer_identity_claims.sql','utf8');
  await db.exec(original.slice(0,original.indexOf('create or replace function public.customer_claim_token_hash')));
  await db.exec(readFileSync('supabase/migrations/20261110193000_signup_phone_uniqueness.sql','utf8'));
  const available=async phone=>(await db.query('select signup_phone_available($1) available',[phone])).rows[0].available;
  const add=async(n,phone)=>db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id(n),phone?{signup_phone:phone}:{}]);
  const actor=async n=>db.query("select set_config('test.actor',$1,false)",[n?id(n):'']);
  await t.test('normalizes duplicates and reserves before OTP without trusting metadata',async()=>{
   assert.equal(await available('5035550100'),true);
   await add(1,'(503) 555-0100');
   await db.query('insert into public.users values($1,$1,null)',[id(1)]);
   assert.equal(await available('+15035550100'),false);
   await assert.rejects(add(2,'+15035550100'),/already used by another account/);
   assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,1);
   await db.query(`update auth.users set raw_user_meta_data='{"signup_phone_complete":true}' where id=$1`,[id(1)]);
   assert.equal(await available('5035550100'),false);
   await actor(1);
   await assert.rejects(db.query('insert into beauty_posts(id,author_user_id) values($1,$2)',[id(10),id(1)]),/Verify your phone/);
   assert.equal((await db.query('select account_has_verified_post_phone($1) ok',[id(1)])).rows[0].ok,false);
  });
  await t.test('Auth-confirmed phone permits posting across all post tables',async()=>{
   await db.query('update auth.users set phone=$1,phone_confirmed_at=now() where id=$2',['15035550100',id(1)]);
   await db.query('insert into beauty_posts(id,author_user_id,caption) values($1,$2,$3)',[id(10),id(1),'First post']);
   await db.query('insert into beauty_post_media(id,post_id,object_path) values($1,$2,$3)',[id(100),id(10),'old-image']);
   await db.query('insert into salon_profile_looks(id,created_by_user_id,title,status) values($1,$2,$3,$4)',[id(11),id(1),'Look','published']);
   await db.query('insert into salon_profile_updates(id,created_by_user_id,title,status) values($1,$2,$3,$4)',[id(12),id(1),'Update','published']);
   await add(2,null);await db.query('insert into public.users values($1,$1,null)',[id(2)]);
   await actor(2);
   await assert.rejects(db.query('insert into salon_profile_updates(id,created_by_user_id) values($1,$2)',[id(13),id(2)]),/Verify your phone/);
   await assert.rejects(db.query('update auth.users set phone=$1,phone_confirmed_at=now() where id=$2',['+15035550100',id(2)]),/already used by another account/);
  });
  await t.test('legacy numbers and QR claims block duplicate signup but QR is not OTP proof',async()=>{
   await db.query('insert into customer_verified_phones values($1,$2)',[id(2),'+15035550199']);
   assert.equal(await available('5035550199'),false);
   await assert.rejects(db.query('insert into beauty_posts(id,author_user_id) values($1,$2)',[id(14),id(2)]),/Verify your phone/);
   await db.query('update public.users set phone=$1 where id=$2',['5035550198',id(2)]);
   assert.equal(await available('5035550198'),false);
  });
  await t.test('service publication checks author; hiding existing posts remains possible',async()=>{
   await actor(null);
   await assert.rejects(db.query('insert into beauty_posts(id,author_user_id) values($1,$2)',[id(15),id(2)]),/Verify your phone/);
   await db.query('update auth.users set phone_confirmed_at=null where id=$1',[id(1)]);
   await assert.rejects(db.query('insert into beauty_post_media(id,post_id,object_path) values($1,$2,$3)',[id(101),id(10),'spam-image']),/Verify your phone/);
   await assert.rejects(db.query("update beauty_post_media set object_path='spam-image' where id=$1",[id(100)]),/Verify your phone/);
   await db.query("update beauty_posts set visibility='self' where id=$1",[id(10)]);
   await assert.rejects(db.query("update beauty_posts set visibility='public' where id=$1",[id(10)]),/Verify your phone/);
   await assert.rejects(db.query("update beauty_posts set caption='New spam' where id=$1",[id(10)]),/Verify your phone/);
  });
  await t.test('anonymous clients cannot enumerate account phone ownership',async()=>{
   await db.exec('set role anon');
   await assert.rejects(db.query('select signup_phone_available($1)',['5035550100']),/permission denied/);
   await assert.rejects(db.query('select * from account_signup_phones'),/permission denied/);
   await db.exec('reset role');
  });
 } finally {await db.close();}
});
