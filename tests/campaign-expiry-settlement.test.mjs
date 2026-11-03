import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignCumulativeDb,ids,readCampaignMigration} from './fixtures/campaign-cumulative-db.mjs';

const migration='20261021040000_campaign_expiry_settlement.sql';
const {owner,viewer,salon,campaign,nonce}=ids;
// Reproduce the pre-fix invariant failure explicitly; normal runs always apply it.
const migrations=process.env.CAMPAIGN_EXPIRY_BASELINE==='1'?[]:[migration];
const area={country:'US',state:'WI',city:'Milwaukee'};
async function state(db){return (await db.query(`select c.status,c.keep_running,c.views,c.spent_cents,c.reserved_credits,c.released_credits,c.cycle_credit_limit,
 w.available_credits,w.reserved_credits wallet_reserved,(select count(*)::int from owner_campaign_events) events,
 (select count(*)::int from campaign_credit_ledger where kind='release') releases,
 (select coalesce(sum(credits),0)::int from campaign_credit_ledger where kind='release') returned
 from owner_campaigns c join campaign_wallets w using(salon_id) where c.id=$1`,[campaign])).rows[0];}
async function isolated(db,run){await db.exec('begin');try{await run();}finally{await db.exec('rollback');}}
const close=db=>db.query('select campaign_credit_close_expired($1)',[salon]);
const renew=async db=>(await db.query('select campaign_credit_renew($1) ok',[campaign])).rows[0].ok;
const admit=async db=>(await db.query("select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,'a'.repeat(64),area,viewer,nonce])).rows[0].ok;

test('expired invalid keep-running releases only unused credits, once',async()=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  assert.equal(await admit(db),true);
  await db.exec("update owner_campaigns set keep_running=true,ends_at=now(); update salon_profile_looks set status='draft'");
  const before=await state(db);assert.equal(before.spent_cents,1);assert.equal(before.wallet_reserved,299);
  assert.equal(await renew(db),false);
  await close(db);
  const after=await state(db);
  assert.equal(after.status,'completed','expired invalid source must not bypass both renewal and closure');
  assert.equal(after.released_credits,299);assert.equal(after.available_credits,299);assert.equal(after.wallet_reserved,0);
  assert.equal(after.releases,1);assert.equal(after.returned,299);
  assert.equal(after.views,before.views);assert.equal(after.spent_cents,before.spent_cents);assert.equal(after.events,before.events);
  assert.equal(after.keep_running,true,'closure must not silently change renewal consent');
  await close(db);assert.deepEqual(await state(db),after,'repeated close cannot release twice');
 }finally{await db.close();}
});

test('expiry eligibility uses actual source and existing global/plugin guards',async t=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  for(const [label,change] of [
   ['deleted post',"update salon_profile_looks set deleted_at=now()"],
   ['safety hold',"update salon_profile_looks set safety_hold=true"],
   ['missing post','delete from salon_profile_looks'],
   ['discovery disabled','update salon_settings set public_discovery_enabled=false'],
   ['inactive account',"update accounts set status='inactive'"],
   ['plugin disabled','update campaign_wallets set installed=false'],
   ['global disabled',"update owner_campaign_settings set config=config || '{\"enabled\":false}'"],
  ])await t.test(label,()=>isolated(db,async()=>{
   await db.exec('update owner_campaigns set keep_running=true,ends_at=now()');await db.exec(change);
   await close(db);const after=await state(db);assert.equal(after.status,'completed');assert.equal(after.wallet_reserved,0);assert.equal(after.available_credits,300);assert.equal(after.returned,300);
  }));
  await t.test('invalid source before expiry remains untouched',()=>isolated(db,async()=>{
   await db.exec("update owner_campaigns set keep_running=true,ends_at=now()+interval '1 microsecond'; update salon_profile_looks set status='draft'");
   const before=await state(db);await close(db);assert.deepEqual(await state(db),before);
  }));
 }finally{await db.close();}
});

test('valid keep-running retains reserve for renewal at its existing chosen limit',async()=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  await db.query('select campaign_set_credit_limit($1,$2,$3,150,true)',[salon,owner,campaign]);
  await db.exec('update owner_campaigns set ends_at=now()');
  const before=await state(db);await close(db);assert.deepEqual(await state(db),before);
  assert.equal(await renew(db),true);const after=await state(db);
  assert.equal(after.status,'running');assert.equal(after.cycle_credit_limit,150);assert.equal(after.wallet_reserved,150);assert.equal(after.available_credits,150);
  assert.equal(after.reserved_credits,300);assert.equal(after.released_credits,150);assert.equal(after.spent_cents,0);assert.equal(after.events,0);
  assert.equal(await renew(db),false);await close(db);assert.deepEqual(await state(db),after,'current period is not renewed or released twice');
 }finally{await db.close();}
});

test('source restoration can renew existing intent without double refund',async()=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  await db.exec("update owner_campaigns set keep_running=true,ends_at=now(); update salon_profile_looks set status='draft'");
  await close(db);assert.equal((await state(db)).returned,300);
  await db.exec("update salon_profile_looks set status='published'");
  assert.equal(await renew(db),true);const after=await state(db);assert.equal(after.wallet_reserved,300);assert.equal(after.available_credits,0);assert.equal(after.releases,1);
  await close(db);assert.deepEqual(await state(db),after);
 }finally{await db.close();}
});

