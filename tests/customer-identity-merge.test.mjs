import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = file => readFileSync(file, 'utf8');
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
  return db;
}
async function customer(db,n,name,phone,linked=null,salon=1) {
  await db.query('insert into customers(id,location_id,name,phone,customer_user_id) values($1,$2,$3,$4,$5)',[id(n),id(salon),name,phone,linked]);
}
async function resolve(db,name,phone,choice=null,newCustomer=false) {
  return (await db.query('select resolve_display_customer_identity($1,$2,$3,$4,$5) result',[id(1),name,phone,choice,newCustomer])).rows[0].result;
}

test('identity matching, directory and atomic merge preserve salon boundaries and history',async t => {
  const db = await fixture();
  try {
    await customer(db,10,'nene','(971) 373-2876');
    await customer(db,11,'Admin-Truong','+19713732876');
    await customer(db,12,'nene','9713732876',null,2);
    await t.test('formatted phone and one-character name typo automatically reuse the right profile',async()=>{
      for (const phone of ['9713732876','19713732876','+1 (971) 373-2876']) {
        assert.equal((await resolve(db,'nenr',phone)).customerId,id(10));
      }
    });
    await t.test('both fields misspelled produce a choice, never an invented probability',async()=>{
      const result=await resolve(db,'ne','9713722876');
      assert.equal(result.code,'identity_choice_required');
      assert.equal(result.candidates[0].id,id(10));
      assert.ok(!JSON.stringify(result).includes('90%'));
      assert.ok(!JSON.stringify(result).includes('9713732876'));
    });
    await t.test('same phone, unrelated name requires confirmation; partial phone is not identity',async()=>{
      assert.equal((await resolve(db,'David','9713732876')).code,'identity_choice_required');
      assert.equal((await resolve(db,'nene','971')).code,'invalid_phone');
      assert.equal((await resolve(db,'nene','1971')).code,'invalid_phone');
      assert.equal((await resolve(db,'','9713732876')).code,'profile_required');
    });
    await t.test('staff search finds typos; appointment creation reuses the same identity',async()=>{
      const found=(await db.query('select staff_booking_customer_suggestions($1,$2) result',[id(1),'nenr'])).rows[0].result;
      assert.ok(found.some(c=>c.id===id(10)));
      const phone=(await db.query('select staff_booking_customer_suggestions($1,$2) result',[id(1),'9713722876'])).rows[0].result;
      assert.ok(phone.some(c=>c.id===id(10)));
      assert.equal((await db.query('select create_staff_appointment($1,$2) result',[id(1),{name:'nenr',phone:'19713732876'}])).rows[0].result,id(10));
      await assert.rejects(db.query('select create_staff_appointment($1,$2)',[id(1),{name:'David',phone:'9713732876'}]),/Possible existing/);
    });
    await t.test('private helpers, snapshots and merge RPCs are not anonymous capabilities',async()=>{
      for (const signature of ['customer_identity_candidates(uuid,text,text,text)','resolve_display_customer_identity(uuid,text,text,uuid,boolean)',
        'merge_customer_records(uuid,uuid,uuid[],text)','resolve_customer_display_check_in_identity_core(text,text,text,text,uuid,boolean)',
        'booking_customer_identity_matches(uuid,text,text,text)']) {
        assert.equal((await db.query('select has_function_privilege($1,$2,$3) allowed',['anon',signature,'execute'])).rows[0].allowed,false,signature);
      }
    });
    await t.test('selection rechecked in salon and new-customer choice remains available',async()=>{
      assert.equal((await resolve(db,'ne','9713722876',id(12))).code,'identity_choice_expired');
      assert.equal((await resolve(db,'ne','9713722876',id(10))).customerId,id(10));
      assert.equal((await resolve(db,'Mary','9713732876',null,true)).customerId,null);
    });
    await t.test('real check-in resolver does not hijack a different same-phone waiting visit; retries are idempotent',async()=>{
      await db.query('insert into pos_live_drafts(salon_id,token) values($1,$2)',[id(1),'screen']);
      await db.query('insert into customer_visits(salon_id,customer_id) values($1,$2)',[id(1),id(11)]);
      const args=['screen','9713732876','nenr','request-1',null,false];
      const call=()=>db.query('select resolve_customer_display_check_in_identity($1,$2,$3,$4,$5,$6) result',args);
      const first=(await call()).rows[0].result;
      assert.equal(first.visit.customerId,id(10));
      assert.deepEqual((await call()).rows[0].result,first);
      args[3]='request-new'; args[2]='David'; args[5]=true;
      const separate=(await call()).rows[0].result;
      assert.notEqual(separate.visit.customerId,id(10));
      assert.deepEqual((await call()).rows[0].result,separate);
      await db.query('delete from customer_visits where customer_id<>$1',[id(11)]);
      await db.query('delete from customers where id=$1',[separate.visit.customerId]);
      await db.query('delete from customer_visits where customer_id=$1',[id(11)]);
    });
    await t.test('340 Walking customers occupy one directory row and one pagination count',async()=>{
      await db.exec(`insert into customers(location_id,name) select '${id(1)}','Walking' from generate_series(1,340)`);
      const {result}= (await db.query('select customer_directory($1,null,1) result',[id(1)])).rows[0];
      assert.equal(result.count,3);
      const walk=result.rows.filter(c=>c.walking_count);
      assert.equal(walk.length,1); assert.equal(walk[0].walking_count,340); assert.equal(walk[0].walking_ids.length,340);
      assert.equal((await db.query('select customer_directory($1,null,2) result',[id(1)])).rows[0].result.rows.length,0);
    });
    await t.test('create reuses an automatic match; ambiguous creation must explicitly choose',async()=>{
      assert.equal((await db.query('select create_salon_customer_identity($1,$2) id',[id(1),{name:'nenr',phone:'19713732876'}])).rows[0].id,id(10));
      await assert.rejects(db.query('select create_salon_customer_identity($1,$2)',[id(1),{name:'Mary',phone:'9713732876'}]),/Review matching/);
      const args=[id(1),'nenr','19713732876',null,null,id(99),'owner_booking'];
      const reused=(await db.query('select create_booking_customer_identity($1,$2,$3,$4,$5,$6,$7) result',args)).rows[0].result;
      assert.equal(reused.created,false); assert.equal(reused.customer.id,id(10));
    });
    await customer(db,20,'nenr','19713732876');
    await t.test('atomic merge preserves every dependent table and ticket amount',async()=>{
      for(const table of ['bookings','pos_tickets','pos_desk_sessions','customer_visits','customer_visit_experiences']) await db.query(`insert into ${table}(salon_id,customer_id) values($1,$2)`,[id(1),id(20)]);
      await db.query('update customer_visits set appointment_id=(select id from bookings where customer_id=$1),ticket_id=(select id from pos_tickets where customer_id=$1) where customer_id=$1',[id(20)]);
      for(const table of ['beauty_post_verifications','customer_claim_tokens']) await db.query(`insert into ${table}(customer_id) values($1)`,[id(20)]);
      for(const n of [10,20]) {
        await db.query('insert into account_favorite_customers(user_id,customer_id) values($1,$2)',[id(99),id(n)]);
        await db.query("insert into customer_account_claims(customer_user_id,customer_id,claim_method) values($1,$2,'qr')",[id(99),id(n)]);
      }
      await db.query('insert into pos_live_drafts(salon_id,customer) values($1,$2)',[id(1),{id:id(20),name:'nenr'}]);
      await db.query("select merge_customer_records($1,$2,$3,'automatic')",[id(1),id(10),[id(20)]]);
      for(const table of ['bookings','pos_tickets','pos_desk_sessions','customer_visits','customer_visit_experiences','beauty_post_verifications','customer_claim_tokens','account_favorite_customers','customer_account_claims']) {
        assert.equal((await db.query(`select count(*)::integer n from ${table} where customer_id=$1`,[id(10)])).rows[0].n,1,table);
      }
      assert.equal(Number((await db.query('select total from pos_tickets')).rows[0].total),165);
      assert.equal((await db.query('select customer_user_id from bookings')).rows[0].customer_user_id,null);
      assert.equal((await db.query('select customer from pos_live_drafts where customer is not null')).rows[0].customer.id,id(10));
      assert.equal((await db.query('select target_id from customer_merged_ids where source_id=$1',[id(20)])).rows[0].target_id,id(10));
    });
    await t.test('failure on a previously unknown dependent table rolls back all changes',async()=>{
      await customer(db,21,'nene','9713732876');
      await db.exec('create table future_dependency(customer_id uuid references customers on delete restrict)');
      await db.query('insert into future_dependency values($1)',[id(21)]);
      await db.query('insert into bookings(salon_id,customer_id) values($1,$2)',[id(1),id(21)]);
      await assert.rejects(db.query('select merge_customer_records($1,$2,$3)',[id(1),id(10),[id(21)]]),/dependency needs review/);
      assert.equal((await db.query('select count(*)::integer n from bookings where customer_id=$1',[id(21)])).rows[0].n,1);
      assert.equal((await db.query('select count(*)::integer n from customer_merged_ids where source_id=$1',[id(21)])).rows[0].n,0);
      await db.exec('drop table future_dependency');
    });
    await t.test('an error after booking updates rolls back target, bookings, audit and aliases',async()=>{
      await db.query('insert into pos_desk_sessions(salon_id,customer_id) values($1,$2)',[id(1),id(21)]);
      await db.exec(`create function reject_merge_fixture() returns trigger language plpgsql as $$begin raise exception 'fixture update failure'; end$$;
       create trigger reject_merge before update on pos_desk_sessions for each row execute function reject_merge_fixture();`);
      const before=(await db.query('select count(*)::integer n from customer_merge_events')).rows[0].n;
      await assert.rejects(db.query('select merge_customer_records($1,$2,$3)',[id(1),id(10),[id(21)]]),/fixture update failure/);
      assert.equal((await db.query('select count(*)::integer n from customer_merge_events')).rows[0].n,before);
      assert.equal((await db.query('select count(*)::integer n from bookings where customer_id=$1',[id(21)])).rows[0].n,1);
      await db.exec('drop trigger reject_merge on pos_desk_sessions');
    });
    await t.test('cross-salon, account conflicts and guest merging are rejected',async()=>{
      await assert.rejects(db.query('select merge_customer_records($1,$2,$3)',[id(1),id(10),[id(12)]]),/selection changed/);
      await customer(db,30,'Mary','5550100000',id(90)); await customer(db,31,'Mary','5550100000',id(91));
      await assert.rejects(db.query('select merge_customer_records($1,$2,$3)',[id(1),id(30),[id(31)]]),/Different personal/);
      await db.exec("select set_config('test.manager','no',false),set_config('test.actor','',false)");
      await assert.rejects(db.query('select merge_customer_records($1,$2,$3)',[id(1),id(10),[id(11)]]),/access required/);
    });
    await t.test('customer can merge only profiles already linked to their account',async()=>{
      await db.exec(`select set_config('test.actor','${id(99)}',false)`);
      await customer(db,40,'David','5550100040',id(99)); await customer(db,41,'Dave','5550100041',id(99));
      assert.equal((await db.query('select my_customer_identity_groups() groups')).rows[0].groups.length,1);
      await db.query('select merge_customer_records($1,$2,$3)',[id(1),id(40),[id(41)]]);
      await assert.rejects(db.query('select merge_customer_records($1,$2,$3)',[id(1),id(40),[id(10)]]),/access required/);
    });
    await t.test('automatic consolidation keeps unrelated same-phone customers and skips separate active visits',async()=>{
      await db.exec("select set_config('test.manager','yes',false)");
      await customer(db,50,'Emily','5550100050'); await customer(db,51,'Emilu','15550100050');
      for(const n of [50,51]) await db.query('insert into customer_visits(salon_id,customer_id) values($1,$2)',[id(1),id(n)]);
      await assert.rejects(db.query('select merge_customer_records($1,$2,$3)',[id(1),id(50),[id(51)]]),/separate active visits/);
      const merged=(await db.query('select consolidate_customer_identities($1) count',[id(1)])).rows[0].count;
      assert.ok(merged>=1);
      const rows=(await db.query('select id from customers where id=any($1)',[[id(11),id(50),id(51)]] )).rows;
      assert.equal(rows.length,3);
      assert.equal((await db.query("select count(*)::integer n from customers where name='Walking'")).rows[0].n,340);
    });
    await t.test('merging inactive profiles preserves inactive status and completed visit links',async()=>{
      await customer(db,60,'Inactive','5550100060'); await customer(db,61,'Inactive','15550100060');
      await db.query("insert into customer_visits(salon_id,customer_id,status) values($1,$2,'completed')",[id(1),id(61)]);
      await db.query("update customers set status='inactive' where id=any($1)",[[id(60),id(61)]]);
      await db.query('select merge_customer_records($1,$2,$3)',[id(1),id(60),[id(61)]]);
      assert.equal((await db.query('select status from customers where id=$1',[id(60)])).rows[0].status,'inactive');
      assert.equal((await db.query('select customer_id from customer_visits where customer_id=$1',[id(60)])).rows[0].customer_id,id(60));
    });
  } finally { await db.close(); }
});
