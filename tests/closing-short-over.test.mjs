import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const salon='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001';
test('closing attention follows canonical comparison; ignore is per owner and comparison revision',async()=>{
 const db=new PGlite();
 try {
  await db.exec('create role anon;create role authenticated;');
  await db.exec(fs.readFileSync('tests/fixtures/owner-attention-schema.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261101070000_owner_financial_attention.sql','utf8'));
  // The real canonical function is unchanged. Fixture values model its final net
  // output (after discounts and rewards); attention must consume it verbatim.
  await db.exec(`create table comparison_fixture(salon_id uuid,business_date date,expected numeric,actual numeric,difference numeric);
   create function public.daily_input_reconciliation_values(uuid,date) returns jsonb language sql stable as $$
    select jsonb_build_object('expectedService',expected,'actualService',actual,'serviceDifference',difference)
    from comparison_fixture where salon_id=$1 and business_date=$2 $$;`);
  await db.exec(fs.readFileSync('supabase/migrations/20261103221000_closing_attention_short_over.sql','utf8'));
  await db.exec(`insert into locations values('${salon}');insert into users values('${owner}'),('20000000-0000-4000-8000-000000000002');
   select set_config('test.user_id','${owner}',false);
   insert into comparison_fixture values('${salon}','2026-10-30',111,111,0),('${salon}','2026-10-31',100,90,-10),('${salon}','2026-11-01',100,110,10),('${salon}','2026-10-29',100,null,null);
   insert into pos_daily_closings(salon_id,report_date,live_report_entered_at) values('${salon}','2026-10-30',now()),('${salon}','2026-10-31',now()),('${salon}','2026-11-01',now()),('${salon}','2026-10-29',null);
   insert into shop_daily_collections values('${salon}','2026-10-30',999,0,0,1,now(),null);`);
  const read=async()=> (await db.query(`select owner_financial_attention('${salon}') as data`)).rows[0].data;
  let result=await read();assert.equal(result.total,1);
  assert.equal(result.items[0].difference,-10);assert.equal(result.items[0].facts,undefined);
  assert.match(result.items[0].label,/Short \$10/);
  const key=result.items[0].item_key;
  const detail=(await db.query(`select owner_financial_attention($1,$2) as data`,[salon,key])).rows[0].data.items[0];
  assert.equal(detail.facts.expectedService,100);assert.equal(detail.facts.actualService,90);assert.equal(detail.facts.collection,undefined);
  await db.query('select owner_financial_attention_action($1,$2,$3)',[salon,key,'ignore']);
  assert.equal((await read()).total,0);
  await db.exec(`select set_config('test.user_id','20000000-0000-4000-8000-000000000002',false);`);
  assert.equal((await read()).total,1);
  await db.exec(`select set_config('test.user_id','${owner}',false);update comparison_fixture set actual=105,difference=5 where business_date='2026-10-31';`);
  result=await read();assert.equal(result.total,1);assert.match(result.items[0].label,/Over \$5/);assert.notEqual(result.items[0].item_key,key);
  await assert.rejects(db.query('select owner_financial_attention_action($1,$2,$3)',[salon,key,'ignore']),/changed or was resolved/);
  await assert.rejects(db.query('select owner_financial_attention_action($1,$2,$3)',[salon,result.items[0].item_key,'review_closing']),/Invalid attention action/);
  await db.exec(`update comparison_fixture set actual=100,difference=0 where business_date='2026-10-31';`);
  assert.equal((await read()).total,0);
 } finally {await db.close();}
});
