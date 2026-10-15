import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { setup, actor, post, secret, device, ip, uuid, hash } from "./fixtures/abuse-prevention-db.mjs";

test("signed requests, verified identities, atomic quotas and admin access", async () => {
  const db = await setup();
  try {
    await db.exec(`set request.headers='{}'`);
    await assert.rejects(post(db, 1), /Please use Reylumi/);
    await actor(db, 1);
    await db.query(`update auth.users set email_confirmed_at=null where id=$1`, [uuid(1)]);
    await assert.rejects(post(db, 1), /Confirm your email/);
    await db.query(`update auth.users set email_confirmed_at=now() where id=$1;`, [uuid(1)]);
    await db.query(`update users set created_at=now() where id=$1`, [uuid(1)]);
    const attempts = await Promise.allSettled([1, 2, 3, 4, 5].map(n => post(db, n)));
    assert.equal(attempts.filter(x => x.status === "fulfilled").length, 3);
    await assert.rejects(db.query(`select admin_abuse_restriction('account',$1,'deny',24,'Repeated spam')`, [uuid(2)]), /Permission denied/);
    await db.exec(`set test.permissions='admin.reports.read'`);
    const dashboard = (await db.query(`select get_admin_abuse_dashboard() data`)).rows[0].data;
    assert.ok(!JSON.stringify(dashboard).includes(secret));
    await assert.rejects(db.query(`select admin_abuse_policy('{"post_hour":5}','Adjust quota')`), /Permission denied/);
    await db.exec(`set test.admin='yes'`);
    await assert.rejects(db.query(`select admin_abuse_restriction('account',$1,'deny',24,'Repeated spam')`, [uuid(1)]), /own account/);
    await assert.rejects(db.query(`select admin_abuse_restriction('country','US','deny',721,'Repeated spam')`), /Invalid restriction/);
    await db.query(`select admin_abuse_policy('{"post_hour":5}','Adjust quota')`);
    assert.equal((await db.query(`select count(*)::int n from abuse_audit`)).rows[0].n, 1);
  } finally { await db.close(); }
});

test("duplicate text and images are held across accounts; review cannot be bypassed", async () => {
  const db = await setup();
  try {
    for (let n = 1; n <= 3; n++) { await actor(db, n); await post(db, n, "Book this beautiful manicure today", n); }
    assert.equal((await db.query(`select visibility from beauty_posts where id=$1`, [uuid(3, "10000000")])).rows[0].visibility, "self");
    await db.query(`update beauty_posts set visibility='public',safety_hold=false where id=$1`, [uuid(3, "10000000")]);
    assert.equal((await db.query(`select safety_hold from beauty_posts where id=$1`, [uuid(3, "10000000")])).rows[0].safety_hold, true);
    await db.exec(`set test.admin='yes'`);
    const pending = (await db.query(`select id from post_safety_cases where source_id=$1`, [uuid(3, "10000000")])).rows[0].id;
    await db.query(`select admin_review_post_safety($1,'allow','Legitimate salon content')`, [pending]);
    assert.equal((await db.query(`select visibility from beauty_posts where id=$1`, [uuid(3, "10000000")])).rows[0].visibility, "public");
    await db.exec(`set test.admin='no'`);
    await db.exec(`insert into storage.objects values('beauty-profile-media','same.webp','{"eTag":"same-image-hash"}')`);
    for (let n = 4; n <= 6; n++) { await actor(db, n); await post(db, n, `Independent caption ${n}`, n); await db.query(`insert into beauty_post_media(post_id,object_path) values($1,'same.webp')`, [uuid(n, "10000000")]); }
    assert.equal((await db.query(`select visibility from beauty_posts where id=$1`, [uuid(6, "10000000")])).rows[0].visibility, "self");
    assert.equal((await db.query(`select reason from post_safety_cases where source_id=$1`, [uuid(6, "10000000")])).rows[0].reason, "Repeated image");
  } finally { await db.close(); }
});

