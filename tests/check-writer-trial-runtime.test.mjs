import test from'node:test';import assert from'node:assert/strict';import{build}from'esbuild';
async function load(file,stubs={}){const out=await build({entryPoints:[file],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'boundary',setup(api){api.onResolve({filter:/.*/},a=>a.path==='server-only'||stubs[a.path]?{path:a.path,namespace:'fixture'}:undefined);api.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path]??'',loader:'ts'}));}}]});return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));}

test('trial readiness requires exact explicit flag and crypto while paid sales stay closed',async()=>{
 const names=['CHECK_WRITER_TRIAL_ENABLED','CHECK_WRITER_SALES_ENABLED','CHECK_WRITER_ENCRYPTION_KEY','CHECK_WRITER_ENCRYPTION_KEYS','CHECK_WRITER_ACTIVE_KEY_ID'];const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{for(const n of names)delete process.env[n];const{checkWriterTrialReady,checkWriterSalesReady}=await load('lib/check-writer-readiness.ts');
  process.env.CHECK_WRITER_TRIAL_ENABLED='true';assert.equal(checkWriterTrialReady(),false);
  process.env.CHECK_WRITER_ACTIVE_KEY_ID='qa_trial';process.env.CHECK_WRITER_ENCRYPTION_KEYS=JSON.stringify({qa_trial:'ab'.repeat(32)});
  for(const flag of['false','TRUE','1','']){process.env.CHECK_WRITER_TRIAL_ENABLED=flag;assert.equal(checkWriterTrialReady(),false);}
  process.env.CHECK_WRITER_TRIAL_ENABLED='true';assert.equal(checkWriterTrialReady(),true);assert.equal(checkWriterSalesReady(),false);
 }finally{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}}
});
test('trial action uses the current owner/service boundary and rejects stale salon or unready start before RPC',async()=>{
 const f=globalThis.writerTrial={ready:false,calls:[],owner:true};
 try{const{marketTrialAction}=await load('app/market/trial-actions.ts',{
  '@/lib/market-plugins':`export async function marketPluginContext(){if(!globalThis.writerTrial.owner)throw Error('Owner required');return {salonId:'salon_a',userId:'owner_a',client:{async rpc(){throw Error('Wrong authenticated RPC')}}}}`,
  '@/lib/check-writer-readiness':`export function checkWriterTrialReady(){return globalThis.writerTrial.ready}`,
  '@/lib/market-payments':`export function marketServiceClient(){return {async rpc(name,args){globalThis.writerTrial.calls.push({name,args});return {data:{started:args.p_start,active:args.p_start,paid:false,endsAt:args.p_start?'2030-01-01':null}}}}}`,
  'next/cache':`export function revalidatePath(){}`,
 });
 assert.match((await marketTrialAction('print-check',true,'salon_b')).error,/salon changed/);assert.match((await marketTrialAction('print-check',true,'salon_a')).error,/being configured/);assert.equal(f.calls.length,0);
 assert.equal((await marketTrialAction('print-check',false,'salon_a')).state.started,false);f.calls=[];f.ready=true;
 const result=await marketTrialAction('print-check',true,'salon_a');assert.equal(result.state.active,true);assert.equal(result.state.paid,false);assert.deepEqual(f.calls,[{name:'check_writer_trial',args:{p_salon:'salon_a',p_actor:'owner_a',p_start:true}}]);
 f.owner=false;assert.match((await marketTrialAction('print-check',true,'salon_a')).error,/Owner required/);assert.equal(f.calls.length,1);
 }finally{delete globalThis.writerTrial;}
});
test('server subscription view grants owner-bound trial without inventing paid time or subscription',async()=>{
 const{checkWriterSubscription}=await load('lib/check-writer-subscription.ts');
 let row={trial_owner:'owner_a',trial_ends_at:new Date(Date.now()+86400000).toISOString(),paid_until:null,payment_owner:null,stripe_subscription:null};
 const service={from(){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:row}}};return q;}};
 const state=await checkWriterSubscription(service,'salon_a','owner_a');assert.equal(state.active,true);assert.equal(state.paid,false);assert.equal(state.subscribed,false);assert.equal(state.paidUntil,null);
 assert.equal((await checkWriterSubscription(service,'salon_a','owner_b')).active,false);
 row={...row,trial_ends_at:new Date(Date.now()-1000).toISOString()};assert.equal((await checkWriterSubscription(service,'salon_a','owner_a')).active,false);
 row={...row,paid_until:new Date(Date.now()+86400000).toISOString(),payment_owner:'owner_b'};assert.equal((await checkWriterSubscription(service,'salon_a','owner_a')).active,false);assert.equal((await checkWriterSubscription(service,'salon_a','owner_b')).active,true);
});
