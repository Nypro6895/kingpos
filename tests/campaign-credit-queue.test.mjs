import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {createCampaignCumulativeDb,ids} from './fixtures/campaign-cumulative-db.mjs';

const bundle=await build({entryPoints:['lib/campaign-payments.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'local-only',setup(b){
 b.onResolve({filter:/^(server-only|\.\/platform-payment|@\/lib\/explore-advertising)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='server-only'?'':a.path==='./platform-payment'?`export const paymentConfig=async()=>{if(globalThis.queuePaymentConfig)return globalThis.queuePaymentConfig;throw Error('fixture config unavailable')};export const paymentStripe=async()=>{throw Error('External payments forbidden in fixture')}`:`export const advertisingClient=()=>globalThis.queueClient`,loader:'js'}));
}}]});
const {processCampaignCreditQueue}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const coreBundle=await build({entryPoints:['lib/campaign-credit-queue.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {runCampaignCreditQueue}=await import('data:text/javascript;base64,'+Buffer.from(coreBundle.outputFiles[0].text).toString('base64'));
const query=execute=>({abortSignal(signal){assert.ok(signal instanceof AbortSignal);return this},then(resolve,reject){return Promise.resolve().then(execute).then(resolve,reject)}});
const empty={items:[],pending:false};

test('payment configuration failure is observable and does not prevent expiry cleanup',async()=>{
 const phases=[];
 globalThis.queueClient={rpc(name,args){phases.push(args?.p_phase??name);return{abortSignal(){return this},then(resolve){return Promise.resolve({data:{items:[],pending:false},error:null}).then(resolve)}}}};
 const result=await processCampaignCreditQueue();
 assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.phase==='topup'));assert.ok(phases.includes('close'));
});

test('a query or financial RPC failure is reported; other items, settlement and reminders continue',async()=>{
 const seen=[],counts={};
 const client={rpc(name,args){seen.push(name+':'+(args.p_phase??args.p_id??args.p_salon));return query(()=>{
   if(name==='campaign_credit_queue_claim'){
     if(args.p_phase==='fund')return{data:null,error:{message:'fixture database secret should not escape'}};
     const count=counts[args.p_phase]=(counts[args.p_phase]??0)+1;
     return{data:count<=2?{items:[{item_id:`${args.p_phase}-${count}`,lease_token:randomUUID()}],pending:count===1}:empty};
   }
   if(name==='campaign_credit_renew'&&args.p_id==='renew-1')return{error:{message:'db unavailable'}};
   if(name==='campaign_credit_close_expired'&&args.p_salon==='close-1')return{error:{message:'db unavailable'}};
   return{data:true};
 })}};
 const result=await runCampaignCreditQueue({client,paymentReady:async()=>false,topUp:async()=>{throw Error('unexpected payment')}});
 assert.equal(result.ok,false);assert.deepEqual(result.errors.map(e=>[e.phase,e.operation]),[['fund','claim'],['renew','process'],['close','process']]);
 assert.equal(result.attempted.renew,2);assert.equal(result.attempted.close,2);assert.equal(result.attempted.pause_reminders,2);
 assert.ok(seen.includes('campaign_credit_queue_finish:renew'));assert.ok(!JSON.stringify(result).includes('secret'));
});

test('absolute deadlines preserve cleanup budget and defer an unfinished lease without a late write',async()=>{
 let clock=0;const calls=[],claimed=new Set();
 const client={rpc(name,args){calls.push({name,args,clock});return query(()=>{
   if(name==='campaign_credit_queue_claim'){
     if(claimed.has(args.p_phase))return{data:empty};claimed.add(args.p_phase);
     return{data:{items:[{item_id:args.p_phase,lease_token:randomUUID()}],pending:false}};
   }
   if(name==='campaign_credit_renew')clock=140000;
   return{data:true};
 })},from(){return{select(){return this},eq(){return this},abortSignal(){return this},maybeSingle(){return query(()=>{clock=105000;return{data:{status:'awaiting_payment',auto_fund:true,salon_id:'s'}}})}}}};
 const result=await runCampaignCreditQueue({client,now:()=>clock,paymentReady:async()=>true,topUp:async(id,deadline)=>{assert.equal(deadline,60000);clock=deadline;throw Error('fixture timeout')}});
 assert.equal(result.ok,false);assert.ok(result.deferred.includes('topup'));assert.ok(result.deferred.includes('fund'));assert.ok(result.deferred.includes('renew'));
 assert.ok(calls.some(c=>c.name==='campaign_credit_close_expired'));assert.ok(calls.some(c=>c.name==='campaign_pause_reminder'));
 assert.equal(calls.filter(c=>c.name==='campaign_credit_queue_finish'&&['topup','fund','renew'].includes(c.args.p_phase)).length,0,'no writes are started after a phase deadline');
});

test('eligible work leased by another run remains explicitly deferred',async()=>{
 const client={rpc(){return query(()=>({data:{items:[],pending:true}}))}};
 const result=await runCampaignCreditQueue({client,paymentReady:async()=>false,topUp:async()=>{}});
 assert.equal(result.ok,true);assert.equal(result.complete,false);assert.equal(result.status,'deferred');assert.deepEqual(result.deferred,['fund','renew','close','pause_reminders']);
});

test('real cumulative SQL queue progresses beyond 100 persistent failures and protects leases/roles',async()=>{
 const db=await createCampaignCumulativeDb({migrations:['20261021040000_campaign_expiry_settlement.sql','20261021060000_campaign_credit_queue_progress.sql']});
 try{
  await db.exec(`update owner_campaigns set keep_running=true,ends_at=now()-interval '1 hour';
   insert into owner_campaigns select (jsonb_populate_record(null::owner_campaigns,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'source_id',gen_random_uuid(),'payment_reference',null))).* from owner_campaigns c cross join generate_series(1,204) where c.id='${ids.campaign}';`);
  const beforeLedger=(await db.query('select count(*)::int n from campaign_credit_ledger')).rows[0].n;
  const attempts=[];
  const client={rpc(name,args){return query(async()=>{
    if(name==='campaign_credit_queue_claim'){const r=await db.query('select campaign_credit_queue_claim($1,$2,$3,$4) result',[args.p_phase,args.p_run,args.p_limit,args.p_seed]);return{data:r.rows[0].result};}
    if(name==='campaign_credit_queue_finish'){const r=await db.query('select campaign_credit_queue_finish($1,$2,$3) result',[args.p_phase,args.p_item,args.p_token]);return{data:r.rows[0].result};}
    if(name==='campaign_credit_renew'){attempts.push(args.p_id);return{error:{message:'poison row fixture'}};}
    return{data:true};
  })}};
  for(let run=0;run<3;run++){
   const result=await runCampaignCreditQueue({client,paymentReady:async()=>false,topUp:async()=>{}});
   assert.equal(result.ok,false);assert.equal(result.attempted.renew,100);assert.ok(result.deferred.includes('renew'));
  }
  assert.equal(new Set(attempts.slice(0,205)).size,205,'every eligible campaign gets an attempt before repeats despite 205 poison rows');
  assert.equal((await db.query('select count(*)::int n from campaign_credit_ledger')).rows[0].n,beforeLedger,'queue claims did not touch financial ledger');
  const runA=randomUUID(),runB=randomUUID();
  const a=(await db.query('select campaign_credit_queue_claim($1,$2,1) result',['renew',runA])).rows[0].result.items[0];
  const b=(await db.query('select campaign_credit_queue_claim($1,$2,1) result',['renew',runB])).rows[0].result.items[0];
  assert.notEqual(a.item_id,b.item_id,'active leases are excluded');
  assert.equal((await db.query('select campaign_credit_queue_finish($1,$2,$3) result',['renew',a.item_id,b.lease_token])).rows[0].result,false);
  await db.query("update campaign_credit_queue_progress set lease_until=now()-interval '1 second',attempted_at='-infinity' where phase='renew' and item_id=$1",[a.item_id]);
  const retry=(await db.query('select campaign_credit_queue_claim($1,$2,1) result',['renew',randomUUID()])).rows[0].result.items[0];
  assert.equal(retry.item_id,a.item_id);assert.notEqual(retry.lease_token,a.lease_token);
  assert.equal((await db.query('select campaign_credit_queue_finish($1,$2,$3) result',['renew',a.item_id,a.lease_token])).rows[0].result,false,'late old worker cannot clear new lease');
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);
   await assert.rejects(()=>db.query('select campaign_credit_queue_claim($1,$2,1)',['renew',randomUUID()]),/permission denied/);
   await assert.rejects(()=>db.query('select * from campaign_credit_queue_progress'),/permission denied/);
   await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await db.query('select campaign_credit_queue_claim($1,$2,1)',['renew',randomUUID()]);
  await db.exec('reset role');
 }finally{await db.close();}
});

