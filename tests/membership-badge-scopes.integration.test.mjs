import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{PGlite}from'@electric-sql/pglite';
const salon='00000000-0000-4000-8000-000000000010',other='00000000-0000-4000-8000-000000000020',key='00000000-0000-4000-8000-000000000030';
test('Badge projections preserve private salon, role, device and reference boundaries',async t=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;
 create table locations(id uuid,status text,public boolean);insert into locations values('${salon}','active',false),('${other}','active',true);
 create table reylumi_membership_versions(id uuid,config jsonb);insert into reylumi_membership_versions values('${key}','{"salon_member_badge":true}');
 create table reylumi_membership_terms(salon_id uuid,version_id uuid,starts_at timestamptz,ends_at timestamptz,cancelled_at timestamptz);insert into reylumi_membership_terms values('${salon}','${key}',now()-interval '1 day',now()+interval '1 day',null),('${other}','${key}',now()-interval '1 day',now()+interval '1 day',null);
 create function salon_profile_public_salon_exists(p uuid)returns boolean language sql as $$select public from locations where id=p$$;
 create function user_is_salon_member(p uuid)returns boolean language sql as $$select current_setting('test.actor',true)='owner' and p='${salon}'::uuid$$;
 create function tax_company_has_access(p uuid)returns boolean language sql as $$select current_setting('test.actor',true)='tax' and p='${salon}'::uuid$$;
 create function platform_admin_has_permission(p text)returns boolean language sql as $$select current_setting('test.actor',true)='admin' and p='admin.membership.read'$$;
 create function current_public_user_id()returns uuid language sql as $$select case when current_setting('test.actor',true)='customer' then '${key}'::uuid end$$;
 create table customers(location_id uuid,customer_user_id uuid);insert into customers values('${salon}','${key}');
 create function pos_portable_access_salon_id(p uuid,s text)returns uuid language sql as $$select case when p='${key}' and s='valid signature' then '${salon}'::uuid end$$;
 create table pos_live_drafts(salon_id uuid,token text,updated_at timestamptz);insert into pos_live_drafts values('${salon}','valid display token',now());
 create function get_pos_customer_display_settings_by_token(p text)returns jsonb language sql as $$select case when p='valid display token' then '{}'::jsonb end$$;
 create function service_relay_entry_catalog(p uuid)returns jsonb language sql as $$select case when p='${key}' then jsonb_build_object('salonId','${salon}') end$$;
 create table customer_visits(id uuid,salon_id uuid);insert into customer_visits values('${key}','${salon}');
 create function get_notification_visit(p uuid)returns jsonb language sql as $$select case when current_setting('test.actor',true)='customer' and p='${key}' then '{}'::jsonb end$$;
 create table salon_owner_transfer_invites(id uuid,salon_id uuid);insert into salon_owner_transfer_invites values('${key}','${salon}');
 create function list_my_owner_transfer_invites()returns jsonb language sql as $$select case when current_setting('test.actor',true)='invitee' then '[{"id":"${key}"}]'::jsonb else '[]'::jsonb end$$;
 create table customer_claim_tokens(salon_id uuid,token_hash text);insert into customer_claim_tokens values('${salon}','valid claim');
 create function customer_claim_token_hash(p text)returns text language sql as $$select p$$;
 create function get_customer_claim_token_preview(p text)returns jsonb language sql as $$select jsonb_build_object('ok',current_setting('test.actor',true)='customer' and p='valid claim')$$;`);
 await db.exec(fs.readFileSync('supabase/migrations/202611040002_membership_badge_scopes.sql','utf8'));
 const scoped=async(admin=false)=>(await db.query('select * from reylumi_membership_scoped_badges($1,$2)',[[salon,other],admin])).rows;
 const actor=async value=>db.query("select set_config('test.actor',$1,false)",[value]);
 const reference=async(kind,value)=>(await db.query('select * from reylumi_membership_reference_badge($1,$2)',[kind,value])).rows;
 await t.test('Anonymous direct internal helper and scoped RPC are closed',async()=>{await db.exec('set role anon');await assert.rejects(scoped(),/permission denied/);await assert.rejects(db.query('select * from reylumi_membership_eligible_badges($1)',[[salon]]),/permission denied/);await db.exec('reset role');});
 await t.test('Unrelated and revoked actors see public affiliation only; owner, linked customer and tax scopes see authorized private salon',async()=>{for(const who of ['unrelated','revoked']){await actor(who);assert.deepEqual((await scoped()).map(r=>r.salon_id),[other]);}for(const who of ['owner','tax','customer']){await actor(who);assert.equal((await scoped()).length,2);}});
 await t.test('Admin visibility needs the signed-session HTTP context and existing database read permission',async()=>{await actor('admin');assert.equal((await scoped(false)).length,1);assert.equal((await scoped(true)).length,2);await actor('unrelated');assert.equal((await scoped(true)).length,1);});
 await t.test('Portable signature grants exactly its salon and requested IDs, never unrelated IDs',async()=>{assert.equal((await db.query('select * from reylumi_membership_portable_badges($1,$2,$3)',[[salon,other],key,'valid signature'])).rows.length,1);assert.equal((await db.query('select * from reylumi_membership_portable_badges($1,$2,$3)',[[other],key,'valid signature'])).rows.length,0);assert.equal((await db.query('select * from reylumi_membership_portable_badges($1,$2,$3)',[[salon],key,'invalid'])).rows.length,0);});
 await t.test('Display/entry/visit/invitation/claim references delegate to their existing authority',async()=>{assert.equal((await reference('display','valid display token')).length,1);assert.equal((await reference('display','invalid')).length,0);assert.equal((await reference('entry',key)).length,1);assert.equal((await reference('entry','invalid')).length,0);await actor('unrelated');assert.equal((await reference('visit',key)).length,0);assert.equal((await reference('invitation',key)).length,0);assert.equal((await reference('claim','valid claim')).length,0);await actor('customer');assert.equal((await reference('visit',key)).length,1);assert.equal((await reference('claim','valid claim')).length,1);await actor('invitee');assert.equal((await reference('invitation',key)).length,1);assert.equal((await reference('unknown',key)).length,0);});
 await t.test('Private/device/reference access cannot extend expired or cancelled membership',async()=>{await db.exec("update reylumi_membership_terms set cancelled_at=now()");assert.equal((await reference('display','valid display token')).length,0);assert.equal((await scoped(true)).length,0);});
 }finally{await db.close();}
});
