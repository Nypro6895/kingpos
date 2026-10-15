import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

function service(result,entities={version:1,exactSalonName:false,exactOriginalSalonName:false,areaCandidates:[]}) {
  const calls=[];
  const client={rpc(name,args){calls.push({name,args});const value=Promise.resolve(name==='get_public_explore_query_entities'?entities.error?entities:{data:entities,error:null}:result);value.abortSignal=()=>value;return value;}};
  const load=(path,dependencies={})=>{const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(path,'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,DOMException,require:name=>dependencies[name],console:{warn(){}}});return module.exports;};
  const parser=load('lib/explore-query-intent.ts');
  const router=load('lib/explore-query-routing.ts',{'server-only':{},'@/lib/explore-query-intent':parser,'@/lib/supabase/server':{createSupabaseServerClient:()=>client}});
  const rpcModule={exports:{}};
  vm.runInNewContext(transformSync(readFileSync('lib/explore-search-rpc.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module:rpcModule,exports:rpcModule.exports,console:{warn(){}}});
  const module={exports:{}};
  const dependencies={
    'server-only':{},
    '@/lib/explore-search-rpc':rpcModule.exports,
    '@/lib/explore-query-routing':router,
    '@/lib/default-nail-images':{resolveNailCoverImage:()=>null},
    '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>null,createSupabaseServerClient:()=>client},
    '@/lib/explore-decision-signals':{EMPTY_EXPLORE_DECISION_SIGNALS:{},getExploreDecisionSignalsBySalonId:async()=>new Map()},
    '@/lib/explore-salon-logos':{loadPublicSalonLogoPaths:async()=>new Map()},
    '@/lib/salon-operating-status':{getPublicSalonOperatingStatusesBySalonId:async()=>new Map(),operatingStatusFromMap:()=>({})},
    '@/lib/salon-profile':{getSalonProfileMediaUrl:()=>null},
    '@/lib/current-context':{},
  };
  vm.runInNewContext(transformSync(readFileSync('lib/explore-search.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:name=>dependencies[name],console:{warn(){}}});
  return {search:module.exports.searchExploreSalons,resolve:router.resolveExploreQueryRouting,calls};
}

test('a legacy high page never dispatches OFFSET or an extra count query',async()=>{
 const {search,calls}=service({data:{rows:[],hasMore:false},error:null});
 const result=await search({query:'nail',page:999999});
 assert.equal(result.error,null);
 assert.equal(calls.length,2,'one bounded intent probe precedes the cursor path');
 assert.equal(calls[0].name,'get_public_explore_query_entities');
 assert.equal(calls[1].name,'search_public_explore_session');
 assert.equal(calls[1].args.p_page,undefined);
});
test('first search resolves current city and service/name phrases, preserving raw query while freezing regional filters',async()=>{
 const api=service({data:{rows:[],hasMore:false},error:null},{version:1,exactSalonName:false,areaCandidates:[{kind:'city',city:'Milwaukee',stateCode:'WI',label:'Milwaukee, WI'}]});
 const city=await api.search({query:'Milwaukee',location:'Chicago, IL',locationSource:'gps',latitude:41,longitude:-87});
 assert.equal(city.query,'');assert.equal(city.displayQuery,'Milwaukee');assert.equal(city.location,'Milwaukee, WI');assert.equal(city.locationOrigin,'query');
 assert.equal(api.calls[1].args.p_query,null);assert.equal(api.calls[1].args.p_location,'Milwaukee, WI');assert.equal(api.calls[1].args.p_scope_policy,'fixed');assert.equal(api.calls[1].args.p_latitude,null);
 const brand=await api.search({query:'King Nails in Milwaukee'});assert.equal(brand.query,'King Nails');assert.equal(api.calls.at(-1).args.p_query,'King Nails');
 const serviceQuery=await api.search({query:'nails near Milwaukee'});assert.equal(serviceQuery.category,'Nails');assert.equal(serviceQuery.displayQuery,'nails near Milwaukee');
});
test('posts and unresolved near-me return typed metadata without issuing a broad directory query',async()=>{
 const posts=service({data:{rows:[],hasMore:false},error:null});
 const response=await posts.search({query:'christmas nail design'});
 assert.equal(response.target,'posts');assert.equal(response.contentQuery,'christmas');assert.equal(response.category,'Nails');assert.equal(response.error,null);
 assert.ok(posts.calls.every(call=>call.name!=='search_public_explore_session'));
 const near=service({data:{rows:[],hasMore:false},error:null});
 const noGps=await near.search({query:'nails near me',location:'Madison, WI',locationSource:'saved'});
 assert.equal(noGps.requiresGps,true);assert.equal(noGps.error,null);assert.ok(near.calls.every(call=>call.name!=='search_public_explore_session'),'saved context cannot silently substitute for a requested live location');
});
test('entity errors remain system errors, resolved SSR routing is reused, and cursor continuations never reinterpret filters',async()=>{
 const failed=service({data:{rows:[],hasMore:false},error:null},{data:null,error:{code:'57014',message:'cancelled'}});
 const response=await failed.search({query:'Milwaukee'});assert.equal(response.lookupFailed,true);assert.equal(response.errorKind,'query');assert.ok(response.error);assert.equal(failed.calls.length,1);
 const api=service({data:{rows:[],hasMore:false},error:null});
 const routing=await api.resolve({query:'nails',location:'WI'});api.calls.length=0;
 await api.search({query:'nails',location:'WI'},{routing});assert.equal(api.calls.length,1);assert.equal(api.calls[0].name,'search_public_explore_session');
 api.calls.length=0;const cursor={id:'opaque',offset:12};
 const next=await api.search({query:'King Nails',location:'Milwaukee, WI',locationSource:'manual',cursor,page:2});
 assert.equal(api.calls.length,1);assert.equal(api.calls[0].args.p_cursor,cursor);assert.equal(api.calls[0].args.p_query,'King Nails');assert.equal(next.query,'King Nails');
});
test('true empty, timeout, expired cursor and network failure do not share error state',async()=>{
 const empty=await service({data:{rows:[],hasMore:false},error:null}).search();
 assert.equal(empty.error,null);assert.equal(empty.hasMore,false);
 for(const [error,kind] of [[{code:'57014',message:'cancelled'},'timeout'],[{code:'22023',message:'Search session expired'},'cursor'],[{message:'Failed to fetch'},'network'],[{code:'XX000',message:'broken query'},'query']]){
  const result=await service({data:null,error}).search();
  assert.equal(result.errorKind,kind);assert.ok(result.error);assert.equal(result.hasMore,false);
 }
});
