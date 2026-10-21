import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {createCampaignCumulativeDb,ids} from './fixtures/campaign-cumulative-db.mjs';

const migrations=[
 '20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql',
 '20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql',
 '20261021080000_campaign_admin_pause_status.sql','20261021090000_campaign_pending_claim_demand.sql',
 '20261021100000_campaign_paused_reserve_lifecycle.sql',
 '20261021110000_campaign_credit_demand_and_budget.sql',
];
const compiled=await build({entryPoints:['lib/campaign-payments.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'isolated-payments',setup(b){
 b.onResolve({filter:/^(server-only|\.\/platform-payment|@\/lib\/explore-advertising)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='server-only'?'':a.path==='./platform-payment'
  ?`export const paymentConfig=async()=>({enabled:true,mode:'live',webhookSecret:'fixture-only',secretKey:'fixture-only'});export const paymentStripe=async()=>{throw Error('External transport is forbidden in this fixture')};`
  :`export const advertisingClient=()=>globalThis.pendingClaimWorkerClient;`,loader:'js'}));
}}]});
const {processCampaignCreditQueue,reconcileCampaignCreditOrder}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

// This adapter executes the real cumulative SQL inside one disposable PGlite
// connection. It is not a PostgREST integration or a multi-session race test.
function localClient(db,calls){
 const rpcArguments={
  campaign_credit_queue_claim:['p_phase','p_run','p_limit','p_seed'],
  campaign_credit_queue_finish:['p_phase','p_item','p_token'],
  campaign_credit_order:['p_salon','p_owner','p_amount','p_auto'],campaign_credit_claim:['p_order'],
  campaign_credit_paid:['p_order','p_reference','p_amount','p_customer','p_method'],
  campaign_credit_cancelled:['p_order','p_reference'],
  campaign_credit_fund:['p_id','p_salon','p_owner','p_keep'],campaign_credit_renew:['p_id'],
  campaign_credit_close_expired:['p_salon'],campaign_pause_reminder:['p_id'],
 };
 const tables=new Set(['campaign_wallets','campaign_credit_orders','owner_campaigns']);
 const identifier=value=>{assert.match(value,/^[a-z_]+$/);return value;};
 const executable=execute=>({abortSignal(signal){assert.ok(signal instanceof AbortSignal);return this;},then(resolve,reject){return Promise.resolve().then(execute).then(data=>({data,error:null}),error=>({data:null,error})).then(resolve,reject);}});
 return{
  rpc(name,args){assert.ok(Object.hasOwn(rpcArguments,name),'unapproved fixture RPC '+name);return executable(async()=>{
   const keys=rpcArguments[name],values=keys.map(key=>args[key]??null);
   const result=(await db.query(`select ${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`,values)).rows[0].result;
   calls.push({name,args:structuredClone(args),result:structuredClone(result)});return result;
  });},
  from(table){
   assert.ok(tables.has(table),'unapproved fixture table '+table);
   let columns='*',mutation=null,one=false;const filters=[];
   const builder={
    select(value){columns=value;for(const column of columns.split(','))if(column!=='*')identifier(column);return this;},
    update(value){mutation=value;Object.keys(value).forEach(identifier);return this;},
    eq(key,value){filters.push({key:identifier(key),value,operator:'='});return this;},
    neq(key,value){filters.push({key:identifier(key),value,operator:'<>'});return this;},
    single(){one=true;return this;},maybeSingle(){one=true;return this;},
    abortSignal(signal){assert.ok(signal instanceof AbortSignal);return this;},
    then(resolve,reject){return executable(async()=>{
     const values=[],bind=value=>{values.push(value);return '$'+values.length;};
     const head=mutation?`update ${table} set ${Object.entries(mutation).map(([key,value])=>`${key}=${bind(value)}`).join(',')}`:`select ${columns} from ${table}`;
     assert.ok(filters.length,'fixture queries must remain scoped');
     const where=filters.map(({key,value,operator})=>`${key}${operator}${bind(value)}`).join(' and ');
     const result=await db.query(`${head} where ${where}${mutation?' returning *':''}`,values);
     return one?(result.rows[0]??null):result.rows;
    }).then(resolve,reject);},
   };return builder;
  },
 };
}

