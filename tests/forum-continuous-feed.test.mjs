import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {ids,database,as,read,write,cooldown} from './helpers/forum-database.mjs';

test('forum follows, real avatars and unified notification delivery preserve authority',async t=>{
 const db=await database();let topic,section;
 try {
  await db.exec(`alter table users add column avatar_url text;
   create table app_notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid not null,recipient_kind text,notification_type text,title text,body text,href text,event_key text,read_at timestamptz,created_at timestamptz default now());
   create unique index app_notification_event on app_notifications(recipient_user_id,event_key) where event_key is not null;`);
  const prefs=fs.readFileSync('supabase/migrations/202610020003_notification_center.sql','utf8');
  await db.exec(prefs.slice(0,prefs.indexOf('create index if not exists notifications_scope_created_idx')));
  await db.exec(fs.readFileSync('supabase/migrations/20261103190000_forum_starter_discussions.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261104010000_forum_continuous_feed.sql','utf8'));
  await t.test('seed avatars use default; real accounts use their own uploaded photo; previews are bounded',async()=>{
   await as(db,ids.owner);const feed=await read(db,{mode:'feed'});section=feed[0].section_id;
   assert.equal(feed.length,15);assert(feed.every(x=>x.author_avatar===null&&x.body.length<=240));
   await db.exec(`reset role;update users set avatar_url='https://example.com/owner.webp' where id='${ids.owner}'`);await as(db,ids.owner);
   topic=(await write(db,{op:'topic',section,title:'Lunch breaks and turns',body:'Protect the lunch break without losing a turn.'})).id;
   const d=await read(db,{mode:'topic',id:topic});assert.equal(d.topic.author_avatar,'https://example.com/owner.webp');assert.equal(d.topic.following,true);
   assert((await read(db,{mode:'following'})).some(x=>x.id===topic));
   assert(!(await read(db,{mode:'feed',exclude_id:topic})).some(x=>x.id===topic));
  });
  await t.test('explicit follow, participation, opt-out and seen state are per account',async()=>{
   await as(db,ids.other);assert.equal((await read(db,{mode:'following'})).length,0);
   await write(db,{op:'follow',id:topic,enabled:true});assert.equal((await read(db,{mode:'following'})).length,1);
   await write(db,{op:'follow',id:topic,enabled:false});await write(db,{op:'reply',id:topic,body:'We keep the turn while someone eats.'});
   assert.equal((await read(db,{mode:'topic',id:topic})).topic.following,false,'reply does not undo an explicit opt-out');
   await write(db,{op:'seen',id:topic});assert.equal((await read(db,{mode:'topic',id:topic})).topic.following,false);
   await as(db,ids.owner);assert.equal((await read(db,{mode:'topic',id:topic})).topic.following,true);
  });
  await t.test('replies group into the existing shared app notification table and deep-link to the exact reply',async()=>{
   await as(db,ids.mod);await write(db,{op:'follow',id:topic,enabled:true});
   await as(db,ids.other);await cooldown(db);const last=await write(db,{op:'reply',id:topic,body:'Let the front desk know who is on lunch.'});
   await db.exec('reset role');let rows=(await db.query('select * from app_notifications where recipient_user_id=$1',[ids.owner])).rows;
   assert.equal(rows.length,1);assert(rows[0].href.endsWith('&reply='+last.id));assert.equal(rows[0].notification_type,'forum_reply');assert.equal(rows[0].forum_topic_id,topic);
   assert.equal((await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.other])).rows[0].n,0,'no self notification');
   await db.query('update app_notifications set read_at=now() where recipient_user_id=$1',[ids.owner]);
   await as(db,ids.other);await cooldown(db);await write(db,{op:'reply',id:topic,body:'This also helps the new techs.'});
   await db.exec('reset role');rows=(await db.query('select * from app_notifications where recipient_user_id=$1',[ids.owner])).rows;assert.equal(rows.length,2,'a new unread episode follows the read one');
   assert.equal((await db.query('select notification_category($1) category',['forum_reply'])).rows[0].category,'forum');
   assert.equal((await db.query('select notification_category($1) category',['booking_confirmed'])).rows[0].category,'booking');
  });
  await t.test('the real Settings preference suppresses only forum delivery',async()=>{
   await db.query(`insert into notification_preferences(user_id,category,enabled) values($1,'forum',false)`,[ids.owner]);
   const before=(await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.owner])).rows[0].n;
   await as(db,ids.other);await cooldown(db);await write(db,{op:'reply',id:topic,body:'Muted owners should not receive this update.'});
   await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.owner])).rows[0].n,before);
   await db.query(`insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,href) values($1,'owner_manager','staff_connection','Team update','/staff')`,[ids.owner]);
   assert.equal((await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.owner])).rows[0].n,before+1);
  });
  await t.test('deep links can locate a reply beyond the first page and do not repeat it on pagination',async()=>{
   await db.exec('reset role');await db.query(`insert into forum_replies(topic_id,author_id,body,created_at) select $1,$2,'Earlier reply '||i,now()-interval '1 hour'+i*interval '1 second' from generate_series(1,40) i`,[topic,ids.owner]);
   const target=(await db.query('select id from forum_replies where topic_id=$1 order by created_at desc,id desc limit 1',[topic])).rows[0].id;
   await as(db,ids.owner);const page=await read(db,{mode:'topic',id:topic,reply_id:target});assert(page.replies.some(r=>r.id===target));
   const last=page.replies.at(-1);const next=await read(db,{mode:'topic',id:topic,after:last.created_at,cursor_id:last.id});assert(!next.replies.some(r=>r.id===target));
  });
  await t.test('owners cannot read subscriptions directly and guests/staff cannot follow; inactive followers get no new updates',async()=>{
   await assert.rejects(db.query('select * from forum_subscriptions'),/permission denied/);
   await assert.rejects(db.query('select forum_is_following($1,$2)',[ids.other,topic]),/permission denied/);
   for(const actor of [null,ids.staff]){await as(db,actor);await assert.rejects(write(db,{op:'follow',id:topic,enabled:true}),/active account|salon owners/);}
   await db.exec(`reset role;update platform_admin_memberships set status='inactive' where user_id='${ids.mod}'`);
   const before=(await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.mod])).rows[0].n;
   await as(db,ids.other);await cooldown(db);await write(db,{op:'reply',id:topic,body:'The revoked moderator gets no further notifications.'});await db.exec('reset role');
   assert.equal((await db.query('select count(*)::int n from app_notifications where recipient_user_id=$1',[ids.mod])).rows[0].n,before);
  });
 } finally {await db.close();}
});
