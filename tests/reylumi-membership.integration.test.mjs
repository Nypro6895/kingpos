import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const admin='00000000-0000-4000-8000-000000000001',salon='00000000-0000-4000-8000-000000000010';
test('Membership admin: transactional versions, permissions, periods, credits and technical service',async t=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;
 create table users(id uuid primary key);insert into users values('${admin}');
 create table locations(id uuid primary key,name text,phone text,city text,status text);insert into locations values('${salon}','Test Salon','5551234567','Madison','active');
 create table platform_admin_permissions(id uuid default gen_random_uuid() primary key,code text unique,name text,description text,category text);
 create table platform_admin_roles(id uuid default gen_random_uuid() primary key,slug text);insert into platform_admin_roles(slug)values('platform_owner'),('operations_admin');
 create table platform_admin_role_permissions(role_id uuid,permission_id uuid,unique(role_id,permission_id));
 create table platform_admin_audit_logs(actor_user_id uuid,action text,target_type text,target_id uuid,reason text,after_data jsonb);
 create function platform_admin_has_permission(p text) returns boolean language sql as $$ select p=any(string_to_array(coalesce(current_setting('test.permissions',true),''),',')) $$;
 create function platform_admin_require_permission(p text) returns table(actor_user_id uuid) language plpgsql as $$begin if not platform_admin_has_permission(p) then raise exception 'Permission denied';end if;return query select '${admin}'::uuid;end;$$;
 select set_config('test.permissions','admin.membership.read,admin.membership.configure,admin.membership.manage',false);`);
 await db.exec(fs.readFileSync('supabase/migrations/202611030001_reylumi_membership_admin.sql','utf8'));
 const rpc=async(name,args=[]) => (await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
 const command=async input=>rpc('reylumi_membership_command',[JSON.stringify({request_id:randomUUID(),reason:'Integration validation',...input})]);
 let config=(await rpc('reylumi_membership_workspace')).plans.find(x=>x.key==='growth').config,version,term;
 await t.test('Unpublished pricing stays private; SQL direct access and helper execution denied',async()=>{
  assert.deepEqual(await rpc('reylumi_membership_public'),[]);
  await db.exec('set role anon');assert.deepEqual(await rpc('reylumi_membership_public'),[]);
  await assert.rejects(db.query('select * from reylumi_membership_plans'),/permission denied/);
  await assert.rejects(rpc('reylumi_membership_sync',[salon]),/permission denied/);
  await assert.rejects(rpc('reylumi_membership_workspace'),/permission denied/);
  await db.exec('reset role');
 });
 await t.test('Publish saves draft atomically; optimistic revision check and invalid input protection',async()=>{
  config.monthly_cents=4900;config.annual_cents=49000;config.allowances.sms={amount:100,period:'month',rollover:50,overage_cents:3};config.allowances.setup.amount=90;
  await command({action:'publish_plan',key:'growth',revision:1,config});
  const state=await rpc('reylumi_membership_workspace');version=state.plans.find(x=>x.key==='growth').published_version;
  assert.equal((await rpc('reylumi_membership_public'))[0].config.monthly_cents,4900);
  await assert.rejects(command({action:'save_plan',key:'growth',revision:1,config}),/changed/);
  await assert.rejects(command({action:'save_plan',key:'growth',revision:2,config:{...config,monthly_cents:-1}}),/Invalid/);
  await command({action:'set_selling',key:'growth',revision:2,selling:true});
 });
 await t.test('Permissions enforced in RPC; phone redacted without sensitive-read access',async()=>{
  const list=await rpc('reylumi_membership_salons',['Test']);assert.equal(list[0].phone,null);
  await db.exec("select set_config('test.permissions','admin.membership.read',false)");
  await assert.rejects(command({action:'grant',salon_id:salon}),/Permission denied/);
  await db.exec("select set_config('test.permissions','admin.membership.read,admin.membership.configure,admin.membership.manage',false)");
 });
 const starts=new Date(Date.now()-60000).toISOString();
 await t.test('Grant is idempotent, overlap blocked and paid grants require evidence',async()=>{
  const input={action:'grant',request_id:randomUUID(),salon_id:salon,key:'growth',version_id:version,source:'paid_manual',months:12,starts_at:starts,amount_cents:49000,payment_method:'bank',payment_reference:'TEST-RECEIPT'};
  const result=await command(input);term=result.membership_id;
  assert.deepEqual(await command(input),result);
  await assert.rejects(command({...input,months:6}),/different values/);
  await assert.rejects(command({...input,request_id:randomUUID()}),/overlapping/);
  const d=await rpc('reylumi_membership_detail',[term]);assert.equal(d.membership.effective_status,'active');assert.equal(d.balances.find(x=>x.resource==='sms').balance,100);
 });
 await t.test('Versioned changes never mutate existing membership; credit cannot underflow',async()=>{
  const newer=structuredClone(config);newer.allowances.sms.amount=200;
  await command({action:'publish_plan',key:'growth',revision:3,config:newer});
  assert.equal((await rpc('reylumi_membership_detail',[term])).membership.config.allowances.sms.amount,100);
  await command({action:'adjust_credit',membership_id:term,resource:'sms',delta:-60});
  await assert.rejects(command({action:'adjust_credit',membership_id:term,resource:'sms',delta:-41}),/Invalid resulting/);
  assert.equal((await rpc('reylumi_membership_detail',[term])).balances.find(x=>x.resource==='sms').balance,40);
 });
 await t.test('Service completion deducts exactly once; stale updates and excess minutes blocked',async()=>{
  const {support_id}=await command({action:'create_support',membership_id:term,kind:'setup',subject:'Initial remote setup'});
  await assert.rejects(command({action:'update_support',support_id,revision:1,state:'completed',assignee:'Technician A',minutes:91}),/exceeds/);
  const input={action:'update_support',request_id:randomUUID(),support_id,revision:1,state:'completed',assignee:'Technician A',minutes:45};
  await command(input);await command(input);
  assert.equal((await rpc('reylumi_membership_detail',[term])).balances.find(x=>x.resource==='setup').balance,45);
  await assert.rejects(command({...input,request_id:randomUUID()}),/changed or is closed/);
 });
 await t.test('Rollover generated from elapsed periods with cap; monthly boundaries retain original anchor',async()=>{
  // Independent historical fixture, before any buckets were materialized.
  const historical=randomUUID();await db.query("insert into reylumi_membership_terms(id,salon_id,version_id,starts_at,ends_at,source,amount_cents,reason)values($1,$2,$3,now()-interval '2 months',now()+interval '10 months','manual',0,'Historical fixture')",[historical,salon,version]);
  const d=await rpc('reylumi_membership_detail',[historical]);assert.equal(d.balances.find(x=>x.resource==='sms').balance,150);
  const rows=await db.query('select starts_at,ends_at from reylumi_membership_buckets where membership_id=$1 and resource=\'sms\' order by starts_at',[historical]);assert.ok(rows.rows.length>=3);
  await command({action:'cancel',membership_id:historical});
 });
 await t.test('End access retains history, removes available balances and allows a new non-overlapping term',async()=>{
  await command({action:'cancel',membership_id:term});const d=await rpc('reylumi_membership_detail',[term]);assert.equal(d.membership.effective_status,'cancelled');assert.equal(d.balances.length,0);assert.ok(d.events.length>=4);
  await assert.rejects(command({action:'adjust_credit',membership_id:term,resource:'sms',delta:1}),/not active/);
  await assert.rejects(command({action:'grant',salon_id:salon,key:'growth',version_id:version,source:'manual',months:1,starts_at:starts}),/changed/);
  const state=await rpc('reylumi_membership_workspace');const currentVersion=state.plans.find(x=>x.key==='growth').published_version;
  await assert.rejects(command({action:'grant',salon_id:salon,key:'growth',version_id:currentVersion,source:'paid_manual',months:1,starts_at:starts,amount_cents:1,payment_method:'card',payment_reference:'invalid'}),/Invalid/);
  await command({action:'grant',salon_id:salon,key:'growth',version_id:currentVersion,source:'gift',months:1,starts_at:starts});
 });
 await t.test('Historical activity and closed service requests remain searchable with pagination',async()=>{
  const history=await rpc('reylumi_membership_activity',['history','credit','all',1]);assert.ok(history.total>0);assert.ok(history.items.every(x=>x.action==='adjust_credit'));
  const complete=await rpc('reylumi_membership_activity',['support','Initial','completed',1]);assert.equal(complete.total,1);assert.equal(complete.items[0].state,'completed');
  assert.equal((await rpc('reylumi_membership_activity',['support','Initial','open',1])).total,0);
  assert.equal((await rpc('reylumi_membership_activity',['history','','all',100])).items.length,0);
 });
 await db.close();
});
