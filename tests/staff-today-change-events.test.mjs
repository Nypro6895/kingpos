import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
test('earnings/items/payroll invalidations cover inserts, updates and deletes, and roll back with the write',async()=>{
  const {PGlite}=await import(process.env.PGLITE_MODULE_PATH?pathToFileURL(process.env.PGLITE_MODULE_PATH).href:'@electric-sql/pglite');
  const db=new PGlite();
  try {
    const tables=['pos_ticket_staff_earnings','pos_ticket_items','pos_financial_adjustments','staff_payroll_settings','salon_payroll_settings','payroll_period_staff_inputs','payroll_runs','payroll_staff_lines','payroll_staff_daily_totals','payroll_paystubs'];
    await db.exec(`create table events(resource text,operation text);create function notify_pos_workspace_change() returns trigger language plpgsql as $$begin insert into events values(TG_ARGV[0],TG_OP);return null;end;$$;`);
    for(const table of tables)await db.exec(`create table ${table}(id int primary key,salon_id uuid,staff_id uuid,ticket_id uuid,pos_ticket_id uuid);`);
    await db.exec(readFileSync('supabase/migrations/202609250004_staff_today_change_events.sql','utf8'));
    for(const table of tables)await db.exec(`insert into ${table}(id) values(1);update ${table} set id=2;delete from ${table};`);
    assert.equal((await db.query('select count(*)::int total from events')).rows[0].total,30);
    assert.equal((await db.query("select count(*)::int total from events where resource='tickets'")).rows[0].total,6);
    await db.exec('begin;insert into pos_ticket_staff_earnings(id) values(1);rollback;');
    assert.equal((await db.query('select count(*)::int total from events')).rows[0].total,30);
  }finally{await db.close();}
});
