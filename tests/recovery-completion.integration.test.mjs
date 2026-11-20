import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup,id,data,makeCase} from './recovery-fixture.mjs';
async function recoveryDb(){const db=await setup();await db.exec(`
 create table account_recovery_requests(id uuid primary key default gen_random_uuid(),user_id uuid not null,request_type text not null,status text default 'open',priority text default 'normal',risk_level text default 'unknown',contact_email text,contact_phone text,details text,resolution_summary text,resolved_at timestamptz,created_at timestamptz default now());
 create table support_inbox_threads(id uuid primary key,platform_report_id uuid);
 alter table auth.mfa_factors add column created_at timestamptz default now();
 create function account_recovery_current_user_can_manage_support() returns boolean language sql as $$select platform_admin_has_permission('admin.recovery.manage')$$;
 `);await db.exec(fs.readFileSync('supabase/migrations/20261111233000_recovery_completion.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261112001500_recovery_latest_attempt.sql','utf8'));return db;}
const digest='a'.repeat(64);
async function verify(db,c){await db.query('select admin_recovery_contact_begin($1,$2,$3,$4)',[c,id(700),digest,'Customer requested recovery']);assert.equal((await db.query('select confirm_recovery_contact($1) ok',[digest])).rows[0].ok,true);}
async function job(db,c,operation,number=800){return db.query('select admin_user_identity_begin($1,$2,$3,$4,$5::jsonb,$6)',[id(number),id(2),operation,operation==='email_change'?'recovered@example.test':null,JSON.stringify({case_id:c}),'Verified recovery action']);}

test('public requests and admin cases link once without granting ownership or contact verification',async()=>{const db=await recoveryDb();try{
 const r=(await db.query("insert into account_recovery_requests(user_id,request_type,contact_email) values($1,'lost_access','safe@example.test') returning id,admin_case_id",[id(2)])).rows[0];
 const linked=(await db.query('select admin_case_id from account_recovery_requests where id=$1',[r.id])).rows[0].admin_case_id;assert.ok(linked);
 const context=(await db.query('select support_context from platform_reports where id=$1',[linked])).rows[0].support_context;assert.equal(context.identity_verified,false);assert.equal(context.recovery_state.contact_verified,false);
 const c=await makeCase(db);assert.equal((await db.query('select count(*)::int n from account_recovery_requests where admin_case_id=$1',[c])).rows[0].n,1);
 await assert.rejects(db.query("update account_recovery_requests set status='approved' where id=$1",[r.id]),/Verify the owner/);
}finally{await db.close();}});

test('admin checkbox cannot replace a scoped email challenge; tokens expire, bind to email and are one-use',async()=>{const db=await recoveryDb();try{
 const c=await makeCase(db);await assert.rejects(job(db,c,'email_change'),/Verify the recovery email/);
 await db.query('select admin_recovery_contact_begin($1,$2,$3,$4)',[c,id(700),digest,'Verify contact email']);
 await db.query("update platform_reports set support_context=support_context||'{\"recovery_contact\":\"changed@example.test\"}' where id=$1",[c]);
 assert.equal((await db.query('select confirm_recovery_contact($1) ok',[digest])).rows[0].ok,false);
 await db.query("update platform_reports set support_context=support_context||'{\"recovery_contact\":\"recovered@example.test\"}' where id=$1",[c]);
 assert.equal((await db.query('select confirm_recovery_contact($1) ok',[digest])).rows[0].ok,false);
 await db.query("update recovery_contact_challenges set revoked_at=null");
 await db.query("update recovery_contact_challenges set expires_at=now()-interval '1 minute'");assert.equal((await db.query('select confirm_recovery_contact($1) ok',[digest])).rows[0].ok,false);
 await db.query("update recovery_contact_challenges set expires_at=now()+interval '1 minute'");assert.equal((await db.query('select confirm_recovery_contact($1) ok',[digest])).rows[0].ok,true);assert.equal((await db.query('select confirm_recovery_contact($1) ok',[digest])).rows[0].ok,false);
 await assert.rejects(job(db,c,'email_change'),/secure the account/);
}finally{await db.close();}});

