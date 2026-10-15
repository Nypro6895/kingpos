import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const require=createRequire(import.meta.url),ts=require('typescript');
function modules(env={},routeWorker) {
 const cache=new Map();
 function load(path){if(cache.has(path))return cache.get(path);const m={exports:{}};cache.set(path,m.exports);
  const {outputText}=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  vm.runInNewContext(outputText,{exports:m.exports,process:{env},console:{warn(){}},Buffer,Request,Response,DOMException,AbortSignal,setTimeout,clearTimeout,require:n=>{
   if(n==='server-only')return{};
   if(n==='@supabase/supabase-js')return{createClient(){throw Error('No external clients permitted in this test');}};
   if(n==='@/lib/explore-search-ranking'&&routeWorker)return{runExploreSearchRankingWorker:routeWorker};
   if(n.startsWith('@/'))return load(n.slice(2)+'.ts');return require(n);
  }});return m.exports;
 }return{load};
}
const id=i=>'12600000-0000-0000-0000-'+String(i).padStart(12,'0');
const job=i=>({salon_id:id(i),lease:id(i+500),generation:1,fingerprint:'source-'+i});
const evidence=(salon,good=98)=>({salon_id:salon,rule_version:'lumi-trust-v2',feedback_days:180,return_days:90,cohort_days:180,as_of:new Date().toISOString(),verified_visit_count:240,unique_visitor_count:100,feedback_customer_count:100,good_feedback_count:good,issue_feedback_count:100-good,eligible_return_customer_count:100,returning_customer_count:70});
function runner(jobs,change={}) {const calls=[];let rows=[];const rpc=async(n,a,s)=>{calls.push({name:n,args:a,signal:s});if(change[n])return change[n](a,s);return{error:null,data:n==='claim_explore_search_rank_jobs'?jobs:n==='get_public_lumi_trust_signals'?jobs.filter(j=>j.fingerprint!==null).map(j=>evidence(j.salon_id)):n==='get_public_explore_decision_signals'?jobs.map(j=>({salon_id:j.salon_id,booking_enabled:true,bookable_service_id:j.salon_id})):n==='publish_explore_search_rank_jobs'?(rows=a.p_rows,{published:rows.length,hasMore:false}):null};};return{rpc,calls,get rows(){return rows;}};}
test('worker publishes the actual shared scorer and bounds all canonical reads',async()=>{
 const mod=modules(),worker=mod.load('lib/explore-search-ranking.ts'),scorer=mod.load('lib/reylumi-trust.ts'),r=runner([job(1),job(2)]),signal=new AbortController().signal;
 const result=await worker.runExploreSearchRankingWorker({rpc:r.rpc,batchSize:10000,maxBatches:1,signal});
 assert.equal(result.published,2);assert.equal(r.calls.find(c=>c.name==='claim_explore_search_rank_jobs').args.p_limit,100);
 const loader=mod.load('lib/lumi-trust-data.ts');const proof=await loader.getLumiTrustEvidenceBySalonId(async()=>({error:null,data:[evidence(id(1))]}),[id(1)]);
 assert.equal(r.rows[0].trust_score,scorer.reylumiTrustScore({averageRating:null,trustEvidence:proof.get(id(1))}));
 assert.equal(r.rows[0].bookable,true);assert.equal(r.rows[0].rule_version,scorer.LUMI_TRUST_RULES.version);
 assert.ok(r.calls.every(c=>c.signal===signal));assert.equal(r.calls.filter(c=>c.name==='get_public_lumi_trust_signals').length,1);
});
test('unclaimed/missing/version-mismatched evidence never becomes invented zero Trust',async()=>{
 const r=runner([job(1)],{get_public_lumi_trust_signals:async()=>({error:null,data:[{...evidence(id(1)),rule_version:'future'}]})});
 const result=await modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:r.rpc});assert.equal(result.published,0);assert.equal(result.failed,1);assert.equal(r.rows.length,0);assert.ok(r.calls.some(c=>c.name==='fail_explore_search_rank_jobs'));
});
test('canonical zero evidence is accepted only when valid counts explicitly prove it',async()=>{
 const zero={...evidence(id(1)),verified_visit_count:0,unique_visitor_count:0,feedback_customer_count:0,good_feedback_count:0,issue_feedback_count:0,eligible_return_customer_count:0,returning_customer_count:0};
 const r=runner([job(1)],{get_public_lumi_trust_signals:async()=>({error:null,data:[zero]}),get_explore_rank_refresh_policy:async()=>({error:null,data:[{salon_id:id(1),may_skip_decay:true}]})});await modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:r.rpc});assert.equal(r.rows[0].trust_score,0);assert.equal(r.rows[0].empty_evidence,true);
 const future=runner([job(1)],{get_public_lumi_trust_signals:async()=>({error:null,data:[zero]}),get_explore_rank_refresh_policy:async()=>({error:null,data:[{salon_id:id(1),may_skip_decay:false}]})});await modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:future.rpc});assert.equal(future.rows[0].empty_evidence,false);
});
test('a tombstone closes its revision without reading private canonical aggregates',async()=>{
 const r=runner([{...job(1),fingerprint:null}]);await modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:r.rpc});assert.equal(r.rows[0].fingerprint,null);assert.equal(r.rows[0].trust_score,undefined);assert.ok(!r.calls.some(c=>c.name.startsWith('get_public_')));
});
test('booking requires a canonical eligible service and unavailable data is retried',async()=>{
 const r=runner([job(1)],{get_public_explore_decision_signals:async()=>({error:null,data:[{salon_id:id(1),booking_enabled:true,bookable_service_id:null}]})});const result=await modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:r.rpc});assert.equal(result.published,0);assert.equal(result.failed,1);
});
test('RPC errors preserve their code and release the claimed lease',async()=>{
 const r=runner([job(1)],{get_public_lumi_trust_signals:async()=>({error:{code:'57014'},data:null})});await assert.rejects(()=>modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:r.rpc}),e=>e.code==='57014');assert.ok(r.calls.some(c=>c.name==='fail_explore_search_rank_jobs'));
});
test('already-aborted work never claims a job',async()=>{
 const r=runner([job(1)]),c=new AbortController();c.abort();await assert.rejects(()=>modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:r.rpc,signal:c.signal}),e=>e.name==='AbortError');assert.equal(r.calls.length,0);
});
test('internal route uses existing cron authorization and never runs for invalid callers',async()=>{
 let calls=0;const fake=async()=>{calls++;return{published:1};};
 const route=modules({CRON_SECRET:'test-existing-cron'},fake).load('app/api/internal/explore-ranking/route.ts');
 assert.equal((await route.POST(new Request('https://example.invalid'))).status,401);assert.equal(calls,0);
 assert.equal((await route.POST(new Request('https://example.invalid',{headers:{authorization:'Bearer test-existing-cron'}}))).status,200);assert.equal(calls,1);
 assert.equal((await modules({},fake).load('app/api/internal/explore-ranking/route.ts').POST(new Request('https://example.invalid'))).status,503);assert.equal(calls,1);
});