test('unknown provider outcome retains the pending order and exact idempotency key across an explicit retry',async()=>{
 const orderId=randomUUID(),requests=[],seenRuns=new Set();let enabled=true,status='pending',paid=0;
 globalThis.queuePaymentConfig={enabled:true,mode:'live',webhookSecret:'fixture',secretKey:'fixture-only'};
 const previousFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.ok(options.signal instanceof AbortSignal);requests.push({url,key:options.headers['Idempotency-Key'],body:options.body});throw Error('fixture unknown outcome')};
 globalThis.queueClient={rpc(name,args){return query(()=>{
  if(name==='campaign_credit_queue_claim'){
   const key=args.p_run+':'+args.p_phase;
   if(args.p_phase!=='topup'||seenRuns.has(key)||!enabled)return{data:empty};seenRuns.add(key);
   return{data:{items:[{item_id:ids.salon,lease_token:randomUUID()}],pending:false}};
  }
  if(name==='campaign_credit_queue_finish')return{data:true};
  if(name==='campaign_credit_order')return{data:orderId};
  if(name==='campaign_credit_claim'){status='processing';return{data:{amount:123,customer:'cus_fixture',method:'pm_fixture'}};}
  if(name==='campaign_credit_paid'){paid++;return{data:true};}
  throw Error('Unexpected RPC '+name);
 })},from(table){let update=null;const builder={select(){return this},eq(){return this},neq(){return this},update(value){update=value;return this},maybeSingle(){return this},single(){return this},abortSignal(signal){assert.ok(signal instanceof AbortSignal);return this},then(resolve,reject){return Promise.resolve().then(()=>{
  if(update){if(table==='campaign_wallets'&&update.auto_topup_enabled===false)enabled=false;if(table==='campaign_credit_orders'&&update.status)status=update.status;return{error:null};}
  if(table==='campaign_wallets')return{data:{salon_id:ids.salon,payment_owner:ids.owner,topup_credits:100,installed:true,auto_topup_enabled:enabled}};
  return{data:{id:orderId,automatic:true,status,owner_id:ids.owner,credits:100}};
 }).then(resolve,reject)}};return builder}};
 try{
  for(let attempt=0;attempt<2;attempt++){enabled=true;const result=await processCampaignCreditQueue();assert.equal(result.ok,false);assert.equal(result.attempted.topup,1);assert.equal(enabled,false);}
  assert.equal(status,'processing');assert.equal(paid,0);assert.equal(requests.length,2);
  assert.deepEqual(requests.map(r=>r.key),[`campaign-topup:${orderId}`,`campaign-topup:${orderId}`]);
  assert.equal(new URLSearchParams(requests[0].body).get('amount'),'123');
 }finally{globalThis.fetch=previousFetch;delete globalThis.queuePaymentConfig;}
});

