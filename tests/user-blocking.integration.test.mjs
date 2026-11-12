import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',C='00000000-0000-4000-8000-000000000003';
test('blocking is private, bidirectional, reversible, and enforced in SQL/RPC interactions',async()=>{
 const db=new PGlite();
 const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
 const as=async(uid,role='authenticated')=>db.exec(`reset role;set test.uid='${uid}';set role ${role};`);
 try{
  await db.exec(`
   create role anon;create role authenticated;create role service_role;
   create table users(id uuid primary key,status text default 'active',display_name text);
   create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create table beauty_profiles(id uuid primary key,user_id uuid,visibility text default 'public');
   create table beauty_posts(id uuid primary key,author_user_id uuid,profile_id uuid);
   create table beauty_post_media(id uuid,post_id uuid);
   create table beauty_profile_follows(profile_id uuid,user_id uuid);
   create table salon_profile_looks(id uuid primary key,author_user_id uuid,salon_id uuid,status text default 'published');
   create table salon_profile_updates(like salon_profile_looks including all);
   create table salon_profile_reviews(id uuid,author_user_id uuid,salon_id uuid);
   create table salon_profile_review_replies(id uuid,review_id uuid,author_user_id uuid,body text,moderation_status text default 'visible');
   create table customer_visit_experiences(id uuid,salon_id uuid,author_user_id uuid);
   create table app_notifications(recipient_user_id uuid,event_key text);
   create table salon_profile_comments(id uuid primary key,salon_id uuid,look_id uuid,update_id uuid,beauty_post_id uuid,parent_comment_id uuid,root_comment_id uuid,reply_depth integer default 0,author_user_id uuid,author_display_name text,body text,is_salon_reply boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(),edited_at timestamptz,status text default 'published');
   create table account_post_saves(user_id uuid,source_type text,source_id uuid);
   create table salon_profile_look_saves(user_id uuid,look_id uuid);
   create function get_my_hidden_posts() returns table(source_type text,source_id uuid) language sql as $$select 'beauty_post'::text,'99999999-0000-4000-8000-000000000001'::uuid$$;
   create function get_public_beauty_profile(p_profile_id uuid) returns jsonb language sql as $$select jsonb_build_object('ok',true)$$;
   create function list_beauty_timeline(p_profile_id uuid,p_cursor_created_at timestamptz default null,p_cursor_post_id uuid default null,p_page_size integer default 12) returns jsonb language sql as $$select jsonb_build_object('ok',true,'items','[1]'::jsonb)$$;
   create function list_beauty_timeline_for_salon_customer(uuid,uuid,timestamptz,uuid,integer) returns jsonb language plpgsql as $$declare profile_row beauty_profiles%rowtype;actor_user_id uuid;begin if profile_row.id is null then return '{}';end if;return '{}';end$$;
   create function get_public_salon_profile_looks(target_salon_id uuid) returns setof salon_profile_looks language sql security definer as $$select * from salon_profile_looks$$;
   create function get_public_salon_profile_beauty_posts(target_salon_id uuid,p_limit integer default 6) returns table(post_id uuid) language sql security definer as $$select id from beauty_posts limit p_limit$$;
   create function get_public_salon_profile_reviews(target_salon_id uuid) returns table(author_user_id uuid,reply_body text) language sql security definer as $$
    select reviews.author_user_id,replies.body from salon_profile_reviews reviews left join lateral (
     select body from salon_profile_review_replies where review_id = reviews.id and moderation_status='visible' limit 1
    ) replies on true where reviews.salon_id=target_salon_id$$;
   create function get_public_salon_profile_experiences(target_salon_id uuid) returns table(author_user_id uuid,reply_body text) language sql security definer as $$
    select experiences.author_user_id,null::text from customer_visit_experiences experiences where experiences.salon_id = target_salon_id
    union all select reviews.author_user_id,replies.body from salon_profile_reviews reviews left join lateral (
     select review_replies.body from salon_profile_review_replies review_replies where review_replies.review_id = reviews.id and moderation_status='visible' limit 1
    ) replies on true where reviews.salon_id = target_salon_id$$;
   create function hydrate_explore_social_feed_items(p_actor_key text,p_cursor jsonb,p_keys text[]) returns jsonb language sql security definer as $$select jsonb_agg(jsonb_build_object('sourceType','beauty_post','contentId',id)) from beauty_posts$$;
   create function salon_profile_public_salon_exists(uuid) returns boolean language sql as $$select true$$;
   create function post_comment_target_is_public(uuid,uuid,uuid,uuid default null) returns boolean language sql as $$select true$$;
   create function beauty_public_post_exists(uuid) returns boolean language sql as $$select true$$;
   insert into users(id,display_name) values('${A}','A'),('${B}','B'),('${C}','C');
   insert into beauty_profiles(id,user_id) select id,id from users;
   insert into beauty_posts(id,author_user_id,profile_id) select id,id,id from users;
   insert into salon_profile_looks(id,author_user_id) values('${A}','${A}');
   insert into salon_profile_reviews values('${C}','${C}','${C}'),('${A}','${A}','${C}');
   insert into salon_profile_review_replies values('${A}','${C}','${A}','blocked reply','visible');
   insert into customer_visit_experiences values('${A}','${C}','${A}');
   insert into beauty_profile_follows values('${A}','${B}'),('${B}','${A}');
   insert into salon_profile_comments(id,author_user_id,beauty_post_id,body) values('${A}','${A}','${C}','root A'),('${B}','${B}','${C}','root B');
   insert into salon_profile_comments(id,author_user_id,beauty_post_id,parent_comment_id,root_comment_id,body) values('${C}','${C}','${C}','${A}','${A}','reply to A');
   grant usage on schema public to anon,authenticated,service_role;
   grant select,insert,update on all tables in schema public to authenticated;
   alter table beauty_posts enable row level security;create policy public_read on beauty_posts for select to authenticated using(true);
   alter table beauty_profiles enable row level security;create policy public_read on beauty_profiles for select to authenticated using(true);
   alter table salon_profile_comments enable row level security;create policy public_read on salon_profile_comments for select to authenticated using(true);
  `);
  await db.exec(fs.readFileSync('supabase/migrations/202610140002_user_blocking.sql','utf8'));
  await as(B);
  assert.equal((await one(`select count_public_post_comments('beauty_post',$1) n`,[C])).n,3);
  await db.query(`select post_user_block('beauty_post',$1,true)`,[A]);
  assert.equal((await one('select count(*)::int n from beauty_profile_follows')).n,0);
  assert.deepEqual((await db.query('select user_id,display_name from get_my_blocked_users()')).rows,[{user_id:A,display_name:'A'}]);
  assert.equal((await one(`select count(*)::int n from beauty_posts where id=$1`,[A])).n,0);
  assert.equal((await one(`select count(*)::int n from get_public_salon_profile_looks(null)`)).n,0);
  assert.deepEqual((await db.query('select * from get_public_salon_profile_experiences($1)',[C])).rows,[{author_user_id:C,reply_body:null}]);
  assert.deepEqual((await db.query('select * from get_public_salon_profile_reviews($1)',[C])).rows,[{author_user_id:C,reply_body:null}]);
  await assert.rejects(db.query('insert into salon_profile_review_replies values($1,$2,$3,$4,$5)',[B,A,B,'disallowed reply','visible']),/interaction is unavailable/);
  assert.equal((await one(`select get_public_beauty_profile($1) r`,[A])).r.ok,false);
  assert.equal((await one(`select list_beauty_timeline($1) r`,[A])).r.items.length,0);
  assert.equal((await one(`select count_public_post_comments('beauty_post',$1) n`,[C])).n,1);
  const comments=(await db.query(`select * from get_public_post_comments('beauty_post',$1,0,1)`,[C])).rows;
  assert.equal(comments.length,1);assert.equal(comments[0].id,B);assert.equal(comments[0].total_count,1);assert.equal(comments[0].root_count,1);
  assert.equal((await one(`select post_comment_target_is_public(null,null,$1) allowed`,[A])).allowed,false);
  await assert.rejects(db.query('select social_users_blocked($1,$2)',[A,C]),/permission denied/);
  await assert.rejects(db.query('select * from get_public_salon_profile_looks_before_blocks(null)'),/permission denied/);
  await assert.rejects(db.query('insert into user_blocks values($1,$2,now())',[A,C]),/permission denied/);
  await assert.rejects(db.query('insert into beauty_profile_follows values($1,$2)',[A,B]),/interaction is unavailable/);
  await as(A);
  assert.equal((await one(`select count(*)::int n from beauty_posts where id=$1`,[B])).n,0);
  assert.equal((await one(`select count(*)::int n from beauty_posts where id=$1`,[A])).n,1);
  await db.query('select set_user_block($1,false)',[B]); // cannot remove B's decision
  assert.equal((await one('select social_user_is_blocked($1) blocked',[B])).blocked,true);
  await as('', 'service_role');
  const feed=(await one('select hydrate_explore_social_feed_items($1,null,null) r',['user:'+B])).r;
  assert.deepEqual(feed.map(x=>x.contentId).sort(),[B,C]);
  await db.exec(`reset role;insert into beauty_posts values('00000000-0000-4000-8000-000000000009','${A}','${A}')`);
  await as(B);
  assert.ok((await db.query('select * from get_my_hidden_posts()')).rows.some(x=>x.source_id.endsWith('000009')));
  await assert.rejects(db.query('select set_user_block($1,true)',[B]),/Invalid block/);
  await db.query('select set_user_block($1,false)',[A]);
  assert.equal((await one(`select count(*)::int n from beauty_posts`)).n,4);
  assert.equal((await one(`select count_public_post_comments('beauty_post',$1) n`,[C])).n,3);
  assert.equal((await one(`select count(*)::int n from beauty_profile_follows`)).n,0); // no surprise re-follow
  await as('', 'anon');
  await assert.rejects(db.query('select set_user_block($1,true)',[A]),/permission denied/);
 }finally{await db.close();}
});
