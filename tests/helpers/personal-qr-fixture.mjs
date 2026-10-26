import fs from 'node:fs';
import { fixture as relayFixture, id } from './service-relay-fixture.mjs';
export { id };

function definition(file, name) {
 const sql=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n');const start=sql.indexOf('create or replace function public.'+name+'(');
 if(start<0)throw Error('Missing fixture dependency '+name);
 return sql.slice(start,sql.indexOf('$$;',start)+3);
}
export async function fixture(){
 const db=await relayFixture();
 await db.exec(`
 create role service_role;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 alter table users add display_name text,add first_name text,add last_name text,add email text,add phone text,add status text default 'active';
 insert into users(id,auth_user_id,display_name,email,phone) values('${id(100)}','${id(100)}','Anna Nguyen','anna@example.invalid','+15551234567'),('${id(101)}','${id(101)}','Other Customer','other@example.invalid','+15557654321'),('${id(90)}','${id(90)}','Owner',null,null);
 insert into auth.users select id,email,now() from users;
 alter table locations add status text default 'active',add phone text,add address_line1 text,add address_line2 text,add city text,add state text,add postal_code text,add country text;
 alter table customers alter column id set default gen_random_uuid();
 alter table customers add customer_user_id uuid,add phone text,add email text,add source text default 'manual',add status text default 'active',add created_by_user_id uuid,add updated_by_user_id uuid;
 alter table staff alter column id set default gen_random_uuid();
 alter table staff add first_name text,add last_name text,add email text,add phone text,add updated_at timestamptz;
 create table customer_verified_phones(user_id uuid,normalized_phone text);
 insert into customer_verified_phones values('${id(100)}','+15551234567');
 create function normalize_customer_claim_phone(text) returns text language sql immutable as $$select nullif(regexp_replace($1,'[^+0-9]','','g'),'')$$;
 create function customer_name_key(text) returns text language sql immutable as $$select lower(regexp_replace(coalesce($1,''),'[^a-zA-Z0-9]','','g'))$$;
 create or replace function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select auth.uid()='${id(90)}'::uuid and $1='${id(1)}'::uuid$$;
 alter table customer_visits alter column id set default gen_random_uuid();
 alter table customer_visits add source text default 'customer_screen',add appointment_id uuid;
 create unique index fixture_active_visit on customer_visits(salon_id,customer_id) where status in ('waiting','in_service','checkout');
 alter table pos_live_drafts add id uuid default gen_random_uuid();
 alter table services add online_booking_enabled boolean default true;
 create table bookings(id uuid primary key,salon_id uuid,customer_id uuid,start_at timestamptz,status text,confirmation_status text,updated_at timestamptz);
 create table booking_lines(id uuid primary key default gen_random_uuid(),booking_id uuid,salon_id uuid,service_id uuid,display_order integer,line_status text);
 create table booking_status_events(actor_source text,booking_id uuid,event_type text,metadata jsonb,new_status text,old_status text,salon_id uuid);
 create function get_salon_business_timezone(uuid) returns text language sql as $$select 'UTC'$$;
 create function customer_visit_normalize_booking_status(text) returns text language sql as $$select $1$$;
 create unique index fixture_visit_service on customer_visit_services(visit_id,service_id);
 create function customer_visit_public_payload(customer_visits,customers) returns jsonb language sql as $$select jsonb_build_object('id',($1).id)$$;
 create table checkin_receipt_subscriptions(salon_id uuid primary key,paid_until timestamptz);
 create table checkin_receipts(visit_id uuid primary key,salon_id uuid,business_date date,queue_number integer);
 insert into checkin_receipt_subscriptions values('${id(1)}',now()+interval '1 month');
 create table staff_salon_connection_requests(id uuid primary key default gen_random_uuid(),salon_id uuid,staff_id uuid,account_user_id uuid,direction text,status text default 'pending',initiated_by_user_id uuid,reviewed_by_user_id uuid,target_email_normalized text,target_phone_e164 text,token_hash text,requested_job_title text,message text,accepted_at timestamptz,declined_at timestamptz,cancelled_at timestamptz,revoked_at timestamptz,expires_at timestamptz,created_at timestamptz default now(),updated_at timestamptz);
 alter table pos_tickets add status text default 'closed',add ticket_number text default 'T00001',add opened_at timestamptz default now(),add closed_at timestamptz default now(),add discount_type text default 'fixed_amount',add discount_value numeric default 0,add tax_rate numeric default 0,add tip_type text default 'fixed_amount',add tip_value numeric default 0;
 create table salon_settings(salon_id uuid,business_name text,phone text,address_line1 text,address_line2 text,city text,state text,postal_code text,country text,public_profile_logo_path text,public_profile_cover_path text);
 create table pos_ticket_items(id uuid primary key default gen_random_uuid(),pos_ticket_id uuid,salon_id uuid,service_id uuid,assigned_staff_id uuid,performed_by_staff_id uuid,service_name_snapshot text,notes text,quantity numeric,unit_price numeric,line_total numeric,is_removed boolean default false,created_at timestamptz default now());
 create table pos_payments(id uuid primary key default gen_random_uuid(),ticket_id uuid,salon_id uuid,payment_method text,amount numeric,created_at timestamptz default now());
 `);
 // Exercise the installed visit-reuse implementation with its shipped phone-isolation patch.
 let reuse=definition('supabase/migrations/202608150008_customer_visit_requested_services.sql','create_or_reuse_customer_visit');
 const phone=reuse.indexOf('  if normalized_phone is not null then'),tail=reuse.indexOf('  select *\n  into visit_row',phone);
 reuse=reuse.slice(0,phone)+reuse.slice(tail);
 await db.exec(reuse);
 for(const name of ['find_customer_visit_arrival_appointment','sync_customer_visit_booking_checked_in'])await db.exec(definition('supabase/migrations/202608150004_customer_visits_waiting_list.sql',name));
 await db.exec(definition('supabase/migrations/202608150008_customer_visit_requested_services.sql','update_customer_visit_requested_services'));
 await db.exec(fs.readFileSync('supabase/migrations/20261025170000_staff_scan_workspace.sql','utf8'));
 await db.exec(definition('supabase/migrations/202608100001_customer_activity_history.sql','get_customer_activity_receipt'));
 // The existing financial writer is isolated: record its receipt contract and persist
 // realistic closed tickets/items/payments. No payment provider or production data.
 await db.exec(`create or replace function submit_owner_workspace_receipt_core(uuid,text,jsonb,date) returns jsonb language plpgsql as $$declare ticket uuid:=gen_random_uuid();line jsonb;subtotal numeric:=0;begin
 insert into core_calls values($3,'owner');insert into pos_tickets(id,salon_id,customer_id,tip_value,discount_value) values(ticket,$1,($3->>'customerId')::uuid,coalesce(($3->>'tipAmount')::numeric,0),coalesce(($3->>'discountValue')::numeric,0));
 for line in select value from jsonb_array_elements($3->'lines') loop subtotal:=subtotal+(line->>'total')::numeric;insert into pos_ticket_items(pos_ticket_id,salon_id,service_id,assigned_staff_id,service_name_snapshot,quantity,unit_price,line_total) values(ticket,$1,(line->>'serviceId')::uuid,(line->>'staffId')::uuid,line->>'serviceLabel',1,(line->>'total')::numeric,(line->>'total')::numeric);end loop;
 insert into pos_payments(ticket_id,salon_id,payment_method,amount) values(ticket,$1,'cash',subtotal+coalesce(($3->>'tipAmount')::numeric,0)-coalesce(($3->>'discountValue')::numeric,0));return jsonb_build_object('ticketId',ticket);end$$;`);
 for(const name of ['staff_connection_invite_phone_status','staff_connection_invite_identity_status','apply_staff_connection_invite_decision']){
  await db.exec(definition('supabase/migrations/202608180006_staff_connection_phone_identity.sql',name));
 }
 await db.exec(fs.readFileSync('supabase/migrations/20261025190000_personal_qr.sql','utf8'));
 await db.exec('create table checkin_receipt_counters(salon_id uuid,business_date date,last_number integer,primary key(salon_id,business_date))');
 const receipts=fs.readFileSync('supabase/migrations/202610080007_checkin_receipt_plugin.sql','utf8');
 const issue=receipts.indexOf('create function public.issue_checkin_receipt(');
 await db.exec(receipts.slice(issue,receipts.indexOf('$$;',issue)+3));
 await db.exec(fs.readFileSync('supabase/migrations/20261025200000_qr_flow_integration.sql','utf8'));
 return db;
}
export const actor=(db,n)=>db.query("select set_config('test.actor',$1,false)",[n===null?'':id(n)]);