test('publisher timeout reports a safe phase/progress and releases its leased jobs',async()=>{
 const r=runner([job(1)],{publish_explore_search_rank_jobs:async()=>({data:null,error:{code:'57014',message:'private detail must never be reported'}})});
 await assert.rejects(()=>modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:r.rpc}),error=>{
  assert.equal(error.code,'57014');assert.equal(error.phase,'publish_explore_search_rank_jobs');assert.equal(error.progress.claimed,1);assert.equal(error.progress.published,0);assert.equal(error.progress.batches,1);assert.equal(error.message,'Explore ranking update failed.');return true;
 });assert.ok(r.calls.some(c=>c.name==='fail_explore_search_rank_jobs'));
});

test('operator retries only transient codes with smaller bounded batches and correct completed counts',async()=>{
 const attempts=[],retry=[],wait=[];let call=0;
 const worker=async options=>{attempts.push(options);call++;if(call<3)throw Object.assign(Error('temporary'),{code:call===1?'57014':'55P03',phase:'publish_explore_search_rank_jobs',progress:{claimed:options.batchSize,published:call===1?20:0,failed:0,batches:1}});return{claimed:options.batchSize,published:options.batchSize,failed:0,batches:1,hasMore:true};};
 const result=await modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWithRetry({worker,batchSize:50,maxBatches:10,onRetry:r=>retry.push(r),wait:async ms=>{wait.push(ms);}});
 assert.deepEqual(attempts.map(v=>v.batchSize),[50,25,12]);assert.deepEqual(attempts.map(v=>v.refreshDue),[true,false,false]);assert.deepEqual(wait,[1000,2000]);assert.equal(result.retryCount,2);assert.equal(result.claimed,87);assert.equal(result.published,32);assert.equal(result.batches,3);assert.equal(result.batchSize,12);assert.equal(retry.length,2);
});

