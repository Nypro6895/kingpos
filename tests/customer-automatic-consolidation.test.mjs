import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = file => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const sqlFunction = (file, name) => {
  const sql = read(file); const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  const end = sql.indexOf('$$;', start); return sql.slice(start, end + 3);
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table locations(id uuid primary key,name text);
    create table customers(id uuid primary key default gen_random_uuid(),location_id uuid references locations,
      customer_user_id uuid,name text,phone text,email text,notes text,staff_notes text,internal_notes text,
      source text default 'manual',status text default 'active',created_by_user_id uuid,updated_by_user_id uuid,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select coalesce(current_setting('test.manager',true),'')='yes' and $1='${id(1)}'::uuid$$;
    create table bookings(id uuid primary key default gen_random_uuid(),salon_id uuid,customer_id uuid references customers on delete restrict,customer_user_id uuid,updated_by_user_id uuid);
    create table pos_tickets(id uuid primary key default gen_random_uuid(),salon_id uuid,customer_id uuid references customers on delete set null,total numeric default 165);
    create table pos_desk_sessions(id uuid primary key default gen_random_uuid(),salon_id uuid,customer_id uuid references customers on delete set null);
    create table customer_visits(id uuid primary key default gen_random_uuid(),salon_id uuid,customer_id uuid references customers on delete restrict);
    create table customer_visit_experiences(id uuid primary key default gen_random_uuid(),salon_id uuid,customer_id uuid references customers on delete set null);
    create table beauty_post_verifications(id uuid primary key default gen_random_uuid(),customer_id uuid references customers on delete set null);
    create table account_favorite_customers(id uuid primary key default gen_random_uuid(),user_id uuid,customer_id uuid references customers on delete cascade,unique(user_id,customer_id));
    create table customer_account_claims(id uuid primary key default gen_random_uuid(),customer_id uuid references customers on delete cascade,customer_user_id uuid,claim_method text,unique(customer_id,customer_user_id,claim_method));
    create table customer_claim_tokens(id uuid primary key default gen_random_uuid(),customer_id uuid references customers on delete cascade);
    create table pos_live_drafts(id uuid primary key default gen_random_uuid(),salon_id uuid,customer jsonb,customer_version integer default 0,version integer default 0);
    create function customer_visit_first_name(text) returns text language sql immutable as $$select split_part($1,' ',1)$$;
    insert into locations values('${id(1)}','Salon'),('${id(2)}','Other');
    select set_config('test.actor','${id(99)}',false),set_config('test.manager','yes',false);
  `);
  await db.exec(sqlFunction('supabase/migrations/202608100003_customer_identity_claims.sql','normalize_customer_claim_phone'));
  await db.exec(read('supabase/migrations/20261023080000_customer_identity_matching.sql'));
  await db.exec(`
   alter table pos_live_drafts add column token text,add column status text default 'draft',add column customer_handoff_started_at timestamptz,add column last_customer_action_id text;
   alter table customer_visits add column status text default 'waiting',add column checked_in_at timestamptz default now(),add column checkout_started_at timestamptz,
    add column appointment_id uuid,add column ticket_id uuid,add column source text,add column origin_metadata jsonb;
   create function get_pos_live_draft_by_token(text) returns setof pos_live_drafts language sql as $$select * from pos_live_drafts where token=$1$$;
   create function customer_visit_requested_services_json(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
   create function find_customer_visit_arrival_appointment(uuid,uuid) returns table(appointment_id uuid,match_count integer) language sql as $$select null::uuid,0$$;
   create function customer_visit_public_payload(customer_visits,customers) returns jsonb language sql as $$select jsonb_build_object('id',$1.id,'customerId',$2.id)$$;
  `);
  for (const name of ['create_or_reuse_customer_visit','resolve_customer_display_submission']) {
    await db.exec(sqlFunction('supabase/migrations/202608150008_customer_visit_requested_services.sql',name));
  }
  await db.exec(read('supabase/migrations/202609230005_portable_customer_checkin.sql'));
  // The unchanged relay implementation is compiled too; its service catalog dependencies are not exercised here.
  const relay=read('supabase/migrations/20261009150032_service_relay_phone_checkin.sql');
  await db.exec(relay.slice(relay.indexOf('create function public.service_relay_phone_checkin'),relay.indexOf('revoke all on function')));
  await db.exec(read('supabase/migrations/20261023081000_customer_identity_checkin.sql'));
  await db.exec(sqlFunction('supabase/migrations/202608150004_customer_visits_waiting_list.sql','validate_customer_visit_relationships'));
  await db.exec('create trigger validate_customer_visit_relationships before insert or update of salon_id,customer_id,appointment_id,ticket_id on customer_visits for each row execute function validate_customer_visit_relationships()');
  await db.exec(read('supabase/migrations/20261023082000_customer_identity_create.sql'));
  await db.exec(read('supabase/migrations/20261023083000_customer_identity_self_service.sql'));
  await db.exec(`
   create function normalize_search_text(text) returns text language sql immutable as $$select lower(btrim($1))$$;
   create function current_user_staff_id_for_salon(uuid) returns uuid language sql as $$select current_public_user_id()$$;
   create function salon_staff_booking_creation(uuid) returns jsonb language sql as $$select '{"enabled":true}'::jsonb$$;
   create function create_staff_appointment(p_salon uuid,p_input jsonb) returns uuid language plpgsql as $$
   declare customer uuid; customer_phone text:=p_input->>'phone'; customer_name text:=p_input->>'name';
   begin
    select c.id into customer from customers c where c.location_id=p_salon and c.status='active' and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g') and lower(btrim(c.name))=lower(customer_name) order by c.created_at limit 1;
    return customer;
   end $$;
  `);
  await db.exec(sqlFunction('supabase/migrations/202610020007_staff_booking_customer_suggestions.sql','staff_booking_customer_suggestions'));
  await db.exec(read('supabase/migrations/20261023084000_customer_identity_booking.sql'));
  await db.exec(read('supabase/migrations/20261025100000_customer_merge_suggestions.sql'));
  return db;
}
async function customer(db,n,name,phone,linked=null,salon=1) {
  await db.query('insert into customers(id,location_id,name,phone,customer_user_id) values($1,$2,$3,$4,$5)',[id(n),id(salon),name,phone,linked]);
}
async function resolve(db,name,phone,choice=null,newCustomer=false) {
  return (await db.query('select resolve_display_customer_identity($1,$2,$3,$4,$5) result',[id(1),name,phone,choice,newCustomer])).rows[0].result;
}

test('automatic consolidation follows contact/name rules and preserves protected history', async t => {
  const db = await fixture();
  t.after(() => db.close());
  await db.exec(read('supabase/migrations/20261028180000_customer_automatic_consolidation.sql'));
  const run = async () => (await db.query('select consolidate_customer_identities($1) n',[id(1)])).rows[0].n;
  await t.test('exact names, one/two edits including short names, email and Unicode', async () => {
    for (const [a,b,phone] of [['Nene','Nene','5035550101'],['Nene','Nena','5035550102'],['Nene','Nana','5035550103'],['Al','Al','5035550104'],['Quỳnh Trâm','Quỳnh Trâm'.normalize('NFD'),'5035550105']]) {
      const n=100+(Number(phone.slice(-2))*2);
      await customer(db,n,a,phone); await customer(db,n+1,b,phone);
    }
    await customer(db,200,'Email Name',null); await customer(db,201,'email name',null);
    await db.query('update customers set email=$1 where id=any($2)',[' EMAIL@example.test ',[id(200),id(201)]]);
    await db.query('insert into bookings(salon_id,customer_id) values($1,$2)',[id(1),id(103)]);
    await db.query('insert into pos_tickets(salon_id,customer_id,total) values($1,$2,170)',[id(1),id(103)]);
    assert.equal(await run(),6);
    assert.equal((await db.query('select customer_id,total from pos_tickets')).rows[0].customer_id,id(102));
    assert.equal(Number((await db.query('select total from pos_tickets')).rows[0].total),170);
    assert.equal((await db.query('select customer_id from bookings')).rows[0].customer_id,id(102));
    assert.equal(await run(),0);
  });
  await t.test('only same phone with unrelated names asks for review',async()=>{
    await customer(db,300,'Nene','5035550110'); await customer(db,301,'Admin-Truong','5035550110');
    await customer(db,302,'Nene','5035550111');
    await customer(db,303,'Unrelated','5035550112');
    await db.query('update customers set email=$1 where id=any($2)',['shared@example.test',[id(300),id(303)]]);
    const matches=(await db.query('select customer_duplicate_batch($1,$2) result',[id(1),[id(300)]])).rows[0].result[id(300)];
    assert.deepEqual(matches.map(m=>m.id),[id(301)]);
    assert.equal(matches[0].match.automatic,false);
    assert.equal(await run(),0);
  });
  await t.test('check-in typo suggestions survive and creation reuses email/name matches',async()=>{
    await customer(db,350,'Typo Fixture','9713732876');
    assert.equal((await resolve(db,'Typo Fixtur','9713732876')).customerId,id(350));
    assert.equal((await resolve(db,'Typo Fixture','9713722876')).code,'identity_choice_required');
    const created=(await db.query('select create_salon_customer_identity($1,$2) result',[id(1),{name:'Email Name',email:'email@example.test'}])).rows[0].result;
    assert.equal(created,id(200));
  });
  await t.test('account conflicts and separate active visits remain unmerged; other safe groups proceed',async()=>{
    await customer(db,400,'Protected','5035550120',id(90)); await customer(db,401,'Protected','5035550120',id(91));
    await customer(db,402,'Busy','5035550121'); await customer(db,403,'Busy','5035550121');
    for(const n of [402,403]) await db.query('insert into customer_visits(salon_id,customer_id) values($1,$2)',[id(1),id(n)]);
    await customer(db,404,'Safe','5035550122'); await customer(db,405,'Safe','5035550122');
    await customer(db,406,'Safe','5035550122',null,2);
    assert.equal(await run(),1);
    assert.equal((await db.query('select count(*)::int n from customers where id=any($1)',[[400,401,402,403,406].map(id)])).rows[0].n,5);
  });
  await t.test('automatic RPC rechecks rules and manager authorization',async()=>{
    await assert.rejects(db.query("select merge_customer_records($1,$2,$3,'automatic')",[id(1),id(300),[id(301)]]),/Review these records manually/);
    await db.exec("select set_config('test.manager','no',false)");
    await assert.rejects(run(),/Customer management access required/);
  });
});

