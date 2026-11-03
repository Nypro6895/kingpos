import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignCumulativeDb,ids,readCampaignMigration} from './fixtures/campaign-cumulative-db.mjs';

const migration=readCampaignMigration('20261021050000_campaign_accounting_read.sql');
const {owner,viewer,salon,campaign,nonce}=ids;
const otherCampaign='30000000-0000-0000-0000-000000000002';
const otherPost='20000000-0000-0000-0000-000000000002';
const otherSalon='10000000-0000-0000-0000-000000000002';
const refundId='50000000-0000-0000-0000-000000000001';
const oldReference="'limit:'||gen_random_uuid()";
const newReference="'limit:'||p_campaign||':'||gen_random_uuid()";
const limitSignature='campaign_set_credit_limit(uuid,uuid,uuid,integer,boolean)';
const reportSignature='campaign_owner_accounting(uuid,uuid,uuid)';
const area={country:'US',state:'WI',city:'Milwaukee',zipcode:'53202',neighborhood:'East Town'};

async function isolated(db,fn){await db.exec('begin');try{await fn()}finally{await db.exec('rollback')}}
async function report(db,id=campaign,salonId=salon,ownerId=owner){
 return (await db.query('select campaign_owner_accounting($1,$2,$3) result',[id,salonId,ownerId])).rows[0].result;
}
async function setLimit(db,limit,keep=false,id=campaign){
 await db.query('select campaign_set_credit_limit($1,$2,$3,$4,$5)',[salon,owner,id,limit,keep]);
}
async function state(db){
 return (await db.query(`select jsonb_build_object(
  'campaigns',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from owner_campaigns t),
  'wallets',(select coalesce(jsonb_agg(to_jsonb(t) order by salon_id),'[]') from campaign_wallets t),
  'ledger',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from campaign_credit_ledger t),
  'events',(select coalesce(jsonb_agg(to_jsonb(t) order by campaign_id,visitor_hash,day,kind,ordinal),'[]') from owner_campaign_events t),
  'orders',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from campaign_credit_orders t),
  'notices',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from app_notifications t),
  'settings',(select jsonb_agg(to_jsonb(t) order by id) from owner_campaign_settings t)
 ) result`)).rows[0].result;
}
async function functions(db){
 return (await db.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,
  p.proacl::text acl,p.prosecdef security_definer,p.provolatile volatility,p.proconfig configuration,
  p.proowner::regrole::text owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like '%campaign%' order by 1`)).rows;
}
async function addLedger(db,{reference,credits=10,kind='release',salonId=salon,time='now()'}){
 await db.query(`insert into campaign_credit_ledger(salon_id,reference,kind,credits,created_at)
  values($1,$2,$3,$4,${time})`,[salonId,reference,kind,credits]);
}
const complete=(closure=0,limit=0)=>({total:closure+limit,known:closure+limit,closure,limit,complete:true,reason:null});
const incomplete=(reason,closure=0,limit=0)=>({...complete(closure,limit),total:null,complete:false,reason});

test('owner accounting reads the cumulative ledger without changing delivery or credit policy',async t=>{
 const db=await createCampaignCumulativeDb();
 try{
  const originalFunctions=await functions(db);
  const originalLimit=originalFunctions.find(row=>row.signature===limitSignature);
  await t.test('before-fix regression: reducing a funded limit refunds credits that the old counter omits',async()=>{
   await isolated(db,async()=>{
    await setLimit(db,200);
    const snapshot=await state(db);
    assert.equal(snapshot.campaigns[0].released_credits,0,'old UI would show zero returned');
    assert.equal(snapshot.wallets[0].available_credits,100,'100 credits actually returned');
    const refund=snapshot.ledger.find(row=>row.kind==='release');
    assert.equal(refund.credits,100);
    assert.match(refund.reference,/^limit:[0-9a-f-]{36}$/,'old ledger cannot identify the campaign');
    assert.notEqual(snapshot.campaigns[0].released_credits,refund.credits);
   });
  });
  const originalState=await state(db);
  await db.exec(migration);
  await t.test('migration changes only reference attribution; retains every existing function, ACL and monetary value',async()=>{
   const revised=await functions(db);
   const existing=revised.filter(row=>row.signature!==reportSignature);
   assert.deepEqual(existing,originalFunctions.map(row=>row.signature===limitSignature
    ?{...row,definition:row.definition.replace(oldReference,newReference)}:row));
   assert.deepEqual(await state(db),originalState,'no backfill, wallet or policy write');
   const rpc=revised.find(row=>row.signature===reportSignature);
   assert.equal(rpc.volatility,'s');assert.equal(rpc.security_definer,true);
   assert.deepEqual(rpc.configuration,['search_path=public']);
   await db.exec(migration);
   assert.deepEqual(await functions(db),revised,'retry keeps definitions and ACLs');
   assert.deepEqual(await state(db),originalState,'retry creates no credit/history writes');
  });
  await t.test('zero ledger returns exact preview fields and database check time without payment metadata',async()=>{
   const result=await report(db);
   assert.deepEqual(result.returns,complete());
   assert.deepEqual(Object.keys(result.campaign).sort(),['id','salon_id','source_type','source_id','title','status','area','location','country','state','city','starts_at','ends_at','views','spent_cents','total_price_cents','reserved_credits','released_credits','created_at','owner_paused_at','pause_episode_id','pause_origin'].sort());
   assert.equal(result.campaign.id,campaign);assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
   assert.equal(result.campaign.reserved_credits,300);assert.equal(result.campaign.spent_cents,0);
   assert.equal(result.campaign.owner_paused_at,null);assert.equal(result.campaign.pause_episode_id,null);assert.equal(result.campaign.pause_origin,null);
  });
  await t.test('additive pause fields become visible without exposing unrelated campaign fields',async()=>{
   await isolated(db,async()=>{
    await db.exec('alter table owner_campaigns add column owner_paused_at timestamptz,add column pause_episode_id uuid,add column pause_origin text');
    await db.query("update owner_campaigns set owner_paused_at='2026-10-21T00:00:00Z',pause_episode_id=$1,pause_origin='owner'",[refundId]);
    const result=await report(db);
    assert.equal(Date.parse(result.campaign.owner_paused_at),Date.parse('2026-10-21T00:00:00Z'));
    assert.equal(result.campaign.pause_episode_id,refundId);assert.equal(result.campaign.pause_origin,'owner');
    assert.equal(Object.hasOwn(result.campaign,'payment_reference'),false);
   });
  });
  await t.test('funded limit decrease, actual admitted spend, expiry release, renewal and retry reconcile to ledger',async()=>{
   await isolated(db,async()=>{
    await setLimit(db,200,true);
    assert.deepEqual((await report(db)).returns,complete(0,100));
    let snapshot=await state(db);
    const refund=snapshot.ledger.find(row=>row.kind==='release');
    assert.match(refund.reference,new RegExp(`^limit:${campaign}:[0-9a-f-]{36}$`));
    const admit=()=>db.query('select owner_campaign_admit($1,$2,$3,$4,$5,$6) accepted',[campaign,'a'.repeat(64),'view',area,viewer,nonce]);
    assert.equal((await admit()).rows[0].accepted,true);
    const firstView=await state(db);
    assert.equal((await admit()).rows[0].accepted,true);
    assert.deepEqual(await state(db),firstView,'nonce replay cannot create another charge');
    let result=await report(db);
    assert.equal(result.campaign.views,1);assert.equal(result.campaign.spent_cents,1);
    assert.deepEqual(result.returns,complete(0,100));
    await db.exec("update owner_campaigns set ends_at=now()-interval '1 second'");
    assert.equal((await db.query('select campaign_credit_renew($1) renewed',[campaign])).rows[0].renewed,true);
    result=await report(db);
    assert.deepEqual(result.returns,complete(199,100));
    assert.equal(result.campaign.status,'running');assert.equal(result.campaign.spent_cents,1);
    assert.equal(result.campaign.reserved_credits,400);assert.equal(result.campaign.released_credits,199);
    snapshot=await state(db);
    assert.equal((await db.query('select campaign_credit_renew($1) renewed',[campaign])).rows[0].renewed,false);
    assert.deepEqual(await state(db),snapshot,'renew retry neither charges nor refunds again');
    await setLimit(db,150,false);
    assert.deepEqual((await report(db)).returns,complete(199,150));
    await db.exec("update owner_campaigns set ends_at=now()-interval '1 second'");
    await db.query('select campaign_credit_close_expired($1)',[salon]);
    result=await report(db);
    assert.deepEqual(result.returns,complete(349,150),'gross returns across cycles come from ledger, not view arithmetic');
    assert.equal(result.campaign.status,'completed');
    snapshot=await state(db);
    assert.equal(snapshot.wallets[0].available_credits,299);assert.equal(snapshot.wallets[0].reserved_credits,0);
    await db.query('select campaign_credit_close_expired($1)',[salon]);
    assert.deepEqual(await state(db),snapshot,'closure retry does not release twice');
   });
  });
  await t.test('increasing or repeating a limit is not a refund and unchanged invalid limits still fail',async()=>{
   await isolated(db,async()=>{
    await setLimit(db,200);await setLimit(db,250);await setLimit(db,250);
    const result=await report(db);
    assert.deepEqual(result.returns,complete(0,100));
    assert.equal(result.campaign.reserved_credits,250);
    assert.equal((await state(db)).ledger.filter(row=>row.reference.startsWith('limit:')).length,2);
   });
   for(const limit of [null,-1,0,100000])await isolated(db,async()=>{
    await assert.rejects(setLimit(db,limit),/Choose a limit/);
   });
  });
  await t.test('large limit decreases and increases across real renewals do not reuse a closure reference',async()=>{
   await isolated(db,async()=>{
    let lastClosedReserve=0;
    for(const limit of [250,1,300,1,200,1]){
     await setLimit(db,limit,true);
     const before=await report(db);
     assert.ok(before.campaign.reserved_credits>lastClosedReserve,'positive cycle limit advances the closure watermark');
     lastClosedReserve=before.campaign.reserved_credits;
     await db.exec("update owner_campaigns set ends_at=now()-interval '1 second'");
     assert.equal((await db.query('select campaign_credit_renew($1) renewed',[campaign])).rows[0].renewed,true);
     const after=await report(db);
     assert.equal(after.returns.complete,true,'release ledger remains equal to closure counter');
     assert.equal(after.returns.closure,after.campaign.released_credits);
    }
    const snapshot=await state(db);
    const closureRows=snapshot.ledger.filter(row=>row.reference.startsWith(`release:${campaign}:`));
    assert.equal(closureRows.length,6);assert.equal(new Set(closureRows.map(row=>row.reference)).size,6);
    assert.equal(snapshot.wallets[0].available_credits+snapshot.wallets[0].reserved_credits,300);
   });
  });
  await t.test('real second campaign refunds and other salon ledger never count toward this campaign',async()=>{
   await isolated(db,async()=>{
    await setLimit(db,200);
    await db.query("insert into salon_profile_looks values($1,$2,'Blue nails','Gel manicure','published',$3,false,null)",[otherPost,salon,owner]);
    await db.query("select campaign_create_versioned(1,$1,$2,$3,'salon_profile_look',$4,'city','Milwaukee','United States','Wisconsin','Milwaukee',500,3,100,false,false)",[otherCampaign,salon,owner,otherPost]);
    await db.query('select campaign_credit_fund($1,$2,$3,false)',[otherCampaign,salon,owner]);
    await setLimit(db,50,false,otherCampaign);
    assert.deepEqual((await report(db,otherCampaign)).returns,complete(0,50));
    await db.query("insert into locations values($1,'active',$1,'Other fixture')",[otherSalon]);
    await db.query('insert into campaign_wallets(salon_id) values($1)',[otherSalon]);
    await addLedger(db,{salonId:otherSalon,reference:`limit:${campaign}:${refundId}`,credits:999});
    await addLedger(db,{salonId:otherSalon,reference:`limit:${refundId}`,credits:999});
    assert.deepEqual((await report(db)).returns,complete(0,100));
   });
  });
  await t.test('mixed legacy history is conservatively incomplete and never backfilled',async()=>{
   await isolated(db,async()=>{
    // Produce a genuine pre-migration limit refund, then migrate with that history.
    await db.exec(originalLimit.definition);
    await setLimit(db,250);
    await db.exec((await functions(db)).find(row=>row.signature===limitSignature).definition.replace(oldReference,newReference));
    await setLimit(db,200);
    const snapshot=await state(db);
    assert.deepEqual((await report(db)).returns,incomplete('legacy_unattributed_refunds',0,50));
    assert.deepEqual(await state(db),snapshot);
   });
   await isolated(db,async()=>{
    await addLedger(db,{reference:`limit:${refundId}`,time:`(select created_at from owner_campaigns where id='${campaign}')`});
    assert.deepEqual((await report(db)).returns,incomplete('legacy_unattributed_refunds'));
   });
   await isolated(db,async()=>{
    await addLedger(db,{reference:`limit:${refundId}`,time:`(select created_at-interval '1 second' from owner_campaigns where id='${campaign}')`});
    assert.deepEqual((await report(db)).returns,complete(),'legacy refund predating campaign cannot belong to it');
   });
  });
  await t.test('missing or invalid closure ledger is surfaced, not presented as an exact total',async()=>{
   await isolated(db,async()=>{
    await db.exec("update owner_campaigns set ends_at=now()-interval '1 second'");
    await db.query('select campaign_credit_close_expired($1)',[salon]);
    await db.exec("delete from campaign_credit_ledger where kind='release'");
    assert.deepEqual((await report(db)).returns,incomplete('ledger_mismatch'));
   });
   await isolated(db,async()=>{
    await addLedger(db,{reference:`release:${campaign}:300`,credits:20});
    await addLedger(db,{reference:`limit:${refundId}`,credits:10});
    assert.deepEqual((await report(db)).returns,incomplete('ledger_mismatch',20,0),'mismatch wins over ambiguity');
   });
   for(const counter of [-1,null])await isolated(db,async()=>{
    if(counter===null)await db.exec('alter table owner_campaigns alter column released_credits drop not null');
    await db.query('update owner_campaigns set released_credits=$1',[counter]);
    assert.deepEqual((await report(db)).returns,incomplete('ledger_mismatch'));
   });
   for(const prefix of ['release','limit'])for(const credits of [-7,0,null])await isolated(db,async()=>{
    if(credits===null)await db.exec('alter table campaign_credit_ledger alter column credits drop not null');
    await addLedger(db,{reference:`${prefix}:${campaign}:${refundId}`,credits});
    assert.deepEqual((await report(db)).returns,incomplete('ledger_mismatch'),'nonpositive rows are never invented returns');
   });
  });
  await t.test('reserve rows, nonpositive legacy rows and lookalike campaign references cannot inflate returns',async()=>{
   await isolated(db,async()=>{
    await addLedger(db,{reference:`limit:${campaign}:${refundId}`,kind:'reserve',credits:1000});
    await addLedger(db,{reference:`limit:${refundId}`,credits:-1000});
    await addLedger(db,{reference:`release:${campaign}0:300`,credits:1000});
    assert.deepEqual((await report(db)).returns,complete());
   });
  });
  await t.test('owner/salon/null guards return the same error; only the service role may call the RPC',async()=>{
   const invalids=[[campaign,salon,viewer],[campaign,otherSalon,owner],[otherCampaign,salon,owner],[null,salon,owner],[campaign,null,owner],[campaign,salon,null]];
   for(const args of invalids)await isolated(db,async()=>{
    await assert.rejects(report(db,...args),error=>error.message==='Campaign preview is unavailable.');
   });
   for(const role of ['anon','authenticated'])await isolated(db,async()=>{
    await db.exec(`set local role ${role}`);
    await assert.rejects(report(db),/permission denied for function campaign_owner_accounting/);
   });
   await isolated(db,async()=>{
    await db.exec('set local role service_role');assert.deepEqual((await report(db)).returns,complete());
   });
  });
  await t.test('repeated inspection of expired or invalid-source campaigns is read-only, even with the plugin disabled',async()=>{
   await isolated(db,async()=>{
    await db.exec("update owner_campaigns set ends_at=now()-interval '1 second';update salon_profile_looks set status='hidden';update campaign_wallets set installed=false");
    const snapshot=await state(db);
    for(let attempt=0;attempt<5;attempt++){
     const result=await report(db);assert.equal(result.campaign.status,'running');
     assert.deepEqual(result.returns,complete());
    }
    assert.deepEqual(await state(db),snapshot,'no close/renew/ticket/view/credit write');
   });
   await db.exec('begin read only');
   try{assert.deepEqual((await report(db)).returns,complete())}finally{await db.exec('rollback')}
  });
  await t.test('unknown reference implementation aborts without altering newer functions or ledger',async()=>{
   const revised=await functions(db);
   await db.exec(originalLimit.definition.replace(oldReference,"'limit-v2:'||gen_random_uuid()"));
   const changed=await functions(db),snapshot=await state(db);
   await assert.rejects(db.exec(migration),/Campaign accounting: unsupported limit ledger reference/);
   await db.exec('rollback');
   assert.deepEqual(await functions(db),changed);assert.deepEqual(await state(db),snapshot);
   await db.exec(revised.find(row=>row.signature===limitSignature).definition);
  });
 }finally{await db.close()}
});
