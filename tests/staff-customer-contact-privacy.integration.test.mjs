import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const migration='supabase/migrations/20261105210000_staff_customer_contact_visibility.sql';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function fixture(){
 const db=new PGlite();
 const daily=fs.readFileSync('tests/staff-daily-snapshot.test.mjs','utf8');
 const setup=daily.match(/await db.exec\(`([\s\S]*?)`\);/)[1].replace(/\$\{id\((\d+)\)\}/g,(_,n)=>id(n));
 await db.exec(setup);
 await db.exec(`create schema extensions;
 create table salon_settings(salon_id uuid primary key,business_name text,staff_booking_creation_enabled boolean default true);
 create table locations(id uuid primary key,name text);
 insert into locations values('${id(20)}','Salon A'),('${id(21)}','Salon B');
 alter table customers add column status text default 'active';
 insert into customers(id,location_id,name,phone,email) values
 ('${id(60)}','${id(20)}','Linh','(312) 555-1234','linh@example.test'),
 ('${id(61)}','${id(21)}','Other salon','3125551234','other@example.test'),
 ('${id(62)}','${id(20)}','Inactive','3125551234','inactive@example.test');
 update customers set status='inactive' where id='${id(62)}';
 update pos_tickets set customer_id='${id(60)}';
 create table bookings(id uuid primary key,salon_id uuid,customer_id uuid,no_show_reason text);
 create table booking_lines(booking_id uuid,salon_id uuid,assigned_staff_id uuid);
 insert into bookings values('${id(70)}','${id(20)}','${id(60)}','Customer supplied note');
 insert into booking_lines values('${id(70)}','${id(20)}','${id(10)}');
 create function booking_no_show_history(uuid,uuid) returns jsonb language sql as $$select '[{}]'::jsonb$$;
 create function current_user_staff_id_for_salon(uuid) returns uuid language sql as $$select id from staff where salon_id=$1 and account_user_id=current_public_user_id() and is_active$$;
 create function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$select $1='${id(20)}'::uuid and $2='${id(90)}'::uuid$$;
 create function user_can_manage_salon(uuid) returns boolean language sql as $$select current_public_user_id() in ('${id(90)}'::uuid,'${id(91)}'::uuid) and $1='${id(20)}'::uuid$$;
 create function normalize_search_text(text) returns text language sql immutable as $$select lower($1)$$;
 create function salon_staff_booking_creation(p_salon uuid) returns jsonb language sql as $$select jsonb_build_object('enabled',coalesce((select staff_booking_creation_enabled from salon_settings where salon_id=p_salon),true))$$;
 create function staff_booking_creation_catalog(p_salon uuid) returns jsonb language plpgsql as $$declare context jsonb;begin
 context:=salon_staff_booking_creation(p_salon);
 return context||jsonb_build_object('staffId',current_user_staff_id_for_salon(p_salon),'services',jsonb_build_array('Manicure'),'timezone','America/Chicago');end$$;
 -- Resolver boundary fixture: the real scheduling engine is unchanged by this migration.
 create function create_staff_appointment(p_salon uuid,p_input jsonb) returns jsonb language plpgsql as $$
 declare customer_phone text:=p_input->>'phone';customer uuid;begin
 select c.id into customer from customers c where c.id=(p_input->>'customerId')::uuid and c.location_id=p_salon
 and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g');
 return jsonb_build_object('customerId',customer,'services',p_input->'serviceIds','note',p_input->>'note');end$$;
 `);
 await db.exec(fs.readFileSync('supabase/migrations/202609250001_staff_daily_snapshot.sql','utf8'));
 const contacts=fs.readFileSync('supabase/migrations/202610020002_staff_appointment_details.sql','utf8').split('create or replace function public.report_assigned_booking_no_show')[0].replace('begin;','');
 await db.exec(contacts);
 await db.exec(fs.readFileSync(migration,'utf8'));
 return db;
}
const actor=(db,n)=>db.query("select set_config('test.user',$1,false)",[n?id(n):'']);
const setting=(db,value)=>db.query('select salon_staff_customer_contacts($1,$2) result',[id(20),value]);
const snapshot=async db=>(await db.query('select get_my_staff_daily_snapshot($1) result',[id(20)])).rows[0].result;
const contacts=async db=>(await db.query('select get_assigned_booking_contacts($1) result',[[id(70)]])).rows[0].result;
const search=async(db,q,salon=20)=>(await db.query('select staff_booking_customer_suggestions($1,$2) result',[id(salon),q])).rows[0].result;
function withoutContact(s){return JSON.parse(JSON.stringify(s),(k,v)=>['phone','email'].includes(k)?null:v)}

