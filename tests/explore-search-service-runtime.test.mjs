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
    '@/lib/explore-query-intent':parser,
    '@/lib/explore-search-media':{resolveExploreSearchMedia:row=>({coverImageUrl:null,imageProvenance:'none',imageSourceSalonId:null})},
    '@/lib/default-nail-images':{resolveNailCoverImage:()=>null},
    '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>null,createSupabaseServerClient:()=>client,getSupabaseConfig:()=>({supabaseUrl:'https://fixture.example'})},
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
 const {search,calls}=service({data:{searchVersion:3,rows:[],hasMore:false},error:null});
 const result=await search({query:'nail',page:999999});
 assert.equal(result.error,null);
 assert.equal(calls.length,2,'one bounded intent probe precedes the cursor path');
 assert.equal(calls[0].name,'get_public_explore_query_entities');
 assert.equal(calls[1].name,'search_public_explore_session');
 assert.equal(calls[1].args.p_page,undefined);
});
test('first search resolves current city and service/name phrases, preserving raw query while freezing regional filters',async()=>{
 const api=service({data:{searchVersion:3,rows:[],hasMore:false},error:null},{version:1,exactSalonName:false,areaCandidates:[{kind:'city',city:'Milwaukee',stateCode:'WI',label:'Milwaukee, WI'}]});
 const city=await api.search({query:'Milwaukee',location:'Chicago, IL',locationSource:'gps',latitude:41,longitude:-87});
 assert.equal(city.query,'');assert.equal(city.displayQuery,'Milwaukee');assert.equal(city.location,'Milwaukee, WI');assert.equal(city.locationOrigin,'query');
 assert.equal(api.calls[1].args.p_query,null);assert.equal(api.calls[1].args.p_location,'Milwaukee, WI');assert.equal(api.calls[1].args.p_scope_policy,'fixed');assert.equal(api.calls[1].args.p_latitude,null);
 const brand=await api.search({query:'King Nails in Milwaukee'});assert.equal(brand.query,'King Nails');assert.equal(api.calls.at(-1).args.p_query,'King Nails');
 const serviceQuery=await api.search({query:'nails near Milwaukee'});assert.equal(serviceQuery.category,'Nails');assert.equal(serviceQuery.displayQuery,'nails near Milwaukee');
});
test('styles and legacy posts execute unified salon search while unresolved near-me blocks broad results',async()=>{
 const posts=service({data:{searchVersion:3,rows:[],hasMore:false},error:null});
 const response=await posts.search({query:'christmas nail design'});
 assert.equal(response.target,'salons');assert.equal(response.queryKind,'style');assert.equal(response.contentQuery,'christmas');assert.equal(response.category,'Nails');assert.equal(response.error,null);
 assert.equal(posts.calls.at(-1).name,'search_public_explore_session');assert.equal(posts.calls.at(-1).args.p_content_query,'christmas');
 const near=service({data:{searchVersion:3,rows:[],hasMore:false},error:null});
 const noGps=await near.search({query:'nails near me'});
 assert.equal(noGps.requiresGps,true);assert.equal(noGps.error,null);assert.ok(near.calls.every(call=>call.name!=='search_public_explore_session'),'an unknown area cannot silently become a national search');
 const known=service({data:{searchVersion:3,rows:[],hasMore:false},error:null});
 const selected=await known.search({query:'nails near me',location:'Milwaukee, WI',locationSource:'saved'});
 assert.equal(selected.requiresGps,false);assert.equal(selected.locationPriority,true);
 assert.equal(known.calls.at(-1).name,'search_public_explore_session');
 assert.equal(known.calls.at(-1).args.p_location,'Milwaukee, WI');
 assert.equal(known.calls.at(-1).args.p_location_priority,true);
});
test('entity errors remain system errors, resolved SSR routing is reused, and cursor continuations never reinterpret filters',async()=>{
 const failed=service({data:{searchVersion:3,rows:[],hasMore:false},error:null},{data:null,error:{code:'57014',message:'cancelled'}});
 const response=await failed.search({query:'Milwaukee'});assert.equal(response.lookupFailed,true);assert.equal(response.errorKind,'query');assert.ok(response.error);assert.equal(failed.calls.length,1);
 const api=service({data:{searchVersion:3,rows:[],hasMore:false},error:null});
 const routing=await api.resolve({query:'nails',location:'WI'});api.calls.length=0;
 await api.search({query:'nails',location:'WI'},{routing});assert.equal(api.calls.length,1);assert.equal(api.calls[0].name,'search_public_explore_session');
 api.calls.length=0;const cursor={version:3,session:'opaque',after:12};
 const next=await api.search({query:'King Nails',location:'Milwaukee, WI',locationSource:'manual',cursor,page:2});
 assert.equal(api.calls.length,1);assert.equal(api.calls[0].args.p_cursor,cursor);assert.equal(api.calls[0].args.p_query,'King Nails');assert.equal(next.query,'King Nails');
});
test('true empty, timeout, expired cursor and network failure do not share error state',async()=>{
 const empty=await service({data:{searchVersion:3,rows:[],hasMore:false},error:null}).search();
 assert.equal(empty.error,null);assert.equal(empty.hasMore,false);
 for(const [error,kind] of [[{code:'57014',message:'cancelled'},'timeout'],[{code:'22023',message:'Search session expired'},'cursor'],[{message:'Failed to fetch'},'network'],[{code:'XX000',message:'broken query'},'query']]){
  const result=await service({data:null,error}).search();
  assert.equal(result.errorKind,kind);assert.ok(result.error);assert.equal(result.hasMore,false);
 }
});

