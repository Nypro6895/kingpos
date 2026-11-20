import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {historyNotificationFixture} from './helpers/history-notification-fixture.mjs';

const {db,row,actor,uid,date,past}=await historyNotificationFixture();
await db.exec(fs.readFileSync('supabase/migrations/20261030100000_history_notification_semantics.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261031051000_portable_daily_input_history.sql','utf8'));
await db.exec(`create or replace function public.pos_portable_access_has_capability(k uuid,s text,c text) returns boolean language sql stable as $$select k='${uid(80)}'::uuid and s='valid' and c='portable.report.view' and coalesce(current_setting('test.report_allowed',true),'yes')='yes'$$;`);
async function event(id,kind,day,salon=uid(1),before={},after={}){
 await db.query('insert into public.financial_input_events(id,salon_id,kind,business_date,source_id,before_values,after_values,note,actor_name) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(id),salon,kind,day,uid(400),before,after,'Owner reconciled cash','Salon Owner']);
}
await db.query('insert into public.locations values($1,$2,$3)',[uid(8),uid(2),'Other Salon']);
await event(301,'daily_report',date,uid(1),{}, {cash_amount:0,credit_card_amount:0,other_amount:0,tip_input:null,entered:false,note:null,private_staff_salary:999});
await event(302,'daily_report',date,uid(1),{cash_amount:105,tip_input:null,entered:true},{cash_amount:95,credit_card_amount:0,other_amount:0,tip_input:0,entered:true,note:'Counted again'});
await event(303,'daily_report',past);
await event(304,'daily_report',date,uid(8));
await event(305,'staff_day',date,uid(1),{service_total:999},{service_total:1000});
await event(306,'payroll_settings',date);
const read=async(key=uid(80),signature='valid',day=date)=>(await db.query('select to_jsonb(r) r from public.get_pos_portable_daily_input_history($1,$2,$3) r',[key,signature,day])).rows.map(row=>row.r);

test('signed Report returns only captured current-salon current-day closing inputs, without authentication cookie',async()=>{
 await actor(null);await db.exec('set role anon');
 const rows=await read();assert.deepEqual(new Set(rows.map(r=>r.id)),new Set([uid(301),uid(302)]));
 assert.ok(rows.every(r=>r.salon_id===uid(1)&&r.business_date===date&&r.business_timezone==='America/Chicago'));
 assert.equal(rows.find(r=>r.id===uid(302)).actor_name,'Salon Owner');
 assert.equal(rows.find(r=>r.id===uid(301)).after_values.private_staff_salary,undefined);
 assert.deepEqual(Object.keys(rows[0]).sort(),['id','salon_id','business_date','source_id','before_values','after_values','note','actor_name','created_at','event_action','business_timezone'].sort());
 await db.exec('reset role');
});
test('invalid signature, wrong terminal, missing Report capability and other business dates are denied',async()=>{
 await assert.rejects(read(uid(80),'invalid'),/access is unavailable/);
 await assert.rejects(read(uid(81)),/access is unavailable/);
 await db.exec("select set_config('test.report_allowed','no',false)");
 await assert.rejects(read(),/access is unavailable/);
 await db.exec("select set_config('test.report_allowed','yes',false)");
 await assert.rejects(read(uid(80),'valid',past),/today only/);
 await assert.rejects(read(uid(80),'valid',null),/today only/);
 const future=(await row('select ($1::date+1)::text d',[date])).d;
 await assert.rejects(read(uid(80),'valid',future),/today only/);
});
test('unknown input and entered zero retain their original facts; creation stays separate from an edit',async()=>{
 const rows=await read(),created=rows.find(r=>r.id===uid(301)),edited=rows.find(r=>r.id===uid(302));
 assert.equal(created.event_action,'created');assert.equal(edited.event_action,'updated');
 assert.equal(created.after_values.tip_input,null);assert.equal(created.after_values.entered,false);
 assert.equal(edited.before_values.cash_amount,105);assert.equal(edited.after_values.cash_amount,95);
 assert.equal(edited.before_values.tip_input,null);assert.equal(edited.after_values.tip_input,0);
 const before=await row('select count(*)::int n from public.app_notifications');await read();
 assert.deepEqual(await row('select count(*)::int n from public.app_notifications'),before);
 assert.equal((await row('select after_values from public.financial_input_events where id=$1',[uid(301)])).after_values.private_staff_salary,999);
});
test.after(async()=>await db.close());
