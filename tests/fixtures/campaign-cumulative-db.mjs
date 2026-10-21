import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const ids=Object.freeze({owner:'00000000-0000-0000-0000-000000000001',viewer:'00000000-0000-0000-0000-000000000002',salon:'10000000-0000-0000-0000-000000000001',post:'20000000-0000-0000-0000-000000000001',campaign:'30000000-0000-0000-0000-000000000001',nonce:'40000000-0000-0000-0000-000000000001'});
export const baseMigrations=Object.freeze([
 '202610080002_owner_campaigns.sql','202610080003_payroll_data_plugin.sql',
 '202610080004_campaign_market_credits.sql','20261017210000_owner_campaign_workspace.sql',
 '20261017235000_campaign_admin_operations.sql','20261018230000_campaign_admin_workspace.sql',
 '20261019170000_campaign_local_rotation.sql','20261021010000_campaign_selection_daily_cap.sql',
 '20261021020000_campaign_search_relevance.sql','20261021030000_campaign_geo_alias_compat.sql',
]);
export const readCampaignMigration=file=>fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
export function readCampaignNotificationPrerequisite(){
 const source=readCampaignMigration('202610020003_notification_center.sql');
 const stop=source.indexOf('create index if not exists notifications_scope_created_idx');
 if(stop<0||!source.slice(0,stop).includes('create trigger notification_preference_delivery'))throw Error('Notification prerequisite boundary changed.');
 // Actual preference table/RLS, category, delivery and insertion filter only.
 // Later feed/index/booking producers need unrelated production prerequisites.
 return source.slice(0,stop)+'\ncommit;';
}

// Full Campaign migrations and triggers over disposable prerequisite tables.
// The external pg_net/cron scheduler is deliberately excluded. No network/Stripe.
export async function createCampaignCumulativeDb({migrations=[],seed=true}={}){
 const db=new PGlite();
 const {owner,viewer,salon,post,campaign}=ids;
 try{
  await db.exec(`
   create role anon;create role authenticated;create role service_role;
   create table users(id uuid primary key,email text);
   create table accounts(id uuid primary key,status text);
   create table locations(id uuid primary key,status text,account_id uuid,name text);
   create table app_notifications(id uuid primary key default gen_random_uuid(),account_id uuid,salon_id uuid,recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text);
   create unique index notice_event_once on app_notifications(recipient_user_id,event_key) where event_key is not null;
   create table salon_settings(salon_id uuid,public_discovery_enabled boolean);
   create table beauty_profiles(id uuid,visibility text);
   create table bookings(id uuid primary key,customer_user_id uuid,source_reference_id uuid,source_reference_type text,status text,confirmation_status text,salon_id uuid,created_at timestamptz default now());
   create table salon_profile_looks(id uuid primary key,salon_id uuid,title text,caption text,status text,author_user_id uuid,safety_hold boolean default false,deleted_at timestamptz);
   create table salon_profile_updates(like salon_profile_looks including all);
   create table salon_profile_look_saves(id uuid primary key,user_id uuid,look_id uuid);
   create table account_post_saves(id uuid primary key,user_id uuid,source_type text,source_id uuid);
   create table salon_profile_comments(id uuid primary key,author_user_id uuid,look_id uuid,update_id uuid,beauty_post_id uuid,status text,is_salon_reply boolean);
   create table salon_profile_booking_requests(id uuid primary key,customer_user_id uuid,look_id uuid,status text);
   create table beauty_posts(like salon_profile_looks including all);
   alter table beauty_posts add column visibility text;alter table beauty_posts add column moderation_status text;
   create function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$select $1='${salon}'::uuid and $2='${owner}'::uuid$$;
   create function post_safety_table(text) returns text language sql as $$select case $1 when 'beauty_post' then 'beauty_posts' when 'salon_profile_look' then 'salon_profile_looks' when 'salon_profile_update' then 'salon_profile_updates' end$$;
   create function current_public_user_id() returns uuid language sql as $$select null::uuid$$;
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table platform_admin_permissions(id uuid default gen_random_uuid(),code text unique,name text,description text,category text);
   create table platform_admin_roles(id uuid,slug text);
   create table platform_admin_role_permissions(role_id uuid,permission_id uuid,primary key(role_id,permission_id));
   create table explore_salon_documents(salon_id uuid,salon_name_search text,service_search_text text,service_category_search_text text);
   create table explore_unified_content_source(salon_id uuid,source_type text,content_id uuid,is_reference boolean,search_terms tsvector);
   insert into users values('${owner}','owner@example.invalid'),('${viewer}','viewer@example.invalid');
   insert into accounts values('${salon}','active');
   insert into locations values('${salon}','active','${salon}','Fixture Nails');
   insert into salon_settings values('${salon}',true);
  `);
  await db.exec(readCampaignNotificationPrerequisite());
  for(const file of [...baseMigrations,...migrations])await db.exec(readCampaignMigration(file));
  if(seed){
   await db.exec(`insert into salon_profile_looks values('${post}','${salon}','Red nails','Gel manicure','published','${owner}',false,null);
    insert into explore_salon_documents values('${salon}','Fixture Nails','gel manicure','Nails');
    insert into explore_unified_content_source values('${salon}','salon_profile_look','${post}',false,to_tsvector('english','red nails'));`);
   await db.query('select campaign_plugin_set($1,$2,true)',[salon,owner]);
   await db.query("select campaign_create_versioned(1,$1,$2,$3,'salon_profile_look',$4,'city','Milwaukee','United States','Wisconsin','Milwaukee',500,3,300,false,false)",[campaign,salon,owner,post]);
   await db.query('select campaign_credit_fund($1,$2,$3,false)',[campaign,salon,owner]);
   await db.query('select owner_campaign_review($1,true)',[campaign]);
   await db.exec("update owner_campaigns set starts_at=now()-interval '1 day'");
  }
  return db;
 }catch(error){await db.close();throw error;}
}