test('secure recovery revokes real sessions and trusted devices; completion requires password change and a later sign-in',async()=>{const db=await recoveryDb();try{
 const c=await makeCase(db);await verify(db,c);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[id(90),id(2)]);await db.query('insert into auth.refresh_tokens(session_id) values($1)',[id(90)]);await db.query('insert into account_trusted_devices(user_id) values($1)',[id(2)]);
 await db.query('select admin_secure_recovery($1,$2)',[c,'Contain account takeover']);assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from account_trusted_devices')).rows[0].n,0);
 await job(db,c,'email_change');await db.query('update auth.users set email=$1 where id=$2',['recovered@example.test',id(2)]);await db.query("select admin_user_identity_finish($1,'accepted',$2)",[id(800),id(2)]);
 await db.query("update admin_user_identity_jobs set created_at=now()-interval '2 minutes'");await job(db,c,'password_reset',801);await db.query("select admin_user_identity_finish($1,'accepted',$2)",[id(801),id(2)]);
 await assert.rejects(db.query("update platform_reports set status='resolved' where id=$1",[c]),/Recovery is not complete/);
 await db.query('select record_recovery_password_change($1)',[id(2)]);await assert.rejects(db.query("update account_recovery_requests set status='resolved' where admin_case_id=$1",[c]),/not completed/);
 await db.query('update auth.users set last_sign_in_at=clock_timestamp() where id=$1',[id(2)]);assert.equal((await db.query('select recovery_access_complete($1) ok',[c])).rows[0].ok,true);
 await db.query("update platform_reports set status='resolved',resolution='Customer regained access' where id=$1",[c]);assert.equal((await db.query('select status from account_recovery_requests where admin_case_id=$1',[c])).rows[0].status,'resolved');
}finally{await db.close();}});

test('denial has its own outcome; guest support links to the same report and cannot be reassigned',async()=>{const db=await recoveryDb();try{
 const c=await makeCase(db);await db.query('select admin_deny_recovery($1,$2)',[c,'Ownership could not be established']);assert.equal((await db.query('select status from account_recovery_requests where admin_case_id=$1',[c])).rows[0].status,'denied');
 const report=(await db.query("insert into platform_reports(category,source,description,summary,priority,support_context) values('other','guest_support','Help','Help','normal','{}') returning id")).rows[0].id;await db.query('insert into support_inbox_threads values($1,$2)',[id(900),report]);
 await db.query("select set_config('test.permissions',current_setting('test.permissions')||',admin.inbox.manage',false)");const linked=(await db.query('select admin_link_support_recovery($1,$2,$3) id',[id(3),id(900),'Request identified this user'])).rows[0].id;assert.equal(linked,report);
 await assert.rejects(db.query('select admin_link_support_recovery($1,$2,$3)',[id(4),id(900),'Wrong user attempted link']),/another user/);
}finally{await db.close();}});

test('ordinary password resets and business ownership verification retain their prior behavior',async()=>{const db=await recoveryDb();try{
 await db.query('select admin_user_identity_begin($1,$2,$3,null,$4,$5)',[id(800),id(2),'password_reset',JSON.stringify({case_id:null}),'Ordinary password reset']);
 const caseId=(await db.query('select admin_user_case_save($1,$2,null,$3,$4) id',[id(3),id(701),JSON.stringify({...data,category:'ownership'}),'Business ownership verified'])).rows[0].id;
 await db.query('select admin_user_verified_case($1,$2)',[id(3),caseId]);assert.equal((await db.query('select count(*)::int n from account_recovery_requests where admin_case_id=$1',[caseId])).rows[0].n,0);
 await db.query("select set_config('test.permissions','admin.users.read',false)");await assert.rejects(db.query('select admin_recovery_contact_begin($1,$2,$3,$4)',[caseId,id(702),digest,'No permission']),/Permission denied/);
}finally{await db.close();}});

