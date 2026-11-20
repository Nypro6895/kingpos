import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),customer=id(2),outsider=id(3),salon=id(10),otherSalon=id(11),account=id(12),ticket=id(20),otherTicket=id(21),cust=id(30),request=id(50);
const read=p=>readFileSync(p,'utf8');
function original(name){const s=read('supabase/migrations/202608300003_customer_visit_experience_backend.sql');const start=s.indexOf(`create or replace function public.${name}(`);const end=s.indexOf('$$;',s.indexOf('as $$',start))+3;assert.ok(start>=0&&end>start);return s.slice(start,end);}
await db.exec(`create role anon; create role authenticated; create role service_role;
create table users(id uuid primary key,display_name text,first_name text,last_name text);
create table locations(id uuid primary key,account_id uuid,name text);
create table salon_settings(salon_id uuid primary key,business_name text,operating_timezone_iana text,visible boolean default true);
create table customers(id uuid primary key,location_id uuid,customer_user_id uuid);
create table pos_tickets(id uuid primary key,salon_id uuid,customer_id uuid,status text,opened_at timestamptz,closed_at timestamptz,source_booking_id uuid);
create table customer_visits(id uuid primary key,salon_id uuid,customer_id uuid,ticket_id uuid,appointment_id uuid,checked_in_at timestamptz default now());
create table pos_ticket_items(pos_ticket_id uuid,salon_id uuid,line_total numeric);
create table roles(id uuid primary key,code text);create table permissions(id uuid primary key,code text);create table role_permissions(role_id uuid,permission_id uuid);
create table salon_memberships(salon_id uuid,account_id uuid,user_id uuid,role_id uuid,status text);
create table account_memberships(account_id uuid,user_id uuid,role_id uuid,status text);
create table staff(salon_id uuid,account_user_id uuid,user_id uuid);
create table test_permissions(actor uuid,salon uuid);create table test_blocks(a uuid,b uuid);
create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function user_has_salon_permission(s uuid,p text[]) returns boolean language sql stable as $$select exists(select 1 from test_permissions where actor=current_public_user_id() and salon=s)$$;
create function social_users_blocked(a uuid,b uuid) returns boolean language sql stable as $$select exists(select 1 from test_blocks where (test_blocks.a=a and test_blocks.b=b) or (test_blocks.a=b and test_blocks.b=a))$$;
create function salon_profile_public_salon_exists(s uuid) returns boolean language sql stable as $$select coalesce((select visible from salon_settings where salon_id=s),false)$$;
create table customer_visit_experiences(id uuid primary key default gen_random_uuid(),salon_id uuid references locations(id),ticket_id uuid references pos_tickets(id),customer_id uuid,author_user_id uuid references users(id),feedback_state text,body text,issue_status text,counts_toward_reputation boolean,edited_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),unique(ticket_id,author_user_id));
create table salon_profile_reviews(id uuid primary key,salon_id uuid,author_user_id uuid,rating numeric,title text,body text,verification_status text,verified_booking_id uuid,moderation_status text,edited_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table salon_profile_review_replies(id uuid primary key,review_id uuid,author_user_id uuid,body text,created_at timestamptz default now(),moderation_status text);
create table app_notifications(id uuid primary key default gen_random_uuid(),account_id uuid,salon_id uuid,recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text);
create unique index notification_event on app_notifications(recipient_user_id,event_key) where event_key is not null;
insert into users values('${owner}','Owner',null,null),('${customer}','Customer',null,null),('${outsider}','Outsider',null,null);
insert into locations values('${salon}','${account}','QA Salon'),('${otherSalon}','${id(13)}','Other Salon');
insert into salon_settings values('${salon}','QA Salon','America/Chicago',true),('${otherSalon}','Other Salon','America/Chicago',false);
insert into customers values('${cust}','${salon}','${customer}');
insert into pos_tickets values('${ticket}','${salon}','${cust}','closed',now()-interval '1 day',now()-interval '1 day',null),('${otherTicket}','${otherSalon}','${cust}','closed',now(),now(),null);
insert into pos_ticket_items values('${ticket}','${salon}',40);
insert into roles values('${id(80)}','OWNER');insert into salon_memberships values('${salon}','${account}','${owner}','${id(80)}','active');
insert into test_permissions values('${owner}','${salon}');
`);
await db.exec(original('customer_visit_reputation_window_days'));
await db.exec(original('record_customer_visit_experience'));
await db.exec(original('customer_visit_verified_visit_payload'));
let projection=original('get_public_salon_profile_experiences');
projection=projection.replace('where experiences.salon_id = target_salon_id','where experiences.salon_id = target_salon_id and not public.social_users_blocked(public.current_public_user_id(), experiences.author_user_id)');
await db.exec(projection);
// The shipped blocking migration wraps the real projection in a private helper.
await db.exec('alter function public.get_public_salon_profile_experiences(uuid) rename to get_public_salon_profile_experiences_before_blocks; revoke all on function public.get_public_salon_profile_experiences_before_blocks(uuid) from public,anon,authenticated;');
await db.exec(original('get_public_salon_profile_experiences').replace(/as \$\$[\s\S]*\$\$;/,()=>`as $$ select r.* from public.get_public_salon_profile_experiences_before_blocks(target_salon_id) r where not public.social_users_blocked(public.current_public_user_id(),r.author_user_id) $$;`));
await db.exec(read('supabase/migrations/202610050001_lumi_trust_return_evidence.sql'));
await db.exec(read('supabase/migrations/20261030002000_visit_experience_replies.sql'));
async function actor(u,role='authenticated'){await db.exec(`reset role;select set_config('test.actor','${u??''}',false);set role ${role};`);}
async function scalar(sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
const mine=(focus=null)=>scalar('select get_my_visit_experiences(11,0,$1)',[focus]);
const truth=()=>db.query('select * from get_public_lumi_trust_signals($1)',[[salon]]).then(r=>r.rows[0]);
await db.exec(read('supabase/migrations/20261103061000_visit_feedback_final.sql'));
let experience;
test('one-shot issue, identical retry, changed retry and private list permissions',async()=>{
 await actor(customer);const result=await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'issue','Chipped the next day.']);
 assert.equal(result.ok,true);experience=result.experienceId;assert.ok(experience);
 assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'issue','Chipped the next day.'])).experienceId,experience);
 const changed=await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'good','Changed']);assert.equal(changed.ok,false);
 assert.equal((await mine())[0].body,'Chipped the next day.');
 await assert.rejects(db.query('update customer_visit_experiences set body=$1 where id=$2',['Bypass',experience]),/permission denied/);
 await assert.rejects(scalar('select record_customer_visit_experience_before_final($1,$2,$3)',[ticket,'good','Bypass']),/permission denied/);
 await assert.rejects(scalar('select get_my_visit_experiences_before_final(11,0,null)'),/permission denied/);
 await actor(outsider);assert.deepEqual(await mine(experience),[]);await assert.rejects(scalar('select resolve_my_visit_experience($1)',[experience]),/Issue not found/);
 await actor(null,'anon');await assert.rejects(mine(),/permission denied/);
 await db.exec('reset role');assert.equal(await scalar('select count(*)::int from customer_visit_experiences'),1);assert.equal(await scalar('select count(*)::int from app_notifications where recipient_user_id=$1',[owner]),1);
});
test('customer cannot resolve before a reply; salon reply is one-shot and customer is notified once',async()=>{
 await actor(customer);await assert.rejects(scalar('select resolve_my_visit_experience($1)',[experience]),/Read the salon reply/);
 await actor(owner);const args=[experience,salon,'Please call us to arrange a touch-up.',request];const reply=await scalar('select reply_to_visit_experience($1,$2,$3,$4)',args);
 assert.equal(await scalar('select reply_to_visit_experience($1,$2,$3,$4)',args),reply);
 await assert.rejects(scalar('select reply_to_visit_experience($1,$2,$3,$4)',[experience,salon,'Another response',id(51)]),/already exists/);
 await assert.rejects(scalar('select set_visit_experience_status($1,$2,$3)',[experience,salon,'resolved']),/Only the customer/);
 await assert.rejects(scalar('select resolve_my_visit_experience($1)',[experience]),/Issue not found/);
 await db.exec('reset role');assert.equal(await scalar("select count(*)::int from app_notifications where recipient_user_id=$1 and notification_type='visit_experience_reply'",[customer]),1);
});
test('customer confirms resolution once without changing sentiment, Truth or creating conversation',async()=>{
 await actor(customer);const before=await truth();await scalar('select resolve_my_visit_experience($1)',[experience]);await scalar('select resolve_my_visit_experience($1)',[experience]);
 const after=await truth();for(const k of ['issue_feedback_count','good_feedback_count','feedback_customer_count'])assert.equal(after[k],before[k]);
 const row=(await mine(experience))[0];assert.equal(row.feedback_state,'issue');assert.equal(row.issue_status,'resolved');assert.ok(row.customer_resolved_at);assert.ok(row.reply_body);
 await db.exec('reset role');assert.equal(await scalar("select count(*)::int from visit_experience_history where experience_id=$1 and issue_status='resolved'",[experience]),1);
});
test('Good feedback also notifies the salon and the second real visit is independent',async()=>{
 await db.exec(`reset role;insert into pos_tickets values('${id(22)}','${salon}','${cust}','closed',now(),now(),null);`);
 await actor(customer);const result=await scalar('select record_customer_visit_experience($1,$2,$3)',[id(22),'good','']);assert.equal(result.ok,true);assert.notEqual(result.experienceId,experience);
 await db.exec('reset role');assert.equal(await scalar("select count(*)::int from app_notifications where recipient_user_id=$1 and title='A customer shared a good experience'",[owner]),1);
 await actor(customer);await assert.rejects(scalar('select resolve_my_visit_experience($1)',[result.experienceId]),/Issue not found/);
});
test('split tickets attached to one visit share one experience and one exact target',async()=>{
 const booking=id(90),visit=id(91),first=id(23),second=id(24);
 await db.exec(`reset role;insert into pos_tickets values('${first}','${salon}','${cust}','closed',now(),now(),'${booking}'),('${second}','${salon}','${cust}','closed',now(),now(),'${booking}');insert into customer_visits(id,salon_id,customer_id,ticket_id,appointment_id)values('${visit}','${salon}','${cust}','${first}','${booking}');`);
 await actor(customer);const one=await scalar('select record_customer_visit_experience($1,$2,$3)',[first,'good','Nice visit']);const two=await scalar('select record_customer_visit_experience($1,$2,$3)',[second,'issue','Different view']);assert.equal(one.ok,true);assert.equal(two.ok,false);assert.equal(two.experienceId,one.experienceId);
 await db.exec('reset role');const payload=await scalar('select customer_visit_verified_visit_payload(t,c) from pos_tickets t join customers c on c.id=t.customer_id where t.id=$1',[second]);assert.equal(payload.experienceId,one.experienceId);assert.equal(payload.experienceState,'good');
});
test('malformed feedback, long details, wrong salon linkage and open tickets are rejected',async()=>{
 await actor(customer);for(const value of [null,'invalid'])assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,value,''])).ok,false);
 assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'good','x'.repeat(1001)])).ok,false);
 assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[otherTicket,'issue',''])).ok,false);
 await db.exec(`reset role;insert into pos_tickets values('${id(25)}','${salon}','${cust}','open',now(),null,null);`);await actor(customer);assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[id(25),'good',''])).ok,false);
});
test('existing data is immutable even for old function paths and blocked replies cannot resolve',async()=>{
 await db.exec('reset role');await assert.rejects(db.query('update customer_visit_experiences set feedback_state=$1 where id=$2',['good',experience]),/cannot be edited/);
 await db.exec(`insert into test_blocks values('${customer}','${owner}');`);await actor(customer);assert.equal((await mine(experience))[0].reply_body,null);
 await actor(owner);await assert.rejects(scalar('select reply_to_visit_experience($1,$2,$3,$4)',[experience,salon,'Blocked reply',id(52)]),/unavailable/);
});
test('canonical customer consolidation can remap records without changing feedback or Truth',async()=>{
 await db.exec(`reset role;delete from test_blocks;insert into customers values('${id(31)}','${salon}','${customer}');`);
 await actor(customer);const before=await truth();
 await db.exec('reset role');await db.query('update pos_tickets set customer_id=$1 where customer_id=$2',[id(31),cust]);
 await db.query('update customer_visits set customer_id=$1 where customer_id=$2',[id(31),cust]);
 await db.query('update customer_visit_experiences set customer_id=$1 where customer_id=$2',[id(31),cust]);
 await actor(customer);const after=await truth();for(const k of ['issue_feedback_count','good_feedback_count','feedback_customer_count'])assert.equal(after[k],before[k]);
 assert.equal((await mine(experience))[0].body,'Chipped the next day.');
 assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'issue','Chipped the next day.'])).experienceId,experience);
});
test.after(()=>db.close());