const snapshot=async db=>(await db.query(`select
 (select jsonb_agg(to_jsonb(w) order by salon_id) from campaign_wallets w) wallets,
 (select jsonb_agg(to_jsonb(o) order by id) from campaign_credit_orders o) orders,
 (select jsonb_agg(to_jsonb(l) order by id) from campaign_credit_ledger l) ledger,
 (select jsonb_agg(to_jsonb(c) order by id) from owner_campaigns c) campaigns,
 (select jsonb_agg(to_jsonb(n) order by id) from app_notifications n) notices`)).rows[0];

async function preparePendingPause(db){
 await db.query(`update campaign_wallets set auto_topup_enabled=true,payment_owner=$1,
  stripe_customer='cus_fixture',stripe_payment_method='pm_fixture',topup_credits=500,threshold_credits=100,
  auto_topup_consent_at=now() where salon_id=$2`,[ids.owner,ids.salon]);
 const need=randomUUID(),needPost=randomUUID();
 await db.query("insert into salon_profile_looks values($1,$2,'Earlier funding need','Gel manicure','published',$3,false,null)",[needPost,ids.salon,ids.owner]);
 await db.query("select campaign_create_versioned(1,$1,$2,$3,'salon_profile_look',$4,'city','Milwaukee','United States','Wisconsin','Milwaukee',500,9,900,false,true)",[need,ids.salon,ids.owner,needPost]);
 const order=(await db.query('select campaign_credit_order($1,$2,500,true) id',[ids.salon,ids.owner])).rows[0].id;
 assert.ok(order); // Created for a real unpaused funding shortfall.
 // A separate, previously cancelled purchase is fulfilled late. This uses the
 // real accounting RPC to make balance > threshold without inventing credit.
 const late=randomUUID();
 await db.query("insert into campaign_credit_orders(id,salon_id,owner_id,credits,amount_cents,automatic,status) values($1,$2,$3,500,500,false,'cancelled')",[late,ids.salon,ids.owner]);
 await db.query("select campaign_credit_paid($1,'pi_fixture_late',500,null,null)",[late]);
 await db.query("select owner_campaign_change($1,$2,$3,'cancel')",[need,ids.salon,ids.owner]);
 await db.query("select owner_campaign_change($1,$2,$3,'pause')",[ids.campaign,ids.salon,ids.owner]);
 const current=(await db.query('select status,ends_at>now() unexpired,owner_paused_at from owner_campaigns where id=$1',[ids.campaign])).rows[0];
 assert.equal(current.status,'paused');assert.equal(current.unexpired,true);assert.ok(current.owner_paused_at);
 return order;
}

