import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCampaignCumulativeDb,ids,readCampaignMigration} from './fixtures/campaign-cumulative-db.mjs';

const {salon,owner,viewer,campaign}=ids;
const chain=['20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql',
 '20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql',
 '20261021080000_campaign_admin_pause_status.sql','20261021090000_campaign_pending_claim_demand.sql'];
const baseline=process.env.CAMPAIGN_DEMAND_BASELINE==='1';
const lifecycle='20261021100000_campaign_paused_reserve_lifecycle.sql';
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
const order=async(db,automatic=true,amount=500)=>(await one(db,'select campaign_credit_order($1,$2,$3,$4) id',[salon,owner,amount,automatic])).id;
const claim=async(db,id)=>(await one(db,'select campaign_credit_claim($1) result',[id])).result;
const wallet=db=>one(db,'select * from campaign_wallets where salon_id=$1',[salon]);
const getOrder=(db,id)=>one(db,'select * from campaign_credit_orders where id=$1',[id]);
async function isolated(db,run){await db.exec('begin');try{await run();}finally{await db.exec('rollback');}}
async function rejected(db,run,pattern){await db.exec('savepoint expected_failure');try{await assert.rejects(run,pattern);}finally{await db.exec('rollback to expected_failure;release expected_failure');}}
async function payer(db){await db.query(`update campaign_wallets set auto_topup_enabled=true,auto_topup_consent_at=now(),payment_owner=$1,
 stripe_customer='cus_fixture',stripe_payment_method='pm_fixture',topup_credits=500,threshold_credits=100,monthly_limit_cents=3000 where salon_id=$2`,[owner,salon]);}
async function need(db,limit=900){
 const id=randomUUID(),post=randomUUID();
 await db.query("insert into salon_profile_looks values($1,$2,'Published need','Gel manicure','published',$3,false,null)",[post,salon,owner]);
 await db.query("select campaign_create_versioned(1,$1,$2,$3,'salon_profile_look',$4,'city','Milwaukee','United States','Wisconsin','Milwaukee',500,9,$5,false,true)",[id,salon,owner,post,limit]);
 return id;
}
const cancel=(db,id)=>db.query("select owner_campaign_change($1,$2,$3,'cancel')",[id,salon,owner]);
const pause=db=>db.query("select owner_campaign_change($1,$2,$3,'pause')",[campaign,salon,owner]);
const ledger=db=>db.query('select * from campaign_credit_ledger order by id').then(x=>x.rows);

