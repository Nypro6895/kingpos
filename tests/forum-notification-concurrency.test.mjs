import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{PGlite}from'@electric-sql/pglite';
const id=n=>`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function definition(name){const s=fs.readFileSync('supabase/migrations/202610060001_unified_notification_feed.sql','utf8'),start=s.indexOf(`create or replace function public.${name}(`);assert(start>=0);return s.slice(start,s.indexOf('$$;',s.indexOf('as $$',start))+3);}
test('late-arriving Forum row reproduces cleanup gap; read gate closes feed/count/direct-RLS exposure while preserving other guards',{timeout:30000},async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table app_notifications(id uuid primary key,recipient_user_id uuid,recipient_kind text,notification_type text,booking_id uuid,salon_id uuid,forum_topic_id uuid,title text,body text,href text,event_key text,read_at timestamptz,created_at timestamptz default now());
 create table forum_topics(id uuid primary key,author_id uuid,deleted_at timestamptz);create table forum_replies(id uuid primary key,topic_id uuid,author_id uuid,deleted_at timestamptz);
 create table user_blocks(blocker_user_id uuid,blocked_user_id uuid);
 create table bookings(id uuid,salon_id uuid,staff_id uuid,status text,confirmation_status text,updated_at timestamptz,start_at timestamptz,salon_timezone_snapshot text,customer_id uuid);
 create table customers(id uuid,name text);
 create table staff(id uuid,salon_id uuid,is_active boolean,account_user_id uuid,user_id uuid);create table booking_lines(booking_id uuid,assigned_staff_id uuid,service_name_snapshot text,display_order integer);
 create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function social_users_blocked(a uuid,b uuid) returns boolean language sql stable security definer as $$select exists(select 1 from user_blocks where (blocker_user_id=a and blocked_user_id=b) or (blocker_user_id=b and blocked_user_id=a))$$;
 create function financial_notice_suppressed(n app_notifications) returns boolean language sql stable security definer as $$select n.notification_type='hidden_financial'$$;
 alter table app_notifications enable row level security;grant select on app_notifications to authenticated;
 create policy notifications_recipient_read on app_notifications for select to authenticated using(recipient_user_id=current_public_user_id());
 insert into forum_topics values('${id(10)}','${id(3)}',null);insert into forum_replies values('${id(11)}','${id(10)}','${id(2)}',null);`);
 let visible=definition('notification_visible_to_actor');visible=visible.replace('select n.recipient_user_id','select not public.financial_notice_suppressed(n) and n.recipient_user_id');await db.exec(visible);
 await db.exec('revoke all on function notification_visible_to_actor(app_notifications) from public,anon;grant execute on function notification_visible_to_actor(app_notifications) to authenticated;');
 for(const name of ['notification_feed','mark_all_center_notifications'])await db.exec(definition(name));
 // Deterministic post-commit state of the reported interleaving. PGlite is
 // single-session: this is NOT claimed as a two-session MVCC reproduction.
 await db.query('insert into user_blocks values($1,$2)',[id(1),id(2)]);
 assert.equal((await db.query("delete from app_notifications where notification_type='forum_reply' returning id")).rows.length,0);
 await db.exec(`insert into app_notifications(id,recipient_user_id,recipient_kind,notification_type,forum_topic_id,title,event_key) values
 ('${id(20)}','${id(1)}','owner_manager','forum_reply','${id(10)}','BLOCKED PREVIEW','forum-reply:${id(11)}'),
 ('${id(21)}','${id(3)}','owner_manager','forum_reply','${id(10)}','THIRD USER PREVIEW','forum-reply:${id(11)}'),
 ('${id(22)}','${id(1)}','customer','payment_receipt',null,'KEEP RECEIPT',null),
 ('${id(23)}','${id(1)}','customer','hidden_financial',null,'KEEP EXISTING SUPPRESSION',null);`);
 await db.query("select set_config('test.actor',$1,false)",[id(1)]);
 assert.equal((await db.query('select notification_visible_to_actor(n) visible from app_notifications n where id=$1',[id(20)])).rows[0].visible,true,'cleanup alone leaves this late row readable');
 await db.exec(fs.readFileSync('supabase/migrations/20261109223100_forum_notification_visibility.sql','utf8'));
 assert.equal((await db.query('select notification_visible_to_actor(n) visible from app_notifications n where id=$1',[id(20)])).rows[0].visible,false);
 assert.equal((await db.query('select count(*)::int n from app_notifications')).rows[0].n,4,'no reliance on deleting the raced row');
 await db.exec('set role authenticated');
 const feed=(await db.query("select notification_feed('owner_manager') data")).rows[0].data;
 assert(!JSON.stringify(feed).includes('BLOCKED PREVIEW'));assert(JSON.stringify(feed).includes('KEEP RECEIPT'));assert(!JSON.stringify(feed).includes('KEEP EXISTING SUPPRESSION'));
 assert.equal(feed.unreadCount,1,'badge count must exclude the raced row and keep prior financial suppression');
 assert.equal((await db.query("select mark_all_center_notifications('owner_manager') amount")).rows[0].amount,1);
 assert.equal((await db.query('select count(*)::int n from app_notifications where id=$1',[id(20)])).rows[0].n,0,'direct SELECT also fails closed');
 await assert.rejects(db.query('select forum_notification_blocked(null::app_notifications)'),/permission denied/i);
 await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[id(3)]);await db.exec('set role authenticated');
 assert.equal((await db.query('select count(*)::int n from app_notifications where id=$1',[id(21)])).rows[0].n,1,'third recipient remains unaffected');
 assert.equal((await db.query(`select notification_visible_to_actor(jsonb_populate_record(null::app_notifications,jsonb_build_object('id',$1::uuid,'recipient_user_id',$2::uuid,'recipient_kind','owner_manager','notification_type','forum_reply','forum_topic_id',$3::uuid,'event_key',$4::text))) visible`,[id(90),id(3),id(10),'forum-reply:'+id(11)])).rows[0].visible,false,'crafted composite input cannot probe private Forum records');
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261109223100_forum_notification_visibility.sql','utf8'));
 }finally{await db.close();}
});