test('operator stops after three transient failures and never retries permanent or aborted work',async()=>{
 const retry=modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWithRetry;let attempts=0;
 await assert.rejects(()=>retry({worker:async()=>{attempts++;throw Object.assign(Error('transient'),{code:'57014'});},wait:async()=>{}}),e=>e.code==='57014');assert.equal(attempts,3);
 attempts=0;await assert.rejects(()=>retry({worker:async()=>{attempts++;throw Object.assign(Error('permission'),{code:'42501'});},wait:async()=>{throw Error('must not wait');}}),e=>e.code==='42501');assert.equal(attempts,1);
 const abort=new AbortController();attempts=0;await assert.rejects(()=>retry({signal:abort.signal,worker:async()=>{attempts++;throw Object.assign(Error('transient'),{code:'57014'});},wait:async()=>{abort.abort();throw new DOMException('Request aborted','AbortError');}}),e=>e.name==='AbortError');assert.equal(attempts,1);
});

test('private route uses50-job transactions under300/run and exposes only safe failure phase/code',async()=>{
 let options;const route=modules({CRON_SECRET:'test-existing-cron'},async value=>{options=value;throw Object.assign(Error('secret details'),{code:'57014',phase:'publish_explore_search_rank_jobs',details:{private:'must not be returned'}});}).load('app/api/internal/explore-ranking/route.ts');
 const result=await route.POST(new Request('https://example.invalid',{headers:{authorization:'Bearer test-existing-cron'}}));assert.equal(options.batchSize,50);assert.equal(options.maxBatches,6);assert.ok(options.signal instanceof AbortSignal);assert.equal(result.status,500);
 assert.deepEqual(await result.json(),{error:'Ranking refresh could not finish.',code:'57014',phase:'publish_explore_search_rank_jobs'});
});

test('operator argument parser rejects nonfinite/out-of-range batches before any worker call',()=>{
 const source=readFileSync('scripts/refresh-explore-search-ranking.mjs','utf8'),ast=ts.createSourceFile('script.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='integerArgument');assert.ok(fn);
 const parse=(args,name,fallback,max)=>vm.runInNewContext('('+source.slice(fn.getStart(ast),fn.end)+')(name,fallback,max)',{process:{argv:['node','script',...args]},name,fallback,max});
 assert.equal(parse([],'batch-size',50,100),50);assert.equal(parse(['--batch-size=25'],'batch-size',50,100),25);
 for(const value of['NaN','Infinity','0','101','1.5'])assert.throws(()=>parse(['--batch-size='+value],'batch-size',50,100),/must be an integer/);
});


test('real default retry backoff aborts promptly and does not start another worker',async()=>{
 const controller=new AbortController();let attempts=0;
 const promise=modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWithRetry({signal:controller.signal,worker:async()=>{attempts++;throw Object.assign(Error('transient'),{code:'57014'});}});
 const timer=setTimeout(()=>controller.abort(),5);
 try{await assert.rejects(()=>promise,e=>e.name==='AbortError');assert.equal(attempts,1);}finally{clearTimeout(timer);}
});

test('selected canonical reads run serially and publish only after all three finish',async()=>{
 const names=['get_public_lumi_trust_signals','get_public_explore_decision_signals','get_explore_rank_refresh_policy'],events=[];let active=0,peak=0;
 const changed=Object.fromEntries(names.map(name=>[name,async()=>{
  active++;peak=Math.max(peak,active);events.push('start:'+name);
  await new Promise(resolve=>setTimeout(resolve,5));
  events.push('finish:'+name);active--;
  return{error:null,data:name===names[0]?[evidence(id(1))]:name===names[1]?[{salon_id:id(1),booking_enabled:true,bookable_service_id:id(1)}]:[{salon_id:id(1),may_skip_decay:false}]};
 }]));
 const r=runner([job(1)],changed),result=await modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:r.rpc});
 assert.equal(peak,1);assert.equal(active,0);assert.equal(result.published,1);
 assert.deepEqual(events,names.flatMap(name=>['start:'+name,'finish:'+name]));
 assert.equal(r.rows[0].empty_evidence,false);assert.equal(r.rows[0].bookable,true);
});

