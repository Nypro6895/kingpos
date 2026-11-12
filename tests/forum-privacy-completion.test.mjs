import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ids, database, as, read, write, cooldown } from './helpers/forum-database.mjs';

const migration = fs.readFileSync('supabase/migrations/20261109220000_forum_privacy_completion.sql','utf8');
const functionSource = (file, name) => {
  const source = fs.readFileSync(file,'utf8');
  const start = source.indexOf(`create function public.${name}(`);
  assert(start >= 0);
  const end = source.indexOf('$$;',source.indexOf('as $$',start)+5);
  return source.slice(start,end+3);
};
async function fixture(applyPrivacy = true) {
  const db = await database();
  await db.exec(`create role service_role;
    alter table users add column avatar_url text, add column deletion_scheduled_for timestamptz;
    create table app_notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text,read_at timestamptz,created_at timestamptz default now());
    create table user_blocks(blocker_user_id uuid,blocked_user_id uuid,primary key(blocker_user_id,blocked_user_id));
    alter table user_blocks enable row level security;revoke all on user_blocks from public,anon,authenticated;
    create table beauty_profiles(id uuid,user_id uuid);create table beauty_profile_follows(profile_id uuid,user_id uuid);
    create table salon_profile_comments(id uuid,author_user_id uuid);
    create table account_erasure_jobs(user_id uuid,status text);
    create table customer_verified_phones(user_id uuid);
    create table visit_experience_replies(id uuid primary key default gen_random_uuid(),author_user_id uuid,body text);
    create table visit_experience_history(actor_user_id uuid,body text);
    create function public.erase_account_personal_content(p_user_id uuid,p_auth_id uuid) returns void language plpgsql security definer set search_path=public as $$begin
      delete from customer_verified_phones where user_id=p_user_id;
    end $$;
    revoke all on function public.erase_account_personal_content(uuid,uuid) from public,anon,authenticated,service_role;`);
  const prefs=fs.readFileSync('supabase/migrations/202610020003_notification_center.sql','utf8');
  await db.exec(prefs.slice(0,prefs.indexOf('create index if not exists notifications_scope_created_idx')));
  for (const name of ['social_users_blocked','set_user_block']) {
    await db.exec(functionSource('supabase/migrations/202610140002_user_blocking.sql',name));
  }
  await db.exec('revoke all on function social_users_blocked(uuid,uuid) from public,anon,authenticated;revoke all on function set_user_block(uuid,boolean) from public,anon;grant execute on function set_user_block(uuid,boolean) to authenticated;');
  await db.exec(functionSource('supabase/migrations/202610140003_account_erasure.sql','is_account_erasure_write'));
  for (const name of ['20261103190000_forum_starter_discussions.sql','20261104010000_forum_continuous_feed.sql','20261104011000_today_forum_preview.sql'])
    await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8'));
  if (applyPrivacy) await db.exec(migration);
  return db;
}
const block = (db,user,enabled) => db.query('select set_user_block($1,$2)',[user,enabled]);
test('Forum blocks filter before pagination across feed, preview, deep links, replies and chat; existing authority remains',async()=>{
  const db=await fixture();
  try {
    await as(db,ids.owner);const section=(await read(db,{mode:'context'})).sections[0].id;
    const owned=(await write(db,{op:'topic',section,title:'Owner private test',body:'Owner text'})).id;
    await as(db,ids.other);const other=(await write(db,{op:'topic',section,title:'Other private test',body:'Other text'})).id;
    await write(db,{op:'reply',id:owned,body:'Other reply'});await write(db,{op:'chat',body:'Other message'});
    await db.exec('reset role');
    await db.query(`insert into forum_topics(author_id,section_id,title,body,created_at) select $1,$2,'Blocked newest topic '||n,'Blocked text',now()+n*interval '1 minute' from generate_series(1,28) n`,[ids.other,section]);
    await as(db,ids.owner);await write(db,{op:'follow',id:other,enabled:true});await write(db,{op:'bookmark',id:other,enabled:true});
    await block(db,ids.other,true);
    for(const mode of ['feed','saved','following','latest_preview']) assert(!(await read(db,{mode})).some(x=>x.id===other));
    assert((await read(db,{mode:'feed'})).some(x=>x.id===owned),'blocked rows must not consume the page limit');
    assert(!(await read(db,{mode:'topic',id:owned})).replies.some(x=>x.author_id===ids.other));
    assert(!(await read(db,{mode:'chat'})).some(x=>x.author_id===ids.other));
    await assert.rejects(read(db,{mode:'topic',id:other}),/not found/i);
    for(const op of ['reply','follow','bookmark','seen']) { await cooldown(db); await assert.rejects(write(db,{op,id:other,body:'not allowed',enabled:true}),/not found/i); }
    await as(db,ids.other);assert(!(await read(db,{mode:'feed'})).some(x=>x.id===owned));
    await cooldown(db);await assert.rejects(write(db,{op:'reply',id:owned,body:'not allowed'}),/not found/i);
    await db.exec('reset role');assert.equal((await db.query('select enabled from forum_subscriptions where user_id=$1 and topic_id=$2',[ids.owner,other])).rows[0].enabled,false);
    assert.equal((await db.query('select forum_is_following($1,$2) following',[ids.other,owned])).rows[0].following,false,'implicit participation follows must also be disabled');
    assert.equal((await db.query('select count(*)::int n from forum_bookmarks where user_id=$1',[ids.owner])).rows[0].n,1,'blocking hides saved content without destroying the saved record');
    await as(db,ids.mod);assert.equal((await read(db,{mode:'topic',id:owned})).topic.id,owned);
    await as(db,ids.owner);await block(db,ids.other,false);assert.equal((await read(db,{mode:'topic',id:other})).topic.id,other);
    await assert.rejects(db.query('select * from user_blocks'),/permission denied/i);
    for (const actor of [ids.staff,null]) { await as(db,actor); await assert.rejects(read(db,{mode:'feed'}),/owners|active account/i); }
    await db.exec('reset role');await db.exec(migration); // idempotent and ACL-preserving
    await as(db,ids.other);await assert.rejects(db.query('select erase_forum_personal_content($1)',[ids.owner]),/permission denied/i);
  } finally {await db.close();}
});
test('unexpected reader shape fails before changing helpers or granting access',async()=>{
 const db=await fixture(false);try {
  await db.exec(`create or replace function public.forum_read(p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path=public as $$begin return '{"changed":true}'::jsonb;end $$;`);
  await assert.rejects(db.exec(migration),/reader changed/i);await db.exec('rollback');
  assert.equal((await db.query("select to_regprocedure('public.erase_forum_personal_content(uuid)') function")).rows[0].function,null);
  assert.equal((await db.query('select forum_read() data')).rows[0].data.changed,true);
 }finally{await db.close();}
});
test('migration reconciles preexisting blocks without touching another user or deleting saved records',async()=>{
 const db=await fixture(false);try {
  await as(db,ids.owner);const section=(await read(db,{mode:'context'})).sections[0].id;
  const topic=(await write(db,{op:'topic',section,title:'Existing block topic',body:'Content'})).id;
  await as(db,ids.other);await write(db,{op:'bookmark',id:topic,enabled:true});await write(db,{op:'reply',id:topic,body:'Existing reply'});
  await db.exec('reset role');await db.query('insert into user_blocks values($1,$2)',[ids.owner,ids.other]);
  await db.exec(migration);
  assert.equal((await db.query('select forum_is_following($1,$2) following',[ids.other,topic])).rows[0].following,false);
  assert.equal((await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.owner])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from forum_bookmarks where user_id=$1',[ids.other])).rows[0].n,1);
 }finally{await db.close();}
});
test('Blocked Forum notifications are removed/suppressed without suppressing a third user',async()=>{
  const db=await fixture();try {
    await as(db,ids.owner);const section=(await read(db,{mode:'context'})).sections[0].id;
    const topic=(await write(db,{op:'topic',section,title:'Notification test',body:'Public text'})).id;
    await as(db,ids.mod);await write(db,{op:'follow',id:topic,enabled:true});
    await as(db,ids.other);await write(db,{op:'reply',id:topic,body:'First reply'});
    await as(db,ids.owner);await block(db,ids.other,true);
    await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.owner])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.mod])).rows[0].n,1);
    await as(db,ids.mod);await write(db,{op:'topic',section,title:'Third user topic',body:'Shared discussion'}).then(async x=>{
      await as(db,ids.owner);await write(db,{op:'follow',id:x.id,enabled:true});
      await as(db,ids.other);await cooldown(db);await write(db,{op:'reply',id:x.id,body:'Second reply'});
    });
    await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.owner])).rows[0].n,0);
  } finally {await db.close();}
});
test('Due erasure scrubs only the deleting author, keeps other replies and case skeletons, and refuses early/direct calls',async()=>{
  const db=await fixture();try {
    await as(db,ids.owner);const section=(await read(db,{mode:'context'})).sections[0].id;
    const topic=(await write(db,{op:'topic',section,title:'Personal topic title',body:'Personal body',state:'WI'})).id;
    await as(db,ids.other);const otherReply=(await write(db,{op:'reply',id:topic,body:'Keep the other author reply'})).id;
    const otherTopic=(await write(db,{op:'topic',section,title:'Other author topic',body:'Keep other topic'})).id;
    await as(db,ids.owner);await write(db,{op:'reply',id:otherTopic,body:'Erase this reply'});await write(db,{op:'chat',body:'Erase this chat'});
    await write(db,{op:'report',kind:'topic',id:otherTopic,reason:'Private report text'});
    await db.exec('reset role');
    await db.query(`insert into visit_experience_replies(author_user_id,body) values($1,'Erase reply'),($2,'Keep reply')`,[ids.owner,ids.other]);
    await db.query(`insert into visit_experience_history(actor_user_id,body) values($1,'Erase history'),($2,'Keep history')`,[ids.owner,ids.other]);
    await assert.rejects(db.query('select erase_forum_personal_content($1)',[ids.owner]),/Due account/);
    await db.query(`update users set status='pending_deletion',deletion_scheduled_for=now()+interval '1 day' where id=$1`,[ids.owner]);
    await db.query(`insert into account_erasure_jobs values($1,'pending')`,[ids.owner]);
    await db.query(`select set_config('reylumi.account_erasure_user',$1,false)`,[ids.owner]);
    await assert.rejects(db.query('select erase_forum_personal_content($1)',[ids.owner]),/Due account/);
    await db.query(`update users set deletion_scheduled_for=now()-interval '1 hour' where id=$1`,[ids.owner]);
    await db.query('select erase_account_personal_content($1,null)',[ids.owner]);
    const deleted=(await db.query('select * from forum_topics where id=$1',[topic])).rows[0];
    assert.equal(deleted.body,'[Deleted]');assert.equal(deleted.author_id,null);assert.equal(deleted.state,null);
    assert.equal((await db.query('select body from forum_replies where id=$1',[otherReply])).rows[0].body,'Keep the other author reply');
    assert.equal((await db.query('select body from forum_topics where id=$1',[otherTopic])).rows[0].body,'Keep other topic');
    assert.equal((await db.query('select reason,reporter_id from forum_reports')).rows[0].reason,'[Deleted]');
    assert.equal((await db.query('select body from visit_experience_replies where author_user_id=$1',[ids.owner])).rows[0].body,'[Deleted]');
    assert.equal((await db.query('select body from visit_experience_replies where author_user_id=$1',[ids.other])).rows[0].body,'Keep reply');
    await db.query('select erase_account_personal_content($1,null)',[ids.owner]); // idempotent retry
  }finally {await db.close();}
});
