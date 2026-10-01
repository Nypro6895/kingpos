import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
test('paystub history isolates staff, hides drafts/shop snapshots; cleanup protects referenced files',async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href); const db=new PGlite();
 const salon='11111111-1111-4111-8111-111111111111',staff='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333';
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 create function current_public_user_id() returns uuid language sql as $$select auth.uid()$$;
 create function user_has_salon_permission(s uuid,p text[]) returns boolean language sql as $$select s='${salon}' and current_setting('test.manager',true)='yes'$$;
 create table staff(id uuid,salon_id uuid,is_active boolean,account_user_id uuid,user_id uuid);
 create table payroll_runs(id uuid,salon_id uuid,period_start date,period_end date,cycle_type text,status text,version int,generated_at timestamptz,printed_at timestamptz,locked_at timestamptz,paid_at timestamptz,created_at timestamptz,updated_at timestamptz,settings_snapshot jsonb,correction_snapshot jsonb);
 create table payroll_staff_lines(payroll_run_id uuid,salon_id uuid,staff_id uuid);
 create table payroll_paystubs(file_url_or_path text);
 create table storage.objects(name text,bucket_id text);alter table storage.objects enable row level security;
 grant usage on schema public,storage,auth to authenticated;grant select,delete on storage.objects to authenticated;
 insert into staff values('${staff}','${salon}',true,'${user}',null);
 select set_config('test.user','${user}',false);select set_config('test.manager','no',false);`);
 await db.exec(readFileSync('supabase/migrations/202609250005_staff_paystub_history.sql','utf8'));
 for(let i=1;i<=4;i++){
 const id=`00000000-0000-4000-8000-00000000000${i}`;
 await db.exec(`insert into payroll_runs(id,salon_id,period_start,period_end,cycle_type,status,version,settings_snapshot,correction_snapshot) values('${id}','${salon}','2026-08-01','2026-08-31','monthly','${i===3?'draft':'paid'}',${i},'{"secret":true}','[{"coworker":true}]');insert into payroll_staff_lines values('${id}','${salon}','${i===4?user:staff}');`);
 }
 await db.exec('set role authenticated');
 const rows=(await db.query(`select get_my_staff_payroll_runs('${salon}') data`)).rows[0].data;
 assert.equal(rows.length,2);assert.equal(rows[0].version,2);assert.deepEqual(rows[0].settings_snapshot,{});assert.deepEqual(rows[0].correction_snapshot,[]);
 await assert.rejects(()=>db.query("select get_my_staff_payroll_runs('99999999-9999-4999-8999-999999999999')"),/unique active/);
 await db.exec('reset role');
 const used=`account/${salon}/run/staff/used.pdf`,unused=`account/${salon}/run/staff/unused.pdf`;
 await db.exec(`insert into payroll_paystubs values('${used}');insert into storage.objects values('${used}','payroll-paystubs'),('${unused}','payroll-paystubs'),('bad-path','payroll-paystubs');set role authenticated;delete from storage.objects;reset role;`);
 assert.equal((await db.query('select count(*)::int n from storage.objects')).rows[0].n,3);
 await db.exec(`select set_config('test.manager','yes',false);set role authenticated;delete from storage.objects;reset role;`);
 assert.deepEqual((await db.query('select name from storage.objects order by name')).rows.map(r=>r.name).sort(),[used,'bad-path'].sort());
 await db.exec(`select set_config('test.user','',false);set role authenticated;`);
 await assert.rejects(()=>db.query(`select get_my_staff_payroll_runs('${salon}')`),/Authentication/);
 }finally{await db.close();}
});