test("signup admission, CAPTCHA expiry, binding and replay protection", async () => {
  const db = await setup();
  try {
    const preflight = () => db.query(`select abuse_preflight('signup',null,$1,$2,'US',$3) result`, [device, ip, hash("email:new@example.test")]);
    assert.equal((await preflight()).rows[0].result.allowed, true);
    assert.equal((await preflight()).rows[0].result.challengeRequired, true);
    const challenge = uuid(1, "20000000");
    await db.query(`select create_abuse_challenge($1,$2,$3,'answerhash')`, [challenge, device, ip]);
    const verify = (d, i, answer) => db.query(`select verify_abuse_challenge($1,$2,$3,$4) ok`, [challenge, d, i, answer]);
    assert.equal((await verify("d".repeat(64), ip, "answerhash")).rows[0].ok, false);
    assert.equal((await verify(device, ip, "wrong")).rows[0].ok, false);
    assert.equal((await verify(device, ip, "answerhash")).rows[0].ok, true);
    assert.equal((await verify(device, ip, "answerhash")).rows[0].ok, false);
    assert.equal((await preflight()).rows[0].result.allowed, true);
    await assert.rejects(db.query(`insert into auth.users(id,email) values($1,'new@example.test')`, [uuid(20)]), /signup page/);
    const ticket = (await db.query(`select issue_abuse_signup_ticket($1,$2,$3) token`, [hash("email:new@example.test"), device, ip])).rows[0].token;
    await assert.rejects(db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'other@example.test',$2)`, [uuid(20), { abuse_signup_ticket: ticket }]), /signup page/);
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'new@example.test',$2)`, [uuid(20), { abuse_signup_ticket: ticket }]);
    await assert.rejects(db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'new@example.test',$2)`, [uuid(21), { abuse_signup_ticket: ticket }]), /signup page/);
    const expired = uuid(2, "20000000");
    await db.query(`select create_abuse_challenge($1,$2,$3,'answerhash')`, [expired, device, ip]);
    await db.query(`update abuse_challenges set expires_at=now()-interval '1 minute' where id=$1`, [expired]);
    assert.equal((await db.query(`select verify_abuse_challenge($1,$2,$3,'answerhash') ok`, [expired, device, ip])).rows[0].ok, false);
  } finally { await db.close(); }
});

test("network restrictions cover new identities and expire; reported comments obey RLS", async () => {
  const db = await setup();
  try {
    await db.exec(`set test.admin='yes'`);
    const restriction = (await db.query(`select admin_abuse_restriction('ip',$1,'cooldown',1,'Network sends spam') id`, [ip])).rows[0].id;
    await db.exec(`set test.admin='no'`);
    await actor(db, 2, "d".repeat(64));
    await assert.rejects(post(db, 1, "Manicure", 2), /restricted/);
    await db.query(`update abuse_restrictions set expires_at=now()-interval '1 minute' where id=$1`, [restriction]);
    await post(db, 1, "Manicure", 2);
    await db.exec(`set role authenticated`);
    await db.query(`insert into salon_profile_comments(id,author_user_id,body) values($1,$2,'sexual content')`, [uuid(1, "30000000"), uuid(2)]);
    assert.equal((await db.query(`select status from salon_profile_comments`)).rows[0].status, "reported");
    await db.exec(`update salon_profile_comments set status='visible'`);
    assert.equal((await db.query(`select status from salon_profile_comments`)).rows[0].status, "reported");
    await actor(db, 3);
    assert.equal((await db.query(`select count(*)::int n from salon_profile_comments`)).rows[0].n, 0);
    await db.exec(`reset role; set test.admin='yes'`);
    const event = (await db.query(`select id from abuse_events where source_type='comment'`)).rows[0].id;
    await db.query(`select admin_review_spam_comment($1,true,'Safe discussion context')`, [event]);
    await db.exec(`set test.admin='no'; set role authenticated`);
    assert.equal((await db.query(`select status from salon_profile_comments`)).rows[0].status, "visible");
  } finally { await db.close(); }
});

test("fresh identities stay private without email delivery; explicit review releases future content", async () => {
 const db=await setup();
 try {
  const email="identity@example.test";
  const ticket=(await db.query(`select issue_abuse_signup_ticket($1,$2,$3) token`,[hash(`email:${email}`),device,ip])).rows[0].token;
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)`,[uuid(20),email,{abuse_signup_ticket:ticket}]);
  await db.query(`insert into users(id,auth_user_id,created_at) values($1,$1,now())`,[uuid(20)]);
  await actor(db,20);
  await post(db,20,"First legitimate manicure",20);
  assert.equal((await db.query(`select visibility from beauty_posts`)).rows[0].visibility,"self");
  assert.equal((await db.query(`select get_abuse_notice($1,$2,$3,'US') data`,[uuid(20),device,ip])).rows[0].data.mode,"review");
  await assert.rejects(db.query(`select admin_approve_abuse_identity($1,'Verified identity')`,[uuid(20)]),/Permission denied/);
  await actor(db,1);await db.exec(`set test.admin='yes'`);
  await db.query(`select admin_approve_abuse_identity($1,'Verified business ownership')`,[uuid(20)]);
  await db.exec(`set test.admin='no'`);await actor(db,20);
  await post(db,21,"Another different manicure",20);
  assert.equal((await db.query(`select visibility from beauty_posts where id=$1`,[uuid(21,"10000000")])).rows[0].visibility,"public");
  assert.equal((await db.query(`select visibility from beauty_posts where id=$1`,[uuid(20,"10000000")])).rows[0].visibility,"self");
 } finally {await db.close();}
});


