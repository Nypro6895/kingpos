import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const module={exports:{}};vm.runInNewContext(transformSync(readFileSync('lib/explore-search-rpc.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,console:{warn(){}}});
const {runExploreSearchRpc,classifyExploreSearchError,exploreSearchErrorMessage}=module.exports;
test('temporary database timeout retries once and preserves returned data',async()=>{let n=0;let success={data:{rows:[{id:'salon'}]},error:null};assert.equal(await runExploreSearchRpc(async()=>++n===1?{data:null,error:{code:'57014'}}:success),success);assert.equal(n,2)});
test('persistent timeout stops after two attempts',async()=>{let n=0;let failure={data:null,error:{code:'57014'}};assert.equal(await runExploreSearchRpc(async()=>{n++;return failure}),failure);assert.equal(n,2)});
test('validation and authorization errors are not retried',async()=>{for(let code of ['22023','42501']){let n=0;let failure={data:null,error:{code}};await runExploreSearchRpc(async()=>{n++;return failure});assert.equal(n,1)}});
test('timeout, network, query and expired cursor stay distinct',()=>{
  const cases=[[{code:'57014'},'timeout'],[{name:'TimeoutError'},'timeout'],[{message:'Failed to fetch'},'network'],[{code:'22023',message:'Search session expired'},'cursor'],[{code:'42501',message:'permission denied'},'query']];
  for(const [error,kind] of cases){ assert.equal(classifyExploreSearchError(error),kind); assert.ok(exploreSearchErrorMessage(kind)); }
});
test('aborted requests never start a timeout retry',async()=>{let n=0;await runExploreSearchRpc(async()=>{n++;return {error:{code:'57014'}}},{aborted:true});assert.equal(n,1)});
