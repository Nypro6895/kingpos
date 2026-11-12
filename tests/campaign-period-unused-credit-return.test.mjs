import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createCampaignCumulativeDb,ids} from './fixtures/campaign-cumulative-db.mjs';

const migrations=['20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql','20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql','20261021080000_campaign_admin_pause_status.sql','20261021090000_campaign_pending_claim_demand.sql','20261021100000_campaign_paused_reserve_lifecycle.sql','20261021110000_campaign_credit_demand_and_budget.sql','20261106140000_campaign_period_unused_credit_return.sql'];
const {campaign,salon,owner,viewer,nonce}=ids;
const state=async db=>(await db.query(`select c.status,c.views,c.spent_cents,c.released_credits,w.available_credits,w.reserved_credits,
 (select count(*)::int from campaign_credit_ledger where kind='release') releases
 from owner_campaigns c join campaign_wallets w using(salon_id) where c.id=$1`,[campaign])).rows[0];
const close=db=>db.query('select campaign_credit_close_expired($1)',[salon]);

for(const keep of [false,true])for(const used of [0,1])test(`completed period returns unused credits: keep=${keep}, used=${used}`,async()=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  if(used)assert.equal((await db.query("select owner_campaign_admit($1,$2,'view',$3,$4,$5) ok",[campaign,'a'.repeat(64),{country:'US',state:'WI',city:'Milwaukee'},viewer,nonce])).rows[0].ok,true);
  await db.query('update owner_campaigns set keep_running=$1,ends_at=now() where id=$2',[keep,campaign]);
  await close(db);
  const after=await state(db);
  assert.deepEqual(after,{status:'completed',views:used,spent_cents:used,released_credits:300-used,available_credits:300-used,reserved_credits:0,releases:1});
  await close(db);assert.deepEqual(await state(db),after,'retry cannot return credit twice');
  if(keep){
   const renewed=(await db.query('select campaign_credit_renew($1) ok',[campaign])).rows[0].ok;
   assert.equal(renewed,used===0,'zero-view period reuses returned balance without a purchase');
   const current=await state(db);assert.equal(current.releases,1);
   assert.equal(current.available_credits,used?299:0);assert.equal(current.reserved_credits,used?0:300);
   assert.equal(current.spent_cents,used);
   if(used){
    await db.query('update campaign_wallets set available_credits=available_credits+1 where salon_id=$1',[salon]);
    assert.equal((await db.query('select campaign_credit_renew($1) ok',[campaign])).rows[0].ok,true);
   }
   await db.exec('update owner_campaigns set ends_at=now()');await close(db);
   const second=await state(db);assert.equal(second.available_credits,300);assert.equal(second.reserved_credits,0);
   assert.equal(second.spent_cents,used);assert.equal(second.releases,2);
   await close(db);assert.deepEqual(await state(db),second);
  }
 }finally{await db.close();}
});

test('an active or owner-paused funded period is not completed by settlement',async()=>{
 const db=await createCampaignCumulativeDb({migrations});
 try{
  const before=await state(db);await close(db);assert.deepEqual(await state(db),before);
  await db.query("select owner_campaign_change($1,$2,$3,'pause')",[campaign,salon,owner]);
  await db.exec("update owner_campaigns set ends_at=now()-interval '1 minute'");
  await close(db);const paused=await state(db);assert.equal(paused.status,'paused');assert.equal(paused.available_credits,0);assert.equal(paused.reserved_credits,300);
  await db.query("select owner_campaign_change($1,$2,$3,'cancel')",[campaign,salon,owner]);
  assert.equal((await state(db)).available_credits,300);
 }finally{await db.close();}
});

const built=await build({entryPoints:['lib/campaign-credit-queue.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {runCampaignCreditQueue}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
for(const broken of [false,true])test(`queue settles before buying; settlement failure=${broken}`,async()=>{
 const calls=[];let claimed=false;let balance=0;
 const client={rpc(name,args){return {abortSignal:async()=>{
  if(name==='campaign_credit_queue_claim'){
   calls.push(args.p_phase);
   if(args.p_phase==='close'&&!claimed){claimed=true;return {data:{items:[{item_id:salon,lease_token:'lease'}],pending:false}};}
   return {data:{items:[],pending:false}};
  }
  if(name==='campaign_credit_close_expired'){if(broken)return {error:{message:'failure'}};balance=300;return {data:null};}
  return {data:true};
 }}}};
 let readiness=false;
 const result=await runCampaignCreditQueue({client,paymentReady:async()=>{readiness=true;assert.equal(balance,300);return true;},topUp:async()=>assert.fail('no order expected')});
 assert.deepEqual(calls.slice(0,3),['close','close',broken?'fund':'topup']);
 assert.equal(readiness,!broken);
 if(broken){assert.equal(result.ok,false);assert.ok(result.deferred.includes('topup'));assert.equal(calls.includes('topup'),false);}
 else assert.equal(result.complete,true);
});