test("all report reasons reach admin and hiding persists for each account or guest", async () => {
 const db = await setup();
 try {
  await post(db, 1, "A legitimate manicure");
  const id = uuid(1, "10000000");
  await actor(db, 2);
  await db.query(`select post_safety_action('beauty_post',$1,'report','{"reason":"unwanted"}')`, [id]);
  assert.equal((await db.query(`select count(*) n from platform_reports`)).rows[0].n, 1);
  assert.equal((await db.query(`select * from get_my_hidden_posts()`)).rows.length, 1);
  await actor(db, 3);
  assert.equal((await db.query(`select * from get_my_hidden_posts()`)).rows.length, 0);
  await actor(db, null);
  await db.query(`select post_safety_action('beauty_post',$1,'report','{"reason":"harassment"}')`, [id]);
  assert.equal((await db.query(`select * from get_my_hidden_posts()`)).rows.length, 1);
  await actor(db, null, "d".repeat(64));
  assert.equal((await db.query(`select * from get_my_hidden_posts()`)).rows.length, 0);
  await db.query(`select post_safety_action('beauty_post',$1,'report','{"reason":"unwanted"}')`, [id]);
  assert.equal((await db.query(`select * from get_my_hidden_posts()`)).rows.length, 1);
  await actor(db, null, "e".repeat(64));
  assert.equal((await db.query(`select * from get_my_hidden_posts()`)).rows.length, 0);
  await db.exec(`set request.headers='{}'`);
  assert.equal((await db.query(`select * from get_my_hidden_posts()`)).rows.length, 0);
  await actor(db, 1); await db.exec(`set test.admin='yes'`);
  const queue = (await db.query(`select get_post_safety_queue('user') data`)).rows[0].data;
  assert.equal(queue.length, 3);
  assert.equal(queue.filter(c => c.reason === "unwanted").length, 2);
  assert.ok(queue.every(c => c.platform_report_id));
  assert.equal((await db.query(`select visibility from beauty_posts where id=$1`, [id])).rows[0].visibility, "public");
 } finally { await db.close(); }
});