test('provider deadline leaves the processing order recoverable when no budget remains for attention writes',async()=>{
 let clock=1000,claimSent=false,status='pending',updates=0;const orderId=randomUUID(),requests=[];
 const oldNow=Date.now,oldFetch=globalThis.fetch;Date.now=()=>clock;
 globalThis.queuePaymentConfig={enabled:true,mode:'live',webhookSecret:'fixture',secretKey:'fixture-only'};
 globalThis.fetch=async(url,options)=>{requests.push(options.headers['Idempotency-Key']);clock=61000;throw Error('fixture AbortError after sending request')};
 globalThis.queueClient={rpc(name,args){return query(()=>{
  if(name==='campaign_credit_queue_claim'){
   if(args.p_phase!=='topup'||claimSent)return{data:empty};claimSent=true;
   return{data:{items:[{item_id:ids.salon,lease_token:randomUUID()}],pending:false}};
  }
  if(name==='campaign_credit_order')return{data:orderId};
  if(name==='campaign_credit_claim'){status='processing';return{data:{amount:123,customer:'cus_fixture',method:'pm_fixture'}};}
  if(name==='campaign_credit_queue_finish')throw Error('expired phase must retain lease for timeout recovery');
  throw Error('Unexpected RPC '+name);
 })},from(table){let mutation=false;const builder={select(){return this},eq(){return this},neq(){return this},update(){mutation=true;return this},abortSignal(){return this},maybeSingle(){return this},single(){return this},then(resolve,reject){return Promise.resolve().then(()=>{
  if(mutation){updates++;return{};}
  return{data:table==='campaign_wallets'?{salon_id:ids.salon,payment_owner:ids.owner,topup_credits:100,installed:true,auto_topup_enabled:true}:{id:orderId,automatic:true,status,owner_id:ids.owner,credits:100}};
 }).then(resolve,reject)}};return builder}};
 try{
  const result=await processCampaignCreditQueue();
  assert.equal(result.status,'partial');assert.equal(status,'processing');assert.equal(updates,0);
  assert.deepEqual(requests,[`campaign-topup:${orderId}`]);
  assert.ok(result.errors.some(e=>e.phase==='topup'&&e.operation==='finish'));
  assert.ok(result.deferred.includes('topup'));
 }finally{Date.now=oldNow;globalThis.fetch=oldFetch;delete globalThis.queuePaymentConfig;}
});

