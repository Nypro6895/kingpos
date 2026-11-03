import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Runs the real migration against a minimal PostgreSQL fixture with restrictive
// table RLS. Supply PGLITE_MODULE_PATH if @electric-sql/pglite is not installed.
test('dated ticket portal isolates staff and records edits across dates', async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
    ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
  const db = new PGlite();
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as
        $$ select nullif(current_setting('test.user', true),'')::uuid $$;
      create function current_public_user_id() returns uuid language sql as $$ select auth.uid() $$;
      create function get_salon_business_timezone(uuid) returns text language sql as $$ select 'America/Chicago'::text $$;
      create function get_salon_business_date(uuid) returns date language sql as $$ select current_setting('test.day')::date $$;
      create table locations(id uuid primary key);
      create table users(id uuid primary key, display_name text);
      create table pos_ticket_audit_logs(id uuid, salon_id uuid, ticket_id uuid, action text, note text, created_by uuid, created_at timestamptz default now());
      create table staff(id uuid primary key, salon_id uuid, account_user_id uuid, user_id uuid, is_active boolean);
      create table customers(id uuid, location_id uuid, name text, phone text, email text);
      create table services(id uuid, name text);
      create table pos_tickets(id uuid primary key, salon_id uuid, customer_id uuid, ticket_number text, status text, opened_at timestamptz, closed_at timestamptz);
      create table pos_ticket_items(id uuid, salon_id uuid, pos_ticket_id uuid, assigned_staff_id uuid,
        service_id uuid, service_name_snapshot text, unit_price numeric, line_total numeric, quantity numeric, created_at timestamptz, is_removed boolean);
      create table pos_ticket_staff_earnings(id uuid, salon_id uuid, staff_id uuid, ticket_id uuid,
        work_date date, service_total numeric, tip_amount numeric, total_earning numeric, big_turn_count integer, small_turn_count integer);
      alter table pos_tickets enable row level security;
      alter table pos_ticket_items enable row level security;
      grant usage on schema public, auth to authenticated;
      grant select on all tables in schema public to authenticated;
      select set_config('test.user','${id(1)}',false), set_config('test.day','2026-03-08',false);
      insert into staff values('${id(10)}','${id(20)}','${id(1)}',null,true),('${id(11)}','${id(20)}','${id(2)}',null,true);
      insert into pos_tickets values('${id(30)}','${id(20)}',null,'T1','closed','2026-03-08T06:00Z','2026-03-08T08:00Z');
      insert into pos_ticket_items values
        ('${id(40)}','${id(20)}','${id(30)}','${id(10)}',null,'Custom service',50,50,1,'2026-03-08T06:00Z',false),
        ('${id(41)}','${id(20)}','${id(30)}','${id(11)}',null,'Coworker',80,80,1,'2026-03-08T06:00Z',false),
        ('${id(42)}','${id(20)}','${id(30)}','${id(10)}',null,'Removed',50,50,1,'2026-03-08T06:00Z',true);
      insert into pos_ticket_staff_earnings values
        ('${id(50)}','${id(20)}','${id(10)}','${id(30)}','2026-03-08',50,10,60,1,0),
        ('${id(51)}','${id(20)}','${id(11)}','${id(30)}','2026-03-08',80,20,100,2,0);
    `);

    await db.exec(`insert into locations values ('${id(20)}'),('${id(21)}'); insert into users values ('${id(1)}','Staff One'),('${id(2)}','Owner Two');`);
    await db.exec(readFileSync('supabase/migrations/20261103022000_staff_ticket_portal.sql','utf8'));
    const portal=async(day='2026-03-08',salon=20)=>(await db.query(`select get_my_staff_tickets('${id(salon)}','${day}') result`)).rows[0].result;
    await db.exec('set role authenticated');
    let result=await portal();
    assert.equal(result.staffId,id(10)); assert.equal(result.tickets.length,1);
    assert.equal(result.tickets[0].services.length,2,'includes own removed service');
    assert.equal(result.tickets[0].services.some(s=>s.name==='Coworker'),false);
    assert.equal(result.tickets[0].serviceTotal,50); assert.equal(result.tickets[0].tip,10);
    assert.equal((await portal('2026-03-07')).tickets.length,0);
    // Chicago spring DST day is 23 hours. Use local-midnight bounds.
    await db.exec('reset role');
    for(const [n,at] of [[60,'2026-03-08T05:59:59Z'],[61,'2026-03-09T04:59:59Z'],[62,'2026-03-09T05:00:00Z']]) {
      await db.exec(`insert into pos_tickets values('${id(n)}','${id(20)}',null,'Boundary','open','${at}',null);
        insert into pos_ticket_items values('${id(n+10)}','${id(20)}','${id(n)}','${id(10)}',null,'Boundary',5,5,1,'${at}',false);`);
    }
    await db.exec('set role authenticated');
    const boundary=await portal();assert.deepEqual(boundary.tickets.map(t=>t.id).sort(),[id(30),id(61)]);
    assert.deepEqual((await portal('2026-03-09')).tickets.map(t=>t.id),[id(62)]);
    await db.exec(`reset role;delete from pos_ticket_items where id in ('${id(70)}','${id(71)}','${id(72)}');delete from pos_tickets where id in ('${id(60)}','${id(61)}','${id(62)}');set role authenticated;`);
    assert.equal((await db.query('select * from pos_tickets')).rows.length,0);
    await assert.rejects(db.query('select * from staff_ticket_edit_history'),/permission denied/);
    await assert.rejects(portal('2026-03-08',21),/unique active staff/);
    await db.exec(`reset role; select set_config('test.user','${id(2)}',false);
      update pos_ticket_items set line_total=65,unit_price=65 where id='${id(40)}';
      update pos_ticket_staff_earnings set service_total=65,tip_amount=12 where id='${id(50)}';
      update pos_tickets set status='voided' where id='${id(30)}';
      insert into pos_ticket_audit_logs values('${id(90)}','${id(20)}','${id(30)}','ticket_voided','private coworker amount','${id(2)}',now());
      select set_config('test.user','${id(1)}',false);set role authenticated;`);
    result=await portal(); const ticket=result.tickets[0];
    assert.equal(ticket.status,'voided','voided tickets remain visible');
    assert.equal(ticket.history.length,3);
    const item=ticket.history.find(h=>h.source==='pos_ticket_items');
    assert.equal(item.before.line_total,50);assert.equal(item.after.line_total,65);assert.equal(item.actor,'Owner Two');
    assert.equal(ticket.activity[0].action,'ticket_voided');assert.equal('note' in ticket.activity[0],false);
    assert.equal(JSON.stringify(result).includes('private coworker'),false);
    await db.exec(`reset role; select set_config('test.user','${id(2)}',false);set role authenticated;`);
    const other=await portal(); assert.equal(other.staffId,id(11));
    assert.equal(other.tickets[0].history.length,1,'coworker receives header edit only');
    assert.equal(other.tickets[0].serviceTotal,80); assert.equal(other.tickets[0].tip,20);
    // Later reassignment retains original staff history, without exposing new assignee services.
    await db.exec(`reset role; update pos_ticket_items set assigned_staff_id='${id(11)}' where id='${id(40)}';
      delete from pos_ticket_staff_earnings where id='${id(50)}';
      select set_config('test.user','${id(1)}',false);set role authenticated;`);
    result=await portal(); assert.equal(result.tickets.length,1);assert.ok(result.tickets[0].history.length>=4);
    assert.equal(result.tickets[0].services.some(s=>s.id===id(40)),false);
    assert.equal((await portal('2026-03-09')).tickets.length,0,'edit date does not replace original work date');
    await db.exec(`reset role; update staff set is_active=false where id='${id(10)}';set role authenticated;`);
    await assert.rejects(portal(),/unique active staff/);
    await db.exec(`reset role;update staff set is_active=true where id='${id(10)}';insert into staff values('${id(12)}','${id(20)}','${id(1)}',null,true);set role authenticated;`);
    await assert.rejects(portal(),/unique active staff/);
    await db.exec(`select set_config('test.user','',false)`);await assert.rejects(portal(),/Authentication required/);
    assert.equal((await db.query(`select has_function_privilege('anon','get_my_staff_tickets(uuid,date)','execute') allowed`)).rows[0].allowed,false);
  } finally { await db.close(); }
});