test('a failed first canonical read skips later reads and retains lease cleanup and progress',async()=>{
 const r=runner([job(1)],{get_public_lumi_trust_signals:async()=>({data:null,error:{code:'57014'}})});
 await assert.rejects(()=>modules().load('lib/explore-search-ranking.ts').runExploreSearchRankingWorker({rpc:r.rpc}),error=>{
  assert.equal(error.phase,'get_public_lumi_trust_signals');assert.equal(error.progress.claimed,1);assert.equal(error.progress.published,0);return error.code==='57014';
 });
 assert.ok(!r.calls.some(call=>['get_public_explore_decision_signals','get_explore_rank_refresh_policy','publish_explore_search_rank_jobs'].includes(call.name)));
 assert.equal(r.calls.filter(call=>call.name==='fail_explore_search_rank_jobs').length,1);
});

function actualOperatorLoop(context) {
 const source=readFileSync('scripts/refresh-explore-search-ranking.mjs','utf8'),ast=ts.createSourceFile('operator.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let loop;
 const visit=node=>{if(ts.isForStatement(node))loop=node;ts.forEachChild(node,visit);};visit(ast);assert.ok(loop);
 return vm.runInNewContext('(async()=>{'+source.slice(loop.getStart(ast),loop.end)+'})()',{
  maxRuns:3,batchSize:50,maxBatches:10,AbortSignal,process:{stdout:{write(){}}},...context
 });
}

test('actual operator awaits1500ms pacing between successful runs and never pauses after completion',async()=>{
 const calls=[],pauses=[];let release;
 const worker=async options=>{calls.push(options);return{claimed:1,published:1,failed:0,batches:1,hasMore:true};};
 const pending=actualOperatorLoop({runExploreSearchRankingWithRetry:worker,waitForExploreSearchRankingPause:async(ms,signal)=>{pauses.push({ms,signal});await new Promise(resolve=>{release=resolve;});}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);assert.equal(pauses[0].ms,1500);assert.ok(pauses[0].signal instanceof AbortSignal);
 release();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);assert.equal(pauses[1].ms,1500);
 release();await pending;assert.equal(calls.length,3);assert.equal(pauses.length,2);assert.deepEqual(calls.map(call=>call.refreshDue),[true,false,false]);
 let completePauses=0;await actualOperatorLoop({runExploreSearchRankingWithRetry:async()=>({claimed:1,published:1,hasMore:false}),waitForExploreSearchRankingPause:async()=>{completePauses++;}});assert.equal(completePauses,0);
});

test('actual operator cancellation during the real pause prevents its next run',async()=>{
 const controller=new AbortController(),pause=modules().load('lib/explore-search-ranking.ts').waitForExploreSearchRankingPause;let calls=0;
 const pending=actualOperatorLoop({AbortSignal:{timeout:()=>controller.signal},runExploreSearchRankingWithRetry:async()=>{calls++;return{claimed:1,published:1,hasMore:true};},waitForExploreSearchRankingPause:pause});
 const timer=setTimeout(()=>controller.abort(),5);
 try{await assert.rejects(()=>pending,error=>error.name==='AbortError');assert.equal(calls,1);}finally{clearTimeout(timer);}
 assert.throws(()=>pause(Infinity),/Invalid ranking pause/);assert.throws(()=>pause(-1),/Invalid ranking pause/);assert.throws(()=>pause(10001),/Invalid ranking pause/);
});
