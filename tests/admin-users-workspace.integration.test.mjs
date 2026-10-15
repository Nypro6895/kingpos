import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,invited_at timestamptz,last_sign_in_at timestamptz,banned_until timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
 create table auth.refresh_tokens(id uuid primary key default gen_random_uuid(),session_id uuid);
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid,factor_type text,status text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text);
 create table users(id uuid primary key default gen_random_uuid(),auth_user_id uuid unique,email text,phone text,display_name text,first_name text,last_name text,status text default 'active',language text default 'en',timezone text default 'America/Chicago',created_at timestamptz default now(),updated_at timestamptz default now(),last_login_at timestamptz);
 create table accounts(id uuid primary key,name text,status text default 'active');
 create table locations(id uuid primary key,account_id uuid,name text,status text default 'active');
 create table staff(id uuid primary key default gen_random_uuid(),salon_id uuid,account_user_id uuid,user_id uuid,is_active boolean default true);
 create table roles(id uuid primary key,account_id uuid,code text);
 create table account_memberships(id uuid primary key default gen_random_uuid(),account_id uuid,user_id uuid,role_id uuid,status text,joined_at timestamptz,unique(account_id,user_id));
 create table salon_memberships(id uuid primary key default gen_random_uuid(),account_id uuid,salon_id uuid,user_id uuid,role_id uuid,status text,joined_at timestamptz,unique(salon_id,user_id));
 create table platform_admin_roles(id uuid primary key,slug text,name text);
 create table platform_admin_permissions(id uuid primary key default gen_random_uuid(),code text unique,name text,description text,category text,is_system boolean);
 create table platform_admin_role_permissions(role_id uuid,permission_id uuid,unique(role_id,permission_id));
 create table platform_admin_memberships(id uuid primary key,user_id uuid,role_id uuid,status text);
 create table platform_admin_audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid,action text,target_type text,target_id uuid,reason text,metadata jsonb,before_data jsonb,after_data jsonb);
 create table platform_reports(id uuid primary key default gen_random_uuid(),report_number text default 'CASE-TEST',subject_user_id uuid,category text,summary text,description text,source text,priority text,status text default 'new',assigned_membership_id uuid,created_by_user_id uuid,resolution text,resolved_at timestamptz,closed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
 alter table platform_reports add column reporter_user_id uuid,add column subject_organization_id uuid,add column subject_location_id uuid;
 create table account_login_sessions(id uuid primary key default gen_random_uuid(),user_id uuid,revoked_at timestamptz,revoked_by_user_id uuid);
 create table account_trusted_devices(id uuid primary key default gen_random_uuid(),user_id uuid);
 create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function platform_admin_has_permission(text) returns boolean language sql stable as $$select $1=any(string_to_array(coalesce(current_setting('test.permissions',true),''),','))$$;
 create function platform_admin_require_permission(text) returns void language plpgsql as $$begin if not platform_admin_has_permission($1) then raise exception 'Permission denied: %',$1;end if;end$$;
 create function platform_admin_normalize_reason(text) returns text language plpgsql as $$begin if $1 is null or length(btrim($1))<3 then raise exception 'Reason required';end if;return btrim($1);end$$;
 create function get_platform_admin_user_detail(uuid) returns jsonb language sql as $$select jsonb_build_object('user',jsonb_build_object('id',id),'organization_memberships','[]'::jsonb,'salon_memberships','[]'::jsonb) from users where id=$1$$;
 create function admin_set_user_access(uuid,text,boolean) returns jsonb language plpgsql as $$begin perform platform_admin_require_permission(case when $3 then 'admin.users.suspend' else 'admin.users.restore' end);if $1=current_public_user_id() then raise exception 'Cannot change own access';end if;update users set status=case when $3 then 'suspended' else 'active' end where id=$1;return '{}';end$$;
 `);
 for(let n=1;n<=4;n++)await db.query('insert into users(id,auth_user_id,email,display_name)values($1,$1,$2,$3)',[id(n),`user${n}@example.test`,`User ${n}`]);
 for(let n=1;n<=4;n++)await db.query('insert into auth.users(id,email)values($1,$2)',[id(n),`user${n}@example.test`]);
 await db.query("insert into platform_admin_roles values($1,'platform_owner','Owner')",[id(10)]);
 await db.query("insert into platform_admin_memberships values($1,$2,$3,'active')",[id(11),id(1),id(10)]);
 await db.exec(fs.readFileSync('supabase/migrations/202610070018_admin_users_workspace.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610070020_admin_users_workspace_complete.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610070021_admin_store_presentation.sql','utf8'));
 await db.query("select set_config('test.uid',$1,false),set_config('test.permissions',$2,false)",[id(1),'admin.locations.read,admin.users.read,admin.users.create,admin.users.auth.manage,admin.users.read_sensitive,admin.users.update,admin.recovery.read,admin.recovery.manage,admin.reports.create,admin.reports.read,admin.reports.update,admin.reports.assign,admin.reports.resolve,admin.users.memberships.manage,admin.team.manage,admin.users.suspend,admin.users.restore']);
 return db;
}
const data={category:'account_takeover',description:'Unrecognized email change and login.',priority:'high',recovery_contact:'recovered@example.test',identity_verified:true,contact_verified:true,ownership_verified:true,verification_evidence:'Identity and recovery contact checked independently.'};
async function makeCase(db,n=2){return (await db.query('select admin_user_case_save($1,$2,null,$3::jsonb,$4) id',[id(n),id(100+n),JSON.stringify(data),'Recovery review'])).rows[0].id;}

test('evidence cannot reference another user or a missing object; linked cases preserve the support conversation',async()=>{
 const db=await setup();try{
  const save=attachments=>db.query('select admin_user_case_save($1,$2,null,$3::jsonb,$4)',[id(2),id(801),JSON.stringify({...data,attachments}),'Verified evidence']);
  await assert.rejects(save([{name:'Proof.pdf',path:`${id(3)}/proof.pdf`}]),/uploaded for this user/);
  await assert.rejects(save([{name:'Proof.pdf',path:`${id(2)}/missing.pdf`}]),/uploaded for this user/);
  await db.query('insert into storage.objects values($1,$2)',['admin-user-evidence',`${id(2)}/proof.pdf`]);
  await save([{name:'Proof.pdf',path:`${id(2)}/proof.pdf`}]);
  await db.query("insert into platform_reports(id,reporter_user_id,source,category,status)values($1,$2,'user_support','account','new')",[id(802),id(2)]);
  await db.query("select admin_user_case_link($1,$2,'lost_access','Existing support recovery')",[id(2),id(802)]);
  const linked=(await db.query('select source,support_context,subject_user_id from platform_reports where id=$1',[id(802)])).rows[0];
  assert.equal(linked.source,'user_support');assert.equal(linked.support_context.original_category,'account');assert.equal(linked.subject_user_id,id(2));
  await assert.rejects(db.query("select admin_user_case_link($1,$2,'other','Unrelated user case')",[id(3),id(802)]),/related to this user/);
 }finally{await db.close();}
});

test('profile saves reject stale versions, authentication fields and invalid timezones',async()=>{
 const db=await setup();try{
  const profile={display_name:'Updated name',first_name:'Updated',last_name:'Name',language:'vi',timezone:'America/Chicago'};
  const updated=(await db.query('select updated_at::text stamp from users where id=$1',[id(2)])).rows[0].stamp;
  const save=(value,stamp=updated)=>db.query('select admin_user_profile_save($1,$2::jsonb,$3,$4)',[id(2),JSON.stringify(value),stamp,'Verified profile correction']);
  await assert.rejects(save(profile,'2000-01-01'),/changed/);
  await assert.rejects(save({...profile,email:'takeover@example.test'}),/Invalid profile fields/);
  await assert.rejects(save({...profile,timezone:'Invalid/Zone'}),/timezone/);
  await save(profile);assert.equal((await db.query('select display_name from users where id=$1',[id(2)])).rows[0].display_name,'Updated name');
 }finally{await db.close();}
});

test('identity administration enforces verification, own account, deduplication and unresolved job guards',async()=>{
 const db=await setup();try{
  const begin=(request,user,operation,email,payload={})=>db.query('select admin_user_identity_begin($1,$2,$3,$4,$5::jsonb,$6) result',[request,user,operation,email,JSON.stringify(payload),'Verified support request']);
  await assert.rejects(begin(id(201),id(2),'email_change','recovered@example.test'),/verified recovery case/);
  const caseId=await makeCase(db);
  await assert.rejects(begin(id(201),id(2),'email_change','wrong@example.test',{case_id:caseId}),/verified recovery contact/);
  const job=(await begin(id(201),id(2),'email_change','recovered@example.test',{case_id:caseId})).rows[0].result;
  assert.equal(job.auth_user_id,id(2));
  assert.equal((await begin(id(201),id(2),'email_change','recovered@example.test',{case_id:caseId})).rows[0].result.repeat,true);
  await assert.rejects(begin(id(202),id(2),'password_reset',null,{case_id:caseId}),/verified recovery email|unresolved operation/);
  await assert.rejects(begin(id(201),id(2),'reset_mfa',null,{case_id:caseId}),/request reuse/);
  await assert.rejects(begin(id(203),id(1),'reset_mfa',null,{case_id:caseId}),/own authentication/);
  await db.query('update auth.users set email=$1 where id=$2',['recovered@example.test',id(2)]);
  await db.query("select admin_user_identity_finish($1,'accepted',$2)",[id(201),id(2)]);
  assert.equal((await db.query('select email from users where id=$1',[id(2)])).rows[0].email,'recovered@example.test');
  await db.exec("set test.permissions='admin.users.read'");
  await assert.rejects(begin(id(204),id(3),'password_reset',null),/Permission denied/);
  await db.exec('set role authenticated');
  await assert.rejects(db.query("select admin_user_identity_finish($1,'accepted',$2)",[id(201),id(2)]),/permission denied/);
 }finally{await db.close();}
});

test('cases deduplicate atomically, enforce evidence and version conflicts, and roll back failed containment',async()=>{
 const db=await setup();try{
  await assert.rejects(db.query('select admin_user_case_save($1,$2,null,$3::jsonb,$4)',[id(2),id(301),JSON.stringify({...data,verification_evidence:''}),'Review case']),/Verification evidence/);
  const caseId=await makeCase(db);
  assert.equal(await makeCase(db),caseId);
  await assert.rejects(db.query('select admin_user_case_save($1,$2,null,$3::jsonb,$4)',[id(2),id(302),JSON.stringify(data),'Review case']),/already has an open case/);
  await assert.rejects(db.query('select admin_user_case_save($1,$2,$3,$4::jsonb,$5)',[id(2),id(303),caseId,JSON.stringify({...data,status:'under_review',expected_updated_at:'2020-01-01'}),'Review case']),/case changed/);
  await db.exec("set test.permissions='admin.reports.create,admin.recovery.manage'");
  await assert.rejects(db.query('select admin_user_case_save($1,$2,null,$3::jsonb,$4)',[id(3),id(304),JSON.stringify({...data,suspend:true}),'Containment']),/Permission denied/);
  assert.equal((await db.query('select count(*)::int n from platform_reports where subject_user_id=$1',[id(3)])).rows[0].n,0);
 }finally{await db.close();}
});

test('native session revocation checks ownership, revokes refresh tokens, and suspension revokes all sessions',async()=>{
 const db=await setup();try{
  await db.query('insert into auth.sessions(id,user_id)values($1,$2),($3,$4)',[id(401),id(2),id(402),id(3)]);
  await db.query('insert into auth.refresh_tokens(session_id)values($1),($2)',[id(401),id(402)]);
  await assert.rejects(db.query('select admin_user_revoke_sessions($1,$2,$3)',[id(2),id(402),'Security request']),/no longer active/);
  assert.equal((await db.query('select admin_user_revoke_sessions($1,$2,$3) n',[id(2),id(401),'Security request'])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from auth.refresh_tokens')).rows[0].n,1);
  await db.query("select admin_set_user_access($1,'Contain account',true)",[id(3)]);
  assert.equal((await db.query('select count(*)::int n from auth.sessions')).rows[0].n,0);
 }finally{await db.close();}
});

test('membership edits protect owners; transfer establishes recipient access first and is audited',async()=>{
 const db=await setup();try{
  await db.query("insert into accounts values($1,'Salon group','active')",[id(501)]);
  for(const [n,code]of [[502,'OWNER'],[503,'MANAGER'],[504,'STAFF']])await db.query('insert into roles values($1,$2,$3)',[id(n),id(501),code]);
  await db.query("insert into locations values($1,$2,'Salon','active')",[id(505),id(501)]);
  await db.query("insert into account_memberships(account_id,user_id,role_id,status)values($1,$2,$3,'active')",[id(501),id(2),id(502)]);
  await assert.rejects(db.query("select admin_user_membership_save($1,'business',$2,'STAFF','inactive',true,'Change membership')",[id(2),id(501)]),/Transfer ownership/);
  const caseId=await makeCase(db);
  await db.query("select admin_user_transfer_owner($1,$2,'business',$3,$4,'Verified ownership transfer')",[id(2),id(3),id(501),caseId]);
  const rows=(await db.query('select user_id,status from account_memberships order by user_id')).rows;
  assert.deepEqual(rows,[{user_id:id(2),status:'inactive'},{user_id:id(3),status:'active'}]);
  assert.equal((await db.query("select count(*)::int n from platform_admin_audit_logs where action='platform_admin.ownership.transferred'")).rows[0].n,1);
 }finally{await db.close();}
});

test('workspace omits sensitive authentication and selected export honors sensitive permission',async()=>{
 const db=await setup();try{
  await makeCase(db);
  await db.exec("set test.permissions='admin.users.read,admin.reports.read'");
  const workspace=(await db.query('select admin_user_workspace($1) result',[id(2)])).rows[0].result;
  assert.equal(workspace.authentication,null);assert.equal(workspace.cases[0].context.recovery_contact,undefined);
  const exported=(await db.query('select admin_user_export_selected($1::uuid[]) result',[[id(2)]])).rows[0].result;
  assert.equal(exported[0].email,null);
 }finally{await db.close();}
});


test('store projection deduplicates scopes, excludes profile containers and keeps staff employment separate',async()=>{
 const db=await setup();try{
  await db.query("insert into accounts values($1,'Shop group','active'),($2,'Personal setup','active')",[id(901),id(902)]);
  await db.query("insert into locations values($1,$3,'Shop A1','active'),($2,$3,'Shop A2','active')",[id(903),id(904),id(901)]);
  await db.query("insert into roles values($1,$2,'OWNER')",[id(905),id(901)]);
  await db.query("insert into account_memberships(account_id,user_id,role_id,status)values($1,$3,$4,'active'),($2,$3,$4,'active')",[id(901),id(902),id(2),id(905)]);
  await db.query("insert into salon_memberships(account_id,salon_id,user_id,role_id,status)values($1,$2,$3,$4,'active')",[id(901),id(903),id(2),id(905)]);
  const stores=(await db.query('select admin_user_access_stores($1) result',[id(2)])).rows[0].result;
  assert.equal(stores.length,2);assert.equal(stores[0].sources.length,2);assert.equal(stores[0].sources.find(g=>g.scope==='business').store_count,2);
  const owners=(await db.query('select admin_store_owners($1) result',[id(903)])).rows[0].result;assert.deepEqual(owners.map(u=>u.id),[id(2)]);
  await db.query('insert into staff(salon_id,account_user_id)values($1,$2)',[id(903),id(3)]);
  const worker=(await db.query('select admin_user_access_stores($1) result',[id(3)])).rows[0].result;assert.equal(worker.length,1);assert.equal(worker[0].sources.length,0);assert.equal(worker[0].staff_linked,true);
  const search=(await db.query("select search_platform_admin_users_stores(1,25,null,null,'staff',$1,'created_desc') result",[id(903)])).rows[0].result;assert.deepEqual(search.items.map(u=>u.id),[id(3)]);assert.equal(search.items[0].businesses.length,1);
  const exported=(await db.query('select admin_user_export_stores($1::uuid[]) result',[[id(2)]])).rows[0].result;assert.equal(exported[0].organization_count,2);
  await db.exec("set test.permissions='admin.users.read'");
  const redacted=(await db.query('select admin_user_export_stores($1::uuid[]) result',[[id(2)]])).rows[0].result;assert.equal(redacted[0].email,null);
  await assert.rejects(db.query('select admin_store_owners($1)',[id(903)]),/Permission denied/);
  await db.exec("set test.permissions=''");await assert.rejects(db.query('select admin_user_access_stores($1)',[id(2)]),/Permission denied/);
 }finally{await db.close();}
});
