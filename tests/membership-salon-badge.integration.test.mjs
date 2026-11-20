import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const actor='00000000-0000-4000-8000-000000000001',salon='00000000-0000-4000-8000-000000000010';
test('Member affiliation is versioned, time-bound and independent of identity approval',async t=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;
   create table users(id uuid primary key);insert into users values('${actor}');
   create table locations(id uuid primary key,name text,phone text,city text,status text,is_public boolean default true);insert into locations(id,name,status)values('${salon}','Example Salon','active');
   create function salon_profile_public_salon_exists(p uuid)returns boolean language sql as $$select is_public from locations where id=p$$;
   create table platform_admin_permissions(id uuid default gen_random_uuid() primary key,code text unique,name text,description text,category text);
   create table platform_admin_roles(id uuid default gen_random_uuid() primary key,slug text);
   create table platform_admin_role_permissions(role_id uuid,permission_id uuid,unique(role_id,permission_id));
   create table platform_admin_audit_logs(actor_user_id uuid,action text,target_type text,target_id uuid,reason text,after_data jsonb);
   create function platform_admin_has_permission(p text)returns boolean language sql as $$select coalesce(current_setting('test.allow',true),'true')='true'$$;
   create function platform_admin_require_permission(p text)returns table(actor_user_id uuid)language plpgsql as $$begin if not platform_admin_has_permission(p)then raise exception 'Permission denied';end if;return query select '${actor}'::uuid;end;$$;`);
  for(const name of ['202611030001_reylumi_membership_admin.sql','202611030002_membership_desktop_settings.sql','202611040001_membership_salon_badge.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
  const rpc=async(name,args=[]) => (await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;
  const cmd=p=>rpc('reylumi_membership_command',[JSON.stringify({request_id:randomUUID(),reason:'Member affiliation test',...p})]);
  const badges=async()=> (await db.query('select * from reylumi_membership_salon_badges($1)',[[salon]])).rows;
  let version,term;
  await t.test('All drafts offer the check; nothing is published or granted implicitly',async()=>{
   const state=await rpc('reylumi_membership_workspace');assert.equal(state.plans.length,3);
   assert.ok(state.plans.every(p=>p.config.salon_member_badge===true));assert.deepEqual(await badges(),[]);
   const p=state.plans.find(p=>p.key==='growth');
   await assert.rejects(cmd({action:'save_settings',publish:true,plans:[{key:p.key,revision:p.revision,config:{...p.config,salon_member_badge:'true'},selling:true}]}),/Invalid member badge/);
   await cmd({action:'save_settings',publish:true,plans:[{key:p.key,revision:p.revision,config:p.config,selling:true}]});
   version=(await rpc('reylumi_membership_workspace')).plans.find(p=>p.key==='growth').published_version;
   term=(await cmd({action:'grant',salon_id:salon,key:'growth',version_id:version,source:'paid_manual',amount_cents:100,payment_method:'bank',payment_reference:'Example payment',months:1,starts_at:new Date(Date.now()-60000).toISOString()})).membership_id;
   assert.equal((await badges()).length,1);
  });
  await t.test('Anonymous projection exposes only the requested public affiliation and expiration',async()=>{
   await db.exec('set role anon');const rows=await badges();assert.deepEqual(Object.keys(rows[0]).sort(),['salon_id','valid_until']);
   await assert.rejects(db.query('select * from reylumi_membership_terms'),/permission denied/);
   assert.equal((await db.query('select * from reylumi_membership_salon_badges($1)',[[randomUUID()]])).rows.length,0);
   await assert.rejects(db.query('select * from reylumi_membership_salon_badges($1)',[Array(101).fill(salon)]),/At most 100/);await db.exec('reset role');
  });
  await t.test('Private, disabled, future, expired and cancelled salons have no public check',async()=>{
   for(const sql of ["update locations set is_public=false","update locations set status='suspended'",`update reylumi_membership_terms set starts_at=now()+interval '1 day'`,`update reylumi_membership_terms set starts_at=now()-interval '2 months',ends_at=now()-interval '1 day'`,`update reylumi_membership_terms set cancelled_at=now()`]){
    await db.exec('begin');await db.exec(sql);assert.deepEqual(await badges(),[]);await db.exec('rollback');
   }
  });
  await t.test('Republishing a disabled benefit preserves existing purchased terms',async()=>{
   const p=(await rpc('reylumi_membership_workspace')).plans.find(p=>p.key==='growth');
   await cmd({action:'save_settings',publish:true,plans:[{key:p.key,revision:p.revision,config:{...p.config,salon_member_badge:false},selling:true}]});
   assert.equal((await badges()).length,1);assert.equal((await rpc('reylumi_membership_detail',[term])).membership.config.salon_member_badge,true);
   const next=(await rpc('reylumi_membership_workspace')).plans.find(p=>p.key==='growth');
   const until=(await rpc('reylumi_membership_detail',[term])).membership.ends_at;
   await cmd({action:'grant',salon_id:salon,key:'growth',version_id:next.published_version,source:'manual',months:1,starts_at:until});
   await cmd({action:'cancel',membership_id:term});assert.deepEqual(await badges(),[]);
  });
 }finally{await db.close();}
});