test('active demand, safe manual recovery and processing-month budget preserve credit intent',async t=>{
 const db=await createCampaignCumulativeDb({migrations:chain});
 try{
  await payer(db);
  if(!baseline){await db.exec(readCampaignMigration(lifecycle));await db.exec(readCampaignMigration('20261021110000_campaign_credit_demand_and_budget.sql'));}
  await t.test('low available balance does not buy when the only running campaign is fully reserved',()=>isolated(db,async()=>{
   const before=await wallet(db);assert.equal(before.available_credits,0);assert.equal(before.reserved_credits,300);
   assert.equal(await order(db),null);assert.deepEqual(await wallet(db),before);
  }));
  await t.test('Pause keeps automatic consent but creates no threshold-only demand',()=>isolated(db,async()=>{
   await pause(db);const before=await wallet(db);assert.equal(await order(db),null);assert.deepEqual(await wallet(db),before);
   assert.equal(before.auto_topup_enabled,true);assert.ok(before.auto_topup_consent_at);
  }));
  await t.test('another active awaiting campaign can buy without borrowing the paused reserve',()=>isolated(db,async()=>{
   await pause(db);await need(db);const before=await wallet(db),id=await order(db);assert.ok(id);
   const result=await claim(db,id);assert.equal(result.amount,500);assert.deepEqual(await wallet(db),before);
   assert.equal(before.reserved_credits,300);assert.equal((await getOrder(db,id)).status,'processing');
  }));
  await t.test('pending claim revalidates demand and never changes consent or ledger on no-demand retry',()=>isolated(db,async()=>{
   const active=await need(db),id=await order(db);await cancel(db,active);await pause(db);
   const before=await wallet(db),beforeLedger=await ledger(db);assert.equal(await claim(db,id),null);assert.equal(await claim(db,id),null);
   assert.equal((await getOrder(db,id)).status,'pending');assert.deepEqual(await wallet(db),before);assert.deepEqual(await ledger(db),beforeLedger);
  }));
  await t.test('explicit manual purchase supersedes only the no-demand never-claimed automatic intent',()=>isolated(db,async()=>{
   const active=await need(db),old=await order(db);await cancel(db,active);const before=await wallet(db),beforeLedger=await ledger(db);
   const manual=await order(db,false,1500);assert.notEqual(manual,old);
   const previous=await getOrder(db,old),current=await getOrder(db,manual);
   assert.equal(previous.status,'cancelled');assert.match(previous.error,/manual/i);assert.equal(current.automatic,false);assert.equal(current.amount_cents,1500);
   assert.equal((await one(db,"select count(*)::int n from app_notifications where event_key like 'campaign:failed:'||$1||':%'",[old])).n,0,'intent supersede must not send a card-failure notice');
   assert.equal(await order(db,false,1500),manual);assert.equal(await claim(db,manual),null);
   assert.deepEqual(await wallet(db),before);assert.deepEqual(await ledger(db),beforeLedger);
   assert.equal((await one(db,"select count(*)::int n from campaign_credit_orders where status in ('pending','processing')")).n,1);
  }));
  await t.test('active demand preserves the automatic order instead of silent manual replacement',()=>isolated(db,async()=>{
   await need(db);const automatic=await order(db);assert.equal(await order(db,false,1500),automatic);assert.equal((await getOrder(db,automatic)).status,'pending');
  }));
  await t.test('processing and existing manual checkouts are not replaced',()=>isolated(db,async()=>{
   const active=await need(db),automatic=await order(db);await claim(db,automatic);await cancel(db,active);
   assert.equal(await order(db,false,1500),automatic);assert.equal((await getOrder(db,automatic)).status,'processing');
  }));
  await t.test('manual pending keeps its own checkout key and never becomes an automatic charge',()=>isolated(db,async()=>{
   const manual=await order(db,false,500);await need(db);assert.equal(await order(db),manual);assert.equal(await claim(db,manual),null);
   assert.equal(await order(db,false,1500),manual);assert.equal((await getOrder(db,manual)).status,'pending');
  }));
  await t.test('unknown pending provider evidence fails closed rather than canceling a possible payment',()=>isolated(db,async()=>{
   const active=await need(db),id=await order(db);await cancel(db,active);
   await db.query("update campaign_credit_orders set provider_reference='pi_unknown' where id=$1",[id]);
   assert.equal(await order(db,false,1500),id);assert.equal((await getOrder(db,id)).status,'pending');
  }));
  await t.test('explicit owner pack change replaces only its unclaimed automatic intent and same-pack retry keeps its replacement',()=>isolated(db,async()=>{
   const active=await need(db),old=await order(db),beforeLedger=await ledger(db);
   await db.query('select campaign_credit_preferences($1,$2,true,1500,100,3000)',[salon,owner]);
   const obsolete=await getOrder(db,old);assert.equal(obsolete.status,'cancelled');assert.match(obsolete.error,/pack change/i);
   assert.equal((await one(db,"select count(*)::int n from app_notifications where event_key like 'campaign:failed:'||$1||':%'",[old])).n,0,'pack change is not a failed payment');
   const current=await order(db,true,1500);assert.notEqual(current,old);
   await db.query('select campaign_credit_preferences($1,$2,true,1500,100,3000)',[salon,owner]);
   assert.equal(await order(db,true,1500),current);assert.equal((await getOrder(db,current)).status,'pending');
   assert.equal((await one(db,'select auto_fund from owner_campaigns where id=$1',[active])).auto_fund,true);
   assert.equal((await wallet(db)).auto_topup_enabled,true);assert.ok((await wallet(db)).auto_topup_consent_at);
   assert.deepEqual(await ledger(db),beforeLedger);assert.equal((await claim(db,current)).amount,1500);
  }));
  await t.test('pack changes preserve a processing request and its immutable original amount',()=>isolated(db,async()=>{
   await need(db);const id=await order(db),payload=await claim(db,id);
   await db.query('select campaign_credit_preferences($1,$2,true,1500,100,3000)',[salon,owner]);
   assert.equal((await getOrder(db,id)).status,'processing');assert.deepEqual(await claim(db,id),payload);assert.equal(payload.amount,500);
  }));
  await t.test('pack changes preserve manual checkout and pending requests with any payment evidence',()=>isolated(db,async()=>{
   const manual=await order(db,false,500);await db.query("update campaign_credit_orders set checkout_session_id='cs_manual' where id=$1",[manual]);
   await db.query('select campaign_credit_preferences($1,$2,true,1500,100,3000)',[salon,owner]);
   assert.equal((await getOrder(db,manual)).status,'pending');assert.equal((await getOrder(db,manual)).checkout_session_id,'cs_manual');
  }));
  for(const [field,value]of [['provider_reference',"'pi_unknown'"],['checkout_session_id',"'cs_unknown'"],['claim_payload',"'{}'::jsonb"],['automatic_budget_month',"date_trunc('month',now())::date"]])await t.test('pack change retains unknown pending '+field,()=>isolated(db,async()=>{
   await need(db);const id=await order(db);await db.query(`update campaign_credit_orders set ${field}=${value} where id=$1`,[id]);
   const before=await getOrder(db,id);await db.query('select campaign_credit_preferences($1,$2,true,1500,100,3000)',[salon,owner]);assert.deepEqual(await getOrder(db,id),before);
  }));
  await t.test('invalid or unauthorized preference change cannot cancel a pending intent',()=>isolated(db,async()=>{
   await need(db);const id=await order(db),before=await getOrder(db,id);
   await rejected(db,()=>db.query('select campaign_credit_preferences($1,$2,true,1500,100,3000)',[salon,viewer]),/Owner access/);
   await rejected(db,()=>db.query('select campaign_credit_preferences($1,$2,true,750,100,3000)',[salon,owner]),/top-up amount/);
   assert.deepEqual(await getOrder(db,id),before);assert.equal((await wallet(db)).topup_credits,500);
  }));
  await t.test('old-month pending cannot exceed a monthly cap already consumed by a current-month paid order',()=>isolated(db,async()=>{
   await need(db);await db.query('update campaign_wallets set monthly_limit_cents=500 where salon_id=$1',[salon]);
   const id=await order(db);await db.query("update campaign_credit_orders set created_at=(date_trunc('month',now() at time zone 'America/Chicago') at time zone 'America/Chicago')-interval '1 day' where id=$1",[id]);
   const paid=randomUUID();await db.query("insert into campaign_credit_orders(id,salon_id,owner_id,credits,amount_cents,automatic,status) values($1,$2,$3,500,500,true,'failed')",[paid,salon,owner]);
   await db.query("select campaign_credit_paid($1,'pi_monthly_paid',500)",[paid]);
   const before=await wallet(db);assert.equal(await claim(db,id),null);assert.equal((await getOrder(db,id)).status,'pending');assert.deepEqual(await wallet(db),before);
  }));
  await t.test('first processing claim stamps the current Chicago month, independent of intent creation',()=>isolated(db,async()=>{
   await need(db);const id=await order(db);
   await db.query("update campaign_credit_orders set created_at=now()-interval '2 months' where id=$1",[id]);
   const result=await claim(db,id),row=await getOrder(db,id),month=(await one(db,"select date_trunc('month',now() at time zone 'America/Chicago')::date::text as budget_period")).budget_period;
   assert.equal((await one(db,'select automatic_budget_month::text as budget_period from campaign_credit_orders where id=$1',[id])).budget_period,month);
   assert.deepEqual(row.claim_payload,result);assert.ok(result.claimed_at);
  }));
  await t.test('paid old-created order stays in its processing month and blocks the next automatic purchase at cap',()=>isolated(db,async()=>{
   await need(db);await db.query('update campaign_wallets set monthly_limit_cents=500 where salon_id=$1',[salon]);const id=await order(db);
   await db.query("update campaign_credit_orders set created_at=now()-interval '2 months' where id=$1",[id]);await claim(db,id);
   const claimed=await getOrder(db,id);await db.query("select campaign_credit_paid($1,'pi_oldcreated',500)",[id]);
   assert.equal((await getOrder(db,id)).automatic_budget_month.getTime(),claimed.automatic_budget_month.getTime());
   assert.equal(await order(db),null,'successful old intent remains attributed to this processing period');
   assert.ok(await order(db,false,500),'monthly automatic cap does not block an explicit manual purchase');
   assert.equal((await wallet(db)).auto_topup_enabled,true);
  }));
  await t.test('prior-month processing settlement keeps its reservation period instead of consuming this month twice',()=>isolated(db,async()=>{
   await need(db);await db.query('update campaign_wallets set monthly_limit_cents=500 where salon_id=$1',[salon]);const id=await order(db);await claim(db,id);
   await db.query("update campaign_credit_orders set automatic_budget_month=(date_trunc('month',now() at time zone 'America/Chicago')-interval '1 month')::date,provider_reference='pi_priorperiod' where id=$1",[id]);
   const claimed=await getOrder(db,id);await db.query("select campaign_credit_paid($1,'pi_priorperiod',500)",[id]);
   assert.equal((await getOrder(db,id)).automatic_budget_month.getTime(),claimed.automatic_budget_month.getTime());
   assert.ok(await order(db),'current month may fund a remaining eligible shortfall up to its unchanged cap');
  }));
  await t.test('unused reserve returned by renewal covers its own cost without a redundant top-up',()=>isolated(db,async()=>{
   await db.query("update owner_campaigns set keep_running=true,ends_at=now()-interval '1 second' where id=$1",[campaign]);
   assert.equal(await order(db),null);
   assert.equal((await one(db,'select campaign_credit_renew($1) ok',[campaign])).ok,true);
   assert.equal((await wallet(db)).available_credits,0);assert.equal((await wallet(db)).reserved_credits,300);
  }));
  await t.test('processing retry survives Pause and cap reduction using the same saved payment payload',()=>isolated(db,async()=>{
   const active=await need(db),id=await order(db),first=await claim(db,id);await cancel(db,active);await pause(db);
   await db.query("update campaign_wallets set stripe_customer='cus_new',stripe_payment_method='pm_new',topup_credits=1500,monthly_limit_cents=500 where salon_id=$1",[salon]);
   const before=await wallet(db);assert.deepEqual(await claim(db,id),first);assert.deepEqual(await wallet(db),before);
   assert.equal(first.customer,'cus_fixture');assert.equal(first.method,'pm_fixture');assert.equal(first.amount,500);
  }));
  await t.test('late success grants purchased credits once and never resumes a paused campaign',()=>isolated(db,async()=>{
   const active=await need(db),id=await order(db);await claim(db,id);await cancel(db,active);await pause(db);
   const before=await wallet(db),paused=await one(db,'select to_jsonb(c) state from owner_campaigns c where id=$1',[campaign]);
   await db.query("select campaign_credit_paid($1,'pi_once',500)",[id]);await db.query("select campaign_credit_paid($1,'pi_once',500)",[id]);
   assert.equal((await wallet(db)).available_credits,before.available_credits+500);
   assert.equal((await one(db,"select count(*)::int n from campaign_credit_ledger where reference='purchase:pi_once'")).n,1);
   assert.deepEqual(await one(db,'select to_jsonb(c) state from owner_campaigns c where id=$1',[campaign]),paused);
  }));
  await t.test('verified payment clears obsolete error text even when success arrives after recorded cancellation',()=>isolated(db,async()=>{
   await need(db);const id=await order(db);await claim(db,id);
   await db.query("update campaign_credit_orders set provider_reference='pi_latesettlement' where id=$1",[id]);
   await db.query("select campaign_credit_cancelled($1,'pi_latesettlement')",[id]);assert.match((await getOrder(db,id)).error,/No credits/);
   assert.equal((await one(db,"select count(*)::int n from app_notifications where event_key like 'campaign:failed:'||$1||':%'",[id])).n,1,'verified failed payment retains its owner notice');
   await db.query("select campaign_credit_paid($1,'pi_latesettlement',500)",[id]);
   assert.equal((await getOrder(db,id)).status,'paid');assert.equal((await getOrder(db,id)).error,null);
   await db.query("select campaign_credit_paid($1,'pi_latesettlement',500)",[id]);assert.equal((await one(db,"select count(*)::int n from campaign_credit_ledger where reference='purchase:pi_latesettlement'")).n,1);
  }));
  for(const age of ['23 hours 56 minutes','25 hours'])await t.test('unknown processing at '+age+' requires reconciliation with a retention safety margin',()=>isolated(db,async()=>{
   await need(db);const id=await order(db);await claim(db,id);
   await db.query("update campaign_credit_orders set claim_payload=jsonb_set(claim_payload,'{claimed_at}',to_jsonb((now()-$2::interval)::text)) where id=$1",[id,age]);
   const before=await getOrder(db,id);await rejected(db,()=>claim(db,id),/reconcil/i);assert.deepEqual(await getOrder(db,id),before);
  }));
  await t.test('known processing provider reference permits read-only reconciliation beyond the retry window',()=>isolated(db,async()=>{
   await need(db);const id=await order(db);await claim(db,id);
   await db.query("update campaign_credit_orders set provider_reference='pi_known',claim_payload=jsonb_set(claim_payload,'{claimed_at}',to_jsonb((now()-interval '25 hours')::text)) where id=$1",[id]);
   assert.equal((await claim(db,id)).provider_reference,'pi_known');assert.equal((await getOrder(db,id)).status,'processing');
  }));
  await t.test('legacy processing without a captured payload stays reserved for reconciliation',()=>isolated(db,async()=>{
   await need(db);const id=await order(db);await db.query("update campaign_credit_orders set status='processing' where id=$1",[id]);
   await rejected(db,()=>claim(db,id),/reconcil/i);assert.equal((await getOrder(db,id)).status,'processing');
   await db.query("select campaign_credit_paid($1,'pi_legacy',500)",[id]);assert.equal((await getOrder(db,id)).status,'paid');
  }));
  for(const [name,sql]of [
   ['disabled consent','update campaign_wallets set auto_topup_enabled=false'],
   ['explicit payment block','update campaign_wallets set payment_blocked=true'],
   ['uninstalled plugin','update campaign_wallets set installed=false'],
   ['globally disabled campaigns',"update owner_campaign_settings set config=jsonb_set(config,'{enabled}','false')"],
   ['missing saved method','update campaign_wallets set stripe_payment_method=null'],
  ])await t.test(name+' cannot initiate a pending charge',()=>isolated(db,async()=>{
   await need(db);const id=await order(db);await db.exec(sql);assert.equal(await claim(db,id),null);assert.equal((await getOrder(db,id)).status,'pending');
  }));
  await t.test('invalid source or wrong funding owner cannot justify active demand',()=>isolated(db,async()=>{
   const active=await need(db);await db.query('update owner_campaigns set owner_id=$1 where id=$2',[viewer,active]);assert.equal(await order(db),null);
   await db.query('update owner_campaigns set owner_id=$1 where id=$2',[owner,active]);await db.exec("update salon_profile_looks set status='draft'");assert.equal(await order(db),null);
  }));
  await t.test('manual recovery validates owner and pack before touching the old intent',()=>isolated(db,async()=>{
   const active=await need(db),id=await order(db);await cancel(db,active);
   await rejected(db,()=>db.query('select campaign_credit_order($1,$2,1500,false)',[salon,viewer]),/Owner access/);
   await rejected(db,()=>order(db,false,750),/credit pack/);assert.equal((await getOrder(db,id)).status,'pending');
  }));
  await t.test('shared demand helper and financial mutations remain private to service entrypoints',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    const row=await one(db,"select has_function_privilege($1,'campaign_credit_order(uuid,uuid,integer,boolean)','execute') orders,has_function_privilege($1,'campaign_credit_claim(uuid)','execute') claims,has_function_privilege($1,'campaign_credit_cancelled(uuid,text)','execute') cancelled,has_function_privilege($1,'campaign_credit_has_active_demand(uuid,uuid)','execute') helper",[role]);
    assert.equal(row.orders,role==='service_role');assert.equal(row.claims,role==='service_role');assert.equal(row.cancelled,role==='service_role');assert.equal(row.helper,false);
   }
  });
 }finally{await db.close();}
});

