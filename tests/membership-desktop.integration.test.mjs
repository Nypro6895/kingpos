import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const admin='00000000-0000-4000-8000-000000000001',salon='00000000-0000-4000-8000-000000000010';
test('Desktop membership: atomic settings, published website, one salon row and task-based service',async t=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;
 create table users(id uuid primary key);insert into users values('${admin}');
 create table locations(id uuid primary key,name text,phone text,city text,status text);insert into locations values('${salon}','Test Salon','5551234567','Madison','active');
 create table platform_admin_permissions(id uuid default gen_random_uuid() primary key,code text unique,name text,description text,category text);
 create table platform_admin_roles(id uuid default gen_random_uuid() primary key,slug text);
 create table platform_admin_role_permissions(role_id uuid,permission_id uuid,unique(role_id,permission_id));
 create table platform_admin_audit_logs(actor_user_id uuid,action text,target_type text,target_id uuid,reason text,after_data jsonb);
 create function platform_admin_has_permission(p text) returns boolean language sql as $$select p=any(string_to_array(coalesce(current_setting('test.permissions',true),''),','))$$;
 create function platform_admin_require_permission(p text) returns table(actor_user_id uuid) language plpgsql as $$begin if not platform_admin_has_permission(p) then raise exception 'Permission denied';end if;return query select '${admin}'::uuid;end;$$;
 select set_config('test.permissions','admin.membership.read,admin.membership.configure,admin.membership.manage',false);`);
 for(const file of ['202611030001_reylumi_membership_admin.sql','202611030002_membership_desktop_settings.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 const rpc=async(name,args=[]) => (await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;
 const cmd=input=>rpc('reylumi_membership_command',[JSON.stringify({request_id:randomUUID(),reason:'Desktop workflow validation',...input})]);
 let term;
 try{
  await t.test('Batch publishes three columns and website atomically, with exact-once retry',async()=>{
   const state=await rpc('reylumi_membership_workspace');state.plans.forEach(p=>{p.config.allowances.sms.amount=100;p.config.allowances.campaign.amount=50;p.config.service={setup:'included',method:'remote',training_sessions:2,support:'priority'};});
   const input={action:'save_settings',request_id:randomUUID(),publish:true,plans:state.plans.map(p=>({key:p.key,revision:p.revision,config:p.config,selling:true})),website:{revision:state.website.revision,config:{...state.website.draft,title:'Membership for your salon'}}};
   const result=await cmd(input);assert.deepEqual(await cmd(input),result);
   assert.equal((await rpc('reylumi_membership_public')).length,3);assert.equal((await rpc('reylumi_membership_website_public')).title,'Membership for your salon');
   const published=await rpc('reylumi_membership_public');assert.equal(published[0].config.service.training_sessions,2);
  });
  await t.test('Stale column rolls back every earlier column and invalid session benefits rejected',async()=>{
   const before=await rpc('reylumi_membership_workspace');const plans=before.plans.map(p=>({key:p.key,revision:p.revision,config:{...p.config,tagline:'Should roll back'},selling:true}));plans[2].revision=0;
   await assert.rejects(cmd({action:'save_settings',publish:true,plans}),/changed/);
   assert.deepEqual((await rpc('reylumi_membership_workspace')).plans,before.plans);
   const p=before.plans[0];await assert.rejects(cmd({action:'save_settings',publish:true,plans:[{key:p.key,revision:p.revision,config:{...p.config,service:{...p.config.service,training_sessions:-1}},selling:true}]}),/Invalid/);
  });
  await t.test('Website draft stays private; optimistic conflict and role checks apply',async()=>{
   const state=await rpc('reylumi_membership_workspace');const input={action:'save_settings',publish:false,plans:[],website:{revision:state.website.revision,config:{...state.website.draft,title:'Private draft headline'}}};await cmd(input);
   assert.equal((await rpc('reylumi_membership_website_public')).title,'Membership for your salon');await assert.rejects(cmd(input),/changed/);
   await db.exec("set role anon");await assert.rejects(db.query('select * from reylumi_membership_website'),/permission denied/);await assert.rejects(rpc('reylumi_membership_command_v1',['{}']),/permission denied/);await db.exec('reset role');
   await db.exec("select set_config('test.permissions','admin.membership.read',false)");await assert.rejects(cmd({action:'save_website'}),/Permission denied/);await db.exec("select set_config('test.permissions','admin.membership.read,admin.membership.configure,admin.membership.manage',false)");
  });
  await t.test('Manage selects one salon row across active and scheduled terms, with accurate balances and filters',async()=>{
   const state=await rpc('reylumi_membership_workspace');const p=state.plans.find(p=>p.key==='growth');
   term=(await cmd({action:'grant',salon_id:salon,key:'growth',version_id:p.published_version,source:'manual',months:1,starts_at:new Date(Date.now()-60000).toISOString()})).membership_id;
   const detail=await rpc('reylumi_membership_detail',[term]);await cmd({action:'grant',salon_id:salon,key:'growth',version_id:p.published_version,source:'manual',months:1,starts_at:detail.membership.ends_at});
   await cmd({action:'adjust_credit',membership_id:term,resource:'sms',delta:25});
   const list=await rpc('reylumi_membership_workspace');assert.equal(list.total,1);assert.equal(list.memberships[0].sms_balance,125);assert.equal(list.memberships[0].campaign_balance,50);assert.equal(list.memberships[0].effective_status,'active');assert.ok(new Date(list.memberships[0].renewal_starts_at)>new Date(detail.membership.ends_at));
   assert.equal((await rpc('reylumi_membership_workspace',['','all',1,'essential'])).total,0);
   await assert.rejects(cmd({action:'adjust_credit',membership_id:term,resource:'setup',delta:10}),/not measured in minutes/);
  });
  await t.test('Complete setup as a task, without any minute balance or duplicate mutation',async()=>{
   const {support_id}=await cmd({action:'create_support',membership_id:term,kind:'setup',subject:'Remote onboarding'});
   const input={action:'update_support',request_id:randomUUID(),support_id,revision:1,state:'completed',assignee:'Technician A',note:'Setup completed'};await cmd(input);await cmd(input);
   const d=await rpc('reylumi_membership_detail',[term]);assert.equal(d.support[0].state,'completed');assert.equal((await db.query('select count(*) n from reylumi_membership_ledger')).rows[0].n,1);
   await assert.rejects(cmd({...input,request_id:randomUUID()}),/changed or is closed/);
  });
 }finally{await db.close();}
});