test('Owner switch changes only contact projections; names, earnings, services and notes stay identical',async()=>{
 const db=await fixture();try{
 await actor(db,1);const before=await snapshot(db),beforeContacts=await contacts(db);
 assert.equal(before.earnings[0].ticket.customer.phone,'(312) 555-1234');
 assert.equal(beforeContacts[id(70)].customerContactVisible,true);
 await actor(db,90);await setting(db,false);await actor(db,1);
 const after=await snapshot(db),afterContacts=await contacts(db);
 assert.deepEqual(after,withoutContact(before));
 assert.equal(after.earnings[0].ticket.customer.name,'Linh');
 assert.equal(afterContacts[id(70)].customerPhone,null);
 assert.equal(afterContacts[id(70)].customerContactVisible,false);
 assert.equal(afterContacts[id(70)].noShowReason,beforeContacts[id(70)].noShowReason);
 assert.equal(afterContacts[id(70)].noShowCount,beforeContacts[id(70)].noShowCount);
 assert.deepEqual((await db.query('select phone,email from customers where id=$1',[id(60)])).rows[0],{phone:'(312) 555-1234',email:'linh@example.test'});
 await actor(db,90);await setting(db,true);await actor(db,1);
 assert.deepEqual(await snapshot(db),before);assert.deepEqual(await contacts(db),beforeContacts);
 }finally{await db.close()}
});

test('Disabled lookup requires exact complete number, returns name only, and stays salon-scoped',async()=>{
 const db=await fixture();try{
 await actor(db,90);await setting(db,false);await actor(db,1);
 for(const q of ['Li','Linh','312','5551234','%3125551234','31255512345','3125551234abc','312555123'])assert.deepEqual(await search(db,q),[],q);
 for(const q of ['3125551234','(312) 555-1234','+1 312 555 1234'])assert.deepEqual(await search(db,q),[{id:id(60),name:'Linh',phone:null}]);
 await assert.rejects(search(db,'3125551234',21),/Active staff/);
 const input={customerId:id(60),phone:'+1 312 555 1234',serviceIds:['unchanged'],note:'Keep this'};
 const bound=(await db.query('select create_staff_appointment($1,$2) result',[id(20),JSON.stringify(input)])).rows[0].result;
 assert.equal(bound.customerId,id(60));assert.deepEqual(bound.services,['unchanged']);assert.equal(bound.note,'Keep this');
 input.phone='3125559999';assert.equal((await db.query('select create_staff_appointment($1,$2) result',[id(20),JSON.stringify(input)])).rows[0].result.customerId,null);
 await actor(db,90);await setting(db,true);await actor(db,1);
 assert.equal((await search(db,'Li'))[0].phone,'(312) 555-1234');
 await actor(db,90);await db.exec(`update salon_settings set staff_booking_creation_enabled=false where salon_id='${id(20)}'`);await actor(db,1);
 await assert.rejects(search(db,'3125551234'),/turned off/);
 }finally{await db.close()}
});

test('Staff, manager, anonymous and another salon cannot change the setting or use private helpers',async()=>{
 const db=await fixture();try{
 for(const who of [1,91,2]){await actor(db,who);await assert.rejects(setting(db,false),/Only the salon owner/)}
 await actor(db,null);await assert.rejects(setting(db,false),/Sign in/);
 await actor(db,1);await assert.rejects(db.exec(`insert into salon_settings(salon_id,business_name,staff_customer_contacts_visible) values('${id(20)}','Salon',false)`),/Only the salon owner/);
 await actor(db,90);await setting(db,false);await actor(db,1);
 await assert.rejects(db.exec(`update salon_settings set staff_customer_contacts_visible=true where salon_id='${id(20)}'`),/Only the salon owner/);
 await db.exec('grant usage on schema public,auth to authenticated; set role authenticated');
 await assert.rejects(db.query('select staff_customer_contacts_enabled($1)',[id(20)]),/permission denied/);
 await assert.rejects(db.query('select staff_customer_phone_key($1)',['3125551234']),/permission denied/);
 assert.equal((await snapshot(db)).earnings[0].ticket.customer.phone,null);
 await actor(db,2);assert.deepEqual(await contacts(db),{});
 await db.exec('reset role');await actor(db,90);
 await assert.rejects(db.query('select salon_staff_customer_contacts($1,false)',[id(21)]),/Salon access denied/);
 }finally{await db.close()}
});

test('Catalog changes only visibility metadata; different salon and missing settings keep default behavior',async()=>{
 const db=await fixture();try{
 await actor(db,1);const read=async()=> (await db.query('select staff_booking_creation_catalog($1) result',[id(20)])).rows[0].result;
 const before=await read();assert.equal(before.customerContactVisible,true);
 await actor(db,90);await setting(db,false);await actor(db,1);const after=await read();
 assert.deepEqual({...after,customerContactVisible:true},before);
 await actor(db,null);await assert.rejects(search(db,'3125551234'),/Active staff/);
 assert.equal((await db.query('select staff_customer_contacts_enabled($1) result',[id(21)])).rows[0].result,true);
 }finally{await db.close()}
});
