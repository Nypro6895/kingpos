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
create table pos_tickets(id uuid primary key,salon_id uuid,customer_id uuid,status text,opened_at timestamptz,closed_at timestamptz);
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
insert into pos_tickets values('${ticket}','${salon}','${cust}','closed',now()-interval '1 day',now()-interval '1 day'),('${otherTicket}','${otherSalon}','${cust}','closed',now(),now());
insert into pos_ticket_items values('${ticket}','${salon}',40);
insert into roles values('${id(80)}','OWNER');insert into salon_memberships values('${salon}','${account}','${owner}','${id(80)}','active');
insert into test_permissions values('${owner}','${salon}');
`);
await db.exec(original('customer_visit_reputation_window_days'));
await db.exec(original('record_customer_visit_experience'));
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
let experience;

test('Customer records a real issue; owner receives one scoped in-app notification',async()=>{
 await actor(customer);const saved=await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'issue','The finish chipped.']);assert.equal(saved.ok,true);
 await db.exec('reset role');experience=await scalar('select id from customer_visit_experiences where ticket_id=$1',[ticket]);
 assert.equal(await scalar('select count(*)::int from visit_experience_history'),1);assert.equal(await scalar('select count(*)::int from app_notifications where recipient_user_id=$1',[owner]),1);
 await actor(customer);assert.equal((await mine())[0].body,'The finish chipped.');assert.equal((await truth()).issue_feedback_count,1);
});
test('Wrong customer, mismatched salon and anonymous access cannot mutate or read another customer history',async()=>{
 await actor(outsider);assert.deepEqual(await mine(),[]);assert.deepEqual(await mine(experience),[]);assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'good','not mine'])).ok,false);
 await assert.rejects(scalar('select reply_to_visit_experience($1,$2,$3,$4)',[experience,salon,'Spoof',request]),/Not authorized/);
 await actor(customer);assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[otherTicket,'good','bad link'])).ok,false);
 await actor(null,'anon');await assert.rejects(mine(),/permission denied/);await assert.rejects(scalar('select reply_to_visit_experience($1,$2,$3,$4)',[experience,salon,'bad',request]),/permission denied/);
});
test('Owner is salon scoped; direct access to reply and audit tables stays denied',async()=>{
 await actor(owner);await assert.rejects(scalar('select reply_to_visit_experience($1,$2,$3,$4)',[experience,otherSalon,'Wrong salon',request]),/Not authorized/);
 await assert.rejects(db.query('select * from visit_experience_history'),/permission denied/);await assert.rejects(db.query('select * from visit_experience_replies'),/permission denied/);
 await assert.rejects(scalar('select set_visit_experience_status($1,$2,$3)',[experience,salon,'resolved']),/Reply to the customer/);
});
test('Reply retries are idempotent, acknowledgement and resolution never turn an issue into good',async()=>{
 await actor(owner);const args=[experience,salon,'Please contact us so we can make this right.',request];const response=await scalar('select reply_to_visit_experience($1,$2,$3,$4)',args);assert.equal(await scalar('select reply_to_visit_experience($1,$2,$3,$4)',args),response);
 await assert.rejects(scalar('select reply_to_visit_experience($1,$2,$3,$4)',[experience,salon,'Another reply',id(51)]),/already exists/);
 const publicRow=(await db.query('select * from get_public_salon_profile_experiences($1)',[salon])).rows[0];assert.equal(publicRow.reply_body,args[2]);assert.equal(publicRow.issue_status,'acknowledged');
 const before=await truth();await scalar('select set_visit_experience_status($1,$2,$3)',[experience,salon,'resolved']);const after=await truth();for(const k of ['issue_feedback_count','good_feedback_count','feedback_customer_count'])assert.equal(after[k],before[k]);assert.equal(after.issue_feedback_count,1);assert.equal(after.good_feedback_count,0);
 await actor(customer);const row=(await mine(experience))[0];assert.equal(row.feedback_state,'issue');assert.equal(row.issue_status,'resolved');assert.equal(row.reply_body,args[2]);
 await db.exec('reset role');assert.equal(await scalar('select count(*)::int from visit_experience_replies'),1);assert.equal(await scalar("select count(*)::int from app_notifications where notification_type='visit_experience_reply'"),2);
});
test('Customer edits preserve history, reject long details and retain independent-sample semantics',async()=>{
 await actor(customer);assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'issue','Updated concern.'])).ok,true);
 const before=await truth();assert.equal(before.feedback_customer_count,1);assert.equal(before.issue_feedback_count,1);
 assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'issue','x'.repeat(1001)])).ok,false);
 await db.exec('reset role');const history=(await db.query('select body from visit_experience_history where experience_id=$1 order by created_at,id',[experience])).rows;assert.ok(history.some(x=>x.body==='The finish chipped.'));assert.ok(history.some(x=>x.body==='Updated concern.'));
 await actor(customer);assert.equal((await mine())[0].body,'Updated concern.');
});
test('Customer alone changes sentiment; status controls cannot be used by customer and invalid statuses fail',async()=>{
 await actor(customer);await assert.rejects(scalar('select set_visit_experience_status($1,$2,$3)',[experience,salon,'resolved']),/Not authorized/);
 assert.equal((await scalar('select record_customer_visit_experience($1,$2,$3)',[ticket,'good','The salon helped.'])).ok,true);assert.equal((await truth()).good_feedback_count,1);
 await actor(owner);await assert.rejects(scalar('select set_visit_experience_status($1,$2,$3)',[experience,salon,'good']),/Invalid issue status/);
});
test('Privacy, blocks and old review replies remain enforced',async()=>{
 await db.exec(`reset role;insert into test_blocks values('${customer}','${owner}');`);await actor(customer);assert.equal((await mine())[0].reply_body,null);
 await actor(owner);assert.equal((await db.query('select * from get_public_salon_profile_experiences($1)',[salon])).rows.length,0);
 await assert.rejects(scalar('select reply_to_visit_experience($1,$2,$3,$4)',[experience,salon,'blocked',id(52)]),/unavailable/);
 await db.exec(`reset role;delete from test_blocks;update salon_settings set visible=false where salon_id='${salon}';`);await actor(customer);assert.equal((await mine())[0].salon_public,false);assert.equal((await db.query('select * from get_public_salon_profile_experiences($1)',[salon])).rows.length,0);
 await db.exec(`reset role;update salon_settings set visible=true;insert into salon_profile_reviews(id,salon_id,author_user_id,rating,body,verification_status,moderation_status) values('${id(70)}','${salon}','${customer}',4,'Legacy review','unverified','visible');insert into salon_profile_review_replies(id,review_id,author_user_id,body,moderation_status) values('${id(71)}','${id(70)}','${owner}','Legacy reply','visible');`);
 await actor(customer);assert.ok((await mine()).some(x=>x.source==='legacy_review'&&x.reply_body==='Legacy reply'));assert.ok((await db.query('select * from get_public_salon_profile_experiences($1)',[salon])).rows.some(x=>x.source==='legacy_review'&&x.reply_body==='Legacy reply'));
});
test.after(()=>db.close());