test('real worker + cumulative SQL suppress paused-only demand before any provider request, including retries',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],provider=[];
 const previousFetch=globalThis.fetch;
 globalThis.fetch=async(...args)=>{provider.push(args);throw Error('All external requests are forbidden in this fixture');};
 globalThis.pendingClaimWorkerClient=localClient(db,calls);
 try{
  const order=await preparePendingPause(db),before=await snapshot(db);
  assert.equal(before.wallets[0].available_credits,500);assert.equal(before.wallets[0].threshold_credits,100);
  for(let run=0;run<3;run++){
   const result=await processCampaignCreditQueue();
   assert.equal(result.status,'complete');assert.equal(result.ok,true);assert.equal(result.attempted.topup,1);
   assert.deepEqual(await snapshot(db),before,'only queue scheduling metadata may change');
  }
  const claims=calls.filter(call=>call.name==='campaign_credit_claim');
  assert.equal(claims.length,0,'order eligibility stops the worker before the claim; the claim RPC separately revalidates race-time demand');
  assert.deepEqual(calls.filter(call=>call.name==='campaign_credit_order').map(call=>call.result),[null,null,null]);
  assert.equal(provider.length,0);assert.equal(before.orders.find(row=>row.id===order).status,'pending');
  assert.equal((await snapshot(db)).wallets[0].auto_topup_enabled,true);
  assert.equal(calls.filter(call=>call.name==='campaign_credit_paid').length,0);
 }finally{globalThis.fetch=previousFetch;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

async function prepareActiveNeed(db){
 await db.query(`update campaign_wallets set auto_topup_enabled=true,payment_owner=$1,
  stripe_customer='cus_fixture',stripe_payment_method='pm_fixture',topup_credits=500,threshold_credits=100,
  auto_topup_consent_at=now() where salon_id=$2`,[ids.owner,ids.salon]);
 const other=randomUUID(),post=randomUUID();
 await db.query("insert into salon_profile_looks values($1,$2,'Active funding need','Gel manicure','published',$3,false,null)",[post,ids.salon,ids.owner]);
 await db.query("select campaign_create_versioned(1,$1,$2,$3,'salon_profile_look',$4,'city','Milwaukee','United States','Wisconsin','Milwaukee',500,9,900,false,true)",[other,ids.salon,ids.owner,post]);
 return other;
}

test('provider processing and later confirmation keep one intent, consent and ledger, then grant once',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);
 try{
  await prepareActiveNeed(db);let id,successful=false;
  globalThis.fetch=async(url,options)=>{
   requests.push({url,method:options.method,key:options.headers['Idempotency-Key'],body:options.body});
   if(options.method==='POST')id=new URLSearchParams(options.body).get('metadata[campaign_credit_order]');
   return Response.json({id:'pi_processingfixture',status:successful?'succeeded':'processing',currency:'usd',amount_received:successful?500:0,metadata:{campaign_credit_order:id},customer:'cus_fixture'});
  };
  const first=await processCampaignCreditQueue();assert.equal(first.ok,false,'unfinished provider outcome remains observable');
  let state=await snapshot(db);assert.equal(state.orders[0].status,'processing');assert.equal(state.orders[0].provider_reference,'pi_processingfixture');
  assert.equal(state.wallets[0].auto_topup_enabled,true);assert.equal(state.ledger.filter(l=>l.kind==='purchase').length,0);
  await processCampaignCreditQueue();assert.equal(requests.filter(x=>x.method==='POST').length,1,'known provider intent is read, not recreated');
  successful=true;const final=await processCampaignCreditQueue();assert.equal(final.ok,true);
  state=await snapshot(db);assert.equal(state.orders[0].status,'paid');assert.equal(state.ledger.filter(l=>l.reference==='purchase:pi_processingfixture').length,1);
  assert.equal(state.wallets[0].auto_topup_enabled,true);assert.equal(requests.filter(x=>x.method==='POST').length,1);
 }finally{globalThis.fetch=prior;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

test('unknown provider outcome retries the saved payload and key despite later card and pack changes',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);
 try{
  await prepareActiveNeed(db);let id,first=true;
  globalThis.fetch=async(url,options)=>{
   requests.push({url,method:options.method,key:options.headers['Idempotency-Key'],body:options.body});
   if(options.method==='POST'){
    id=new URLSearchParams(options.body).get('metadata[campaign_credit_order]');
    if(first){first=false;throw Error('Fixture connection interrupted after possible provider acceptance');}
   }
   return Response.json({id:'pi_retryfixture',status:'succeeded',currency:'usd',amount_received:500,metadata:{campaign_credit_order:id},customer:'cus_fixture'});
  };
  assert.equal((await processCampaignCreditQueue()).ok,false);
  let state=await snapshot(db);assert.equal(state.orders[0].status,'processing');assert.equal(state.wallets[0].auto_topup_enabled,true);
  await db.query("update campaign_wallets set stripe_customer='cus_changed',stripe_payment_method='pm_changed',topup_credits=1500 where salon_id=$1",[ids.salon]);
  assert.equal((await processCampaignCreditQueue()).ok,true);
  const posts=requests.filter(x=>x.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].key,posts[1].key);assert.equal(posts[0].body,posts[1].body);
  state=await snapshot(db);assert.equal(state.orders.length,1);assert.equal(state.orders[0].status,'paid');assert.equal(state.ledger.filter(l=>l.reference==='purchase:pi_retryfixture').length,1);
 }finally{globalThis.fetch=prior;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

for(const pendingStatus of ['requires_action','requires_payment_method'])test(pendingStatus+' outcome stays processing for reconciliation without disabling automatic preference',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);
 try{
  await prepareActiveNeed(db);let id;
  globalThis.fetch=async(url,options)=>{
   requests.push(options.method);if(options.method==='POST')id=new URLSearchParams(options.body).get('metadata[campaign_credit_order]');
   return Response.json({id:'pi_actionfixture',status:pendingStatus,metadata:{campaign_credit_order:id}});
  };
  assert.equal((await processCampaignCreditQueue()).ok,false);assert.equal((await processCampaignCreditQueue()).ok,false);
  const state=await snapshot(db);assert.equal(state.orders.length,1);assert.equal(state.orders[0].status,'processing');assert.equal(state.wallets[0].auto_topup_enabled,true);
  assert.equal(requests.filter(x=>x==='POST').length,1);assert.equal(state.ledger.filter(l=>l.kind==='purchase').length,0);
 }finally{globalThis.fetch=prior;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

test('legacy processing without a captured request fails observably without any provider request',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);globalThis.fetch=async(...args)=>{requests.push(args);throw Error('Provider forbidden');};
 try{
  await prepareActiveNeed(db);const id=(await db.query('select campaign_credit_order($1,$2,500,true) id',[ids.salon,ids.owner])).rows[0].id;
  await db.query("update campaign_credit_orders set status='processing' where id=$1",[id]);
  assert.equal((await processCampaignCreditQueue()).ok,false);assert.equal(requests.length,0);
  const state=await snapshot(db);assert.equal(state.orders[0].status,'processing');assert.equal(state.wallets[0].auto_topup_enabled,true);assert.equal(state.ledger.filter(l=>l.kind==='purchase').length,0);
 }finally{globalThis.fetch=prior;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

test('unknown processing near provider retention cutoff cannot start a request that crosses the boundary',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);globalThis.fetch=async(...args)=>{requests.push(args);throw Error('Provider forbidden');};
 try{
  await prepareActiveNeed(db);const id=(await db.query('select campaign_credit_order($1,$2,500,true) id',[ids.salon,ids.owner])).rows[0].id;
  await db.query('select campaign_credit_claim($1)',[id]);
  await db.query("update campaign_credit_orders set claim_payload=jsonb_set(claim_payload,'{claimed_at}',to_jsonb(now()-interval '23 hours 56 minutes')) where id=$1",[id]);
  assert.equal((await processCampaignCreditQueue()).ok,false);assert.equal(requests.length,0);
  const state=await snapshot(db);assert.equal(state.orders[0].status,'processing');assert.equal(state.wallets[0].auto_topup_enabled,true);assert.equal(state.ledger.filter(l=>l.kind==='purchase').length,0);
 }finally{globalThis.fetch=prior;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

test('initial provider response must belong to this order before recording its reference',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);
 try{
  await prepareActiveNeed(db);
  globalThis.fetch=async(url,options)=>{requests.push(options.method);return Response.json({id:'pi_wrongorder',status:'processing',metadata:{campaign_credit_order:randomUUID()}});};
  assert.equal((await processCampaignCreditQueue()).ok,false);
  const state=await snapshot(db);assert.equal(state.orders[0].status,'processing');assert.equal(state.orders[0].provider_reference,null);assert.equal(state.wallets[0].auto_topup_enabled,true);assert.equal(requests.length,1);
 }finally{globalThis.fetch=prior;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

test('verified provider cancellation frees the order and budget while preserving automatic preference',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);
 try{
  await prepareActiveNeed(db);let id;
  globalThis.fetch=async(url,options)=>{requests.push(options.method);id=new URLSearchParams(options.body).get('metadata[campaign_credit_order]');return Response.json({id:'pi_canceledfixture',status:'canceled',metadata:{campaign_credit_order:id}});};
  assert.equal((await processCampaignCreditQueue()).ok,false,'terminal cancellation remains visible to the queue');
  let state=await snapshot(db);assert.equal(state.orders[0].status,'failed');assert.match(state.orders[0].error,/cancel/i);
  assert.equal(state.wallets[0].auto_topup_enabled,true);assert.ok(state.wallets[0].auto_topup_consent_at);assert.equal(requests.length,1,'no same-run replacement purchase');
  assert.equal(state.ledger.filter(l=>l.kind==='purchase').length,0);
  assert.equal((await db.query('select campaign_credit_automatic_total($1,automatic_budget_month)::int n from campaign_credit_orders where id=$2',[ids.salon,id])).rows[0].n,0);
  const before=await snapshot(db);assert.equal((await db.query('select campaign_credit_cancelled($1,$2) result',[id,'pi_canceledfixture'])).rows[0].result,true);assert.deepEqual(await snapshot(db),before);
  const manual=(await db.query('select campaign_credit_order($1,$2,500,false) id',[ids.salon,ids.owner])).rows[0].id;assert.notEqual(manual,id);
 }finally{globalThis.fetch=prior;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

test('operator can reconcile a known canceled automatic intent after Stop with GET only and without re-enabling consent',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch,secret=process.env.CAMPAIGN_STRIPE_SECRET_KEY;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);process.env.CAMPAIGN_STRIPE_SECRET_KEY='fixture-no-authority';
 try{
  await prepareActiveNeed(db);const id=(await db.query('select campaign_credit_order($1,$2,500,true) id',[ids.salon,ids.owner])).rows[0].id;
  await db.query('select campaign_credit_claim($1)',[id]);await db.query("update campaign_credit_orders set provider_reference='pi_operatorcancel' where id=$1",[id]);
  await db.query('select campaign_credit_preferences($1,$2,false,500,100,3000)',[ids.salon,ids.owner]);
  globalThis.fetch=async(url,options)=>{requests.push({url,method:options.method});return Response.json({id:'pi_operatorcancel',status:'canceled',metadata:{campaign_credit_order:id}});};
  assert.match(await reconcileCampaignCreditOrder(id),/cancell?ed/i);
  const state=await snapshot(db);assert.equal(state.orders[0].status,'failed');assert.equal(state.wallets[0].auto_topup_enabled,false);assert.equal(state.wallets[0].auto_topup_consent_at,null);assert.equal(state.ledger.filter(l=>l.kind==='purchase').length,0);
  assert.ok(requests.every(r=>r.method==='GET'));assert.equal(requests.length,1);
 }finally{globalThis.fetch=prior;if(secret===undefined)delete process.env.CAMPAIGN_STRIPE_SECRET_KEY;else process.env.CAMPAIGN_STRIPE_SECRET_KEY=secret;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

test('operator cancellation reconciliation preserves paid orders and rejects mismatched references',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch,secret=process.env.CAMPAIGN_STRIPE_SECRET_KEY;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);process.env.CAMPAIGN_STRIPE_SECRET_KEY='fixture-no-authority';
 try{
  await prepareActiveNeed(db);const id=(await db.query('select campaign_credit_order($1,$2,500,true) id',[ids.salon,ids.owner])).rows[0].id;
  await db.query('select campaign_credit_claim($1)',[id]);await db.query("select campaign_credit_paid($1,'pi_alreadypaid',500)",[id]);
  let reference='pi_alreadypaid',metadata=id;
  globalThis.fetch=async(url,options)=>{requests.push(options.method);return Response.json({id:reference,status:'canceled',metadata:{campaign_credit_order:metadata}});};
  const before=await snapshot(db);assert.match(await reconcileCampaignCreditOrder(id),/already recorded/i);assert.deepEqual(await snapshot(db),before);
  reference='pi_other';await assert.rejects(()=>reconcileCampaignCreditOrder(id,'pi_other'),/reference|belong/i);assert.deepEqual(await snapshot(db),before);
  reference='pi_alreadypaid';metadata=randomUUID();await assert.rejects(()=>reconcileCampaignCreditOrder(id),/belong/i);assert.deepEqual(await snapshot(db),before);assert.ok(requests.every(method=>method==='GET'));
 }finally{globalThis.fetch=prior;if(secret===undefined)delete process.env.CAMPAIGN_STRIPE_SECRET_KEY;else process.env.CAMPAIGN_STRIPE_SECRET_KEY=secret;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

test('operator supplied verified canceled reference recovers legacy processing but cannot cancel an unclaimed pending intent',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];const prior=globalThis.fetch,secret=process.env.CAMPAIGN_STRIPE_SECRET_KEY;
 globalThis.pendingClaimWorkerClient=localClient(db,calls);process.env.CAMPAIGN_STRIPE_SECRET_KEY='fixture-no-authority';
 try{
  await prepareActiveNeed(db);const id=(await db.query('select campaign_credit_order($1,$2,500,true) id',[ids.salon,ids.owner])).rows[0].id;
  globalThis.fetch=async(url,options)=>{requests.push(options.method);return Response.json({id:'pi_legacyverified',status:'canceled',metadata:{campaign_credit_order:id}});};
  await assert.rejects(()=>reconcileCampaignCreditOrder(id,'pi_legacyverified'),/reference|reconcil/i);assert.equal((await snapshot(db)).orders[0].status,'pending');
  await db.query("update campaign_credit_orders set status='processing' where id=$1",[id]);
  await db.query('select campaign_credit_preferences($1,$2,false,500,100,3000)',[ids.salon,ids.owner]);
  assert.match(await reconcileCampaignCreditOrder(id,'pi_legacyverified'),/cancell?ed/i);
  const state=await snapshot(db);assert.equal(state.orders[0].status,'failed');assert.equal(state.orders[0].provider_reference,'pi_legacyverified');assert.equal(state.orders[0].claim_payload,null);assert.equal(state.wallets[0].auto_topup_enabled,false);assert.equal(state.ledger.filter(l=>l.kind==='purchase').length,0);assert.ok(requests.every(method=>method==='GET'));
 }finally{globalThis.fetch=prior;if(secret===undefined)delete process.env.CAMPAIGN_STRIPE_SECRET_KEY;else process.env.CAMPAIGN_STRIPE_SECRET_KEY=secret;delete globalThis.pendingClaimWorkerClient;await db.close();}
});

test('another actual campaign demand still uses the same pending order and provider key without resuming the paused campaign',async()=>{
 const db=await createCampaignCumulativeDb({migrations});const calls=[],requests=[];
 const previousFetch=globalThis.fetch;globalThis.pendingClaimWorkerClient=localClient(db,calls);
 try{
  const order=await preparePendingPause(db),other=randomUUID(),post=randomUUID();
  await db.query("insert into salon_profile_looks values($1,$2,'Other campaign','Gel manicure','published',$3,false,null)",[post,ids.salon,ids.owner]);
  await db.query("select campaign_create_versioned(1,$1,$2,$3,'salon_profile_look',$4,'city','Milwaukee','United States','Wisconsin','Milwaukee',500,9,900,false,true)",[other,ids.salon,ids.owner,post]);
  const pausedBefore=(await db.query('select to_jsonb(c) row from owner_campaigns c where id=$1',[ids.campaign])).rows[0].row;
  globalThis.fetch=async(url,options)=>{
   requests.push({url,key:options.headers['Idempotency-Key'],method:options.method,body:options.body});
   assert.ok(options.signal instanceof AbortSignal);
   assert.ok(url==='https://api.stripe.com/v1/payment_intents'||url==='https://api.stripe.com/v1/payment_intents/pi_fixtureclaim');
   if(options.method==='POST'){
    const form=new URLSearchParams(options.body);assert.equal(form.get('metadata[campaign_credit_order]'),order);
    assert.equal(form.get('amount'),'500');assert.equal(options.headers['Idempotency-Key'],`campaign-topup:${order}`);
   }
   return Response.json({id:'pi_fixtureclaim',status:'succeeded',currency:'usd',amount_received:500,metadata:{campaign_credit_order:order},customer:'cus_fixture'});
  };
  const result=await processCampaignCreditQueue();
  assert.equal(result.ok,true);assert.equal(result.status,'complete');assert.equal(result.attempted.topup,1);assert.equal(result.attempted.fund,1);
  assert.equal(requests.length,2);assert.equal(requests.filter(r=>r.method==='POST').length,1);
  assert.deepEqual(calls.filter(call=>call.name==='campaign_credit_claim').map(call=>call.args.p_order),[order]);
  assert.equal((await db.query('select status from campaign_credit_orders where id=$1',[order])).rows[0].status,'paid');
  assert.equal((await db.query("select count(*)::int n from campaign_credit_ledger where reference='purchase:pi_fixtureclaim'")).rows[0].n,1);
  const funded=(await db.query('select status,reserved_credits from owner_campaigns where id=$1',[other])).rows[0];
  assert.equal(funded.status,'pending_review');assert.equal(funded.reserved_credits,900);
  assert.deepEqual((await db.query('select to_jsonb(c) row from owner_campaigns c where id=$1',[ids.campaign])).rows[0].row,pausedBefore);
 }finally{globalThis.fetch=previousFetch;delete globalThis.pendingClaimWorkerClient;await db.close();}
});