test('style filters, legacy target and continuation preserve the unified canonical RPC contract',async()=>{
 const canonical={query:'red nail design',contentQuery:'red square',queryKind:'style',locationPriority:true,filters:{shape:'square'},location:'Chicago, IL',category:'Nails',intent:'latest'};
 const cursor={version:3,session:'session-a',after:12};
 const api=service({data:{searchVersion:3,rows:[],hasMore:false,canonical,sessionCursor:cursor},error:null});
 const first=await api.search({query:'red nail design',target:'posts',location:'Chicago, IL',locationSource:'manual',filters:{shape:'square'}});
 assert.equal(api.calls.at(-1).args.p_content_query,'red square');assert.equal(api.calls.at(-1).args.p_query_kind,'style');assert.equal(api.calls.at(-1).args.p_location_priority,true);
 assert.equal(JSON.stringify(api.calls.at(-1).args.p_filters),JSON.stringify({shape:'square'}));
 assert.equal(first.searchVersion,3);assert.equal(first.target,'salons');assert.equal(first.contentQuery,'red square');assert.equal(first.sessionCursor,cursor);assert.equal(first.intent,'latest');
 api.calls.length=0;
 const next=await api.search({...first,cursor,locationSource:'manual',locationOrigin:'manual',page:2});
 assert.equal(api.calls.length,1);assert.equal(api.calls[0].args.p_content_query,'red square');assert.equal(api.calls[0].args.p_query_kind,'style');assert.equal(api.calls[0].args.p_intent,'latest');assert.equal(next.locationOrigin,'manual');assert.equal(next.locationPriority,true);
});

test('missing migration and old cursor fail explicitly instead of returning old split-search semantics',async()=>{
 const old=service({data:{rows:[],hasMore:false},error:null});
 const result=await old.search({query:'red nails'});assert.equal(result.errorKind,'query');assert.match(result.error,/Unified search/);
 const absent=await service({data:null,error:{code:'PGRST202',message:'function unavailable'}}).search({query:'red nails'});assert.match(absent.error,/Unified search/);
 const cursor=service({data:{searchVersion:3,rows:[]},error:null});const expired=await cursor.search({cursor:{version:2,session:'old',after:12}});
 assert.equal(expired.errorKind,'cursor');assert.equal(cursor.calls.length,0);
});

