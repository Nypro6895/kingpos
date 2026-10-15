import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

// Execute repository SQL against an ephemeral database with synthetic fixtures.
// Auth, profile and notification delivery are outside this narrowly scoped harness.
const migration = name => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const salon=id(1), staff=id(2), service=id(3), booking=id(4), line=id(5), other=id(6);
function sqlFunction(source, name) {
  const start=source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start>=0, `Missing SQL function ${name}`);
  const end=source.indexOf('$$;',start);
  assert.ok(end>=0);
  return source.slice(start,end+3);
}

test('SQL guards reject overlaps and time off, reschedule atomically, and release cancelled slots',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try {
  await db.exec(`create role anon;create role authenticated;create schema extensions;
   create table locations(id uuid primary key);
   create table staff(id uuid primary key,salon_id uuid,is_active boolean default true);
   create table services(id uuid primary key,salon_id uuid,is_active boolean default true,duration_minutes integer);
   create table booking_settings(salon_id uuid,timezone_iana text,default_cleanup_buffer_minutes integer,cancellation_window_minutes integer);
   create table staff_service_assignments(salon_id uuid,staff_id uuid,service_id uuid,is_active boolean default true,effective_start_date date,effective_end_date date,custom_duration_minutes integer);
   create table staff_availability_rules(salon_id uuid,staff_id uuid,is_active boolean default true,rule_type text default 'working',day_of_week integer,starts_at_local time,ends_at_local time,effective_start_date date,effective_end_date date);
   create table staff_time_blocks(salon_id uuid,staff_id uuid,is_active boolean default true,starts_at timestamptz,ends_at timestamptz);
   create table bookings(id uuid primary key,salon_id uuid,status text default 'confirmed',confirmation_status text default 'confirmed',start_at timestamptz,end_at timestamptz,customer_cancellation_token_hash text,cancellation_policy_snapshot jsonb default '{}',cancellation_reason text,cancelled_at timestamptz);
   create table booking_lines(id uuid primary key,booking_id uuid,salon_id uuid,assigned_staff_id uuid,service_id uuid,line_status text default 'scheduled',scheduled_start_at timestamptz,scheduled_end_at timestamptz,overbooking_override_reason text,overbooking_override_by_user_id uuid);
   create table booking_status_events(salon_id uuid,booking_id uuid,event_type text,old_status text,new_status text,actor_source text);
   create function get_salon_business_timezone(uuid) returns text language sql as $$select 'America/Chicago'::text$$;
   create function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select false$$;`);
  const scheduler=migration('202609240002_booking_scheduler_touch');
  await db.exec(scheduler.slice(scheduler.indexOf('create or replace function public.booking_staff_available('),scheduler.indexOf('create or replace function public.create_pos_portable_appointment_v2(')));
  await db.exec(sqlFunction(migration('202607240001_account_salon_baseline'),'reschedule_public_booking_by_manage_token'));
  await db.exec(sqlFunction(migration('202609240004_booking_lifecycle_policy'),'cancel_public_booking_by_manage_token'));
  await db.exec(`insert into locations values('${salon}');insert into staff(id,salon_id)values('${staff}','${salon}');
   insert into services(id,salon_id,duration_minutes)values('${service}','${salon}',30);
   insert into booking_settings values('${salon}','America/Chicago',15,1440);
   insert into staff_service_assignments(salon_id,staff_id,service_id)values('${salon}','${staff}','${service}');
   insert into staff_availability_rules(salon_id,day_of_week,starts_at_local,ends_at_local)select '${salon}',n,'08:00','18:00' from generate_series(0,6)n;`);
  const start=(await db.query("select (((statement_timestamp() at time zone 'America/Chicago')::date+3)+time '09:00') at time zone 'America/Chicago' as start")).rows[0].start;
  const at=minutes=>new Date(+new Date(start)+minutes*60000).toISOString();
  const addBooking=(bid,token,minutes)=>db.query('insert into bookings(id,salon_id,start_at,end_at,customer_cancellation_token_hash)values($1,$2,$3,$4,$5)',[bid,salon,at(minutes),at(minutes+45),token]);
  const addLine=(lid,bid,minutes,duration=45)=>db.query('insert into booking_lines(id,booking_id,salon_id,assigned_staff_id,service_id,scheduled_start_at,scheduled_end_at)values($1,$2,$3,$4,$5,$6,$7)',[lid,bid,salon,staff,service,at(minutes),at(minutes+duration)]);
  const available=async minutes=>(await db.query('select booking_staff_available($1,$2,$3,$4,$5) as available',[salon,staff,service,at(minutes),at(minutes+45)])).rows[0].available;
  await addBooking(booking,'fixture-token',0);await addLine(line,booking,0);
  assert.equal(await available(0),false);
  assert.equal(await available(45),true,'adjacent half-open intervals are bookable');
  await addBooking(other,'other-token',15);
  await assert.rejects(addLine(id(7),other,15),/unavailable|just booked/);
  await assert.rejects(addLine(id(8),other,90,30),/cleanup buffer/);
  await db.query('insert into staff_time_blocks(salon_id,staff_id,starts_at,ends_at)values($1,$2,$3,$4)',[salon,staff,at(120),at(165)]);
  assert.equal(await available(120),false,'time off is unavailable');
  await addLine(id(9),other,60);
  await assert.rejects(db.query('select reschedule_public_booking_by_manage_token($1,$2)',['fixture-token',at(60)]),/unavailable|just booked/);
  assert.equal(new Date((await db.query('select start_at from bookings where id=$1',[booking])).rows[0].start_at).toISOString(),at(0),'failed move rolls back header and line writes');
  const moved=(await db.query('select reschedule_public_booking_by_manage_token($1,$2) as result',['fixture-token',at(180)])).rows[0].result;
  assert.equal(moved.ok,true);assert.equal(await available(0),true);assert.equal(await available(180),false);
  const invalid=(await db.query('select cancel_public_booking_by_manage_token($1) as result',['wrong-token'])).rows[0].result;
  assert.equal(invalid.code,'invalid_token');
  await db.query('update bookings set cancellation_policy_snapshot=$1 where id=$2',[JSON.stringify({cancellationWindowMinutes:10000}),booking]);
  const late=(await db.query('select cancel_public_booking_by_manage_token($1) as result',['fixture-token'])).rows[0].result;
  assert.equal(late.code,'cancellation_window_closed');
  await db.query("update bookings set cancellation_policy_snapshot='{}' where id=$1",[booking]);
  assert.equal((await db.query('select cancel_public_booking_by_manage_token($1) as result',['fixture-token'])).rows[0].result.ok,true);
  assert.equal(await available(180),true,'cancellation releases the reservation');
  assert.equal((await db.query('select reschedule_public_booking_by_manage_token($1,$2) as result',['fixture-token',at(240)])).rows[0].result.code,'not_changeable');
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from booking_staff_reservations'),/permission denied/);
 }finally{await db.close();}
});
