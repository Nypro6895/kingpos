import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
test('staff reads owner monthly/twice-monthly changes only in their active salon, never writes',async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);const db=new PGlite();
 const salon='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',user='33333333-3333-4333-8333-333333333333';
 try{
 await db.exec(`create role authenticated;create table staff(id uuid,salon_id uuid,account_user_id uuid,is_active bool,created_at timestamptz);create function current_public_user_id() returns uuid language sql as $$select '${user}'::uuid$$;create table salon_payroll_settings(salon_id uuid primary key,cycle_type text);alter table salon_payroll_settings enable row level security;grant select,update on salon_payroll_settings to authenticated;insert into staff values('${user}','${salon}','${user}',true,now());insert into salon_payroll_settings values('${salon}','monthly'),('${other}','biweekly');`);
 const baseline=readFileSync('supabase/migrations/202607240001_account_salon_baseline.sql','utf8');const start=baseline.indexOf('create or replace function public.current_user_staff_id_for_salon(');await db.exec(baseline.slice(start,baseline.indexOf('$$;',start)+3));
 await db.exec(readFileSync('supabase/migrations/202610010003_staff_read_payroll_schedule.sql','utf8'));
 await db.exec('set role authenticated');assert.deepEqual((await db.query('select cycle_type from salon_payroll_settings')).rows,[{cycle_type:'monthly'}]);
 await db.exec("update salon_payroll_settings set cycle_type='biweekly';reset role;");assert.equal((await db.query(`select cycle_type from salon_payroll_settings where salon_id='${salon}'`)).rows[0].cycle_type,'monthly');
 await db.exec(`update salon_payroll_settings set cycle_type='semi_monthly' where salon_id='${salon}';set role authenticated;`);assert.deepEqual((await db.query('select cycle_type from salon_payroll_settings')).rows,[{cycle_type:'semi_monthly'}]);
 await db.exec('reset role;update staff set is_active=false;set role authenticated;');assert.equal((await db.query('select * from salon_payroll_settings')).rows.length,0);
 }finally{await db.close();}
});