test('cumulative financial RPCs reuse a processing order and fulfill its purchase exactly once',async()=>{
 const db=await createCampaignCumulativeDb({migrations:['20261021060000_campaign_credit_queue_progress.sql']});
 try{
  await db.query("update campaign_wallets set auto_topup_enabled=true,payment_owner=$1,stripe_customer='cus_fixture',stripe_payment_method='pm_fixture',topup_credits=500 where salon_id=$2",[ids.owner,ids.salon]);
  const order=(await db.query('select campaign_credit_order($1,$2,500,true) id',[ids.salon,ids.owner])).rows[0].id;
  const claim=(await db.query('select campaign_credit_claim($1) claim',[order])).rows[0].claim;assert.ok(claim);
  assert.equal((await db.query('select status from campaign_credit_orders where id=$1',[order])).rows[0].status,'processing');
  assert.equal((await db.query('select campaign_credit_order($1,$2,500,true) id',[ids.salon,ids.owner])).rows[0].id,order);
  assert.deepEqual((await db.query('select campaign_credit_claim($1) claim',[order])).rows[0].claim,claim);
  const before=(await db.query('select available_credits from campaign_wallets where salon_id=$1',[ids.salon])).rows[0].available_credits;
  for(let i=0;i<2;i++)await db.query("select campaign_credit_paid($1,'pi_fixture',$2,null,null)",[order,claim.amount]);
  assert.equal((await db.query('select available_credits from campaign_wallets where salon_id=$1',[ids.salon])).rows[0].available_credits,before+500);
  assert.equal((await db.query("select count(*)::int n from campaign_credit_ledger where reference='purchase:pi_fixture'")).rows[0].n,1);
 }finally{await db.close();}
});