test('salon close settles more than100 expired rows without crossing salon scope',async()=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  await db.exec(`update owner_campaigns set keep_running=true,ends_at=now(); update salon_profile_looks set status='draft';
   insert into owner_campaigns(id,salon_id,owner_id,source_type,source_id,title,area,location,country,state,city,days,daily_views,daily_price_cents,total_price_cents,status,payment_reference,approved_at,starts_at,ends_at,reserved_credits,keep_running,cycle_credit_limit)
   select gen_random_uuid(),'${salon}','${owner}','salon_profile_look',gen_random_uuid(),'Expired fixture','city','Milwaukee','US','WI','Milwaukee',1,100,100,100,'running','fixture:'||i,now(),now()-interval '1 day',now(),100,true,100 from generate_series(1,150) i;
   update campaign_wallets set reserved_credits=15300;
   insert into accounts values('10000000-0000-0000-0000-000000000002','active');
   insert into locations values('10000000-0000-0000-0000-000000000002','active','10000000-0000-0000-0000-000000000002','Other fixture');
   insert into campaign_wallets(salon_id,installed,reserved_credits) values('10000000-0000-0000-0000-000000000002',true,100);
   insert into salon_market_plugins(salon_id,plugin_id) values('10000000-0000-0000-0000-000000000002','campaigns');
   insert into owner_campaigns(id,salon_id,owner_id,source_type,source_id,title,area,location,country,state,city,days,daily_views,daily_price_cents,total_price_cents,status,starts_at,ends_at,reserved_credits,keep_running)
   values(gen_random_uuid(),'10000000-0000-0000-0000-000000000002','${owner}','salon_profile_look',gen_random_uuid(),'Other salon','city','Milwaukee','US','WI','Milwaukee',1,100,100,100,'running',now()-interval '1 day',now(),100,true);`);
  await close(db);
  const first=(await db.query(`select count(*)::int campaigns,count(*) filter(where status='completed')::int completed,sum(released_credits)::int returned from owner_campaigns where salon_id=$1`,[salon])).rows[0];
  assert.deepEqual(first,{campaigns:151,completed:151,returned:15300});
  const other=(await db.query("select c.status,c.released_credits,w.available_credits,w.reserved_credits from owner_campaigns c join campaign_wallets w using(salon_id) where c.salon_id<>$1",[salon])).rows[0];
  assert.deepEqual(other,{status:'running',released_credits:0,available_credits:0,reserved_credits:100});
  const money=await state(db);assert.equal(money.available_credits,15300);assert.equal(money.wallet_reserved,0);assert.equal(money.releases,151);
  await close(db);assert.deepEqual(await state(db),money);
 }finally{await db.close();}
});

test('source lookup failure rolls back settlement and the same close safely retries',async()=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  await db.exec("update owner_campaigns set keep_running=true,ends_at=now(); update salon_profile_looks set status='draft'");
  const original=(await db.query("select pg_get_functiondef('owner_campaign_post(text,uuid,uuid)'::regprocedure) definition")).rows[0].definition;
  const before=await state(db);
  await db.exec("create or replace function owner_campaign_post(p_type text,p_source uuid,p_salon uuid) returns jsonb language plpgsql security definer set search_path=public as $$ begin raise exception 'fixture lookup failed'; end $$;");
  await assert.rejects(close(db),/fixture lookup failed/);assert.deepEqual(await state(db),before);
  await db.exec(original);await close(db);const after=await state(db);assert.equal(after.available_credits,300);assert.equal(after.releases,1);
  await close(db);assert.deepEqual(await state(db),after);
 }finally{await db.close();}
});

test('stale expired admission legitimately refunds while adding zero views and spend',async()=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  await db.exec('update owner_campaigns set ends_at=now()');const before=await state(db);
  assert.equal(await admit(db),false);const after=await state(db);
  assert.equal(after.views,before.views);assert.equal(after.spent_cents,before.spent_cents);assert.equal(after.events,before.events);
  assert.equal(after.available_credits,300);assert.equal(after.wallet_reserved,0);assert.equal(after.returned,300);
  await close(db);assert.deepEqual(await state(db),after);
 }finally{await db.close();}
});

test('expiry migration is rerunnable and preserves authority, security and other accounting functions',async()=>{
 const db=await createCampaignCumulativeDb();
 try{
  const snapshot=async()=> (await db.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.proowner
   from pg_proc p where p.oid=any($1::regprocedure[]) order by 1`,[['campaign_credit_renew(uuid)','campaign_credit_release()','owner_campaign_admit(uuid,text,text,jsonb,uuid,uuid)','owner_campaign_change(uuid,uuid,uuid,text)','owner_campaign_change_original(uuid,uuid,uuid,text)']])).rows;
  const before=await snapshot();
  const security=async()=> (await db.query(`select prosecdef,proconfig,proacl::text acl,proowner,
   has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service_role
   from pg_proc where oid='campaign_credit_close_expired(uuid)'::regprocedure`)).rows[0];
  const beforeSecurity=await security();
  await db.exec(readCampaignMigration(migration));await db.exec(readCampaignMigration(migration));
  assert.deepEqual(await snapshot(),before);assert.deepEqual(await security(),beforeSecurity);
  assert.equal(beforeSecurity.prosecdef,true);assert.deepEqual(beforeSecurity.proconfig,['search_path=public']);assert.equal(beforeSecurity.anon,false);assert.equal(beforeSecurity.authenticated,false);assert.equal(beforeSecurity.service_role,true);
 }finally{await db.close();}
});
