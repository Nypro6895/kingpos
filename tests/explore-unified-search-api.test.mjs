import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

function load(file,deps={}) {const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:name=>deps[name],performance,console:{info(){},warn(){}}});return module.exports;}
const intent=load('lib/explore-query-intent.ts');
function harness() {
 const calls=[];
 const route=load('app/api/explore/search/route.ts',{
  'next/server':{NextResponse:class {constructor(body,options){this.body=body;this.status=options?.status??200;}static json(body,options){return {body,...options};}}},
  '@/lib/explore-query-intent':intent,
  '@/lib/explore-search':{searchExploreSalons:async(input,options)=>{calls.push({input,options});return {searchVersion:3,target:'salons',results:[],error:null};}},
  '@/lib/explore-search-metrics':{exploreSearchMetric:()=>({})},
 });
 const request=(body,signal=new AbortController().signal)=>({text:async()=>JSON.stringify(body),signal});
 return {...route,calls,request};
}
test('search API forwards bounded canonical filters and media hydration through the existing private endpoint',async()=>{
 const h=harness(),id='00000000-0000-4000-8000-000000000001',cursor={version:3,session:'one',after:12};
 const response=await h.POST(h.request({query:'red nails',target:'posts',cursor,hydrateIds:[id,id],contentQuery:'red\u0000 square',displayQuery:'Red nails',queryKind:'style',locationPriority:true,locationOrigin:'manual',locationSource:'manual',location:'Chicago, IL',filters:{shape:'square',bookableOnly:true,secret:'ignored'}}));
 assert.equal(response.headers['Cache-Control'],'private, no-store');assert.equal(response.body.target,'salons');assert.equal(h.calls.length,1);
 const input=h.calls[0].input;assert.equal(input.contentQuery,'red square');assert.equal(input.queryKind,'style');assert.equal(input.locationPriority,true);assert.equal(input.locationOrigin,'manual');
 assert.equal(JSON.stringify(input.hydrateIds),JSON.stringify([id]));assert.equal(JSON.stringify(input.filters),JSON.stringify({shape:'square',bookableOnly:true}));assert.equal('secret' in input.filters,false);
});
test('invalid or oversized hydration IDs are rejected before any search or hydration RPC can execute',async()=>{
 for(const hydrateIds of ['not-an-array',['not-a-uuid'],Array.from({length:101},()=> '00000000-0000-4000-8000-000000000001')]) {
  const h=harness(),response=await h.POST(h.request({hydrateIds}));assert.equal(response.status,400);assert.equal(h.calls.length,0);
 }
});
test('aborted search response is never returned as a reusable successful result',async()=>{
 const h=harness(),controller=new AbortController();controller.abort();const response=await h.POST(h.request({query:'nails'},controller.signal));assert.equal(response.status,499);
});