test("admin quick decisions preserve reporter-only hiding and enforce account permissions", async () => {
 const db = await setup();
 try {
  await post(db, 1, "A legitimate manicure"); const id=uuid(1,"10000000");
  await actor(db,2); await db.query(`select post_safety_action('beauty_post',$1,'report','{"reason":"unwanted"}')`,[id]);
  let caseId=(await db.query(`select id from post_safety_cases where reporter_user_id=$1`,[uuid(2)])).rows[0].id;
  await assert.rejects(db.query(`select admin_review_post_safety($1,'keep_public','Reviewed safe content')`,[caseId]),/Permission denied/);
  await actor(db,1);await db.exec(`set test.permissions='admin.reports.read,admin.reports.update'`);
  const preview=(await db.query(`select get_admin_post_safety_cases('user') data`)).rows[0].data[0];
  assert.equal(preview.current_post.caption,"A legitimate manicure");
  assert.equal(preview.reporter_user_id,uuid(2));
  assert.ok(!('reporter_device_hash' in preview)); assert.ok(!('guest_key' in preview));
  await assert.rejects(db.query(`select admin_review_post_safety($1,'suspend_reporter','Repeated abusive reports')`,[caseId]),/Permission denied/);
  await db.query(`delete from post_safety_hidden where user_id=$1`,[uuid(2)]);
  await db.query(`select admin_review_post_safety($1,'keep_public','Reviewed safe content')`,[caseId]);
  assert.equal((await db.query(`select visibility from beauty_posts where id=$1`,[id])).rows[0].visibility,"public");
  assert.equal((await db.query(`select status from platform_reports`)).rows[0].status,"resolved");
  await actor(db,2);assert.equal((await db.query(`select * from get_my_hidden_posts()`)).rows.length,1);
  await actor(db,3);assert.equal((await db.query(`select * from get_my_hidden_posts()`)).rows.length,0);
  await actor(db,null);await db.query(`select post_safety_action('beauty_post',$1,'report','{"reason":"unwanted"}')`,[id]);
  caseId=(await db.query(`select id from post_safety_cases where reporter_user_id is null`)).rows[0].id;
  await actor(db,1);await db.exec(`set test.admin='yes'`);
  await db.query(`update post_safety_cases set reporter_device_hash=null where id=$1`,[caseId]);
  await db.exec(fs.readFileSync('supabase/migrations/202610070012_existing_guest_report_identity.sql','utf8'));
  const guestPreview=(await db.query(`select get_admin_post_safety_cases('user') data`)).rows[0].data[0];assert.equal(guestPreview.can_restrict_guest,true);
  await db.query(`select admin_review_post_safety($1,'suspend_reporter','Abusive reports from guest device')`,[caseId]);
  assert.equal((await db.query(`select mode from abuse_restrictions where scope='device'`)).rows[0].mode,"deny");
  await db.query(`select admin_review_post_safety($1,'delete','Reviewed violating post')`,[caseId]);
  assert.ok((await db.query(`select deleted_at from beauty_posts where id=$1`,[id])).rows[0].deleted_at);
  await assert.rejects(db.query(`select admin_review_post_safety($1,'delete','Duplicate decision')`,[caseId]),/no longer pending/);
 } finally {await db.close();}
});

test("review workspace reports actual visibility, restrictions, related cases and audited decisions", async()=>{
 const db=await setup();
 try{
  await post(db,1,"A legitimate manicure");const id=uuid(1,"10000000");
  await actor(db,2);await db.query(`select post_safety_action('beauty_post',$1,'report','{"reason":"unwanted"}')`,[id]);
  await actor(db,null);await db.query(`select post_safety_action('beauty_post',$1,'report','{"reason":"harassment"}')`,[id]);
  await assert.rejects(db.query(`select get_admin_post_review_workspace('user')`),/Permission denied/);
  await actor(db,1);await db.exec(`set test.admin='yes'`);
  const read=async(origin="user",caseId=null,status="pending")=>(await db.query(`select get_admin_post_review_workspace($1,$2,null,0,'',null,null,$3) data`,[origin,caseId,status])).rows[0].data;
  let data=await read();assert.equal(data.user_count,2);assert.equal(data.total_count,2);
  assert.ok(data.cases.every(c=>c.post_visibility==="public"&&c.hidden_for_reporter&&c.related_post_count===2&&c.author_status==="active"));
  assert.ok(!JSON.stringify(data).includes(device));assert.ok(!JSON.stringify(data).includes('guest_key'));
  const account=data.cases.find(c=>c.reporter_user_id);const guest=data.cases.find(c=>!c.reporter_user_id);
  await db.query(`select admin_review_post_safety($1,'suspend_reporter','Repeated abusive reporting')`,[guest.id]);
  data=await read();const restricted=data.cases.find(c=>c.id===guest.id);
  assert.equal(restricted.status,"pending");assert.equal(restricted.post_visibility,"public");
  assert.equal(restricted.restrictions[0].target,"reporter");assert.equal(restricted.restrictions[0].mode,"deny");
  assert.ok(!('identifier' in restricted.restrictions[0]));assert.equal(restricted.decisions[0].action,"suspend_reporter");
  await db.query(`select admin_review_post_safety($1,'keep_public','No policy violation')`,[account.id]);
  data=await read("user",account.id);assert.equal(data.user_count,1);assert.equal(data.total_count,1);
  assert.equal(data.cases.find(c=>c.id===account.id).status,"dismissed");assert.equal(data.cases.find(c=>c.id===account.id).hidden_for_reporter,true);
  const search=(await db.query(`select get_admin_post_review_workspace('user',null,null,0,'',null,null,'all','legitimate') data`)).rows[0].data;
  assert.equal(search.total_count,2);
  const labelSearch=(await db.query(`select get_admin_post_review_workspace('user',null,null,0,'',null,null,'all','Does not want') data`)).rows[0].data;assert.equal(labelSearch.total_count,1);
  await post(db,2,"sexual content triggers automatic review");
  const automatic=await read("automatic");assert.equal(automatic.automatic_count,1);assert.equal(automatic.cases[0].post_visibility,"held");
  assert.equal(automatic.cases[0].hidden_for_reporter,false);
  await db.query(`select admin_review_post_safety($1,'delete','Post violates policy')`,[guest.id]);
  const deleted=(await read("user",guest.id)).cases.find(c=>c.id===guest.id);assert.equal(deleted.post_visibility,"deleted");
  assert.ok(deleted.decisions.some(d=>d.action==="delete"));assert.equal(deleted.related_cases.length,2);
  await assert.rejects(db.query(`select admin_review_post_safety($1,'delete','A stale confirmation')`,[guest.id]),/no longer pending/);
 }finally{await db.close();}
});

