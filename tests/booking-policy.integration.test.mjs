import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const salon='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
test('Only owners edit rules; public visibility requires publication and paid access; drafts survive expiry',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;
   create table locations(id uuid primary key,status text);create table users(id uuid primary key);
   create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
   create function lifecycle_user_is_salon_owner(salon uuid,actor uuid,pending boolean) returns boolean language sql as $$select salon=actor$$;
   insert into locations values('${salon}','active'),('${other}','active');`);
  await db.exec(fs.readFileSync('supabase/migrations/20261009130031_booking_policy_plugin.sql','utf8'));
  const read=async(id=salon)=>(await db.query('select public_booking_policy($1) as rules',[id])).rows[0].rules;
  const save=async(content,published=true)=>db.query('select booking_policy_save($1,$2,$3)',[salon,content,published]);
  await db.exec(`set role authenticated;select set_config('test.user','${other}',false)`);
  await assert.rejects(save('Wrong owner'),/owner access/);
  await db.exec(`select set_config('test.user','${salon}',false)`);
  await save('Please arrive early.');assert.equal(await read(),null);
  await assert.rejects(save(' '.repeat(10)),/Enter booking rules/);
  await assert.rejects(save('x'.repeat(6001)),/Enter booking rules/);
  await assert.rejects(db.query('select * from booking_policy_subscriptions'),/permission denied/);
  await db.exec(`reset role;update booking_policy_subscriptions set paid_until=now()+interval '1 month';set role anon`);
  assert.equal(await read(),'Please arrive early.');assert.equal(await read(other),null);
  await assert.rejects(save('Anonymous edit'),/permission denied/);
  await db.exec(`reset role;set role authenticated;select set_config('test.user','${salon}',false)`);
  await save('Updated rules',false);assert.equal(await read(),null);
  await save('Updated rules',true);assert.equal(await read(),'Updated rules');
  await db.exec(`reset role;update booking_policy_subscriptions set paid_until=now()-interval '1 day'`);
  assert.equal(await read(),null);
  assert.equal((await db.query('select content from booking_policy_subscriptions')).rows[0].content,'Updated rules');
  await db.exec(`update booking_policy_subscriptions set paid_until=now()+interval '1 month';update locations set status='closed' where id='${salon}'`);
  assert.equal(await read(),null);
 }finally{await db.close();}
});
