import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const salon=id(1),parent=id(2),staff=id(3),legacy=id(4),booking=id(5);
const migration=readFileSync('supabase/migrations/20261017220000_service_owned_addon_groups.sql','utf8');
const baseline=readFileSync('supabase/migrations/202607240001_account_salon_baseline.sql','utf8');
const start=baseline.indexOf('create or replace function public.save_service_config_batch(');
const oldSave=baseline.slice(start,baseline.indexOf('$$;',start)+3);

test('owned add-ons save atomically, preserve history/overrides, inherit staff, enforce booking groups and totals',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;
      create table locations(id uuid primary key);
      create table services(id uuid primary key default gen_random_uuid(),salon_id uuid,name text not null,category text,base_price numeric default 0,duration_minutes integer default 30,description text,is_active boolean default true,online_booking_enabled boolean default true,created_at timestamptz default now());
      create table service_add_on_links(id uuid default gen_random_uuid(),salon_id uuid,parent_service_id uuid,add_on_service_id uuid,display_order integer,is_active boolean,unique(parent_service_id,add_on_service_id));
      create table staff_service_assignments(salon_id uuid,staff_id uuid,service_id uuid,is_active boolean,online_bookable boolean,custom_price numeric,custom_duration_minutes integer,effective_start_date date,effective_end_date date,unique(staff_id,service_id));
      create table booking_lines(id uuid primary key default gen_random_uuid(),booking_id uuid,salon_id uuid,service_id uuid,line_type text,parent_booking_line_id uuid,assigned_staff_id uuid,unit_price numeric,quantity integer default 1,line_total numeric,duration_minutes integer,display_order integer,line_status text default 'scheduled');
      create function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select true$$;
      create function salon_profile_public_salon_exists(uuid) returns boolean language sql as $$select true$$;
      insert into services(id,salon_id,name,category,base_price,duration_minutes) values('${parent}','${salon}','Spa pedi','Pedicure',40,45),('${legacy}','${salon}','Legacy gel','Pedicure',15,15);
      insert into staff_service_assignments values('${salon}','${staff}','${parent}',true,true,42,50,'2026-01-01','2027-12-31'),('${salon}','${staff}','${legacy}',true,true,16,17,null,null);`);
    await db.exec(oldSave);
    await db.exec(migration);
    const config={service_id:parent,name:'Spa pedi',category:'pedicure',base_price:40,duration_minutes:45,is_active:true,online_booking_enabled:true,booking_staff_ids:[staff],add_on_service_ids:[],booking_add_ons:[
      {service_id:legacy,name:'Gel polish',selection_group:'one',base_price:15,duration_minutes:15},
      {name:'French polish',selection_group:'one',base_price:10,duration_minutes:10},
      {name:'Massage',selection_group:'many',base_price:10,duration_minutes:10},
      {name:'Paraffin',selection_group:'many',base_price:12,duration_minutes:10},
    ]};
    const save=async value=>(await db.query('select save_owned_service_config_batch($1,$2) as result',[salon,JSON.stringify([value])])).rows[0].result;
    assert.equal((await save(config)).ok,true);
    let children=(await db.query('select * from services where booking_parent_service_id=$1 order by name',[parent])).rows;
    assert.equal(children.length,4);
    const gel=children.find(x=>x.name==='Gel polish'),french=children.find(x=>x.name==='French polish'),massage=children.find(x=>x.name==='Massage'),paraffin=children.find(x=>x.name==='Paraffin');
    assert.notEqual(gel.id,legacy,'legacy service copied, not reclassified');
    assert.equal((await db.query('select name from services where id=$1',[legacy])).rows[0].name,'Legacy gel');
    assert.deepEqual((await db.query('select custom_price,custom_duration_minutes from staff_service_assignments where service_id=$1',[parent])).rows[0],{custom_price:'42',custom_duration_minutes:50});
    assert.deepEqual((await db.query("select effective_start_date::text start,effective_end_date::text finish from staff_service_assignments where service_id=$1",[gel.id])).rows[0],{start:'2026-01-01',finish:'2027-12-31'},'child inherits retained parent assignment date limits');
    assert.equal((await db.query('select count(*)::int n from staff_service_assignments where service_id=any($1) and is_active and online_bookable',[children.map(x=>x.id)])).rows[0].n,4);
    assert.equal((await db.query('select count(*)::int n from get_public_salon_profile_services($1)',[salon])).rows[0].n,2,'owned children hidden from main profile menu');
    const addLine=async(sid,type='add_on')=>(await db.query(`insert into booking_lines(booking_id,salon_id,service_id,line_type,assigned_staff_id,unit_price,line_total,duration_minutes,display_order) values($1,$2,$3,$4,$5,0,0,1,0) returning *`,[booking,salon,sid,type,staff])).rows[0];
    await assert.rejects(addLine(gel.id),/attached/,'cannot book an extra without its parent');
    const mainLine=await addLine(parent,'service');
    assert.equal(mainLine.unit_price,'42');assert.equal(mainLine.duration_minutes,50);
    const gelLine=await addLine(gel.id);assert.equal(gelLine.parent_booking_line_id,mainLine.id);
    assert.equal(gelLine.unit_price,'16');assert.equal(gelLine.duration_minutes,17,'legacy staff overrides retained on cloned add-on');
    await assert.rejects(addLine(french.id),/at most one/);
    await addLine(massage.id);await addLine(paraffin.id);
    await assert.rejects(addLine(massage.id),/duplicate/);
    const totals=(await db.query('select sum(line_total) price,sum(duration_minutes)::int minutes from booking_lines')).rows[0];
    assert.deepEqual(totals,{price:'80',minutes:87},'server snapshots include every extra and staff override');
    // Exercise the real SQL availability function against these saved lines.
    await db.exec(`create table staff(id uuid,salon_id uuid,is_active boolean);
      insert into staff values('${staff}','${salon}',true);
      create table booking_settings(salon_id uuid,timezone_iana text);
      insert into booking_settings values('${salon}','America/Chicago');
      create table bookings(id uuid,status text);insert into bookings values('${booking}','confirmed');
      alter table booking_lines add scheduled_start_at timestamptz,add scheduled_end_at timestamptz;
      create table staff_availability_rules(salon_id uuid,staff_id uuid,is_active boolean default true,rule_type text,day_of_week integer,starts_at_local time,ends_at_local time,effective_start_date date,effective_end_date date);
      insert into staff_availability_rules(salon_id,rule_type,day_of_week,starts_at_local,ends_at_local)select '${salon}','working',n,'08:00','18:00' from generate_series(0,6)n;
      create table staff_time_blocks(salon_id uuid,staff_id uuid,is_active boolean,starts_at timestamptz,ends_at timestamptz);
      create function get_salon_business_timezone(uuid) returns text language sql as $$select 'America/Chicago'::text$$;`);
    const scheduler=readFileSync('supabase/migrations/202609240002_booking_scheduler_touch.sql','utf8');
    const fnStart=scheduler.indexOf('create or replace function public.booking_staff_available(');
    await db.exec(scheduler.slice(fnStart,scheduler.indexOf('$$;',fnStart)+3));
    // Actual line time + existing 5-minute buffer per line: 87 + 20 = 107.
    let cursor=Date.parse('2026-10-13T14:00:00Z');
    const scheduled=(await db.query('select id,duration_minutes from booking_lines order by case when line_type=\'service\' then 0 else 1 end,id')).rows;
    for(const line of scheduled){const end=cursor+(line.duration_minutes+5)*60000;
      await db.query('update booking_lines set scheduled_start_at=$1,scheduled_end_at=$2 where id=$3',[new Date(cursor).toISOString(),new Date(end).toISOString(),line.id]);cursor=end;}
    assert.equal(new Date(cursor).toISOString(),'2026-10-13T15:47:00.000Z');
    const available=async start=>(await db.query('select booking_staff_available($1,$2,$3,$4,$5) ok',[salon,staff,parent,new Date(start).toISOString(),new Date(start+55*60000).toISOString()])).rows[0].ok;
    assert.equal(await available(cursor-60000),false,'cannot start while last extra/buffer still occupies staff');
    assert.equal(await available(cursor),true,'SQL permits next booking exactly at occupied end');
    const invalid={...config,name:'Should rollback',booking_add_ons:[{name:'Bad',selection_group:'bad',base_price:1,duration_minutes:10}]};
    await assert.rejects(save(invalid),/Invalid add-on/);
    assert.equal((await db.query('select name from services where id=$1',[parent])).rows[0].name,'Spa pedi','failed batch rolls back parent and links');
    const savedItems=children.map(x=>({service_id:x.id,name:x.name,base_price:Number(x.base_price),duration_minutes:x.duration_minutes,selection_group:x.booking_add_on_group}));
    await save({...config,booking_add_ons:savedItems.filter(x=>x.service_id!==gel.id)});
    assert.equal((await db.query('select is_active from services where id=$1',[gel.id])).rows[0].is_active,false,'removed extras retire without deleting history');
    assert.equal((await db.query('select count(*)::int n from booking_lines where service_id=$1',[gel.id])).rows[0].n,1);
    const parent2=id(9);await db.query('insert into services(id,salon_id,name) values($1,$2,$3)',[parent2,salon,'Other']);
    await assert.rejects(save({...config,service_id:parent2,booking_add_ons:[savedItems[0]]}),/does not belong/);
    await db.exec('create or replace function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select false$$;');
    await assert.rejects(save(config),/Not allowed/);
    await db.exec('set role anon');
    await assert.rejects(save(config),/permission denied/);
  } finally {await db.close();}
});