test('legacy budget attribution uses recorded payment evidence and leaves unknown processing for reconciliation',async()=>{
 if(baseline)return;
 const db=await createCampaignCumulativeDb({migrations:[...chain,lifecycle]});
 try{
  await payer(db);const historical=randomUUID();
  await db.query("insert into campaign_credit_orders(id,salon_id,owner_id,credits,amount_cents,automatic,status,created_at) values($1,$2,$3,500,500,true,'failed',now()-interval '2 months')",[historical,salon,owner]);
  await db.query("select campaign_credit_paid($1,'pi_legacypaid',500)",[historical]);
  const processing=randomUUID();await db.query("insert into campaign_credit_orders(id,salon_id,owner_id,credits,amount_cents,automatic,status,created_at) values($1,$2,$3,500,500,true,'processing',now()-interval '2 months')",[processing,salon,owner]);
  const beforeWallet=await wallet(db),beforeLedger=await ledger(db);
  await db.exec(readCampaignMigration('20261021110000_campaign_credit_demand_and_budget.sql'));
  const attributed=(await db.query("select id,automatic_budget_month::text period,claim_payload from campaign_credit_orders order by id")).rows;
  const current=(await one(db,"select date_trunc('month',now() at time zone 'America/Chicago')::date::text period")).period;
  assert.ok(attributed.every(row=>row.period===current));assert.ok(attributed.every(row=>row.claim_payload===null));
  assert.deepEqual(await wallet(db),beforeWallet);assert.deepEqual(await ledger(db),beforeLedger);
  await assert.rejects(()=>claim(db,processing),/reconcil/i);
 }finally{await db.close();}
});
