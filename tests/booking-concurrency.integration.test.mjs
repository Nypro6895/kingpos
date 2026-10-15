import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const enabled=Boolean(process.env.KINGPOS_TEST_PG_BIN&&process.env.KINGPOS_TEST_PG_DATA);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const salon=id(1),staff=id(2),service=id(3),staff2=id(20);
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const migration=name=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');
function sqlFunction(source,name){const start=source.indexOf(`create or replace function public.${name}(`),end=source.indexOf('$$;',start);assert.ok(start>=0&&end>start);return source.slice(start,end+3);}

test('independent PostgreSQL sessions enforce booking concurrency and atomicity',{skip:!enabled,timeout:60000},async t=>{
 const exe=join(process.env.KINGPOS_TEST_PG_BIN,'psql.exe'),database='kingpos_isolated_booking_'+randomUUID().replaceAll('-','');
 const baseEnv={...process.env,PGHOST:process.env.KINGPOS_TEST_PG_SOCKET||'127.0.0.1',PGPORT:'55439',PGUSER:'booking_test',PGDATABASE:'postgres',PGPASSWORD:'',PGPASSFILE:join(process.env.KINGPOS_TEST_PG_DATA,'nonexistent-passfile'),PGCONNECT_TIMEOUT:'3',PGOPTIONS:'-c statement_timeout=12000 -c lock_timeout=10000'};
 const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'];
 function sql(query,db=database){const r=spawnSync(exe,args,{env:{...baseEnv,PGDATABASE:db},input:query,encoding:'utf8',windowsHide:true,timeout:15000});if(r.status!==0)throw Error(r.stderr||r.error?.message||'psql failed');return r.stdout.trim();}
 assert.equal(resolve(sql("select current_setting('data_directory')",'postgres')).toLowerCase(),resolve(process.env.KINGPOS_TEST_PG_DATA).toLowerCase(),'refuse a cluster outside the explicit ephemeral data directory');
 if(process.env.KINGPOS_TEST_PG_SOCKET){assert.equal(sql("select inet_server_addr() is null and current_setting('listen_addresses')=''",'postgres'),'t','socket-only fixture must not listen on TCP');assert.equal(resolve(sql("select current_setting('unix_socket_directories')",'postgres')).toLowerCase(),resolve(process.env.KINGPOS_TEST_PG_SOCKET).toLowerCase());}
 sql(`create database ${database}`,'postgres');
 function asyncSql(query,app){return new Promise(resolveResult=>{const child=spawn(exe,args,{env:{...baseEnv,PGDATABASE:database,PGAPPNAME:app},windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',error='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>error+=d);child.once('error',e=>resolveResult({ok:false,error:e.message}));child.once('close',code=>resolveResult({ok:code===0,out:out.trim(),error}));child.stdin.end(query);});}
 async function hold(query){const child=spawn(exe,args,{env:{...baseEnv,PGDATABASE:database,PGAPPNAME:'booking-held'},windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',error='';const result=new Promise(resolveResult=>{child.stderr.on('data',d=>error+=d);child.once('close',code=>resolveResult({ok:code===0,out:out.trim(),error}));});await new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(Error('transaction hold timed out')),5000);child.stdout.on('data',d=>{out+=d;if(out.includes('BOOKING_HELD')){clearTimeout(timer);ok();}});child.once('error',fail);child.once('close',()=>{clearTimeout(timer);fail(Error(error||'holding session closed early'));});child.stdin.write(`begin;${query};select 'BOOKING_HELD';\n`);});return{finish:async query=>{child.stdin.end(query+';commit;\n');return result;},commit:async()=>{child.stdin.end('commit;\n');const r=await result;assert.equal(r.ok,true,r.error);return r.out;},rollback:async()=>{if(!child.stdin.writableEnded&&child.exitCode===null)child.stdin.end('rollback;\n');await result;}};}
 async function waitForLock(app){for(let i=0;i<100;i++){if(sql(`select count(*) from pg_stat_activity where application_name=${literal(app)} and wait_event_type='Lock'`)==='1')return;await new Promise(r=>setTimeout(r,25));}throw Error('competing session did not reach a database lock');}
 let start;
 const at=n=>new Date(+new Date(start)+n*60000).toISOString();
 const line=(n,member=staff)=>({service_id:service,assigned_staff_id:member,scheduled_start_at:at(n),scheduled_end_at:at(n+45),cleanup_buffer_minutes:15});
 const book=(key,n=0,member=staff,lines=[line(n,member)])=>`select create_public_booking(${literal(salon)},'Fixture','Customer',null,'fixture@example.invalid',${literal(at(n))},${literal(at(n+45))},${literal(JSON.stringify(lines))}::jsonb,p_idempotency_key=>${key===null?'null':literal(key)})`;
 const moved=(token,n)=>`select reschedule_public_booking_by_manage_token(${literal(token)},${literal(at(n))})`;
 const counts=()=>JSON.parse(sql("select json_build_object('bookings',(select count(*) from bookings),'customers',(select count(*) from customers),'lines',(select count(*) from booking_lines),'events',(select count(*) from booking_status_events),'notices',(select count(*) from test_notifications))"));
 const reset=()=>sql('truncate test_notifications,booking_status_events,booking_staff_reservations,booking_lines,bookings,customers cascade;');
 try{
  const existing=readFileSync('tests/booking-scheduler-guards.integration.test.mjs','utf8');
  let schema=existing.slice(existing.indexOf('await db.exec(`')+'await db.exec(`'.length,existing.indexOf('`);',existing.indexOf('await db.exec(`')));
  schema=schema.replace('create role anon;create role authenticated;',()=>`do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;end$$;`);
  sql(schema+`
   alter table bookings alter id set default gen_random_uuid();alter table booking_lines alter id set default gen_random_uuid();
   create table customers(id uuid primary key default gen_random_uuid(),location_id uuid,customer_user_id uuid,name text,phone text,email text,source text,status text,created_by_user_id uuid);
   create table users(id uuid,display_name text,first_name text,last_name text,email text,phone text);
   alter table services add name text default 'Fixture service',add category text,add description text,add base_price numeric default 20;
   alter table booking_settings add confirmation_mode text default 'instant_booking';
   alter table bookings add customer_id uuid references customers(id),add customer_user_id uuid,add public_notes text,add source text,add confirmation_mode text,add salon_timezone_snapshot text,add source_reference_type text,add source_reference_id uuid,add idempotency_key text,add created_by_user_id uuid;
   alter table booking_lines add line_type text,add service_name_snapshot text,add service_category_snapshot text,add service_description_snapshot text,add unit_price numeric,add quantity numeric,add line_total numeric,add duration_minutes integer,add cleanup_buffer_minutes integer,add display_order integer;
   alter table booking_status_events add actor_user_id uuid;
   create table test_notifications(booking_id uuid);
   create function current_public_user_id()returns uuid language sql as $$select null::uuid$$;
   create function notify_public_booking_created(uuid)returns void language sql as $$insert into test_notifications values($1)$$;
   create function public_booking_deposit(uuid)returns jsonb language sql as $$select null::jsonb$$;`);
  const scheduler=migration('202609240002_booking_scheduler_touch');sql(scheduler.slice(scheduler.indexOf('create or replace function public.booking_staff_available('),scheduler.indexOf('create or replace function public.create_pos_portable_appointment_v2(')));
  sql(sqlFunction(migration('202608140001_public_booking_account_notifications'),'create_public_booking'));
  sql(sqlFunction(migration('202607240001_account_salon_baseline'),'reschedule_public_booking_by_manage_token'));
  sql(sqlFunction(migration('202609240004_booking_lifecycle_policy'),'cancel_public_booking_by_manage_token'));
  const deposit=migration('20261009140031_booking_deposit_plugin');sql(deposit.slice(deposit.indexOf('alter function public.create_public_booking('),deposit.indexOf('create function public.booking_deposit_record_payment(')));

  sql(`alter table staff add display_name text default 'Fixture';
    alter table customers add updated_at timestamptz default now();alter table customers alter status set default 'active';
    alter table staff_service_assignments add id uuid default gen_random_uuid(),add custom_price numeric;
    alter table bookings add staff_id uuid,add auto_assigned boolean default false,add created_at timestamptz default now();
    alter table booking_settings add same_day_booking_enabled boolean default false,add minimum_lead_time_minutes integer default 120,add maximum_advance_window_days integer default 60,add slot_interval_minutes integer default 15,add auto_assign_enabled boolean default true,add payment_required_enabled boolean default false,add deposit_required_enabled boolean default false,add late_cancellation_policy text;
    create function pos_portable_access_salon_id(uuid,text)returns uuid language sql as $$select '${salon}'::uuid$$;
    create function pos_portable_access_has_capability(uuid,text,text)returns boolean language sql as $$select true$$;
    create function assert_booking_time_policy(timestamptz,timestamptz,text,boolean,integer,integer,timestamptz)returns void language sql as $$select$$;`);
  sql(sqlFunction(scheduler,'create_pos_portable_appointment_v2'));
  sql('revoke all on function create_pos_portable_appointment_v2(uuid,text,text,text,text,uuid,uuid,timestamptz,uuid) from public;grant execute on function create_pos_portable_appointment_v2(uuid,text,text,text,text,uuid,uuid,timestamptz,uuid) to anon,authenticated;');
  const rank=migration('20261009126031_explore_ranked_search');
  const rankFunction=name=>{const begin=rank.indexOf('CREATE FUNCTION public.'+name+'('),end=rank.indexOf('$;',begin);assert.ok(begin>=0&&end>begin);return rank.slice(begin,end+3);};
  sql(`create table explore_search_rank_groups(group_key text primary key,ready_count bigint default 0);
    create table explore_search_rank_sources(salon_id uuid primary key,group_keys text[],ready boolean default false,refresh_after timestamptz);
    create table explore_search_rank_jobs(salon_id uuid primary key,generation bigint default 0,next_attempt_at timestamptz default now());`);
  sql(rankFunction('explore_rank_enqueue'));sql(rankFunction('explore_rank_evidence_insert'));
  if(process.env.KINGPOS_TEST_BOOKING_BASELINE!=='1'){
   const privileges=()=>sql("select json_agg(json_build_object('name',proname,'owner',proowner,'definer',prosecdef,'acl',proacl,'config',proconfig) order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in('create_public_booking_without_deposit','reschedule_public_booking_by_manage_token','create_pos_portable_appointment_v2')");
   sql("alter function public.reschedule_public_booking_by_manage_token(text,timestamptz) set search_path=public,extensions;grant execute on function public.reschedule_public_booking_by_manage_token(text,timestamptz) to anon,authenticated;");
   const before=privileges(),fix=migration('20261015010000_booking_concurrency_guards');
   sql(fix);sql(fix);assert.equal(privileges(),before,'migration rerun preserves owner, grants, search_path and SECURITY DEFINER');
  }
  sql(`insert into locations values('${salon}');insert into staff(id,salon_id)values('${staff}','${salon}'),('${staff2}','${salon}');insert into services(id,salon_id,duration_minutes)values('${service}','${salon}',30);insert into booking_settings(salon_id,timezone_iana,default_cleanup_buffer_minutes,cancellation_window_minutes)values('${salon}','America/Chicago',15,1440);insert into staff_service_assignments(salon_id,staff_id,service_id)values('${salon}','${staff}','${service}'),('${salon}','${staff2}','${service}');insert into staff_availability_rules(salon_id,day_of_week,starts_at_local,ends_at_local)select '${salon}',n,'08:00','18:00' from generate_series(0,6)n;`);
  start=sql("select ((((now() at time zone 'America/Chicago')::date+3)+time '09:00') at time zone 'America/Chicago')::text");
  await t.test('simultaneous requests for one professional/time produce one booking and no orphan writes',async()=>{reset();const a=await hold(book('race-a')),app='race-'+randomUUID();const b=asyncSql(book('race-b'),app);try{await waitForLock(app);await a.commit();const result=await b;assert.equal(result.ok,false);assert.match(result.error,/unavailable|just booked/);assert.deepEqual(counts(),{bookings:1,customers:1,lines:1,events:1,notices:1});}finally{await a.rollback();}});
  await t.test('same idempotency key remains one request when concurrent availability chooses different professionals',async()=>{reset();const a=await hold(book('same-key',0,staff)),app='race-'+randomUUID();const b=asyncSql(book('same-key',0,staff2),app);try{await waitForLock(app);await a.commit();const result=await b;assert.equal(result.ok,true,result.error);assert.deepEqual(counts(),{bookings:1,customers:1,lines:1,events:1,notices:1});assert.equal(JSON.parse(result.out).duplicate,true);}finally{await a.rollback();}});
  await t.test('two bookings competing to reschedule to one slot retain the losing booking unchanged',async()=>{reset();const one=JSON.parse(sql(book('one',0))),two=JSON.parse(sql(book('two',60)));const a=await hold(moved(one.manage_token,180)),app='race-'+randomUUID();const b=asyncSql(moved(two.manage_token,180),app);try{await waitForLock(app);await a.commit();assert.equal((await b).ok,false);assert.equal(new Date(sql(`select start_at from bookings where id=${literal(two.booking_id)}`)).toISOString(),at(60));assert.equal(sql(`select count(*) from booking_lines where booking_id=${literal(two.booking_id)} and scheduled_start_at=${literal(at(60))}`),'1');}finally{await a.rollback();}});
  await t.test('concurrent moves of the same booking keep header and service-line times consistent',async()=>{reset();const one=JSON.parse(sql(book('one',0)));const a=await hold(moved(one.manage_token,120)),app='race-'+randomUUID();const b=asyncSql(moved(one.manage_token,240),app);try{await waitForLock(app);await a.commit();const result=await b;assert.equal(result.ok,true,result.error);assert.equal(sql('select count(*) from booking_lines l join bookings b on b.id=l.booking_id where l.scheduled_start_at=b.start_at and l.scheduled_end_at=b.end_at'),'1');}finally{await a.rollback();}});
  await t.test('uncommitted cancellation is not bookable; committing cancellation permits a new booking',async()=>{reset();const one=JSON.parse(sql(book('one',0))),a=await hold(`select cancel_public_booking_by_manage_token(${literal(one.manage_token)})`);try{const blocked=await asyncSql(book('too-early',0),'cancel-before-commit');assert.equal(blocked.ok,false);await a.commit();const again=JSON.parse(sql(book('after-cancel',0)));assert.equal(again.ok,true);assert.equal(sql('select count(*) from booking_staff_reservations'),'1');assert.deepEqual(counts(),{bookings:2,customers:2,lines:2,events:3,notices:2});}finally{await a.rollback();}});
  await t.test('cancellation racing with reschedule cannot resurrect a cancelled booking',async()=>{reset();const one=JSON.parse(sql(book('one',0))),a=await hold(`select cancel_public_booking_by_manage_token(${literal(one.manage_token)})`),app='race-'+randomUUID();const b=asyncSql(moved(one.manage_token,180),app);try{await waitForLock(app);await a.commit();const result=await b;assert.equal(result.ok,true,result.error);assert.equal(JSON.parse(result.out).code,'not_changeable');assert.equal(sql('select status from bookings'),'cancelled');assert.equal(sql('select count(*) from booking_staff_reservations'),'0');}finally{await a.rollback();}});
  await t.test('a failed later service line rolls back customer, booking, prior lines and notifications',async()=>{reset();await assert.rejects(async()=>sql(book('invalid-multi',0,staff,[line(0),{...line(45),service_id:id(999)}])),/does not belong/);assert.deepEqual(counts(),{bookings:0,customers:0,lines:0,events:0,notices:0});});

  // Real current customer ranking trigger: it obtains its global rank lock before scheduling.
  // Minimal ranking tables replace only storage; both function bodies come from migrations.
  sql('create trigger explore_rank_evidence_insert after insert on customers referencing new table as new_rows for each statement execute function explore_rank_evidence_insert()');
  for(const key of ['rank-order-key',null])await t.test('customer ranking then scheduling cannot deadlock with public create '+(key===null?'without a retry key':'with a retry key'),async()=>{
   reset();const a=await hold(`set local deadlock_timeout='50ms';insert into customers(location_id,name)values(${literal(salon)},'Isolated fixture')`),app='rank-race-'+randomUUID();
   const b=asyncSql(book(key,0,staff),app);
   try{await waitForLock(app);const first=await a.finish(book('customer-first',120,staff2)),second=await b;assert.equal(first.ok,true,first.error);assert.equal(second.ok,true,second.error);assert.equal(sql('select count(*) from bookings'),'2');assert.equal(sql('select count(*) from booking_staff_reservations'),'2');}finally{await a.rollback();await b;}
  });
  await t.test('idempotency lock is limited to the exact salon and retry key',async()=>{
   reset();const a=await hold(book('scope-key'));
   const probe=(location,key)=>sql(`select pg_try_advisory_xact_lock(hashtextextended('booking-idempotency:'||${literal(location)}||':'||${literal(key)},0))`);
   try{assert.equal(probe(salon,'scope-key'),'f');assert.equal(probe(salon,'other-key'),'t');assert.equal(probe(id(900),'scope-key'),'t');}finally{await a.rollback();}
  });

  const portable=(n=0,member=staff,customer=null,email=null)=>`select create_pos_portable_appointment_v2(${literal(id(800))},'fixture-only','POS fixture',null,${email===null?'null':literal(email)},${literal(service)},${literal(member)},${literal(at(n))},${customer===null?'null':literal(customer)})`;
  await t.test('portable POS and customer-first public booking follow the same rank-before-schedule lock order',async()=>{
   reset();const a=await hold(`set local deadlock_timeout='50ms';insert into customers(location_id,name)values(${literal(salon)},'Isolated fixture')`),app='pos-race-'+randomUUID();const b=asyncSql(portable(),app);
   try{await waitForLock(app);const first=await a.finish(book('customer-first-pos',120,staff2)),second=await b;assert.equal(first.ok,true,first.error);assert.equal(second.ok,true,second.error);assert.equal(sql('select count(*) from bookings'),'2');}finally{await a.rollback();await b;}
  });
  await t.test('concurrent portable POS requests retain one booking and roll back the losing customer',async()=>{
   reset();const a=await hold(portable()),app='pos-race-'+randomUUID(),b=asyncSql(portable(),app);
   try{await waitForLock(app);await a.commit();const result=await b;assert.equal(result.ok,false);assert.match(result.error,/No available professional/);assert.deepEqual(counts(),{bookings:1,customers:1,lines:1,events:0,notices:0});}finally{await a.rollback();await b;}
  });
  await t.test('portable POS retains deposit rejection and rolls back customer creation',async()=>{
   reset();sql('update booking_settings set deposit_required_enabled=true');try{const result=await asyncSql(portable(),'pos-deposit');assert.equal(result.ok,false);assert.match(result.error,/requires payment or a deposit/);assert.deepEqual(counts(),{bookings:0,customers:0,lines:0,events:0,notices:0});}finally{sql('update booking_settings set deposit_required_enabled=false');}
  });
  await t.test('portable POS still validates an existing customer belongs to its salon',async()=>{
   reset();sql(`insert into customers(id,location_id,name,status)values(${literal(id(901))},${literal(id(900))},'Other fixture','active')`);const result=await asyncSql(portable(0,staff,id(901)),'pos-scope');assert.equal(result.ok,false);assert.match(result.error,/Selected customer is unavailable/);assert.equal(sql('select count(*) from bookings'),'0');assert.equal(sql('select count(*) from customers'),'1');
  });

  await t.test('concurrent portable bookings with the same contact reuse one customer',async()=>{
   reset();const a=await hold(portable(0,staff,null,'same@example.invalid')),app='pos-contact-'+randomUUID(),b=asyncSql(portable(120,staff2,null,'same@example.invalid'),app);
   try{await waitForLock(app);await a.commit();const result=await b;assert.equal(result.ok,true,result.error);assert.equal(sql('select count(*) from bookings'),'2');assert.equal(sql('select count(*) from customers'),'1');assert.equal(sql('select count(distinct customer_id) from bookings'),'1');}finally{await a.rollback();await b;}
  });
 }finally{sql(`drop database ${database} with(force)`,'postgres');}
});
