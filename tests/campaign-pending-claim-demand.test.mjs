import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignCumulativeDb,ids,readCampaignMigration} from './fixtures/campaign-cumulative-db.mjs';

const {salon,owner,viewer,campaign}=ids;
const migrations=[
 '20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql',
 '20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql',
 '20261021080000_campaign_admin_pause_status.sql',
];
const migration=readCampaignMigration('20261021090000_campaign_pending_claim_demand.sql');
const order=async(db,automatic=true)=>(await db.query('select campaign_credit_order($1,$2,500,$3) id',[salon,owner,automatic])).rows[0].id;
const claim=async(db,id)=>(await db.query('select campaign_credit_claim($1) result',[id])).rows[0].result;
const pause=db=>db.query("select owner_campaign_change($1,$2,$3,'pause')",[campaign,salon,owner]);
const close=db=>db.query('select campaign_credit_close_expired($1)',[salon]);
async function isolated(db,run){await db.exec('begin');try{await run();}finally{await db.exec('rollback');}}
async function rejected(db,run,pattern){await db.exec('savepoint expected_failure');try{await assert.rejects(run,pattern);}finally{await db.exec('rollback to expected_failure;release expected_failure');}}
async function prepare(db){
 // Disposable fixture balances model a wallet above its global threshold but
 // below the saved renewal estimate. The order itself uses the actual RPC.
 await db.query(`update campaign_wallets set available_credits=200,threshold_credits=0,auto_topup_enabled=true,
 stripe_customer='fixture-customer',stripe_payment_method='fixture-method',payment_owner=$1,auto_topup_consent_at=now(),monthly_limit_cents=3000 where salon_id=$2`,[owner,salon]);
 await db.query("update owner_campaigns set keep_running=true,ends_at=now()-interval '1 second' where id=$1",[campaign]);
 const id=await order(db);assert.ok(id);return id;
}
const snapshot=async db=>(await db.query(`select
 (select jsonb_agg(to_jsonb(w) order by salon_id) from campaign_wallets w) wallets,
 (select jsonb_agg(to_jsonb(o) order by id) from campaign_credit_orders o) orders,
 (select jsonb_agg(to_jsonb(l) order by id) from campaign_credit_ledger l) ledger,
 (select jsonb_agg(to_jsonb(c) order by id) from owner_campaigns c) campaigns`)).rows[0];
async function functions(db){return(await db.query(`select p.oid::regprocedure::text signature,p.prosrc,p.prosecdef,p.proconfig,p.proacl::text acl,p.proowner
 from pg_proc p where p.oid=any($1::regprocedure[]) order by p.oid`,[[
 'campaign_credit_claim(uuid)','campaign_credit_claim_before_workspace(uuid)',
 'campaign_credit_order(uuid,uuid,integer,boolean)','campaign_credit_order_before_workspace(uuid,uuid,integer,boolean)',
 'campaign_credit_paid(uuid,text,integer,text,text)','campaign_credit_paid_before_workspace(uuid,text,integer,text,text)',
 ]])).rows;}
async function otherCampaign(db,{kind='fund',paused=false,auto=true,expired=true}={}){
 const sourceId=(await db.query(`insert into salon_profile_looks(id,salon_id,title,caption,status,author_user_id,safety_hold,deleted_at)
  values(gen_random_uuid(),$1,'Other published look','Fixture gel manicure','published',$2,false,null) returning id`,[salon,owner])).rows[0].id;
 const newId=(await db.query(`insert into owner_campaigns(id,salon_id,owner_id,source_type,source_id,title,area,location,country,state,city,days,daily_views,daily_price_cents,total_price_cents,status,auto_fund,keep_running,ends_at)
 select gen_random_uuid(),salon_id,owner_id,source_type,$6,'Other campaign','city',location,country,state,city,days,daily_views,daily_price_cents,300,$2,$3,$4,
 now()+case when $5 then interval '-1 second' else interval '1 day' end from owner_campaigns where id=$1 returning id`,
 [campaign,paused?'paused':kind==='fund'?'awaiting_payment':'completed',auto,kind==='renew',expired,sourceId])).rows[0].id;
 return newId;
}