test('MFA reset requires re-enrollment before closing; denying a case revokes its contact proof',async()=>{const db=await recoveryDb();try{
 const c=await makeCase(db);await verify(db,c);await db.query('select admin_secure_recovery($1,$2)',[c,'Recovery containment']);
 await db.query("update auth.users set email='recovered@example.test' where id=$1",[id(2)]);await db.query("update users set email='recovered@example.test' where id=$1",[id(2)]);
 await job(db,c,'reset_mfa',803);await db.query("select admin_user_identity_finish($1,'accepted',$2)",[id(803),id(2)]);await db.query("update admin_user_identity_jobs set created_at=now()-interval '2 minutes'");
 await job(db,c,'password_reset',804);await db.query("select admin_user_identity_finish($1,'accepted',$2)",[id(804),id(2)]);await db.query('select record_recovery_password_change($1)',[id(2)]);
 await db.query('update auth.users set last_sign_in_at=clock_timestamp() where id=$1',[id(2)]);assert.equal((await db.query('select recovery_access_complete($1) ok',[c])).rows[0].ok,false);
 await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status,created_at)values($1,$2,'totp','unverified',clock_timestamp())",[id(909),id(2)]);
 await db.query("update auth.mfa_factors set status='verified' where id=$1",[id(909)]);assert.equal((await db.query('select recovery_access_complete($1) ok',[c])).rows[0].ok,true);
 await db.query('select admin_deny_recovery($1,$2)',[c,'New evidence disproved ownership']);assert.equal((await db.query('select recovery_contact_verified($1) ok',[c])).rows[0].ok,false);
 await db.query("update platform_reports set status='under_review' where id=$1",[c]);await db.query("update admin_user_identity_jobs set created_at=now()-interval '2 minutes'");await assert.rejects(job(db,c,'email_change',805),/Verify the recovery email/);
}finally{await db.close();}});

test('resending reset invalidates old password progress and repeated containment requires a later login',async()=>{const db=await recoveryDb();try{const c=await makeCase(db);await verify(db,c);await db.query('select admin_secure_recovery($1,$2)',[c,'Fixture containment']);await db.query("update auth.users set email='recovered@example.test' where id=$1",[id(2)]);await db.query("update users set email='recovered@example.test' where id=$1",[id(2)]);await job(db,c,'password_reset',811);await db.query("select admin_user_identity_finish($1,'accepted',$2)",[id(811),id(2)]);await db.query('select record_recovery_password_change($1)',[id(2)]);await db.query('update auth.users set last_sign_in_at=clock_timestamp() where id=$1',[id(2)]);assert.equal((await db.query('select recovery_access_complete($1) ok',[c])).rows[0].ok,true);await db.query("update admin_user_identity_jobs set created_at=now()-interval '2 minutes'");await job(db,c,'password_reset',812);await db.query("select admin_user_identity_finish($1,'accepted',$2)",[id(812),id(2)]);const r=(await db.query('select password_changed_at,restored_at from account_recovery_requests where admin_case_id=$1',[c])).rows[0];assert.equal(r.password_changed_at,null);assert.equal(r.restored_at,null);await assert.rejects(db.query("update platform_reports set status='resolved' where id=$1",[c]),/Recovery is not complete/);await db.query('select record_recovery_password_change($1)',[id(2)]);await db.query('update auth.users set last_sign_in_at=clock_timestamp() where id=$1',[id(2)]);assert.equal((await db.query('select recovery_access_complete($1) ok',[c])).rows[0].ok,true);await db.query('select admin_secure_recovery($1,$2)',[c,'Contain account again']);assert.equal((await db.query('select recovery_access_complete($1) ok',[c])).rows[0].ok,false);await db.query('update auth.users set last_sign_in_at=clock_timestamp() where id=$1',[id(2)]);assert.equal((await db.query('select recovery_access_complete($1) ok',[c])).rows[0].ok,true);}finally{await db.close();}});
