import assert from 'node:assert/strict';
import test from 'node:test';
import {PREPARATION_RPCS as names,parsePreparationOptions,runPreparation} from '../scripts/backfill-explore-local-quality.mjs';
const pending={ready:false,done:false,busy:false,scanned:0,processed:0,stale:0,pending:true,scanComplete:false};
const complete={...pending,done:true,pending:false,scanComplete:true};
function runner(responses,options,extra={}){const calls=[],progress=[];return {calls,progress,run:()=>runPreparation({options,rpc:async(name,args)=>{calls.push({name,args});return responses.shift();},onProgress:value=>progress.push(value),wait:async()=>{},...extra})};}
test('preparation defaults to status-only and rejects unbounded options',async()=>{
 const options=parsePreparationOptions([]),r=runner([pending],options);assert.equal((await r.run()).batches,0);assert.deepEqual(r.calls.map(x=>x.name),[names.status]);
 for(const args of [['--limit=101'],['--limit=0'],['--pause-ms=0'],['--activate'],['--max-batches=100001'],['--limit=1.5'],['--unknown']])assert.throws(()=>parsePreparationOptions(args));
});
test('bounded batches resume after busy/stale work and activate only after completion',async()=>{
 const options=parsePreparationOptions(['--apply','--activate','--limit=20']),r=runner([pending,{...pending,busy:true},{...pending,scanned:20,stale:1},complete,{...complete,ready:true}],options);
 const result=await r.run();assert.equal(result.state.ready,true);assert.equal(result.batches,3);
 assert.deepEqual(r.calls.map(x=>x.name),[names.status,names.batch,names.batch,names.batch,names.activate]);
 assert(r.calls.filter(x=>x.name===names.batch).every(x=>x.args.p_limit===20));
});
test('maximum foreground batches leaves resumable state without premature activation',async()=>{
 const r=runner([pending,{...pending,scanned:50}],parsePreparationOptions(['--apply','--activate','--max-batches=1']));
 assert.equal((await r.run()).state.done,false);assert.equal(r.calls.length,2);assert(!r.calls.some(x=>x.name===names.activate));
});
test('activation retries a busy clock and reconciles a source write at the boundary',async()=>{
 const r=runner([complete,{...complete,busy:true},pending,complete,{...complete,ready:true}],parsePreparationOptions(['--apply','--activate']));
 const result=await r.run();assert.equal(result.state.ready,true);assert.equal(result.batches,1);assert.equal(result.activationAttempts,3);
 assert.deepEqual(r.calls.map(x=>x.name),[names.status,names.activate,names.activate,names.batch,names.activate]);
 const busy=runner([complete,...Array.from({length:10},()=>({...complete,busy:true}))],parsePreparationOptions(['--apply','--activate']));
 assert.equal((await busy.run()).activationAttempts,10);assert.equal(busy.calls.length,11);
});
test('already ready and interrupted runs never start more work',async()=>{
 const ready=runner([{...complete,ready:true}],parsePreparationOptions(['--apply','--activate']));await ready.run();assert.equal(ready.calls.length,1);
 const controller=new AbortController(),r=runner([pending,complete],parsePreparationOptions(['--apply','--activate']),{signal:controller.signal,onProgress:value=>{if(value.event==='batch')controller.abort();}});
 assert.equal((await r.run()).stopped,true);assert(!r.calls.some(x=>x.name===names.activate));
 let calls=0;await assert.rejects(runPreparation({options:parsePreparationOptions(['--apply']),signal:controller.signal,rpc:async()=>{calls++;return pending;}}),{name:'AbortError'});assert.equal(calls,0);
});
test('failed or malformed responses stop preparation and progress never dumps private fields',async()=>{
 const r=runner([{...pending,privateKey:'secret',salonId:'private-id'},null],parsePreparationOptions(['--apply']));
 await assert.rejects(r.run(),/Invalid preparation response/);assert.equal(r.calls.length,2);assert(!JSON.stringify(r.progress).includes('secret'));assert(!JSON.stringify(r.progress).includes('private-id'));
 let calls=0;await assert.rejects(runPreparation({options:parsePreparationOptions(['--apply','--activate']),rpc:async()=>{if(++calls===1)return pending;throw Error('transport failed');}}),/transport failed/);assert.equal(calls,2);
});
