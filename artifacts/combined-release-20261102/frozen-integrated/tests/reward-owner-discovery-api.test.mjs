import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const salonId='00000000-0000-4000-8000-000000000001';
function fixture({denied=false,enabled=false,failure=false,previewFailure=false}={}){
 const calls=[];
 const summary={salonId,enabled,discoverable:enabled,members:2,rewardUses:1,discountCents:500};
 const rpc=async(name,args)=>{calls.push({name,args});return name==='reward_owner_discovery'?{data:summary,error:failure?{}:null}:previewFailure?{data:null,error:{}}:{data:{program:{enabled:false,spendPoints:20,offers:[]},version:0},error:null};};
 const query={select(fields){calls.push({fields});return query;},eq(column,value){calls.push({column,value});return query;},maybeSingle:async()=>({data:{name:'Public Salon',city:'Chicago',state:'IL'},error:null})};
 const client={rpc,from(table){calls.push({table});return query;}};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/rewards/owner-discovery/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,Promise,require:name=>({
  '@/lib/market-plugins':{marketPluginContext:async()=>{if(denied)throw Error('Denied');return{client,salonId};}},
  '@/lib/reward-public-context':{getRewardPublicSalonContext:async(_client,id)=>{calls.push({publicContext:id});return{canBook:true,coverImageUrl:'https://public.example/salon.webp',coverImageSource:'salon',serviceCategories:['Nails']};}},
 }[name]??{})});
 return{get:exports.GET,calls,summary};
}
test('owner preview keeps current-salon auth and uses read-only load plus public media',async()=>{
 const f=fixture();const response=await f.get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const result=await response.json();assert.equal(result.preview.id,salonId);assert.equal(result.preview.name,'Public Salon');assert.equal(result.preview.coverImageSource,'salon');assert.equal(result.members,2);
 const actions=f.calls.filter(c=>c.name);assert.deepEqual(actions.map(c=>c.name),['reward_owner_discovery','reward_owner']);assert.equal(actions[1].args.p_op,'load');assert.equal(actions.every(c=>c.args.p_salon===salonId),true);assert.equal(f.calls.some(c=>c.publicContext===salonId),true);assert.equal(f.calls.some(c=>c.column==='id'&&c.value===salonId),true);
});
test('denied owners never read summary, program or identity',async()=>{const f=fixture({denied:true});assert.equal((await f.get()).status,403);assert.equal(f.calls.length,0);});
test('eligible status does not fetch an unnecessary preview',async()=>{const f=fixture({enabled:true});const result=await (await f.get()).json();assert.equal(result.discoverable,true);assert.equal(f.calls.length,1);assert.equal('preview'in result,false);});
test('optional preview failure preserves real owner status; summary failure returns unavailable',async()=>{const f=fixture({previewFailure:true});const response=await f.get();assert.equal(response.status,200);assert.equal((await response.json()).preview,null);assert.equal((await fixture({failure:true}).get()).status,503);});
