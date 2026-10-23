import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

export async function setupPhoneClaims() {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table users(id uuid primary key default gen_random_uuid(),status text default 'active',display_name text,email text);
 create table accounts(id uuid primary key default gen_random_uuid(),name text,status text default 'active');
 create table locations(id uuid primary key default gen_random_uuid(),account_id uuid references accounts(id),name text,status text default 'active',phone text,address_line1 text,address_line2 text,city text,state text,postal_code text);
 create table roles(id uuid primary key default gen_random_uuid(),account_id uuid,code text,unique(account_id,code));
 create table account_memberships(id uuid primary key default gen_random_uuid(),account_id uuid,user_id uuid,role_id uuid,status text,joined_at timestamptz,unique(account_id,user_id));
 create table salon_memberships(id uuid primary key default gen_random_uuid(),account_id uuid,salon_id uuid,user_id uuid,role_id uuid,status text,joined_at timestamptz,unique(salon_id,user_id));
 create table salon_directory_listings(salon_id uuid primary key,claim_state text default 'unclaimed',source_type text,collected_on date,claimed_by_user_id uuid,claimed_at timestamptz);
 create table salon_payroll_settings(salon_id uuid primary key);
 create table booking_settings(salon_id uuid primary key,booking_enabled boolean default false);
 create function normalize_salon_lifecycle_status(text) returns text language sql immutable as $$select $1$$;
 create function salon_profile_public_salon_exists(uuid) returns boolean language sql stable as $$select exists(select 1 from locations where id=$1 and status='active')$$;
 create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function platform_admin_has_permission(text) returns boolean language sql stable as $$select coalesce(current_setting('test.admin',true),'')='yes'$$;
 create function seed_default_roles_for_account(uuid) returns void language sql as $$insert into roles(account_id,code) values($1,'OWNER') on conflict do nothing$$;`);
 await db.exec(fs.readFileSync('supabase/migrations/202610050006_business_claims.sql','utf8'));
 // Apply the installed review migration's actual function transformation, not
 // just its status constraint: needs_info must remain on the manual review path.
 await db.exec("alter table business_claim_requests drop constraint business_claim_requests_status_check;alter table business_claim_requests add check(status in ('otp_pending','waiting','needs_info','approved','rejected','expired'));drop index business_claim_one_open_per_user;create unique index business_claim_one_open_per_user on business_claim_requests(salon_id,applicant_user_id) where status in ('otp_pending','waiting','needs_info');");
 const review=fs.readFileSync('supabase/migrations/20261008233001_review_case_communication.sql','utf8');
 const start=review.indexOf('do $$declare sig text; definition text; begin'),end=review.indexOf('end $$;',start);
 if(start<0||end<start)throw Error('Installed review transformation not found');
 await db.exec(review.slice(start,end+'end $$;'.length));
 const hardening=fs.readFileSync('supabase/migrations/20261008233002_review_communication_hardening.sql','utf8');
 const hardStart=hardening.indexOf('do $$declare definition text; begin'),hardEnd=hardening.indexOf(' -- Histories remain readable',hardStart);
 if(hardStart<0||hardEnd<hardStart)throw Error('Installed claim hardening not found');
 await db.exec(hardening.slice(hardStart,hardEnd)+'end $$;');
 return db;
}
let phoneIndex=1000000;
export async function person(db,status='active') {const id=randomUUID();await db.query('insert into users(id,status) values($1,$2)',[id,status]);return id;}
export async function salon(db,{source='directory',old=true,phone=`+1555${++phoneIndex}`}={}) {
 const account=randomUUID(),id=randomUUID();await db.query("insert into accounts(id,name) values($1,'Drayko isolated fixture')",[account]);
 await db.query("insert into locations(id,account_id,name,phone) values($1,$2,'Drayko fixture',$3)",[id,account,phone]);
 await db.query("insert into salon_directory_listings(salon_id,source_type,collected_on) values($1,$2,current_date-($3::int))",[id,source,old?365:0]);
 await db.query('insert into booking_settings(salon_id) values($1)',[id]);return {id,account,phone};
}
export async function reserve(db,s,u) {const r=(await db.query("select begin_business_claim($1,$2,'call') r",[s.id,u])).rows[0].r;const sid='VE-'+randomUUID();await db.query('select attach_business_claim_challenge($1,$2,$3,$4)',[r.id,u,r.last_sent_at,sid]);return {...r,sid,user:u,salon:s};}
export async function confirm(db,r) {await db.query('select reserve_business_claim_check($1,$2)',[r.id,r.user]);return (await db.query('select confirm_business_claim($1,$2,$3) r',[r.id,r.user,r.sid])).rows[0].r;}
export async function row(db,id) {return (await db.query('select * from business_claim_requests where id=$1',[id])).rows[0];}
export const patch=()=>fs.readFileSync('supabase/migrations/20261023170000_phone_claim_first_owner.sql','utf8');
