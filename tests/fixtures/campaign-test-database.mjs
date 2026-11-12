import fs from "node:fs";
import {PGlite} from "@electric-sql/pglite";
export const owner="00000000-0000-0000-0000-000000000001",stranger="00000000-0000-0000-0000-000000000002",salon="10000000-0000-0000-0000-000000000001",post="20000000-0000-0000-0000-000000000001";
export async function campaignTestDatabase(){const db=new PGlite();await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table users(id uuid primary key,email text);
      create table accounts(id uuid primary key,status text);insert into accounts values('${salon}','active');
      create table locations(id uuid primary key,status text,account_id uuid);
      create table app_notifications(id uuid primary key default gen_random_uuid(),account_id uuid,salon_id uuid,recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text);
      create unique index notice_event_once on app_notifications(recipient_user_id,event_key) where event_key is not null;
      create table salon_settings(salon_id uuid,public_discovery_enabled boolean);insert into salon_settings values('${salon}',true);
      create table beauty_profiles(id uuid,visibility text);
      create table bookings(id uuid primary key,customer_user_id uuid,source_reference_id uuid,source_reference_type text,status text,confirmation_status text,salon_id uuid,created_at timestamptz default now());
      create table salon_profile_looks(id uuid primary key,salon_id uuid,title text,caption text,status text,author_user_id uuid,safety_hold boolean default false,deleted_at timestamptz);
      create table salon_profile_updates(like salon_profile_looks including all);
      create table salon_profile_look_saves(id uuid primary key,user_id uuid,look_id uuid);
      create table account_post_saves(id uuid primary key,user_id uuid,source_type text,source_id uuid);
      create table salon_profile_comments(id uuid primary key,author_user_id uuid,look_id uuid,update_id uuid,beauty_post_id uuid,status text,is_salon_reply boolean);
      create table salon_profile_booking_requests(id uuid primary key,customer_user_id uuid,look_id uuid,status text);
      create table beauty_posts(like salon_profile_looks including all); alter table beauty_posts add column visibility text; alter table beauty_posts add column moderation_status text;
      create function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$ select ($1='${salon}'::uuid and $2='${owner}'::uuid) or ($1='10000000-0000-0000-0000-000000000002'::uuid and $2='${stranger}'::uuid) $$;
      create function post_safety_table(text) returns text language sql as $$ select case $1 when 'beauty_post' then 'beauty_posts' when 'salon_profile_look' then 'salon_profile_looks' when 'salon_profile_update' then 'salon_profile_updates' end $$;
      insert into users values('${owner}','one@example.com'),('${stranger}','two@example.com'); insert into locations values('${salon}','active','${salon}');
    
 create function current_public_user_id() returns uuid language sql as $$select null::uuid$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
`);
for(const file of ['202610080002_owner_campaigns.sql','202610080003_payroll_data_plugin.sql','202610080004_campaign_market_credits.sql','20261017210000_owner_campaign_workspace.sql'])await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
return db;}
