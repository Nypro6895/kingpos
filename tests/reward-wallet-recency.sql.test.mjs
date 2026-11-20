import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('wallet read extension preserves personal authority, recency and visit delegation',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; grant usage on schema public to anon,authenticated;
   create table customers(id uuid primary key,customer_user_id uuid);
   create table customer_visits(id uuid primary key,customer_id uuid);
   create table reward_members(salon_id uuid,user_id uuid,joined_at timestamptz,primary key(salon_id,user_id));
   create table reward_ledger(salon_id uuid,user_id uuid,delta integer);
   create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
   create function reward_view(p_salon uuid,p_user uuid) returns jsonb language sql stable as $$select jsonb_build_object('salonId',p_salon,'available',coalesce((select sum(delta) from reward_ledger where salon_id=p_salon and user_id=p_user),0))$$;
   create function reward_request_command(p_visit uuid,p_op text,p_args jsonb,p_customer boolean) returns jsonb language sql as $$select jsonb_build_object('delegated',true,'visitId',p_visit,'op',p_op,'customer',p_customer)$$;
   create function reward_personal(p_op text,p_args jsonb default '{}') returns jsonb language sql as $$select '{}'::jsonb$$;
   revoke all on function reward_personal(text,jsonb) from public; grant execute on function reward_personal(text,jsonb) to authenticated;
   revoke all on all tables in schema public from public,anon,authenticated;`);
  await db.exec(fs.readFileSync('supabase/migrations/20261103010000_reward_wallet_recency.sql','utf8'));
  const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000002';
  const salons=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
  await db.exec(`insert into reward_members values('${salons[0]}','${a}','2026-10-01Z'),('${salons[1]}','${a}','2026-11-03 00:00:00.000001Z'),('${salons[2]}','${a}','2026-11-03 00:00:00.000999Z'),('${salons[0]}','${b}','2026-11-04Z');
   insert into reward_ledger values('${salons[0]}','${a}',999),('${salons[1]}','${a}',5),('${salons[0]}','${b}',777);
   insert into customers values('${a}','${a}'),('${b}','${b}');insert into customer_visits values('${a}','${a}'),('${b}','${b}');`);
  const wallet=async()=> (await db.query("select reward_personal('wallet') as data")).rows[0].data;
  await db.exec(`set role authenticated;select set_config('test.viewer','${a}',false);`);
  const own=await wallet();
  assert.deepEqual(own.cards.map(c=>c.salonId),[salons[2],salons[1],salons[0]]);
  assert.equal(own.cards[0].available,0,'latest membership wins despite zero points');
  assert.ok(own.cards.every(c=>c.joinedAt));
  await assert.rejects(()=>db.query('select * from reward_members'),/permission denied/);
  const visit=(await db.query(`select reward_personal('load','{"visitId":"${a}"}') as data`)).rows[0].data;
  assert.equal(visit.delegated,true);assert.equal(visit.customer,true);
  await assert.rejects(()=>db.query(`select reward_personal('load','{"visitId":"${b}"}')`),/does not belong/);
  await db.exec(`select set_config('test.viewer','${b}',false)`);
  const other=await wallet();assert.equal(other.cards.length,1);assert.equal(other.cards[0].available,777);
  await db.exec("select set_config('test.viewer','',false)");
  await assert.rejects(wallet,/Sign in required/);
  await db.exec('set role anon');await assert.rejects(wallet,/permission denied/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from reward_members')).rows[0].n,4);
  assert.equal((await db.query('select count(*)::int as n from reward_ledger')).rows[0].n,3,'reads do not earn points');
 }finally{await db.close();}
});