test('pending automatic claim rechecks current demand without changing processing, payments or financial guards',async t=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  await t.test('before 090, a pending order created for renewal remains claimable after Pause and settlement remove its demand',async()=>isolated(db,async()=>{
   const id=await prepare(db);await pause(db);await close(db);
   assert.equal((await db.query('select available_credits from campaign_wallets where salon_id=$1',[salon])).rows[0].available_credits,500);
   assert.deepEqual(await claim(db,id),{customer:'fixture-customer',method:'fixture-method',amount:500});
   assert.equal((await db.query('select status from campaign_credit_orders where id=$1',[id])).rows[0].status,'processing');
  }));
  const previousFunctions=await functions(db);const previousRows=await snapshot(db);await db.exec(migration);
  await t.test('migration only inserts a pending-demand guard in the inner claim; data, outer wrapper, ACL and other financial functions are unchanged',async()=>{
   assert.deepEqual(await snapshot(db),previousRows);
   const after=await functions(db);
   for(let index=0;index<previousFunctions.length;index++){
    const prior=previousFunctions[index],current=after[index];
    if(prior.signature==='campaign_credit_claim_before_workspace(uuid)'){
     assert.deepEqual({...current,prosrc:prior.prosrc},prior);
     const stripped=current.prosrc.replace(/\n if o\.status='pending' and w\.available_credits>w\.threshold_credits[\s\S]*?then return null; end if;\n/,'');
     assert.equal(stripped,prior.prosrc);
    }else assert.deepEqual(current,prior);
   }
  });
  await t.test('Pause wins before claim: pending is retained, retries cause no wallet/ledger writes, and later valid demand reuses the same order',async()=>isolated(db,async()=>{
   const id=await prepare(db);await pause(db);await close(db);const before=await snapshot(db);
   assert.equal(await claim(db,id),null);assert.equal(await claim(db,id),null);assert.deepEqual(await snapshot(db),before);
   assert.equal(await order(db),id);assert.deepEqual(await snapshot(db),before,'existing pending order/key remain unchanged');
   await db.query('update campaign_wallets set available_credits=0 where salon_id=$1',[salon]);
   assert.equal(await order(db),id);assert.deepEqual(await claim(db,id),{customer:'fixture-customer',method:'fixture-method',amount:500});
   assert.equal((await db.query('select count(*)::integer count from campaign_credit_orders')).rows[0].count,1);
  }));
  await t.test('Pause before expiry settlement also removes paused-only demand without altering the reserve',async()=>isolated(db,async()=>{
   const id=await prepare(db);await pause(db);const before=await snapshot(db);assert.equal(await claim(db,id),null);assert.deepEqual(await snapshot(db),before);
  }));
  await t.test('claim wins first: processing retry survives Pause and paid settlement credits exactly once using the same order/reference',async()=>isolated(db,async()=>{
   const id=await prepare(db);const first=await claim(db,id);assert.ok(first);await pause(db);await close(db);
   const processing=await snapshot(db);assert.deepEqual(await claim(db,id),first);assert.deepEqual(await snapshot(db),processing);
   await rejected(db,()=>db.query('select campaign_credit_paid($1,$2,499)',[id,'fixture-paid-once']),/does not match/);assert.deepEqual(await snapshot(db),processing);
   await db.query('select campaign_credit_paid($1,$2,500)',[id,'fixture-paid-once']);const settled=await snapshot(db);
   assert.equal(settled.wallets[0].available_credits,processing.wallets[0].available_credits+500);
   assert.equal(settled.ledger.filter(l=>l.reference==='purchase:fixture-paid-once').length,1);
   assert.equal(settled.orders[0].status,'paid');assert.equal(settled.orders[0].id,id);assert.equal(settled.orders[0].amount_cents,500);
   await db.query('select campaign_credit_paid($1,$2,500)',[id,'fixture-paid-once']);assert.deepEqual(await snapshot(db),settled);assert.equal(await claim(db,id),null);assert.deepEqual(await snapshot(db),settled);
  }));
  for(const kind of ['fund','renew'])await t.test(`another campaign's eligible ${kind} demand in the same wallet still permits the pending claim`,async()=>isolated(db,async()=>{
   const id=await prepare(db);await pause(db);const other=await otherCampaign(db,{kind});
   assert.ok((await db.query('select owner_campaign_post(source_type,source_id,salon_id) source from owner_campaigns where id=$1',[other])).rows[0].source,'positive demand fixture has a currently valid published source');
   assert.ok(await claim(db,id));
  }));
  for(const invalid of ['paused','disabled_funding','unexpired_renewal','wrong_funding_owner','different_wallet'])await t.test(`ineligible other campaign (${invalid}) cannot justify the pending order`,async()=>isolated(db,async()=>{
   const id=await prepare(db);await pause(db);
   const other=await otherCampaign(db,{kind:invalid==='unexpired_renewal'?'renew':'fund',paused:invalid==='paused',auto:invalid!=='disabled_funding',expired:invalid!=='unexpired_renewal'});
   if(invalid==='wrong_funding_owner')await db.query('update owner_campaigns set owner_id=$1 where id=$2',[viewer,other]);
   if(invalid==='different_wallet'){
    const otherSalon='10000000-0000-0000-0000-000000000002';await db.query("insert into locations values($1,'active',$2,'Other fixture salon')",[otherSalon,salon]);await db.query('update owner_campaigns set salon_id=$1 where id=$2',[otherSalon,other]);
   }
   const before=await snapshot(db);assert.equal(await claim(db,id),null);assert.deepEqual(await snapshot(db),before);
  }));
  await t.test('existing globally consented low-balance threshold remains inclusive even when every campaign is paused',async()=>isolated(db,async()=>{
   const id=await prepare(db);await pause(db);await db.query('update campaign_wallets set threshold_credits=available_credits where salon_id=$1',[salon]);assert.ok(await claim(db,id));
  }));
  await t.test('renewal demand keeps the existing daily-price estimate; this change does not rewrite the chosen per-period ceiling',async()=>isolated(db,async()=>{
   const id=await prepare(db);await db.exec('update owner_campaigns set cycle_credit_limit=100');const before=await snapshot(db);assert.ok(await claim(db,id));
   const after=await snapshot(db);assert.deepEqual(after.wallets,before.wallets);assert.deepEqual(after.ledger,before.ledger);assert.deepEqual(after.campaigns,before.campaigns);
  }));
  await t.test('manual pending orders are never claimed; retaining the automatic pending slot requires an explicit existing Stop before a new manual order',async()=>isolated(db,async()=>{
   const id=await prepare(db);await pause(db);await close(db);assert.equal(await claim(db,id),null);
   assert.equal(await order(db,false),id,'retained automatic order occupies the existing unique pending slot');
   await db.query("select campaign_payment_controls($1,$2,'stop')",[salon,owner]);
   assert.equal((await db.query('select status from campaign_credit_orders where id=$1',[id])).rows[0].status,'cancelled');
   const manual=await order(db,false);assert.notEqual(manual,id);const before=await snapshot(db);assert.equal(await claim(db,manual),null);assert.deepEqual(await snapshot(db),before);
  }));
  const guards=[
   ['payment block',"update campaign_wallets set payment_blocked=true"],
   ['automatic consent disabled',"update campaign_wallets set auto_topup_enabled=false"],
   ['payment owner changed',`update campaign_wallets set payment_owner='${viewer}'`],
   ['saved method missing',"update campaign_wallets set stripe_payment_method=null"],
   ['chosen pack changed',"update campaign_wallets set topup_credits=1500"],
   ['plugin disabled',"update campaign_wallets set installed=false"],
   ['Campaign globally disabled',"update owner_campaign_settings set config=jsonb_set(config,'{enabled}','false')"],
   ['monthly purchase cap',`insert into campaign_credit_orders(salon_id,owner_id,credits,amount_cents,automatic,status) select '${salon}','${owner}',500,500,true,'paid' from generate_series(1,6)`],
  ];
  for(const [name,mutation] of guards)await t.test(`existing guard remains effective: ${name}`,async()=>isolated(db,async()=>{
   const id=await prepare(db);await db.exec(mutation);const before=await snapshot(db);assert.equal(await claim(db,id),null);assert.deepEqual(await snapshot(db),before);
  }));
  await t.test('claim failure rolls back processing transition and retries preserve the original order/amount',async()=>isolated(db,async()=>{
   const id=await prepare(db);await db.exec(`create function fixture_claim_failure() returns trigger language plpgsql as $$begin if new.status='processing' then raise exception 'fixture claim failure';end if;return new;end$$;
    create trigger fixture_claim_failure after update on campaign_credit_orders for each row execute function fixture_claim_failure()`);
   const before=await snapshot(db);await rejected(db,()=>claim(db,id),/fixture claim failure/);assert.deepEqual(await snapshot(db),before);
   await db.exec('drop trigger fixture_claim_failure on campaign_credit_orders');assert.equal((await claim(db,id)).amount,500);assert.equal((await db.query('select id from campaign_credit_orders')).rows[0].id,id);
  }));
  await t.test('service-only outer claim and inaccessible unsafe inner function retain their exact privileges',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    const p=(await db.query("select has_function_privilege($1,'campaign_credit_claim(uuid)','execute') outer_allowed,has_function_privilege($1,'campaign_credit_claim_before_workspace(uuid)','execute') inner_allowed",[role])).rows[0];
    assert.equal(p.outer_allowed,role==='service_role');assert.equal(p.inner_allowed,false);
   }
  });
 }finally{await db.close();}
});
