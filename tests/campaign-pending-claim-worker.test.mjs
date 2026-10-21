import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {createCampaignCumulativeDb,ids} from './fixtures/campaign-cumulative-db.mjs';

const migrations=[
 '20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql',
 '20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql',
 '20261021080000_campaign_admin_pause_status.sql','20261021090000_campaign_pending_claim_demand.sql',
];
const compiled=await build({entryPoints:['lib/campaign-payments.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'isolated-payments',setup(b){
 b.onResolve({filter:/^(server-only|\.\/platform-payment|@\/lib\/explore-advertising)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='server-only'?'':a.path==='./platform-payment'
  ?`export const paymentConfig=async()=>({enabled:true,mode:'live',webhookSecret:'fixture-only',secretKey:'fixture-only'});export const paymentStripe=async()=>{throw Error('External transport is forbidden in this fixture')};`
  :`export const advertisingClient=()=>globalThis.pendingClaimWorkerClient;`,loader:'js'}));
}}]});
const {processCampaignCreditQueue}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

// This adapter executes the real cumulative SQL inside one disposable PGlite
// connection. It is not a PostgREST integration or a multi-session race test.
function localClient(db,calls){
 const rpcArguments={
  campaign_credit_queue_claim:['p_phase','p_run','p_limit','p_seed'],
  campaign_credit_queue_finish:['p_phase','p_item','p_token'],
  campaign_credit_order:['p_salon','p_owner','p_amount','p_auto'],campaign_credit_claim:['p_order'],
  campaign_credit_paid:['p_order','p_reference','p_amount','p_customer','p_method'],
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
 const order=(await db.query('select campaign_credit_order($1,$2,500,true) id',[ids.salon,ids.owner])).rows[0].id;
 assert.ok(order); // Created before the owner Pause, while the wallet was low.
 // A separate, previously cancelled purchase is fulfilled late. This uses the
 // real accounting RPC to make balance > threshold without inventing credit.
 const late=randomUUID();
 await db.query("insert into campaign_credit_orders(id,salon_id,owner_id,credits,amount_cents,automatic,status) values($1,$2,$3,500,500,false,'cancelled')",[late,ids.salon,ids.owner]);
 await db.query("select campaign_credit_paid($1,'pi_fixture_late',500,null,null)",[late]);
 await db.query("select owner_campaign_change($1,$2,$3,'pause')",[ids.campaign,ids.salon,ids.owner]);
 const current=(await db.query('select status,ends_at>now() unexpired,owner_paused_at from owner_campaigns where id=$1',[ids.campaign])).rows[0];
 assert.equal(current.status,'paused');assert.equal(current.unexpired,true);assert.ok(current.owner_paused_at);
 return order;
}

test('real worker + 040–090 SQL suppress pending paused-only demand before any provider request, including retries',async()=>{
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
  assert.equal(claims.length,3);assert.ok(claims.every(call=>call.args.p_order===order&&call.result===null));
  assert.deepEqual(calls.filter(call=>call.name==='campaign_credit_order').map(call=>call.result),[order,order,order]);
  assert.equal(provider.length,0);assert.equal(before.orders.find(row=>row.id===order).status,'pending');
  assert.equal((await snapshot(db)).wallets[0].auto_topup_enabled,true);
  assert.equal(calls.filter(call=>call.name==='campaign_credit_paid').length,0);
 }finally{globalThis.fetch=previousFetch;delete globalThis.pendingClaimWorkerClient;await db.close();}
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
