import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(path,fetch){
  const exports={},timers=new Map();let id=0;
  vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
    exports,require:()=>({classifyExploreSearchError:()=> 'query'}),fetch,AbortController,Error,
    setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:key=>timers.delete(key),
  });
  return {exports,timers};
}
const classification={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/explore-search-rpc.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:classification});
function delayedBody(path){
 let internal,resolveBody,rejectBody,started;
 const body=new Promise((resolve,reject)=>{resolveBody=resolve;rejectBody=reject;});
 const reading=new Promise(resolve=>{started=resolve;});
 const runtime=load(path,async(_url,options)=>{
  internal=options.signal;
  return {ok:true,json:()=>{
   const rejectOnAbort=()=>rejectBody(Object.assign(new Error('body aborted'),{name:'AbortError'}));
   if(internal.aborted)rejectOnAbort();else internal.addEventListener('abort',rejectOnAbort,{once:true});
   started();return body;
  }};
 });
 return {runtime,reading,resolveBody,rejectBody,signal:()=>internal};
}
for(const [name,path,call] of [
  ['search','lib/explore-search-client.ts',(api,signal)=>api.fetchExploreSearchPage({query:'nail'},signal)],
  ['discovery','lib/explore-feed-client.ts',(api,signal)=>api.requestExploreFeed({mode:'page'},signal)],
]){
  test(`${name} propagates caller cancellation and releases its deadline`,async()=>{
    let internal;const runtime=load(path,async(_url,options)=>{internal=options.signal;return new Promise((_resolve,reject)=>internal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}))});
    const caller=new AbortController();const result=call(runtime.exports,caller.signal);
    caller.abort();await assert.rejects(result,/aborted/);assert.equal(internal.aborted,true);assert.equal(runtime.timers.size,0);
  });
  test(`${name} distinguishes the request deadline from caller cancellation`,async()=>{
    const runtime=load(path,async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true})));
    const result=call(runtime.exports,new AbortController().signal);[...runtime.timers.values()][0]();
    await assert.rejects(result,/took too long/);assert.equal(runtime.timers.size,0);
  });
  test(`${name} keeps caller cancellation connected while a successful response body is still loading`,async()=>{
    const pending=delayedBody(path),caller=new AbortController();
    const result=call(pending.runtime.exports,caller.signal);await pending.reading;
    assert.equal(pending.runtime.timers.size,1,'headers must not release the full-body deadline');
    caller.abort();await assert.rejects(result,error=>error.name==='AbortError'&&/body aborted/.test(error.message));
    assert.equal(pending.signal().aborted,true);assert.equal(pending.runtime.timers.size,0);
  });
  test(`${name} applies its deadline to delayed JSON and classifies body expiry as timeout`,async()=>{
    const pending=delayedBody(path);const result=call(pending.runtime.exports,new AbortController().signal);await pending.reading;
    assert.equal(pending.runtime.timers.size,1);[...pending.runtime.timers.values()][0]();
    await assert.rejects(result,error=>classification.classifyExploreSearchError(error)==='timeout'&&/took too long/.test(error.message));
    assert.equal(pending.signal().aborted,true);assert.equal(pending.runtime.timers.size,0);
  });
  test(`${name} preserves a body network rejection and releases resources only after body settlement`,async()=>{
    const pending=delayedBody(path),caller=new AbortController();const result=call(pending.runtime.exports,caller.signal);await pending.reading;
    assert.equal(pending.runtime.timers.size,1);const failure=new TypeError('Failed to fetch response body');pending.rejectBody(failure);
    await assert.rejects(result,error=>error===failure&&classification.classifyExploreSearchError(error)==='network');
    assert.equal(pending.runtime.timers.size,0);caller.abort();assert.equal(pending.signal().aborted,false,'settled body removes its parent-abort bridge');
  });
  test(`${name} clears its deadline after a delayed JSON body finishes successfully`,async()=>{
    const pending=delayedBody(path),caller=new AbortController();const result=call(pending.runtime.exports,caller.signal);await pending.reading;
    assert.equal(pending.runtime.timers.size,1);const value={results:[],error:null,...(name==='search'?{searchVersion:3,target:'salons'}:{})};pending.resolveBody(value);
    assert.equal(await result,value);assert.equal(pending.runtime.timers.size,0);caller.abort();assert.equal(pending.signal().aborted,false);
  });
}
test('discovery preserves an expired session error returned by the server',async()=>{
  const runtime=load('lib/explore-feed-client.ts',async()=>({ok:false,status:409,json:async()=>({error:'This Discovery session expired. Refresh to continue.',errorKind:'cursor'})}));
  await assert.rejects(runtime.exports.requestExploreFeed({mode:'page'}),error=>error.code==='22023'&&/expired/.test(error.message));
  assert.equal(runtime.timers.size,0);
});

test('search rejects an obsolete successful payload and an already-aborted call never fetches',async()=>{
  const runtime=load('lib/explore-search-client.ts',async()=>({ok:true,json:async()=>({target:'posts',results:[]})}));
  await assert.rejects(runtime.exports.fetchExploreSearchPage({},new AbortController().signal),error=>error.errorKind==='query');
  let calls=0;const canceled=load('lib/explore-search-client.ts',async()=>{calls++;});
  const controller=new AbortController();controller.abort();
  await assert.rejects(canceled.exports.fetchExploreSearchPage({},controller.signal),error=>error.name==='AbortError');
  assert.equal(calls,0);assert.equal(canceled.timers.size,0);
});

test('search discards a delayed body even if the transport ignores cancellation',async()=>{
  let resolve;const runtime=load('lib/explore-search-client.ts',async()=>({ok:true,json:()=>new Promise(done=>{resolve=done;})}));
  const controller=new AbortController();const request=runtime.exports.fetchExploreSearchPage({},controller.signal);
  await new Promise(done=>setImmediate(done));controller.abort();
  resolve({searchVersion:3,target:'salons',results:[]});
  await assert.rejects(request,error=>error.name==='AbortError');assert.equal(runtime.timers.size,0);
});
test('search preserves the server error kind instead of turning query failures into network failures',async()=>{
  for (const kind of ['query','network','timeout','cursor']) {
    const runtime=load('lib/explore-search-client.ts',async()=>({ok:false,status:kind==='timeout'?504:503,json:async()=>({error:'Search failed.',errorKind:kind})}));
    await assert.rejects(runtime.exports.fetchExploreSearchPage({query:'nail'},new AbortController().signal),error=>error.errorKind===kind);
    assert.equal(runtime.timers.size,0);
  }
});