test('integrated queue keeps owner Pause sticky and emits each due in-app reminder once in fixtures',async()=>{
 const db=await createCampaignCumulativeDb({migrations:['20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql','20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql']});
 const client={rpc(name,args){return query(async()=>{
  let sql,values;
  if(name==='campaign_credit_queue_claim'){sql='select campaign_credit_queue_claim($1,$2,$3,$4) result';values=[args.p_phase,args.p_run,args.p_limit,args.p_seed];}
  else if(name==='campaign_credit_queue_finish'){sql='select campaign_credit_queue_finish($1,$2,$3) result';values=[args.p_phase,args.p_item,args.p_token];}
  else if(name==='campaign_credit_close_expired'){sql='select campaign_credit_close_expired($1) result';values=[args.p_salon];}
  else if(name==='campaign_pause_reminder'){sql='select campaign_pause_reminder($1) result';values=[args.p_id];}
  else throw Error('Paused campaign must not be funded or renewed: '+name);
  const response=await db.query(sql,values);return{data:response.rows[0].result};
 })}};
 try{
  await db.query("update owner_campaigns set keep_running=true,ends_at=now()+interval '10 days' where id=$1",[ids.campaign]);
  await db.query("select owner_campaign_change($1,$2,$3,'pause')",[ids.campaign,ids.salon,ids.owner]);
  // Advance only the fixture's milestone clock; no real notification transport exists here.
  await db.query("update campaign_pause_reminders set due_at=now()-interval '1 second' where campaign_id=$1 and milestone_hours=24",[ids.campaign]);
  const before=(await db.query('select available_credits,reserved_credits from campaign_wallets where salon_id=$1',[ids.salon])).rows[0];
  for(let i=0;i<2;i++)assert.equal((await runCampaignCreditQueue({client,paymentReady:async()=>false,topUp:async()=>{throw Error('external payment forbidden')}})).ok,true);
  const notices=(await db.query("select recipient_user_id,notification_type from app_notifications where notification_type='campaign_pause_reminder'")).rows;
  assert.deepEqual(notices,[{recipient_user_id:ids.owner,notification_type:'campaign_pause_reminder'}]);
  assert.deepEqual((await db.query('select available_credits,reserved_credits from campaign_wallets where salon_id=$1',[ids.salon])).rows[0],before);
  await db.query("update owner_campaigns set ends_at=now()-interval '1 second' where id=$1",[ids.campaign]);
  for(let i=0;i<2;i++)assert.equal((await runCampaignCreditQueue({client,paymentReady:async()=>false,topUp:async()=>{}})).ok,true);
  const after=(await db.query('select status,owner_paused_at,released_credits from owner_campaigns where id=$1',[ids.campaign])).rows[0];
  assert.equal(after.status,'completed');assert.ok(after.owner_paused_at);assert.equal(after.released_credits,300);
  assert.equal((await db.query("select count(*)::int n from campaign_credit_ledger where kind='release'")).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from campaign_pause_reminders where campaign_id=$1 and processed_at is null and cancelled_at is null",[ids.campaign])).rows[0].n,0);
 }finally{await db.close();}
});

test('queue route rejects unauthorized callers and returns observable sanitized partial failure',async()=>{
 const compiled=await build({entryPoints:['app/api/internal/campaign-credits/route.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'queue',setup(b){b.onResolve({filter:/^@\/lib\/campaign-payments$/},()=>({path:'queue',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const processCampaignCreditQueue=async()=>{globalThis.routeCalls++;if(globalThis.routeError)throw Error('secret');return globalThis.routeResult}`,loader:'js'}));}}]});
 const {GET}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 const old=process.env.CAMPAIGN_QUEUE_SECRET;process.env.CAMPAIGN_QUEUE_SECRET='fixture-token';globalThis.routeCalls=0;
 const request=token=>new Request('http://localhost/api/internal/campaign-credits',{headers:token?{authorization:'Bearer '+token}:{}});
 try{
  assert.equal((await GET(request('wrong'))).status,401);assert.equal(globalThis.routeCalls,0);
  globalThis.routeResult={ok:false,errors:[{phase:'close',operation:'process'}]};assert.equal((await GET(request('fixture-token'))).status,503);
  globalThis.routeResult={ok:true,deferred:['renew']};assert.equal((await GET(request('fixture-token'))).status,200);
  globalThis.routeError=true;const failure=await GET(request('fixture-token'));assert.equal(failure.status,503);assert.ok(!(await failure.text()).includes('secret'));
 }finally{if(old===undefined)delete process.env.CAMPAIGN_QUEUE_SECRET;else process.env.CAMPAIGN_QUEUE_SECRET=old;delete globalThis.routeError;}
});