test('same-session media hydration is bounded, requires a current cursor and preserves requested IDs',async()=>{
 const id='00000000-0000-4000-8000-000000000001',cursor={version:3,session:'current',after:12};
 const api=service({data:{searchVersion:3,rows:[],sessionCursor:cursor},error:null});
 await api.search({cursor,hydrateIds:[id,id],queryKind:'style',contentQuery:'red'});
 assert.equal(JSON.stringify(api.calls[0].args.p_hydrate_ids),JSON.stringify([id]));
 assert.equal(api.calls[0].args.p_content_query,'red');
 const invalid=await api.search({hydrateIds:[id]});assert.equal(invalid.errorKind,'cursor');assert.equal(api.calls.length,1);
});

test('an intentionally empty canonical content query is not replaced by raw query text',async()=>{
 const api=service({data:{searchVersion:3,rows:[]},error:null});
 await api.search({query:'brand text',contentQuery:'',queryKind:'name',cursor:{version:3,session:'current',after:1}});
 assert.equal(api.calls[0].args.p_query,'brand text');assert.equal(api.calls[0].args.p_content_query,'');
});

test('hydrated salon rows dedup by ID and references remain separate from real matching results',async()=>{
 const row={salon_id:'00000000-0000-4000-8000-000000000001',salon_name:'Salon A',service_categories:['Nails'],result_group:'best_match',match_source:'salon_post',is_reference_match:false};
 const reference={...row,salon_id:'00000000-0000-4000-8000-000000000002',salon_name:'Salon B',is_reference_match:true,match_source:'reference_post'};
 const api=service({data:{searchVersion:3,rows:[row,row,reference],hasMore:false},error:null});const result=await api.search({query:'red nails'});
 assert.equal(result.results.length,2);assert.equal(result.sections.bestMatches.length,1);assert.equal(result.sections.reference.length,1);assert.equal(result.groupCounts.reference,1);assert.equal(result.sections.reference[0].isReferenceMatch,true);
 assert.equal(result.primaryCount,1);assert.equal(result.referenceCount,1);
});

test('primary-empty search can continue labelled references without replacing query, scope or matching evidence',async()=>{
 const canonical={query:'kingnails',contentQuery:'kingnails',queryKind:'name',locationPriority:true,filters:{maxPrice:60},location:'Milwaukee, WI',category:'',scopePolicy:'fixed',intent:'search'};
 const cursor={version:3,session:'continuity-session',after:2};
 const common={service_categories:['Nails'],result_group:'reference',is_primary_match:false,is_reference_match:true};
 const related={...common,salon_id:'00000000-0000-4000-8000-000000000004',salon_name:'Green Room Nails',match_type:'related',match_source:'category',recommendation_reason:'related_in_area',recommendation_area_label:'Milwaukee, WI'};
 const broader={...common,salon_id:'00000000-0000-4000-8000-000000000001',salon_name:'King Nails',match_type:'exact_name',match_source:'salon_name',recommendation_reason:'matching_in_broader_area',recommendation_area_label:'Elsewhere in Wisconsin'};
 const api=service({data:{searchVersion:3,canonical,recommendationCategory:'Nails',rows:[related,broader],hasMore:true,nextCursor:cursor,sessionCursor:cursor,totalCount:64,scope:{policy:'fixed',stage:'A',label:'Milwaukee, WI',expanded:false}},error:null});
 const first=await api.search({query:'kingnails',location:'Milwaukee, WI',locationSource:'manual',filters:{maxPrice:60}});
 assert.equal(first.error,null);assert.equal(first.query,'kingnails');assert.equal(first.contentQuery,'kingnails');assert.equal(first.location,'Milwaukee, WI');assert.equal(first.scope.policy,'fixed');assert.equal(first.category,'');
 assert.equal(first.recommendationCategory,'Nails');
 assert.equal(first.primaryCount,0);assert.equal(first.referenceCount,2);assert.equal(first.totalCount,64);assert.equal(first.hasMore,true);assert.equal(first.sections.bestMatches.length,0);
 assert.equal(first.sections.reference[0].recommendationReason,'related_in_area');assert.equal(first.sections.reference[0].recommendationAreaLabel,'Milwaukee, WI');
 assert.equal(first.sections.reference[1].isPrimaryMatch,false);assert.equal(first.sections.reference[1].matchType,'exact_name');assert.equal(first.sections.reference[1].matchSource,'salon_name');assert.equal(first.sections.reference[1].recommendationReason,'matching_in_broader_area');
 api.calls.length=0;
 const second=await api.search({...first,cursor:first.nextCursor,scopePolicy:first.scope.policy,page:2});
 assert.equal(api.calls.length,1);assert.equal(api.calls[0].name,'search_public_explore_session');assert.equal(api.calls[0].args.p_query,'kingnails');assert.equal(api.calls[0].args.p_content_query,'kingnails');assert.equal(api.calls[0].args.p_query_kind,'name');assert.equal(api.calls[0].args.p_location_priority,true);assert.equal(api.calls[0].args.p_scope_policy,'fixed');assert.equal(JSON.stringify(api.calls[0].args.p_filters),JSON.stringify({maxPrice:60}));
 assert.equal(second.primaryCount,0);assert.equal(second.referenceCount,2);assert.equal(second.sections.reference[1].recommendationAreaLabel,'Elsewhere in Wisconsin');
 assert.equal(api.calls[0].args.p_category,null,'inferred recommendation category never becomes the primary filter');
});

