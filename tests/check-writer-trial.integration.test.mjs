import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{PGlite}from'@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids={admin:id(1),owner:id(2),other:id(3),operator:id(4),suspended:id(5),salon:id(10),otherSalon:id(11)};
test('Check Writer trial: immutable owner-bound access, real settings/issuance, expiry and service-only authority',{timeout:120000},async t=>{
 const db=new PGlite(),query=(sql,args=[])=>db.query(sql,args),trial=(actor=ids.owner,start=true,salon=ids.salon)=>query('select check_writer_trial($1,$2,$3) value',[salon,actor,start]).then(r=>r.rows[0].value);
 try{
  await db.exec(readFileSync('tests/fixtures/check-writer-bootstrap.sql','utf8').replace(/\$\{(\w+)\}/g,(_,n)=>ids[n]));
  await db.exec('create table payroll_runs(id uuid primary key,salon_id uuid,period_start date,period_end date,version integer,status text);create table payroll_staff_lines(id uuid primary key,salon_id uuid,payroll_run_id uuid,staff_id uuid,updated_at timestamptz,final_check_amount numeric,final_cash_amount numeric,tip_amount numeric,bonus_amount numeric,gross_sales numeric,check_number text);');
  const original=readFileSync('supabase/migrations/20261028040000_check_writer.sql','utf8');await db.exec(original.slice(0,original.indexOf('-- Extend existing audited billing'))+'commit;');
  await db.exec(readFileSync('supabase/migrations/20261103204157_check_writer_trial.sql','utf8'));
  await t.test('nonowners, inactive owners and inactive salons cannot activate',async()=>{
   for(const actor of[ids.other,ids.admin,ids.operator])await assert.rejects(trial(actor),/active salon Owner/);
   await query("update users set status='suspended' where id=$1",[ids.owner]);await assert.rejects(trial(),/active salon Owner/);await query("update users set status='active' where id=$1",[ids.owner]);
   await query("update locations set status='suspended' where id=$1",[ids.salon]);await assert.rejects(trial(),/active salon Owner/);await query("update locations set status='active' where id=$1",[ids.salon]);
   assert.equal((await query('select count(*)::int n from check_writer_subscriptions')).rows[0].n,0);
  });
  let expires;
  await t.test('start is once per salon and retains independent paid/provider fields',async()=>{
   assert.deepEqual(await trial(ids.owner,false),{started:false,active:false,endsAt:null,paid:false});
   const started=await trial();expires=started.endsAt;assert.equal(started.active,true);assert.equal(started.paid,false);assert.ok(Date.parse(expires)-Date.now()>4.99*86400000);
   const attempts=await Promise.all([trial(),trial()]);assert.ok(attempts.every(r=>r.endsAt===expires));
   const row=(await query('select * from check_writer_subscriptions')).rows[0];assert.equal(row.trial_owner,ids.owner);assert.equal(row.paid_until,null);assert.equal(row.payment_owner,null);assert.equal(row.stripe_subscription,null);
   assert.equal((await query("select count(*)::int n from check_writer_events where action='trial_started'")).rows[0].n,1);
  });
  await t.test('a trial grants actual settings and issuance through the unchanged permission guard',async()=>{
   await query('select check_writer_assert($1,$2,true)',[ids.salon,ids.owner]);
   await query('select check_writer_save_settings($1,$2,$3,$4,$5,$6)',[ids.salon,ids.owner,'encrypted-fixture',JSON.stringify({stock:'blank'}),100,0]);
   const items=JSON.stringify([{payee:'Synthetic QA',amountCents:12500,memo:'Trial fixture'}]);
   const first=await query('select check_writer_issue($1,$2,$3,$4,$5,$6) value',[ids.salon,ids.owner,id(50),'same-batch',1,items]);
   assert.equal(first.rows[0].value.length,1);const again=await query('select check_writer_issue($1,$2,$3,$4,$5,$6) value',[ids.salon,ids.owner,id(50),'same-batch',1,items]);assert.deepEqual(again.rows[0].value,first.rows[0].value);
   assert.equal((await query('select count(*)::int n from check_writer_checks')).rows[0].n,1);assert.equal((await query('select count(*)::int n from payroll_runs')).rows[0].n,0);
  });
  await t.test('owner rotation cannot transfer, restart or use the original trial',async()=>{
   await query('update locations set owner_id=$1 where id=$2',[ids.other,ids.salon]);
   await assert.rejects(trial(),/active salon Owner/);await assert.rejects(trial(ids.other),/Owner who started/);await assert.rejects(query('select check_writer_assert($1,$2,true)',[ids.salon,ids.other]),/Activate Check Writer/);
   assert.equal((await query('select trial_ends_at from check_writer_subscriptions')).rows[0].trial_ends_at.toISOString(),new Date(expires).toISOString());
   await query('update locations set owner_id=$1 where id=$2',[ids.owner,ids.salon]);
  });
  await t.test('expiration stops active operations, cannot reset, and leaves paid ownership independent',async()=>{
   await query("update check_writer_subscriptions set trial_ends_at=now()-interval '1 second'");const ended=await trial();assert.equal(ended.active,false);assert.equal(ended.paid,false);assert.equal((await trial()).endsAt,ended.endsAt);
   await assert.rejects(query('select check_writer_assert($1,$2,true)',[ids.salon,ids.owner]),/Activate Check Writer/);
   await query("update check_writer_subscriptions set paid_until=now()+interval '2 days',payment_owner=$1",[ids.owner]);assert.equal((await trial()).paid,true);await query('select check_writer_assert($1,$2,true)',[ids.salon,ids.owner]);
   await query('update locations set owner_id=$1 where id=$2',[ids.other,ids.salon]);await query('update check_writer_subscriptions set payment_owner=$1',[ids.other]);assert.equal((await trial(ids.other)).paid,true);await query('select check_writer_assert($1,$2,true)',[ids.salon,ids.other]);
  });
  await t.test('anonymous/authenticated SQL clients cannot call the service boundary or read private rows',async()=>{
   for(const role of['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(trial(ids.other),/permission denied/);await assert.rejects(query('select * from check_writer_subscriptions'),/permission denied/);await assert.rejects(query('select * from check_writer_settings'),/permission denied/);}finally{await db.exec('reset role');}}
   await db.exec('set role service_role');try{assert.equal((await trial(ids.other,false)).paid,true);}finally{await db.exec('reset role');}
  });
 }finally{await db.close();}
});
