import test from 'node:test';
import assert from 'node:assert/strict';
import {configureProfessionalSearchScheduler,safeWorkerSummary} from '../work/explore-read-model/configure-professional-search-scheduler.mjs';

const configuration={NEXT_PUBLIC_SUPABASE_URL:'https://fixture-only.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key-never-real',CRON_SECRET:'fixture-cron-secret-never-real-123'};
const worker={claimed:100,published:99,failed:1,batches:2,hasMore:true};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const noCredentials=receipt=>{const value=JSON.stringify(receipt);assert.ok(!value.includes(configuration.CRON_SECRET));assert.ok(!value.includes(configuration.SUPABASE_SERVICE_ROLE_KEY));assert.ok(!value.includes('fixture-only.supabase.co'));};

test('only a real authenticated worker-shaped success precedes scheduler RPC, with bounded nonredirecting requests and secret-free receipt',async()=>{
 const calls=[];const receipt=await configureProfessionalSearchScheduler({configuration,fetcher:async(url,options)=>{calls.push({url,options});return calls.length===1?response(worker):response({configured:true,jobId:129});}});
 assert.equal(calls.length,2);assert.equal(calls[0].url,'https://reylumi.com/api/internal/explore-ranking');assert.equal(calls[0].options.headers.Authorization,`Bearer ${configuration.CRON_SECRET}`);assert.equal(calls[0].options.body,'{}');
 assert.equal(calls[1].url,'https://fixture-only.supabase.co/rest/v1/rpc/configure_explore_search_rank_scheduler');assert.equal(JSON.parse(calls[1].options.body).p_secret,configuration.CRON_SECRET);assert.equal(calls[1].options.headers.apikey,configuration.SUPABASE_SERVICE_ROLE_KEY);
 assert.ok(calls.every(call=>call.options.redirect==='error'&&call.options.method==='POST'&&call.options.signal instanceof AbortSignal));assert.equal(receipt.configured,true);assert.equal(receipt.jobId,129);assert.deepEqual(receipt.worker,worker);noCredentials(receipt);
});
test('HTTP failure, provider secret-bearing bodies, invalid counts and network rejection never configure or leak provider diagnostics',async()=>{
 const cases=[()=>response({secret:configuration.CRON_SECRET},401),()=>response({error:configuration.CRON_SECRET}),()=>response({...worker,published:101}),()=>response({...worker,batches:7}),()=>response({...worker,batches:1}),()=>{throw new Error(configuration.CRON_SECRET+configuration.SUPABASE_SERVICE_ROLE_KEY);}];
 for(const result of cases){let calls=0;const receipt=await configureProfessionalSearchScheduler({configuration,fetcher:async()=>{calls++;return result();}});assert.equal(calls,1);assert.equal(receipt.configured,false);assert.equal(receipt.jobId,null);assert.equal(receipt.phase,'verify_worker');noCredentials(receipt);}
});
test('invalid configuration stays entirely offline and invalid scheduler results disclose only safe status',async()=>{
 for(const input of [null,{...configuration,CRON_SECRET:'short'},{...configuration,NEXT_PUBLIC_SUPABASE_URL:'http://fixture-only.supabase.co'},{...configuration,NEXT_PUBLIC_SUPABASE_URL:'https://untrusted.invalid'}]){
  let calls=0;const receipt=await configureProfessionalSearchScheduler({configuration:input,fetcher:async()=>{calls++;throw new Error('must stay offline');}});assert.equal(calls,0);assert.equal(receipt.configured,false);noCredentials(receipt);
 }
 let calls=0;const receipt=await configureProfessionalSearchScheduler({configuration,fetcher:async()=>++calls===1?response(worker):response({configured:false,secret:configuration.CRON_SECRET})});assert.equal(calls,2);assert.equal(receipt.configured,false);assert.equal(receipt.phase,'configure_rpc');assert.equal(receipt.configurationStatus,200);noCredentials(receipt);
});
test('worker shape enforces the actual route batch budget and bounded body reading stops oversized responses before configuration',async()=>{
 assert.deepEqual(safeWorkerSummary({claimed:0,published:0,failed:0,batches:0,hasMore:false}),{claimed:0,published:0,failed:0,batches:0,hasMore:false});
 assert.deepEqual(safeWorkerSummary({claimed:300,published:299,failed:1,batches:6,hasMore:true}),{claimed:300,published:299,failed:1,batches:6,hasMore:true});
 assert.throws(()=>safeWorkerSummary({claimed:301,published:301,failed:0,batches:6,hasMore:true}));assert.throws(()=>safeWorkerSummary({claimed:300,published:300,failed:0,batches:3,hasMore:true}));assert.throws(()=>safeWorkerSummary({...worker,extra:configuration.CRON_SECRET}));
 let calls=0;const receipt=await configureProfessionalSearchScheduler({configuration,fetcher:async()=>{calls++;return new Response('x'.repeat(65537),{status:200});}});assert.equal(calls,1);assert.equal(receipt.errorKind,'response_too_large');assert.equal(receipt.configured,false);noCredentials(receipt);
});