test('unknown category-less query stays truthful when the server has no related candidates',async()=>{
 const api=service({data:{searchVersion:3,rows:[],hasMore:false},error:null});
 const response=await api.search({query:'unknownbusinessxyz',location:'Boise, ID',locationSource:'manual'});
 assert.equal(response.query,'unknownbusinessxyz');assert.equal(response.category,'');assert.equal(response.primaryCount,0);assert.equal(response.referenceCount,0);assert.equal(response.results.length,0);assert.equal(response.hasMore,false);
 assert.equal(api.calls.at(-1).args.p_query,'unknownbusinessxyz');assert.equal(api.calls.at(-1).args.p_content_query,'unknownbusinessxyz');
});

test('unknown or ambiguous street addresses stop before search and retain their area choices',async()=>{
 for(const addressStatus of ['unmatched','ambiguous']){
  const api=service({data:{searchVersion:3,rows:[],hasMore:false},error:null});
  const routing={...await api.resolve({query:'nails',location:'Milwaukee, WI'}),addressStatus,addressQuery:'8333 W Appleton Ave',
   location:'8333 W Appleton Ave',locationOrigin:'query',areaAmbiguous:addressStatus==='ambiguous',
   areaCandidates:addressStatus==='ambiguous'?[{kind:'city',label:'Milwaukee, WI',city:'Milwaukee',stateCode:'WI'}]:[]};
  api.calls.length=0;
  const result=await api.search({query:'nails at 8333 W Appleton Ave'},{routing});
  assert.equal(api.calls.length,0);assert.equal(result.error,null);assert.equal(result.addressStatus,addressStatus);
  assert.equal(result.addressQuery,'8333 W Appleton Ave');assert.equal(result.location,'8333 W Appleton Ave');
  assert.equal(result.results.length,0);assert.equal(result.hasMore,false);assert.equal(result.scope.policy,'fixed');
  assert.equal(result.areaCandidates.length,addressStatus==='ambiguous'?1:0);
 }
});

test('partial real post evidence remains a labelled style reference rather than a primary style match',async()=>{
 const row={salon_id:'00000000-0000-4000-8000-000000000003',salon_name:'Related Nail Studio',service_categories:['Nails'],result_group:'reference',is_primary_match:false,is_reference_match:true,match_type:'related_post',match_source:'customer_post',recommendation_reason:'related_in_area',recommendation_area_label:'Madison, WI'};
 const api=service({data:{searchVersion:3,rows:[row],hasMore:false,recommendationCategory:'Nails'},error:null});
 const response=await api.search({query:'milky matcha',location:'Madison, WI',locationSource:'manual'});
 assert.equal(response.primaryCount,0);assert.equal(response.referenceCount,1);assert.equal(response.sections.bestMatches.length,0);
 assert.equal(response.results[0].matchType,'related_post');assert.equal(response.results[0].matchSource,'customer_post');assert.equal(response.results[0].recommendationReason,'related_in_area');assert.equal(response.results[0].isPrimaryMatch,false);
 assert.equal(response.contentQuery,'milky matcha');assert.equal(api.calls.at(-1).args.p_content_query,'milky matcha');
});