test("review workspace pagination and scoped filters do not lose pending reports",async()=>{
 const db=await setup();
 try{
  await post(db,1,"Pagination evidence");await db.exec(`set test.admin='yes'`);
  await db.query(`insert into post_safety_cases(source_type,source_id,origin,reason,content_snapshot,author_user_id)
   select 'beauty_post',$1,'user','unwanted','{"caption":"Pagination evidence"}', $2 from generate_series(1,205)`,[uuid(1,"10000000"),uuid(1)]);
  const first=(await db.query(`select get_admin_post_review_workspace('user') data`)).rows[0].data;
  const next=(await db.query(`select get_admin_post_review_workspace('user',null,null,200) data`)).rows[0].data;
  assert.equal(first.cases.length,200);assert.equal(first.has_more,true);assert.equal(next.cases.length,5);assert.equal(next.has_more,false);
  assert.equal(new Set([...first.cases,...next.cases].map(c=>c.id)).size,205);
  const scope=(await db.query(`select get_admin_post_review_workspace('user',null,null,0,'',$1) data`,[uuid(3)])).rows[0].data;assert.equal(scope.total_count,0);
  await db.exec(`set role anon`);await assert.rejects(db.query(`select get_admin_post_review_workspace('user')`),/permission denied/i);
 }finally{await db.close();}
});


test("salon reports preserve created-by ownership for author enforcement",async()=>{
 const db=await setup();
 try{
  const id=uuid(8,"10000000");await db.query(`insert into salon_profile_looks(id,salon_id,created_by_user_id,title,caption) values($1,$2,$3,'Owner manicure','A unique salon manicure')`,[id,uuid(1,"40000000"),uuid(1)]);
  await actor(db,2);await db.query(`select post_safety_action('salon_profile_look',$1,'report','{"reason":"unwanted"}')`,[id]);
  const c=(await db.query(`select id,author_user_id from post_safety_cases where source_id=$1`,[id])).rows[0];assert.equal(c.author_user_id,uuid(1));
  await actor(db,9);await db.exec(`set test.admin='yes'`);
  const data=(await db.query(`select get_admin_post_review_workspace('user') data`)).rows[0].data;assert.equal(data.cases[0].related_author_count,1);
  await db.query(`select admin_review_post_safety($1,'suspend_author','Reviewed repeated author abuse')`,[c.id]);
  assert.equal((await db.query(`select status from users where id=$1`,[uuid(1)])).rows[0].status,'suspended');
  assert.equal((await db.query(`select status from post_safety_cases where id=$1`,[c.id])).rows[0].status,'pending');
 }finally{await db.close();}
});
